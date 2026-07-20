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
  _localRuntimeCapabilityStateForTesting,
} from "../providers/androidLocalGemma";
import {
  _setRuntimeCapabilityDepsForTesting,
  type RuntimeCapabilityCheck,
  type RuntimeCapabilityDeviceState,
} from "../../state/runtimeCapability";
import { _setGroundedEvidencePacketDepsForTesting } from "../../state/groundedEvidencePacket";
import { _setRuntimeMemoryInspectionDepsForTesting } from "../../state/runtimeMemoryInspection";
import type { MemoryContext } from "../../memory/memoryOs";

function runtimeCapabilityCheck(status: RuntimeCapabilityCheck["status"], lastCheckedAt: string): RuntimeCapabilityCheck {
  return {
    status,
    reason: status === "ready" ? "Ready for test." : "Disabled for test.",
    lastCheckedAt,
  };
}

function androidDeviceCapabilityState(
  checkedAt: string,
  overrides: Partial<RuntimeCapabilityDeviceState["android"]["permissions"]> = {},
): RuntimeCapabilityDeviceState {
  const ready = runtimeCapabilityCheck("ready", checkedAt);
  return {
    desktop: {
      connected: false,
      hostname: null,
      lastSeenAt: null,
      permissions: [],
    },
    android: {
      connected: true,
      hostname: "test-phone",
      lastSeenAt: checkedAt,
      activeDevice: "test-phone",
      permissions: {
        openApp: ready,
        browse: ready,
        screenCapture: ready,
        readScreen: ready,
        tapType: ready,
        accessibility: ready,
        notificationAccess: ready,
        microphone: ready,
        ...overrides,
      },
    },
  };
}

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
    assert.match(requests[0].op.prompt, /Jarvis Runtime State Card/);
    assert.match(requests[0].op.prompt, /Assistant: Jarvis/);
    assert.match(requests[0].op.prompt, /User id: user-phone/);
    assert.match(requests[0].op.prompt, /Active model: gemma-4-e4b-it/);
    assert.match(requests[0].op.prompt, /system: Be concise\./);
    assert.match(requests[0].op.prompt, /user: Hello/);
    assert.equal(requests[0].op.contextTokens, 2048);
    assert.equal(requests[0].op.maxTokens, 128);
    assert.equal(requests[0].op.allowCpuFallback, false);
    assert.ok(requests[0].timeoutMs >= 60000);
    console.log("OK: Android Local Gemma provider sends generation to the Jarvis Android app daemon runtime");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaFitsValidated512TokenProfileBeforeGeneration() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    if (op.type === "android_local_model_status") {
      return {
        ok: true,
        data: {
          engineValidatedContextTokens: 512,
          engineValidatedProfileId: "gpu-standard-512",
          engineValidatedProfileLabel: "GPU standard 512",
        },
      };
    }
    return {
      ok: true,
      data: { text: "Profile-aware local answer.", finishReason: "stop" },
    };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "system", content: `Keep the answer grounded. ${"older context ".repeat(180)}` },
        { role: "user", content: "LATEST_512_USER_REQUEST: What do you know about me?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-512",
    }));

    assert.equal(result.textContent, "Profile-aware local answer.");
    assert.deepEqual(requests.map((request) => request.op.type), [
      "android_local_model_status",
      "android_local_model_generate",
    ]);
    const generateOp = requests[1].op;
    assert.equal(generateOp.contextTokens, 512);
    assert.equal(generateOp.maxTokens, 128);
    assert.match(generateOp.prompt, /LATEST_512_USER_REQUEST/);
    const nativePromptCeiling = (generateOp.contextTokens - generateOp.maxTokens - 64) * 3;
    assert.ok(
      generateOp.prompt.length <= nativePromptCeiling,
      `prompt length ${generateOp.prompt.length} should fit native ceiling ${nativePromptCeiling}`,
    );
    console.log("OK: Android Local Gemma fits prompts to the validated 512-token profile before generation");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaFitsToolProtocolInsideValidated512TokenProfile() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    if (op.type === "android_local_model_status") {
      return {
        ok: true,
        data: {
          engineValidatedContextTokens: 512,
          engineValidatedProfileId: "gpu-standard-512",
        },
      };
    }
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
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Can you screenshot my phone?" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["android_read_screen", "android_screenshot", "android_tap"] },
            },
            required: ["action"],
          },
        },
      }, {
        type: "function",
        function: {
          name: "lookup_memory",
          description: "Look up a local memory entry.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }, {
        type: "function",
        function: {
          name: "get_youtube_transcript",
          description: "Fetch a transcript for a YouTube URL.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-tool-512",
    }));

    assert.equal(result.finishReason, "tool_calls");
    const generateOp = requests.find((request) => request.op.type === "android_local_model_generate")!.op;
    assert.match(generateOp.prompt, /Return ONLY one JSON object/);
    assert.match(generateOp.prompt, /Tool call:/);
    assert.match(generateOp.prompt, /Final:/);
    assert.match(generateOp.prompt, /Available tools:/);
    assert.match(generateOp.prompt, /daemon_action/);
    assert.match(generateOp.prompt, /Can you screenshot my phone\?/);
    assert.ok(generateOp.prompt.length <= (512 - 128 - 64) * 3);
    console.log("OK: Android Local Gemma fits its tool protocol inside the validated 512-token profile");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaFallsBackWhenValidatedProfileStatusIsUnavailable() {
  const previousContextTokens = process.env.ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS;
  process.env.ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS = "1024";
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    if (op.type === "android_local_model_status") {
      return { ok: false, error: "Older APK does not expose local model status." };
    }
    return {
      ok: true,
      data: { text: "Fallback local answer.", finishReason: "stop" },
    };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Can you still answer locally?" }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-status-fallback",
    }));

    assert.equal(result.textContent, "Fallback local answer.");
    assert.deepEqual(requests.map((request) => request.op.type), [
      "android_local_model_status",
      "android_local_model_generate",
    ]);
    assert.equal(requests[1].op.contextTokens, 1024);
    assert.ok(requests[1].op.prompt.length <= (1024 - 128 - 64) * 3);
    console.log("OK: Android Local Gemma falls back to configured budgets when profile status is unavailable");
  } finally {
    if (previousContextTokens === undefined) delete process.env.ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS;
    else process.env.ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS = previousContextTokens;
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaStateCardOmitsDisabledTools() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: "plain local answer", finishReason: "stop" },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Hello" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: { type: "object", properties: { action: { type: "string" } }, required: ["action"] },
        },
      }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "plain local answer");
    assert.match(requests[0].op.prompt, /Jarvis Runtime State Card/);
    assert.match(requests[0].op.prompt, /No tools supplied by this route/);
    assert.doesNotMatch(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma state card omits tools when tool choice is none");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAuditsFalseNotificationDenials() {
  const checkedAt = "2026-07-03T01:30:00.000Z";
  _setRuntimeCapabilityDepsForTesting({
    now: () => new Date(checkedAt),
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => androidDeviceCapabilityState(checkedAt),
  });
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: { text: "I cannot read notifications on this device.", finishReason: "stop" },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Do you have notification access?" }],
      tools: [{
        type: "function",
        function: {
          name: "android_read_notifications",
          description: "Read current Android notifications.",
          parameters: { type: "object", properties: {} },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I can do that locally. Let me try again.");
    assert.doesNotMatch(result.textContent, /android_read_notifications|{|}/);
    console.log("OK: Android Local Gemma audits false notification denials before final output");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotAuditUnavailableNotificationDenials() {
  const checkedAt = "2026-07-03T01:31:00.000Z";
  const disabled = runtimeCapabilityCheck("disabled", checkedAt);
  _setRuntimeCapabilityDepsForTesting({
    now: () => new Date(checkedAt),
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => androidDeviceCapabilityState(checkedAt, {
      notificationAccess: disabled,
      readScreen: disabled,
      tapType: disabled,
    }),
  });
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: { text: "I cannot read notifications on this device.", finishReason: "stop" },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Do you have notification access?" }],
      tools: [{
        type: "function",
        function: {
          name: "android_read_notifications",
          description: "Read current Android notifications.",
          parameters: { type: "object", properties: {} },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I cannot read notifications on this device.");
    console.log("OK: Android Local Gemma does not rewrite accurate unavailable-capability denials");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAuditHonorsToolChoiceNone() {
  const checkedAt = "2026-07-03T02:06:00.000Z";
  _setRuntimeCapabilityDepsForTesting({
    now: () => new Date(checkedAt),
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => androidDeviceCapabilityState(checkedAt),
  });
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: { text: "I cannot read notifications on this device.", finishReason: "stop" },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Do you have notification access?" }],
      tools: [{
        type: "function",
        function: {
          name: "android_read_notifications",
          description: "Read current Android notifications.",
          parameters: { type: "object", properties: {} },
        },
      }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I cannot read notifications on this device.");
    console.log("OK: Android Local Gemma truth audit honors disabled tool choice");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAuditsOpenAppWhenBrowseIsUnavailable() {
  const checkedAt = "2026-07-03T02:23:00.000Z";
  const disabled = runtimeCapabilityCheck("disabled", checkedAt);
  _setRuntimeCapabilityDepsForTesting({
    now: () => new Date(checkedAt),
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => androidDeviceCapabilityState(checkedAt, {
      browse: disabled,
    }),
  });

  try {
    const capabilityState = await _localRuntimeCapabilityStateForTesting({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open YouTube." }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open a phone app by name.",
          parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
        },
      }, {
        type: "function",
        function: {
          name: "android_youtube_search",
          description: "Open YouTube search.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    });

    assert.equal(capabilityState.app_control, "available");
    console.log("OK: Android Local Gemma audits plain app opens independently from unavailable browse");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
  }
}

async function testAndroidLocalGemmaChecksYoutubeSearchAgainstBrowseCapability() {
  const checkedAt = "2026-07-03T01:58:00.000Z";
  const disabled = runtimeCapabilityCheck("disabled", checkedAt);
  _setRuntimeCapabilityDepsForTesting({
    now: () => new Date(checkedAt),
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => androidDeviceCapabilityState(checkedAt, {
      browse: disabled,
    }),
  });
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: { text: "I cannot open YouTube on this device.", finishReason: "stop" },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Search YouTube for AI videos." }],
      tools: [{
        type: "function",
        function: {
          name: "android_youtube_search",
          description: "Open YouTube search.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I cannot open YouTube on this device.");
    console.log("OK: Android Local Gemma audits YouTube search availability against browse capability");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaChecksPhoneUrlAgainstBrowseCapability() {
  const checkedAt = "2026-07-03T05:26:00.000Z";
  const disabled = runtimeCapabilityCheck("disabled", checkedAt);
  _setRuntimeCapabilityDepsForTesting({
    now: () => new Date(checkedAt),
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => androidDeviceCapabilityState(checkedAt, {
      browse: disabled,
    }),
  });

  try {
    const capabilityState = await _localRuntimeCapabilityStateForTesting({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open https://example.com." }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open a phone app by name.",
          parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
        },
      }, {
        type: "function",
        function: {
          name: "android_open_phone_url",
          description: "Open a URL on the Android phone.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    });

    assert.equal(capabilityState.app_control, "unavailable");
    const deepLinkCapabilityState = await _localRuntimeCapabilityStateForTesting({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open geo:0,0?q=coffee." }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open a phone app by name.",
          parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
        },
      }, {
        type: "function",
        function: {
          name: "android_open_phone_url",
          description: "Open a URL on the Android phone.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    });
    assert.equal(deepLinkCapabilityState.app_control, "unavailable");
    console.log("OK: Android Local Gemma audits URL opens against browse capability");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
  }
}

async function testAndroidLocalGemmaScopesPhoneUrlCapabilityToExposedTools() {
  const checkedAt = "2026-07-04T00:42:00.000Z";
  _setRuntimeCapabilityDepsForTesting({
    now: () => new Date(checkedAt),
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => androidDeviceCapabilityState(checkedAt),
  });

  try {
    const capabilityState = await _localRuntimeCapabilityStateForTesting({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What does geo:0,0?q=coffee mean?" }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open a phone app by name.",
          parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
        },
      }, {
        type: "function",
        function: {
          name: "android_open_phone_url",
          description: "Open a URL on the Android phone.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    });

    assert.equal(capabilityState.app_control, "unknown");
    console.log("OK: Android Local Gemma scopes phone URL capability to exposed tools");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
  }
}

async function testAndroidLocalGemmaTreatsMemorySaveAsMemoryCapability() {
  const capabilityState = await _localRuntimeCapabilityStateForTesting({
    model: "android-local-gemma/gemma-4-e4b-it",
    messages: [{ role: "user", content: "Remember that my favorite color is green." }],
    tools: [{
      type: "function",
      function: {
        name: "memory_save",
        description: "Save a memory.",
        parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
      },
    }],
    toolChoice: "auto",
    maxCompletionTokens: 128,
    stream: false,
    userId: "user-phone",
  });

  assert.equal(capabilityState.memory, "available");
  console.log("OK: Android Local Gemma treats memory_save as memory capability");
}

async function testAndroidLocalGemmaConfirmsLegacyDaemonBrowseCompletion() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: { text: "I opened example.com.", finishReason: "stop" },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open example.com." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "daemon-call-1",
            type: "function",
            function: {
              name: "daemon_action",
              arguments: JSON.stringify({ action: "android_browse", url: "https://example.com" }),
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: "daemon-call-1",
          content: JSON.stringify({ ok: true, action: "android_browse", url: "https://example.com" }),
        },
      ],
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

    assert.equal(result.textContent, "I opened example.com.");
    console.log("OK: Android Local Gemma confirms legacy daemon browse completions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAuditsPronounConfirmationCompletions() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: { text: "I opened example.com.", finishReason: "stop" },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open example.com." },
        { role: "assistant", content: "Should I open it?" },
        { role: "user", content: "yes" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "android_open_phone_url",
          description: "Open a URL on the Android phone.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }, {
        type: "function",
        function: {
          name: "memory_search",
          description: "Search memory.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }, {
        type: "function",
        function: {
          name: "android_youtube_search",
          description: "Search YouTube on the phone.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I have not completed that yet.");
    console.log("OK: Android Local Gemma audits pronoun confirmation completions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaUsesToolResultEvidenceForIdentityAudit() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: { text: "Your name is Justin.", finishReason: "stop" },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Who am I?" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "memory-call-1",
            type: "function",
            function: {
              name: "memory_search",
              arguments: JSON.stringify({ query: "user identity preferred name" }),
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: "memory-call-1",
          content: "Profile result: Preferred name: Justin.",
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "memory_search",
          description: "Search MemoryOS.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "Your name is Justin.");
    console.log("OK: Android Local Gemma uses current-turn tool results as identity audit evidence");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaUsesGroundedEvidencePacketForPersonalMemoryQuestions() {
  let capturedPrompt = "";
  let capturedGenerateOp: any = null;
  const memoryContext = (query: string): MemoryContext => {
    const isDoorDash = /doordash/i.test(query);
    return {
      userId: "user-phone-grounded",
      query,
      caller: "runtime_memory_inspection",
      items: [{
        memory: {
          id: isDoorDash ? "grounded-doordash-memory" : "grounded-memory-1",
          content: isDoorDash
            ? "User does not want DoorDash alerts treated as automatically important."
            : "User prefers direct answers with clear next actions.",
          category: "communication_style",
          tier: "long_term",
          memoryType: "semantic",
          relevanceScore: 90,
          confidence: 95,
          accessCount: 1,
          score: 0.95,
        },
        provenance: [{
          kind: "user_memory",
          id: isDoorDash ? "grounded-doordash-memory" : "grounded-memory-1",
          source: "canonical",
          label: "communication_style",
        }],
      }],
      sources: {
        memories: [isDoorDash ? "grounded-doordash-memory" : "grounded-memory-1"],
        brainChunks: [],
        hotState: [],
      },
      provenance: [{
        kind: "user_memory",
        id: isDoorDash ? "grounded-doordash-memory" : "grounded-memory-1",
        source: "canonical",
      }],
      uncertainty: [],
    };
  };

  _setGroundedEvidencePacketDepsForTesting({
    now: () => new Date("2026-07-09T12:00:00.000Z"),
    loadProfileState: async () => ({
      userId: "user-phone-grounded",
      preferredName: "Justin",
      source: "profile_store",
    }),
    loadSoul: async () => ({ content: "", manualOverride: null, generatedAt: null, updatedAt: null }),
    retrieveMemoryContext: async (input) => memoryContext(input.query),
    loadCommitments: async () => [{
      id: "grounded-commitment-1",
      content: "Review Jarvis voice grounding PR after Codex review.",
      dueDate: "2026-07-09",
      status: "pending",
      extractedAt: new Date("2026-07-09T11:00:00.000Z"),
      commitmentKind: "user_commitment",
      signalLevel: "normal",
      dedupeKey: "topic:review_voice_grounding",
      sourceType: "message_extract",
    }],
  });
  _setRuntimeMemoryInspectionDepsForTesting({
    retrieveMemoryContext: async (input) => ({
      userId: input.userId,
      query: input.query,
      caller: "runtime_memory_inspection",
      items: [{
        memory: {
          id: "exact-doordash-memory",
          content: "User does not want DoorDash alerts treated as automatically important.",
          category: "preferences",
          tier: "long_term",
          memoryType: "semantic",
          relevanceScore: 92,
          confidence: 95,
          accessCount: 0,
          score: 0.94,
        },
        provenance: [{ kind: "user_memory", id: "exact-doordash-memory", source: "canonical" }],
      }],
      sources: { memories: ["exact-doordash-memory"], brainChunks: [], hotState: [] },
      provenance: [{ kind: "user_memory", id: "exact-doordash-memory", source: "canonical" }],
      uncertainty: [],
    }),
  });
  _setAndroidLocalGemmaDaemonOpForTesting(async (_userId, op) => {
    if (op.type === "android_local_model_status") {
      return {
        ok: true,
        data: {
          engineValidatedContextTokens: 512,
          engineValidatedProfileId: "gpu-standard-512",
          engineValidatedProfileLabel: "GPU standard 512",
        },
      };
    }
    if (op.type === "android_local_model_generate") {
      capturedGenerateOp = op;
      capturedPrompt = op.prompt;
    }
    return {
      ok: true,
      data: { text: "Jarvis has your name as Justin and a preference for direct answers.", finishReason: "stop" },
    };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What do you know about me?" }],
      tools: [],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-grounded",
    }));

    assert.match(capturedPrompt, /Jarvis Grounded Evidence Packet/);
    assert.match(capturedPrompt, /Use only EVIDENCE/);
    assert.match(capturedPrompt, /Preferred name: Justin/);
    assert.match(capturedPrompt, /direct answers with clear next actions/);
    assert.match(capturedPrompt, /id=commitment:grounded-commitment-1/);
    const nativePromptCeiling = (capturedGenerateOp.contextTokens - capturedGenerateOp.maxTokens - 64) * 3;
    assert.ok(capturedPrompt.length <= nativePromptCeiling);
    assert.match(result.textContent, /Justin/);

    capturedPrompt = "";
    const temporalResult = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Do you remember what I decided about Android speech a while ago?" }],
      tools: [],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-grounded",
    }));
    assert.match(capturedPrompt, /intent=temporal_recall/);
    assert.match(capturedPrompt, /direct answers with clear next actions/);
    assert.match(temporalResult.textContent, /Justin/);

    capturedPrompt = "";
    const personalFactResult = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What is my birthday?" }],
      tools: [],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-grounded",
    }));
    assert.match(capturedPrompt, /Jarvis Grounded Evidence Packet/);
    assert.match(capturedPrompt, /intent=exact_recall/);
    assert.match(personalFactResult.textContent, /Justin/);

    capturedPrompt = "";
    await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Check memory usage." }],
      tools: [],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-grounded",
    }));
    assert.doesNotMatch(capturedPrompt, /Jarvis Grounded Evidence Packet/);

    capturedPrompt = "";
    await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Show exact memories about DoorDash" }],
      tools: [],
      toolChoice: "none",
      responseFormat: { type: "json_object" },
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-grounded",
    }));
    assert.match(capturedPrompt, /Jarvis Grounded Evidence Packet/);
    assert.match(capturedPrompt, /intent=exact_recall/);
    assert.match(capturedPrompt, /DoorDash alerts treated as automatically important/);

    capturedPrompt = "";
    const exactInspectionResult = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Show exact memories about DoorDash" }],
      tools: [],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-grounded",
    }));
    assert.equal(capturedPrompt, "", "exact runtime audit should bypass Phone Gemma generation");
    assert.match(exactInspectionResult.textContent, /limited MemoryOS inspection for DoorDash/);
    assert.match(exactInspectionResult.textContent, /DoorDash alerts treated as automatically important/);
    console.log("OK: Android Local Gemma uses grounded evidence packets for personal memory questions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
    _setGroundedEvidencePacketDepsForTesting(null);
    _setRuntimeMemoryInspectionDepsForTesting(null);
  }
}

async function testAndroidLocalGemmaCompletesExactStoredMemoryWithoutGeneration() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setRuntimeMemoryInspectionDepsForTesting({
    retrieveMemoryContext: async (input) => ({
      userId: input.userId,
      query: input.query,
      caller: "runtime_memory_inspection",
      items: [{
        memory: {
          id: "mem-jarvis-goal",
          content: "A major goal is to make Jarvis a true personal operating system that can coordinate work across devices.",
          category: "goals",
          tier: "long_term",
          memoryType: "semantic",
          relevanceScore: 96,
          confidence: 98,
          accessCount: 2,
          score: 0.98,
        },
        provenance: [{ kind: "user_memory", id: "mem-jarvis-goal", source: "canonical" }],
      }],
      sources: { memories: ["mem-jarvis-goal"], brainChunks: [], hotState: [] },
      provenance: [{ kind: "user_memory", id: "mem-jarvis-goal", source: "canonical" }],
      uncertainty: [],
    }),
  });
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: true, data: { text: "A major goa... operational security.", finishReason: "stop" } };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{
        role: "user",
        content: "Finish this sentence from your memories. \"A major goal is to make Jarvis a\" what?",
      }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-memory-completion",
    }));

    assert.equal(
      result.textContent,
      "true personal operating system that can coordinate work across devices.\n\nSources: MemoryOS.",
    );
    assert.deepEqual(requests, []);
    console.log("OK: Android Local Gemma completes exact stored memories without local generation");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
    _setRuntimeMemoryInspectionDepsForTesting(null);
  }
}

async function testAndroidLocalGemmaSkipsCapabilityProbeWithoutAndroidTools() {
  _setRuntimeCapabilityDepsForTesting({
    loadConnectedAccounts: async () => {
      throw new Error("Capability state should not load accounts without Android audit tools.");
    },
    loadDeviceControlState: async () => {
      throw new Error("Capability state should not probe Android without Android audit tools.");
    },
  });
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: { text: "Plain local answer.", finishReason: "stop" },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Say hi." }],
      tools: [{
        type: "function",
        function: {
          name: "memory_search",
          description: "Search MemoryOS.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "Plain local answer.");
    console.log("OK: Android Local Gemma skips Android capability probing when no Android audit tool is present");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAllowsConfirmedCompletionClaims() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I opened YouTube." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open YouTube." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_open_youtube",
            type: "function",
            function: {
              name: "android_open_app_by_name",
              arguments: "{\"appName\":\"YouTube\"}",
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_open_youtube",
          content: "{\"ok\":true,\"label\":\"Opened YouTube\"}",
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open an Android app by name.",
          parameters: { type: "object", properties: { appName: { type: "string" } } },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I opened YouTube.");
    console.log("OK: Android Local Gemma truth audit allows confirmed action-completion claims");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAllowsRecentConfirmedCompletionFollowups() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "Yes, I opened YouTube." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open YouTube." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_open_youtube",
            type: "function",
            function: {
              name: "android_open_app_by_name",
              arguments: "{\"appName\":\"YouTube\"}",
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_open_youtube",
          content: "{\"ok\":true,\"label\":\"Opened YouTube\"}",
        },
        { role: "user", content: "Did you open YouTube?" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open an Android app by name.",
          parameters: {
            type: "object",
            properties: { appName: { type: "string" } },
            required: ["appName"],
          },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "Yes, I opened YouTube.");
    console.log("OK: Android Local Gemma allows recent confirmed completion follow-ups");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaBlocksStaleConfirmedCompletionFollowups() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "Yes, I opened YouTube." }),
      finishReason: "stop",
    },
  }));

  const openAppTool = {
    type: "function" as const,
    function: {
      name: "android_open_app_by_name",
      description: "Open an Android app by name.",
      parameters: {
        type: "object" as const,
        properties: { appName: { type: "string" } },
        required: ["appName"],
      },
    },
  };

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open YouTube." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_open_youtube_success",
            type: "function",
            function: {
              name: "daemon_action",
              arguments: "{\"action\":\"android_open_app\",\"packageName\":\"com.google.android.youtube\"}",
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_open_youtube_success",
          content: "{\"ok\":true,\"label\":\"Opened YouTube\"}",
        },
        { role: "user", content: "Open YouTube again." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_open_youtube_failure",
            type: "function",
            function: {
              name: "android_open_app_by_name",
              arguments: "{\"appName\":\"YouTube\"}",
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_open_youtube_failure",
          content: "{\"ok\":false,\"error\":\"Failed to open YouTube\"}",
        },
        { role: "user", content: "Did you open YouTube?" },
      ],
      tools: [openAppTool],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I have not completed that yet.");
    console.log("OK: Android Local Gemma blocks stale confirmed completion follow-ups");
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_screenshot"}');
    assert.match(requests[0].op.prompt, /running entirely through Android Local Gemma/);
    assert.match(requests[0].op.prompt, /Available tools/);
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma can emit local harness tool calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaNormalizesDaemonAppAliases() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "daemon_action", arguments: { action: "open_youtube" } }],
        }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open YouTube" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: { type: "object", properties: { action: { type: "string" }, packageName: { type: "string" } }, required: ["action"] },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.youtube"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma normalizes daemon app aliases");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaNormalizesDirectDaemonActionToolNames() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "android_screenshot", arguments: {} }],
        }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Take a screenshot." }],
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_screenshot"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma normalizes direct daemon action tool names");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaNormalizesViewScreenshotToolAlias() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "android_view_screenshot", arguments: {} }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Take a screenshot." }],
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_screenshot"}');
    console.log("OK: Android Local Gemma normalizes android_view_screenshot to daemon screenshot");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversScreenshotFromUnavailableToolName() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "google_search", arguments: { query: "screenshot" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Take a screenshot" }],
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_screenshot"}');
    console.log("OK: Android Local Gemma recovers screenshot requests from unavailable tool names");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaNormalizesDirectAppAliasToolNames() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "open_youtube", arguments: {} }],
        }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open YouTube" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: { type: "object", properties: { action: { type: "string" }, packageName: { type: "string" } }, required: ["action"] },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.youtube"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma normalizes direct app alias tool names");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaNormalizesDirectNotificationToolNames() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "android_notifications_list", arguments: { limit: 5 } }],
        }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Read my notifications" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: { type: "object", properties: { action: { type: "string" }, limit: { type: "number" } }, required: ["action"] },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"limit":5,"action":"android_notifications_list"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma normalizes direct notification tool names");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaNormalizesEveryDirectDaemonActionName() {
  const cases = [
    {
      name: "android_sms_send",
      arguments: { to: "+15551234567", message: "Running late", approved: true },
      expected: '{"to":"+15551234567","message":"Running late","approved":true,"action":"android_sms_send"}',
    },
    {
      name: "android_camera_snap",
      arguments: { facing: "front" },
      expected: '{"facing":"front","action":"android_camera_snap"}',
    },
    {
      name: "android_notification_reply",
      arguments: { notificationKey: "notif-key-1", replyText: "On my way", approved: true },
      expected: '{"notificationKey":"notif-key-1","replyText":"On my way","approved":true,"action":"android_notification_reply"}',
    },
  ];

  try {
    for (const testCase of cases) {
      const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
      _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
        requests.push({ userId, op, timeoutMs });
        return {
          ok: true,
          data: {
            text: JSON.stringify({
              type: "tool_calls",
              tool_calls: [{ name: testCase.name, arguments: testCase.arguments }],
            }),
            finishReason: "stop",
          },
        };
      });

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: `Use ${testCase.name}` }],
        tools: [{
          type: "function",
          function: {
            name: "daemon_action",
            description: "Perform an Android daemon action.",
            parameters: {
              type: "object",
              properties: {
                action: { type: "string" },
                to: { type: "string" },
                message: { type: "string" },
                approved: { type: "boolean" },
                facing: { type: "string" },
                notificationKey: { type: "string" },
                replyText: { type: "string" },
              },
              required: ["action"],
            },
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
      assert.equal(result.toolCallList[0].function.arguments, testCase.expected);
      assert.match(requests[0].op.prompt, /daemon_action/);
    }
    console.log("OK: Android Local Gemma normalizes every direct daemon action name");
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

async function testAndroidLocalGemmaLabelsRecentConversationForContextualFollowups() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: "Start with the product photography checklist.", finishReason: "stop" },
    };
  });

  try {
    await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Help me prepare my dual-cart battery product page." },
        { role: "assistant", content: "Start with product photography, compliance, and pricing." },
        { role: "user", content: "What should I do first from that list?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-context-followup",
    }));

    assert.equal(requests.length, 1);
    assert.match(requests[0].op.prompt, /Jarvis Recent Conversation Context/);
    assert.match(requests[0].op.prompt, /assistant: Start with product photography, compliance, and pricing\./);
    assert.match(requests[0].op.prompt, /user: What should I do first from that list\?/);
    console.log("OK: Android Local Gemma receives labeled Jarvis context for contextual follow-ups");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaOmitsPriorLocalRuntimeErrors() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: "Still here, running locally.", finishReason: "stop" },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "What can you do?" },
        {
          role: "assistant",
          content: `Error: LOCAL_MODEL_GENERATION_FAILED: ${"llm_litert_compiled_model_executor.cc:755 Failed to invoke ".repeat(40)}`,
        },
        { role: "user", content: "Hi" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "Still here, running locally.");
    assert.match(requests[0].op.prompt, /user: Hi/);
    assert.doesNotMatch(requests[0].op.prompt, /LOCAL_MODEL_GENERATION_FAILED/);
    assert.doesNotMatch(requests[0].op.prompt, /llm_litert_compiled_model_executor/);
    console.log("OK: Android Local Gemma omits prior local runtime errors from retry prompts");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaIgnoresOldToolTraceForPlainAutoChat() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: "You got it.", finishReason: "stop" },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Can you read my screen?" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_read_screen",
            type: "function",
            function: { name: "daemon_action", arguments: "{\"action\":\"android_read_screen\"}" },
          }],
        },
        { role: "tool", tool_call_id: "call_read_screen", content: "{\"ok\":true,\"text\":\"Home screen\"}" },
        { role: "assistant", content: "Your home screen is visible." },
        { role: "user", content: "thanks" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: { type: "object", properties: { action: { type: "string", enum: ["android_read_screen"] } }, required: ["action"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "You got it.");
    assert.doesNotMatch(requests[0].op.prompt, /Available tools/);
    console.log("OK: Android Local Gemma ignores old tool traces for plain auto-tool chat");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaUsesToolProtocolForUrlTools() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "get_youtube_transcript", arguments: { url: "https://youtu.be/example" } }],
        }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "summarize https://youtu.be/example" }],
      tools: [{
        type: "function",
        function: {
          name: "get_youtube_transcript",
          description: "Fetch a transcript for a YouTube URL.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCallList[0].function.name, "get_youtube_transcript");
    assert.match(requests[0].op.prompt, /Available tools/);
    assert.match(requests[0].op.prompt, /get_youtube_transcript/);
    console.log("OK: Android Local Gemma keeps tool protocol for URL-backed local tools");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsToolProtocolForConfirmationTurns() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "daemon_action", arguments: { action: "android_sms_send", approved: true } }],
        }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Please send an SMS to Justin." },
        { role: "assistant", content: "Should I proceed?" },
        { role: "user", content: "yes, go ahead" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["android_sms_send"] },
              approved: { type: "boolean" },
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

    assert.equal(result.finishReason, "tool_calls");
    assert.match(requests[0].op.prompt, /Available tools/);
    console.log("OK: Android Local Gemma keeps tool protocol for confirmation turns");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsToolProtocolForUrlToolConfirmationTurns() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "get_youtube_transcript", arguments: { url: "https://youtu.be/example" } }],
        }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Can you summarize this video https://youtu.be/example?" },
        { role: "assistant", content: "Should I fetch the transcript from https://youtu.be/example?" },
        { role: "user", content: "yes" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "get_youtube_transcript",
          description: "Fetch a transcript for a YouTube URL.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }, {
        type: "function",
        function: {
          name: "android_open_phone_url",
          description: "Open a URL on the Android phone.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCallList[0].function.name, "get_youtube_transcript");
    assert.match(requests[0].op.prompt, /Available tools/);
    assert.match(requests[0].op.prompt, /get_youtube_transcript/);
    assert.doesNotMatch(requests[0].op.prompt, /android_open_phone_url/);
    console.log("OK: Android Local Gemma keeps tool protocol for URL-tool confirmations");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRejectsPhoneUrlToolForUrlToolConfirmationTurns() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "android_open_phone_url", arguments: { url: "https://youtu.be/example" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Can you summarize this video https://youtu.be/example?" },
        { role: "assistant", content: "Should I fetch the transcript from https://youtu.be/example?" },
        { role: "user", content: "yes" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "get_youtube_transcript",
          description: "Fetch a transcript for a YouTube URL.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }, {
        type: "function",
        function: {
          name: "android_open_phone_url",
          description: "Open a URL on the Android phone.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.match(result.textContent, /did not return a usable local answer/);
    console.log("OK: Android Local Gemma rejects phone URL tools for URL-tool confirmations");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotThrowPhoneUrlToolForInformationalDeepLinks() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "android_open_phone_url", arguments: { url: "geo:0,0?q=coffee" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What is geo:0,0?q=coffee?" }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_phone_url",
          description: "Open a URL on the Android phone.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "Phone Gemma did not return a usable local answer for that request.");
    console.log("OK: Android Local Gemma does not throw phone URL tools for informational deep links");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesRequiredFinalAnswerWhenPhoneUrlToolIsHidden() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "final",
        content: "geo:0,0?q=coffee is a map deep link format.",
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What does geo:0,0?q=coffee mean?" }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_phone_url",
          description: "Open a URL on the Android phone.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "geo:0,0?q=coffee is a map deep link format.");
    console.log("OK: Android Local Gemma preserves required final answers when phone URL tool is hidden");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesInformationalFollowupAfterPhoneUrlPrompt() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "final",
        content: "That geo link is a map search deep link; I will not open it.",
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open geo:0,0?q=coffee." },
        { role: "assistant", content: "Should I open geo:0,0?q=coffee on your phone?" },
        { role: "user", content: "What does geo:0,0?q=coffee mean?" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "android_open_phone_url",
          description: "Open a URL on the Android phone.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "That geo link is a map search deep link; I will not open it.");
    console.log("OK: Android Local Gemma preserves informational follow-ups after phone URL prompts");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaCompactsLocalToolPrompt() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  const largeSchema = {
    action: { type: "string", enum: ["android_read_screen", "android_screenshot", "android_tap"] },
    cmd: { type: "string" },
    cwd: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    path: { type: "string" },
    content: { type: "string" },
    timeoutMs: { type: "number" },
    packageName: { type: "string" },
    url: { type: "string" },
    x: { type: "number" },
    y: { type: "number" },
    x1: { type: "number" },
    y1: { type: "number" },
    x2: { type: "number" },
    y2: { type: "number" },
    key: { type: "string", enum: ["back", "home", "enter"] },
    operatorAction: { type: "object" },
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
    assert.match(requests[0].op.prompt, /x1/);
    assert.match(requests[0].op.prompt, /y2/);
    assert.match(requests[0].op.prompt, /key/);
    assert.match(requests[0].op.prompt, /operatorAction/);
    assert.doesNotMatch(requests[0].op.prompt, /"properties"/);
    assert.doesNotMatch(requests[0].op.prompt, /large_description_tail/);
    assert.ok(requests[0].op.prompt.length <= 3600);
    console.log("OK: Android Local Gemma compacts local tool prompts for phone inference");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaHonorsReducedToolPromptBudget() {
  const previousBudget = process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET;
  process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET = "1200";
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: JSON.stringify({ type: "final", content: "I can use local Android tools." }), finishReason: "stop" },
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
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["android_read_screen", "android_screenshot", "android_tap"] },
              x1: { type: "number" },
              y1: { type: "number" },
              x2: { type: "number" },
              y2: { type: "number" },
              key: { type: "string" },
              operatorAction: { type: "object" },
            },
            required: ["action"],
          },
        },
      }, {
        type: "function",
        function: {
          name: "get_youtube_transcript",
          description: "Fetch a transcript for a YouTube URL.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }, {
        type: "function",
        function: {
          name: "lookup_memory",
          description: "Look up a local memory entry.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I can use local Android tools.");
    assert.ok(requests[0].op.prompt.length <= 1200, `prompt length ${requests[0].op.prompt.length} should fit reduced budget`);
    console.log("OK: Android Local Gemma honors reduced local tool prompt budget");
  } finally {
    if (previousBudget === undefined) delete process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET;
    else process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET = previousBudget;
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

async function testAndroidLocalGemmaOmitsCodeProposalSystemPromptForPhoneActions() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: JSON.stringify({ type: "final", content: "I can capture the screen when asked." }), finishReason: "stop" },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        {
          role: "system",
          content: [
            "## Identity",
            "MUST_KEEP_IDENTITY_RULE",
            "",
            "## Self-Inspection & Code Proposals",
            "Use list_source_files, read_source_file, and propose_code_change. After proposing, tell the user a suggestion is waiting in the Code Proposals screen.",
            "",
            "## Critical rules - no empty promises",
            "MUST_KEEP_LATER_GUARDRAIL",
          ].join("\n"),
        },
        { role: "user", content: "Can you screenshot my device?" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "android_capture_screen",
          description: "Capture the current Android screen.",
          parameters: { type: "object", properties: {} },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "");
    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_capture_screen");
    assert.doesNotMatch(requests[0].op.prompt, /Code Proposals|propose_code_change|list_source_files|read_source_file/i);
    assert.match(requests[0].op.prompt, /MUST_KEEP_IDENTITY_RULE/);
    assert.match(requests[0].op.prompt, /MUST_KEEP_LATER_GUARDRAIL/);
    assert.match(requests[0].op.prompt, /user: Can you screenshot my device\?/);
    console.log("OK: Android Local Gemma omits Code Proposal system prompt for phone actions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesToolContinuationWhenTrimming() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    if (op.type === "android_local_model_status") {
      return {
        ok: true,
        data: {
          engineValidatedContextTokens: 512,
          engineValidatedProfileId: "gpu-standard-512",
        },
      };
    }
    return {
      ok: true,
      data: { text: JSON.stringify({ type: "final", content: "I read the local tool result." }), finishReason: "stop" },
    };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "CURRENT_TOOL_REQUEST: read my Android screen and tell me what is visible." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_android_read_screen",
            type: "function",
            function: { name: "daemon_action", arguments: "{\"action\":\"android_read_screen\"}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_android_read_screen",
          content: `${"large Android read screen observation ".repeat(160)} TOOL_RESULT_TAIL_MARKER`,
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["android_read_screen"] },
            },
            required: ["action"],
          },
        },
      }, {
        type: "function",
        function: {
          name: "lookup_memory",
          description: "Look up a local memory entry.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }, {
        type: "function",
        function: {
          name: "get_youtube_transcript",
          description: "Fetch a transcript for a YouTube URL.",
          parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I read the local tool result.");
    const generateOp = requests.find((request) => request.op.type === "android_local_model_generate")!.op;
    assert.equal(generateOp.contextTokens, 512);
    assert.ok(generateOp.prompt.length <= (512 - 128 - 64) * 3);
    assert.doesNotMatch(generateOp.prompt, /Earlier prompt context omitted/);
    assert.match(generateOp.prompt, /Return ONLY one JSON object/);
    assert.match(generateOp.prompt, /Tool call:/);
    assert.match(generateOp.prompt, /Final:/);
    assert.match(generateOp.prompt, /Available tools:/);
    assert.match(generateOp.prompt, /CURRENT_TOOL_REQUEST/);
    assert.match(generateOp.prompt, /daemon_action/);
    assert.match(generateOp.prompt, /TOOL_RESULT_TAIL_MARKER/);
    console.log("OK: Android Local Gemma preserves tool continuation context when trimming");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaFallsBackToCompletedMemorySearchResult() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "tool_calls", tool_calls: [] }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "I want you to pull one random memory that is relevant." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_memory_search",
            type: "function",
            function: {
              name: "memory_search",
              arguments: JSON.stringify({ query: "dual-cart vape battery website", limit: 1 }),
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_memory_search",
          content: [
            'Memory search returned 1 actual retrieved memory for: "dual-cart vape battery website"',
            "These are real memory entries from the user's memory store.",
            "",
            "[1] memory_id=mem-vape-site [long_term/semantic] (goals, confidence: 96%) User is preparing a website to sell a dual-cart vape battery.",
          ].join("\n"),
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "memory_search",
          description: "Search canonical user memories.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" }, limit: { type: "number" } },
            required: ["query"],
          },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-memory-tool-fallback",
    }));

    assert.equal(result.textContent, "User is preparing a website to sell a dual-cart vape battery.\n\nSources: MemoryOS.");

    const jsonResult = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Return one relevant memory as JSON." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_memory_search_json",
            type: "function",
            function: { name: "memory_search", arguments: JSON.stringify({ query: "dual-cart vape battery" }) },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_memory_search_json",
          content: "[1] memory_id=mem-vape-site [long_term/semantic] (goals, confidence: 96%) User is preparing a website to sell a dual-cart vape battery.",
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "memory_search",
          description: "Search canonical user memories.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }],
      toolChoice: "auto",
      responseFormat: { type: "json_object" },
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-memory-tool-fallback",
    }));
    assert.deepEqual(JSON.parse(jsonResult.textContent), {
      content: "User is preparing a website to sell a dual-cart vape battery.",
      sources: ["MemoryOS"],
    });
    console.log("OK: Android Local Gemma falls back to completed memory search results");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesEmptyAssistantToolCallContinuation() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: JSON.stringify({ type: "final", content: "The screen result is available." }), finishReason: "stop" },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Read my screen." },
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_screen",
            type: "function",
            function: { name: "android_read_screen_context", arguments: "{}" },
          }],
        },
        { role: "tool", tool_call_id: "call_screen", content: "Visible text: JARVIS" },
        { role: "user", content: "What does it show?" },
      ],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "The screen result is available.");
    assert.match(requests[0].op.prompt, /assistant tool calls:\nandroid_read_screen_context\(\{\}\)/);
    assert.match(requests[0].op.prompt, /tool\(call_screen\): Visible text: JARVIS/);
    console.log("OK: Android Local Gemma preserves empty assistant tool-call continuations");
  } finally {
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

async function testAndroidLocalGemmaRecoversRequiredScreenshotFinalAnswer() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "I can take a screenshot." }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Take a screenshot" }],
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_screenshot"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma recovers required screenshot final answers");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversRequiredScreenshotToPhoneRuntime() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "I can take a screenshot." }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Take a screenshot" }],
      tools: [{
        type: "function",
        function: {
          name: "android_capture_screen",
          description: "Capture the phone screen through the Phone Runtime.",
          parameters: { type: "object", properties: {}, required: [] },
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
    assert.equal(result.toolCallList[0].function.name, "android_capture_screen");
    assert.equal(result.toolCallList[0].function.arguments, "{}");
    assert.match(requests[0].op.prompt, /android_capture_screen/);
    assert.doesNotMatch(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma recovers screenshot final answers to phone runtime");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRewritesDaemonScreenshotToPhoneRuntime() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "daemon_action", arguments: { action: "android_screenshot" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Take a screenshot" }],
      tools: [{
        type: "function",
        function: {
          name: "android_capture_screen",
          description: "Capture the phone screen through the Phone Runtime.",
          parameters: { type: "object", properties: {}, required: [] },
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
    assert.equal(result.toolCallList[0].function.name, "android_capture_screen");
    assert.equal(result.toolCallList[0].function.arguments, "{}");
    console.log("OK: Android Local Gemma rewrites daemon screenshots to phone runtime");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversRequiredOpenAppFinalAnswer() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "Opening YouTube." }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open youtube" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.youtube"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma recovers required open-app final answers");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversCatalogOpenAppToPhoneRuntime() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "Opening LinkedIn." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open LinkedIn." }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open an Android app by human name.",
          parameters: {
            type: "object",
            properties: { appName: { type: "string" } },
            required: ["appName"],
          },
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
    assert.equal(result.toolCallList[0].function.name, "android_open_app_by_name");
    assert.equal(result.toolCallList[0].function.arguments, '{"appName":"LinkedIn"}');
    console.log("OK: Android Local Gemma recovers catalog app names to phone runtime");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversCatalogSystemAppToPhoneRuntime() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "Opening Camera." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open Camera." }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open an Android app by human name.",
          parameters: {
            type: "object",
            properties: { appName: { type: "string" } },
            required: ["appName"],
          },
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
    assert.equal(result.toolCallList[0].function.name, "android_open_app_by_name");
    assert.equal(result.toolCallList[0].function.arguments, '{"appName":"Camera"}');
    console.log("OK: Android Local Gemma recovers catalog system app names to phone runtime");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversYoutubeSearchToPhoneRuntime() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "Searching YouTube." }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Search YouTube for local Gemma on Android videos." }],
      tools: [{
        type: "function",
        function: {
          name: "android_youtube_search",
          description: "Search the native YouTube app on the phone.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      }, {
        type: "function",
        function: {
          name: "search_youtube",
          description: "Search YouTube server-side.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
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
    assert.equal(result.toolCallList[0].function.name, "android_youtube_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"local Gemma on Android videos"}');
    assert.match(requests[0].op.prompt, /android_youtube_search/);
    console.log("OK: Android Local Gemma recovers YouTube search final answers to phone runtime");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRedirectsServerYoutubeSearchToPhoneRuntime() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "search_youtube", arguments: { query: "local Gemma on Android videos" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Search YouTube for local Gemma on Android videos." }],
      tools: [{
        type: "function",
        function: {
          name: "android_youtube_search",
          description: "Search the native YouTube app on the phone.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      }, {
        type: "function",
        function: {
          name: "search_youtube",
          description: "Search YouTube server-side.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
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
    assert.equal(result.toolCallList[0].function.name, "android_youtube_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"local Gemma on Android videos"}');
    console.log("OK: Android Local Gemma redirects server YouTube search to phone runtime for phone-search requests");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversSearchForQueryOnYoutube() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "Searching YouTube." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Search for cats on YouTube." }],
      tools: [{
        type: "function",
        function: {
          name: "android_youtube_search",
          description: "Search the native YouTube app on the phone.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_youtube_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"cats"}');
    console.log("OK: Android Local Gemma recovers search-for-query-on-YouTube phrasing");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesYoutubeResearchWorkflow() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "search_youtube", arguments: { query: "local Gemma on Android videos" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Search YouTube for local Gemma on Android videos and summarize the best video." }],
      tools: [{
        type: "function",
        function: {
          name: "android_youtube_search",
          description: "Search the native YouTube app on the phone.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      }, {
        type: "function",
        function: {
          name: "search_youtube",
          description: "Search YouTube server-side.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
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
    assert.equal(result.toolCallList[0].function.name, "search_youtube");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"local Gemma on Android videos"}');
    console.log("OK: Android Local Gemma preserves YouTube research workflow instead of phone search");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRecoverYoutubeResearchFinalToPhoneSearch() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can search YouTube and summarize a good video." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Search YouTube for local Gemma on Android videos and summarize the best video." }],
        tools: [{
          type: "function",
          function: {
            name: "android_youtube_search",
            description: "Search the native YouTube app on the phone.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        }, {
          type: "function",
          function: {
            name: "search_youtube",
            description: "Search YouTube server-side.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        }],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /local harness required a tool call[\s\S]*No cloud model was used/,
    );
    console.log("OK: Android Local Gemma does not recover YouTube research final answers to phone search");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversRequiredOpenAppRefusalFinalAnswer() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I am unable to open YouTube right now due to system restrictions." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open YouTube." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.youtube"}');
    console.log("OK: Android Local Gemma recovers required open-app refusal final answers");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversRequiredScreenshotRefusalFinalAnswer() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I am unable to take a screenshot on your device right now due to system restrictions." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Take a screenshot." }],
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_screenshot"}');
    console.log("OK: Android Local Gemma recovers required screenshot refusal final answers");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaInfersPackageForDirectOpenAppToolCalls() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{
          name: "daemon_action",
          arguments: { action: "android_open_app" },
        }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open YouTube" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.youtube"}');
    console.log("OK: Android Local Gemma infers package names for direct open-app tool calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaInfersPackageForInabilityOpenAppRequests() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "daemon_action", arguments: { action: "android_open_app" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "I can't open YouTube; can you open it?" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.youtube"}');
    console.log("OK: Android Local Gemma infers package names for inability open-app requests");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDropsNegatedOpenAppToolCallsWithoutPackageInference() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "daemon_action", arguments: { action: "android_open_app" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Don't open YouTube." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, "No device action was run.");
    assert.equal(result.toolCallList.length, 0);
    console.log("OK: Android Local Gemma drops negated open-app tool calls without package inference");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDropsAliasPackageForNegatedOpenAppToolCalls() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "daemon_action", arguments: { action: "open_youtube" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Don't open YouTube." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, "No device action was run.");
    assert.equal(result.toolCallList.length, 0);
    console.log("OK: Android Local Gemma drops alias packages for negated open-app tool calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsAllowedPackagesForMixedNegatedOpenAppToolCalls() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [
          { name: "daemon_action", arguments: { action: "android_open_app", packageName: "com.google.android.apps.maps" } },
          { name: "daemon_action", arguments: { action: "open_youtube" } },
        ],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open Maps without opening YouTube." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.apps.maps"}');
    console.log("OK: Android Local Gemma drops negated packages from mixed open-app tool calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsAllowedPackagesAfterCommaNegation() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [
          { name: "daemon_action", arguments: { action: "open_youtube" } },
          { name: "daemon_action", arguments: { action: "android_open_app", packageName: "com.google.android.apps.maps" } },
        ],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Don't open YouTube, open Maps." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.apps.maps"}');
    console.log("OK: Android Local Gemma drops negated packages after comma negation");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaInfersAllowedPackageForMixedNegatedBareOpenAppToolCall() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "daemon_action", arguments: { action: "android_open_app" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Don't open YouTube, open Maps." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.apps.maps"}');
    console.log("OK: Android Local Gemma infers allowed packages for mixed negated bare open-app calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsAliasesAfterNegatedPackageIdOpenAppToolCall() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "daemon_action", arguments: { action: "android_open_app" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Don't open org.telegram.messenger, open Maps." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.apps.maps"}');
    console.log("OK: Android Local Gemma keeps aliases after negated package-ID open-app requests");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversNegatedPackageIdFinalAnswerToAllowedAlias() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "Opening Maps." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Don't open org.telegram.messenger, open Maps." }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open an installed Android app by name.",
          parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
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
    assert.equal(result.toolCallList[0].function.name, "android_open_app_by_name");
    assert.equal(result.toolCallList[0].function.arguments, '{"appName":"maps"}');
    console.log("OK: Android Local Gemma recovers negated package-ID final answers to the allowed alias");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsAllowedPackagesAfterAndNegation() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [
          { name: "daemon_action", arguments: { action: "open_youtube" } },
          { name: "daemon_action", arguments: { action: "android_open_app", packageName: "com.google.android.apps.maps" } },
        ],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Don't open YouTube and open Maps." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.apps.maps"}');
    console.log("OK: Android Local Gemma drops negated packages after and-negation");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDropsAmbiguousBareOpenAppToolCalls() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [
          { name: "daemon_action", arguments: { action: "android_open_app" } },
          { name: "daemon_action", arguments: { action: "android_open_app" } },
        ],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open YouTube and Chrome." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, "I need one app target at a time for local app opening.");
    assert.equal(result.toolCallList.length, 0);
    console.log("OK: Android Local Gemma drops ambiguous bare open-app tool calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRecoverNegatedRequiredActions() {
  try {
    for (const request of [
      "Don't take a screenshot.",
      "Don’t take a screenshot.",
      "I can't take a screenshot.",
      "Why can’t I take a screenshot?",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({ type: "final", content: "I will not take a screenshot." }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
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

      assert.equal(result.finishReason, "stop");
      assert.equal(result.toolCallList.length, 0);
      assert.equal(result.textContent, "I will not take a screenshot.");
    }
    console.log("OK: Android Local Gemma does not recover negated required actions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotScreenshotWhenUserSaysTheyDidNotAsk() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [],
        output: "I did not initiate a screenshot request.",
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Why did you screenshot my screen I didn't ask for that?" }],
      tools: [{
        type: "function",
        function: {
          name: "android_capture_screen",
          description: "Capture the current Android screen.",
          parameters: { type: "object", properties: {} },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "I did not initiate a screenshot request.");
    console.log("OK: Android Local Gemma does not screenshot when the user says they did not ask");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAllowsCorrectiveCommandsAfterProtest() {
  try {
    for (const testCase of [
      { request: "I didn't ask you to open YouTube; open Chrome instead.", expectedArgs: '{"appName":"chrome"}' },
      { request: "I didn't ask you to open YouTube; can you open Chrome instead?", expectedArgs: '{"appName":"chrome"}' },
      { request: "I didn't ask you to open YouTube; open Signal instead.", expectedArgs: '{"appName":"Signal"}' },
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({ type: "final", content: "I can open Chrome instead." }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: testCase.request }],
        tools: [{
          type: "function",
          function: {
            name: "android_open_app_by_name",
            description: "Open a phone app by name.",
            parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
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
      assert.equal(result.toolCallList[0].function.name, "android_open_app_by_name");
      assert.equal(result.toolCallList[0].function.arguments, testCase.expectedArgs);
    }
    console.log("OK: Android Local Gemma allows corrective commands after protest wording");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAllowsCorrectiveNotificationRequestsAfterProtest() {
  try {
    for (const request of [
      "I didn't ask you to open YouTube; check my notifications instead.",
      "I didn't ask you to open YouTube; what notifications do I have instead?",
      "I didn't ask you to open YouTube; how many notifications do I have instead?",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({ type: "final", content: "I can check your notifications instead." }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
        tools: [{
          type: "function",
          function: {
            name: "android_read_notifications",
            description: "Read visible Android notifications.",
            parameters: { type: "object", properties: { limit: { type: "number" } } },
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
      assert.equal(result.toolCallList[0].function.name, "android_read_notifications");
      assert.equal(result.toolCallList[0].function.arguments, "{}");
    }
    console.log("OK: Android Local Gemma allows corrective notification requests after protest wording");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaBlocksNegatedCorrectiveCommandsAfterProtest() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I will not open Calculator." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "I didn't ask you to open YouTube but don't open Calculator." }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open a phone app by name.",
          parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "I will not open Calculator.");
    console.log("OK: Android Local Gemma blocks negated corrective commands after protest wording");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversCompoundOpenYoutubeSearchToPhoneRuntime() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can open YouTube and search for that." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open YouTube and search for Alex Hormozi videos." }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_app_by_name",
            description: "Open a phone app by name.",
            parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
          },
        },
        {
          type: "function",
          function: {
            name: "android_youtube_search",
            description: "Search the native YouTube app on the phone.",
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_youtube_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"Alex Hormozi videos"}');
    console.log("OK: Android Local Gemma recovers compound open-YouTube search to phone runtime");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversNotificationRequestsFromFinalDenials() {
  try {
    for (const request of [
      "Read my notifications",
      "What are my notifications?",
      "How many notifications do I have?",
      "android_read _notifications and tell me what they are",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({
            type: "final",
            content: "I cannot access your personal notifications or system-level data.",
          }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
        tools: [{
          type: "function",
          function: {
            name: "android_read_notifications",
            description: "Read visible Android notifications.",
            parameters: { type: "object", properties: { limit: { type: "number" } } },
          },
        }],
        toolChoice: "auto",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "tool_calls");
      assert.equal(result.textContent, "");
      assert.equal(result.toolCallList.length, 1);
      assert.equal(result.toolCallList[0].function.name, "android_read_notifications");
      assert.equal(result.toolCallList[0].function.arguments, "{}");
    }
    console.log("OK: Android Local Gemma recovers notification requests from final denials");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotReadNotificationsForMetaQuestions() {
  try {
    for (const request of [
      "Why are my notifications noisy?",
      "Are notifications enabled?",
      "Do I have notifications enabled?",
      "Do I have notifications on?",
      "Do I have notifications off?",
      "Any notification settings I should change?",
      "List ways to reduce Android notifications.",
      "Show me tips for managing notifications.",
      "What are notifications?",
      "Summarize how Android notifications work.",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({
            type: "final",
            content: "I can talk about notification settings without reading your notifications.",
          }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
        tools: [{
          type: "function",
          function: {
            name: "android_read_notifications",
            description: "Read visible Android notifications.",
            parameters: { type: "object", properties: { limit: { type: "number" } } },
          },
        }],
        toolChoice: "auto",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "stop");
      assert.equal(result.textContent, "I can talk about notification settings without reading your notifications.");
      assert.equal(result.toolCallList.length, 0);
    }
    console.log("OK: Android Local Gemma does not read notifications for meta questions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotReadNotificationsForNegatedRequests() {
  try {
    for (const request of [
      "Don't list my notifications.",
      "Please don't check my notifications.",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({
            type: "final",
            content: "I will not read your notifications.",
          }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
        tools: [{
          type: "function",
          function: {
            name: "android_read_notifications",
            description: "Read visible Android notifications.",
            parameters: { type: "object", properties: { limit: { type: "number" } } },
          },
        }],
        toolChoice: "auto",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "stop");
      assert.equal(result.textContent, "I will not read your notifications.");
      assert.equal(result.toolCallList.length, 0);
    }
    console.log("OK: Android Local Gemma does not read notifications for negated requests");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRecoverMultiAppOpenRequests() {
  try {
    for (const request of [
      "Open YouTube and Chrome.",
      "Open Calendar and Calculator.",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({
            type: "final",
            content: "Please choose one app to open.",
          }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
        tools: [{
          type: "function",
          function: {
            name: "android_open_app_by_name",
            description: "Open a phone app by name.",
            parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
          },
        }],
        toolChoice: "auto",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "stop");
      assert.equal(result.textContent, "Please choose one app to open.");
      assert.equal(result.toolCallList.length, 0);
    }
    console.log("OK: Android Local Gemma does not recover multi-app open requests");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRecoverOpenSourceQuestions() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "final",
        content: "Open source licenses are software license terms.",
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open source licenses?" }],
      tools: [{
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open a phone app by name.",
          parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
        },
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, "Open source licenses are software license terms.");
    assert.equal(result.toolCallList.length, 0);
    console.log("OK: Android Local Gemma does not recover open-source questions as app launches");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesRequiredInformationalPhoneFinalAnswers() {
  try {
    const cases: Array<{
      request: string;
      toolName: string;
      description: string;
      parameters: Record<string, unknown>;
      expected: string;
    }> = [
      {
        request: "What are notifications?",
        toolName: "android_read_notifications",
        description: "Read visible Android notifications.",
        parameters: { type: "object", properties: { limit: { type: "number" } } },
        expected: "Notifications are alerts from apps or the system.",
      },
      {
        request: "Do I have notifications on?",
        toolName: "android_read_notifications",
        description: "Read visible Android notifications.",
        parameters: { type: "object", properties: { limit: { type: "number" } } },
        expected: "Check notification settings to see whether they are on.",
      },
      {
        request: "List ways to reduce Android notifications.",
        toolName: "android_read_notifications",
        description: "Read visible Android notifications.",
        parameters: { type: "object", properties: { limit: { type: "number" } } },
        expected: "Try disabling low-value app alerts or using notification categories.",
      },
      {
        request: "Can you show me how to take a screenshot?",
        toolName: "android_capture_screen",
        description: "Capture the current Android screen.",
        parameters: { type: "object", properties: {} },
        expected: "Use the phone screenshot shortcut.",
      },
      {
        request: "How do I take a screenshot on Android?",
        toolName: "android_capture_screen",
        description: "Capture the current Android screen.",
        parameters: { type: "object", properties: {} },
        expected: "Use Power and Volume Down to take a screenshot.",
      },
      {
        request: "Can you tell me how I can take a screenshot?",
        toolName: "android_capture_screen",
        description: "Capture the current Android screen.",
        parameters: { type: "object", properties: {} },
        expected: "Use Power and Volume Down to take a screenshot.",
      },
      {
        request: "How do I open Chrome?",
        toolName: "android_open_app_by_name",
        description: "Open a phone app by name.",
        parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
        expected: "Tap Chrome from your app launcher.",
      },
      {
        request: "What's the best way to read my notifications?",
        toolName: "android_read_notifications",
        description: "Read visible Android notifications.",
        parameters: { type: "object", properties: { limit: { type: "number" } } },
        expected: "Use the notification shade or notification settings.",
      },
      {
        request: "Open Calendar and Calculator.",
        toolName: "android_open_app_by_name",
        description: "Open a phone app by name.",
        parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
        expected: "Please choose one app to open.",
      },
      {
        request: "What's wrong with my phone?",
        toolName: "android_read_screen_context",
        description: "Read the current Android screen context.",
        parameters: { type: "object", properties: {} },
        expected: "I can answer generic phone questions without reading your screen.",
      },
    ];

    for (const testCase of cases) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({
            type: "final",
            content: testCase.expected,
          }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: testCase.request }],
        tools: [{
          type: "function",
          function: {
            name: testCase.toolName,
            description: testCase.description,
            parameters: testCase.parameters,
          },
        }],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "stop");
      assert.equal(result.textContent, testCase.expected);
      assert.equal(result.toolCallList.length, 0);
    }
    console.log("OK: Android Local Gemma preserves required informational phone final answers");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversRequiredNotificationActions() {
  try {
    for (const request of [
      "Open my notifications.",
      "Open the notification shade.",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({
            type: "final",
            content: "I cannot open notifications from here.",
          }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
        tools: [{
          type: "function",
          function: {
            name: "android_read_notifications",
            description: "Read visible Android notifications.",
            parameters: { type: "object", properties: { limit: { type: "number" } } },
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
      assert.equal(result.toolCallList[0].function.name, "android_read_notifications");
      assert.equal(result.toolCallList[0].function.arguments, "{}");
    }
    console.log("OK: Android Local Gemma recovers required notification actions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotAutoRecoverInformationalScreenshotQuestions() {
  try {
    for (const request of [
      "How do I take a screenshot on Android?",
      "Can you show me how to take a screenshot?",
      "Can you show me screenshots of Android notification settings?",
      "Search for screenshots of Android notification settings.",
      "Can you show me how to open Chrome?",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({
            type: "final",
            content: "On Android, use the device shortcut or app icon.",
          }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
        tools: [
          {
            type: "function",
            function: {
              name: "android_capture_screen",
              description: "Capture the current Android screen.",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "android_open_app_by_name",
              description: "Open a phone app by name.",
              parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
            },
          },
        ],
        toolChoice: "auto",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "stop");
      assert.equal(result.textContent, "On Android, use the device shortcut or app icon.");
      assert.equal(result.toolCallList.length, 0);
    }
    console.log("OK: Android Local Gemma does not auto-recover informational screenshot questions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotReadScreenForGenericPhoneQuestions() {
  try {
    for (const request of [
      "What's wrong with my phone?",
      "What's the best phone?",
      "My phone screen is cracked; what should I do?",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({
            type: "final",
            content: "I can answer generic phone questions without reading your screen.",
          }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
        tools: [{
          type: "function",
          function: {
            name: "android_read_screen_context",
            description: "Read the current Android screen context.",
            parameters: { type: "object", properties: {} },
          },
        }],
        toolChoice: "auto",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "stop");
      assert.equal(result.textContent, "I can answer generic phone questions without reading your screen.");
      assert.equal(result.toolCallList.length, 0);
    }
    console.log("OK: Android Local Gemma does not read screen for generic phone questions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversScreenReadQuestionsInAutoMode() {
  try {
    for (const request of [
      "What's on my screen?",
      "What does my phone show?",
    ]) {
      _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
        ok: true,
        data: {
          text: JSON.stringify({
            type: "final",
            content: "I cannot access your screen directly.",
          }),
          finishReason: "stop",
        },
      }));

      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: request }],
        tools: [{
          type: "function",
          function: {
            name: "android_read_screen_context",
            description: "Read the current Android screen context.",
            parameters: { type: "object", properties: {} },
          },
        }],
        toolChoice: "auto",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "tool_calls");
      assert.equal(result.textContent, "");
      assert.equal(result.toolCallList.length, 1);
      assert.equal(result.toolCallList[0].function.name, "android_read_screen_context");
      assert.equal(result.toolCallList[0].function.arguments, "{}");
    }
    console.log("OK: Android Local Gemma recovers screen-read questions in auto mode");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRoutesCompoundScreenshotRequestsToNavigationFirst() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "Opening YouTube and then taking a screenshot." }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open YouTube and take a screenshot." }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.youtube"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma routes compound screenshot requests to navigation first");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRecoverHomeScreenAsScreenshot() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "Going to the home screen." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Take me to the home screen." }],
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
    console.log("OK: Android Local Gemma does not recover home-screen wording as screenshot");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaReadsScreenAfterRecoveredNavigation() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "YouTube is open." }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open YouTube and take a screenshot." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_open_youtube",
            type: "function",
            function: { name: "daemon_action", arguments: "{\"action\":\"android_open_app\",\"packageName\":\"com.google.android.youtube\"}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_open_youtube",
          content: "{\"ok\":true,\"message\":\"YouTube opened\"}",
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_read_screen"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma reads screen after recovered navigation");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaScreenshotsAfterRecoveredReadScreen() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "The target screen is visible." }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open YouTube and take a screenshot." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_open_youtube",
            type: "function",
            function: { name: "daemon_action", arguments: "{\"action\":\"android_open_app\",\"packageName\":\"com.google.android.youtube\"}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_open_youtube",
          content: "{\"ok\":true,\"message\":\"YouTube opened\"}",
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_read_screen",
            type: "function",
            function: { name: "daemon_action", arguments: "{\"action\":\"android_read_screen\"}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_read_screen",
          content: "{\"ok\":true,\"text\":\"YouTube Home\"}",
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_screenshot"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma screenshots after recovered read-screen");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesProtectedAppScreenshotRefusalAfterReadScreen() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "final",
        content: "I am unable to take a screenshot on Instagram right now due to system restrictions.",
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open Instagram and take a screenshot." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_open_instagram",
            type: "function",
            function: { name: "daemon_action", arguments: "{\"action\":\"android_open_app\",\"packageName\":\"com.instagram.android\"}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_open_instagram",
          content: "{\"ok\":true,\"message\":\"Instagram opened\"}",
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_read_screen",
            type: "function",
            function: { name: "daemon_action", arguments: "{\"action\":\"android_read_screen\"}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_read_screen",
          content: "{\"ok\":true,\"text\":\"Instagram Home\"}",
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.match(result.textContent, /unable to take a screenshot/i);
    assert.equal(result.toolCallList.length, 0);
    console.log("OK: Android Local Gemma preserves protected-app screenshot refusals after read-screen");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaScopesCompletedNavigationToCurrentRequest() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "Opening YouTube and then taking a screenshot." }),
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open Chrome." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_open_chrome",
            type: "function",
            function: { name: "daemon_action", arguments: "{\"action\":\"android_open_app\",\"packageName\":\"com.android.chrome\"}" },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_open_chrome",
          content: "{\"ok\":true,\"message\":\"Chrome opened\"}",
        },
        { role: "assistant", content: "Chrome is open." },
        { role: "user", content: "Open YouTube and take a screenshot." },
      ],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Perform an Android daemon action.",
          parameters: {
            type: "object",
            properties: { action: { type: "string" }, packageName: { type: "string" } },
            required: ["action"],
          },
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
    assert.equal(result.toolCallList[0].function.arguments, '{"action":"android_open_app","packageName":"com.google.android.youtube"}');
    assert.match(requests[0].op.prompt, /daemon_action/);
    console.log("OK: Android Local Gemma scopes completed navigation to current request");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesYoutubeTranscriptRouting() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can summarize that YouTube video." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Summarize https://youtube.com/watch?v=dQw4w9WgXcQ" }],
        tools: [
          {
            type: "function",
            function: {
              name: "daemon_action",
              description: "Perform an Android daemon action.",
              parameters: { type: "object", properties: { action: { type: "string" }, url: { type: "string" } }, required: ["action"] },
            },
          },
          {
            type: "function",
            function: {
              name: "get_youtube_transcript",
              description: "Fetch a YouTube transcript.",
              parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
            },
          },
        ],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /local harness required a tool call[\s\S]*No cloud model was used/,
    );
    console.log("OK: Android Local Gemma preserves YouTube transcript routing");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesCoachYoutubeTranscriptRouting() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can summarize that YouTube video." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Summarize this YouTube video https://youtube.com/watch?v=dQw4w9WgXcQ" }],
        tools: [
          {
            type: "function",
            function: {
              name: "daemon_action",
              description: "Perform an Android daemon action.",
              parameters: { type: "object", properties: { action: { type: "string" }, url: { type: "string" } }, required: ["action"] },
            },
          },
          {
            type: "function",
            function: {
              name: "fetch_youtube_transcript",
              description: "Fetch a YouTube transcript for coach chat.",
              parameters: { type: "object", properties: { videoId: { type: "string" }, url: { type: "string" } } },
            },
          },
        ],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /local harness required a tool call[\s\S]*No cloud model was used/,
    );
    console.log("OK: Android Local Gemma preserves coach YouTube transcript routing");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRecoverYoutubeTranscriptUrlToPhoneOpen() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can summarize that YouTube video." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Summarize this YouTube video https://youtube.com/watch?v=dQw4w9WgXcQ" }],
        tools: [
          {
            type: "function",
            function: {
              name: "android_open_phone_url",
              description: "Open a URL on the Android phone.",
              parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
            },
          },
          {
            type: "function",
            function: {
              name: "get_youtube_transcript",
              description: "Fetch a YouTube transcript.",
              parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
            },
          },
        ],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /local harness required a tool call[\s\S]*No cloud model was used/,
    );
    console.log("OK: Android Local Gemma does not recover YouTube transcript URLs to phone open");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaStillRecoversNonYoutubeUrlToPhoneOpen() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can open that page." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open and summarize https://example.com/article" }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
    assert.equal(result.toolCallList[0].function.arguments, '{"url":"https://example.com/article"}');
    console.log("OK: Android Local Gemma still recovers non-YouTube URLs to phone open");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversBareDomainToPhoneOpen() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can open that site." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open example.com." }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
    assert.equal(result.toolCallList[0].function.arguments, '{"url":"https://example.com"}');
    console.log("OK: Android Local Gemma recovers bare domains to phone URL opens");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesBareDomainQueryToPhoneOpen() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can open that site." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open example.com?x=1." }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
    assert.equal(result.toolCallList[0].function.arguments, '{"url":"https://example.com?x=1"}');
    console.log("OK: Android Local Gemma preserves bare-domain query strings for phone URL opens");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsAppSubdomainsAsPhoneUrls() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can open that site." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open app.slack.com." }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
        {
          type: "function",
          function: {
            name: "android_open_app_by_name",
            description: "Open an installed Android app by name.",
            parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
    assert.equal(result.toolCallList[0].function.arguments, '{"url":"https://app.slack.com"}');
    console.log("OK: Android Local Gemma keeps app subdomains as phone URLs");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsUnknownTldSubdomainsAsPhoneUrls() {
  const cases = [
    { prompt: "Open app.example.help.", url: "https://app.example.help" },
    { prompt: "Open dev.example.run.", url: "https://dev.example.run" },
    { prompt: "Open go.example.com.", url: "https://go.example.com" },
    { prompt: "Open id.example.com.", url: "https://id.example.com" },
  ];

  for (const testCase of cases) {
    _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "I can open that site." }),
        finishReason: "stop",
      },
    }));

    try {
      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: testCase.prompt }],
        tools: [
          {
            type: "function",
            function: {
              name: "android_open_phone_url",
              description: "Open a URL on the Android phone.",
              parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
            },
          },
          {
            type: "function",
            function: {
              name: "android_open_app_by_name",
              description: "Open an installed Android app by name.",
              parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
            },
          },
        ],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "tool_calls");
      assert.equal(result.textContent, "");
      assert.equal(result.toolCallList.length, 1);
      assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
      assert.equal(result.toolCallList[0].function.arguments, JSON.stringify({ url: testCase.url }));
    } finally {
      _setAndroidLocalGemmaDaemonOpForTesting(null);
    }
  }

  console.log("OK: Android Local Gemma keeps unknown-TLD subdomains as phone URLs");
}

async function testAndroidLocalGemmaDoesNotRecoverPackageIdAsPhoneUrl() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can open YouTube." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open com.google.android.youtube." }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
        {
          type: "function",
          function: {
            name: "android_open_app_by_name",
            description: "Open an installed Android app by name.",
            parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_app_by_name");
    assert.equal(result.toolCallList[0].function.arguments, '{"appName":"youtube"}');
    console.log("OK: Android Local Gemma does not recover package IDs as phone URLs");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRecoverUnlistedPackageIdAsPhoneUrl() {
  for (const packageName of [
    "com.twitter.android",
    "org.telegram.messenger",
    "com.ubercab",
    "tv.twitch.android.app",
    "me.lyft.android",
    "de.blinkt.openvpn",
  ]) {
    _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
      ok: true,
      data: {
        text: JSON.stringify({ type: "final", content: "I can open that app." }),
        finishReason: "stop",
      },
    }));

    try {
      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: `Open ${packageName}.` }],
        tools: [
          {
            type: "function",
            function: {
              name: "android_open_phone_url",
              description: "Open a URL on the Android phone.",
              parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
            },
          },
          {
            type: "function",
            function: {
              name: "android_open_app_by_name",
              description: "Open an installed Android app by name.",
              parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
            },
          },
        ],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "tool_calls");
      assert.equal(result.textContent, "");
      assert.equal(result.toolCallList.length, 1);
      assert.equal(result.toolCallList[0].function.name, "android_open_app_by_name");
      assert.equal(result.toolCallList[0].function.arguments, JSON.stringify({ appName: packageName }));
    } finally {
      _setAndroidLocalGemmaDaemonOpForTesting(null);
    }
  }

  console.log("OK: Android Local Gemma does not recover unlisted package IDs as phone URLs");
}

async function testAndroidLocalGemmaRecoversDeepLinkUrlToPhoneOpen() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can open that location." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open geo:0,0?q=coffee." }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
    assert.equal(result.toolCallList[0].function.arguments, '{"url":"geo:0,0?q=coffee"}');
    console.log("OK: Android Local Gemma recovers deep-link URLs to phone open");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsPhoneUrlToolForPronounConfirmations() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "android_open_phone_url", arguments: { url: "geo:0,0?q=coffee" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open geo:0,0?q=coffee." },
        { role: "assistant", content: "Should I open that on your phone?" },
        { role: "user", content: "yes" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
    assert.equal(result.toolCallList[0].function.arguments, '{"url":"geo:0,0?q=coffee"}');
    console.log("OK: Android Local Gemma keeps phone URL tool for pronoun confirmations");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsPhoneUrlToolForExplicitUrlConfirmations() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "android_open_phone_url", arguments: { url: "https://example.com" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "assistant", content: "Should I open example.com?" },
        { role: "user", content: "yes" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
    assert.equal(result.toolCallList[0].function.arguments, '{"url":"https://example.com"}');
    console.log("OK: Android Local Gemma keeps phone URL tool for explicit URL confirmations");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsPhoneUrlToolForGenericUrlConfirmations() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "android_open_phone_url", arguments: { url: "https://example.com" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Open example.com." },
        { role: "assistant", content: "Do you want me to proceed?" },
        { role: "user", content: "yes" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
    assert.equal(result.toolCallList[0].function.arguments, '{"url":"https://example.com"}');
    console.log("OK: Android Local Gemma keeps phone URL tool for generic URL confirmations");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotUsePhoneUrlToolForUnrelatedConfirmations() {
  for (const assistantPrompt of [
    "Should I search memory first?",
    "Do you want me to proceed with the memory search?",
  ]) {
    _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
      ok: true,
      data: {
        text: JSON.stringify({
          type: "tool_calls",
          tool_calls: [{ name: "android_open_phone_url", arguments: { url: "geo:0,0?q=coffee" } }],
        }),
        finishReason: "stop",
      },
    }));

    try {
      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [
          { role: "user", content: "Open geo:0,0?q=coffee." },
          { role: "assistant", content: assistantPrompt },
          { role: "user", content: "yes" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "android_open_phone_url",
              description: "Open a URL on the Android phone.",
              parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
            },
          },
        ],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      }));

      assert.equal(result.finishReason, "stop");
      assert.equal(result.toolCallList.length, 0);
      assert.equal(result.textContent, "Phone Gemma did not return a usable local answer for that request.");
    } finally {
      _setAndroidLocalGemmaDaemonOpForTesting(null);
    }
  }

  console.log("OK: Android Local Gemma does not use phone URL tools for unrelated confirmations");
}

async function testAndroidLocalGemmaUsesToolProtocolForBareDeepLinks() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can open that location." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "geo:0,0?q=coffee" }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "android_open_phone_url");
    assert.equal(result.toolCallList[0].function.arguments, '{"url":"geo:0,0?q=coffee"}');
    console.log("OK: Android Local Gemma uses tool protocol for bare deep links");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotOpenInformationalDeepLinkMentions() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "That looks like an Android location deep link." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What does geo:0,0?q=coffee mean?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "That looks like an Android location deep link.");
    console.log("OK: Android Local Gemma does not open informational deep-link mentions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotOpenAdvisoryUrlQuestions() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "final",
        content: "You should only open that link if you trust it.",
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Hey Jarvis, should I open https://example.com?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "You should only open that link if you trust it.");
    console.log("OK: Android Local Gemma does not open advisory URL questions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesCheckIfUrlIsSafeAnswers() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "final",
        content: "I would not open that unless you trust the source.",
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Can you check if https://example.com is safe to open?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "I would not open that unless you trust the source.");
    console.log("OK: Android Local Gemma preserves check-if-URL-is-safe answers");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesAdvisoryUrlAnswersWithUrlBackedTools() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "final",
        content: "That YouTube link is not automatically safe just because it is from YouTube.",
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Is https://youtu.be/dQw4w9WgXcQ safe to open?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_youtube_transcript",
            description: "Fetch a YouTube transcript.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
        {
          type: "function",
          function: {
            name: "web_fetch",
            description: "Fetch web URL content.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "That YouTube link is not automatically safe just because it is from YouTube.");
    console.log("OK: Android Local Gemma preserves advisory URL answers when URL-backed tools exist");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaGracefullyRejectsAdvisoryPhoneUrlToolCalls() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "android_open_phone_url", arguments: { url: "https://example.com" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Should I open https://example.com?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "Phone Gemma did not return a usable local answer for that request.");
    console.log("OK: Android Local Gemma gracefully rejects advisory phone URL tool calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRejectsUrlSafetyQuestionToolCalls() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "android_open_phone_url", arguments: { url: "https://example.com" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Is https://example.com safe to open?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_phone_url",
            description: "Open a URL on the Android phone.",
            parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "Phone Gemma did not return a usable local answer for that request.");
    console.log("OK: Android Local Gemma rejects URL safety question tool calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRecoverAdvisoryUrlAsAppOpen() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "tool_calls", tool_calls: [] }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Should I open https://example.com?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "android_open_app_by_name",
            description: "Open an installed Android app by name.",
            parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "Phone Gemma did not return a usable local answer for that request.");
    console.log("OK: Android Local Gemma does not recover advisory URLs as app opens");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRejectsAdvisoryLegacyBrowseToolCalls() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "daemon_action", arguments: { action: "android_browse", url: "https://example.com" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Should I open https://example.com?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "daemon_action",
            description: "Legacy Android daemon action bridge.",
            parameters: {
              type: "object",
              properties: { action: { type: "string" }, url: { type: "string" } },
              required: ["action"],
            },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "Phone Gemma did not return a usable local answer for that request.");
    console.log("OK: Android Local Gemma rejects advisory legacy browse tool calls");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRepeatCompletedRecoveredActions() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "Screenshot captured." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [
          { role: "user", content: "Take a screenshot." },
          {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call_screenshot",
              type: "function",
              function: { name: "daemon_action", arguments: "{\"action\":\"android_screenshot\"}" },
            }],
          },
          {
            role: "tool",
            tool_call_id: "call_screenshot",
            content: "{\"ok\":true,\"message\":\"Screenshot captured\"}",
          },
        ],
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
    console.log("OK: Android Local Gemma does not repeat completed recovered actions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotAdvanceAfterFailedDaemonAction() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "Continuing with the screenshot." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [
          { role: "user", content: "Open YouTube and take a screenshot." },
          {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call_open_youtube",
              type: "function",
              function: { name: "daemon_action", arguments: "{\"action\":\"android_open_app\",\"packageName\":\"com.google.android.youtube\"}" },
            }],
          },
          {
            role: "tool",
            tool_call_id: "call_open_youtube",
            content: "{\"ok\":false,\"error\":\"daemon disconnected\"}",
          },
        ],
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
    console.log("OK: Android Local Gemma does not advance after failed daemon actions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDisplaysJsonShapedFinalRepliesAsText() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ response: "I am unable to open YouTube right now due to system restrictions." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What happened?" }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, "I am unable to open YouTube right now due to system restrictions.");
    console.log("OK: Android Local Gemma displays JSON-shaped final replies as text");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesEmbeddedJsonInFinalReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: 'Here is the JSON: {"message":"hello"}',
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Show me a JSON example." }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, 'Here is the JSON: {"message":"hello"}');
    console.log("OK: Android Local Gemma preserves embedded JSON in final replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesRequestedWholeJsonFinalReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ message: "hello" }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Return a JSON object with a message of hello." }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, '{"message":"hello"}');
    console.log("OK: Android Local Gemma preserves requested whole JSON final replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesGiveMeJsonFinalReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ message: "hello" }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Give me JSON with a message field set to hello." }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, '{"message":"hello"}');
    console.log("OK: Android Local Gemma preserves give-me-JSON final replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesNeedJsonFinalReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ message: "hello" }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "I need JSON with a message field set to hello." }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, '{"message":"hello"}');
    console.log("OK: Android Local Gemma preserves need-JSON final replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesShowMeJsonFinalReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ message: "hello" }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Show me JSON with a message field set to hello." }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, '{"message":"hello"}');
    console.log("OK: Android Local Gemma preserves show-me-JSON final replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaUnwrapsJsonMentionTroubleshootingReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ response: "The previous message was shown as raw JSON because the model returned an error envelope." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Why did the phone show raw JSON?" }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, "The previous message was shown as raw JSON because the model returned an error envelope.");
    console.log("OK: Android Local Gemma unwraps JSON-mention troubleshooting replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaUnwrapsWantToKnowJsonTroubleshootingReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ response: "The previous message was shown as raw JSON because the model returned an error envelope." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "I want to know why the phone showed raw JSON." }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, "The previous message was shown as raw JSON because the model returned an error envelope.");
    console.log("OK: Android Local Gemma unwraps want-to-know JSON troubleshooting replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesJsonResponseFormatFinalReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ message: "hello" }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Return the requested object." }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      responseFormat: { type: "json_object" },
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, '{"message":"hello"}');
    console.log("OK: Android Local Gemma preserves JSON response format final replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPreservesRequestedJsonInToolProtocolFinalReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ message: "hello" }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Return a JSON object with a message of hello about my phone." }],
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

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, '{"message":"hello"}');
    console.log("OK: Android Local Gemma preserves requested JSON in tool-protocol final replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaExtractsEmbeddedProtocolFinalReplies() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: 'Here is the answer: {"type":"final","content":"ok"}',
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What is on my phone?" }],
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

    assert.equal(result.finishReason, "stop");
    assert.equal(result.textContent, "ok");
    console.log("OK: Android Local Gemma extracts embedded protocol final replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRejectsFinalAnswerWhenLocalToolRequired() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I need a tool, but I did not choose one." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Use the required local tool for this ambiguous request." }],
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

async function testAndroidLocalGemmaDoesNotThrowInvalidLocalToolForPlainIdentityQuestion() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "daemon_action", arguments: { action: "android_open_app" } }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What's my name?" }],
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

    assert.equal(result.finishReason, "stop");
    assert.equal(result.toolCallList.length, 0);
    assert.equal(result.textContent, "Phone Gemma did not return a usable local answer for that request.");
    console.log("OK: Android Local Gemma does not throw invalid local tools for plain identity questions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversMemorySearchFromIdentityToolHallucination() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({
        type: "tool_calls",
        tool_calls: [{ name: "identify_user", arguments: {} }],
      }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What's my name?" }],
      tools: [{
        type: "function",
        function: {
          name: "memory_search",
          description: "Search user memory.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" }, limit: { type: "number" } },
            required: ["query"],
          },
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
    assert.equal(result.toolCallList[0].function.name, "memory_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"user name identity nickname profile what is my name who am i"}');
    console.log("OK: Android Local Gemma recovers identity hallucinations to memory_search");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversMemorySearchFromRequiredIdentityFinalAnswer() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I do not know who you are." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Who am I?" }],
      tools: [{
        type: "function",
        function: {
          name: "memory_search",
          description: "Search user memory.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" }, limit: { type: "number" } },
            required: ["query"],
          },
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
    assert.equal(result.toolCallList[0].function.name, "memory_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"user name identity nickname profile what is my name who am i"}');
    console.log("OK: Android Local Gemma forces memory_search before identity final answers");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotRewriteWhoAmIContinuationsAsIdentitySearch() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can check your calendar for that." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Who am I meeting tomorrow?" }],
        tools: [{
          type: "function",
          function: {
            name: "memory_search",
            description: "Search user memory.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, limit: { type: "number" } },
              required: ["query"],
            },
          },
        }],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /required a tool call/,
    );
    console.log("OK: Android Local Gemma does not rewrite who-am-I continuations as identity search");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversMemorySaveFromRequiredSaveFinalAnswer() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I'll remember that." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Remember that Justin Battles is my personal name." }],
      tools: [
        {
          type: "function",
          function: {
            name: "memory_search",
            description: "Search user memory.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, limit: { type: "number" } },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "memory_save",
            description: "Save a user-provided memory.",
            parameters: {
              type: "object",
              properties: {
                content: { type: "string" },
                confidence: { type: "number" },
                tier: { type: "string" },
                memory_type: { type: "string" },
                source_ref: { type: "string" },
              },
              required: ["content"],
            },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "memory_save");
    const args = JSON.parse(result.toolCallList[0].function.arguments);
    assert.equal(args.content, "Justin Battles is my personal name.");
    assert.equal(args.confidence, 95);
    assert.equal(args.tier, "long_term");
    assert.equal(args.memory_type, "semantic");
    console.log("OK: Android Local Gemma recovers explicit memory saves to memory_save");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPrioritizesMemorySaveOverPhoneYoutubeRecovery() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I will remember that." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Remember that I search YouTube for jazz." }],
      tools: [{
        type: "function",
        function: {
          name: "memory_save",
          description: "Save a memory.",
          parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
        },
      }, {
        type: "function",
        function: {
          name: "android_youtube_search",
          description: "Search the native YouTube app on the phone.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "memory_save");
    assert.match(result.toolCallList[0].function.arguments, /search YouTube for jazz/);
    console.log("OK: Android Local Gemma prioritizes memory save over phone YouTube recovery");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaPrioritizesMemorySearchOverOpenYoutubeRecovery() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can check memory." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Do you remember how to open YouTube?" }],
      tools: [{
        type: "function",
        function: {
          name: "memory_search",
          description: "Search memory.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      }, {
        type: "function",
        function: {
          name: "android_open_app_by_name",
          description: "Open a phone app by name.",
          parameters: { type: "object", properties: { appName: { type: "string" } }, required: ["appName"] },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "memory_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"Do you remember how to open YouTube?"}');
    console.log("OK: Android Local Gemma prioritizes memory search over open-YouTube recovery");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversRememberMyMemorySaveWithoutCopula() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I'll remember that." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Remember my birthday: January 1." }],
      tools: [
        {
          type: "function",
          function: {
            name: "memory_search",
            description: "Search user memory.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, limit: { type: "number" } },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "memory_save",
            description: "Save a user-provided memory.",
            parameters: {
              type: "object",
              properties: {
                content: { type: "string" },
                confidence: { type: "number" },
                tier: { type: "string" },
                memory_type: { type: "string" },
                source_ref: { type: "string" },
              },
              required: ["content"],
            },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "memory_save");
    const args = JSON.parse(result.toolCallList[0].function.arguments);
    assert.equal(args.content, "my birthday: January 1.");
    console.log("OK: Android Local Gemma recovers imperative remember-my facts to memory_save");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRecoversPoliteRememberMyMemorySave() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I'll remember that." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Can you remember my birthday is January 1?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "memory_search",
            description: "Search user memory.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, limit: { type: "number" } },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "memory_save",
            description: "Save a user-provided memory.",
            parameters: {
              type: "object",
              properties: {
                content: { type: "string" },
                confidence: { type: "number" },
                tier: { type: "string" },
                memory_type: { type: "string" },
                source_ref: { type: "string" },
              },
              required: ["content"],
            },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "memory_save");
    const args = JSON.parse(result.toolCallList[0].function.arguments);
    assert.equal(args.content, "my birthday is January 1");
    console.log("OK: Android Local Gemma recovers polite remember-my facts to memory_save");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotSaveRememberMyQuestions() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can check memory for that." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Remember my birthday?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "memory_search",
            description: "Search user memory.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, limit: { type: "number" } },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "memory_save",
            description: "Save a user-provided memory.",
            parameters: {
              type: "object",
              properties: { content: { type: "string" } },
              required: ["content"],
            },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "memory_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"Remember my birthday?"}');
    console.log("OK: Android Local Gemma searches instead of saving remember-my questions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotSaveDoYouRememberQuestions() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can check memory for that." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Do you remember that my birthday is Jan 1?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "memory_search",
            description: "Search user memory.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, limit: { type: "number" } },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "memory_save",
            description: "Save a user-provided memory.",
            parameters: {
              type: "object",
              properties: { content: { type: "string" } },
              required: ["content"],
            },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "memory_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"Do you remember that my birthday is Jan 1?"}');
    console.log("OK: Android Local Gemma searches instead of saving do-you-remember questions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaSearchesSavedMemoryQuestions() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I can check memory for that." }),
      finishReason: "stop",
    },
  }));

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "What memories did you save about me?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "memory_search",
            description: "Search user memory.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, limit: { type: "number" } },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "memory_save",
            description: "Save a user-provided memory.",
            parameters: {
              type: "object",
              properties: { content: { type: "string" } },
              required: ["content"],
            },
          },
        },
      ],
      toolChoice: "required",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.textContent, "");
    assert.equal(result.toolCallList.length, 1);
    assert.equal(result.toolCallList[0].function.name, "memory_search");
    assert.equal(result.toolCallList[0].function.arguments, '{"query":"What memories did you save about me?"}');
    console.log("OK: Android Local Gemma searches instead of saving saved-memory questions");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotSaveEmptyRememberCommands() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: true,
    data: {
      text: JSON.stringify({ type: "final", content: "I'll remember that." }),
      finishReason: "stop",
    },
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Can you remember that?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "memory_search",
              description: "Search user memory.",
              parameters: {
                type: "object",
                properties: { query: { type: "string" }, limit: { type: "number" } },
                required: ["query"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "memory_save",
              description: "Save a user-provided memory.",
              parameters: {
                type: "object",
                properties: { content: { type: "string" } },
                required: ["content"],
              },
            },
          },
        ],
        toolChoice: "required",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      /required a tool call/,
    );
    console.log("OK: Android Local Gemma does not persist empty remember commands");
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

async function testAndroidLocalGemmaContinuesLengthLimitedPlainReplies() {
  const generatePrompts: string[] = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (_userId, op) => {
    assert.equal(op.type, "android_local_model_generate");
    generatePrompts.push(op.prompt);
    if (generatePrompts.length === 1) {
      return {
        ok: true,
        data: {
          text: "1. Product photography. 2. Detailed description. Be",
          finishReason: "length",
        },
      };
    }
    return {
      ok: true,
      data: {
        text: " specific about compatibility and safety features.",
        finishReason: "stop",
      },
    };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Help me prepare my dual cart vape battery for sale." }],
      toolChoice: "none",
      maxCompletionTokens: 2000,
      stream: false,
      userId: "user-phone-length-continuation",
    }));

    assert.equal(generatePrompts.length, 2);
    assert.match(generatePrompts[1], /Continue the assistant response/);
    assert.equal(
      result.textContent,
      "1. Product photography. 2. Detailed description. Be specific about compatibility and safety features.",
    );
    assert.equal(result.finishReason, "stop");
    console.log("OK: Android Local Gemma completes a plain reply after its first segment reaches the token limit");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaContinuationRespectsRemainingCompletionBudget() {
  const maxTokens: number[] = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (_userId, op) => {
    assert.equal(op.type, "android_local_model_generate");
    assert.equal(typeof op.maxTokens, "number");
    maxTokens.push(op.maxTokens!);
    return maxTokens.length === 1
      ? { ok: true, data: { text: "First segment", finishReason: "length" } }
      : { ok: true, data: { text: "second segment", finishReason: "stop" } };
  });

  try {
    await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Give me a complete answer." }],
      toolChoice: "none",
      maxCompletionTokens: 200,
      stream: false,
      userId: "user-phone-length-budget",
    }));

    assert.deepEqual(maxTokens, [128, 72]);
    console.log("OK: Android Local Gemma continuation stays within the caller completion budget");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaKeepsPartialReplyWhenContinuationFails() {
  let generateCount = 0;
  _setAndroidLocalGemmaDaemonOpForTesting(async (_userId, op) => {
    assert.equal(op.type, "android_local_model_generate");
    generateCount += 1;
    return generateCount === 1
      ? { ok: true, data: { text: "Useful partial answer", finishReason: "length" } }
      : { ok: false, error: "LOCAL_MODEL_BUSY: Phone Gemma is already generating." };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Give me a complete answer." }],
      toolChoice: "none",
      maxCompletionTokens: 256,
      stream: false,
      userId: "user-phone-length-fail-open",
    }));

    assert.equal(result.textContent, "Useful partial answer");
    assert.equal(result.finishReason, "length");
    console.log("OK: Android Local Gemma preserves useful partial text when continuation fails");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotContinueUserRequestedJson() {
  let generateCount = 0;
  _setAndroidLocalGemmaDaemonOpForTesting(async (_userId, op) => {
    assert.equal(op.type, "android_local_model_generate");
    generateCount += 1;
    return { ok: true, data: { text: '{"answer":"partial"}', finishReason: "length" } };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Return the answer as JSON." }],
      toolChoice: "none",
      maxCompletionTokens: 256,
      stream: false,
      userId: "user-phone-length-json",
    }));

    assert.equal(generateCount, 1);
    assert.equal(result.textContent, '{"answer":"partial"}');
    assert.equal(result.finishReason, "length");
    console.log("OK: Android Local Gemma does not splice user-requested JSON continuations");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotContinuePromptOnlyJsonContract() {
  let generateCount = 0;
  _setAndroidLocalGemmaDaemonOpForTesting(async (_userId, op) => {
    assert.equal(op.type, "android_local_model_generate");
    generateCount += 1;
    return { ok: true, data: { text: '{"answer":"partial"}', finishReason: "length" } };
  });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "system", content: "Return only valid JSON." },
        { role: "user", content: "Summarize the latest result." },
      ],
      toolChoice: "none",
      maxCompletionTokens: 256,
      stream: false,
      userId: "user-phone-length-prompt-json",
    }));

    assert.equal(generateCount, 1);
    assert.equal(result.textContent, '{"answer":"partial"}');
    assert.equal(result.finishReason, "length");
    console.log("OK: Android Local Gemma does not splice prompt-only JSON contract continuations");
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

