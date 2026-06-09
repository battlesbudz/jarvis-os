import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  deleteOpenAIProviderProfiles,
  getProviderStatus,
  saveOpenAIApiKeyProfile,
  saveOpenAIOAuthProfile,
  type ModelProviderAuthProfileRepository,
  type RefreshOAuthTokenResult,
} from "../agent/providers/modelProviderAuthProfiles";

export const DEFAULT_OPENAI_OAUTH_REDIRECT_URI = "http://127.0.0.1:1455/auth/callback";

export interface OpenAIOAuthConfig {
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientSecret?: string;
  userInfoUrl?: string;
  redirectUri?: string;
  scopes?: string[];
}

export interface OpenAIOAuthTokenExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  config: OpenAIOAuthConfig;
}

export interface OpenAIOAuthStateRecord {
  userId: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  config: OpenAIOAuthConfig;
  expiresAt: number;
}

export interface OpenAIOAuthStateStore {
  save(record: OpenAIOAuthStateRecord): Promise<void>;
  consume(state: string): Promise<OpenAIOAuthStateRecord | null>;
}

export class InMemoryOpenAIOAuthStateStore implements OpenAIOAuthStateStore {
  private states = new Map<string, OpenAIOAuthStateRecord>();

  async save(record: OpenAIOAuthStateRecord): Promise<void> {
    this.states.set(record.state, record);
  }

  async consume(state: string): Promise<OpenAIOAuthStateRecord | null> {
    const record = this.states.get(state) ?? null;
    if (!record) return null;
    this.states.delete(state);
    if (record.expiresAt <= Date.now()) return null;
    return record;
  }
}

const defaultStateStore = new InMemoryOpenAIOAuthStateStore();

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getOpenAIOAuthConfigFromEnv(): OpenAIOAuthConfig | null {
  const clientId = readEnv("JARVIS_OPENAI_OAUTH_CLIENT_ID", "OPENAI_OAUTH_CLIENT_ID");
  const authorizationUrl = readEnv("JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL", "OPENAI_OAUTH_AUTHORIZATION_URL");
  const tokenUrl = readEnv("JARVIS_OPENAI_OAUTH_TOKEN_URL", "OPENAI_OAUTH_TOKEN_URL");
  if (!clientId || !authorizationUrl || !tokenUrl) return null;

  const scopes = readEnv(
    "JARVIS_OPENAI_OAUTH_SCOPES",
    "OPENAI_OAUTH_SCOPES",
    "JARVIS_OPENAI_OAUTH_SCOPE",
    "OPENAI_OAUTH_SCOPE",
  )
    ?.split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return {
    clientId,
    authorizationUrl,
    tokenUrl,
    clientSecret: readEnv("JARVIS_OPENAI_OAUTH_CLIENT_SECRET", "OPENAI_OAUTH_CLIENT_SECRET"),
    userInfoUrl: readEnv("JARVIS_OPENAI_OAUTH_USERINFO_URL", "OPENAI_OAUTH_USERINFO_URL"),
    redirectUri: readEnv("JARVIS_OPENAI_OAUTH_REDIRECT_URI", "OPENAI_OAUTH_REDIRECT_URI"),
    scopes: scopes?.length ? scopes : ["openid", "email", "offline_access"],
  };
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateState(): string {
  return randomBytes(24).toString("base64url");
}

function codeChallengeForVerifier(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export async function buildOpenAIOAuthStart(input: {
  userId: string;
  stateStore?: OpenAIOAuthStateStore;
  config: OpenAIOAuthConfig;
}): Promise<{
  loginUrl: string;
  state: string;
  redirectUri: string;
  instructions: string;
}> {
  const stateStore = input.stateStore ?? defaultStateStore;
  const redirectUri = input.config.redirectUri || DEFAULT_OPENAI_OAUTH_REDIRECT_URI;
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeForVerifier(codeVerifier);

  await stateStore.save({
    userId: input.userId,
    state,
    codeVerifier,
    redirectUri,
    config: { ...input.config, redirectUri },
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const url = new URL(input.config.authorizationUrl);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (input.config.scopes?.length ? input.config.scopes : ["openid", "email", "offline_access"]).join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    loginUrl: url.toString(),
    state,
    redirectUri,
    instructions: "Open this login URL. If the browser shows a localhost error after login, copy the full URL and paste it into Jarvis.",
  };
}

export function parseOpenAICallbackUrl(callbackUrl: string): { code: string; state: string } {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error("Paste the full OpenAI callback URL");
  }

  const error = url.searchParams.get("error");
  if (error) {
    const description = url.searchParams.get("error_description") || error;
    throw new Error(`OpenAI OAuth returned an error: ${description}`);
  }

  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  if (!code) throw new Error("OpenAI callback URL is missing an authorization code");
  if (!state) throw new Error("OpenAI callback URL is missing state");
  return { code, state };
}

async function fetchOpenAIUserInfo(
  accessToken: string,
  config: OpenAIOAuthConfig,
): Promise<{ accountId?: string | null; email?: string | null }> {
  if (!config.userInfoUrl) return {};
  try {
    const response = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return {};
    const data = await response.json() as any;
    return {
      accountId: typeof data.sub === "string" ? data.sub : typeof data.account_id === "string" ? data.account_id : null,
      email: typeof data.email === "string" ? data.email : null,
    };
  } catch {
    return {};
  }
}

export async function exchangeOpenAICodeForTokens(
  request: OpenAIOAuthTokenExchangeRequest,
): Promise<RefreshOAuthTokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: request.code,
    redirect_uri: request.redirectUri,
    client_id: request.config.clientId,
    code_verifier: request.codeVerifier,
  });
  if (request.config.clientSecret) body.set("client_secret", request.config.clientSecret);

  const response = await fetch(request.config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json() as any;
  if (!response.ok || !data.access_token) {
    throw new Error("Failed to exchange OpenAI authorization code");
  }

  const accessToken = String(data.access_token);
  const userInfo = await fetchOpenAIUserInfo(accessToken, request.config);
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : null,
    accountId: typeof data.account_id === "string" ? data.account_id : userInfo.accountId ?? null,
    email: typeof data.email === "string" ? data.email : userInfo.email ?? null,
  };
}

