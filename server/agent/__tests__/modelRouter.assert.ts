import assert from "node:assert/strict";
import {
  routeModelTurn,
  classifyTaskComplexity,
  classifyTaskPrivacy,
  routeModelForTask,
  _setOpenAIProviderStatusResolverForTesting,
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
    requestedModel: "claude-opus-4-6",
    explicitModel: false,
    messages: userMessage("Rewrite this to be shorter."),
    toolCount: 0,
    routing: { enabled: true, cheapModel: "groq/llama-3.1-8b-instant" },
  });
  assert.equal(decision.model, CODEX_MODEL);
  assert.equal(decision.tier, "free");
  assert.equal(decision.delegated, true);
  console.log("OK: easy no-tool task stays on Codex OAuth even when a cheap provider is supplied");
}

{
  const decision = routeModelForTask({
    requestedModel: "claude-opus-4-6",
    explicitModel: false,
    messages: userMessage("Rewrite this private email."),
    toolCount: 0,
    routing: { enabled: true, privacyLevel: "sensitive" },
  });
  assert.equal(decision.model, CODEX_MODEL);
  assert.equal(decision.tier, "prime");
  assert.equal(decision.delegated, true);
  console.log("OK: sensitive task stays on Codex OAuth prime tier");
}

{
  const decision = routeModelForTask({
    requestedModel: "claude-opus-4-6",
    explicitModel: false,
    messages: userMessage("Classify this inbox item."),
    toolCount: 1,
    routing: { enabled: true },
  });
  assert.equal(decision.model, CODEX_MODEL);
  assert.equal(decision.delegated, true);
  assert.match(decision.reason, /tools/);
  console.log("OK: free-tier delegation is blocked when tools are available and Codex remains selected");
}

{
  const decision = routeModelForTask({
    requestedModel: "gpt-4.1-mini",
    explicitModel: true,
    messages: userMessage("Rewrite this."),
    toolCount: 0,
    routing: { enabled: true },
  });
  assert.equal(decision.model, CODEX_MODEL);
  assert.equal(decision.delegated, true);
  assert.match(decision.reason, /Codex OAuth/);
  console.log("OK: explicit direct model choices are replaced by Codex OAuth");
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

runUserOpenAIProfileRouteAssertion()
  .then(runExplicitProviderModelRouteAssertion)
  .then(runPlainGptRequestUsesConfiguredChainAssertion)
  .then(runCoachChatSelectedProviderModelAssertion)
  .then(runLeanContextToolBudgetAssertion)
  .then(() => {
    console.log("\nAll model router assertions passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
