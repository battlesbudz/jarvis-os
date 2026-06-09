import assert from "node:assert/strict";
import type OpenAI from "openai";
import {
  OpenAIProvider,
  _setOpenAIProviderClientFactoryForTesting,
  _setOpenAIProviderCredentialResolverForTesting,
} from "../providers/openai";

async function collect(provider: OpenAIProvider, userId?: string) {
  const chunks = [];
  for await (const chunk of provider.query({
    model: "gpt-test",
    messages: [{ role: "user", content: "Hello" }],
    toolChoice: "none",
    maxCompletionTokens: 32,
    stream: false,
    userId,
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

async function main() {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousAlias = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const previousPreferred = process.env.JARVIS_OPENAI_PREFERRED_AUTH_TYPE;
  const previousFallback = process.env.JARVIS_OPENAI_AUTH_FALLBACK_ENABLED;
  process.env.OPENAI_API_KEY = "env-openai-key";
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  process.env.JARVIS_OPENAI_PREFERRED_AUTH_TYPE = "oauth";
  delete process.env.JARVIS_OPENAI_AUTH_FALLBACK_ENABLED;

  const clientConfigs: Array<{ apiKey: string; baseURL?: string }> = [];
  const resolverCalls: any[] = [];

  try {
    _setOpenAIProviderClientFactoryForTesting((config) => {
      clientConfigs.push(config);
      return {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: { content: "provider ok", tool_calls: [] },
                  finish_reason: "stop",
                },
              ],
            }),
          },
        },
      } as unknown as OpenAI;
    });

    _setOpenAIProviderCredentialResolverForTesting(async (input) => {
      resolverCalls.push(input);
      return {
        provider: "openai",
        authType: "oauth",
        credential: "oauth-access-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() + 60_000),
        accountId: "acct_runtime",
        email: "runtime@example.com",
      };
    });

    const provider = new OpenAIProvider();
    assert.deepEqual(await collect(provider, "user-1"), [
      { type: "text", delta: "provider ok" },
      { type: "finish", reason: "stop" },
    ]);

    assert.equal(clientConfigs[0].apiKey, "oauth-access-token");
    assert.equal(resolverCalls[0].userId, "user-1");
    assert.equal(resolverCalls[0].provider, "openai");
    assert.equal(resolverCalls[0].preferredAuthType, "oauth");
    assert.equal(resolverCalls[0].allowAuthTypeFallback, false);

    _setOpenAIProviderCredentialResolverForTesting(async () => null);
    await collect(provider);
    assert.equal(clientConfigs[1].apiKey, "env-openai-key");

    process.env.JARVIS_OPENAI_AUTH_FALLBACK_ENABLED = "true";
    _setOpenAIProviderCredentialResolverForTesting(async (input) => {
      resolverCalls.push(input);
      return null;
    });
    await collect(provider, "user-2");
    assert.equal(resolverCalls.at(-1).allowAuthTypeFallback, true);

    console.log("OK: OpenAI provider resolves user-scoped provider credentials before env config");
    console.log("OK: OpenAI provider keeps OAuth/API-key fallback disabled unless explicitly enabled");
  } finally {
    _setOpenAIProviderClientFactoryForTesting(null);
    _setOpenAIProviderCredentialResolverForTesting(null);
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousAlias == null) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previousAlias;
    if (previousPreferred == null) delete process.env.JARVIS_OPENAI_PREFERRED_AUTH_TYPE;
    else process.env.JARVIS_OPENAI_PREFERRED_AUTH_TYPE = previousPreferred;
    if (previousFallback == null) delete process.env.JARVIS_OPENAI_AUTH_FALLBACK_ENABLED;
    else process.env.JARVIS_OPENAI_AUTH_FALLBACK_ENABLED = previousFallback;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
