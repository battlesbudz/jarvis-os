import assert from "node:assert/strict";
import {
  postCheck,
  preThink,
  shouldBypassQualityLoopForModel,
} from "../qualityLoop";
import { BaseProvider, _clearProviderCacheForTesting, _overrideProviderForTesting } from "../providers";
import type { ProviderChunk, ProviderQueryParams } from "../providers/base";

const CODEX_MODEL = "chatgpt-codex-oauth/auto";

assert.equal(shouldBypassQualityLoopForModel(CODEX_MODEL), true);
assert.equal(shouldBypassQualityLoopForModel("codex-oauth/auto"), true);
assert.equal(shouldBypassQualityLoopForModel("gpt-4.1-mini"), false);

async function main(): Promise<void> {
  const preThinkStartedAt = Date.now();
  const guidance = await preThink(
    "Search the web for today's AI news.",
    "Telegram June 3, 2026",
    CODEX_MODEL,
    "test-user",
  );
  assert.equal(guidance, "");
  assert.ok(
    Date.now() - preThinkStartedAt < 1000,
    "Codex OAuth quality pre-think should bypass immediately instead of opening a daemon model turn",
  );

  const checkStartedAt = Date.now();
  const check = await postCheck(
    "Search the web for today's AI news.",
    "Here is a concise answer.",
    CODEX_MODEL,
    "test-user",
  );
  assert.deepEqual(check, { passed: true, feedback: "" });
  assert.ok(
    Date.now() - checkStartedAt < 1000,
    "Codex OAuth quality post-check should bypass immediately instead of opening a daemon model turn",
  );

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
  class CapturingOpenAIProvider extends BaseProvider {
    constructor(private readonly text: string) {
      super();
    }

    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      captured = params;
      yield { type: "text", delta: this.text };
      yield { type: "finish", reason: "stop" };
    }
  }

  try {
    process.env.JARVIS_MODEL_PROVIDER = "openai";
    process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";
    process.env.JARVIS_TEST_ALLOW_DIRECT_PROVIDER = "true";
    delete process.env.CHATGPT_CODEX_OAUTH_ENABLED;
    delete process.env.PROVIDER_FALLBACK_CHAIN;

    _overrideProviderForTesting("openai", new CapturingOpenAIProvider("Use a concise answer."));
    const directGuidance = await preThink(
      "What are my active tasks?",
      "Current chat",
      "openai/gpt-4.1-mini",
      "quality-user",
    );
    const preThinkRequest = captured as ProviderQueryParams | null;
    assert.equal(directGuidance, "Use a concise answer.");
    assert.equal(
      preThinkRequest?.messages.some((message) => (
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.includes("## Jarvis Runtime State Card")
      )),
      false,
    );

    captured = null;
    _overrideProviderForTesting("openai", new CapturingOpenAIProvider("PASS: answered"));
    const directCheck = await postCheck(
      "What are my active tasks?",
      "Here are your current tasks.",
      "openai/gpt-4.1-mini",
      "quality-user",
    );
    const postCheckRequest = captured as ProviderQueryParams | null;
    assert.deepEqual(directCheck, { passed: true, feedback: "" });
    assert.equal(
      postCheckRequest?.messages.some((message) => (
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.includes("## Jarvis Runtime State Card")
      )),
      false,
    );
  } finally {
    _clearProviderCacheForTesting();
    for (const [key, value] of previousEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log("OK: Codex OAuth quality loop is bypassed for optional checks.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
