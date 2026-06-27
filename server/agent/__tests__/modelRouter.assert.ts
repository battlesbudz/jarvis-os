import assert from "node:assert/strict";
import {
  routeModelTurn,
  streamModelTurn,
  classifyTaskComplexity,
  classifyTaskPrivacy,
  routeModelForTask,
  _setOpenAIProviderStatusResolverForTesting,
  _setRuntimeIdentityProfileResolverForTesting,
  _setRuntimeMemoryInspectionDepsForTesting,
  _setUserSelectedModelResolverForTesting,
} from "../modelRouter";
import { BaseProvider, _clearProviderCacheForTesting, _overrideProviderForTesting } from "../providers";
import type { ProviderChunk, ProviderQueryParams } from "../providers/base";
import { classifyRuntimeIdentityIntent, runtimeModelLabelForRoute } from "../../state/runtimeIdentity";
import {
  classifyRuntimeCapabilityIntent,
  _setRuntimeCapabilityDepsForTesting,
} from "../../state/runtimeCapability";
import {
  classifyPhoneGemmaDiagnosticIntent,
  clearPhoneGemmaDiagnosticsForTesting,
  recordPhoneGemmaDiagnosticResult,
  _setPhoneGemmaDiagnosticDepsForTesting,
} from "../../state/phoneGemmaDiagnostics";

function userMessage(content: string) {
  return [{ role: "user" as const, content }];
}

function messageContentText(content: ProviderQueryParams["messages"][number]["content"] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("\n");
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

  class UnexpectedCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("connected ChatGPT subscription must not require the Codex daemon/gateway runtime");
    }
  }

  class CapturingOpenAIProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "chatgpt subscription route" };
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
    _overrideProviderForTesting("chatgpt-codex-oauth", new UnexpectedCodexProvider());
    _overrideProviderForTesting("openai", new CapturingOpenAIProvider());
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
    assert.equal(result.providerName, "openai");
    assert.equal(result.model, "gpt-4.1-mini");
    assert.equal(result.textContent, "chatgpt subscription route");
    assert.equal(capturedRequest?.model, "gpt-4.1-mini");
    assert.equal(capturedRequest?.preferredAuthType, "oauth");
    assert.equal(capturedRequest?.userId, "user-explicit-codex");
    console.log("OK: a connected ChatGPT subscription selection uses the OpenAI OAuth chat route");
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

  class UnexpectedCodexProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("legacy ChatGPT subscription must not require the Codex daemon/gateway runtime");
    }
  }

  class CapturingOpenAIProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "legacy subscription route" };
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
    _overrideProviderForTesting("chatgpt-codex-oauth", new UnexpectedCodexProvider());
    _overrideProviderForTesting("openai", new CapturingOpenAIProvider());
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
    assert.equal(result.providerName, "openai");
    assert.equal(result.model, "gpt-4.1-mini");
    assert.equal(result.textContent, "legacy subscription route");
    assert.equal(capturedRequest?.model, "gpt-4.1-mini");
    assert.equal(capturedRequest?.preferredAuthType, "oauth");
    assert.equal(capturedRequest?.userId, "user-legacy-codex-oauth");
    console.log("OK: a legacy ChatGPT/Codex selection with OAuth uses the OpenAI OAuth chat route");
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

