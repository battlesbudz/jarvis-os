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
    assert.equal(requests[0].op.contextTokens, 2048);
    assert.equal(requests[0].op.maxTokens, 128);
    assert.equal(requests[0].op.allowCpuFallback, false);
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

async function testAndroidLocalGemmaPreservesToolContinuationWhenTrimming() {
  const previousBudget = process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET;
  process.env.ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET = "1200";
  const requests: Array<{ userId: string; op: any; timeoutMs: number }> = [];

  _setAndroidLocalGemmaDaemonOpForTesting(async (userId, op, timeoutMs) => {
    requests.push({ userId, op, timeoutMs });
    return {
      ok: true,
      data: { text: JSON.stringify({ type: "final", content: "I read the local tool result." }), finishReason: "stop" },
    };
  });

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
      }],
      toolChoice: "auto",
      maxCompletionTokens: 128,
      stream: false,
      userId: "user-phone",
    }));

    assert.equal(result.textContent, "I read the local tool result.");
    assert.match(requests[0].op.prompt, /CURRENT_TOOL_REQUEST/);
    assert.match(requests[0].op.prompt, /daemon_action/);
    assert.match(requests[0].op.prompt, /TOOL_RESULT_TAIL_MARKER/);
    console.log("OK: Android Local Gemma preserves tool continuation context when trimming");
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

      await assert.rejects(
        () => accumulateTurn(new AndroidLocalGemmaProvider().query({
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
        })),
        /local harness required a tool call[\s\S]*No cloud model was used/,
      );
    }
    console.log("OK: Android Local Gemma does not recover negated required actions");
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
  await testAndroidLocalGemmaNormalizesDaemonAppAliases();
  await testAndroidLocalGemmaNormalizesDirectDaemonActionToolNames();
  await testAndroidLocalGemmaNormalizesViewScreenshotToolAlias();
  await testAndroidLocalGemmaRecoversScreenshotFromUnavailableToolName();
  await testAndroidLocalGemmaNormalizesDirectAppAliasToolNames();
  await testAndroidLocalGemmaNormalizesDirectNotificationToolNames();
  await testAndroidLocalGemmaNormalizesEveryDirectDaemonActionName();
  await testAndroidLocalGemmaKeepsPlainAutoChatOffToolProtocol();
  await testAndroidLocalGemmaOmitsPriorLocalRuntimeErrors();
  await testAndroidLocalGemmaIgnoresOldToolTraceForPlainAutoChat();
  await testAndroidLocalGemmaUsesToolProtocolForUrlTools();
  await testAndroidLocalGemmaKeepsToolProtocolForConfirmationTurns();
  await testAndroidLocalGemmaCompactsLocalToolPrompt();
  await testAndroidLocalGemmaHonorsReducedToolPromptBudget();
  await testAndroidLocalGemmaPreservesSystemGuardrailsWhenTrimming();
  await testAndroidLocalGemmaPreservesToolContinuationWhenTrimming();
  await testAndroidLocalGemmaPreservesNewestTurnWhenTrimming();
  await testAndroidLocalGemmaRecoversRequiredScreenshotFinalAnswer();
  await testAndroidLocalGemmaRecoversRequiredScreenshotToPhoneRuntime();
  await testAndroidLocalGemmaRewritesDaemonScreenshotToPhoneRuntime();
  await testAndroidLocalGemmaRecoversRequiredOpenAppFinalAnswer();
  await testAndroidLocalGemmaRecoversCatalogOpenAppToPhoneRuntime();
  await testAndroidLocalGemmaRecoversCatalogSystemAppToPhoneRuntime();
  await testAndroidLocalGemmaRecoversYoutubeSearchToPhoneRuntime();
  await testAndroidLocalGemmaRedirectsServerYoutubeSearchToPhoneRuntime();
  await testAndroidLocalGemmaPreservesYoutubeResearchWorkflow();
  await testAndroidLocalGemmaRecoversRequiredOpenAppRefusalFinalAnswer();
  await testAndroidLocalGemmaRecoversRequiredScreenshotRefusalFinalAnswer();
  await testAndroidLocalGemmaInfersPackageForDirectOpenAppToolCalls();
  await testAndroidLocalGemmaInfersPackageForInabilityOpenAppRequests();
  await testAndroidLocalGemmaDropsNegatedOpenAppToolCallsWithoutPackageInference();
  await testAndroidLocalGemmaDropsAliasPackageForNegatedOpenAppToolCalls();
  await testAndroidLocalGemmaKeepsAllowedPackagesForMixedNegatedOpenAppToolCalls();
  await testAndroidLocalGemmaKeepsAllowedPackagesAfterCommaNegation();
  await testAndroidLocalGemmaInfersAllowedPackageForMixedNegatedBareOpenAppToolCall();
  await testAndroidLocalGemmaKeepsAllowedPackagesAfterAndNegation();
  await testAndroidLocalGemmaDropsAmbiguousBareOpenAppToolCalls();
  await testAndroidLocalGemmaDoesNotRecoverNegatedRequiredActions();
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
  await testAndroidLocalGemmaRecoversRememberMyMemorySaveWithoutCopula();
  await testAndroidLocalGemmaRecoversPoliteRememberMyMemorySave();
  await testAndroidLocalGemmaDoesNotSaveRememberMyQuestions();
  await testAndroidLocalGemmaDoesNotSaveDoYouRememberQuestions();
  await testAndroidLocalGemmaSearchesSavedMemoryQuestions();
  await testAndroidLocalGemmaDoesNotSaveEmptyRememberCommands();
  await testAndroidLocalGemmaPreservesToolFinalLengthFinishReason();
  await testAndroidLocalGemmaCancelsTimedOutGeneration();
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
