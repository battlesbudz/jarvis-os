import assert from "node:assert/strict";
import {
  InMemoryModelProviderAuthProfileRepository,
  getProviderCredential,
  saveProviderApiKeyProfile,
} from "../providers/modelProviderAuthProfiles";
import {
  DEFAULT_OPENAI_OAUTH_REDIRECT_URI,
  InMemoryOpenAIOAuthStateStore,
  buildOpenAIOAuthStart,
  completeOpenAIOAuthCallback,
  getOpenAIOAuthConfigFromEnv,
  parseOpenAICallbackUrl,
  saveOpenAIApiKeyFromRequest,
} from "../../routes/openaiProviderAuthRoutes";

async function main() {
  const previousSecret = process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
  const previousClientId = process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID;
  const previousAuthorizationUrl = process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL;
  const previousTokenUrl = process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL;
  const previousScopes = process.env.JARVIS_OPENAI_OAUTH_SCOPES;
  const previousSingularScope = process.env.JARVIS_OPENAI_OAUTH_SCOPE;
  process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = "test-secret-for-openai-auth-routes";

  try {
    process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID = "client_from_env";
    process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL = "https://auth.example.test/oauth/authorize";
    process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL = "https://auth.example.test/oauth/token";
    process.env.JARVIS_OPENAI_OAUTH_SCOPES = "openid profile email";
    delete process.env.JARVIS_OPENAI_OAUTH_SCOPE;
    assert.deepEqual(getOpenAIOAuthConfigFromEnv()?.scopes, ["openid", "profile", "email"]);

    const repo = new InMemoryModelProviderAuthProfileRepository();
    const stateStore = new InMemoryOpenAIOAuthStateStore();

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

    assert.throws(
      () => parseOpenAICallbackUrl("http://127.0.0.1:1455/auth/callback?state=missing-code"),
      /callback URL is missing an authorization code/,
    );

    console.log("OK: OpenAI OAuth start builds PKCE login URLs with the localhost redirect URI");
    console.log("OK: OpenAI OAuth config reads the documented plural scopes env var");
    console.log("OK: manual callback URL handling validates state and stores encrypted OAuth profiles");
    console.log("OK: OpenAI API-key request handling trims and stores API-key profiles");
    console.log("OK: generic provider API keys store per-user provider profiles");
  } finally {
    if (previousSecret == null) delete process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
    else process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = previousSecret;
    if (previousClientId == null) delete process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID;
    else process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID = previousClientId;
    if (previousAuthorizationUrl == null) delete process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL;
    else process.env.JARVIS_OPENAI_OAUTH_AUTHORIZATION_URL = previousAuthorizationUrl;
    if (previousTokenUrl == null) delete process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL;
    else process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL = previousTokenUrl;
    if (previousScopes == null) delete process.env.JARVIS_OPENAI_OAUTH_SCOPES;
    else process.env.JARVIS_OPENAI_OAUTH_SCOPES = previousScopes;
    if (previousSingularScope == null) delete process.env.JARVIS_OPENAI_OAUTH_SCOPE;
    else process.env.JARVIS_OPENAI_OAUTH_SCOPE = previousSingularScope;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
