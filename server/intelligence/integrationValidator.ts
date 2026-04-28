/**
 * Pre-flight Integration Validator
 *
 * Runs cheap health checks for every configured integration (Google, Outlook,
 * Telegram, Discord, Slack, WhatsApp) without making expensive API calls.
 * Results are written to the integration_status table and served to:
 *   1. /api/integrations/status — app UI status badges
 *   2. agent harness — excludes broken-integration tools + adds prompt note
 *
 * Validator logic per integration:
 *   Google / Outlook  : check token exists + expiry date in user_oauth_tokens
 *                       If token is valid, do a single cheap profile GET to
 *                       verify scope isn't revoked.
 *   Telegram          : check telegram_links row exists for the user
 *   Discord/Slack/WA  : check channel_links row exists for the channel
 *
 * Runs on server start (with a 10-second delay to let DB warm up) and every
 * 30 minutes thereafter via the scheduler hook.
 */

import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { IntegrationName, IntegrationStatusValue } from "@shared/schema";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import { logSystemError } from "../agent/errorLogger";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { notifyUser } from "../channels/registry";

// Rate-limit automatic debug sessions: one per capability per hour
const lastDebugTriggerAt = new Map<string, number>();
const DEBUG_TRIGGER_COOLDOWN_MS = 60 * 60 * 1000;

const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Typed row / response shapes ───────────────────────────────────────────────

interface OAuthTokenRow {
  access_token: string;
  refresh_token: string | null;
  expires_at: Date | string | null;
  scopes: string | null;
}

interface SqlQueryResult<T> {
  rows?: T[];
}

interface GoogleApiErrorBody {
  error?: { message?: string };
}

interface MicrosoftApiErrorBody {
  error?: { message?: string };
}

interface TelegramGetMeResponse {
  ok: boolean;
  result?: { id: number; is_bot: boolean; username: string };
}

interface TelegramWebhookInfoResponse {
  ok: boolean;
  result?: {
    url?: string;
    last_error_date?: number;
    last_error_message?: string;
  };
}

interface SlackAuthTestResponse {
  ok: boolean;
  error?: string;
}

interface DiscordGuildEntry {
  id: string;
  name: string;
}

interface UserIdRow {
  id: string | number;
}

// ── Per-integration health checkers ─────────────────────────────────────────

interface CheckResult {
  status: IntegrationStatusValue;
  errorMessage?: string;
  expiresAt?: Date;
}