async function runRequestedChatGPTSubscriptionUsesOAuthRouteAssertion(): Promise<void> {
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
      throw new Error("requested ChatGPT subscription must not require the Codex daemon/gateway runtime");
    }
  }

  class CapturingOpenAIProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: "requested subscription route" };
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
    _overrideProviderForTesting("openai", new CapturingOpenAIProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-requested-chatgpt-subscription");
      return { model: CODEX_MODEL, isExplicit: true };
    });
    _setOpenAIProviderStatusResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-requested-chatgpt-subscription");
      const openai = {
        connected: true,
        defaultAuthType: "api_key" as const,
        authTypes: {
          api_key: { connected: true, isDefault: true },
          oauth: { connected: true, isDefault: false },
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
      tier: "balanced",
      requestedModel: CODEX_MODEL,
      preferRequestedModel: true,
      messages: [{ role: "user", content: "Use the model I selected in settings." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-requested-chatgpt-subscription",
      logPrefix: "[ModelRouterRequestedChatGPTSubscriptionTest]",
    });

    const capturedRequest = captured as ProviderQueryParams | null;
    assert.equal(result.providerName, "openai");
    assert.equal(result.model, "gpt-4.1-mini");
    assert.equal(result.textContent, "requested subscription route");
    assert.equal(capturedRequest?.model, "gpt-4.1-mini");
    assert.equal(capturedRequest?.preferredAuthType, "oauth");
    assert.equal(capturedRequest?.userId, "user-requested-chatgpt-subscription");
    console.log("OK: app-selected ChatGPT subscription requests use the OpenAI OAuth chat route");
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

async function runProviderWideRuntimeStateCardAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "DATABASE_URL",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  const captured = new Map<string, ProviderQueryParams>();
  class CapturingProvider extends BaseProvider {
    constructor(private readonly provider: string) {
      super();
    }

    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured.set(this.provider, params);
      yield { type: "text", delta: `${this.provider} saw state card` };
      yield { type: "finish", reason: "stop" };
    }
  }

  const routes = [
    {
      provider: "openai" as const,
      requestedModel: "openai/gpt-4.1-mini",
      expectedModel: "gpt-4.1-mini",
      userId: "user-provider-openai",
    },
    {
      provider: "anthropic" as const,
      requestedModel: "anthropic/claude-sonnet-4-5",
      expectedModel: "claude-sonnet-4-5",
      userId: "user-provider-anthropic",
    },
    {
      provider: "google" as const,
      requestedModel: "google/gemini-2.5-flash",
      expectedModel: "gemini-2.5-flash",
      userId: "user-provider-google",
    },
    {
      provider: "chatgpt-codex-oauth" as const,
      requestedModel: CODEX_MODEL,
      expectedModel: CODEX_MODEL,
      userId: "user-provider-codex",
    },
  ];

  try {
    delete process.env.DATABASE_URL;
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("openai", new CapturingProvider("openai"));
    _overrideProviderForTesting("anthropic", new CapturingProvider("anthropic"));
    _overrideProviderForTesting("google", new CapturingProvider("google"));
    _overrideProviderForTesting("chatgpt-codex-oauth", new CapturingProvider("chatgpt-codex-oauth"));
    _setOpenAIProviderStatusResolverForTesting(async () => {
      const openai = {
        connected: false,
        defaultAuthType: null,
        authTypes: {
          api_key: { connected: false, isDefault: false },
          oauth: { connected: false, isDefault: false },
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

    for (const route of routes) {
      const result = await routeModelTurn({
        tier: "balanced",
        requestedModel: route.requestedModel,
        preferRequestedModel: true,
        messages: [
          { role: "system", content: "Keep this caller system instruction first." },
          { role: "user", content: "Check the provider context." },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "memory_search",
              description: "Search runtime-approved memories.",
              parameters: { type: "object", properties: { query: { type: "string" } } },
            },
          },
        ],
        toolChoice: "auto",
        maxCompletionTokens: 64,
        userId: route.userId,
        logPrefix: `[ModelRouterProviderStateCardTest:${route.provider}]`,
        allowRuntimeIdentityShortcut: true,
        allowRuntimeCapabilityShortcut: true,
        allowRuntimeMemoryInspectionShortcut: true,
        allowPhoneGemmaDiagnosticShortcut: true,
      });

      const capturedRequest = captured.get(route.provider);
      assert.equal(result.providerName, route.provider);
      assert.equal(result.model, route.expectedModel);
      assert.equal(capturedRequest?.toolChoice, "auto");
      assert.equal(capturedRequest?.tools?.[0]?.function.name, "memory_search");
      assert.equal(capturedRequest?.messages[0]?.role, "system");
      assert.equal(
        messageContentText(capturedRequest?.messages[0]?.content),
        "Keep this caller system instruction first.",
      );

      const stateCardMessage = capturedRequest?.messages.find((message) => (
        message.role === "system" && messageContentText(message.content).includes("## Jarvis Runtime State Card")
      ));
      assert.ok(stateCardMessage, `${route.provider} should receive a runtime state card`);
      const stateCard = messageContentText(stateCardMessage.content);
      assert.match(stateCard, /Assistant: Jarvis/);
      assert.match(stateCard, new RegExp(`User id: ${route.userId}`));
      assert.match(stateCard, new RegExp(`Active model: ${route.provider}:${route.expectedModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(stateCard, /Active device: cloud/);
      assert.match(stateCard, /memory_search/);
    }

    captured.delete("openai");
    const extractionResult = await routeModelTurn({
      tier: "cheap",
      requestedModel: "openai/gpt-4.1-mini",
      preferRequestedModel: true,
      messages: [
        { role: "system", content: "Return only valid JSON." },
        { role: "user", content: "Extract new memories from this source, but do not recall old memories." },
      ],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-memory-extraction",
      logPrefix: "[ModelRouterMemoryExtractStateCardTest]",
      disableRuntimeStateCard: true,
    });
    const extractionRequest = captured.get("openai");
    assert.equal(extractionResult.providerName, "openai");
    assert.equal(
      extractionRequest?.messages.some((message) => (
        message.role === "system" && messageContentText(message.content).includes("## Jarvis Runtime State Card")
      )),
      false,
    );

    console.log("OK: cloud providers receive the runtime state-card contract without losing tool access");
  } finally {
    _setOpenAIProviderStatusResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runProviderRuntimeStateCardFallbackChainAssertion(): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    "DATABASE_URL",
    "JARVIS_CODEX_OAUTH_ENABLED",
    "CHATGPT_CODEX_OAUTH_ENABLED",
    "JARVIS_TEST_ALLOW_DIRECT_PROVIDER",
    "PROVIDER_FALLBACK_CHAIN",
  ]) {
    previousEnv.set(key, process.env[key]);
  }

  let googleCaptured: ProviderQueryParams | null = null;
  class FailingAnthropicProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      const err = new Error("primary rate limit") as Error & { status?: number };
      err.status = 429;
      throw err;
    }
  }

  class CapturingGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      googleCaptured = params;
      yield { type: "text", delta: "fallback response" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    delete process.env.DATABASE_URL;
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";
    process.env.PROVIDER_FALLBACK_CHAIN = "anthropic:claude-chain,google:gemini-chain";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    _overrideProviderForTesting("anthropic", new FailingAnthropicProvider());
    _overrideProviderForTesting("google", new CapturingGoogleProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-provider-fallback-state-card");
      return null;
    });
    _setOpenAIProviderStatusResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-provider-fallback-state-card");
      const openai = {
        connected: false,
        defaultAuthType: null,
        authTypes: {
          api_key: { connected: false, isDefault: false },
          oauth: { connected: false, isDefault: false },
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
      tier: "balanced",
      messages: [{ role: "user", content: "Use the configured fallback chain." }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-provider-fallback-state-card",
      logPrefix: "[ModelRouterProviderStateCardFallbackTest]",
    });

    const capturedRequest = googleCaptured as ProviderQueryParams | null;
    assert.equal(result.providerName, "google");
    assert.equal(result.model, "gemini-chain");
    const stateCardMessage = capturedRequest?.messages.find((message) => (
      message.role === "system" && messageContentText(message.content).includes("## Jarvis Runtime State Card")
    ));
    assert.ok(stateCardMessage, "fallback provider should receive a runtime state card");
    const stateCard = messageContentText(stateCardMessage.content);
    assert.match(stateCard, /Active model: fallback_chain:anthropic:claude-chain -> google:gemini-chain/);
    assert.doesNotMatch(stateCard, /\n- Active model: anthropic:claude-chain\n/);
    assert.match(stateCard, /Current context: provider_fallback_chain:/);
    console.log("OK: provider runtime state cards describe fallback chains without stale primary model state");
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

async function runRuntimeIdentityAnswersBypassSelectedPhoneGemmaAssertion(): Promise<void> {
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

  class UnexpectedAndroidLocalGemmaProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("runtime identity questions should not be delegated to Phone Gemma");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("android-local-gemma", new UnexpectedAndroidLocalGemmaProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-runtime-identity-phone");
      return "android-local-gemma/gemma-4-e4b-it";
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Who are you?" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-runtime-identity-phone",
      logPrefix: "[ModelRouterRuntimeIdentityPhoneTest]",
      allowRuntimeIdentityShortcut: true,
    });

    assert.equal(result.providerName, "jarvis-runtime");
    assert.equal(result.model, "gemma-4-e4b-it");
    assert.match(result.textContent, /I'm Jarvis\./);
    assert.match(result.textContent, /Local/);
    console.log("OK: runtime identity answers bypass selected Phone Gemma");
  } finally {
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeUserIdentityUsesProfileAuthorityAssertion(): Promise<void> {
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

  class UnexpectedGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("runtime user identity should come from profile state, not Gemini");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new UnexpectedGoogleProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-runtime-profile");
      return "google/gemini-2.5-pro";
    });
    _setRuntimeIdentityProfileResolverForTesting(async (userId) => {
      assert.equal(userId, "user-runtime-profile");
      return {
        userId,
        preferredName: "Justin",
        source: "profile_store",
      };
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Who am I?" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-runtime-profile",
      logPrefix: "[ModelRouterRuntimeUserIdentityTest]",
      allowRuntimeIdentityShortcut: true,
    });

    assert.equal(result.providerName, "jarvis-runtime");
    assert.equal(result.model, "gemini-2.5-pro");
    assert.match(result.textContent, /Justin/);
    assert.match(result.textContent, /profile/i);
    assert.doesNotMatch(result.textContent, /memory/i);
    console.log("OK: runtime user identity answers use profile authority instead of model memory");
  } finally {
    _setRuntimeIdentityProfileResolverForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeMemoryInspectionBypassesSelectedPhoneGemmaAssertion(): Promise<void> {
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

  class UnexpectedAndroidLocalGemmaProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("exact memory inspection should not be delegated to Phone Gemma");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("android-local-gemma", new UnexpectedAndroidLocalGemmaProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-runtime-memory-inspection-phone");
      return "android-local-gemma/gemma-4-e4b-it";
    });
    _setRuntimeMemoryInspectionDepsForTesting({
      loadCoreProfile: async (userId) => ({
        userId,
        preferredName: "Justin",
        source: "profile_store",
      }),
      loadSoul: async () => ({
        content: "JARVIS purpose: help the user operate across devices.",
        manualOverride: null,
        generatedAt: new Date("2026-06-24T12:00:00.000Z"),
        updatedAt: new Date("2026-06-24T12:00:00.000Z"),
      }),
      retrieveMemoryContext: async (input) => ({
        userId: input.userId,
        query: input.query,
        caller: "runtime_memory_inspection",
        items: [
          {
            memory: {
              id: "router-memory-inspection-1",
              content: "User prefers exact stored memory text when inspecting what Jarvis knows.",
              category: "preferences",
              tier: "long_term",
              memoryType: "semantic",
              relevanceScore: 90,
              confidence: 95,
              accessCount: 0,
              score: 0.96,
            },
            provenance: [{ kind: "user_memory", id: "router-memory-inspection-1", source: "canonical" }],
          },
        ],
        sources: { memories: ["router-memory-inspection-1"], brainChunks: [], hotState: [] },
        provenance: [{ kind: "user_memory", id: "router-memory-inspection-1", source: "canonical" }],
        uncertainty: [],
      }),
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "What do you know about me?" }],
      toolChoice: "none",
      maxCompletionTokens: 256,
      userId: "user-runtime-memory-inspection-phone",
      logPrefix: "[ModelRouterRuntimeMemoryInspectionPhoneTest]",
      allowRuntimeMemoryInspectionShortcut: true,
    });

    assert.equal(result.providerName, "jarvis-runtime");
    assert.equal(result.model, "gemma-4-e4b-it");
    assert.match(result.textContent, /Soul\/Core Profile/);
    assert.match(result.textContent, /MemoryOS/);
    assert.match(result.textContent, /exact stored memory text/);
    console.log("OK: runtime memory inspection answers bypass selected Phone Gemma");
  } finally {
    _setRuntimeMemoryInspectionDepsForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeActiveModelUsesCompactLabelAssertion(): Promise<void> {
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

  class UnexpectedGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("active-model questions should be answered by runtime state");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new UnexpectedGoogleProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-runtime-model-label");
      return "google/gemini-2.5-flash";
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "What model are you using?" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-runtime-model-label",
      logPrefix: "[ModelRouterRuntimeModelLabelTest]",
      allowRuntimeIdentityShortcut: true,
    });

    assert.equal(result.providerName, "jarvis-runtime");
    assert.equal(result.model, "gemini-2.5-flash");
    assert.match(result.textContent, /Gemini/);
    assert.match(result.textContent, /Jarvis/);
    console.log("OK: runtime active-model answers use compact provider labels");
  } finally {
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeIdentityStreamsDeterministicAnswerAssertion(): Promise<void> {
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

  class UnexpectedGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("streaming identity questions should be answered by runtime state");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new UnexpectedGoogleProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-runtime-stream-identity");
      return "google/gemini-2.5-flash";
    });

    const chunks: ProviderChunk[] = [];
    const result = await streamModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Who are you?" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-runtime-stream-identity",
      logPrefix: "[ModelRouterRuntimeIdentityStreamTest]",
      allowRuntimeIdentityShortcut: true,
    }, (chunk) => {
      chunks.push(chunk);
    });

    assert.equal(result.providerName, "jarvis-runtime");
    assert.equal(result.model, "gemini-2.5-flash");
    assert.match(result.textContent, /I'm Jarvis\./);
    assert.deepEqual(chunks, [
      { type: "text", delta: result.textContent },
      { type: "finish", reason: "stop" },
    ]);
    console.log("OK: runtime identity answers stream through the normal model-turn interface");
  } finally {
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeIdentityPreservesStructuredResponseFormatAssertion(): Promise<void> {
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

  let providerCalled = false;
  class StructuredGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      providerCalled = true;
      assert.deepEqual(params.responseFormat, { type: "json_object" });
      yield { type: "text", delta: '{"answer":"provider-json"}' };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new StructuredGoogleProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-runtime-structured-identity");
      return "google/gemini-2.5-flash";
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Who are you?" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      responseFormat: { type: "json_object" },
      userId: "user-runtime-structured-identity",
      logPrefix: "[ModelRouterRuntimeIdentityStructuredTest]",
      allowRuntimeIdentityShortcut: true,
    });

    assert.equal(providerCalled, true);
    assert.equal(result.providerName, "google");
    assert.equal(result.textContent, '{"answer":"provider-json"}');
    console.log("OK: runtime identity shortcut preserves structured response format contracts");
  } finally {
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeIdentityPreservesRequiredToolChoiceAssertion(): Promise<void> {
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

  let providerCalled = false;
  class RequiredToolGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      providerCalled = true;
      assert.equal(params.toolChoice, "required");
      yield { type: "text", delta: "provider-required-tool-contract" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new RequiredToolGoogleProvider());

    const result = await routeModelTurn({
      tier: "balanced",
      requestedModel: "google/gemini-2.5-flash",
      preferRequestedModel: true,
      messages: [{ role: "user", content: "Who am I?" }],
      tools: [{
        type: "function",
        function: {
          name: "identity_contract_tool",
          description: "Test tool for required tool contract preservation.",
          parameters: { type: "object", properties: {} },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 64,
      logPrefix: "[ModelRouterRuntimeIdentityRequiredToolTest]",
      allowRuntimeIdentityShortcut: true,
    });

    assert.equal(providerCalled, true);
    assert.equal(result.providerName, "google");
    assert.equal(result.textContent, "provider-required-tool-contract");
    console.log("OK: runtime identity shortcut preserves required tool-choice contracts");
  } finally {
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeIdentityBypassesRequiredMemoryToolRouteAssertion(): Promise<void> {
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

  class UnexpectedGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("required memory identity turns should be answered by runtime state");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new UnexpectedGoogleProvider());
    _setRuntimeIdentityProfileResolverForTesting(async (userId) => ({
      userId,
      preferredName: "Justin",
      source: "profile_store",
    }));

    const result = await routeModelTurn({
      tier: "balanced",
      requestedModel: "google/gemini-2.5-flash",
      preferRequestedModel: true,
      messages: [{ role: "user", content: "What's my name?" }],
      tools: [{
        type: "function",
        function: {
          name: "memory_search",
          description: "Search Jarvis memory.",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      }],
      toolChoice: "required",
      maxCompletionTokens: 64,
      userId: "user-runtime-required-memory",
      logPrefix: "[ModelRouterRuntimeIdentityRequiredMemoryTest]",
      allowRuntimeIdentityShortcut: true,
    });

    assert.equal(result.providerName, "jarvis-runtime");
    assert.match(result.textContent, /Justin/);
    console.log("OK: runtime identity shortcut bypasses required memory tool routes");
  } finally {
    _setRuntimeIdentityProfileResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeIdentityDoesNotHijackGeneralRouterJobsAssertion(): Promise<void> {
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

  let providerCalled = false;
  class TranslationGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      providerCalled = true;
      assert.equal(params.messages[0]?.role, "system");
      assert.equal(params.messages[1]?.role, "user");
      yield { type: "text", delta: "provider-translation-output" };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new TranslationGoogleProvider());

    const result = await routeModelTurn({
      tier: "balanced",
      requestedModel: "google/gemini-2.5-flash",
      preferRequestedModel: true,
      messages: [
        { role: "system", content: "Translate the user's text into French." },
        { role: "user", content: "Who are you?" },
      ],
      toolChoice: "none",
      maxCompletionTokens: 64,
      logPrefix: "[ModelRouterRuntimeIdentityGeneralJobTest]",
    });

    assert.equal(providerCalled, true);
    assert.equal(result.providerName, "google");
    assert.equal(result.textContent, "provider-translation-output");
    console.log("OK: runtime identity shortcut does not hijack general router jobs");
  } finally {
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeUserIdentityRequiresAuthenticatedUserAssertion(): Promise<void> {
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

  class UnexpectedGoogleProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("missing-auth identity questions should be answered by runtime state");
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("google", new UnexpectedGoogleProvider());

    const result = await routeModelTurn({
      tier: "balanced",
      requestedModel: "google/gemini-2.5-flash",
      preferRequestedModel: true,
      messages: [{ role: "user", content: "Who am I?" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      logPrefix: "[ModelRouterRuntimeIdentityAuthTest]",
      allowRuntimeIdentityShortcut: true,
    });

    assert.equal(result.providerName, "jarvis-runtime");
    assert.match(result.textContent, /Authentication\/runtime error/);
    assert.match(result.textContent, /signed-in user/);
    console.log("OK: runtime user identity questions report missing authenticated user as an auth/runtime response");
  } finally {
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeUserIdentityHidesProfileStoreExceptionDetailsAssertion(): Promise<void> {
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
  const previousWarn = console.warn;
  const warnings: unknown[][] = [];

  try {
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-runtime-profile-error");
      return "google/gemini-2.5-flash";
    });
    _setRuntimeIdentityProfileResolverForTesting(async () => {
      throw new Error("postgres://internal-host/account_name sql select * from profiles");
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Who am I?" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      userId: "user-runtime-profile-error",
      logPrefix: "[ModelRouterRuntimeIdentityProfileErrorTest]",
      allowRuntimeIdentityShortcut: true,
    });

    assert.equal(result.providerName, "jarvis-runtime");
    assert.match(result.textContent, /profile state is unavailable/i);
    assert.doesNotMatch(result.textContent, /postgres/i);
    assert.doesNotMatch(result.textContent, /internal-host/i);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0] ?? ""), /\[RuntimeIdentity\]/);
    assert.match(String((warnings[0]?.[1] as Error | undefined)?.message ?? ""), /internal-host/);
    console.log("OK: runtime user identity hides profile-store exception details from chat responses");
  } finally {
    console.warn = previousWarn;
    _setRuntimeIdentityProfileResolverForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runRuntimeModelLabelDoesNotTreatUnknownProviderAsLocalAssertion(): Promise<void> {
  assert.equal(
    classifyRuntimeIdentityIntent([{ role: "user", content: "What’s my name?" }]),
    "user_identity",
  );
  assert.equal(
    classifyRuntimeIdentityIntent([{ role: "user", content: "What’s your name?" }]),
    "assistant_identity",
  );
  assert.equal(
    runtimeModelLabelForRoute({ providerName: "experimental-provider" as never, model: "vendor/alpha-model" }),
    "Unknown",
  );
  assert.equal(
    runtimeModelLabelForRoute({ providerName: "local-llama" as never, model: "openai-compatible/llama-local" }),
    "Local",
  );
  assert.equal(
    runtimeModelLabelForRoute({ providerName: "openai-compatible" as never, model: "openai-compatible/auto-fastest" }),
    "OpenAI-compatible",
  );
  assert.equal(
    runtimeModelLabelForRoute({ providerName: "openai-compatible" as never, model: "openai-compatible/llama-local" }),
    "Local",
  );
  assert.equal(
    runtimeModelLabelForRoute({ providerName: "openai-compatible" as never, model: "modelrelay/auto-fastest" }),
    "ModelRelay",
  );
  console.log("OK: runtime model labels do not treat unknown providers as local");
}

async function runRuntimeCapabilityAnswersBypassSelectedPhoneGemmaAssertion(): Promise<void> {
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

  class UnexpectedAndroidLocalGemmaProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("runtime capability questions should not be delegated to Phone Gemma");
    }
  }

  try {
    assert.equal(
      classifyRuntimeCapabilityIntent([{ role: "user", content: "What tools can you use?" }]),
      "tools",
    );
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("android-local-gemma", new UnexpectedAndroidLocalGemmaProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-runtime-capability-phone");
      return "android-local-gemma/gemma-4-e4b-it";
    });
    _setRuntimeCapabilityDepsForTesting({
      now: () => new Date("2026-06-25T12:00:00.000Z"),
      loadConnectedAccounts: async () => [],
      loadDeviceControlState: async () => ({
        desktop: { connected: false, hostname: null, lastSeenAt: null, permissions: [] },
        android: {
          connected: true,
          hostname: "Galaxy Fold6",
          lastSeenAt: "2026-06-25T11:59:00.000Z",
          activeDevice: "Galaxy Fold6",
          permissions: {
            openApp: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            browse: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            screenCapture: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            readScreen: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            tapType: { status: "disabled", reason: "android_tap_type permission is disabled.", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            accessibility: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            notificationAccess: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            microphone: { status: "unknown", reason: "Not reported.", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          },
        },
      }),
    });

    const result = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "What tools can you use?" }],
      tools: [
        { type: "function", function: { name: "memory_search", description: "Search memory.", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "android_open_app_by_name", description: "Open an Android app.", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "send_email", description: "Send email.", parameters: { type: "object", properties: {} } } },
      ],
      toolChoice: "auto",
      maxCompletionTokens: 64,
      userId: "user-runtime-capability-phone",
      logPrefix: "[ModelRouterRuntimeCapabilityPhoneTest]",
      allowRuntimeCapabilityShortcut: true,
    });

    assert.equal(result.providerName, "jarvis-runtime");
    assert.equal(result.model, "gemma-4-e4b-it");
    assert.match(result.textContent, /Memory: memory_search/);
    assert.match(result.textContent, /Runtime: android_open_app_by_name/);
    assert.match(result.textContent, /Email not connected: send_email/);
    assert.match(result.textContent, /Device Control: Android connected/);

    const requiredStatusResult = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Is screen capture permission enabled on my phone?" }],
      tools: [
        { type: "function", function: { name: "android_capture_screen", description: "Capture the Android screen.", parameters: { type: "object", properties: {} } } },
      ],
      toolChoice: "required",
      maxCompletionTokens: 64,
      userId: "user-runtime-capability-phone",
      logPrefix: "[ModelRouterRuntimeCapabilityRequiredPhoneStatusTest]",
      allowRuntimeCapabilityShortcut: true,
    });

    assert.equal(requiredStatusResult.providerName, "jarvis-runtime");
    assert.equal(requiredStatusResult.model, "gemma-4-e4b-it");
    assert.match(requiredStatusResult.textContent, /Android Device Control: connected/);
    assert.match(requiredStatusResult.textContent, /Screen capture: ready/);
    console.log("OK: runtime capability answers bypass selected Phone Gemma");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
    _setUserSelectedModelResolverForTesting(null);
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runPhoneGemmaDiagnosticsBypassSelectedPhoneGemmaAssertion(): Promise<void> {
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

  class UnexpectedAndroidLocalGemmaProvider extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(): AsyncGenerator<ProviderChunk> {
      throw new Error("Phone Gemma diagnostic questions should not be delegated to Phone Gemma");
    }
  }

  try {
    assert.equal(
      classifyPhoneGemmaDiagnosticIntent([{ role: "user", content: "Is Jarvis working correctly?" }]),
      null,
    );
    assert.equal(
      classifyPhoneGemmaDiagnosticIntent([{ role: "user", content: "Is Phone Gemma working correctly?" }]),
      "status",
    );
    process.env.JARVIS_MODEL_PROVIDER = "chatgpt-codex-oauth";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "true";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;
    _overrideProviderForTesting("android-local-gemma", new UnexpectedAndroidLocalGemmaProvider());
    _setUserSelectedModelResolverForTesting(async ({ userId }) => {
      assert.equal(userId, "user-phone-gemma-diagnostics");
      return "android-local-gemma/gemma-4-e4b-it";
    });
    clearPhoneGemmaDiagnosticsForTesting();
    recordPhoneGemmaDiagnosticResult({
      userId: "user-phone-gemma-diagnostics",
      deviceId: "android-phone",
      model: "gemma-4-e4b-it",
      profileId: "active",
      status: "failed",
      checkedAt: "2026-06-26T08:50:00.000Z",
      checks: [
        {
          id: "ready_response",
          label: "READY response",
          status: "passed",
          detail: "Returned READY.",
        },
        {
          id: "simple_math",
          label: "Simple math",
          status: "failed",
          detail: "Returned blank text.",
        },
      ],
    });

    const status = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Is Phone Gemma working correctly?" }],
      toolChoice: "auto",
      maxCompletionTokens: 64,
      userId: "user-phone-gemma-diagnostics",
      logPrefix: "[ModelRouterPhoneGemmaDiagnosticsTest]",
      allowPhoneGemmaDiagnosticShortcut: true,
    });

    assert.equal(status.providerName, "jarvis-runtime");
    assert.equal(status.model, "gemma-4-e4b-it");
    assert.match(status.textContent, /Phone Gemma is not passing diagnostics/);
    assert.match(status.textContent, /Simple math: failed/);
    assert.match(status.textContent, /Sources: Diagnostics\./);

    const diagnosticActions: string[] = [];
    _setPhoneGemmaDiagnosticDepsForTesting({
      now: () => new Date("2026-06-26T09:00:00.000Z"),
      runIdentityCheck: async () => {
        diagnosticActions.push("identity");
        return { status: "passed", detail: "Jarvis identity came from runtime state." };
      },
      runReadyResponseCheck: async () => {
        diagnosticActions.push("ready");
        return { status: "passed", detail: "Returned READY." };
      },
      runSimpleMathCheck: async () => {
        diagnosticActions.push("math");
        return { status: "passed", detail: "7 + 5 matched." };
      },
      runMemoryLookupCheck: async () => {
        diagnosticActions.push("memory");
        return { status: "skipped", detail: "No test-safe memory fixture available." };
      },
      runOpenYoutubeCheck: async () => {
        diagnosticActions.push("youtube");
        return { status: "passed", detail: "Open YouTube preflight passed." };
      },
      runCancelSanityCheck: async () => {
        diagnosticActions.push("cancel");
        return { status: "skipped", detail: "Phone Gemma is idle; cancel sanity skipped." };
      },
    });

    const runDiagnostic = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Test Phone Gemma" }],
      toolChoice: "auto",
      maxCompletionTokens: 64,
      userId: "user-phone-gemma-diagnostics",
      logPrefix: "[ModelRouterPhoneGemmaRunDiagnosticTest]",
      allowPhoneGemmaDiagnosticShortcut: true,
    });

    assert.equal(runDiagnostic.providerName, "jarvis-runtime");
    assert.equal(runDiagnostic.model, "gemma-4-e4b-it");
    assert.deepEqual(diagnosticActions, ["identity", "ready", "math", "memory", "youtube", "cancel"]);
    assert.match(runDiagnostic.textContent, /Phone Gemma passed its current diagnostic/);
    assert.match(runDiagnostic.textContent, /Sources: Diagnostics\./);

    const recoveryActions: string[] = [];
    _setPhoneGemmaDiagnosticDepsForTesting({
      now: () => new Date("2026-06-26T09:00:00.000Z"),
      requestResetApproval: async () => ({
        approved: true,
        gateId: "gate-phone-gemma-reset",
        resetTarget: {
          requestId: "approved-phone-gemma-request",
          scope: "tracked_phone_gemma_request",
          capturedAt: "2026-06-26T09:00:00.000Z",
        },
      }),
      cancelActiveGeneration: async () => {
        recoveryActions.push("cancel");
        return { status: "passed", detail: "Android confirmed cancellation." };
      },
      waitForNativeIdle: async () => {
        recoveryActions.push("idle");
        return { status: "passed", detail: "Android reported idle." };
      },
      clearStaleRequestState: async () => {
        recoveryActions.push("clear");
        return { status: "passed", detail: "Cleared stale state." };
      },
    });

    const fix = await routeModelTurn({
      tier: "balanced",
      messages: [{ role: "user", content: "Fix Phone Gemma" }],
      toolChoice: "required",
      maxCompletionTokens: 64,
      userId: "user-phone-gemma-diagnostics",
      logPrefix: "[ModelRouterPhoneGemmaFixTest]",
      allowPhoneGemmaDiagnosticShortcut: true,
    });

    assert.equal(fix.providerName, "jarvis-runtime");
    assert.equal(fix.model, "gemma-4-e4b-it");
    assert.deepEqual(recoveryActions, ["cancel", "idle", "clear"]);
    assert.match(fix.textContent, /I reset Phone Gemma Runtime/);
    assert.match(fix.textContent, /Model files and memories were preserved/);
    console.log("OK: Phone Gemma diagnostics and recovery bypass selected Phone Gemma");
  } finally {
    _setPhoneGemmaDiagnosticDepsForTesting(null);
    clearPhoneGemmaDiagnosticsForTesting();
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
  .then(runRequestedChatGPTSubscriptionUsesOAuthRouteAssertion)
  .then(runUserDefaultProviderProfileStreamingRouteAssertion)
  .then(runUserDefaultProviderProfileDoesNotSilentlyFallbackAssertion)
  .then(runExplicitProviderModelRouteAssertion)
  .then(runProviderWideRuntimeStateCardAssertion)
  .then(runProviderRuntimeStateCardFallbackChainAssertion)
  .then(runPlainGptRequestUsesConfiguredChainAssertion)
  .then(runCoachChatSelectedProviderModelAssertion)
  .then(runRequestedProviderModelOverridesAmbientCodexRouteAssertion)
  .then(runRuntimeIdentityAnswersBypassSelectedPhoneGemmaAssertion)
  .then(runRuntimeUserIdentityUsesProfileAuthorityAssertion)
  .then(runRuntimeMemoryInspectionBypassesSelectedPhoneGemmaAssertion)
  .then(runRuntimeActiveModelUsesCompactLabelAssertion)
  .then(runRuntimeIdentityStreamsDeterministicAnswerAssertion)
  .then(runRuntimeIdentityPreservesStructuredResponseFormatAssertion)
  .then(runRuntimeIdentityPreservesRequiredToolChoiceAssertion)
  .then(runRuntimeIdentityBypassesRequiredMemoryToolRouteAssertion)
  .then(runRuntimeIdentityDoesNotHijackGeneralRouterJobsAssertion)
  .then(runRuntimeUserIdentityRequiresAuthenticatedUserAssertion)
  .then(runRuntimeUserIdentityHidesProfileStoreExceptionDetailsAssertion)
  .then(runRuntimeModelLabelDoesNotTreatUnknownProviderAsLocalAssertion)
  .then(runRuntimeCapabilityAnswersBypassSelectedPhoneGemmaAssertion)
  .then(runPhoneGemmaDiagnosticsBypassSelectedPhoneGemmaAssertion)
  .then(runLeanContextToolBudgetAssertion)
  .then(() => {
    console.log("\nAll model router assertions passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
