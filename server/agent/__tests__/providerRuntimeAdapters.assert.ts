import assert from "node:assert/strict";
import { accumulateTurn } from "../providers/base";
import { AnthropicProvider, _setAnthropicFetchForTesting, _setAnthropicCredentialResolverForTesting } from "../providers/anthropic";
import { GoogleProvider, _setGoogleFetchForTesting, _setGoogleCredentialResolverForTesting } from "../providers/google";
import {
  OpenAICompatibleProvider,
  _setOpenAICompatibleCredentialResolverForTesting,
  _setOpenAICompatibleProviderClientFactoryForTesting,
} from "../providers/openaiCompatible";
import {
  AndroidLocalGemmaProvider,
  _setAndroidLocalGemmaDaemonOpForTesting,
} from "../providers/androidLocalGemma";

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
    responseFormat: { type: "json_object" },
    stream: false,
    userId: "user-claude",
  }));

  assert.equal(result.textContent, "hello from claude");
  assert.equal(result.finishReason, "stop");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal((requests[0].init.headers as Record<string, string>)["x-api-key"], "sk-ant-user");
  assert.match(String(requests[0].init.body), /"model":"claude-sonnet-4-5"/);
  assert.match(String(requests[0].init.body), /Return only a single valid JSON object/);
  console.log("OK: Anthropic provider uses user-scoped API key profiles");

  _setAnthropicFetchForTesting(null);
  _setAnthropicCredentialResolverForTesting(null);
}

async function testAnthropicToolUseFinishReasonIsToolCalls() {
  _setAnthropicCredentialResolverForTesting(async () => ({
    provider: "anthropic",
    authType: "api_key",
    credential: "sk-ant-user",
    refreshToken: null,
    expiresAt: null,
    accountId: null,
    email: null,
  }));
  _setAnthropicFetchForTesting(async () => new Response(JSON.stringify({
    content: [{
      type: "tool_use",
      id: "toolu_123",
      name: "lookup_weather",
      input: { city: "Nashville" },
    }],
    stop_reason: "tool_use",
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const result = await accumulateTurn(new AnthropicProvider().query({
    model: "anthropic/claude-sonnet-4-5",
    messages: [{ role: "user", content: "Weather?" }],
    tools: [{
      type: "function",
      function: {
        name: "lookup_weather",
        description: "Look up weather.",
        parameters: { type: "object", properties: {} },
      },
    }],
    toolChoice: "auto",
    maxCompletionTokens: 128,
    stream: false,
    userId: "user-claude",
  }));

  assert.equal(result.finishReason, "tool_calls");
  assert.equal(result.toolCallList[0].function.name, "lookup_weather");
  console.log("OK: Anthropic provider normalizes tool-use stops to tool_calls");

  _setAnthropicFetchForTesting(null);
  _setAnthropicCredentialResolverForTesting(null);
}

async function testAnthropicToolChoiceNoneOmitsTools() {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  _setAnthropicCredentialResolverForTesting(async () => ({
    provider: "anthropic",
    authType: "api_key",
    credential: "sk-ant-user",
    refreshToken: null,
    expiresAt: null,
    accountId: null,
    email: null,
  }));
  _setAnthropicFetchForTesting(async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "no tools" }],
      stop_reason: "end_turn",
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  await accumulateTurn(new AnthropicProvider().query({
    model: "anthropic/claude-sonnet-4-5",
    messages: [{ role: "user", content: "Hello" }],
    tools: [{
      type: "function",
      function: {
        name: "lookup_weather",
        description: "Look up weather.",
        parameters: { type: "object", properties: {} },
      },
    }],
    toolChoice: "none",
    maxCompletionTokens: 128,
    stream: false,
    userId: "user-claude",
  }));

  const body = JSON.parse(String(requests[0].init.body));
  assert.equal("tools" in body, false);
  assert.equal("tool_choice" in body, false);
  console.log("OK: Anthropic provider omits tools when tool choice is none");

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
    responseFormat: { type: "json_object" },
    stream: false,
    userId: "user-gemini",
  }));

  assert.equal(result.textContent, "hello from gemini");
  assert.equal(result.finishReason, "stop");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent");
  assert.equal((requests[0].init.headers as Record<string, string>)["x-goog-api-key"], "gemini-user-key");
  assert.match(String(requests[0].init.body), /"maxOutputTokens":128/);
  assert.match(String(requests[0].init.body), /"responseMimeType":"application\/json"/);
  console.log("OK: Google Gemini provider uses user-scoped API key profiles");

  _setGoogleFetchForTesting(null);
  _setGoogleCredentialResolverForTesting(null);
}