async function checkOAuthIntegration(
  userId: string,
  provider: string,
): Promise<CheckResult> {
  try {
    const rows = await db.execute(sql`
      SELECT access_token, refresh_token, expires_at, scopes
      FROM user_oauth_tokens
      WHERE user_id = ${userId} AND provider = ${provider}
      LIMIT 1
    `);
    const row = (rows as SqlQueryResult<OAuthTokenRow>).rows?.[0] ?? (Array.isArray(rows) ? (rows as OAuthTokenRow[])[0] : null);
    if (!row) {
      // No entry in user_oauth_tokens — fall back to Replit-managed connector tokens.
      if (provider === "google") return checkGoogleViaConnector();
      if (provider === "microsoft") return checkOutlookViaConnector();
      return { status: "unconfigured" };
    }

    const expiresAt: Date | null = row.expires_at ? new Date(row.expires_at) : null;
    const now = Date.now();

    // Hard-expired: report broken immediately — no ping needed, token is unusable.
    if (expiresAt && expiresAt.getTime() < now) {
      return {
        status: "broken",
        errorMessage: "Token expired — please reconnect in Settings",
        expiresAt,
      };
    }

    // Token is present and not expired — always do a cheap connectivity ping
    // to verify scopes haven't been revoked, even for expiring_soon tokens.
    const healthy = await pingOAuthProvider(provider, row.access_token as string);
    if (!healthy.ok) {
      return {
        status: "broken",
        errorMessage: healthy.error ?? "API ping failed — token may be revoked",
        expiresAt: expiresAt ?? undefined,
      };
    }

    // Ping passed — classify as expiring_soon if within warning window, else healthy.
    if (expiresAt && expiresAt.getTime() < now + EXPIRY_WARNING_MS) {
      return { status: "expiring_soon", expiresAt };
    }

    return { status: "healthy", expiresAt: expiresAt ?? undefined };
  } catch (err) {
    return {
      status: "broken",
      errorMessage: `Validator error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}


async function pingOAuthProvider(
  provider: string,
  accessToken: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (provider === "google") {
      // Validate Gmail AND Calendar scopes in parallel so a revoked Calendar
      // scope (while Gmail is still valid) is caught before tools are offered.
      const [gmailRes, calendarRes] = await Promise.all([
        fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch("https://www.googleapis.com/calendar/v3/calendars/primary", {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);
      // 429 = rate-limited but token is valid — treat as healthy.
      if (!gmailRes.ok && gmailRes.status !== 429) {
        const body = await gmailRes.json() as GoogleApiErrorBody;
        return { ok: false, error: body?.error?.message ?? `Gmail HTTP ${gmailRes.status}` };
      }
      if (!calendarRes.ok && calendarRes.status !== 429) {
        const body = await calendarRes.json() as GoogleApiErrorBody;
        return { ok: false, error: body?.error?.message ?? `Calendar HTTP ${calendarRes.status}` };
      }
      return { ok: true };
    }

    if (provider === "microsoft") {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      // 429 = rate-limited but token is valid — treat as healthy.
      if (res.ok || res.status === 429) return { ok: true };
      const body = await res.json() as MicrosoftApiErrorBody;
      return {
        ok: false,
        error: body?.error?.message ?? `HTTP ${res.status}`,
      };
    }

    // Unknown provider — assume healthy if token exists
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Replit connector fallback helpers ─────────────────────────────────────────
// When user_oauth_tokens has no row for a provider, these helpers check whether
// a Replit-managed connector token exists and can successfully reach the API.
// Uses @replit/connectors-sdk — the SDK handles token refresh automatically.

/**
 * Check whether a Replit connector is active by:
 *   1. Confirming the connection exists via listConnections.
 *   2. Doing a lightweight proxy ping to verify the token is still valid.
 *
 * Returns 'healthy'      — connection present and ping succeeds (HTTP 2xx).
 * Returns 'unconfigured' — no connection found in this Repl.
 * Returns 'broken'       — connection exists but ping returned non-2xx,
 *                          meaning the token is revoked, expired, or the
 *                          connector is misconfigured.
 *
 * The connector SDK handles token refresh and auth headers automatically;
 * we never touch the raw access token.
 */
async function checkConnectorStatus(
  connectorName: string,
  pingPath: string,
): Promise<CheckResult> {
  try {
    const connectors = new ReplitConnectors();

    // Step 1: verify the connection exists in this Repl.
    const connections = await connectors.listConnections({
      connector_names: connectorName,
      refresh_policy: "none",
    });

    if (!connections || connections.length === 0) {
      return { status: "unconfigured" };
    }

    // Step 2: ping the provider API to confirm the token is still valid.
    // Any non-2xx response is treated as broken — the connector is set up
    // but its OAuth token is either expired or revoked.
    // Exception: 429 (Too Many Requests) means the token is valid but rate-limited;
    // treat as healthy so we don't fire false-positive broken alerts.
    const res = await connectors.proxy(connectorName, pingPath, { method: "GET" });
    if (res.ok) return { status: "healthy" };
    if (res.status === 429) return { status: "healthy" };

    const text = await res.text().catch(() => "");
    return {
      status: "broken",
      errorMessage: `${connectorName} connector token invalid (HTTP ${res.status}): ${text.slice(0, 120)}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // listConnections throws with a descriptive message when no connection
    // exists for this connector in the current Repl. Only that case should
    // be returned as unconfigured; infrastructure / auth failures are broken.
    const isNoConnection =
      msg.includes("not found") ||
      msg.includes("no connection") ||
      (msg.includes("404") && msg.includes("connection"));
    if (isNoConnection) {
      return { status: "unconfigured" };
    }
    return { status: "broken", errorMessage: `${connectorName} connector error: ${msg}` };
  }
}

/**
 * Check Google integration via Replit connectors (google-calendar + google-mail).
 * Both connectors are pinged; both must be healthy for the integration to pass.
 *
 * Calendar ping:  GET /users/me/calendarList  (requires calendar scope)
 * Gmail ping:     GET /gmail/v1/users/me/labels  (requires gmail.labels scope)
 */
async function checkGoogleViaConnector(): Promise<CheckResult> {
  const [calendarResult, mailResult] = await Promise.all([
    checkConnectorStatus("google-calendar", "/users/me/calendarList"),
    checkConnectorStatus("google-mail", "/gmail/v1/users/me/labels"),
  ]);

  // Both unconfigured → no connector set up at all
  if (calendarResult.status === "unconfigured" && mailResult.status === "unconfigured") {
    return { status: "unconfigured" };
  }
  // Surface broken over unconfigured (more actionable)
  if (calendarResult.status === "broken") return calendarResult;
  if (mailResult.status === "broken") return mailResult;
  // Both healthy → healthy
  if (calendarResult.status === "healthy" && mailResult.status === "healthy") {
    return { status: "healthy" };
  }
  // Partial — one connector missing
  return {
    status: "broken",
    errorMessage: "One or more Google connectors (Calendar / Gmail) are not fully configured",
  };
}

/**
 * Check Outlook (Microsoft) integration via the Replit outlook connector.
 * Pings GET /v1.0/me on the Microsoft Graph API to verify the token is valid.
 */
async function checkOutlookViaConnector(): Promise<CheckResult> {
  return checkConnectorStatus("outlook", "/v1.0/me");
}

// ── Cached system-level credential checks (once per process start) ────────────
// These validate that the bot/API credentials are correctly configured.
// Per-call overhead is a Map lookup; actual ping happens once per cycle.

const systemPingCache = new Map<string, { ok: boolean; checkedAt: number }>();
const SYSTEM_PING_TTL_MS = 30 * 60 * 1000; // 30 min — same as run cadence

async function checkSystemCredential(
  key: string,
  pingFn: () => Promise<boolean>,
): Promise<boolean> {
  const cached = systemPingCache.get(key);
  if (cached && Date.now() - cached.checkedAt < SYSTEM_PING_TTL_MS) {
    return cached.ok;
  }
  let ok = false;
  try { ok = await pingFn(); } catch { ok = false; }
  // Only cache successes — a failure should be retried on the very next cycle
  // so that startup race conditions (Discord/Telegram WS not yet connected) do
  // not freeze a "broken" result in memory for the entire 30-minute window.
  if (ok) {
    systemPingCache.set(key, { ok: true, checkedAt: Date.now() });
  } else {
    systemPingCache.delete(key);
  }
  return ok;
}

async function pingTelegramBot(): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = await res.json() as TelegramGetMeResponse;
    return body?.ok === true;
  } catch { return false; }
}

