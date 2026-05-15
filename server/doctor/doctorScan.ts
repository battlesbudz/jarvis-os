/**
 * Jarvis Doctor — Configuration Health Scan
 *
 * Runs a battery of named checks in parallel and returns categorised results.
 * Each check is independently try/caught so one failure never blocks others.
 * Results carry a settingsPath so the UI can deep-link to the fix.
 *
 * Two scan modes:
 *   runDoctorScan(userId) — full scan including per-user integration checks
 *   runSystemScan()       — system-only checks (no user data), used at startup
 */

import { db } from "../db";
import { eq, and, lt, isNotNull, gt } from "drizzle-orm";
import * as schema from "@shared/schema";
import https from "https";
import http from "http";
import {
  getProviderEnvValue,
  hasAnyRoutableProvider,
  hasCodexOAuthProvider,
  hasDirectOpenAIProvider,
  hasNonOpenAIRoutableProvider,
} from "../agent/providers/env";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorResult {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  settingsPath?: string;
}

export interface DoctorReport {
  results: DoctorResult[];
  ranAt: string;
  summary: { pass: number; warn: number; fail: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(id: string, label: string, message: string): DoctorResult {
  return { id, label, status: "pass", message };
}

function warn(id: string, label: string, message: string, settingsPath?: string): DoctorResult {
  return { id, label, status: "warn", message, settingsPath };
}

function fail(id: string, label: string, message: string, settingsPath?: string): DoctorResult {
  return { id, label, status: "fail", message, settingsPath };
}

interface HttpGetResult {
  statusCode: number;
  ok: boolean;
  networkError: boolean;
}

async function httpsGet(
  url: string,
  timeoutMs = 5000,
  headers?: Record<string, string>
): Promise<HttpGetResult> {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs, headers }, (res) => {
      res.resume();
      resolve({
        statusCode: res.statusCode ?? 0,
        ok: (res.statusCode ?? 0) < 500,
        networkError: false,
      });
    });
    req.on("error", () => resolve({ statusCode: 0, ok: false, networkError: true }));
    req.on("timeout", () => { req.destroy(); resolve({ statusCode: 0, ok: false, networkError: true }); });
  });
}

// ── System-level Checks (no user data) ────────────────────────────────────────

