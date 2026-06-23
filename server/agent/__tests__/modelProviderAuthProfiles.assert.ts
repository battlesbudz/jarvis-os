import assert from "node:assert/strict";
import {
  InMemoryModelProviderAuthProfileRepository,
  getProviderCredential,
  getProviderStatus,
  saveOpenAIApiKeyProfile,
  saveOpenAIOAuthProfile,
} from "../providers/modelProviderAuthProfiles";
import {
  DEFAULT_CHATGPT_CODEX_OAUTH_CLIENT_ID,
  DEFAULT_CHATGPT_CODEX_OAUTH_TOKEN_URL,
} from "../providers/openaiOAuthDefaults";

async function main() {
  const previousSecret = process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
  const previousLegacySecret = process.env.MODEL_PROVIDER_AUTH_ENCRYPTION_KEY;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousClientId = process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID;
  const previousTokenUrl = process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL;
  const previousOpenAIClientId = process.env.OPENAI_OAUTH_CLIENT_ID;
  const previousOpenAITokenUrl = process.env.OPENAI_OAUTH_TOKEN_URL;
  const originalFetch = globalThis.fetch;

  try {
    delete process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
    delete process.env.MODEL_PROVIDER_AUTH_ENCRYPTION_KEY;
    process.env.JWT_SECRET = "jwt-secret-must-not-encrypt-provider-credentials";
    await assert.rejects(
      () =>
        saveOpenAIApiKeyProfile({
          repo: new InMemoryModelProviderAuthProfileRepository(),
          userId: "user-missing-encryption-key",
          apiKey: "sk-test-api-key",
        }),
      /JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY is required/,
    );

    process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = "test-secret-for-provider-auth-profiles";
    const repo = new InMemoryModelProviderAuthProfileRepository();

    const apiProfile = await saveOpenAIApiKeyProfile({
      repo,
      userId: "user-1",
      apiKey: "sk-test-api-key",
      isDefault: true,
    });

    assert.equal(apiProfile.provider, "openai");
    assert.equal(apiProfile.authType, "api_key");
    assert.equal(apiProfile.isDefault, true);
    assert.equal(apiProfile.apiKeyEncrypted?.includes("sk-test-api-key"), false);
    assert.equal(apiProfile.accessTokenEncrypted, null);

    const apiCredential = await getProviderCredential({
      repo,
      userId: "user-1",
      provider: "openai",
      preferredAuthType: "api_key",
    });
    assert.equal(apiCredential?.authType, "api_key");
    assert.equal(apiCredential?.credential, "sk-test-api-key");
    assert.equal(apiCredential?.accountId, null);

    const oauthProfile = await saveOpenAIOAuthProfile({
      repo,
      userId: "user-1",
      accessToken: "oauth-access-token",
      refreshToken: "oauth-refresh-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      accountId: "acct_123",
      email: "person@example.com",
      isDefault: true,
    });

    assert.equal(oauthProfile.provider, "openai");
    assert.equal(oauthProfile.authType, "oauth");
    assert.equal(oauthProfile.isDefault, true);
    assert.equal(oauthProfile.accessTokenEncrypted?.includes("oauth-access-token"), false);
    assert.equal(oauthProfile.refreshTokenEncrypted?.includes("oauth-refresh-token"), false);

    const status = await getProviderStatus({ repo, userId: "user-1" });
    assert.equal(status.openai.connected, true);
    assert.equal(status.openai.defaultAuthType, "oauth");
    assert.equal(status.openai.authTypes.oauth.connected, true);
    assert.equal(status.openai.authTypes.oauth.email, "person@example.com");
    assert.equal(status.openai.authTypes.api_key.connected, true);
    assert.equal(JSON.stringify(status).includes("oauth-access-token"), false);
    assert.equal(JSON.stringify(status).includes("sk-test-api-key"), false);

    const defaultCredential = await getProviderCredential({
      repo,
      userId: "user-1",
      provider: "openai",
      preferredAuthType: "oauth",
    });
    assert.equal(defaultCredential?.authType, "oauth");
    assert.equal(defaultCredential?.credential, "oauth-access-token");
    assert.equal(defaultCredential?.refreshToken, "oauth-refresh-token");
    assert.equal(defaultCredential?.accountId, "acct_123");
    assert.equal(defaultCredential?.email, "person@example.com");

    await saveOpenAIOAuthProfile({
      repo,
      userId: "user-1",
      accessToken: "oauth-access-token-reconnected",
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      accountId: "acct_123",
      email: "person@example.com",
      isDefault: true,
    });
    const reconnectedCredential = await getProviderCredential({
      repo,
      userId: "user-1",
      provider: "openai",
      preferredAuthType: "oauth",
    });
    assert.equal(reconnectedCredential?.credential, "oauth-access-token-reconnected");
    assert.equal(reconnectedCredential?.refreshToken, "oauth-refresh-token");

    await assert.rejects(
      () => getProviderCredential({
        repo,
        userId: "user-1",
        provider: "openai",
        preferredAuthType: "oauth",
        now: new Date(Date.now() + 2 * 60 * 60 * 1000),
        refresh: async () => null,
      }),
      /OpenAI OAuth token is expired and refresh failed/,
    );

    await saveOpenAIOAuthProfile({
      repo,
      userId: "user-refresh-defaults",
      accessToken: "expired-oauth-access-token",
      refreshToken: "default-refresh-token",
      expiresAt: new Date(Date.now() - 60_000),
      accountId: "acct_refresh",
      email: "refresh@example.com",
      isDefault: true,
    });
    delete process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID;
    delete process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL;
    delete process.env.OPENAI_OAUTH_CLIENT_ID;
    delete process.env.OPENAI_OAUTH_TOKEN_URL;
    const refreshRequests: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      refreshRequests.push({
        url: String(input),
        body: String(init?.body ?? ""),
      });
      return new Response(JSON.stringify({
        access_token: "refreshed-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
        account_id: "acct_refresh",
        email: "refresh@example.com",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const refreshedCredential = await getProviderCredential({
      repo,
      userId: "user-refresh-defaults",
      provider: "openai",
      preferredAuthType: "oauth",
    });
    assert.equal(refreshedCredential?.credential, "refreshed-access-token");
    assert.equal(refreshedCredential?.refreshToken, "rotated-refresh-token");
    assert.equal(refreshRequests.length, 1);
    assert.equal(refreshRequests[0]?.url, DEFAULT_CHATGPT_CODEX_OAUTH_TOKEN_URL);
    assert.match(refreshRequests[0]?.body ?? "", new RegExp(`client_id=${DEFAULT_CHATGPT_CODEX_OAUTH_CLIENT_ID}`));
    assert.match(refreshRequests[0]?.body ?? "", /refresh_token=default-refresh-token/);

    const fallbackBlocked = await getProviderCredential({
      repo,
      userId: "user-2",
      provider: "openai",
      preferredAuthType: "oauth",
      allowAuthTypeFallback: false,
    });
    assert.equal(fallbackBlocked, null);

    await saveOpenAIApiKeyProfile({
      repo,
      userId: "user-3",
      apiKey: "sk-only-key",
      isDefault: true,
    });

    const noSilentFallback = await getProviderCredential({
      repo,
      userId: "user-3",
      provider: "openai",
      preferredAuthType: "oauth",
      allowAuthTypeFallback: false,
    });
    assert.equal(noSilentFallback, null);

    const explicitFallback = await getProviderCredential({
      repo,
      userId: "user-3",
      provider: "openai",
      preferredAuthType: "oauth",
      allowAuthTypeFallback: true,
    });
    assert.equal(explicitFallback?.authType, "api_key");
    assert.equal(explicitFallback?.credential, "sk-only-key");

    console.log("OK: model provider auth profiles store encrypted OpenAI API-key and OAuth credentials");
    console.log("OK: built-in ChatGPT/Codex OAuth profiles refresh without env config");
    console.log("OK: provider status is redacted and auth-type fallback is explicit only");
    console.log("OK: provider credentials require a dedicated encryption key");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousSecret == null) delete process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
    else process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = previousSecret;
    if (previousLegacySecret == null) delete process.env.MODEL_PROVIDER_AUTH_ENCRYPTION_KEY;
    else process.env.MODEL_PROVIDER_AUTH_ENCRYPTION_KEY = previousLegacySecret;
    if (previousJwtSecret == null) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousClientId == null) delete process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID;
    else process.env.JARVIS_OPENAI_OAUTH_CLIENT_ID = previousClientId;
    if (previousTokenUrl == null) delete process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL;
    else process.env.JARVIS_OPENAI_OAUTH_TOKEN_URL = previousTokenUrl;
    if (previousOpenAIClientId == null) delete process.env.OPENAI_OAUTH_CLIENT_ID;
    else process.env.OPENAI_OAUTH_CLIENT_ID = previousOpenAIClientId;
    if (previousOpenAITokenUrl == null) delete process.env.OPENAI_OAUTH_TOKEN_URL;
    else process.env.OPENAI_OAUTH_TOKEN_URL = previousOpenAITokenUrl;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