async function pingDiscordBot(): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    return res.ok;
  } catch { return false; }
}

async function pingSlack(): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const body = await res.json() as SlackAuthTestResponse;
    return body?.ok === true;
  } catch { return false; }
}

async function pingTwilio(): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return false;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
    });
    return res.ok;
  } catch { return false; }
}

async function checkTelegramWebhookState(): Promise<boolean> {
  // Returns false if the webhook has recent delivery errors (within the last hour),
  // indicating a connectivity problem between Telegram and this server.
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const body = await res.json() as TelegramWebhookInfoResponse;
    if (!body?.ok) return false;
    const info = body.result ?? {};
    // If lastErrorDate is within the last 60 minutes, webhook is degraded.
    if (info.last_error_date) {
      const errorAgeMs = Date.now() - info.last_error_date * 1000;
      if (errorAgeMs < 60 * 60 * 1000) return false;
    }
    return true;
  } catch { return false; }
}

async function checkTelegram(userId: string): Promise<CheckResult> {
  try {
    // Step 1: verify user has linked their account — if not linked, short-circuit
    // to unconfigured regardless of system credential state.
    const rows = await db
      .select({ chatId: schema.telegramLinks.chatId })
      .from(schema.telegramLinks)
      .where(eq(schema.telegramLinks.userId, userId))
      .limit(1);
    if (rows.length === 0) return { status: "unconfigured" };

    // Step 2: user IS linked — now verify system bot token is valid (getMe ping).
    const botOk = await checkSystemCredential("telegram_bot", pingTelegramBot);
    if (!botOk) {
      return { status: "broken", errorMessage: "Telegram bot token missing or invalid" };
    }
    // Step 3: verify webhook (or polling) is healthy — no recent delivery errors.
    const webhookOk = await checkSystemCredential("telegram_webhook", checkTelegramWebhookState);
    if (!webhookOk) {
      return { status: "broken", errorMessage: "Telegram webhook has recent delivery errors" };
    }
    return { status: "healthy" };
  } catch {
    return { status: "unconfigured" };
  }
}

async function pingDiscordBotGuilds(): Promise<boolean> {
  // Verifies the bot is in at least one guild (implying send_messages permission granted).
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return false;
    const guilds = await res.json() as DiscordGuildEntry[];
    return Array.isArray(guilds) && guilds.length > 0;
  } catch { return false; }
}

async function checkDiscord(userId: string): Promise<CheckResult> {
  try {
    // Step 1: verify user has linked their account — if not linked, short-circuit
    // to unconfigured regardless of system credential state.
    const rows = await db
      .select({ id: schema.channelLinks.id })
      .from(schema.channelLinks)
      .where(and(
        eq(schema.channelLinks.userId, userId),
        eq(schema.channelLinks.channel, "discord"),
      ))
      .limit(1);
    if (rows.length === 0) return { status: "unconfigured" };

    // Step 2: user IS linked — now verify system Discord bot token is valid.
    const botOk = await checkSystemCredential("discord_bot", pingDiscordBot);
    if (!botOk) {
      return { status: "broken", errorMessage: "Discord bot token missing or invalid" };
    }
    // Step 3: verify bot has guild membership (i.e. has been added with correct permissions).
    const inGuild = await checkSystemCredential("discord_guilds", pingDiscordBotGuilds);
    if (!inGuild) {
      return { status: "broken", errorMessage: "Discord bot has no guild access — bot may lack required permissions" };
    }
    return { status: "healthy" };
  } catch {
    return { status: "unconfigured" };
  }
}