async function checkDatabaseConnectivity(): Promise<DoctorResult> {
  const id = "database_connectivity";
  const label = "Database Connectivity";
  try {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    return pass(id, label, "Database is reachable and responding.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(id, label, `Database unreachable: ${msg}`);
  }
}

async function checkLlmKeyValidity(): Promise<DoctorResult> {
  const id = "llm_key_validity";
  const label = "AI Provider";
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com";
  const settingsPath = "/(tabs)/settings";

  if (hasCodexOAuthProvider()) {
    return pass(id, label, "ChatGPT/Codex OAuth provider is configured for local gateway model calls.");
  }

  if (!hasDirectOpenAIProvider() && hasNonOpenAIRoutableProvider()) {
    const providerLabel = getProviderEnvValue("OPENROUTER_API_KEY", "AI_INTEGRATIONS_OPENROUTER_API_KEY")
      ? "OpenRouter"
      : getProviderEnvValue("GROQ_API_KEY", "AI_INTEGRATIONS_GROQ_API_KEY")
        ? "Groq"
        : getProviderEnvValue("AI_INTEGRATIONS_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")
          ? "Anthropic"
          : "non-OpenAI";
    return pass(id, label, `${providerLabel} model provider is configured.`);
  }

  if (!apiKey) {
    return fail(id, label, "No AI model provider is configured.", settingsPath);
  }

  try {
    const url = new URL("/v1/models", baseUrl);
    const result = await httpsGet(url.toString(), 8000, { Authorization: `Bearer ${apiKey}` });

    if (result.networkError) return warn(id, label, "Could not reach OpenAI API — network issue or CA drift.");
    if (result.statusCode === 200) return pass(id, label, "OpenAI API key is valid and responding.");
    if (result.statusCode === 401) return fail(id, label, "OpenAI API key is invalid or revoked.", settingsPath);
    if (result.statusCode === 429) return warn(id, label, "OpenAI API key is valid but rate-limited.");
    return warn(id, label, `OpenAI responded with HTTP ${result.statusCode}.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return warn(id, label, `Could not validate OpenAI key: ${msg}`);
  }
}

async function checkAnthropicKeyPresence(): Promise<DoctorResult> {
  const id = "anthropic_key_presence";
  const label = "Anthropic API Key";
  const key = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const settingsPath = "/(tabs)/settings";

  if (!key) {
    return warn(id, label, "Anthropic API key is not set — orchestrator mode will be unavailable.", settingsPath);
  }

  // When Replit AI Integrations is active it injects both env vars:
  //   AI_INTEGRATIONS_ANTHROPIC_API_KEY  — a dummy key for SDK compatibility
  //   AI_INTEGRATIONS_ANTHROPIC_BASE_URL — the proxy URL that authenticates calls
  // The dummy key is intentionally invalid against api.anthropic.com; direct HTTP
  // checks against that endpoint always return 401 even when the integration works.
  // Presence of both vars is the correct indicator that the integration is wired.
  // Runtime validation (actual API call) is handled by the ProviderHealth startup
  // check which smoke-tests ClaudeProvider at every boot.
  if (baseUrl) {
    return pass(id, label, "Anthropic integration is active — API key and proxy URL are both configured.");
  }

  // Direct (non-proxy) API key path: validate against api.anthropic.com.
  try {
    const result = await httpsGet(
      "https://api.anthropic.com/v1/models",
      8000,
      { "x-api-key": key, "anthropic-version": "2023-06-01" }
    );
    if (result.networkError) return warn(id, label, "Could not reach Anthropic API — network issue or CA drift.", settingsPath);
    if (result.statusCode === 200) return pass(id, label, "Anthropic API key is valid and responding.");
    if (result.statusCode === 401) return fail(id, label, "Anthropic API key is invalid or revoked.", settingsPath);
    if (result.statusCode === 429) return warn(id, label, "Anthropic API key is valid but rate-limited.");
    return warn(id, label, `Anthropic API responded with HTTP ${result.statusCode}.`, settingsPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return warn(id, label, `Could not validate Anthropic key: ${msg}`, settingsPath);
  }
}

async function checkOutboundHttps(): Promise<DoctorResult> {
  const id = "outbound_https";
  const label = "Outbound HTTPS / CA Store";
  try {
    const result = await httpsGet("https://www.google.com", 6000);
    if (result.networkError) {
      return fail(id, label, "Cannot reach external HTTPS endpoints — possible CA store drift or network restriction. Check nvm CA configuration.");
    }
    if (result.ok) {
      return pass(id, label, "Outbound HTTPS connectivity is working.");
    }
    return warn(id, label, `Outbound HTTPS reached Google but got HTTP ${result.statusCode} — network is accessible but may be restricted.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(id, label, `Outbound HTTPS check threw unexpectedly: ${msg}`);
  }
}

async function checkEnvVarsPresence(): Promise<DoctorResult> {
  const id = "env_vars_presence";
  const label = "Required Environment Variables";
  const settingsPath = "/(tabs)/settings";

  // Tier-1: absence = hard failure (system cannot operate without these)
  const missingCritical = ["DATABASE_URL"].filter((k) => !process.env[k]);
  if (!hasAnyRoutableProvider()) missingCritical.push("AI model provider");

  // Tier-2: absence = warning (specific channels/features degrade)
  const important = [
    "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
    "DISCORD_BOT_TOKEN",
    "TELEGRAM_BOT_TOKEN",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "GOOGLE_WEB_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "SUPADATA_API_KEY",
  ];

  const missingImportant = important.filter((k) => !process.env[k]);

  if (missingCritical.length > 0) {
    return fail(id, label, `Critical env vars missing: ${missingCritical.join(", ")}.`, settingsPath);
  }
  if (missingImportant.length === important.length) {
    return warn(id, label, `No optional channel/integration env vars are set — all channels will be unconfigured.`, settingsPath);
  }
  if (missingImportant.length > 0) {
    return warn(id, label, `Some integration env vars are not set: ${missingImportant.join(", ")}.`, settingsPath);
  }
  return pass(id, label, "All required and integration environment variables are present.");
}

async function checkTelegramWebhook(): Promise<DoctorResult> {
  const id = "telegram_webhook";
  const label = "Telegram Bot Reachability";
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const settingsPath = "/(tabs)/settings?scrollTo=telegram";

  if (!token) {
    return warn(id, label, "TELEGRAM_BOT_TOKEN is not set — Telegram channel is not configured.", settingsPath);
  }

  try {
    const result = await httpsGet(`https://api.telegram.org/bot${token}/getMe`, 6000);
    if (result.networkError) return warn(id, label, "Could not reach Telegram API — network issue may be present.", settingsPath);
    if (result.statusCode === 200) return pass(id, label, "Telegram bot API is reachable and token is valid.");
    if (result.statusCode === 401) return fail(id, label, "Telegram bot token is invalid or revoked.", settingsPath);
    return warn(id, label, `Telegram API returned HTTP ${result.statusCode}.`, settingsPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return warn(id, label, `Telegram webhook check threw: ${msg}`, settingsPath);
  }
}

async function checkDiscordBotToken(): Promise<DoctorResult> {
  const id = "discord_bot_token";
  const label = "Discord Bot Reachability";
  const token = process.env.DISCORD_BOT_TOKEN;
  const settingsPath = "/(tabs)/settings?scrollTo=discord";

  if (!token) {
    return warn(id, label, "DISCORD_BOT_TOKEN is not set — shared Discord bot is not configured.", settingsPath);
  }

  try {
    const result = await httpsGet(
      "https://discord.com/api/v10/users/@me",
      6000,
      { Authorization: `Bot ${token}` }
    );
    if (result.networkError) return warn(id, label, "Could not reach Discord API — network issue may be present.", settingsPath);
    if (result.statusCode === 200) return pass(id, label, "Discord bot token is valid and API is reachable.");
    if (result.statusCode === 401) return fail(id, label, "Discord bot token is invalid or revoked.", settingsPath);
    return warn(id, label, `Discord API returned HTTP ${result.statusCode}.`, settingsPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return warn(id, label, `Discord check threw: ${msg}`, settingsPath);
  }
}

async function checkWhatsAppReachability(): Promise<DoctorResult> {
  const id = "whatsapp_channel";
  const label = "WhatsApp Channel (Twilio) Reachability";
  const settingsPath = "/(tabs)/settings?scrollTo=whatsapp";

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !phoneNumber) {
    return warn(
      id,
      label,
      "Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) are not set — WhatsApp channel is not configured.",
      settingsPath
    );
  }

  try {
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const result = await httpsGet(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      8000,
      { Authorization: `Basic ${basicAuth}` }
    );

    if (result.networkError) return warn(id, label, "Could not reach Twilio API — network issue may be present.", settingsPath);
    if (result.statusCode === 200) return pass(id, label, "Twilio credentials are valid and WhatsApp channel is reachable.");
    if (result.statusCode === 401) return fail(id, label, "Twilio credentials are invalid or revoked.", settingsPath);
    if (result.statusCode === 404) return fail(id, label, "Twilio Account SID not found — check TWILIO_ACCOUNT_SID.", settingsPath);
    return warn(id, label, `Twilio API returned HTTP ${result.statusCode}.`, settingsPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return warn(id, label, `WhatsApp reachability check threw: ${msg}`, settingsPath);
  }
}

async function checkMcpEndpointAuth(): Promise<DoctorResult> {
  const id = "mcp_endpoint_auth";
  const label = "MCP Endpoint Authentication";

  const port = parseInt(process.env.PORT ?? "5000", 10);

  return new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: {} });
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path: "/api/mcp",
      method: "POST",
      timeout: 5000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      res.resume();
      const code = res.statusCode ?? 0;
      if (code === 401 || code === 403) {
        resolve(pass(id, label, "MCP endpoint correctly rejects unauthenticated requests."));
      } else if (code === 200 || code === 202) {
        resolve(fail(id, label, "MCP endpoint accepted a request with no Authorization header — endpoint may be unauthenticated.", "/(tabs)/settings"));
      } else if (code === 404) {
        resolve(warn(id, label, "MCP endpoint returned 404 — path may be misconfigured or MCP is not enabled.", "/(tabs)/settings"));
      } else if (code >= 500) {
        resolve(warn(id, label, `MCP endpoint returned HTTP ${code} — server-side error; auth posture cannot be confirmed.`, "/(tabs)/settings"));
      } else {
        resolve(warn(id, label, `MCP endpoint returned HTTP ${code} — unexpected status; verify MCP is configured correctly.`, "/(tabs)/settings"));
      }
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        resolve(warn(id, label, "Could not connect to local MCP endpoint — server may still be starting."));
      } else {
        resolve(warn(id, label, `MCP auth check failed: ${err.message}`));
      }
    });

    req.on("timeout", () => {
      req.destroy();
      resolve(warn(id, label, "MCP auth check timed out."));
    });

    req.write(body);
    req.end();
  });
}

