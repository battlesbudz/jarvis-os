import assert from "node:assert/strict";
import { accumulateTurn } from "../providers/base";
import { AnthropicProvider, _setAnthropicFetchForTesting, _setAnthropicCredentialResolverForTesting } from "../providers/anthropic";
import { GoogleProvider, _setGoogleFetchForTesting, _setGoogleCredentialResolverForTesting } from "../providers/google";
import {
  OpenAICompatibleProvider,
  _setOpenAICompatibleCredentialResolverForTesting,
  _setOpenAICompatibleProviderClientFactoryForTesting,
} from "../providers/openaiCompatible";

async function testAnthropicUsesUserCredential() {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  _setAnthropicCredentialResolverForTesting(async (input) => {
    assert.equal(input.userId, "user-claude");
    assert.equal(input.provider, "anthropic");
    assert.equal(input.preferredAuthType, "api_key");
    return {
      provider: "anthropic",
      authType: "api_key",
      credential: "sk-ant-user",
      refreshToken: null,
      expiresAt: null,
      accountId: null,
      email: null,
    };
  });
  _setAnthropicFetchForTesting(async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "hello from claude" }],
      stop_reason: "end_turn",
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await accumulateTurn(new AnthropicProvider().query({
    model: "anthropic/claude-sonnet-4-5",
    messages: [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hello" },
    ],
    toolChoice: "none",
    maxCompletionTokens: 128,
    stream: false,
    userId: "user-claude",
  }));

  assert.equal(result.textContent, "hello from claude");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal((requests[0].init.headers as Record<string, string>)["x-api-key"], "sk-ant-user");
  assert.match(String(requests[0].init.body), /"model":"claude-sonnet-4-5"/);
  console.log("OK: Anthropic provider uses user-scoped API key profiles");

  _setAnthropicFetchForTesting(null);
  _setAnthropicCredentialResolverForTesting(null);
}

async function testGoogleUsesUserCredential() {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  _setGoogleCredentialResolverForTesting(async (input) => {
    assert.equal(input.userId, "user-gemini");
    assert.equal(input.provider, "google");
    assert.equal(input.preferredAuthType, "api_key");
    return {
      provider: "google",
      authType: "api_key",
      credential: "gemini-user-key",
      refreshToken: null,
      expiresAt: null,
      accountId: null,
      email: null,
    };
  });
  _setGoogleFetchForTesting(async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: "hello from gemini" }] },
        finishReason: "STOP",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await accumulateTurn(new GoogleProvider().query({
    model: "google/gemini-2.5-pro",
    messages: [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hello" },
    ],
    toolChoice: "none",
    maxCompletionTokens: 128,
    stream: false,
    userId: "user-gemini",
  }));

  assert.equal(result.textContent, "hello from gemini");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent");
  assert.equal((requests[0].init.headers as Record<string, string>)["x-goog-api-key"], "gemini-user-key");
  assert.match(String(requests[0].init.body), /"maxOutputTokens":128/);
  console.log("OK: Google Gemini provider uses user-scoped API key profiles");

  _setGoogleFetchForTesting(null);
  _setGoogleCredentialResolverForTesting(null);
}

async function testGoogleToolResponseUsesOriginalFunctionName() {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  _setGoogleCredentialResolverForTesting(async () => ({
    provider: "google",
    authType: "api_key",
    credential: "gemini-user-key",
    refreshToken: null,
    expiresAt: null,
    accountId: null,
    email: null,
  }));
  _setGoogleFetchForTesting(async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: "lookup_weather",
                args: { city: "Nashville" },
              },
            }],
          },
          finishReason: "STOP",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: "It is warm." }] },
        finishReason: "STOP",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const firstTurn = await accumulateTurn(new GoogleProvider().query({
    model: "google/gemini-2.5-pro",
    messages: [{ role: "user", content: "Weather?" }],
    tools: [{
      type: "function",
      function: {
        name: "lookup_weather",
        description: "Look up weather.",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    }],
    toolChoice: "auto",
    maxCompletionTokens: 128,
    stream: false,
    userId: "user-gemini",
  }));
  assert.equal(firstTurn.toolCallList[0].function.name, "lookup_weather");

  await accumulateTurn(new GoogleProvider().query({
    model: "google/gemini-2.5-pro",
    messages: [
      { role: "user", content: "Weather?" },
      { role: "assistant", content: null, tool_calls: firstTurn.toolCallList },
      {
        role: "tool",
        tool_call_id: firstTurn.toolCallList[0].id,
        content: JSON.stringify({ temperature: "78F" }),
      },
    ],
    toolChoice: "none",
    maxCompletionTokens: 128,
    stream: false,
    userId: "user-gemini",
  }));

  const followUpBody = JSON.parse(String(requests[1].init.body));
  const functionResponse = followUpBody.contents
    .flatMap((content: any) => content.parts)
    .find((part: any) => part.functionResponse)?.functionResponse;
  assert.equal(functionResponse.name, "lookup_weather");
  console.log("OK: Google Gemini tool responses preserve the original function name");

  _setGoogleFetchForTesting(null);
  _setGoogleCredentialResolverForTesting(null);
}

async function testOpenAICompatibleUsesLocalUserCredential() {
  const clientConfigs: Array<{ baseURL: string; apiKey: string }> = [];
  const requests: Array<{ body: any; options: any }> = [];
  _setOpenAICompatibleCredentialResolverForTesting(async (input) => {
    assert.equal(input.userId, "user-local");
    assert.equal(input.provider, "local-llama");
    assert.equal(input.preferredAuthType, "api_key");
    assert.equal(input.allowAuthTypeFallback, false);
    return {
      provider: "local-llama",
      authType: "api_key",
      credential: "local-user-key",
      refreshToken: null,
      expiresAt: null,
      accountId: null,
      email: null,
    };
  });
  _setOpenAICompatibleProviderClientFactoryForTesting((config) => {
    clientConfigs.push(config);
    return {
      chat: {
        completions: {
          create: async (body: any, options: any) => {
            requests.push({ body, options });
            return {
              choices: [{
                message: { content: "hello from local llama", tool_calls: [] },
                finish_reason: "stop",
              }],
            };
          },
        },
      },
    } as any;
  });

  const result = await accumulateTurn(new OpenAICompatibleProvider().query({
    model: "openai-compatible/llama-local",
    messages: [{ role: "user", content: "Hello" }],
    toolChoice: "none",
    maxCompletionTokens: 128,
    stream: false,
    userId: "user-local",
  }));

  assert.equal(result.textContent, "hello from local llama");
  assert.deepEqual(clientConfigs, [{
    baseURL: "http://127.0.0.1:7352/v1",
    apiKey: "local-user-key",
  }]);
  assert.equal(requests[0].body.model, "llama-local");
  assert.equal(requests[0].body.max_completion_tokens, 128);
  console.log("OK: OpenAI-compatible Local Llama provider uses user-scoped API key profiles");

  _setOpenAICompatibleProviderClientFactoryForTesting(null);
  _setOpenAICompatibleCredentialResolverForTesting(null);
}

async function main() {
  await testAnthropicUsesUserCredential();
  await testGoogleUsesUserCredential();
  await testGoogleToolResponseUsesOriginalFunctionName();
  await testOpenAICompatibleUsesLocalUserCredential();
  console.log("\nAll provider runtime adapter assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