async function checkSlack(userId: string): Promise<CheckResult> {
  // Slack is connected via the OAuth flow (user_oauth_tokens, provider 'slack'),
  // which is the same path used by Google and Outlook in Settings → Connections.
  // We validate the user's OAuth token first; fall back to channel_links for
  // workspaces using a system bot token instead of per-user OAuth.
  try {
    // Primary path: user has a Slack OAuth token
    const oauthRows = await db.execute(sql`
      SELECT access_token, refresh_token, expires_at, scopes
      FROM user_oauth_tokens
      WHERE user_id = ${userId} AND provider = 'slack'
      LIMIT 1
    `);
    const oauthRow = (oauthRows as SqlQueryResult<OAuthTokenRow>).rows?.[0]
      ?? (Array.isArray(oauthRows) ? (oauthRows as OAuthTokenRow[])[0] : null);

    if (oauthRow) {
      // User has an OAuth token — validate it via auth.test
      const expiresAt: Date | null = oauthRow.expires_at ? new Date(oauthRow.expires_at) : null;
      const now = Date.now();

      if (expiresAt && expiresAt.getTime() < now) {
        return { status: "broken", errorMessage: "Slack token expired — please reconnect in Settings", expiresAt };
      }

      const res = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { Authorization: `Bearer ${oauthRow.access_token}`, "Content-Type": "application/json" },
      });
      const body = await res.json() as SlackAuthTestResponse;
      if (!body.ok) {
        return { status: "broken", errorMessage: body.error ?? "Slack OAuth token rejected — please reconnect", expiresAt: expiresAt ?? undefined };
      }

      if (expiresAt && expiresAt.getTime() < now + EXPIRY_WARNING_MS) {
        return { status: "expiring_soon", expiresAt };
      }
      return { status: "healthy", expiresAt: expiresAt ?? undefined };
    }

    // Fallback: check channel_links for bot-token-based Slack connections
    const channelRows = await db
      .select({ id: schema.channelLinks.id })
      .from(schema.channelLinks)
      .where(and(
        eq(schema.channelLinks.userId, userId),
        eq(schema.channelLinks.channel, "slack"),
      ))
      .limit(1);

    if (channelRows.length === 0) return { status: "unconfigured" };

    // User has a channel_links entry — verify the system bot token is still valid
    const tokenOk = await checkSystemCredential("slack_token", pingSlack);
    if (!tokenOk) {
      return { status: "broken", errorMessage: "Slack workspace token missing or invalid" };
    }
    return { status: "healthy" };
  } catch {
    return { status: "unconfigured" };
  }
}

async function checkWhatsApp(userId: string): Promise<CheckResult> {
  try {
    const twilioOk = await checkSystemCredential("twilio", pingTwilio);
    if (!twilioOk) {
      // Check if user is linked — if so the system creds are broken
      const rows = await db
        .select({ id: schema.channelLinks.id })
        .from(schema.channelLinks)
        .where(and(
          eq(schema.channelLinks.userId, userId),
          eq(schema.channelLinks.channel, "whatsapp"),
        ))
        .limit(1);
      if (rows.length === 0) return { status: "unconfigured" };
      return { status: "broken", errorMessage: "Twilio credentials missing or invalid" };
    }
    const rows = await db
      .select({ id: schema.channelLinks.id })
      .from(schema.channelLinks)
      .where(and(
        eq(schema.channelLinks.userId, userId),
        eq(schema.channelLinks.channel, "whatsapp"),
      ))
      .limit(1);
    return rows.length > 0 ? { status: "healthy" } : { status: "unconfigured" };
  } catch {
    return { status: "unconfigured" };
  }
}

// ── Write result to DB ────────────────────────────────────────────────────────

