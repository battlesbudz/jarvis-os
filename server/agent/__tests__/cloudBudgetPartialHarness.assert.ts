import assert from "node:assert/strict";
import { runAgent } from "../harness";
import {
  BaseProvider,
  _clearProviderCacheForTesting,
  _overrideProviderForTesting,
} from "../providers";
import type { ProviderChunk, ProviderQueryParams } from "../providers/base";
import type { AgentTool } from "../types";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";
delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
delete process.env.JARVIS_MODEL_PROVIDER;
delete process.env.JARVIS_AI_PROVIDER;

class ToolFirstProvider extends BaseProvider {
  calls = 0;

  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}

  async *query(_params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    this.calls++;
    if (this.calls === 1) {
      yield {
        type: "tool_call_start",
        index: 0,
        id: "call_findings",
        name: "collect_findings",
      };
      yield { type: "tool_call_args", index: 0, args: "{}" };
      yield { type: "finish", reason: "tool_calls" };
      return;
    }
    yield { type: "text", delta: "This second model turn should not run." };
    yield { type: "finish", reason: "stop" };
  }
}

const collectFindingsTool: AgentTool = {
  name: "collect_findings",
  description: "Collect partial research findings.",
  parameters: { type: "object", properties: {} },
  execute: async () => ({
    ok: true,
    content: "Found competitor pricing: Starter $19, Pro $49. Draft angle: compare onboarding.",
  }),
};

async function main(): Promise<void> {
  const provider = new ToolFirstProvider();
  _overrideProviderForTesting("openai", provider);
  _overrideProviderForTesting("chatgpt-codex-oauth", provider);
  try {
    const result = await runAgent({
      model: "gpt-4.1-mini",
      forceModel: true,
      messages: [
        { role: "user", content: "Research this competitor." },
      ],
      tools: [collectFindingsTool],
      context: {
        userId: "",
        state: {},
        channel: "CloudBudgetPartialHarnessTest",
      },
      cloudBudget: {
        budgetUsd: 0.015,
        spentUsd: 0,
        usdPer1kTokens: 0.05,
      },
      maxTurns: 3,
      maxCompletionTokens: 16,
      toolChoice: "auto",
    });

    assert.equal(provider.calls, 1, "budget guard should stop before the second provider call");
    assert.equal(result.finishReason, "budget_stopped");
    assert.equal(result.toolCalls.length, 1);
    assert.match(result.reply, /Partial work already gathered/i);
    assert.match(result.reply, /Found competitor pricing: Starter \$19, Pro \$49/i);
    assert.match(result.reply, /Estimated remaining budget/i);
    console.log("OK: budget-stopped harness replies preserve prior partial tool output");
  } finally {
    _clearProviderCacheForTesting();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