async function testAndroidLocalGemmaAnswersLastMessageWithoutDaemonGeneration() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: false, error: "LOCAL_MODEL_BUSY: Phone Gemma is already generating." };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "assistant", content: "Hello! How can I assist you today?" },
        { role: "user", content: "Yo there" },
        { role: "assistant", content: "Why did the scarecrow win an award?\n\nBecause he was outstanding in his field!" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history",
    }));

    assert.equal(result.textContent, "Your last message was: Yo there");
    assert.deepEqual(requests, []);
    console.log("OK: Android Local Gemma answers immediate last-message questions without daemon generation");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaRepeatsPreviousReplyWithoutDaemonGeneration() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: true, data: { text: "I have nothing to repeat.", finishReason: "stop" } };
  }, { forwardStatusOps: true });

  try {
    const priorReply = "The square root of 4 is 2.";
    for (const requestText of [
      "Say that again.",
      "Say that one more time.",
      "Can you repeat that?",
      "Repeat what you just said.",
      "Could you repeat your last response?",
      "What did you just say?",
    ]) {
      const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [
          { role: "user", content: "What is the square root of 4?" },
          { role: "assistant", content: priorReply },
          { role: "user", content: requestText },
        ],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone-repeat",
      }));

      assert.equal(result.textContent, priorReply, requestText);
    }

    const missingHistory = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Say that again." }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-repeat-missing",
    }));
    assert.equal(
      missingHistory.textContent,
      "There is no previous assistant message in this conversation context to repeat.",
    );
    assert.deepEqual(requests, []);
    console.log("OK: Android Local Gemma resolves repeat requests from recent conversation context");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotBypassRequiredToolContractsForLastMessage() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: true, data: { text: "No device action was run.", finishReason: "stop" } };
  }, { forwardStatusOps: true });

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [
          { role: "user", content: "Yo there" },
          { role: "assistant", content: "Why did the scarecrow win an award?\n\nBecause he was outstanding in his field!" },
          { role: "user", content: "What was my last message?" },
        ],
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
        userId: "user-phone-history-required-tool",
      })),
      /required a tool call/,
    );
    assert.ok(requests.some((request) => request.op.type === "android_local_model_generate"));
    console.log("OK: Android Local Gemma preserves required tool contracts for last-message wording");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotBypassPromptOnlyJsonContractsForLastMessage() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: true, data: { text: JSON.stringify({ previousUserMessage: "Yo there" }), finishReason: "stop" } };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "system", content: "Return only JSON." },
        { role: "user", content: "Yo there" },
        { role: "assistant", content: "Why did the scarecrow win an award?\n\nBecause he was outstanding in his field!" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history-json",
    }));

    assert.equal(result.textContent, '{"previousUserMessage":"Yo there"}');
    assert.ok(requests.some((request) => request.op.type === "android_local_model_generate"));
    console.log("OK: Android Local Gemma preserves prompt-only JSON contracts for last-message wording");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotBypassSystemInstructionsForLastMessage() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: true, data: { text: "message precedente: Yo there", finishReason: "stop" } };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "system", content: "Answer all questions in French." },
        { role: "user", content: "Yo there" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history-system-instruction",
    }));

    assert.equal(result.textContent, "message precedente: Yo there");
    assert.ok(requests.some((request) => request.op.type === "android_local_model_generate"));
    console.log("OK: Android Local Gemma preserves system instructions for last-message wording");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAllowsStandardCoachSystemPromptForLastMessage() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => {
    throw new Error("standard coach prompt should still use last-message shortcut");
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        {
          role: "system",
          content: "You are Jarvis, the JARVIS chat runtime. You can take actions on the user's behalf using the available tools. Respond naturally and do not mention tool calls or functions to the user.",
        },
        { role: "user", content: "Yo there" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history-standard-system",
    }));

    assert.equal(result.textContent, "Your last message was: Yo there");
    console.log("OK: Android Local Gemma allows standard coach system prompt for last-message shortcut");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotBypassDynamicCoachSystemPromptForLastMessage() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: true, data: { text: "Commander, your last message was Yo there.", finishReason: "stop" } };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        {
          role: "system",
          content: "You are Jarvis, the JARVIS chat runtime. You can take actions on the user's behalf using the available tools. Respond naturally and do not mention tool calls or functions to the user. Prefix every reply with Commander.",
        },
        { role: "user", content: "Yo there" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history-dynamic-system",
    }));

    assert.equal(result.textContent, "Commander, your last message was Yo there.");
    assert.ok(requests.some((request) => request.op.type === "android_local_model_generate"));
    console.log("OK: Android Local Gemma preserves dynamic coach system prompt constraints for last-message wording");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAllowsLeanSystemPromptForLastMessage() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => {
    throw new Error("lean context prompt should still use last-message shortcut");
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        {
          role: "system",
          content: [
            "You are Jarvis, the JARVIS chat runtime.",
            "Answer the user's latest message directly and keep it concise.",
            "Use only the context included in this request. Do not invent memories, files, user data, live research, or tool results.",
            "If the user asks for current information or an action and a relevant tool is available, use it. If the needed tool or API is unavailable, say that plainly.",
          ].join("\n"),
        },
        { role: "user", content: "Yo there" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history-lean-system",
    }));

    assert.equal(result.textContent, "Your last message was: Yo there");
    console.log("OK: Android Local Gemma allows lean system prompt for last-message shortcut");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotBypassConfidentialityInstructionsForLastMessage() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: true, data: { text: "I cannot quote that verbatim.", finishReason: "stop" } };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "system", content: "Never disclose or repeat user content verbatim." },
        { role: "user", content: "private content" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history-confidentiality",
    }));

    assert.equal(result.textContent, "I cannot quote that verbatim.");
    assert.ok(requests.some((request) => request.op.type === "android_local_model_generate"));
    console.log("OK: Android Local Gemma preserves confidentiality instructions for last-message wording");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaBoundsLastMessageShortcutOutput() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => {
    throw new Error("last-message shortcut should not call daemon");
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        {
          role: "user",
          content: `hola 😊 test@example.com https://example.com?a=1&b=2 ${Array.from({ length: 12 }, (_, index) => `opaque-id-${String(index).padStart(2, "0")}-xxxxxxxxx`).join(" ")}`,
        },
        { role: "assistant", content: "ok" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 96,
      stream: false,
      userId: "user-phone-history-bounded",
    }));

    assert.ok(Buffer.byteLength(result.textContent, "utf8") <= 96 * 2);
    assert.match(result.textContent, /^Your last message was: hola 😊 test@example\.com https:\/\/example\.com\?a=1&b=2/);
    assert.match(result.textContent, /\.\.\.$/);
    console.log("OK: Android Local Gemma bounds last-message shortcut output");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaSkipsLastMessageShortcutWhenCompletionBudgetIsTooSmall() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: true, data: { text: "model-sized answer", finishReason: "stop" } };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Yo there" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 1,
      stream: false,
      userId: "user-phone-history-tiny-budget",
    }));

    assert.equal(result.textContent, "model-sized answer");
    assert.ok(requests.some((request) => request.op.type === "android_local_model_generate"));
    console.log("OK: Android Local Gemma skips last-message shortcut when completion budget is too small");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaSkipsNoTextLastMessageShortcutWhenCompletionBudgetIsTooSmall() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: true, data: { text: "model no-text answer", finishReason: "stop" } };
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] },
        { role: "assistant", content: "ok" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 1,
      stream: false,
      userId: "user-phone-history-no-text-tiny-budget",
    }));

    assert.equal(result.textContent, "model no-text answer");
    assert.ok(requests.some((request) => request.op.type === "android_local_model_generate"));
    console.log("OK: Android Local Gemma skips no-text last-message shortcut when completion budget is too small");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDistinguishesMissingHistoryForLastMessageShortcut() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => {
    throw new Error("missing-history shortcut should not call daemon");
  }, { forwardStatusOps: true });

  try {
    const result = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history-missing",
    }));

    assert.equal(result.textContent, "There is no previous user message in this conversation context.");
    console.log("OK: Android Local Gemma distinguishes missing history from textless last-message context");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaHonorsAbortBeforeLastMessageShortcut() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => {
    throw new Error("aborted last-message shortcut should not call daemon");
  }, { forwardStatusOps: true });
  const controller = new AbortController();
  controller.abort();

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [
          { role: "user", content: "Yo there" },
          { role: "assistant", content: "ok" },
          { role: "user", content: "What was my last message?" },
        ],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone-history-aborted",
        signal: controller.signal,
      })),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.equal(error.name, "AbortError");
        return true;
      },
    );
    console.log("OK: Android Local Gemma honors aborts before last-message shortcut replies");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaDoesNotWaitForCancellationBeforeLastMessageShortcut() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  let generationStarted: () => void = () => {};
  let finishGeneration: (result: any) => void = () => {};
  let finishCancellation: (result: any) => void = () => {};
  const generationStartedPromise = new Promise<void>((resolve) => {
    generationStarted = resolve;
  });

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    if (op.type === "android_local_model_cancel") {
      return new Promise((resolve) => {
        finishCancellation = resolve;
      });
    }
    generationStarted();
    return new Promise((resolve) => {
      finishGeneration = resolve;
    });
  });

  const controller = new AbortController();
  try {
    const firstTurn = accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "First question" }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history-cancel-barrier",
      signal: controller.signal,
    }));

    await generationStartedPromise;
    controller.abort();
    await assert.rejects(firstTurn, (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, "AbortError");
      return true;
    });

    const secondTurn = await accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [
        { role: "user", content: "Yo there" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "What was my last message?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-history-cancel-barrier",
    }));

    assert.equal(secondTurn.textContent, "Your last message was: Yo there");
    assert.deepEqual(requests.map((request) => request.op.type), [
      "android_local_model_generate",
      "android_local_model_cancel",
    ]);
    finishCancellation({ ok: true, data: { cancelled: true } });
    finishGeneration({ ok: false, error: "LOCAL_MODEL_CANCELLED: request was cancelled" });
    console.log("OK: Android Local Gemma does not wait for cancellation before last-message shortcut");
  } finally {
    finishCancellation({ ok: true, data: { cancelled: true } });
    finishGeneration({ ok: false, error: "LOCAL_MODEL_CANCELLED: request was cancelled" });
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaSkipsStatusProbeForAlreadyAbortedRun() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: {
        engineValidatedContextTokens: 512,
        engineValidatedProfileId: "gpu-standard-512",
      },
    };
  }, { forwardStatusOps: true });
  const controller = new AbortController();
  controller.abort();

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Hello" }],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone-aborted-before-status",
        signal: controller.signal,
      })),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.equal(error.name, "AbortError");
        return true;
      },
    );
    assert.equal(requests.length, 0);
    console.log("OK: Android Local Gemma skips profile status when the run is already aborted");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaAbortsDuringStatusProbe() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  let statusStarted: () => void = () => {};
  let finishStatus: (result: any) => void = () => {};
  const statusStartedPromise = new Promise<void>((resolve) => {
    statusStarted = resolve;
  });
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    if (op.type !== "android_local_model_status") {
      throw new Error(`Unexpected daemon op after status abort: ${op.type}`);
    }
    statusStarted();
    return new Promise((resolve) => {
      finishStatus = resolve;
    });
  }, { forwardStatusOps: true });
  const controller = new AbortController();

  try {
    const turn = accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Hello" }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-aborted-during-status",
      signal: controller.signal,
    }));

    await statusStartedPromise;
    controller.abort();
    const outcome = await Promise.race([
      turn.then(() => null, (error) => error),
      new Promise<Error>((resolve) => {
        setTimeout(() => resolve(new Error("abort did not settle")), 100);
      }),
    ]);
    finishStatus({
      ok: true,
      data: { engineValidatedContextTokens: 512, engineValidatedProfileId: "gpu-standard-512" },
    });

    assert(outcome instanceof Error);
    assert.equal(outcome.name, "AbortError");
    assert.deepEqual(requests.map((request) => request.op.type), ["android_local_model_status"]);
    console.log("OK: Android Local Gemma aborts promptly while profile status is pending");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaCancelsGenerationWhenRunAborts() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  let generationStarted: () => void = () => {};
  let finishGeneration: (result: any) => void = () => {};
  const generationStartedPromise = new Promise<void>((resolve) => {
    generationStarted = resolve;
  });

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    if (op.type === "android_local_model_cancel") return { ok: true, data: { cancelled: true } };
    generationStarted();
    return new Promise((resolve) => {
      finishGeneration = resolve;
    });
  });

  const controller = new AbortController();

  try {
    const turn = accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Open YouTube" }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
      signal: controller.signal,
    }));

    await generationStartedPromise;
    controller.abort();
    await assert.rejects(
      () => Promise.race([
        turn,
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("abort did not settle")), 100);
        }),
      ]),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.equal(error.name, "AbortError");
        return true;
      },
    );

    assert.equal(requests.length, 2);
    assert.equal(requests[0].op.type, "android_local_model_generate");
    assert.equal(requests[1].op.type, "android_local_model_cancel");
    assert.equal(requests[1].op.requestId, requests[0].op.requestId);
    finishGeneration({ ok: true, data: { text: "late answer", finishReason: "stop" } });
    console.log("OK: Android Local Gemma provider cancels phone generation when the chat run aborts");
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }
}