async function writeStatus(
  userId: string,
  integration: IntegrationName,
  result: CheckResult,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO integration_status (user_id, integration, status, last_checked_at, error_message, expires_at)
    VALUES (
      ${userId},
      ${integration},
      ${result.status},
      NOW(),
      ${result.errorMessage ?? null},
      ${result.expiresAt ?? null}
    )
    ON CONFLICT (user_id, integration) DO UPDATE SET
      status          = EXCLUDED.status,
      last_checked_at = EXCLUDED.last_checked_at,
      error_message   = EXCLUDED.error_message,
      expires_at      = EXCLUDED.expires_at
  `);
}

// ── Automatic debug session trigger ───────────────────────────────────────────

interface AutoDebugOptions {
  userId: string;
  capability: string;
  errorMessage: string;
  source: string;
  errorLogId?: string;
}

/**
 * For errors that are completely self-explanatory and user-actionable
 * (expired token, revoked access, etc.) return a ready-to-send message so
 * we can skip the LLM auto-debug session entirely.
 *
 * Returns null for genuine unknowns that still warrant LLM investigation.
 */
function buildDirectNotification(integration: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();

  // Expired OAuth token — user needs to reconnect
  if (msg.includes("token expired") || msg.includes("please reconnect")) {
    const label = integration === "google" ? "Google (Gmail + Calendar)" : integration.charAt(0).toUpperCase() + integration.slice(1);
    return (
      `Your ${label} integration token has expired and needs to be reconnected.\n\n` +
      `To fix: open Jarvis → Settings → Connections → reconnect ${label}.\n\n` +
      `This will restore full email, calendar, and related features.`
    );
  }

  // Revoked / invalid token (401, 403 from connector proxy)
  if (msg.includes("http 401") || msg.includes("http 403") ||
      msg.includes("token invalid") || msg.includes("token revoked") ||
      msg.includes("access denied") || msg.includes("unauthorized")) {
    const label = integration.charAt(0).toUpperCase() + integration.slice(1);
    return (
      `Your ${label} integration appears to have been disconnected or its access revoked.\n\n` +
      `To fix: open Jarvis → Settings → Connections → reconnect ${label}.`
    );
  }

  // Bot token misconfigured
  if (msg.includes("bot token missing") || msg.includes("bot token") && msg.includes("invalid")) {
    const label = integration.charAt(0).toUpperCase() + integration.slice(1);
    return (
      `The ${label} bot token is missing or invalid. ` +
      `Check that the bot token is correctly set in your environment configuration.`
    );
  }

  // Unknown — let the LLM investigate
  return null;
}

async function triggerAutoDebugSession(opts: AutoDebugOptions): Promise<void> {
  try {
    const { submitAgentJob } = await import("../agent/jobQueue");
    const brief = [
      `Health check for the "${opts.capability}" integration has failed.`,
      `Error: ${opts.errorMessage}`,
      ``,
      `CRITICAL RULES — you must follow these before responding:`,
      `- Do NOT speculate, infer, or guess about the root cause. Only report what you have confirmed by actually calling the investigation tools below.`,
      `- If you cannot call the tools (e.g. the integration is excluded from your tool set), respond with ONLY: "I was unable to investigate this automatically because the ${opts.capability} integration is currently excluded from my tools. The raw error is: ${opts.errorMessage}"`,
      `- Do NOT describe steps you plan to take — only describe steps you have already taken and what they returned.`,
      ``,
      `If you do have investigation tools, follow these steps in order:`,
      `1. Call read_recent_errors with source_filter="${opts.capability}" to read the error log.`,
      `2. Call list_source_files and read_source_file to inspect the relevant code.`,
      `3. If you identify a code fix, call propose_code_change with the fix and include debug_context.`,
      `4. If no code fix is appropriate, send a plain-English diagnosis to the user's inbox explaining the confirmed root cause.`,
      ``,
      `Error log ID for reference: ${opts.errorLogId ?? "N/A"}`,
    ].join("\n");

    await submitAgentJob({
      userId: opts.userId,
      agentType: "general",
      title: `Auto debug: ${opts.capability} health check failed`,
      prompt: brief,
      input: {
        autoDebug: true,
        capability: opts.capability,
        source: opts.source,
        errorLogId: opts.errorLogId,
      },
    });

    console.log(`[IntegrationValidator] queued auto debug session for "${opts.capability}" (user ${opts.userId})`);
  } catch (err) {
    console.error("[IntegrationValidator] triggerAutoDebugSession failed:", err);
  }
}

// ── Consecutive-failure circuit breaker ───────────────────────────────────────
// Keyed by "<integration>:<userId>". Incremented on each failed ping; reset to
// 0 on success or unconfigured. A single failure writes "degraded" (tools kept
// available). Only ≥2 consecutive failures escalate to "broken" (tools excluded,
// alert fired). This eliminates false positives from startup race conditions and
// transient network blips.

const consecutiveFailures = new Map<string, number>();

// ── Run all checks for one user ───────────────────────────────────────────────