// ── Per-user Checks ────────────────────────────────────────────────────────────

async function checkUserIntegrationCredentials(userId: string): Promise<DoctorResult> {
  const id = "integration_credentials";
  const label = "Integration Credentials";
  try {
    const rows = await db
      .select({ integration: schema.integrationStatus.integration, status: schema.integrationStatus.status })
      .from(schema.integrationStatus)
      .where(eq(schema.integrationStatus.userId, userId));

    if (rows.length === 0) {
      return warn(id, label, "No integrations have been configured yet.", "/(tabs)/settings");
    }

    const broken = rows.filter((r) => r.status === "broken").map((r) => r.integration);
    const unconfigured = rows.filter((r) => r.status === "unconfigured").map((r) => r.integration);
    const healthy = rows.filter((r) => r.status === "healthy" || r.status === "expiring_soon").length;

    if (broken.length > 0) {
      const firstBroken = broken[0];
      return fail(
        id,
        label,
        `${broken.length} integration(s) have broken credentials: ${broken.join(", ")}.`,
        `/(tabs)/settings?scrollTo=${firstBroken}`
      );
    }

    if (unconfigured.length > 0 && healthy === 0) {
      return warn(
        id,
        label,
        `${unconfigured.length} integration(s) are present but not yet configured: ${unconfigured.join(", ")}.`,
        "/(tabs)/settings"
      );
    }

    if (unconfigured.length > 0) {
      const firstUnconfigured = unconfigured[0];
      return warn(
        id,
        label,
        `${healthy} integration(s) are healthy, but ${unconfigured.length} are still unconfigured: ${unconfigured.join(", ")}.`,
        `/(tabs)/settings?scrollTo=${firstUnconfigured}`
      );
    }

    return pass(id, label, `All ${healthy} configured integration(s) have valid credentials.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return warn(id, label, `Could not check integration credentials: ${msg}`);
  }
}

async function checkUserOAuthTokenExpiry(userId: string): Promise<DoctorResult> {
  const id = "oauth_token_expiry";
  const label = "OAuth Token Expiry";
  try {
    // Warn for tokens expiring within the next 7 days; check expiresAt directly.
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    const expiringSoon = await db
      .select({ integration: schema.integrationStatus.integration, expiresAt: schema.integrationStatus.expiresAt })
      .from(schema.integrationStatus)
      .where(
        and(
          eq(schema.integrationStatus.userId, userId),
          isNotNull(schema.integrationStatus.expiresAt),
          gt(schema.integrationStatus.expiresAt, now),
          lt(schema.integrationStatus.expiresAt, sevenDaysFromNow)
        )
      );

    const alreadyExpired = await db
      .select({ integration: schema.integrationStatus.integration })
      .from(schema.integrationStatus)
      .where(
        and(
          eq(schema.integrationStatus.userId, userId),
          isNotNull(schema.integrationStatus.expiresAt),
          lt(schema.integrationStatus.expiresAt, now)
        )
      );

    if (alreadyExpired.length > 0) {
      const names = alreadyExpired.map((r) => r.integration);
      const firstExpired = names[0];
      return fail(
        id,
        label,
        `${names.length} OAuth token(s) have already expired: ${names.join(", ")}. Reconnect now to restore access.`,
        `/(tabs)/settings?scrollTo=${firstExpired}`
      );
    }

    if (expiringSoon.length === 0) return pass(id, label, "No OAuth tokens are expiring within the next 7 days.");

    const names = expiringSoon.map((r) => r.integration);
    const firstExpiring = names[0];
    return warn(
      id,
      label,
      `${names.length} OAuth token(s) expiring within 7 days: ${names.join(", ")}. Reconnect to avoid disruption.`,
      `/(tabs)/settings?scrollTo=${firstExpiring}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return warn(id, label, `Could not check OAuth token expiry: ${msg}`);
  }
}

// ── Scan Runners ───────────────────────────────────────────────────────────────

const SYSTEM_CHECKS: Array<() => Promise<DoctorResult>> = [
  checkDatabaseConnectivity,
  checkLlmKeyValidity,
  checkAnthropicKeyPresence,
  checkOutboundHttps,
  checkEnvVarsPresence,
  checkTelegramWebhook,
  checkDiscordBotToken,
  checkWhatsAppReachability,
  checkMcpEndpointAuth,
];

/**
 * Full scan for an authenticated user.
 * Includes system checks + per-user integration state checks.
 */
export async function runDoctorScan(userId: string): Promise<DoctorReport> {
  const userChecks: Array<() => Promise<DoctorResult>> = [
    () => checkUserIntegrationCredentials(userId),
    () => checkUserOAuthTokenExpiry(userId),
  ];

  const allChecks = [...SYSTEM_CHECKS, ...userChecks];
  const settled = await Promise.allSettled(allChecks.map((fn) => fn()));

  const results: DoctorResult[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const fn = allChecks[i];
    return {
      id: fn.name || `check_${i}`,
      label: fn.name || `Check ${i + 1}`,
      status: "fail" as DoctorStatus,
      message: `Check threw unexpectedly: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    };
  });

  const summary = results.reduce(
    (acc, r) => { acc[r.status]++; return acc; },
    { pass: 0, warn: 0, fail: 0 }
  );

  return { results, ranAt: new Date().toISOString(), summary };
}

/**
 * System-only scan — no user-scoped data.
 * Used at startup so results can be logged without leaking per-user state.
 */
export async function runSystemScan(): Promise<DoctorReport> {
  const settled = await Promise.allSettled(SYSTEM_CHECKS.map((fn) => fn()));

  const results: DoctorResult[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const fn = SYSTEM_CHECKS[i];
    return {
      id: fn.name || `check_${i}`,
      label: fn.name || `Check ${i + 1}`,
      status: "fail" as DoctorStatus,
      message: `Check threw unexpectedly: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    };
  });

  const summary = results.reduce(
    (acc, r) => { acc[r.status]++; return acc; },
    { pass: 0, warn: 0, fail: 0 }
  );

  return { results, ranAt: new Date().toISOString(), summary };
}
