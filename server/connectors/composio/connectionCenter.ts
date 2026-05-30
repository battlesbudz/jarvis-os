import { createHmac, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";

export const COMPOSIO_CONNECTION_PLATFORMS = [
  "gmail",
  "google-calendar",
  "outlook-mail",
  "outlook-calendar",
  "slack",
  "google-drive",
  "google-tasks",
] as const;

export type ComposioConnectionPlatform = typeof COMPOSIO_CONNECTION_PLATFORMS[number];

export type ComposioConnection = {
  id?: string;
  platform: ComposioConnectionPlatform;
  toolkit: string;
  label: string;
  accountEmail: string | null;
  accountName: string | null;
  state: string;
  ready: boolean;
};

export type ComposioConnectionStatus = {
  provider: "composio";
  configured: boolean;
  ready: boolean;
  dashboardUrl: string;
  connections: ComposioConnection[];
  platforms: {
    platform: ComposioConnectionPlatform;
    toolkit: string;
    label: string;
    ready: boolean;
    connectionId: string | null;
    state: string;
  }[];
  nextSteps: string[];
  error: string | null;
};

export type ComposioConnectIntent = {
  provider: "composio";
  platform: ComposioConnectionPlatform;
  toolkit: string;
  label: string;
  redirectUrl: string | null;
  connectionRequestId: string | null;
  buttonLabel: string;
  setupInstructions: string[];
  error: string | null;
};

export type ComposioActionPermission = {
  level: "read" | "proposal" | "write";
  approvalRequired: boolean;
  reason: string;
};

export type ComposioClientLike = {
  create?(userId: string, config?: Record<string, unknown>): Promise<any>;
  connectedAccounts?: {
    link(userId: string, authConfigId: string, options: { callbackUrl: string }): Promise<any>;
    list(query?: Record<string, unknown>): Promise<any>;
    delete(id: string): Promise<any>;
  };
  tools?: {
    get(userIdOrToolSlug: string, queryOrPayload?: any): Promise<any>;
    execute?(toolSlug: string, payload?: any): Promise<any>;
  };
};

export type ComposioFetchDeps = {
  client?: ComposioClientLike;
  store?: ComposioAccountStore;
};

export type StoredComposioAccount = {
  userId: string;
  toolkit: string;
  authConfigId: string;
  connectedAccountId: string;
  status: string;
  accountEmail?: string | null;
  accountName?: string | null;
  metadata?: Record<string, unknown>;
  updatedAt?: Date;
};

export type ComposioAccountStore = {
  list(userId: string, filters?: { toolkit?: string; connectedAccountId?: string }): Promise<StoredComposioAccount[]>;
  upsert(account: StoredComposioAccount): Promise<StoredComposioAccount>;
  delete(userId: string, filters?: { toolkit?: string; connectedAccountId?: string }): Promise<number>;
};

const PLATFORM_META: Record<ComposioConnectionPlatform, { toolkit: string; label: string }> = {
  gmail: { toolkit: "gmail", label: "Gmail" },
  "google-calendar": { toolkit: "googlecalendar", label: "Google Calendar" },
  "outlook-mail": { toolkit: "outlook", label: "Outlook Mail" },
  "outlook-calendar": { toolkit: "outlook", label: "Outlook Calendar" },
  slack: { toolkit: "slack", label: "Slack" },
  "google-drive": { toolkit: "googledrive", label: "Google Drive" },
  "google-tasks": { toolkit: "googletasks", label: "Google Tasks" },
};

type ComposioEnv = Record<string, string | undefined>;
type ComposioConstructor = new (config: Record<string, unknown>) => unknown;

const requireComposio = createRequire(import.meta.url);

function callbackSecret(env: ComposioEnv = process.env): string {
  return env.COMPOSIO_CALLBACK_STATE_SECRET || env.JWT_SECRET || env.COMPOSIO_API_KEY || "jarvis-composio-callback-dev";
}

function authConfigEnvName(toolkit: string): string {
  return `COMPOSIO_${toolkit.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_AUTH_CONFIG_ID`;
}

export function getComposioAuthConfigId(toolkit: string, env: ComposioEnv = process.env): string | null {
  return env[authConfigEnvName(toolkit)]?.trim() || null;
}

export function signComposioCallbackState(
  state: { userId: string; toolkit: string },
  env: ComposioEnv = process.env,
): string {
  const payload = Buffer.from(JSON.stringify({ userId: state.userId, toolkit: state.toolkit }), "utf8").toString("base64url");
  const signature = createHmac("sha256", callbackSecret(env)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyComposioCallbackState(value: string, env: ComposioEnv = process.env): { userId: string; toolkit: string } | null {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", callbackSecret(env)).update(payload).digest("base64url");
  const actual = Buffer.from(signature);
  const target = Buffer.from(expected);
  if (actual.length !== target.length || !timingSafeEqual(actual, target)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const userId = String(parsed.userId || "").trim();
    const toolkit = String(parsed.toolkit || "").trim();
    return userId && toolkit ? { userId, toolkit } : null;
  } catch {
    return null;
  }
}

const RISKY_ACTION_WORDS = [
  "send",
  "delete",
  "remove",
  "trash",
  "post",
  "publish",
  "update",
  "patch",
  "modify",
  "write",
  "create_event",
  "createevent",
  "quick_add",
  "invite",
  "archive",
  "move",
  "clear",
];

const PROPOSAL_ACTION_WORDS = ["draft", "create", "insert", "compose", "proposal", "upload"];
const READ_ACTION_WORDS = ["get", "list", "read", "search", "find", "fetch", "lookup", "query", "free_busy"];

export function isComposioConnectionPlatform(value: string): value is ComposioConnectionPlatform {
  return (COMPOSIO_CONNECTION_PLATFORMS as readonly string[]).includes(value);
}

export function getComposioPlatformMeta(platform: ComposioConnectionPlatform) {
  return PLATFORM_META[platform];
}

export function toolkitForPlatform(platform: string): string {
  if (isComposioConnectionPlatform(platform)) return PLATFORM_META[platform].toolkit;
  return platform.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function platformForToolkit(toolkit: string): ComposioConnectionPlatform | null {
  const normalized = toolkit.trim().toLowerCase();
  for (const [platform, meta] of Object.entries(PLATFORM_META)) {
    if (meta.toolkit === normalized) return platform as ComposioConnectionPlatform;
  }
  return null;
}

export function getComposioDashboardUrl(): string {
  return process.env.COMPOSIO_DASHBOARD_URL || "https://dashboard.composio.dev";
}

export function getComposioCallbackUrl(
  req?: { protocol?: string; get?: (name: string) => string | undefined },
  state?: { userId: string; toolkit: string },
): string | undefined {
  const base = process.env.COMPOSIO_CALLBACK_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_URL;
  const path = "/api/connections/callback";
  const withState = (raw: string) => {
    if (!state) return raw;
    const url = new URL(raw);
    url.searchParams.set("state", signComposioCallbackState(state));
    return url.toString();
  };
  if (base) return withState(`${base.replace(/\/+$/, "")}${path}`);
  if (process.env.COMPOSIO_CALLBACK_URL) return withState(process.env.COMPOSIO_CALLBACK_URL);
  const host = req?.get?.("host");
  if (host) return withState(`${req?.protocol || "https"}://${host}${path}`);
  return undefined;
}

export function isComposioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

export function createComposioClient(): ComposioClientLike {
  let Composio: ComposioConstructor;
  try {
    const sdk = requireComposio("@composio/core") as {
      Composio?: ComposioConstructor;
      default?: ComposioConstructor | { Composio?: ComposioConstructor };
    };
    const defaultExport = sdk.default;
    Composio = sdk.Composio
      ?? (typeof defaultExport === "function" ? defaultExport : defaultExport?.Composio);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Composio SDK is unavailable. Install dependencies or add @composio/core. Details: ${message}`);
  }
  if (!Composio) {
    throw new Error("Composio SDK is unavailable. @composio/core did not export a Composio client.");
  }
  return new Composio({
    apiKey: process.env.COMPOSIO_API_KEY,
    allowTracking: false,
    dangerouslyAllowAutoUploadDownloadFiles: false,
  }) as unknown as ComposioClientLike;
}

export function createComposioSessionConfig(toolkits?: string[]): Record<string, unknown> {
  const enabled = toolkits?.length ? toolkits : Object.values(PLATFORM_META).map((meta) => meta.toolkit);
  return {
    toolkits: enabled,
    manageConnections: false,
  };
}

function getClient(deps?: ComposioFetchDeps): ComposioClientLike {
  if (deps?.client) return deps.client;
  if (!isComposioConfigured()) {
    throw new Error("COMPOSIO_API_KEY is not configured.");
  }
  return createComposioClient();
}

function normalizeState(value: unknown): string {
  return String(value || "unknown").toLowerCase();
}

function isReadyState(state: string): boolean {
  return state === "active" || state === "connected" || state === "ready" || state === "operational";
}

function accountIdentity(value: Record<string, unknown>): { email: string | null; name: string | null } {
  const email = String(value.accountEmail || value.email || value.account_email || value.name || "").trim();
  const name = String(value.accountName || value.account_name || value.label || "").trim();
  return { email: email || null, name: name || null };
}

function firstArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function rowsFromDbResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && Array.isArray((result as any).rows)) return (result as any).rows;
  return [];
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("access_token") ||
      lower.includes("refresh_token") ||
      lower === "token" ||
      lower.endsWith("_token") ||
      lower.includes("secret") ||
      lower.includes("api_key")
    ) continue;
    if (Array.isArray(raw)) output[key] = raw.map((item) => sanitizeMetadata(item));
    else if (raw && typeof raw === "object") output[key] = sanitizeMetadata(raw);
    else output[key] = raw;
  }
  return output;
}

function rowToStoredAccount(row: Record<string, unknown>): StoredComposioAccount {
  return {
    userId: String(row.user_id || ""),
    toolkit: String(row.toolkit || ""),
    authConfigId: String(row.auth_config_id || ""),
    connectedAccountId: String(row.connected_account_id || ""),
    status: String(row.status || "UNKNOWN"),
    accountEmail: row.account_email ? String(row.account_email) : null,
    accountName: row.account_name ? String(row.account_name) : null,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata || "{}") : sanitizeMetadata(row.metadata),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : undefined,
  };
}

export const dbComposioAccountStore: ComposioAccountStore = {
  async list(userId, filters = {}) {
    const { db } = await import("../../db");
    const result = filters.connectedAccountId
      ? await db.execute(sql`
          SELECT * FROM composio_connected_accounts
          WHERE user_id = ${userId} AND connected_account_id = ${filters.connectedAccountId}
          ORDER BY updated_at DESC
        `)
      : filters.toolkit
        ? await db.execute(sql`
            SELECT * FROM composio_connected_accounts
            WHERE user_id = ${userId} AND toolkit = ${filters.toolkit}
            ORDER BY updated_at DESC
          `)
        : await db.execute(sql`
            SELECT * FROM composio_connected_accounts
            WHERE user_id = ${userId}
            ORDER BY updated_at DESC
          `);
    return rowsFromDbResult(result).map(rowToStoredAccount);
  },

  async upsert(account) {
    const { db } = await import("../../db");
    const result = await db.execute(sql`
      INSERT INTO composio_connected_accounts (
        user_id, toolkit, auth_config_id, connected_account_id, status, account_email, account_name, metadata, updated_at
      ) VALUES (
        ${account.userId},
        ${account.toolkit},
        ${account.authConfigId},
        ${account.connectedAccountId},
        ${account.status},
        ${account.accountEmail ?? null},
        ${account.accountName ?? null},
        ${JSON.stringify(account.metadata || {})}::jsonb,
        NOW()
      )
      ON CONFLICT (user_id, connected_account_id) DO UPDATE SET
        toolkit = EXCLUDED.toolkit,
        auth_config_id = EXCLUDED.auth_config_id,
        status = EXCLUDED.status,
        account_email = EXCLUDED.account_email,
        account_name = EXCLUDED.account_name,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *
    `);
    return rowToStoredAccount(rowsFromDbResult(result)[0] || {
      user_id: account.userId,
      toolkit: account.toolkit,
      auth_config_id: account.authConfigId,
      connected_account_id: account.connectedAccountId,
      status: account.status,
      account_email: account.accountEmail,
      account_name: account.accountName,
      metadata: account.metadata || {},
    });
  },

  async delete(userId, filters = {}) {
    const { db } = await import("../../db");
    const result = filters.connectedAccountId
      ? await db.execute(sql`
          DELETE FROM composio_connected_accounts
          WHERE user_id = ${userId} AND connected_account_id = ${filters.connectedAccountId}
          RETURNING connected_account_id
        `)
      : filters.toolkit
        ? await db.execute(sql`
            DELETE FROM composio_connected_accounts
            WHERE user_id = ${userId} AND toolkit = ${filters.toolkit}
            RETURNING connected_account_id
          `)
        : await db.execute(sql`
            DELETE FROM composio_connected_accounts
            WHERE user_id = ${userId}
            RETURNING connected_account_id
          `);
    return rowsFromDbResult(result).length;
  },
};

function accountToolkit(value: Record<string, unknown>): string {
  const toolkit = value.toolkit;
  if (toolkit && typeof toolkit === "object" && !Array.isArray(toolkit)) {
    const slug = (toolkit as Record<string, unknown>).slug;
    if (slug) return String(slug).toLowerCase();
  }
  return String(value.toolkitSlug || value.toolkit_slug || value.appName || value.app_name || value.app || "").toLowerCase();
}

function normalizeAccount(value: unknown): ComposioConnection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const toolkit = accountToolkit(record);
  const platform = platformForToolkit(toolkit);
  if (!platform) return null;
  const state = normalizeState(record.status || record.state);
  const identity = accountIdentity(record);
  return {
    id: String(record.id || record.nanoid || record.connectedAccountId || record.connected_account_id || "").trim() || undefined,
    platform,
    toolkit,
    label: PLATFORM_META[platform].label,
    accountEmail: identity.email,
    accountName: identity.name,
    state,
    ready: isReadyState(state),
  };
}

function normalizeStoredAccount(userId: string, value: unknown, fallbackToolkit = ""): StoredComposioAccount | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const toolkit = accountToolkit(record) || fallbackToolkit;
  const connectedAccountId = String(record.connectedAccountId || record.connected_account_id || record.id || record.nanoid || "").trim();
  if (!connectedAccountId || !toolkit) return null;
  const identity = accountIdentity(record);
  return {
    userId: String(record.userId || record.user_id || userId),
    toolkit,
    authConfigId: String(record.authConfigId || record.auth_config_id || getComposioAuthConfigId(toolkit) || ""),
    connectedAccountId,
    status: String(record.status || record.state || "ACTIVE").toUpperCase(),
    accountEmail: identity.email,
    accountName: identity.name,
    metadata: sanitizeMetadata(record),
  };
}

export function classifyComposioActionPermission(platform: string, toolSlug: string, description = ""): ComposioActionPermission {
  const normalized = [platform, toolSlug, description].join(" ").toLowerCase().replace(/\s+/g, "_");
  if (RISKY_ACTION_WORDS.some((word) => normalized.includes(word))) {
    return {
      level: "write",
      approvalRequired: true,
      reason: "This action can send, delete, post, create, or update an external account.",
    };
  }
  if (PROPOSAL_ACTION_WORDS.some((word) => normalized.includes(word))) {
    return {
      level: "proposal",
      approvalRequired: true,
      reason: "This action creates a draft, file, proposal, or external artifact and needs user approval first.",
    };
  }
  if (READ_ACTION_WORDS.some((word) => normalized.includes(word))) {
    return {
      level: "read",
      approvalRequired: false,
      reason: "Read-only connected-account actions are allowed without an approval gate.",
    };
  }
  return {
    level: "proposal",
    approvalRequired: true,
    reason: "Jarvis could not prove this connected-account action is read-only.",
  };
}

export async function listComposioConnections(userId: string, deps?: ComposioFetchDeps): Promise<ComposioConnection[]> {
  const client = getClient(deps);
  if (client.connectedAccounts?.list) {
    const result = await client.connectedAccounts.list({ userIds: [userId], statuses: ["ACTIVE"] });
    const accounts = firstArray(result, ["items", "data", "connectedAccounts", "connected_accounts", "accounts"]);
    const store = deps?.store || (deps?.client ? null : dbComposioAccountStore);
    if (store) {
      await Promise.all(accounts
        .map((account) => normalizeStoredAccount(userId, account))
        .filter((account): account is StoredComposioAccount => Boolean(account))
        .map((account) => store.upsert(account)));
    }
    const normalized = accounts.map(normalizeAccount).filter(Boolean) as ComposioConnection[];
    if (normalized.length > 0) return normalized;
    if (store) {
      const stored = await store.list(userId);
      return stored.map((account) => {
        const platform = platformForToolkit(account.toolkit);
        if (!platform) return null;
        const state = normalizeState(account.status);
        return {
          id: account.connectedAccountId,
          platform,
          toolkit: account.toolkit,
          label: PLATFORM_META[platform].label,
          accountEmail: account.accountEmail || null,
          accountName: account.accountName || null,
          state,
          ready: isReadyState(state),
        };
      }).filter(Boolean) as ComposioConnection[];
    }
    return [];
  }

  if (!client.create) throw new Error("Composio client does not support connected account listing.");
  const session = await client.create(userId, createComposioSessionConfig());
  const result = await session.toolkits?.({ toolkits: Object.values(PLATFORM_META).map((meta) => meta.toolkit) });
  const items = firstArray(result, ["items", "data"]);
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const toolkit = String(record.slug || "").toLowerCase();
    const platform = platformForToolkit(toolkit);
    const connection = record.connection as Record<string, unknown> | undefined;
    if (!platform || !connection) return null;
    const connectedAccount = connection.connectedAccount as Record<string, unknown> | undefined;
    const state = normalizeState(connectedAccount?.status || (connection.isActive ? "active" : "unconfigured"));
    return {
      id: String(connectedAccount?.id || "").trim() || undefined,
      platform,
      toolkit,
      label: PLATFORM_META[platform].label,
      accountEmail: null,
      accountName: null,
      state,
      ready: Boolean(connection.isActive) || isReadyState(state),
    };
  }).filter(Boolean) as ComposioConnection[];
}

export async function getComposioStatus(userId: string, deps?: ComposioFetchDeps): Promise<ComposioConnectionStatus> {
  if (!isComposioConfigured() && !deps?.client) {
    return {
      provider: "composio",
      configured: false,
      ready: false,
      dashboardUrl: getComposioDashboardUrl(),
      connections: [],
      platforms: COMPOSIO_CONNECTION_PLATFORMS.map((platform) => ({
        platform,
        toolkit: PLATFORM_META[platform].toolkit,
        label: PLATFORM_META[platform].label,
        ready: false,
        connectionId: null,
        state: "missing_server_api_key",
      })),
      nextSteps: ["Ask the Jarvis operator to configure COMPOSIO_API_KEY on the server."],
      error: "COMPOSIO_API_KEY is not configured.",
    };
  }

  try {
    const connections = await listComposioConnections(userId, deps);
    const platforms = COMPOSIO_CONNECTION_PLATFORMS.map((platform) => {
      const match = connections.find((connection) => connection.platform === platform && connection.ready)
        || connections.find((connection) => connection.platform === platform);
      return {
        platform,
        toolkit: PLATFORM_META[platform].toolkit,
        label: PLATFORM_META[platform].label,
        ready: Boolean(match?.ready),
        connectionId: match?.id || null,
        state: match?.state || "unconfigured",
      };
    });
    const readyCount = platforms.filter((platform) => platform.ready).length;
    return {
      provider: "composio",
      configured: true,
      ready: readyCount > 0,
      dashboardUrl: getComposioDashboardUrl(),
      connections,
      platforms,
      nextSteps: readyCount > 0
        ? [`Jarvis can access ${readyCount} connected account${readyCount === 1 ? "" : "s"} through Composio.`]
        : ["Connect Gmail, Google Calendar, Outlook, Slack, or Drive from Jarvis Connections."],
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      provider: "composio",
      configured: true,
      ready: false,
      dashboardUrl: getComposioDashboardUrl(),
      connections: [],
      platforms: COMPOSIO_CONNECTION_PLATFORMS.map((platform) => ({
        platform,
        toolkit: PLATFORM_META[platform].toolkit,
        label: PLATFORM_META[platform].label,
        ready: false,
        connectionId: null,
        state: "error",
      })),
      nextSteps: ["Refresh Connection Center. If this keeps failing, check COMPOSIO_API_KEY and Composio service status."],
      error: message,
    };
  }
}

export async function buildComposioConnectIntent(
  userId: string,
  platform: ComposioConnectionPlatform,
  callbackUrl?: string,
  deps?: ComposioFetchDeps,
): Promise<ComposioConnectIntent> {
  const meta = PLATFORM_META[platform];
  if (!isComposioConfigured() && !deps?.client) {
    return {
      provider: "composio",
      platform,
      toolkit: meta.toolkit,
      label: meta.label,
      redirectUrl: null,
      connectionRequestId: null,
      buttonLabel: `Connect ${meta.label}`,
      setupInstructions: ["COMPOSIO_API_KEY is not configured on the server."],
      error: "COMPOSIO_API_KEY is not configured.",
    };
  }

  const client = getClient(deps);
  const authConfigId = getComposioAuthConfigId(meta.toolkit);
  if (authConfigId && client.connectedAccounts?.link) {
    const signedCallbackUrl = callbackUrl || getComposioCallbackUrl(undefined, { userId, toolkit: meta.toolkit });
    const request = await client.connectedAccounts.link(userId, authConfigId, signedCallbackUrl ? { callbackUrl: signedCallbackUrl } : { callbackUrl: "" });
    return {
      provider: "composio",
      platform,
      toolkit: meta.toolkit,
      label: meta.label,
      redirectUrl: String(request.redirectUrl || request.redirect_url || request.url || request.link || ""),
      connectionRequestId: String(request.id || request.connectionRequestId || request.connected_account_id || ""),
      buttonLabel: `Connect ${meta.label}`,
      setupInstructions: [
        `Open the secure Composio connection page and approve ${meta.label}.`,
        "When OAuth finishes, return to Jarvis and refresh Connections.",
      ],
      error: null,
    };
  }
  if (!client.create) throw new Error("Composio client does not support Connect Link creation.");
  const session = await client.create(userId, createComposioSessionConfig([meta.toolkit]));
  const request = await session.authorize(meta.toolkit, callbackUrl ? { callbackUrl } : undefined);
  return {
    provider: "composio",
    platform,
    toolkit: meta.toolkit,
    label: meta.label,
    redirectUrl: String(request.redirectUrl || ""),
    connectionRequestId: String(request.id || ""),
    buttonLabel: `Connect ${meta.label}`,
    setupInstructions: [
      `Open the secure Composio connection page and approve ${meta.label}.`,
      "When OAuth finishes, return to Jarvis and refresh Connections.",
    ],
    error: null,
  };
}

export async function disconnectComposioAccount(userId: string, platform: ComposioConnectionPlatform, deps?: ComposioFetchDeps) {
  const client = getClient(deps);
  const connections = await listComposioConnections(userId, deps);
  const target = connections.find((connection) => connection.platform === platform && connection.id);
  if (!target?.id) {
    return { ok: false, message: `${PLATFORM_META[platform].label} is not connected.` };
  }
  if (!client.connectedAccounts?.delete) {
    return { ok: false, message: "Composio disconnect is unavailable in this runtime." };
  }
  await client.connectedAccounts.delete(target.id);
  await (deps?.store || dbComposioAccountStore).delete(userId, { connectedAccountId: target.id });
  return { ok: true, message: `${PLATFORM_META[platform].label} disconnected.` };
}

export async function handleComposioCallback(
  input: { state?: unknown; status?: unknown; connectedAccountId?: unknown; connected_account_id?: unknown },
  deps?: ComposioFetchDeps,
) {
  const state = verifyComposioCallbackState(String(input.state || ""));
  if (!state) return { ok: false, provider: "composio", error: "invalid_callback_state" };
  const platform = isComposioConnectionPlatform(state.toolkit) ? state.toolkit : platformForToolkit(state.toolkit);
  const toolkit = platform ? PLATFORM_META[platform].toolkit : state.toolkit;
  const connectedAccountId = String(input.connectedAccountId || input.connected_account_id || "").trim();
  if (!connectedAccountId) return { ok: false, provider: "composio", error: "missing_connected_account_id" };
  const status = String(input.status || "ACTIVE").toUpperCase();
  if (["FAILED", "ERROR", "DENIED", "CANCELED", "CANCELLED"].includes(status)) {
    return { ok: false, provider: "composio", status, connectedAccountId };
  }
  const saved = await (deps?.store || dbComposioAccountStore).upsert({
    userId: state.userId,
    toolkit,
    authConfigId: getComposioAuthConfigId(toolkit) || "",
    connectedAccountId,
    status: status === "SUCCESS" ? "ACTIVE" : status,
    metadata: { callback: true },
  });
  return {
    ok: true,
    provider: "composio",
    userId: state.userId,
    toolkit,
    connectedAccountId,
    status: saved.status,
  };
}

export async function testComposioConnection(userId: string, platform: ComposioConnectionPlatform, deps?: ComposioFetchDeps) {
  const client = getClient(deps);
  const toolkit = PLATFORM_META[platform].toolkit;
  if (!client.tools?.get) return buildComposioTestResponse(await getComposioStatus(userId, deps));
  const tools = await client.tools.get(userId, { toolkits: [toolkit] });
  const toolList = firstArray(tools, ["items", "data", "tools"]);
  const count = Array.isArray(tools) ? tools.length : toolList.length;
  return {
    ok: count > 0,
    provider: "composio",
    toolkit,
    toolCount: count,
    summary: count > 0
      ? `Composio returned ${count} ${PLATFORM_META[platform].label} tool${count === 1 ? "" : "s"}.`
      : `Composio did not return ${PLATFORM_META[platform].label} tools for this user yet.`,
  };
}

export function buildComposioTestResponse(status: ComposioConnectionStatus) {
  const readyCount = status.platforms.filter((platform) => platform.ready).length;
  return {
    ok: status.configured && readyCount > 0 && !status.error,
    summary: !status.configured
      ? "Composio is not configured on the server yet."
      : readyCount === 0
        ? "Composio is configured, but no connected accounts are active yet."
        : `${readyCount} connected account${readyCount === 1 ? "" : "s"} ready through Composio.`,
    results: status.platforms.map((platform) => ({
      platform: platform.platform,
      label: platform.label,
      ok: platform.ready,
      status: platform.state,
      connectionId: platform.connectionId,
      message: platform.ready
        ? `${platform.label} is connected and ready.`
        : `${platform.label} is not ready yet: ${platform.state}.`,
    })),
    nextSteps: status.nextSteps,
    error: status.error,
  };
}