export async function validateUserIntegrations(userId: string): Promise<void> {
  const checks: Array<{ integration: IntegrationName; check: () => Promise<CheckResult> }> = [
    { integration: "google",   check: () => checkOAuthIntegration(userId, "google") },
    { integration: "outlook",  check: () => checkOAuthIntegration(userId, "microsoft") },
    { integration: "telegram", check: () => checkTelegram(userId) },
    { integration: "discord",  check: () => checkDiscord(userId) },
    { integration: "slack",    check: () => checkSlack(userId) },
    { integration: "whatsapp", check: () => checkWhatsApp(userId) },
  ];

  await Promise.all(
    checks.map(async ({ integration, check }) => {
      const failureKey = `${integration}:${userId}`;
      try {
        const result = await check();

        if (result.status !== "broken") {
          // Success or unconfigured — reset failure streak and write status as-is.
          consecutiveFailures.delete(failureKey);
          await writeStatus(userId, integration, result);
          return;
        }

        // ── Failed ping — apply circuit-breaker logic ─────────────────────────
        const streak = (consecutiveFailures.get(failureKey) ?? 0) + 1;
        consecutiveFailures.set(failureKey, streak);
        const errMsg = result.errorMessage ?? "unknown error";

        if (streak < 2) {
          // First failure — write silent "degraded" state. Tools remain active;
          // no alert is fired. The next cycle will either recover or escalate.
          console.log(`[IntegrationValidator] ${integration} degraded (streak=${streak}) for ${userId}: ${errMsg}`);
          await writeStatus(userId, integration, { status: "degraded", errorMessage: errMsg });
          return;
        }

        // Two or more consecutive failures — escalate to "broken".
        await writeStatus(userId, integration, result);
        diagEmit({
          userId,
          subsystem: "integration",
          severity: "error",
          message: `Integration ${integration} broken: ${errMsg}`,
          metadata: { integration },
        }).catch(() => {});

        // Persist to system_error_log for Jarvis self-debugging
        const errorLogId = await logSystemError({
          source: `integrationValidator/${integration}`,
          message: `Health check failure: ${errMsg}`,
          level: "error",
          context: { integration, userId, status: result.status },
          userId,
        });

        // Trigger notification (rate-limited to 1 per capability per hour)
        const rateKey = `${integration}:${userId}`;
        const last = lastDebugTriggerAt.get(rateKey) ?? 0;
        if (Date.now() - last > DEBUG_TRIGGER_COOLDOWN_MS) {
          lastDebugTriggerAt.set(rateKey, Date.now());

          const directMsg = buildDirectNotification(integration, errMsg);
          if (directMsg) {
            // Known, self-explanatory error — send a clean direct notification,
            // no LLM session needed (avoids hallucinated "investigation steps").
            notifyUser(userId, "approval_request", `Jarvis (integration alert): ${integration} disconnected\n\n${directMsg}`)
              .catch((e) => console.error("[IntegrationValidator] direct notify failed:", e));
            console.log(`[IntegrationValidator] direct notify for "${integration}" (user ${userId}): ${errMsg}`);
          } else {
            // Unknown error — spin up LLM auto-debug session to investigate.
            triggerAutoDebugSession({
              userId,
              capability: integration,
              errorMessage: errMsg,
              source: `integrationValidator/${integration}`,
              errorLogId: errorLogId ?? undefined,
            }).catch((e) => console.error("[IntegrationValidator] auto debug trigger failed:", e));
          }
        }
      } catch (err) {
        console.error(`[IntegrationValidator] ${integration} check failed for ${userId}:`, err);
        const errMsg = `Validator crashed: ${err instanceof Error ? err.message : String(err)}`;

        // Apply same circuit-breaker: first crash → degraded, repeat crash → broken.
        const streak = (consecutiveFailures.get(failureKey) ?? 0) + 1;
        consecutiveFailures.set(failureKey, streak);

        if (streak < 2) {
          console.log(`[IntegrationValidator] ${integration} crash degraded (streak=${streak}) for ${userId}`);
          await writeStatus(userId, integration, { status: "degraded", errorMessage: errMsg }).catch(() => {});
          return;
        }

        await writeStatus(userId, integration, {
          status: "broken",
          errorMessage: errMsg,
        }).catch(() => {});
        diagEmit({
          userId,
          subsystem: "integration",
          severity: "error",
          message: `Integration ${integration} validator crashed: ${errMsg.slice(0, 200)}`,
          metadata: { integration },
        }).catch(() => {});

        // Persist crash to system_error_log
        await logSystemError({
          source: `integrationValidator/${integration}`,
          message: errMsg,
          error: err,
          level: "error",
          context: { integration, userId },
          userId,
        });

        // Trigger alert (rate-limited to 1 per capability per hour — same gate as
        // the normal broken path).  Crashed validators produce opaque error messages
        // that don't match any known pattern, so we always use the auto-debug path.
        const rateKey = `${integration}:${userId}`;
        const last = lastDebugTriggerAt.get(rateKey) ?? 0;
        if (Date.now() - last > DEBUG_TRIGGER_COOLDOWN_MS) {
          lastDebugTriggerAt.set(rateKey, Date.now());
          triggerAutoDebugSession({
            userId,
            capability: integration,
            errorMessage: errMsg,
            source: `integrationValidator/${integration}`,
          }).catch((e) => console.error("[IntegrationValidator] auto debug trigger failed:", e));
        }
      }
    }),
  );
}

// ── Read statuses (for API and harness) ──────────────────────────────────────

export interface IntegrationStatusMap {
  google:   IntegrationStatusValue;
  outlook:  IntegrationStatusValue;
  telegram: IntegrationStatusValue;
  discord:  IntegrationStatusValue;
  slack:    IntegrationStatusValue;
  whatsapp: IntegrationStatusValue;
  [key: string]: IntegrationStatusValue;
}

