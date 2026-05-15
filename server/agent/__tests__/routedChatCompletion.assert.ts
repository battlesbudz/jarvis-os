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

  assert.equal(captured?.tier, "balanced");
  assert.equal(captured?.maxCompletionTokens, 42);
  assert.equal(response.model, "chatgpt-codex-oauth/auto");
  assert.equal(response.choices[0]?.message.content, '{"ok":true}');
  console.log("OK: routed chat completion maps OpenAI-style requests through the Jarvis router");

  const shim = createRoutedOpenAIChatShim("[TestShim]");
  assert.equal(typeof shim.chat.completions.create, "function");
  console.log("OK: routed OpenAI chat shim exposes the existing chat.completions.create shape");

  console.log("\nAll routed chat completion assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