export async function completeOpenAIOAuthCallback(input: {
  repo?: ModelProviderAuthProfileRepository;
  stateStore?: OpenAIOAuthStateStore;
  state: string;
  code: string;
  currentUserId?: string;
  exchangeCodeForTokens?: (request: OpenAIOAuthTokenExchangeRequest) => Promise<RefreshOAuthTokenResult | null>;
}): Promise<{ ok: true; userId: string; email: string | null; accountId: string | null }> {
  const stateStore = input.stateStore ?? defaultStateStore;
  const record = await stateStore.consume(input.state);
  if (!record) throw new Error("OAuth state was not found or has expired");
  if (input.currentUserId && record.userId !== input.currentUserId) {
    throw new Error("OAuth state does not belong to the current user");
  }

  const tokens = await (input.exchangeCodeForTokens ?? exchangeOpenAICodeForTokens)({
    code: input.code,
    codeVerifier: record.codeVerifier,
    redirectUri: record.redirectUri,
    config: record.config,
  });
  if (!tokens?.accessToken) throw new Error("OpenAI OAuth token exchange failed");

  await saveOpenAIOAuthProfile({
    repo: input.repo,
    userId: record.userId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: tokens.expiresAt ?? null,
    accountId: tokens.accountId ?? null,
    email: tokens.email ?? null,
    isDefault: true,
  });

  return {
    ok: true,
    userId: record.userId,
    email: tokens.email ?? null,
    accountId: tokens.accountId ?? null,
  };
}

export async function saveOpenAIApiKeyFromRequest(input: {
  repo?: ModelProviderAuthProfileRepository;
  userId: string;
  apiKey: string;
  isDefault?: boolean;
}): Promise<{ ok: true; authType: "api_key" }> {
  await saveOpenAIApiKeyProfile({
    repo: input.repo,
    userId: input.userId,
    apiKey: input.apiKey,
    isDefault: input.isDefault ?? true,
  });
  return { ok: true, authType: "api_key" };
}

async function getRequestUserId(req: Request): Promise<string | null> {
  if ((req as any).userId) return (req as any).userId;
  const { getUserIdFromRequest } = await import("../auth");
  return getUserIdFromRequest(req);
}

function escapeHtml(value: string): string {
  return value.replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch] || ch));
}

