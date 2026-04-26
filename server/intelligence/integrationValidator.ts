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

const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000; // 24 hours

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
    const row = (rows as any).rows?.[0] ?? (Array.isArray(rows) ? rows[0] : null);
    if (!row) return { status: "unconfigured" };

    const expiresAt: Date | null = row.expires_at ? new Date(row.expires_at) : null;
    const now = Date.now();

    if (expiresAt) {
      if (expiresAt.getTime() < now) {
        // Expired — validator is read-only; report broken so UI shows reconnect CTA.
        // Token refresh is handled by the OAuth routes on the next user-initiated action.
        return {
          status: "broken",
          errorMessage: "Token expired — please reconnect in Settings",
          expiresAt,
        };
      }

      if (expiresAt.getTime() < now + EXPIRY_WARNING_MS) {
        return { status: "expiring_soon", expiresAt };
      }
    }

    // Token exists and not expired — do a cheap connectivity ping
    const healthy = await pingOAuthProvider(provider, row.access_token as string);
    if (!healthy.ok) {
      return {
        status: "broken",
        errorMessage: healthy.error ?? "API ping failed — token may be revoked",
        expiresAt: expiresAt ?? undefined,
      };
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
      const res = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.ok) return { ok: true };
      const body = await res.json() as any;
      return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` };
    }

    if (provider === "microsoft") {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) return { ok: true };
      const body = await res.json() as any;
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
  systemPingCache.set(key, { ok, checkedAt: Date.now() });
  return ok;
}

async function pingTelegramBot(): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = await res.json() as any;
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
    const body = await res.json() as any;
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
    const body = await res.json() as any;
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
    // Step 1: verify system bot token is valid (getMe ping)
    const botOk = await checkSystemCredential("telegram_bot", pingTelegramBot);
    if (!botOk) {
      return { status: "broken", errorMessage: "Telegram bot token missing or invalid" };
    }
    // Step 2: verify webhook (or polling) is healthy — no recent delivery errors
    const webhookOk = await checkSystemCredential("telegram_webhook", checkTelegramWebhookState);
    if (!webhookOk) {
      return { status: "broken", errorMessage: "Telegram webhook has recent delivery errors" };
    }
    // Step 3: verify user has linked their account
    const rows = await db
      .select({ chatId: schema.telegramLinks.chatId })
      .from(schema.telegramLinks)
      .where(eq(schema.telegramLinks.userId, userId))
      .limit(1);
    return rows.length > 0 ? { status: "healthy" } : { status: "unconfigured" };
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
    const guilds = await res.json() as any[];
    return Array.isArray(guilds) && guilds.length > 0;
  } catch { return false; }
}

async function checkDiscord(userId: string): Promise<CheckResult> {
  try {
    // Step 1: verify system Discord bot token is valid
    const botOk = await checkSystemCredential("discord_bot", pingDiscordBot);
    if (!botOk) {
      return { status: "broken", errorMessage: "Discord bot token missing or invalid" };
    }
    // Step 2: verify bot has guild membership (i.e. has been added with correct permissions)
    const inGuild = await checkSystemCredential("discord_guilds", pingDiscordBotGuilds);
    if (!inGuild) {
      return { status: "broken", errorMessage: "Discord bot has no guild access — bot may lack required permissions" };
    }
    // Step 3: check user-level link
    const rows = await db
      .select({ id: schema.channelLinks.id })
      .from(schema.channelLinks)
      .where(and(
        eq(schema.channelLinks.userId, userId),
        eq(schema.channelLinks.channel, "discord"),
      ))
      .limit(1);
    return rows.length > 0 ? { status: "healthy" } : { status: "unconfigured" };
  } catch {
    return { status: "unconfigured" };
  }
}

async function checkSlack(userId: string): Promise<CheckResult> {
  try {
    const tokenOk = await checkSystemCredential("slack_token", pingSlack);
    if (!tokenOk) {
      // Slack may also use per-workspace OAuth stored in channel_links — check that
      const rows = await db
        .select({ id: schema.channelLinks.id })
        .from(schema.channelLinks)
        .where(and(
          eq(schema.channelLinks.userId, userId),
          eq(schema.channelLinks.channel, "slack"),
        ))
        .limit(1);
      if (rows.length === 0) return { status: "unconfigured" };
      // Linked but system token invalid → broken
      return { status: "broken", errorMessage: "Slack workspace token missing or invalid" };
    }
    const rows = await db
      .select({ id: schema.channelLinks.id })
      .from(schema.channelLinks)
      .where(and(
        eq(schema.channelLinks.userId, userId),
        eq(schema.channelLinks.channel, "slack"),
      ))
      .limit(1);
    return rows.length > 0 ? { status: "healthy" } : { status: "unconfigured" };
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
      try {
        const result = await check();
        await writeStatus(userId, integration, result);
      } catch (err) {
        console.error(`[IntegrationValidator] ${integration} check failed for ${userId}:`, err);
        await writeStatus(userId, integration, {
          status: "broken",
          errorMessage: `Validator crashed: ${err instanceof Error ? err.message : String(err)}`,
        }).catch(() => {});
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
    const items = (rows as any).rows ?? (Array.isArray(rows) ? rows : []);
    return items.map((r: any) => String(r.id));
  } catch {
    return [];
  }
}

let running = false;

async function runValidationCycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
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

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function startIntegrationValidator(): void {
  // Delay first run by 10 seconds to let DB connections warm up on boot
  setTimeout(() => {
    runValidationCycle().catch((err) =>
      console.error("[IntegrationValidator] initial run failed:", err),
    );
  }, 10_000);

  setInterval(() => {
    runValidationCycle().catch((err) =>
      console.error("[IntegrationValidator] scheduled run failed:", err),
    );
  }, INTERVAL_MS);

  console.log("[IntegrationValidator] started — runs every 30 min");
}