export async function getUserIntegrationStatuses(
  userId: string,
): Promise<IntegrationStatusMap> {
  const defaults: IntegrationStatusMap = {
    google: "unconfigured",
    outlook: "unconfigured",
    telegram: "unconfigured",
    discord: "unconfigured",
    slack: "unconfigured",
    whatsapp: "unconfigured",
  };

  try {
    const rows = await db
      .select()
      .from(schema.integrationStatus)
      .where(eq(schema.integrationStatus.userId, userId));

    for (const row of rows) {
      defaults[row.integration] = row.status as IntegrationStatusValue;
    }
  } catch {
    // Fall through with defaults — never block an agent session
  }

  return defaults;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

async function getAllUserIds(): Promise<string[]> {
  try {
    const rows = await db.execute(sql`SELECT id FROM users`);
    const items: UserIdRow[] = (rows as SqlQueryResult<UserIdRow>).rows ?? (Array.isArray(rows) ? (rows as UserIdRow[]) : []);
    return items.map((r) => String(r.id));
  } catch {
    return [];
  }
}

let running = false;

export async function runValidationCycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // ── Config-level capability health check ───────────────────────────────
    // Run each capability's lightweight healthCheck (env-var / config only,
    // no network calls). Unhealthy capabilities are logged so operators can
    // diagnose missing secrets without waiting for an OAuth ping to fail.
    try {
      const { capabilityRegistry } = await import("../capabilities/index");
      const capHealth = await capabilityRegistry.getHealthStatuses();
      const unhealthy = Object.entries(capHealth).filter(([, s]) => !s.healthy);
      if (unhealthy.length > 0) {
        for (const [id, status] of unhealthy) {
          console.warn(`[IntegrationValidator] capability "${id}" config unhealthy: ${status.reason}`);
        }
      }
    } catch (err) {
      console.error("[IntegrationValidator] capability health check failed:", err);
    }

    // ── Per-user OAuth integration checks ─────────────────────────────────
    const userIds = await getAllUserIds();
    console.log(`[IntegrationValidator] checking ${userIds.length} user(s)`);
    for (const userId of userIds) {
      await validateUserIntegrations(userId).catch((err) =>
        console.error(`[IntegrationValidator] user ${userId} failed:`, err),
      );
    }
    console.log("[IntegrationValidator] cycle complete");
  } finally {
    running = false;
  }
}

export function startIntegrationValidator(): void {
  // Delay first run by 10 seconds to let DB connections warm up on boot.
  // Recurring 30-min cycles are driven exclusively by the heartbeat's
  // runHeartbeatTick() → runValidationCycle() call (with lastValidationRunAt
  // throttle) so there is a single scheduler source of truth.
  setTimeout(() => {
    runValidationCycle().catch((err) =>
      console.error("[IntegrationValidator] initial run failed:", err),
    );
  }, 10_000);

  console.log("[IntegrationValidator] started — boot check in 10s, then every 30 min");
}

// ── Test-only exports ─────────────────────────────────────────────────────────
// These are used exclusively by server/intelligence/__tests__/*.assert.ts files.
// They MUST NOT be called from production code.

/**
 * Re-exports buildDirectNotification for unit tests.
 * Allows tests to exercise all three known-error branches and the null/LLM path
 * without spinning up any real services.
 */
export { buildDirectNotification as _buildDirectNotificationForTest };

/** Clears the consecutive-failure streak map so tests start from a clean state. */
export function _resetConsecutiveFailuresForTest(): void {
  consecutiveFailures.clear();
}

/** Clears the system-ping result cache so tests can observe re-execution. */
export function _resetSystemPingCacheForTest(): void {
  systemPingCache.clear();
}

/** Clears the duplicate-alert rate-limit map so tests start from a clean state. */
export function _resetLastDebugTriggerAtForTest(): void {
  lastDebugTriggerAt.clear();
}

/**
 * Directly sets a timestamp in the duplicate-alert rate-limit map.
 * Use this in tests to simulate an expired cooldown without actually waiting an hour.
 * Pass `Date.now() - DEBUG_TRIGGER_COOLDOWN_MS - 1` to simulate just-expired.
 */
export function _setLastDebugTriggerAtForTest(key: string, timestamp: number): void {
  lastDebugTriggerAt.set(key, timestamp);
}

/** Exposes the cooldown constant so tests can compute expired timestamps precisely. */
export const _DEBUG_TRIGGER_COOLDOWN_MS_FOR_TEST = DEBUG_TRIGGER_COOLDOWN_MS;

/**
 * Re-exports checkSystemCredential for test assertions.
 * Allows tests to call checkSystemCredential with an injected ping function and
 * observe caching/no-caching behaviour without any real network calls.
 */
export { checkSystemCredential as _checkSystemCredentialForTest };

/**
 * Injectable-dependency shape for _applyCircuitBreakerForTest.
 * Tests supply minimal stubs for writeStatus, notifyUser, and the two alert
 * paths so that no real DB or notification calls are made.
 */