function successHtml(email?: string | null): string {
  const account = email ? `<p class="muted">${escapeHtml(email)}</p>` : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenAI Connected</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0f14; color: #f6f7f9; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
      main { width: min(92vw, 520px); padding: 32px; border: 1px solid #263241; border-radius: 8px; background: #111821; }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { margin: 8px 0 0; color: #c9d1db; line-height: 1.5; }
      .muted { color: #8da2b6; }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenAI connected</h1>
      ${account}
      <p>You can close this tab and return to Jarvis.</p>
    </main>
  </body>
</html>`;
}

function errorHtml(message: string): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>OpenAI Connection Failed</title></head>
  <body style="font-family: system-ui; background: #0b0f14; color: #f6f7f9; padding: 32px;">
    <h1>OpenAI connection failed</h1>
    <p>${escapeHtml(message)}</p>
  </body>
</html>`;
}

export function registerOpenAIProviderAuthRoutes(
  app: Express,
  deps: {
    repo?: ModelProviderAuthProfileRepository;
    stateStore?: OpenAIOAuthStateStore;
    getConfig?: () => OpenAIOAuthConfig | null;
    includeCallbackRoutes?: boolean;
  } = {},
): void {
  const stateStore = deps.stateStore ?? defaultStateStore;
  const getConfig = deps.getConfig ?? getOpenAIOAuthConfigFromEnv;

  app.post("/api/auth/openai-oauth/start", async (req: Request, res: Response) => {
    try {
      const userId = await getRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const config = getConfig();
      if (!config) {
        return res.status(501).json({
          error: "openai_oauth_not_configured",
          message: "OpenAI OAuth is not configured. Set JARVIS_OPENAI_OAUTH_CLIENT_ID, JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL, and JARVIS_OPENAI_OAUTH_TOKEN_URL.",
          redirectUri: DEFAULT_OPENAI_OAUTH_REDIRECT_URI,
        });
      }
      res.json(await buildOpenAIOAuthStart({ userId, stateStore, config }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "openai_oauth_start_failed", message });
    }
  });

  app.post("/api/auth/openai-oauth/callback-url", async (req: Request, res: Response) => {
    try {
      const userId = await getRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const callbackUrl = typeof req.body?.callbackUrl === "string" ? req.body.callbackUrl : "";
      const { code, state } = parseOpenAICallbackUrl(callbackUrl);
      const result = await completeOpenAIOAuthCallback({
        repo: deps.repo,
        stateStore,
        code,
        state,
        currentUserId: userId,
      });
      res.json({ ...result, status: await getProviderStatus({ repo: deps.repo, userId }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: "openai_oauth_callback_failed", message });
    }
  });

  if (deps.includeCallbackRoutes !== false) {
    registerPublicOpenAIProviderAuthCallbackRoutes(app, { repo: deps.repo, stateStore });
  }

  app.post("/api/auth/openai-api-key", async (req: Request, res: Response) => {
    try {
      const userId = await getRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey : "";
      await saveOpenAIApiKeyFromRequest({ repo: deps.repo, userId, apiKey, isDefault: true });
      res.json({ ok: true, status: await getProviderStatus({ repo: deps.repo, userId }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: "openai_api_key_save_failed", message });
    }
  });

  app.get("/api/auth/providers/status", async (req: Request, res: Response) => {
    try {
      const userId = await getRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      res.json(await getProviderStatus({ repo: deps.repo, userId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "provider_status_failed", message });
    }
  });

  app.delete("/api/auth/providers/openai", async (req: Request, res: Response) => {
    try {
      const userId = await getRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const deleted = await deleteOpenAIProviderProfiles({ repo: deps.repo, userId });
      res.json({ ok: true, deleted, status: await getProviderStatus({ repo: deps.repo, userId }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "openai_provider_delete_failed", message });
    }
  });
}

export function registerPublicOpenAIProviderAuthCallbackRoutes(
  app: Express,
  deps: {
    repo?: ModelProviderAuthProfileRepository;
    stateStore?: OpenAIOAuthStateStore;
  } = {},
): void {
  const stateStore = deps.stateStore ?? defaultStateStore;

  async function callback(req: Request, res: Response) {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !state) throw new Error("Callback is missing code or state");
      const result = await completeOpenAIOAuthCallback({
        repo: deps.repo,
        stateStore,
        code,
        state,
      });
      res.type("html").send(successHtml(result.email));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).type("html").send(errorHtml(message));
    }
  }

  app.get("/api/auth/openai-oauth/callback", callback);
  app.get("/auth/callback", callback);
}
