import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  InMemoryModelProviderAuthProfileRepository,
  getProviderCredential,
  saveProviderApiKeyProfile,
} from "../providers/modelProviderAuthProfiles";
import {
  DEFAULT_CHATGPT_CODEX_OAUTH_REDIRECT_URI,
  DEFAULT_OPENAI_OAUTH_REDIRECT_URI,
} from "../providers/openaiOAuthDefaults";
import {
  DEFAULT_CHATGPT_CODEX_OAUTH_CONFIG,
  InMemoryOpenAIOAuthStateStore,
  buildOpenAIChatGPTDesktopConnectorFallback,
  buildOpenAIOAuthStart,
  completeOpenAIOAuthCallback,
  getDefaultModelForProviderAuth,
  getOpenAIOAuthConfigFromEnv,
  parseOpenAICallbackUrl,
  registerOpenAIProviderAuthRoutes,
  registerPublicOpenAIProviderAuthCallbackRoutes,
  saveOpenAIApiKeyFromRequest,
} from "../../routes/openaiProviderAuthRoutes";

async function listen(app: express.Express): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind to a TCP port");
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

async function main() {
  const previousSecret = process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
  const previousClientId = process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID;
  const previousAuthorizationUrl = process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL;
  const previousTokenUrl = process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL;
  const previousUserInfoUrl = process.env.JARVIS_OPENAI_OAUTH_USERINFO_URL;
  const previousScopes = process.env.JARVIS_OPENAI_OAUTH_SCOPES;
  const previousSingularScope = process.env.JARVIS_OPENAI_OAUTH_SCOPE;
  const previousAuthorizationParams = process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_PARAMS;
  process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = "test-secret-for-openai-auth-routes";

  try {
    process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID = "client_from_env";
    process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL = "https://auth.example.test/oauth/authorize";
    process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL = "https://auth.example.test/oauth/token";
    process.env.JARVIS_OPENAI_OAUTH_SCOPES = "openid profile email";
    process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_PARAMS = JSON.stringify({ audience: "jarvis-test", prompt: "login" });
    delete process.env.JARVIS_OPENAI_OAUTH_SCOPE;
    assert.deepEqual(getOpenAIOAuthConfigFromEnv()?.scopes, ["openid", "profile", "email"]);
    assert.deepEqual(getOpenAIOAuthConfigFromEnv()?.authorizationParams, { audience: "jarvis-test", prompt: "login" });

    delete process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID;
    delete process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL;
    delete process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL;
    delete process.env.JARVIS_OPENAI_OAUTH_USERINFO_URL;
    delete process.env.JARVIS_OPENAI_OAUTH_SCOPES;
    delete process.env.JARVIS_OPENAI_OAUTH_SCOPE;
    delete process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_PARAMS;
    const defaultConfig = getOpenAIOAuthConfigFromEnv();
    assert.equal(defaultConfig?.clientId, DEFAULT_CHATGPT_CODEX_OAUTH_CONFIG.clientId);
    assert.equal(defaultConfig?.authorizationUrl, "https://auth.openai.com/oauth/authorize");
    assert.equal(defaultConfig?.tokenUrl, "https://auth.openai.com/oauth/token");
    assert.equal(defaultConfig?.redirectUri, DEFAULT_CHATGPT_CODEX_OAUTH_REDIRECT_URI);
    assert.deepEqual(defaultConfig?.authorizationParams, DEFAULT_CHATGPT_CODEX_OAUTH_CONFIG.authorizationParams);

    const fallback = buildOpenAIChatGPTDesktopConnectorFallback();
    assert.equal(fallback.requiresDesktopConnector, true);
    assert.equal(fallback.setupPath, "/desktop-connector-setup");
    assert.match(fallback.instructions, /Desktop Connector/);

    const defaultStartApp = express();
    defaultStartApp.use(express.json());
    registerOpenAIProviderAuthRoutes(defaultStartApp, {
      includeCallbackRoutes: false,
      resolveUserId: () => "user-default-oauth",
    });
    const defaultStartServer = await listen(defaultStartApp);
    try {
      const response = await fetch(`http://127.0.0.1:${defaultStartServer.port}/api/auth/openai-oauth/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json() as any;
      assert.equal(response.status, 200);
      assert.equal(body.requiresDesktopConnector, undefined);
      assert.equal(body.setupPath, undefined);
      assert.match(body.loginUrl, /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
      assert.match(body.loginUrl, /client_id=app_EMoamEEZ73f0CkXaXp7hrann/);
      assert.match(body.loginUrl, /redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback/);
      assert.match(body.loginUrl, /code_challenge_method=S256/);
      assert.match(body.loginUrl, /codex_cli_simplified_flow=true/);
      assert.match(body.loginUrl, /id_token_add_organizations=true/);
      assert.equal(body.redirectUri, DEFAULT_CHATGPT_CODEX_OAUTH_REDIRECT_URI);
    } finally {
      await defaultStartServer.close();
    }

    const repo = new InMemoryModelProviderAuthProfileRepository();
    const stateStore = new InMemoryOpenAIOAuthStateStore();

    assert.equal(getDefaultModelForProviderAuth("openai", "oauth"), "chatgpt-codex-oauth/auto");
    assert.equal(getDefaultModelForProviderAuth("openai", "api_key"), "openai/gpt-4.1-mini");
    assert.equal(getDefaultModelForProviderAuth("google", "api_key"), "google/gemini-2.5-flash");
    assert.equal(getDefaultModelForProviderAuth("android-local-gemma", "local"), "android-local-gemma/gemma-4-e4b-it");

    const start = await buildOpenAIOAuthStart({
      userId: "user-1",
      stateStore,
      config: {
        clientId: "client_123",
        authorizationUrl: "https://auth.example.test/oauth/authorize",
        tokenUrl: "https://auth.example.test/oauth/token",
        scopes: ["openid", "email", "offline_access"],
      },
    });

    assert.equal(start.redirectUri, DEFAULT_OPENAI_OAUTH_REDIRECT_URI);
    assert.match(start.loginUrl, /^https:\/\/auth\.example\.test\/oauth\/authorize\?/);
    assert.match(start.loginUrl, /response_type=code/);
    assert.match(start.loginUrl, /code_challenge_method=S256/);
    assert.match(start.loginUrl, /client_id=client_123/);
    assert.equal(start.instructions.includes("localhost error"), true);

    const parsed = parseOpenAICallbackUrl(
      `${DEFAULT_OPENAI_OAUTH_REDIRECT_URI}?code=abc123&state=${encodeURIComponent(start.state)}`,
    );
    assert.deepEqual(parsed, { code: "abc123", state: start.state });

    await completeOpenAIOAuthCallback({
      repo,
      stateStore,
      state: start.state,
      code: "abc123",
      currentUserId: "user-1",
      exchangeCodeForTokens: async (request) => {
        assert.equal(request.code, "abc123");
        assert.equal(request.redirectUri, DEFAULT_OPENAI_OAUTH_REDIRECT_URI);
        assert.equal(request.codeVerifier.length > 40, true);
        return {
          accessToken: "oauth-access-token",
          refreshToken: "oauth-refresh-token",
          expiresAt: new Date(Date.now() + 3600_000),
          accountId: "acct_abc",
          email: "openai-user@example.com",
        };
      },
    });

    const oauthCredential = await getProviderCredential({
      repo,
      userId: "user-1",
      provider: "openai",
      preferredAuthType: "oauth",
    });
    assert.equal(oauthCredential?.credential, "oauth-access-token");
    assert.equal(oauthCredential?.refreshToken, "oauth-refresh-token");
    assert.equal(oauthCredential?.accountId, "acct_abc");
    assert.equal(oauthCredential?.email, "openai-user@example.com");

    await assert.rejects(
      () => completeOpenAIOAuthCallback({
        repo,
        stateStore,
        state: start.state,
        code: "abc123",
        currentUserId: "user-1",
        exchangeCodeForTokens: async () => {
          throw new Error("should not exchange a consumed state");
        },
      }),
      /OAuth state was not found or has expired/,
    );

    await saveOpenAIApiKeyFromRequest({
      repo,
      userId: "user-2",
      apiKey: "  sk-user-key  ",
      isDefault: true,
    });
    const apiCredential = await getProviderCredential({
      repo,
      userId: "user-2",
      provider: "openai",
      preferredAuthType: "api_key",
    });
    assert.equal(apiCredential?.authType, "api_key");
    assert.equal(apiCredential?.credential, "sk-user-key");

    await saveProviderApiKeyProfile({
      repo,
      userId: "user-3",
      provider: "anthropic",
      apiKey: "sk-ant-user-key",
      isDefault: true,
    });
    const anthropicCredential = await getProviderCredential({
      repo,
      userId: "user-3",
      provider: "anthropic",
      preferredAuthType: "api_key",
    });
    assert.equal(anthropicCredential?.provider, "anthropic");
    assert.equal(anthropicCredential?.credential, "sk-ant-user-key");

    const activations: Array<{ userId: string; model: string }> = [];
    let selectedModelForRoute = "chatgpt-codex-oauth/auto";
    const activationApp = express();
    activationApp.use(express.json());
    registerOpenAIProviderAuthRoutes(activationApp, {
      repo,
      includeCallbackRoutes: false,
      resolveUserId: () => "user-route",
      activateModelPreference: async (userId, model) => {
        activations.push({ userId, model });
        selectedModelForRoute = model;
        return { selectedModel: model, chat: model, planning: model, memory: model, research: model, orchestrator: model };
      },
      resolveSelectedModelPreference: async () => selectedModelForRoute,
    });
    const activationServer = await listen(activationApp);
    try {
      const openAIKeyResponse = await fetch(`http://127.0.0.1:${activationServer.port}/api/auth/openai-api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-route-openai" }),
      });
      const openAIKeyBody = await openAIKeyResponse.json() as any;
      assert.equal(openAIKeyResponse.status, 200);
      assert.equal(openAIKeyBody.selectedModel, "openai/gpt-4.1-mini");
      assert.equal(openAIKeyBody.modelPreferences.chat, "openai/gpt-4.1-mini");

      const geminiKeyResponse = await fetch(`http://127.0.0.1:${activationServer.port}/api/auth/model-provider-api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", apiKey: "gemini-route-key" }),
      });
      const geminiKeyBody = await geminiKeyResponse.json() as any;
      assert.equal(geminiKeyResponse.status, 200);
      assert.equal(geminiKeyBody.selectedModel, "google/gemini-2.5-flash");
      assert.equal(geminiKeyBody.modelPreferences.orchestrator, "google/gemini-2.5-flash");

      const disconnectOpenAIResponse = await fetch(`http://127.0.0.1:${activationServer.port}/api/auth/providers/openai`, {
        method: "DELETE",
      });
      const disconnectOpenAIBody = await disconnectOpenAIResponse.json() as any;
      assert.equal(disconnectOpenAIResponse.status, 200);
      assert.equal(disconnectOpenAIBody.selectedModel, undefined);
      assert.equal(selectedModelForRoute, "google/gemini-2.5-flash");

      const disconnectGeminiResponse = await fetch(`http://127.0.0.1:${activationServer.port}/api/auth/providers/google`, {
        method: "DELETE",
      });
      const disconnectGeminiBody = await disconnectGeminiResponse.json() as any;
      assert.equal(disconnectGeminiResponse.status, 200);
      assert.equal(disconnectGeminiBody.provider, "google");
      assert.equal(disconnectGeminiBody.selectedModel, "chatgpt-codex-oauth/auto");
      assert.equal(disconnectGeminiBody.modelPreferences.chat, "chatgpt-codex-oauth/auto");

      const resavedGeminiResponse = await fetch(`http://127.0.0.1:${activationServer.port}/api/auth/model-provider-api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", apiKey: "gemini-route-key-2" }),
      });
      assert.equal(resavedGeminiResponse.status, 200);

      const defaultResponse = await fetch(`http://127.0.0.1:${activationServer.port}/api/auth/providers/openai?resetSelectedModel=1`, {
        method: "DELETE",
      });
      const defaultBody = await defaultResponse.json() as any;
      assert.equal(defaultResponse.status, 200);
      assert.equal(defaultBody.selectedModel, "chatgpt-codex-oauth/auto");

      assert.deepEqual(activations.map((entry) => entry.model), [
        "openai/gpt-4.1-mini",
        "google/gemini-2.5-flash",
        "chatgpt-codex-oauth/auto",
        "google/gemini-2.5-flash",
        "chatgpt-codex-oauth/auto",
      ]);
    } finally {
      await activationServer.close();
    }

    const publicCallbackStateStore = new InMemoryOpenAIOAuthStateStore();
    const publicCallbackStart = await buildOpenAIOAuthStart({
      userId: "user-public-callback",
      stateStore: publicCallbackStateStore,
      config: {
        clientId: "client_public",
        authorizationUrl: "https://auth.example.test/oauth/authorize",
        tokenUrl: "https://auth.example.test/oauth/token",
      },
    });
    const publicActivations: Array<{ userId: string; model: string }> = [];
    const publicCallbackApp = express();
    registerPublicOpenAIProviderAuthCallbackRoutes(publicCallbackApp, {
      repo,
      stateStore: publicCallbackStateStore,
      activateModelPreference: async (userId, model) => {
        publicActivations.push({ userId, model });
        return { selectedModel: model, chat: model, planning: model, memory: model, research: model, orchestrator: model };
      },
      exchangeCodeForTokens: async () => ({
        accessToken: "oauth-public-access-token",
        refreshToken: "oauth-public-refresh-token",
        expiresAt: new Date(Date.now() + 3600_000),
        accountId: "acct_public",
        email: "public-openai-user@example.com",
      }),
    });
    const publicCallbackServer = await listen(publicCallbackApp);
    try {
      const response = await fetch(
        `http://127.0.0.1:${publicCallbackServer.port}/api/auth/openai-oauth/callback?code=public-code&state=${encodeURIComponent(publicCallbackStart.state)}`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(publicActivations, [{
        userId: "user-public-callback",
        model: "chatgpt-codex-oauth/auto",
      }]);
    } finally {
      await publicCallbackServer.close();
    }

    assert.throws(
      () => parseOpenAICallbackUrl("http://127.0.0.1:1455/auth/callback?state=missing-code"),
      /callback URL is missing an authorization code/,
    );

    console.log("OK: OpenAI OAuth start builds PKCE login URLs with the localhost redirect URI");
    console.log("OK: ChatGPT subscription OAuth starts with built-in Codex login defaults when env config is absent");
    console.log("OK: OpenAI OAuth config reads the documented plural scopes env var");
    console.log("OK: manual callback URL handling validates state and stores encrypted OAuth profiles");
    console.log("OK: OpenAI API-key request handling trims and stores API-key profiles");
    console.log("OK: generic provider API keys store per-user provider profiles");
    console.log("OK: provider key, disconnect, and default-model routes activate one global selected model");
    console.log("OK: public OpenAI OAuth callback activates the ChatGPT/Codex selected model");
  } finally {
    if (previousSecret == null) delete process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
    else process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = previousSecret;
    if (previousClientId == null) delete process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID;
    else process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID = previousClientId;
    if (previousAuthorizationUrl == null) delete process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL;
    else process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL = previousAuthorizationUrl;
    if (previousTokenUrl == null) delete process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL;
    else process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL = previousTokenUrl;
    if (previousUserInfoUrl == null) delete process.env.JARVIS_OPENAI_OAUTH_USERINFO_URL;
    else process.env.JARVIS_OPENAI_OAUTH_USERINFO_URL = previousUserInfoUrl;
    if (previousScopes == null) delete process.env.JARVIS_OPENAI_OAUTH_SCOPES;
    else process.env.JARVIS_OPENAI_OAUTH_SCOPES = previousScopes;
    if (previousSingularScope == null) delete process.env.JARVIS_OPENAI_OAUTH_SCOPE;
    else process.env.JARVIS_OPENAI_OAUTH_SCOPE = previousSingularScope;
    if (previousAuthorizationParams == null) delete process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_PARAMS;
    else process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_PARAMS = previousAuthorizationParams;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
