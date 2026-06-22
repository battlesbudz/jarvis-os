import assert from "node:assert/strict";
import {
  routeModelTurn,
  streamModelTurn,
  classifyTaskComplexity,
  classifyTaskPrivacy,
  routeModelForTask,
  _setOpenAIProviderStatusResolverForTesting,
  _setUserSelectedModelResolverForTesting,
} from "../modelRouter";
import { BaseProvider, _clearProviderCacheForTesting, _overrideProviderForTesting } from "../providers";
import type { ProviderChunk, ProviderQueryParams } from "../providers/base";

function userMessage(content: string) {
  return [{ role: "user" as const, content }];
}

const CODEX_MODEL = "chatgpt-codex-oauth/auto";

{
  assert.equal(classifyTaskComplexity("Title this note"), "trivial");
  assert.equal(classifyTaskComplexity("Rewrite this paragraph to be shorter and clearer."), "easy");
  assert.equal(classifyTaskComplexity("Analyze this plan and prioritize the next steps."), "medium");
  assert.equal(classifyTaskComplexity("Debug the root cause and design the architecture fix."), "hard");
  console.log("OK: complexity classifier separates trivial/easy/medium/hard tasks");
}

{
  assert.equal(classifyTaskPrivacy("Summarize this public blog post"), "public");
  assert.equal(classifyTaskPrivacy("Summarize this client email"), "internal");
  assert.equal(classifyTaskPrivacy("Summarize this API key rotation note"), "sensitive");
  console.log("OK: privacy classifier catches internal and sensitive task signals");
}

{
  const decision = routeModelForTask({
    requestedModel: "google/gemini-2.5-pro",
    explicitModel: false,
    messages: userMessage("Rewrite this to be shorter."),
    toolCount: 0,
    routing: { enabled: true, cheapModel: "groq/llama-3.1-8b-instant" },
  });
  assert.equal(decision.model, "google/gemini-2.5-pro");
  assert.equal(decision.delegated, false);
  console.log("OK: easy no-tool tasks preserve the selected global provider");
}

{
  const decision = routeModelForTask({
    requestedModel: "google/gemini-2.5-pro",
    explicitModel: false,
    messages: userMessage("Rewrite this private email."),
    toolCount: 0,
    routing: { enabled: true, privacyLevel: "sensitive" },
  });
  assert.equal(decision.model, "google/gemini-2.5-pro");
  assert.equal(decision.tier, "prime");
  assert.equal(decision.delegated, false);
  console.log("OK: sensitive tasks preserve the selected global provider");
}

{
  const decision = routeModelForTask({
    requestedModel: "google/gemini-2.5-pro",
    explicitModel: false,
    messages: userMessage("Classify this inbox item."),
    toolCount: 1,
    routing: { enabled: true },
  });
  assert.equal(decision.model, "google/gemini-2.5-pro");
  assert.equal(decision.delegated, false);
  console.log("OK: tool-capable tasks preserve the selected global provider");
}

{
  const decision = routeModelForTask({
    requestedModel: "openai/gpt-4.1-mini",
    explicitModel: true,
    messages: userMessage("Rewrite this."),
    toolCount: 0,
    routing: { enabled: true },
  });
  assert.equal(decision.model, "openai/gpt-4.1-mini");
  assert.equal(decision.delegated, false);
  assert.match(decision.reason, /selected model preserved/);
  console.log("OK: explicit selected provider models are not replaced by Codex OAuth");
}

async function runLeanContextToolBudgetAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_LEAN_CONTEXT_CHAR_LIMIT",
    "JARVIS_LEAN_CONTEXT_HISTORY_MESSAGES",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class CapturingProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "short answer" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_LEAN_CONTEXT_CHAR_LIMIT = "1000";
    process.env.JARVIS_LEAN_CONTEXT_HISTORY_MESSAGES = "2";
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("chatgpt-codex-oauth", new CapturingProvider());

    const hugeToolDescription = "large tool schema ".repeat(500);
    await routeModelTurn({
      tier: "balanced",
      messages: [
        { role: "system", content: "full coach prompt" },
        { role: "user", content: "Please create a tiny 3-bullet test plan for checking that Jarvis is working." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "expensive_tool_catalog",
            description: hugeToolDescription,
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: hugeToolDescription },
              },
            },
          },
        },
      ],
      toolChoice: "auto",
      maxCompletionTokens: 64,
      logPrefix: "[ModelRouterLeanTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(capturedRequest?.tools, undefined);
    assert.equal(capturedRequest?.toolChoice, "none");
    assert.equal(capturedRequest?.messages.at(-1)?.role, "user");
    assert.equal(capturedRequest?.messages.at(-1)?.content, "Please create a tiny 3-bullet test plan for checking that Jarvis is working.");
    console.log("OK: oversized tool schemas trigger lean context for simple writing/planning chat turns");
  } finally {
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runUserOpenAIProfileRouteAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_OPENAI_SMART_MODEL",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class CapturingOpenAIProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "openai profile route" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_OPENAI_SMART_MODEL = "gpt-user-profile";
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("openai", new CapturingOpenAIProvider());
    _setOpenAIProviderStatusResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-openai");
      const openai = {
        connected: true,
        defaultAuthType: "oauth" as const,
        authTypes: {
          api_key: { connected: false, isDefault: false },
          oauth: { connected: true, isDefault: true, email: "profile@example.com" },
        },
      };
      return {
        providers: { openai },
        openai: {
          ...openai,
          fallbackEnabled: false,
        },
      };
    });

    const result = await routeModelTurn({
      tier: "smart",
      messages: [{ role: "user", content: "Use my connected model profile." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-openai",
      logPrefix: "[ModelRouterOpenAIProfileTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "openai");
    assert.equal(result.model, "gpt-user-profile");
    assert.equal(capturedRequest?.model, "gpt-user-profile");
    assert.equal(capturedRequest?.userId, "user-openai");
    console.log("OK: a saved user OpenAI provider profile overrides the default Codex OAuth route");
  } finally {
    _setOpenAIProviderStatusResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runUserSelectedProviderOverridesRuntimeDefaultsAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class CapturingGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "selected gemini route" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new CapturingGoogleProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-selected-gemini");
      return "google/gemini-2.5-pro";
    });

    const result = await routeModelTurn({
      tier: "balanced",
      requestedModel: "gpt-4o-mini",
      messages: [{ role: "user", content: "A cron/sleep/dream helper with a legacy GPT model should still use my selected provider." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-selected-gemini",
      logPrefix: "[ModelRouterSelectedProviderTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "google");
    assert.equal(result.model, "gemini-2.5-pro");
    assert.equal(result.textContent, "selected gemini route");
    assert.equal(capturedRequest?.model, "gemini-2.5-pro");
    assert.equal(capturedRequest?.userId, "user-selected-gemini");
    console.log("OK: a user's selected provider overrides runtime defaults and legacy GPT model names");
  } finally {
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runUserSelectedAndroidLocalGemmaOverridesCodexRuntimeAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class CapturingAndroidLocalGemmaProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "local gemma route" };
      yield { type: "finish", reason: "stop" };
    }
  }

  class UnexpectedCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("selected Android Local Gemma must not route through Codex OAuth");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("android-local-gemma", new CapturingAndroidLocalGemmaProvider());
    _overrideProviderForTesting("chatgpt-codex-oauth", new UnexpectedCodexProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-selected-android-local-gemma");
      return "android-local-gemma/gemma-4-e4b-it";
    });

    const result = await routeModelTurn({
      tier: "balanced",
      requestedModel: "gpt-4o-mini",
      messages: [{ role: "user", content: "Use the local phone model for this turn." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-selected-android-local-gemma",
      logPrefix: "[ModelRouterSelectedAndroidLocalGemmaTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "android-local-gemma");
    assert.equal(result.model, "gemma-4-e4b-it");
    assert.equal(result.textContent, "local gemma route");
    assert.equal(capturedRequest?.model, "gemma-4-e4b-it");
    assert.equal(capturedRequest?.userId, "user-selected-android-local-gemma");
    console.log("OK: selected Android Local Gemma overrides Codex OAuth runtime defaults");
  } finally {
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runSelectedAndroidLocalGemmaKeepsToolRequiredTurnsLocalAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let androidCaptured: ProviderQueryParams | null = null;
  class CapturingAndroidLocalGemmaProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      androidCaptured = params;
      yield { type: "tool_call_start", index: 0, id: "local_tool_0", name: "daemon_action" };
      yield { type: "tool_call_args", index: 0, args: '{"action":"screenshot"}' };
      yield { type: "finish", reason: "tool_calls" };
    }
  }

  class UnexpectedCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("selected Android Local Gemma tool turns must not route through Codex OAuth");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("android-local-gemma", new CapturingAndroidLocalGemmaProvider());
    _overrideProviderForTesting("chatgpt-codex-oauth", new UnexpectedCodexProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-selected-android-local-gemma-tools");
      return "android-local-gemma/gemma-4-e4b-it";
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Can you screenshot my phone?" }],
      tools: [{
        type: "function",
        function: {
          name: "daemon_action",
          description: "Control the Android device.",
          parameters: { type: "object", properties: { action: { type: "string" } }, required: ["action"] },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 64,
      userId: "user-selected-android-local-gemma-tools",
      logPrefix: "[ModelRouterAndroidLocalGemmaToolLocalTest]",
    });

    const capturedRequest = androidCaptured as ProviderQueryParams | null;
    assert.equal(result.providerName, "android-local-gemma");
    assert.equal(result.model, "gemma-4-e4b-it");
    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCallList[0]?.function.name, "daemon_action");
    assert.equal(result.toolCallList[0]?.function.arguments, '{"action":"screenshot"}');
    assert.equal(capturedRequest?.toolChoice, "required");
    const capturedTool = capturedRequest?.tools?.[0];
    assert.equal(capturedTool?.type, "function");
    assert.equal(capturedTool?.type === "function" ? capturedTool.function.name : undefined, "daemon_action");
    console.log("OK: selected Android Local Gemma keeps tool-required turns local");
  } finally {
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runUserDefaultProviderProfileOverridesRuntimeDefaultsAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class CapturingGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "default gemini profile route" };
      yield { type: "finish", reason: "stop" };
    }
  }

  class CapturingCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "codex fallback route" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new CapturingGoogleProvider());
    _overrideProviderForTesting("chatgpt-codex-oauth", new CapturingCodexProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-default-gemini");
      return null;
    });
    _setOpenAIProviderStatusResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-default-gemini");
      const openai = {
        connected: false,
        defaultAuthType: null,
        authTypes: {
          api_key: { connected: false, isDefault: false },
          oauth: { connected: false, isDefault: false },
        },
      };
      const google = {
        connected: true,
        defaultAuthType: "api_key" as const,
        authTypes: {
          api_key: { connected: true, isDefault: true },
          oauth: { connected: false, isDefault: false },
        },
      };
      return {
        providers: { openai, google },
        openai: {
          ...openai,
          fallbackEnabled: false,
        },
      };
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Use the provider I connected in settings." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-default-gemini",
      logPrefix: "[ModelRouterDefaultProviderProfileTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "google");
    assert.equal(result.model, "gemini-2.5-flash");
    assert.equal(result.textContent, "default gemini profile route");
    assert.equal(capturedRequest?.model, "gemini-2.5-flash");
    assert.equal(capturedRequest?.userId, "user-default-gemini");
    console.log("OK: a connected default Gemini profile overrides strict Codex environment defaults");
  } finally {
    _setOpenAIProviderStatusResolverForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runDefaultProviderProfileOverridesStaleCodexSelectionAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class CapturingGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "stale codex bypassed" };
      yield { type: "finish", reason: "stop" };
    }
  }

  class UnexpectedCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("stale Codex default must not override the connected Gemini profile");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new CapturingGoogleProvider());
    _overrideProviderForTesting("chatgpt-codex-oauth", new UnexpectedCodexProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-stale-codex-default");
      return CODEX_MODEL;
    });
    _setOpenAIProviderStatusResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-stale-codex-default");
      const openai = {
        connected: false,
        defaultAuthType: null,
        authTypes: {
          api_key: { connected: false, isDefault: false },
          oauth: { connected: false, isDefault: false },
        },
      };
      const google = {
        connected: true,
        defaultAuthType: "api_key" as const,
        authTypes: {
          api_key: { connected: true, isDefault: true },
          oauth: { connected: false, isDefault: false },
        },
      };
      return {
        providers: { openai, google },
        openai: {
          ...openai,
          fallbackEnabled: false,
        },
      };
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Use my connected Gemini profile, not stale Codex." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-stale-codex-default",
      logPrefix: "[ModelRouterStaleCodexDefaultProfileTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "google");
    assert.equal(result.model, "gemini-2.5-flash");
    assert.equal(result.textContent, "stale codex bypassed");
    assert.equal(capturedRequest?.model, "gemini-2.5-flash");
    assert.equal(capturedRequest?.userId, "user-stale-codex-default");
    console.log("OK: a connected default Gemini profile overrides a stale Codex selected-model placeholder");
  } finally {
    _setOpenAIProviderStatusResolverForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runExplicitCodexSelectionOverridesDefaultProviderProfileAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class UnexpectedGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("explicit Codex selection must not be replaced by Gemini");
    }
  }

  class CapturingCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "explicit codex preserved" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new UnexpectedGoogleProvider());
    _overrideProviderForTesting("chatgpt-codex-oauth", new CapturingCodexProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-explicit-codex");
      return { model: CODEX_MODEL, isExplicit: true };
    });
    _setOpenAIProviderStatusResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-explicit-codex");
      const openai = {
        connected: true,
        defaultAuthType: "oauth" as const,
        authTypes: {
          api_key: { connected: false, isDefault: false },
          oauth: { connected: true, isDefault: true },
        },
      };
      const google = {
        connected: true,
        defaultAuthType: "api_key" as const,
        authTypes: {
          api_key: { connected: true, isDefault: true },
          oauth: { connected: false, isDefault: false },
        },
      };
      return {
        providers: { openai, google },
        openai: {
          ...openai,
          fallbackEnabled: false,
        },
      };
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Use my explicitly selected ChatGPT subscription." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-explicit-codex",
      logPrefix: "[ModelRouterExplicitCodexSelectionTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "chatgpt-codex-oauth");
    assert.equal(result.model, CODEX_MODEL);
    assert.equal(result.textContent, "explicit codex preserved");
    assert.equal(capturedRequest?.model, CODEX_MODEL);
    assert.equal(capturedRequest?.userId, "user-explicit-codex");
    console.log("OK: an explicit ChatGPT/Codex selection overrides other connected provider profiles");
  } finally {
    _setOpenAIProviderStatusResolverForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runLegacyCodexSelectionWithOAuthOverridesDefaultProviderProfileAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class UnexpectedGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("legacy Codex selection with OAuth must not be replaced by Gemini");
    }
  }

  class CapturingCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "legacy codex preserved" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new UnexpectedGoogleProvider());
    _overrideProviderForTesting("chatgpt-codex-oauth", new CapturingCodexProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-legacy-codex-oauth");
      return CODEX_MODEL;
    });
    _setOpenAIProviderStatusResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-legacy-codex-oauth");
      const openai = {
        connected: true,
        defaultAuthType: "oauth" as const,
        authTypes: {
          api_key: { connected: false, isDefault: false },
          oauth: { connected: true, isDefault: true },
        },
      };
      const google = {
        connected: true,
        defaultAuthType: "api_key" as const,
        authTypes: {
          api_key: { connected: true, isDefault: true },
          oauth: { connected: false, isDefault: false },
        },
      };
      return {
        providers: { openai, google },
        openai: {
          ...openai,
          fallbackEnabled: false,
        },
      };
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Use my legacy selected ChatGPT subscription." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-legacy-codex-oauth",
      logPrefix: "[ModelRouterLegacyCodexSelectionTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "chatgpt-codex-oauth");
    assert.equal(result.model, CODEX_MODEL);
    assert.equal(result.textContent, "legacy codex preserved");
    assert.equal(capturedRequest?.model, CODEX_MODEL);
    assert.equal(capturedRequest?.userId, "user-legacy-codex-oauth");
    console.log("OK: a legacy ChatGPT/Codex selection with OAuth still overrides other connected provider profiles");
  } finally {
    _setOpenAIProviderStatusResolverForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runUserDefaultProviderProfileStreamingRouteAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  const streamedTextChunks: string[] = [];
  class StreamingGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      assert.equal(params.stream, true);
      assert.equal(params.model, "gemini-2.5-flash");
      yield { type: "text", delta: "live " };
      yield { type: "text", delta: "gemini stream" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new StreamingGoogleProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-default-gemini-stream");
      return null;
    });
    _setOpenAIProviderStatusResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-default-gemini-stream");
      const openai = {
        connected: false,
        defaultAuthType: null,
        authTypes: {
          api_key: { connected: false, isDefault: false },
          oauth: { connected: false, isDefault: false },
        },
      };
      const google = {
        connected: true,
        defaultAuthType: "api_key" as const,
        authTypes: {
          api_key: { connected: true, isDefault: true },
          oauth: { connected: false, isDefault: false },
        },
      };
      return {
        providers: { openai, google },
        openai: {
          ...openai,
          fallbackEnabled: false,
        },
      };
    });

    const result = await streamModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Stream through the provider I connected in settings." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-default-gemini-stream",
      logPrefix: "[ModelRouterDefaultProviderStreamTest]",
    }, (chunk) => {
      if (chunk.type === "text") streamedTextChunks.push(chunk.delta);
    });

    assert.deepEqual(streamedTextChunks, ["live ", "gemini stream"]);
    assert.equal(result.providerName, "google");
    assert.equal(result.model, "gemini-2.5-flash");
    assert.equal(result.textContent, "live gemini stream");
    console.log("OK: a connected default Gemini profile can stream routed text chunks");
  } finally {
    _setOpenAIProviderStatusResolverForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runUserDefaultProviderProfileDoesNotSilentlyFallbackAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let codexCalled = false;
  class FailingGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      assert.equal(params.model, "gemini-2.5-flash");
      const err = new Error("Gemini transient rate limit") as Error & { status?: number };
      err.status = 429;
      throw err;
    }
  }

  class UnexpectedCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      codexCalled = true;
      yield { type: "text", delta: "unexpected codex fallback" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new FailingGoogleProvider());
    _overrideProviderForTesting("chatgpt-codex-oauth", new UnexpectedCodexProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-default-gemini-no-fallback");
      return null;
    });
    _setOpenAIProviderStatusResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-default-gemini-no-fallback");
      const openai = {
        connected: false,
        defaultAuthType: null,
        authTypes: {
          api_key: { connected: false, isDefault: false },
          oauth: { connected: false, isDefault: false },
        },
      };
      const google = {
        connected: true,
        defaultAuthType: "api_key" as const,
        authTypes: {
          api_key: { connected: true, isDefault: true },
          oauth: { connected: false, isDefault: false },
        },
      };
      return {
        providers: { openai, google },
        openai: {
          ...openai,
          fallbackEnabled: false,
        },
      };
    });

    await assert.rejects(
      () => routeModelTurn({
        tier: "balanced",
        messages: [{ role: "user", content: "Do not silently switch away from my default provider." }],
        toolChoice: "none",
        maxCompletionTokens: 64,
        userId: "user-default-gemini-no-fallback",
        logPrefix: "[ModelRouterDefaultProviderNoFallbackTest]",
      }),
      /Gemini transient rate limit/,
    );

    assert.equal(codexCalled, false);
    console.log("OK: a connected default provider does not silently fall back to Codex on retriable errors");
  } finally {
    _setOpenAIProviderStatusResolverForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runExplicitProviderModelRouteAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class CapturingAnthropicProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "anthropic route" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    _overrideProviderForTesting("anthropic", new CapturingAnthropicProvider());

    const result = await routeModelTurn({
      tier: "balanced",
      requestedModel: "anthropic/claude-sonnet-4-5",
      messages: [{ role: "user", content: "Use Claude." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-claude",
      logPrefix: "[ModelRouterExplicitProviderTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "anthropic");
    assert.equal(result.model, "claude-sonnet-4-5");
    assert.equal(result.textContent, "anthropic route");
    assert.equal(capturedRequest?.model, "claude-sonnet-4-5");
    assert.equal(capturedRequest?.userId, "user-claude");
    console.log("OK: explicit selected provider model routes directly to that provider");
  } finally {
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runPlainGptRequestUsesConfiguredChainAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  const captured: Array<{ provider: string; params: ProviderQueryParams }> = [];
  class CapturingProvider extends BaseProvider {
    constructor(private readonly provider: string) {
      super();
    }
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured.push({ provider: this.provider, params });
      yield { type: "text", delta: `${this.provider} route` };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";
    process.env.PROVIDER_FALLBACK_CHAIN = "anthropic:claude-chain,google:gemini-chain";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    _overrideProviderForTesting("anthropic", new CapturingProvider("anthropic"));
    _overrideProviderForTesting("google", new CapturingProvider("google"));
    _overrideProviderForTesting("openai-compatible", new CapturingProvider("openai-compatible"));

    const result = await routeModelTurn({
      tier: "balanced",
      requestedModel: "gpt-4o-mini",
      messages: [{ role: "user", content: "Plain GPT request." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      logPrefix: "[ModelRouterPlainGptRequestTest]",
    });

    assert.equal(result.providerName, "anthropic");
    assert.equal(result.model, "claude-chain");
    assert.equal(captured[0]?.provider, "anthropic");
    assert.equal(captured[0]?.params.model, "claude-chain");
    console.log("OK: plain GPT requests keep using the configured provider route chain");
  } finally {
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runCoachChatSelectedProviderModelAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "DATABASE_URL",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class CapturingGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "gemini chat route" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    _overrideProviderForTesting("google", new CapturingGoogleProvider());
    const { providerLabelForModel, runCoachModelTurn } = await import("../../services/aiCoachContextService");

    const result = await runCoachModelTurn({
      requestedModel: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Use my selected chat provider." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-gemini",
      logPrefix: "[CoachChatSelectedProviderTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "google");
    assert.equal(result.model, "gemini-2.5-flash");
    assert.equal(result.textContent, "gemini chat route");
    assert.equal(capturedRequest?.model, "gemini-2.5-flash");
    assert.equal(capturedRequest?.userId, "user-gemini");
    assert.equal(providerLabelForModel("google/gemini-2.5-flash"), "google");
    console.log("OK: app/web coach chat can route through the selected Gemini chat model");
  } finally {
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRequestedProviderModelOverridesAmbientCodexRouteAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "JARVIS_MODEL_PROVIDER",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let captured: ProviderQueryParams | null = null;
  class UnexpectedCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("requested Gemini model must not be replaced by ambient Codex route state");
    }
  }

  class CapturingGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "requested gemini preserved" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("chatgpt-codex-oauth", new UnexpectedCodexProvider());
    _overrideProviderForTesting("google", new CapturingGoogleProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-requested-gemini");
      return { model: CODEX_MODEL, isExplicit: true };
    });

    const result = await routeModelTurn({
      tier: "balanced",
      requestedModel: "google/gemini-2.5-flash",
      preferRequestedModel: true,
      messages: [{ role: "user", content: "Use my globally selected Gemini provider." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-requested-gemini",
      logPrefix: "[ModelRouterRequestedProviderWinsTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "google");
    assert.equal(result.model, "gemini-2.5-flash");
    assert.equal(result.textContent, "requested gemini preserved");
    assert.equal(capturedRequest?.model, "gemini-2.5-flash");
    assert.equal(capturedRequest?.userId, "user-requested-gemini");
    console.log("OK: concrete requested provider models override ambient Codex route state");
  } finally {
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

runUserOpenAIProfileRouteAssertion()
  .then(runUserSelectedProviderOverridesRuntimeDefaultsAssertion)
  .then(runUserSelectedAndroidLocalGemmaOverridesCodexRuntimeAssertion)
  .then(runSelectedAndroidLocalGemmaKeepsToolRequiredTurnsLocalAssertion)
  .then(runUserDefaultProviderProfileOverridesRuntimeDefaultsAssertion)
  .then(runDefaultProviderProfileOverridesStaleCodexSelectionAssertion)
  .then(runExplicitCodexSelectionOverridesDefaultProviderProfileAssertion)
  .then(runLegacyCodexSelectionWithOAuthOverridesDefaultProviderProfileAssertion)
  .then(runUserDefaultProviderProfileStreamingRouteAssertion)
  .then(runUserDefaultProviderProfileDoesNotSilentlyFallbackAssertion)
  .then(runExplicitProviderModelRouteAssertion)
  .then(runPlainGptRequestUsesConfiguredChainAssertion)
  .then(runCoachChatSelectedProviderModelAssertion)
  .then(runRequestedProviderModelOverridesAmbientCodexRouteAssertion)
  .then(runLeanContextToolBudgetAssertion)
  .then(() => {
    console.log("\nAll model router assertions passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