async function testAndroidLocalGemmaWaitsForAbortCleanupBeforeNextGeneration() {
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  let generationStarted: () => void = () => {};
  let finishFirstGeneration: (result: any) => void = () => {};
  let finishCancellation: (result: any) => void = () => {};
  const generationStartedPromise = new Promise<void>((resolve) => {
    generationStarted = resolve;
  });
  let generationCount = 0;

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    if (op.type === "android_local_model_cancel") {
      return new Promise((resolve) => {
        finishCancellation = resolve;
      });
    }
    generationCount += 1;
    if (generationCount === 1) {
      generationStarted();
      return new Promise((resolve) => {
        finishFirstGeneration = resolve;
      });
    }
    return { ok: true, data: { text: "second answer", finishReason: "stop" } };
  });

  const firstController = new AbortController();
  try {
    const firstTurn = accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "First question" }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-cancellation-barrier",
      signal: firstController.signal,
    }));

    await generationStartedPromise;
    firstController.abort();
    await assert.rejects(firstTurn, (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, "AbortError");
      return true;
    });

    const secondTurn = accumulateTurn(new AndroidLocalGemmaProvider().query({
      model: "android-local-gemma/gemma-4-e4b-it",
      messages: [{ role: "user", content: "Second question" }],
      toolChoice: "none",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone-cancellation-barrier",
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(requests.map((request) => request.op.type), [
      "android_local_model_generate",
      "android_local_model_cancel",
    ]);

    finishCancellation({ ok: true, data: { cancelled: true } });
    finishFirstGeneration({ ok: false, error: "LOCAL_MODEL_CANCELLED: request was cancelled" });
    const secondAnswer = await secondTurn;
    assert.equal(secondAnswer.textContent, "second answer");
    assert.deepEqual(requests.map((request) => request.op.type), [
      "android_local_model_generate",
      "android_local_model_cancel",
      "android_local_model_generate",
    ]);
    console.log("OK: Android Local Gemma waits for abort cleanup before the next generation");
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

async function testAndroidLocalGemmaExplainsValidationRequired() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: false,
    error: "LOCAL_MODEL_VALIDATION_REQUIRED: Validate Phone Gemma in Android settings before using it for chat.",
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
      /tap Validate engine/,
    );
    console.log("OK: Android Local Gemma reports unvalidated Phone Gemma as an actionable routing error");
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
    error: "LOCAL_MODEL_DEVICE_MEMORY_LOW: reason=jarvis_safety_reserve backend=gpu available=1670MB initialAvailable=1670MB threshold=564MB minimum=1800MB shortfall=130MB lowMemory=false recoveryWaitMs=2000",
  }));

  try {
    await assert.rejects(
      () => accumulateTurn(new AndroidLocalGemmaProvider().query({
        model: "android-local-gemma/gemma-4-e4b-it",
        messages: [{ role: "user", content: "Tell me a joke" }],
        toolChoice: "none",
        maxCompletionTokens: 128,
        stream: false,
        userId: "user-phone",
      })),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /released Jarvis voice resources and waited/);
        assert.match(error.message, /Android did not report a low-memory state/);
        assert.doesNotMatch(error.message, /Android reported low available memory/);
        return true;
      },
    );
  } finally {
    _setAndroidLocalGemmaDaemonOpForTesting(null);
  }

  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];
  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return { ok: false, error: "LOCAL_MODEL_BUSY: Phone Gemma is already generating." };
  });

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
    assert.deepEqual(requests.map((request) => request.op.type), ["android_local_model_generate"]);
    console.log("OK: Android Local Gemma distinguishes Android low memory from its E4B safety reserve and does not cancel live busy generations");
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