export interface _CircuitBreakerDeps {
  writeStatus: (
    userId: string,
    integration: IntegrationName,
    result: CheckResult,
  ) => Promise<void>;
  notifyUser: (userId: string, type: string, message: string) => Promise<void>;
  diagEmit: (opts: object) => Promise<void>;
  logSystemError: (opts: object) => Promise<string | null>;
  triggerAutoDebugSession: (opts: AutoDebugOptions) => Promise<void>;
}

/**
 * Runs the circuit-breaker logic for a single integration check with fully
 * injectable side-effect dependencies.  This mirrors the inner map-callback
 * inside validateUserIntegrations but is decoupled from the real DB, notifyUser,
 * diagEmit, and auto-debug wiring so it can be exercised in pure unit tests.
 */
export async function _applyCircuitBreakerForTest(
  userId: string,
  integration: IntegrationName,
  checkResult: CheckResult,
  deps: _CircuitBreakerDeps,
): Promise<void> {
  const failureKey = `${integration}:${userId}`;

  if (checkResult.status !== "broken") {
    consecutiveFailures.delete(failureKey);
    await deps.writeStatus(userId, integration, checkResult);
    return;
  }

  const streak = (consecutiveFailures.get(failureKey) ?? 0) + 1;
  consecutiveFailures.set(failureKey, streak);
  const errMsg = checkResult.errorMessage ?? "unknown error";

  if (streak < 2) {
    await deps.writeStatus(userId, integration, { status: "degraded", errorMessage: errMsg });
    return;
  }

  await deps.writeStatus(userId, integration, checkResult);
  await deps.diagEmit({
    userId,
    subsystem: "integration",
    severity: "error",
    message: `Integration ${integration} broken: ${errMsg}`,
    metadata: { integration },
  });

  const errorLogId = await deps.logSystemError({
    source: `integrationValidator/${integration}`,
    message: `Health check failure: ${errMsg}`,
    level: "error",
    context: { integration, userId, status: checkResult.status },
    userId,
  });

  const rateKey = `${integration}:${userId}`;
  const last = lastDebugTriggerAt.get(rateKey) ?? 0;
  if (Date.now() - last > DEBUG_TRIGGER_COOLDOWN_MS) {
    lastDebugTriggerAt.set(rateKey, Date.now());

    const directMsg = buildDirectNotification(integration, errMsg);
    if (directMsg) {
      await deps.notifyUser(
        userId,
        "approval_request",
        `Jarvis (integration alert): ${integration} disconnected\n\n${directMsg}`,
      );
    } else {
      await deps.triggerAutoDebugSession({
        userId,
        capability: integration,
        errorMessage: errMsg,
        source: `integrationValidator/${integration}`,
        errorLogId: errorLogId ?? undefined,
      });
    }
  }
}

/**
 * Mirrors the catch-block inside validateUserIntegrations with fully injectable
 * side-effect dependencies.  Call this in tests instead of exercising the real
 * catch block directly (which pulls in live DB and notification wiring).
 *
 * Pass `thrownError` as the value that the check() function would have thrown —
 * it may be any type, mirroring the production `catch (err)` which handles both
 * `Error` instances and primitive throws via `String(err)`.
 *
 * IMPORTANT: This function must remain behaviorally identical to the catch block
 * inside validateUserIntegrations.  Whenever the production catch block changes,
 * update this helper to match.
 *
 * The function applies the same crash circuit-breaker logic as the catch block:
 *   streak=1 → "degraded", no alert
 *   streak≥2 → "broken", cooldown-gated triggerAutoDebugSession
 */
export async function _applyCircuitBreakerCrashForTest(
  userId: string,
  integration: IntegrationName,
  thrownError: unknown,
  deps: _CircuitBreakerDeps,
): Promise<void> {
  const failureKey = `${integration}:${userId}`;
  const errMsg = `Validator crashed: ${thrownError instanceof Error ? thrownError.message : String(thrownError)}`;

  const streak = (consecutiveFailures.get(failureKey) ?? 0) + 1;
  consecutiveFailures.set(failureKey, streak);

  if (streak < 2) {
    await deps.writeStatus(userId, integration, { status: "degraded", errorMessage: errMsg });
    return;
  }

  await deps.writeStatus(userId, integration, { status: "broken", errorMessage: errMsg });
  await deps.diagEmit({
    userId,
    subsystem: "integration",
    severity: "error",
    message: `Integration ${integration} validator crashed: ${errMsg.slice(0, 200)}`,
    metadata: { integration },
  });

  await deps.logSystemError({
    source: `integrationValidator/${integration}`,
    message: errMsg,
    level: "error",
    context: { integration, userId },
    userId,
  });

  const rateKey = `${integration}:${userId}`;
  const last = lastDebugTriggerAt.get(rateKey) ?? 0;
  if (Date.now() - last > DEBUG_TRIGGER_COOLDOWN_MS) {
    lastDebugTriggerAt.set(rateKey, Date.now());
    await deps.triggerAutoDebugSession({
      userId,
      capability: integration,
      errorMessage: errMsg,
      source: `integrationValidator/${integration}`,
    });
  }
}
