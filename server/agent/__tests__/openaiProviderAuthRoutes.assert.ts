import assert from "node:assert/strict";
import {
  InMemoryModelProviderAuthProfileRepository,
  getProviderCredential,
} from "../providers/modelProviderAuthProfiles";
import {
  DEFAULT_OPENAI_OAUTH_REDIRECT_URI,
  InMemoryOpenAIOAuthStateStore,
  buildOpenAIOAuthStart,
  completeOpenAIOAuthCallback,
  parseOpenAICallbackUrl,
  saveOpenAIApiKeyFromRequest,
} from "../../routes/openaiProviderAuthRoutes";

async function main() {
  const previousSecret = process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
  process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = "test-secret-for-openai-auth-routes";

  try {
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

    assert.throws(
      () => parseOpenAICallbackUrl("http://127.0.0.1:1455/auth/callback?state=missing-code"),
      /callback URL is missing an authorization code/,
    );

    console.log("OK: OpenAI OAuth start builds PKCE login URLs with the localhost redirect URI");
    console.log("OK: manual callback URL handling validates state and stores encrypted OAuth profiles");
    console.log("OK: OpenAI API-key request handling trims and stores API-key profiles");
  } finally {
    if (previousSecret == null) delete process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
    else process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = previousSecret;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