async function testAndroidLocalGemmaExplainsDisabledCpuFallbackPolicy() {
  _setAndroidLocalGemmaDaemonOpForTesting(async () => ({
    ok: false,
    error: "LOCAL_MODEL_GENERATION_FAILED: Failed to create LiteRT-LM engine after trying gpu backend(s): gpu: INTERNAL: ERROR: [third_party/odml/litert_lm/runtime/executor/llm_litert_compiled_model_executor.cc:1951]; cpu fallback skipped: disabled by default to avoid Android low-memory kills",
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
        assert.match(error.message, /CPU fallback is disabled by default/);
        assert.doesNotMatch(error.message, /enough memory headroom/);
        assert.doesNotMatch(error.message, /tried the device accelerator and CPU fallback/);
        return true;
      },
    );
    console.log("OK: Android Local Gemma explains disabled CPU fallback policy");
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
      /Phone Gemma could not finish inference/,
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
  await testAndroidLocalGemmaFitsValidated512TokenProfileBeforeGeneration();
  await testAndroidLocalGemmaFitsToolProtocolInsideValidated512TokenProfile();
  await testAndroidLocalGemmaFallsBackWhenValidatedProfileStatusIsUnavailable();
  await testAndroidLocalGemmaStateCardOmitsDisabledTools();
  await testAndroidLocalGemmaAuditsFalseNotificationDenials();
  await testAndroidLocalGemmaDoesNotAuditUnavailableNotificationDenials();
  await testAndroidLocalGemmaAuditHonorsToolChoiceNone();
  await testAndroidLocalGemmaAuditsOpenAppWhenBrowseIsUnavailable();
  await testAndroidLocalGemmaChecksYoutubeSearchAgainstBrowseCapability();
  await testAndroidLocalGemmaChecksPhoneUrlAgainstBrowseCapability();
  await testAndroidLocalGemmaScopesPhoneUrlCapabilityToExposedTools();
  await testAndroidLocalGemmaTreatsMemorySaveAsMemoryCapability();
  await testAndroidLocalGemmaConfirmsLegacyDaemonBrowseCompletion();
  await testAndroidLocalGemmaAuditsPronounConfirmationCompletions();
  await testAndroidLocalGemmaUsesToolResultEvidenceForIdentityAudit();
  await testAndroidLocalGemmaUsesGroundedEvidencePacketForPersonalMemoryQuestions();
  await testAndroidLocalGemmaCompletesExactStoredMemoryWithoutGeneration();
  await testAndroidLocalGemmaSkipsCapabilityProbeWithoutAndroidTools();
  await testAndroidLocalGemmaAllowsConfirmedCompletionClaims();
  await testAndroidLocalGemmaAllowsRecentConfirmedCompletionFollowups();
  await testAndroidLocalGemmaBlocksStaleConfirmedCompletionFollowups();
  await testAndroidLocalGemmaEmitsLocalHarnessToolCalls();
  await testAndroidLocalGemmaNormalizesDaemonAppAliases();
  await testAndroidLocalGemmaNormalizesDirectDaemonActionToolNames();
  await testAndroidLocalGemmaNormalizesViewScreenshotToolAlias();
  await testAndroidLocalGemmaRecoversScreenshotFromUnavailableToolName();
  await testAndroidLocalGemmaNormalizesDirectAppAliasToolNames();
  await testAndroidLocalGemmaNormalizesDirectNotificationToolNames();
  await testAndroidLocalGemmaNormalizesEveryDirectDaemonActionName();
  await testAndroidLocalGemmaKeepsPlainAutoChatOffToolProtocol();
  await testAndroidLocalGemmaLabelsRecentConversationForContextualFollowups();
  await testAndroidLocalGemmaOmitsPriorLocalRuntimeErrors();
  await testAndroidLocalGemmaIgnoresOldToolTraceForPlainAutoChat();
  await testAndroidLocalGemmaUsesToolProtocolForUrlTools();
  await testAndroidLocalGemmaKeepsToolProtocolForConfirmationTurns();
  await testAndroidLocalGemmaKeepsToolProtocolForUrlToolConfirmationTurns();
  await testAndroidLocalGemmaRejectsPhoneUrlToolForUrlToolConfirmationTurns();
  await testAndroidLocalGemmaDoesNotThrowPhoneUrlToolForInformationalDeepLinks();
  await testAndroidLocalGemmaPreservesRequiredFinalAnswerWhenPhoneUrlToolIsHidden();
  await testAndroidLocalGemmaPreservesInformationalFollowupAfterPhoneUrlPrompt();
  await testAndroidLocalGemmaCompactsLocalToolPrompt();
  await testAndroidLocalGemmaHonorsReducedToolPromptBudget();
  await testAndroidLocalGemmaPreservesSystemGuardrailsWhenTrimming();
  await testAndroidLocalGemmaOmitsCodeProposalSystemPromptForPhoneActions();
  await testAndroidLocalGemmaPreservesToolContinuationWhenTrimming();
  await testAndroidLocalGemmaFallsBackToCompletedMemorySearchResult();
  await testAndroidLocalGemmaPreservesEmptyAssistantToolCallContinuation();
  await testAndroidLocalGemmaPreservesNewestTurnWhenTrimming();
  await testAndroidLocalGemmaRecoversRequiredScreenshotFinalAnswer();
  await testAndroidLocalGemmaRecoversRequiredScreenshotToPhoneRuntime();
  await testAndroidLocalGemmaRewritesDaemonScreenshotToPhoneRuntime();
  await testAndroidLocalGemmaRecoversRequiredOpenAppFinalAnswer();
  await testAndroidLocalGemmaRecoversCatalogOpenAppToPhoneRuntime();
  await testAndroidLocalGemmaRecoversCatalogSystemAppToPhoneRuntime();
  await testAndroidLocalGemmaRecoversYoutubeSearchToPhoneRuntime();
  await testAndroidLocalGemmaRedirectsServerYoutubeSearchToPhoneRuntime();
  await testAndroidLocalGemmaRecoversSearchForQueryOnYoutube();
  await testAndroidLocalGemmaPreservesYoutubeResearchWorkflow();
  await testAndroidLocalGemmaDoesNotRecoverYoutubeResearchFinalToPhoneSearch();
  await testAndroidLocalGemmaRecoversRequiredOpenAppRefusalFinalAnswer();
  await testAndroidLocalGemmaRecoversRequiredScreenshotRefusalFinalAnswer();
  await testAndroidLocalGemmaInfersPackageForDirectOpenAppToolCalls();
  await testAndroidLocalGemmaInfersPackageForInabilityOpenAppRequests();
  await testAndroidLocalGemmaDropsNegatedOpenAppToolCallsWithoutPackageInference();
  await testAndroidLocalGemmaDropsAliasPackageForNegatedOpenAppToolCalls();
  await testAndroidLocalGemmaKeepsAllowedPackagesForMixedNegatedOpenAppToolCalls();
  await testAndroidLocalGemmaKeepsAllowedPackagesAfterCommaNegation();
  await testAndroidLocalGemmaInfersAllowedPackageForMixedNegatedBareOpenAppToolCall();
  await testAndroidLocalGemmaKeepsAliasesAfterNegatedPackageIdOpenAppToolCall();
  await testAndroidLocalGemmaRecoversNegatedPackageIdFinalAnswerToAllowedAlias();
  await testAndroidLocalGemmaKeepsAllowedPackagesAfterAndNegation();
  await testAndroidLocalGemmaDropsAmbiguousBareOpenAppToolCalls();
  await testAndroidLocalGemmaDoesNotRecoverNegatedRequiredActions();
  await testAndroidLocalGemmaDoesNotScreenshotWhenUserSaysTheyDidNotAsk();
  await testAndroidLocalGemmaAllowsCorrectiveCommandsAfterProtest();
  await testAndroidLocalGemmaAllowsCorrectiveNotificationRequestsAfterProtest();
  await testAndroidLocalGemmaBlocksNegatedCorrectiveCommandsAfterProtest();
  await testAndroidLocalGemmaRecoversCompoundOpenYoutubeSearchToPhoneRuntime();
  await testAndroidLocalGemmaRecoversNotificationRequestsFromFinalDenials();
  await testAndroidLocalGemmaDoesNotReadNotificationsForMetaQuestions();
  await testAndroidLocalGemmaDoesNotReadNotificationsForNegatedRequests();
  await testAndroidLocalGemmaDoesNotRecoverMultiAppOpenRequests();
  await testAndroidLocalGemmaDoesNotRecoverOpenSourceQuestions();
  await testAndroidLocalGemmaPreservesRequiredInformationalPhoneFinalAnswers();
  await testAndroidLocalGemmaRecoversRequiredNotificationActions();
  await testAndroidLocalGemmaDoesNotAutoRecoverInformationalScreenshotQuestions();
  await testAndroidLocalGemmaDoesNotReadScreenForGenericPhoneQuestions();
  await testAndroidLocalGemmaRecoversScreenReadQuestionsInAutoMode();
  await testAndroidLocalGemmaRoutesCompoundScreenshotRequestsToNavigationFirst();
  await testAndroidLocalGemmaDoesNotRecoverHomeScreenAsScreenshot();
  await testAndroidLocalGemmaReadsScreenAfterRecoveredNavigation();
  await testAndroidLocalGemmaScreenshotsAfterRecoveredReadScreen();
  await testAndroidLocalGemmaPreservesProtectedAppScreenshotRefusalAfterReadScreen();
  await testAndroidLocalGemmaScopesCompletedNavigationToCurrentRequest();
  await testAndroidLocalGemmaPreservesYoutubeTranscriptRouting();
  await testAndroidLocalGemmaPreservesCoachYoutubeTranscriptRouting();
  await testAndroidLocalGemmaDoesNotRecoverYoutubeTranscriptUrlToPhoneOpen();
  await testAndroidLocalGemmaStillRecoversNonYoutubeUrlToPhoneOpen();
  await testAndroidLocalGemmaRecoversBareDomainToPhoneOpen();
  await testAndroidLocalGemmaPreservesBareDomainQueryToPhoneOpen();
  await testAndroidLocalGemmaKeepsAppSubdomainsAsPhoneUrls();
  await testAndroidLocalGemmaKeepsUnknownTldSubdomainsAsPhoneUrls();
  await testAndroidLocalGemmaDoesNotRecoverPackageIdAsPhoneUrl();
  await testAndroidLocalGemmaDoesNotRecoverUnlistedPackageIdAsPhoneUrl();
  await testAndroidLocalGemmaRecoversDeepLinkUrlToPhoneOpen();
  await testAndroidLocalGemmaKeepsPhoneUrlToolForPronounConfirmations();
  await testAndroidLocalGemmaKeepsPhoneUrlToolForExplicitUrlConfirmations();
  await testAndroidLocalGemmaKeepsPhoneUrlToolForGenericUrlConfirmations();
  await testAndroidLocalGemmaDoesNotUsePhoneUrlToolForUnrelatedConfirmations();
  await testAndroidLocalGemmaUsesToolProtocolForBareDeepLinks();
  await testAndroidLocalGemmaDoesNotOpenInformationalDeepLinkMentions();
  await testAndroidLocalGemmaDoesNotOpenAdvisoryUrlQuestions();
  await testAndroidLocalGemmaPreservesCheckIfUrlIsSafeAnswers();
  await testAndroidLocalGemmaPreservesAdvisoryUrlAnswersWithUrlBackedTools();
  await testAndroidLocalGemmaGracefullyRejectsAdvisoryPhoneUrlToolCalls();
  await testAndroidLocalGemmaRejectsUrlSafetyQuestionToolCalls();
  await testAndroidLocalGemmaDoesNotRecoverAdvisoryUrlAsAppOpen();
  await testAndroidLocalGemmaRejectsAdvisoryLegacyBrowseToolCalls();
  await testAndroidLocalGemmaDoesNotRepeatCompletedRecoveredActions();
  await testAndroidLocalGemmaDoesNotAdvanceAfterFailedDaemonAction();
  await testAndroidLocalGemmaDisplaysJsonShapedFinalRepliesAsText();
  await testAndroidLocalGemmaPreservesEmbeddedJsonInFinalReplies();
  await testAndroidLocalGemmaPreservesRequestedWholeJsonFinalReplies();
  await testAndroidLocalGemmaPreservesGiveMeJsonFinalReplies();
  await testAndroidLocalGemmaPreservesNeedJsonFinalReplies();
  await testAndroidLocalGemmaPreservesShowMeJsonFinalReplies();
  await testAndroidLocalGemmaUnwrapsJsonMentionTroubleshootingReplies();
  await testAndroidLocalGemmaUnwrapsWantToKnowJsonTroubleshootingReplies();
  await testAndroidLocalGemmaPreservesJsonResponseFormatFinalReplies();
  await testAndroidLocalGemmaPreservesRequestedJsonInToolProtocolFinalReplies();
  await testAndroidLocalGemmaExtractsEmbeddedProtocolFinalReplies();
  await testAndroidLocalGemmaRejectsFinalAnswerWhenLocalToolRequired();
  await testAndroidLocalGemmaDoesNotThrowInvalidLocalToolForPlainIdentityQuestion();
  await testAndroidLocalGemmaRecoversMemorySearchFromIdentityToolHallucination();
  await testAndroidLocalGemmaRecoversMemorySearchFromRequiredIdentityFinalAnswer();
  await testAndroidLocalGemmaDoesNotRewriteWhoAmIContinuationsAsIdentitySearch();
  await testAndroidLocalGemmaRecoversMemorySaveFromRequiredSaveFinalAnswer();
  await testAndroidLocalGemmaPrioritizesMemorySaveOverPhoneYoutubeRecovery();
  await testAndroidLocalGemmaPrioritizesMemorySearchOverOpenYoutubeRecovery();
  await testAndroidLocalGemmaRecoversRememberMyMemorySaveWithoutCopula();
  await testAndroidLocalGemmaRecoversPoliteRememberMyMemorySave();
  await testAndroidLocalGemmaDoesNotSaveRememberMyQuestions();
  await testAndroidLocalGemmaDoesNotSaveDoYouRememberQuestions();
  await testAndroidLocalGemmaSearchesSavedMemoryQuestions();
  await testAndroidLocalGemmaDoesNotSaveEmptyRememberCommands();
  await testAndroidLocalGemmaPreservesToolFinalLengthFinishReason();
  await testAndroidLocalGemmaContinuesLengthLimitedPlainReplies();
  await testAndroidLocalGemmaContinuationRespectsRemainingCompletionBudget();
  await testAndroidLocalGemmaKeepsPartialReplyWhenContinuationFails();
  await testAndroidLocalGemmaDoesNotContinueUserRequestedJson();
  await testAndroidLocalGemmaDoesNotContinuePromptOnlyJsonContract();
  await testAndroidLocalGemmaCancelsTimedOutGeneration();
  await testAndroidLocalGemmaAnswersLastMessageWithoutDaemonGeneration();
  await testAndroidLocalGemmaRepeatsPreviousReplyWithoutDaemonGeneration();
  await testAndroidLocalGemmaDoesNotBypassRequiredToolContractsForLastMessage();
  await testAndroidLocalGemmaDoesNotBypassPromptOnlyJsonContractsForLastMessage();
  await testAndroidLocalGemmaDoesNotBypassSystemInstructionsForLastMessage();
  await testAndroidLocalGemmaAllowsStandardCoachSystemPromptForLastMessage();
  await testAndroidLocalGemmaDoesNotBypassDynamicCoachSystemPromptForLastMessage();
  await testAndroidLocalGemmaAllowsLeanSystemPromptForLastMessage();
  await testAndroidLocalGemmaDoesNotBypassConfidentialityInstructionsForLastMessage();
  await testAndroidLocalGemmaBoundsLastMessageShortcutOutput();
  await testAndroidLocalGemmaSkipsLastMessageShortcutWhenCompletionBudgetIsTooSmall();
  await testAndroidLocalGemmaSkipsNoTextLastMessageShortcutWhenCompletionBudgetIsTooSmall();
  await testAndroidLocalGemmaDistinguishesMissingHistoryForLastMessageShortcut();
  await testAndroidLocalGemmaHonorsAbortBeforeLastMessageShortcut();
  await testAndroidLocalGemmaDoesNotWaitForCancellationBeforeLastMessageShortcut();
  await testAndroidLocalGemmaSkipsStatusProbeForAlreadyAbortedRun();
  await testAndroidLocalGemmaAbortsDuringStatusProbe();
  await testAndroidLocalGemmaCancelsGenerationWhenRunAborts();
  await testAndroidLocalGemmaWaitsForAbortCleanupBeforeNextGeneration();
  await testAndroidLocalGemmaExplainsUnbundledEngine();
  await testAndroidLocalGemmaExplainsValidationRequired();
  await testAndroidLocalGemmaExplainsPhoneResourceFailures();
  await testAndroidLocalGemmaExplainsEngineCreationFailure();
  await testAndroidLocalGemmaDoesNotClaimSkippedCpuFallback();
  await testAndroidLocalGemmaExplainsDisabledCpuFallbackPolicy();
  await testAndroidLocalGemmaExplainsCompiledModelInvokeFailure();
  console.log("\nAll provider runtime adapter assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
