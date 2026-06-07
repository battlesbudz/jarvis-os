import assert from "node:assert/strict";
import {
  routeModelTurn,
  classifyTaskComplexity,
  classifyTaskPrivacy,
  routeModelForTask,
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

runLeanContextToolBudgetAssertion()
  .then(() => {
    console.log("\nAll model router assertions passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
