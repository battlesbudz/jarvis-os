import assert from "node:assert/strict";
import type { ProviderTurnResult } from "../providers/base";
import { createRoutedChatCompletion, createRoutedOpenAIChatShim } from "../routedChatCompletion";

async function main() {
  let captured: Record<string, unknown> | null = null;
  const response = await createRoutedChatCompletion(
    {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Return JSON" }],
      max_tokens: 42,
    },
    { tier: "balanced", logPrefix: "[TestRoutedChat]" },
    async (params): Promise<ProviderTurnResult> => {
      captured = params as unknown as Record<string, unknown>;
      return {
        textContent: '{"ok":true}',
        textChunks: ['{"ok":true}'],
        toolCallList: [],
        finishReason: "stop",
        providerName: "chatgpt-codex-oauth",
        model: "chatgpt-codex-oauth/auto",
      };
    },
  );

  const capturedRequest = captured as Record<string, unknown> | null;
  assert.equal(capturedRequest?.tier, "balanced");
  assert.equal(capturedRequest?.maxCompletionTokens, 42);
  assert.equal(capturedRequest?.requestedModel, "gpt-4o-mini");
  assert.equal(response.model, "chatgpt-codex-oauth/auto");
  assert.equal(response.choices[0]?.message.content, '{"ok":true}');
  console.log("OK: routed chat completion maps OpenAI-style requests through the Jarvis router");

  captured = null;
  await createRoutedChatCompletion(
    {
      model: "anthropic/claude-sonnet-4-5",
      messages: [{ role: "user", content: "Use Claude" }],
      max_tokens: 42,
    },
    { tier: "balanced", logPrefix: "[TestRoutedClaude]", userId: "user-claude" },
    async (params): Promise<ProviderTurnResult> => {
      captured = params as unknown as Record<string, unknown>;
      return {
        textContent: "claude ok",
        textChunks: ["claude ok"],
        toolCallList: [],
        finishReason: "stop",
        providerName: "anthropic",
        model: "claude-sonnet-4-5",
      };
    },
  );
  assert.equal((captured as Record<string, unknown> | null)?.requestedModel, "anthropic/claude-sonnet-4-5");
  assert.equal((captured as Record<string, unknown> | null)?.userId, "user-claude");
  console.log("OK: routed chat completion preserves explicit provider model requests");

  const shim = createRoutedOpenAIChatShim("[TestShim]");
  assert.equal(typeof shim.chat.completions.create, "function");
  console.log("OK: routed OpenAI chat shim exposes the existing chat.completions.create shape");

  console.log("\nAll routed chat completion assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
