export * from "./connectionCenter";

import {
  dbComposioAccountStore,
  getComposioAuthConfigId,
  signComposioCallbackState,
  verifyComposioCallbackState,
  type ComposioAccountStore,
  type ComposioClientLike,
  type StoredComposioAccount,
} from "./connectionCenter";

type EnvLike = Record<string, string | undefined>;

function authConfigFor(toolkit: string, env: EnvLike): { envName: string; authConfigId: string | null } {
  const envName = `COMPOSIO_${toolkit.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_AUTH_CONFIG_ID`;
  return { envName, authConfigId: env[envName]?.trim() || getComposioAuthConfigId(toolkit, env) };
}

function firstArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["items", "data", "connectedAccounts", "connected_accounts", "accounts", "tools"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function accountFromRemote(userId: string, fallbackToolkit: string, fallbackAuthConfigId: string, value: unknown): StoredComposioAccount | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const toolkitRecord = record.toolkit && typeof record.toolkit === "object" && !Array.isArray(record.toolkit)
    ? record.toolkit as Record<string, unknown>
    : {};
  const connectedAccountId = String(record.connectedAccountId || record.connected_account_id || record.id || record.nanoid || "").trim();
  if (!connectedAccountId) return null;
  const toolkit = String(record.toolkitSlug || record.toolkit_slug || toolkitRecord.slug || fallbackToolkit).trim();
  return {
    userId,
    toolkit,
    authConfigId: String(record.authConfigId || record.auth_config_id || fallbackAuthConfigId || ""),
    connectedAccountId,
    status: String(record.status || "ACTIVE").toUpperCase(),
    accountEmail: String(record.accountEmail || record.account_email || record.email || "").trim() || null,
    accountName: String(record.accountName || record.account_name || record.name || "").trim() || null,
    metadata: { provider: "composio" },
  };
}

export function createComposioConnectionService(options: {
  client: ComposioClientLike;
  store?: ComposioAccountStore;
  env?: EnvLike;
}) {
  const env = options.env || process.env;
  const store = options.store || dbComposioAccountStore;

  return {
    async createConnectLink(args: { userId: string; toolkit: string }) {
      const config = authConfigFor(args.toolkit, env);
      if (!config.authConfigId) throw new Error(`${config.envName} is required.`);
      const baseUrl = env.COMPOSIO_CALLBACK_BASE_URL?.replace(/\/+$/, "");
      if (!baseUrl) throw new Error("COMPOSIO_CALLBACK_BASE_URL is required.");
      const callbackUrl = new URL("/api/connections/callback", baseUrl);
      callbackUrl.searchParams.set("state", signComposioCallbackState(args, env));
      const result = await options.client.connectedAccounts!.link(args.userId, config.authConfigId, { callbackUrl: callbackUrl.toString() });
      const record = result as Record<string, unknown>;
      return {
        ok: true,
        provider: "composio",
        toolkit: args.toolkit,
        connectUrl: String(record.redirectUrl || record.redirect_url || record.url || record.link || ""),
      };
    },

    async handleCallback(input: { method: "GET" | "POST"; state?: unknown; status?: unknown; connected_account_id?: unknown; connectedAccountId?: unknown }) {
      const state = verifyComposioCallbackState(String(input.state || ""), env);
      if (!state) return { ok: false, provider: "composio", error: "invalid_callback_state" };
      const connectedAccountId = String(input.connected_account_id || input.connectedAccountId || "").trim();
      if (!connectedAccountId) return { ok: false, provider: "composio", error: "missing_connected_account_id" };
      const config = authConfigFor(state.toolkit, env);
      const saved = await store.upsert({
        userId: state.userId,
        toolkit: state.toolkit,
        authConfigId: config.authConfigId || "",
        connectedAccountId,
        status: String(input.status || "ACTIVE").toUpperCase(),
        metadata: { callbackMethod: input.method },
      });
      return { ok: true, provider: "composio", toolkit: saved.toolkit, connectedAccountId: saved.connectedAccountId, status: saved.status };
    },

    async getStatus(userId: string) {
      const remote = await options.client.connectedAccounts!.list({ userIds: [userId], statuses: ["ACTIVE"] });
      const accounts = firstArray(remote)
        .map((account) => accountFromRemote(userId, "", "", account))
        .filter((account): account is StoredComposioAccount => Boolean(account));
      await Promise.all(accounts.map((account) => store.upsert(account)));
      const connections = await store.list(userId);
      return {
        provider: "composio",
        apiKeyConfigured: Boolean(env.COMPOSIO_API_KEY),
        ready: connections.some((connection) => connection.status === "ACTIVE"),
        connections,
      };
    },

    async testConnection(args: { userId: string; toolkit: string }) {
      const tools = await options.client.tools!.get(args.userId, { toolkits: [args.toolkit] });
      const count = Array.isArray(tools) ? tools.length : firstArray(tools).length;
      return { ok: count > 0, provider: "composio", toolkit: args.toolkit, toolCount: count };
    },

    async disconnect(args: { userId: string; connectedAccountId?: string; toolkit?: string }) {
      if (args.connectedAccountId && options.client.connectedAccounts?.delete) {
        await options.client.connectedAccounts.delete(args.connectedAccountId);
      }
      const deletedLocalAccounts = await store.delete(args.userId, {
        connectedAccountId: args.connectedAccountId,
        toolkit: args.toolkit,
      });
      return { ok: deletedLocalAccounts > 0, provider: "composio", deletedLocalAccounts, revokedRemote: Boolean(args.connectedAccountId) };
    },
  };
}