async function testGoogleEmptyBlockedResponseIsVisibleFailure() {
  _setGoogleCredentialResolverForTesting(async () => ({
    provider: "google",
    authType: "api_key",
    credential: "gemini-user-key",
    refreshToken: null,
    expiresAt: null,
    accountId: null,
    email: null,
  }));
  _setGoogleFetchForTesting(async () => new Response(JSON.stringify({
    promptFeedback: {
      blockReason: "SAFETY",
    },
    candidates: [{
      content: { parts: [] },
      finishReason: "SAFETY",
      safetyRatings: [{
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        probability: "HIGH",
      }],
    }],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  await assert.rejects(
    () => accumulateTurn(new GoogleProvider().query({
      model: "google/gemini-2.5-pro",
      messages: [{ role: "user", content: "Hello" }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-gemini",
    })),
    /Google Gemini returned no response text.*SAFETY/i,
  );
  console.log("OK: Google Gemini empty blocked responses fail visibly instead of returning blank chat output");

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
  assert.equal(firstTurn.finishReason, "tool_calls");

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

async function testGoogleToolResponseMapsOpenAIToolCallIdsToFunctionNames() {
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
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: "It is warm." }] },
        finishReason: "STOP",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  await accumulateTurn(new GoogleProvider().query({
    model: "google/gemini-2.5-pro",
    messages: [
      { role: "user", content: "Weather?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_openai_123",
          type: "function",
          function: {
            name: "lookup_weather",
            arguments: JSON.stringify({ city: "Nashville" }),
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: "call_openai_123",
        content: JSON.stringify({ temperature: "78F" }),
      },
    ],
    toolChoice: "none",
    maxCompletionTokens: 128,
    stream: false,
    userId: "user-gemini",
  }));

  const body = JSON.parse(String(requests[0].init.body));
  const functionResponse = body.contents
    .flatMap((content: any) => content.parts)
    .find((part: any) => part.functionResponse)?.functionResponse;
  assert.equal(functionResponse.name, "lookup_weather");
  console.log("OK: Google Gemini tool responses map OpenAI-style tool call IDs to function names");

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
    responseFormat: { type: "json_object" },
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
  assert.deepEqual(requests[0].body.response_format, { type: "json_object" });
  console.log("OK: OpenAI-compatible Local Llama provider uses user-scoped API key profiles");

  _setOpenAICompatibleProviderClientFactoryForTesting(null);
  _setOpenAICompatibleCredentialResolverForTesting(null);
}

async function testAndroidLocalGemmaUsesAndroidAppDaemonGenerateOp() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: "hello from phone gemma",
        finishReason: "stop",
        model: "gemma-4-e4b-it",
        runtime: "android-local-gemma",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 8192,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "hello from phone gemma");
    assert.equal(result.finishReason, "stop");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].userId, "user-phone");
    assert.equal(requests[0].op.type, "android_local_model_generate");
    assert.match(requests[0].op.requestId, /^phone-gemma-/);
    assert.equal(requests[0].op.model, "gemma-4-e4b-it");
    assert.match(requests[0].op.prompt, /system: Be concise\./);
    assert.match(requests[0].op.prompt, /user: Hello/);
    assert.equal(requests[0].op.contextTokens, 1024);
    assert.equal(requests[0].op.maxTokens, 128);
    assert.ok(requests[0].timeoutMs >= 60000);
    console.log("OK: Android Local Gemma provider sends generation to the Jarvis Android app daemon runtime");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaEmitsLocalHarnessToolCalls() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "daemon_action", arguments: { action: "screenshot" } }],
        }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Can you screenshot my phone?" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: { type: "object", properties: { action: { type: "string" } }, required: ["action"] },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "daemon_action");
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"screenshot"}');
    assert.match(requests[0].op.prompt, /running entirely through Android Local Gemma/);
    assert.match(requests[0].op.prompt, /Available tools/);
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma can emit local harness tool calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsPlainAutoChatOffToolProtocol() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  const largeSchema = Object.fromEntries(
    Array.from({ length: 60 }, (_, index) => [`field_${index}`, { type: "string", description: `oversized schema field ${index}` }]),
  );

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: "Hi - I am running locally on your phone.", finishReason: "stop" },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Hi" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: `Perform an Android daemon action. ${"oversized_description_marker ".repeat(200)}`,
          parameters: { type: "object", properties: largeSchema, required: ["field_0"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "Hi - I am running locally on your phone.");
    assert.equal(requests.length, 1);
    assert.doesNotMatch(requests[0].op.prompt, /Available tools/);
    assert.doesNotMatch(requests[0].op.prompt, /oversized_description_marker/);
    assert.ok(requests[0].op.prompt.length <= 3600);
    console.log("OK: Android Local Gemma keeps plain auto-tool chat off the local tool protocol");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaCompactsLocalToolPrompt() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  const largeSchema = {
    action: { type: "string", enum: ["android_read_screen", "android_screenshot", "android_tap"] },
    ...Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [`action_field_${index}`, { type: "string", description: `large nested schema field ${index}` }]),
    ),
  };

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "daemon_action", arguments: { action: "android_screenshot" } }],
        }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Can you screenshot my phone?" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: `Perform an Android daemon action. ${"safe compact description ".repeat(20)} large_description_tail ${"extra ".repeat(200)}`,
          parameters: { type: "object", properties: largeSchema, required: ["action"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCallList[0].function.name, "daemon_action");
    assert.match(requests[0].op.prompt, /Available tools/);
    assert.match(requests[0].op.prompt, /Args: action/);
    assert.match(requests[0].op.prompt, /action enum: android_read_screen, android_screenshot, android_tap/);
    assert.doesNotMatch(requests[0].op.prompt, /"properties"/);
    assert.doesNotMatch(requests[0].op.prompt, /large_description_tail/);
    assert.ok(requests[0].op.prompt.length <= 3600);
    console.log("OK: Android Local Gemma compacts local tool prompts for phone inference");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesSystemGuardrailsWhenTrimming() {
  const previousBudget = process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET;
  process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET = "1200";
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: JSON.stringify({ type: "final", content: "I can use local Android tools when needed." }), finishReason: "stop" },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        {
          role: "system",
          content: `System rules start. ${"long workspace context ".repeat(120)} MUST_PREFER_ANDROID_READ_SCREEN_BEFORE_SCREENSHOT`,
        },
        { role: "user", content: "Can you screenshot my phone?" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["android_read_screen", "android_screenshot"] },
            },
            required: ["action"],
          },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I can use local Android tools when needed.");
    assert.match(requests[0].op.prompt, /MUST_PREFER_ANDROID_READ_SCREEN_BEFORE_SCREENSHOT/);
    assert.match(requests[0].op.prompt, /user: Can you screenshot my phone\?/);
    console.log("OK: Android Local Gemma preserves system guardrails when trimming prompt context");
  } finally {
    if (previousBudget === undefined) delete process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET;
    else process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET = previousBudget;
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesNewestTurnWhenTrimming() {
  const previousBudget = process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET;
  process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET = "1200";
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: "latest turn preserved", finishReason: "stop" },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "STALE_OLDER_TURN_THAT_WOULD_FIT" },
        { role: "assistant", content: "Old answer." },
        { role: "user", content: `${"very long current request ".repeat(180)} CURRENT_REQUEST_TAIL_MARKER` },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "latest turn preserved");
    assert.match(requests[0].op.prompt, /CURRENT_REQUEST_TAIL_MARKER/);
    console.log("OK: Android Local Gemma preserves the newest turn when trimming prompt context");
  } finally {
    if (previousBudget === undefined) delete process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET;
    else process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET = previousBudget;
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRejectsFinalAnswerWhenLocalToolRequired() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I cannot take a screenshot." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Can you screenshot my phone?" }],
        tools: [{
          type: "function",
          function: {
            name: "daemon_action",
            description: "Perform an Android daemon action.",
            parameters: { type: "object", properties: { action: { type: "string" } }, required: ["action"] },
          },
        }],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /local harness required a tool call[\s\S]*No cloud model was used/,
    );
    console.log("OK: Android Local Gemma does not satisfy required local tools with a final answer");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesToolFinalLengthFinishReason() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "This local response was cut off" }),
      finishReason: "length",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Summarize what is on my phone." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: { type: "object", properties: { action: { type: "string" } }, required: ["action"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "This local response was cut off");
    assert.equal(result.finishReason, "length");
    console.log("OK: Android Local Gemma preserves length finish reason for tool-enabled final replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaCancelsTimedOutGeneration() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    if (op.type === "android_local_model_cancel") return { ok: true, data: { cancelled: true } };
    return { ok: false, error: "daemon timeout" };
  });

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Hello" }],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /Phone Gemma timed out[\s\S]*cancel/,
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[0].op.type, "android_local_model_generate");
    assert.equal(requests[1].op.type, "android_local_model_cancel");
    assert.equal(requests[1].op.requestId, requests[0].op.requestId);
    console.log("OK: Android Local Gemma provider cancels phone generation after daemon timeout");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaExplainsUnbundledEngine() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: false,
    error: "LOCAL_MODEL_ENGINE_NOT_BUNDLED: LiteRT-LM generation is not bundled in this APK yet.",
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Hello" }],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /Phone Gemma is selected, but this APK cannot run LiteRT-LM generation yet/,
    );
    console.log("OK: Android Local Gemma reports unbundled LiteRT-LM as an actionable routing error");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaExplainsPhoneResourceFailures() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: false,
    error: "LOCAL_MODEL_DEVICE_MEMORY_LOW: available=640MB threshold=384MB minimum=1800MB lowMemory=true",
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Hello" }],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /low available memory/,
    );
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }

  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: false,
    error: "LOCAL_MODEL_BUSY: Phone Gemma is already generating.",
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Hello again" }],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /still working on the previous message/,
    );
    console.log("OK: Android Local Gemma explains phone memory and busy failures");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaExplainsEngineCreationFailure() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: false,
    error: "LOCAL_MODEL_GENERATION_FAILED: Failed to create LiteRT-LM engine after trying gpu, cpu backend(s): gpu: INTERNAL: ERROR: [third_party/odml/litert_lm/runtime/executor/llm_litert_compiled_model_executor.cc:1951]; cpu: INTERNAL",
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Hello" }],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /Phone Gemma could not start the LiteRT-LM engine[\s\S]*CPU fallback/,
    );
    console.log("OK: Android Local Gemma explains LiteRT-LM engine creation failures");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotClaimSkippedCpuFallback() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: false,
    error: "LOCAL_MODEL_GENERATION_FAILED: Failed to create LiteRT-LM engine after trying gpu backend(s): gpu: INTERNAL: ERROR: [third_party/odml/litert_lm/runtime/executor/llm_litert_compiled_model_executor.cc:1951]",
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Hello" }],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /CPU fallback was skipped/);
        assert.doesNotMatch(error.message, /tried the device accelerator and CPU fallback/);
        return true;
      },
    );
    console.log("OK: Android Local Gemma does not claim CPU fallback when memory gate skipped it");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaExplainsCompiledModelInvokeFailure() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: false,
    error: "LOCAL_MODEL_GENERATION_FAILED: Status Code: 13. Message: ERROR: [third_party/odml/litert_lm/runtime/executor/llm_litert_compiled_model_executor.cc:755] Failed to invoke the compiled model",
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "What can you do?" }],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /Phone Gemma could not finish local inference/,
    );
    console.log("OK: Android Local Gemma explains compiled-model invoke failures");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function main() {
  await testAnthropicUsesUserCredential();
  await testAnthropicToolUseFinishReasonIsToolCalls();
  await testAnthropicToolChoiceNoneOmitsTools();
  await testGoogleUsesUserCredential();
  await testGoogleEmptyBlockedResponseIsVisibleFailure();
  await testGoogleToolResponseUsesOriginalFunctionName();
  await testGoogleToolResponseMapsOpenAIToolCallIdsToFunctionNames();
  await testOpenAICompatibleUsesLocalUserCredential();
  await testAndroidLocalGemmaUsesAndroidAppDaemonGenerateOp();
  await testAndroidLocalGemmaEmitsLocalHarnessToolCalls();
  await testAndroidLocalGemmaKeepsPlainAutoChatOffToolProtocol();
  await testAndroidLocalGemmaCompactsLocalToolPrompt();
  await testAndroidLocalGemmaPreservesSystemGuardrailsWhenTrimming();
  await testAndroidLocalGemmaPreservesNewestTurnWhenTrimming();
  await testAndroidLocalGemmaRejectsFinalAnswerWhenLocalToolRequired();
  await testAndroidLocalGemmaPreservesToolFinalLengthFinishReason();
  await testAndroidLocalGemmaCancelsTimedOutGeneration();
  await testAndroidLocalGemmaExplainsUnbundledEngine();
  await testAndroidLocalGemmaExplainsPhoneResourceFailures();
  await testAndroidLocalGemmaExplainsEngineCreationFailure();
  await testAndroidLocalGemmaDoesNotClaimSkippedCpuFallback();
  await testAndroidLocalGemmaExplainsCompiledModelInvokeFailure();
  console.log("\nAll provider runtime adapter assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
