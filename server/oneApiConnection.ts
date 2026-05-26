export const ONE_API_BASE_URL = process.env.ONE_API_BASE_URL || "https://api.withone.ai";
export const ONE_API_KEYS_URL = process.env.ONE_API_KEYS_URL || "https://app.withone.ai";
export const ONE_API_TOKEN_PROVIDER = "one_api";
const ONE_API_TOKEN_ACCOUNT = "api-key";

export type OneApiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OneApiConnection = {
  key?: string;
  id?: string;
  platform?: string;
  connector?: string;
  name?: string;
  label?: string;
  accountEmail?: string;
  accountName?: string;
  email?: string;
  status?: string;
  state?: string;
  keyPreview?: string;
  [key: string]: unknown;
};

export type OneApiStatus = {
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  installed: boolean;
  authenticated: boolean;
  ready: boolean;
  command: string;
  dashboardUrl: string;
  accountEmail: string | null;
  accountName: string | null;
  connections: OneApiConnection[];
  nextSteps: string[];
  error: string | null;
};

export type OneApiResult<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  ok: boolean;
  status: number;
  url: string;
  error?: string;
};

export type OneApiAction = {
  id?: string;
  _id?: string;
  systemId?: string;
  key?: string;
  title?: string;
  name?: string;
  method?: string;
  path?: string;
  knowledge?: string;
  [key: string]: unknown;
};

