import assert from "node:assert/strict";
import {
  InMemoryModelProviderAuthProfileRepository,
  getProviderCredential,
  getProviderStatus,
  saveOpenAIApiKeyProfile,
  saveOpenAIOAuthProfile,
} from "../providers/modelProviderAuthProfiles";

async function main() {
  const previousSecret = process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
  process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = "test-secret-for-provider-auth-profiles";

  try {
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
    console.log("OK: provider status is redacted and auth-type fallback is explicit only");
  } finally {
    if (previousSecret == null) delete process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY;
    else process.env.JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY = previousSecret;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