export type OnePassthroughArgs = {
  action: OneApiAction;
  connectionKey: string;
  data?: unknown;
  pathVars?: unknown;
  queryParams?: unknown;
  headers?: unknown;
  dryRun?: boolean;
  baseUrl?: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function sanitizeOneError(message: string, apiKey: string): string {
  return message.replaceAll(apiKey, maskOneApiKey(apiKey));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function firstRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (isRecord(value) && isRecord(value.action)) return value.action as Record<string, unknown>;
  const rows = firstArray(value, keys);
  const first = rows[0];
  if (isRecord(first)) return first;
  if (isRecord(value) && (value.path || value.method || value.title || value._id || value.systemId)) return value;
  return null;
}

function toPlainRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function normalizeConnection(value: unknown): OneApiConnection {
  if (!isRecord(value)) return { platform: "unknown", state: "unknown" };
  const rawKey = String(value.key || value.id || value.connectionKey || "");
  return {
    ...value,
    key: rawKey || undefined,
    platform: String(value.platform || value.connector || value.provider || value.name || "unknown").toLowerCase(),
    accountEmail: String(value.accountEmail || value.email || value.account || ""),
    accountName: String(value.accountName || value.name || value.label || ""),
    state: String(value.state || value.status || "operational").toLowerCase(),
    keyPreview: rawKey ? maskConnectionKey(rawKey) : undefined,
  };
}

function maskConnectionKey(key: string): string {
  if (key.length <= 8) return key;
  return `${key.slice(0, 5)}...${key.slice(-3)}`;
}

export function maskOneApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}...${trimmed.length}`;
  if (trimmed.startsWith("one_sk_")) return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function buildOneActionSearchUrl(platform: string, query: string, baseUrl = ONE_API_BASE_URL): string {
  const url = new URL(`/v1/available-actions/search/${encodeURIComponent(platform)}`, normalizeBaseUrl(baseUrl));
  url.searchParams.set("query", query);
  url.searchParams.set("includeKnowledge", "true");
  url.searchParams.set("executeAgent", "true");
  return url.toString();
}

function getActionOneId(action: OneApiAction): string {
  return String(action._id || action.systemId || action.id || "").trim();
}

function getActionKey(action: OneApiAction): string {
  return String(action.key || "").trim();
}

function getActionPath(action: OneApiAction): string {
  return String(action.path || "").trim();
}

function getActionMethod(action: OneApiAction): string {
  return String(action.method || "POST").trim().toUpperCase();
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildRfc2822Message(input: Record<string, unknown>): string {
  const to = String(input.to || input.recipient || input.email || "").trim();
  const subject = String(input.subject || "Hello").trim();
  const body = String(input.body || input.text || input.message || "").trim();
  const headers = [
    input.from ? `From: ${String(input.from).trim()}` : null,
    to ? `To: ${to}` : null,
    input.cc ? `Cc: ${String(input.cc).trim()}` : null,
    input.bcc ? `Bcc: ${String(input.bcc).trim()}` : null,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

function normalizeGmailData(path: string, data: unknown): unknown {
  const body = toPlainRecord(data);
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith("/drafts/send")) {
    if (body.draftId && !body.id) return { ...body, id: body.draftId };
    return data ?? {};
  }

  const isDraftCreate = lowerPath.endsWith("/drafts");
  const isMessageSend = lowerPath.endsWith("/messages/send");
  if (isDraftCreate && body.raw) return { message: { raw: body.raw } };
  if ((isDraftCreate || isMessageSend) && !isRecord(body.message) && !body.raw && (body.to || body.subject || body.body || body.text || body.message)) {
    const raw = base64UrlEncode(buildRfc2822Message(body));
    return isDraftCreate ? { message: { raw } } : { raw };
  }

  if (lowerPath.endsWith("/modify")) {
    const action = String(body.action || "").toLowerCase();
    const removeLabelIds = Array.isArray(body.removeLabelIds) ? [...body.removeLabelIds] : [];
    const addLabelIds = Array.isArray(body.addLabelIds) ? [...body.addLabelIds] : [];
    if (body.archive === true || action === "archive") removeLabelIds.push("INBOX");
    if (action === "mark_read") removeLabelIds.push("UNREAD");
    if (action === "mark_unread") addLabelIds.push("UNREAD");
    if (action === "star") addLabelIds.push("STARRED");
    if (action === "unstar") removeLabelIds.push("STARRED");
    if (addLabelIds.length || removeLabelIds.length) return { ...body, addLabelIds, removeLabelIds };
  }

  return data ?? {};
}

function appendQueryParams(url: URL, queryParams: unknown): void {
  const params = toPlainRecord(queryParams);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

export function buildOnePassthroughRequest(args: OnePassthroughArgs): { url: string; init: RequestInit; body: unknown } {
  const root = normalizeBaseUrl(args.baseUrl || ONE_API_BASE_URL).replace(/\/v1$/i, "");
  const pathVars = toPlainRecord(args.pathVars);
  const actionPath = getActionPath(args.action);
  if (!actionPath) throw new Error("One action is missing a passthrough path.");
  if (actionPath.includes("{{userId}}") && !pathVars.userId) pathVars.userId = "me";

  const finalPath = actionPath.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const value = pathVars[key.trim()];
    if (value == null || value === "") throw new Error(`Missing One path variable '${key.trim()}'.`);
    return encodeURIComponent(String(value));
  });

  const actionId = getActionOneId(args.action);
  if (!actionId) throw new Error("One action is missing a system action id.");

  const method = getActionMethod(args.action);
  const url = new URL(`/v1/passthrough${finalPath.startsWith("/") ? finalPath : `/${finalPath}`}`, root);
  appendQueryParams(url, args.queryParams);
  const headers: Record<string, string> = {
    "x-one-connection-key": args.connectionKey,
    "x-one-action-id": actionId,
    ...toPlainRecord(args.headers) as Record<string, string>,
  };
  const normalizedBody = normalizeGmailData(finalPath, args.data);
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify(normalizedBody);
  }
  if (args.dryRun) headers["x-one-dry-run"] = "true";
  return { url: url.toString(), init, body: normalizedBody };
}

export function createOneApiClient(apiKey: string, fetchImpl: OneApiFetch = fetch, baseUrl = ONE_API_BASE_URL) {
  const secret = apiKey.trim();
  const root = normalizeBaseUrl(baseUrl);

  async function request<T extends Record<string, unknown>>(
    pathOrUrl: string,
    init: RequestInit = {},
  ): Promise<OneApiResult<T>> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${root}${pathOrUrl}`;
    try {
      const headers: Record<string, string> = {
        "x-one-secret": secret,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...((init.headers as Record<string, string> | undefined) || {}),
      };
      const response = await fetchImpl(url, { ...init, headers });
      const text = await response.text();
      let data: unknown = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { message: text };
        }
      }
      if (!response.ok) {
        const message = isRecord(data) && typeof data.message === "string"
          ? data.message
          : response.statusText || "One API request failed.";
        return { ok: false, status: response.status, url, error: sanitizeOneError(message, secret) } as OneApiResult<T>;
      }
      return { ...(isRecord(data) ? data : { data }), ok: true, status: response.status, url } as OneApiResult<T>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, status: 0, url, error: sanitizeOneError(message, secret) } as OneApiResult<T>;
    }
  }

  return {
    async listConnections() {
      const result = await request<{ connections: OneApiConnection[] }>("/v1/vault/connections");
      const connections = firstArray(result, ["connections", "rows", "items", "data"]).map(normalizeConnection);
      return { ...result, connections };
    },
    async listAvailableConnectors() {
      const result = await request<{ connectors: unknown[] }>("/v1/available-connectors");
      const connectors = firstArray(result, ["connectors", "rows", "items", "data"]);
      return { ...result, connectors };
    },
    async searchActions(platform: string, query: string) {
      const url = buildOneActionSearchUrl(platform, query, root);
      const result = await request<{ actions: unknown[] }>(url);
      const actions = firstArray(result, ["actions", "rows", "items", "data", "results"]);
      return { ...result, actions };
    },
    async getActionDetails(actionId: string) {
      const url = new URL("/v1/knowledge", root);
      url.searchParams.set("_id", actionId);
      const result = await request<{ action: OneApiAction }>(url.toString());
      const action = firstRecord(result, ["actions", "rows", "items", "data", "results"]) as OneApiAction | null;
      return { ...result, action: action || undefined };
    },
    async resolveActionDetails(platform: string, actionId: string) {
      if (!actionId.startsWith("api::")) {
        const details = await this.getActionDetails(actionId);
        if (details.ok && details.action) return details;
      }
      const search = await this.searchActions(platform, actionId);
      const normalized = actionId.toLowerCase();
      const match = search.actions.find((candidate) => {
        if (!isRecord(candidate)) return false;
        return [candidate.systemId, candidate._id, candidate.id, candidate.key, candidate.title, candidate.name]
          .some((value) => String(value || "").toLowerCase() === normalized);
      }) || search.actions.find((candidate) => {
        if (!isRecord(candidate)) return false;
        return [candidate.key, candidate.title, candidate.name].some((value) => String(value || "").toLowerCase().includes(normalized));
      });
      const action = isRecord(match) ? match as OneApiAction : undefined;
      return { ...search, action };
    },
    async passthrough(connectionKey: string, payload: Record<string, unknown>) {
      const action = payload.action as OneApiAction | undefined;
      if (action) {
        const requestArgs = buildOnePassthroughRequest({
          action,
          connectionKey,
          data: payload.data,
          pathVars: payload.pathVars,
          queryParams: payload.queryParams,
          headers: payload.headers,
          dryRun: payload.dryRun === true,
          baseUrl: root,
        });
        return request(requestArgs.url, requestArgs.init);
      }
      return request(`/v1/passthrough/${encodeURIComponent(connectionKey)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async executeAction(args: Omit<OnePassthroughArgs, "baseUrl">) {
      const passthrough = buildOnePassthroughRequest({ ...args, baseUrl: root });
      const result = await request(passthrough.url, passthrough.init);
      return { ...result, request: { url: passthrough.url, method: passthrough.init.method, body: passthrough.body } };
    },
  };
}

export async function getSavedOneApiKey(userId: string): Promise<string | null> {
  const { getUserToken } = await import("./userTokenStore");
  const token = await getUserToken(userId, ONE_API_TOKEN_PROVIDER);
  return token?.accessToken || null;
}

export async function saveOneApiKey(userId: string, apiKey: string): Promise<void> {
  const { saveUserToken } = await import("./userTokenStore");
  await saveUserToken({
    userId,
    provider: ONE_API_TOKEN_PROVIDER,
    accessToken: apiKey.trim(),
    accountEmail: ONE_API_TOKEN_ACCOUNT,
    scopes: "one-api",
  });
}

export async function deleteOneApiKey(userId: string): Promise<void> {
  const { deleteUserToken } = await import("./userTokenStore");
  await deleteUserToken(userId, ONE_API_TOKEN_PROVIDER);
}

export async function getOneApiStatus(userId: string, fetchImpl: OneApiFetch = fetch): Promise<OneApiStatus> {
  const apiKey = await getSavedOneApiKey(userId);
  if (!apiKey) {
    return {
      apiKeyConfigured: false,
      apiKeyPreview: null,
      installed: false,
      authenticated: false,
      ready: false,
      command: "one",
      dashboardUrl: ONE_API_KEYS_URL,
      accountEmail: null,
      accountName: null,
      connections: [],
      nextSteps: ["Paste a One API key from One API Keys, then Jarvis will verify the accounts it can access."],
      error: null,
    };
  }

  const client = createOneApiClient(apiKey, fetchImpl);
  const result = await client.listConnections();
  const account = result.connections.find((connection) => connection.accountEmail || connection.accountName);
  return {
    apiKeyConfigured: true,
    apiKeyPreview: maskOneApiKey(apiKey),
    installed: true,
    authenticated: result.ok,
    ready: result.ok && result.connections.length > 0,
    command: "one",
    dashboardUrl: ONE_API_KEYS_URL,
    accountEmail: account?.accountEmail || null,
    accountName: account?.accountName || null,
    connections: result.ok ? result.connections : [],
    nextSteps: result.ok
      ? result.connections.length > 0
        ? [`Jarvis can access ${result.connections.length} One connected account${result.connections.length === 1 ? "" : "s"}.`]
        : ["The One API key is valid, but no connected accounts were returned yet."]
      : ["Check that your One API key is active, then paste it again."],
    error: result.ok ? null : result.error || "Jarvis could not verify this One API key.",
  };
}
