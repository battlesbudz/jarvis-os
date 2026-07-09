import assert from "node:assert/strict";
import { createRuntimeExplanation, runtimeSource } from "../../core/runtime/runtimeExplanation";
import type { ProviderTurnResult } from "../providers/base";
import { createRoutedChatCompletion, createRoutedOpenAIChatShim } from "../routedChatCompletion";

async function main() {
  let captured: Record<string, unknown> | null = null;
  const response = await createRoutedChatCompletion(
    {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Return JSON" }],
      response_format: { type: "json_object" },
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
        runtimeExplanation: createRuntimeExplanation({
          title: "Runtime-owned answer",
          message: '{"ok":true}',
          usedSources: [runtimeSource("Diagnostics")],
        }),
      };
    },
  );

  const capturedRequest = captured as Record<string, unknown> | null;
  assert.equal(capturedRequest?.tier, "balanced");
  assert.equal(capturedRequest?.maxCompletionTokens, 42);
  assert.equal(capturedRequest?.requestedModel, "gpt-4o-mini");
  assert.deepEqual(capturedRequest?.responseFormat, { type: "json_object" });
  assert.equal(capturedRequest?.allowRuntimeMemoryInspectionShortcut, true);
  assert.equal(capturedRequest?.allowRuntimeIdentityShortcut, true);
  assert.equal(response.model, "chatgpt-codex-oauth/auto");
  assert.equal(response.choices[0]?.message.content, '{"ok":true}');
  assert.equal(response.runtimeExplanation?.title, "Runtime-owned answer");
  assert.deepEqual(response.runtimeExplanation?.sources.used.map((source) => source.label), ["Diagnostics"]);
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

  captured = null;
  await createRoutedChatCompletion(
    {
      model: "google/gemini-2.5-pro",
      user: "user-gemini",
      messages: [{ role: "user", content: "Use Gemini" }],
      max_tokens: 42,
    },
    { tier: "balanced", logPrefix: "[TestRoutedGeminiUser]" },
    async (params): Promise<ProviderTurnResult> => {
      captured = params as unknown as Record<string, unknown>;
      return {
        textContent: "gemini ok",
        textChunks: ["gemini ok"],
        toolCallList: [],
        finishReason: "stop",
        providerName: "google",
        model: "gemini-2.5-pro",
      };
    },
  );
  assert.equal((captured as Record<string, unknown> | null)?.requestedModel, "google/gemini-2.5-pro");
  assert.equal((captured as Record<string, unknown> | null)?.userId, "user-gemini");
  assert.notEqual((captured as Record<string, unknown> | null)?.disableRuntimeStateCard, true);
  console.log("OK: routed chat completion reads user-scoped provider auth from the OpenAI user field");

  captured = null;
  await createRoutedChatCompletion(
    {
      model: "gpt-4o-mini",
      user: "user-json-shim",
      messages: [
        {
          role: "system",
          content: "Extract facts from this conversation. Return ONLY a JSON array of objects. No preamble.",
        },
        { role: "user", content: "User: hello\nAgent: hi" },
      ],
      max_tokens: 42,
    },
    { tier: "cheap", logPrefix: "[TestRoutedJsonOnlyShim]" },
    async (params): Promise<ProviderTurnResult> => {
      captured = params as unknown as Record<string, unknown>;
      return {
        textContent: "[]",
        textChunks: ["[]"],
        toolCallList: [],
        finishReason: "stop",
        providerName: "openai",
        model: "gpt-4o-mini",
      };
    },
  );
  assert.equal((captured as Record<string, unknown> | null)?.userId, "user-json-shim");
  assert.equal((captured as Record<string, unknown> | null)?.responseFormat, undefined);
  assert.equal((captured as Record<string, unknown> | null)?.disableRuntimeStateCard, true);
  console.log("OK: routed chat completion disables runtime state cards for strict JSON-only shim calls");

  captured = null;
  await createRoutedChatCompletion(
    {
      model: "gpt-4o-mini",
      user: "user-json-state-shim",
      messages: [
        { role: "system", content: "Return only JSON matching this schema: { tasks: [{ title, source }] }." },
        { role: "user", content: "What are my active tasks?" },
      ],
      response_format: { type: "json_object" },
      max_tokens: 42,
    },
    { tier: "cheap", logPrefix: "[TestRoutedJsonStateShim]" },
    async (params): Promise<ProviderTurnResult> => {
      captured = params as unknown as Record<string, unknown>;
      return {
        textContent: '{"tasks":[]}',
        textChunks: ['{"tasks":[]}'],
        toolCallList: [],
        finishReason: "stop",
        providerName: "openai",
        model: "gpt-4o-mini",
      };
    },
  );
  assert.equal((captured as Record<string, unknown> | null)?.userId, "user-json-state-shim");
  assert.deepEqual((captured as Record<string, unknown> | null)?.responseFormat, { type: "json_object" });
  assert.notEqual((captured as Record<string, unknown> | null)?.disableRuntimeStateCard, true);
  console.log("OK: routed chat completion keeps runtime state cards for JSON-formatted state questions");

  captured = null;
  await createRoutedChatCompletion(
    {
      model: "gpt-4o-mini",
      user: "user-json-memory-state-shim",
      messages: [
        { role: "system", content: "Return only JSON." },
        { role: "user", content: "What memories do you have about me?" },
      ],
      max_tokens: 42,
    },
    { tier: "cheap", logPrefix: "[TestRoutedJsonMemoryStateShim]" },
    async (params): Promise<ProviderTurnResult> => {
      captured = params as unknown as Record<string, unknown>;
      return {
        textContent: '{"memories":[]}',
        textChunks: ['{"memories":[]}'],
        toolCallList: [],
        finishReason: "stop",
        providerName: "openai",
        model: "gpt-4o-mini",
      };
    },
  );
  assert.equal((captured as Record<string, unknown> | null)?.userId, "user-json-memory-state-shim");
  assert.notEqual((captured as Record<string, unknown> | null)?.disableRuntimeStateCard, true);
  console.log("OK: routed chat completion keeps runtime state cards for JSON-formatted memory questions");

  captured = null;
  const memoryVaultShim = createRoutedOpenAIChatShim("[MemoryVaultTest]", "balanced", {
    disableRuntimeStateCard: true,
    runner: async (params): Promise<ProviderTurnResult> => {
      captured = params as unknown as Record<string, unknown>;
      return {
        textContent: "wiki page",
        textChunks: ["wiki page"],
        toolCallList: [],
        finishReason: "stop",
        providerName: "openai",
        model: "gpt-4o-mini",
      };
    },
  });
  await memoryVaultShim.chat.completions.create({
    model: "gpt-4o-mini",
    user: "user-memory-vault",
    messages: [{ role: "user", content: "Write the full revised wiki page content only." }],
    max_tokens: 42,
  });
  assert.equal((captured as Record<string, unknown> | null)?.userId, "user-memory-vault");
  assert.equal((captured as Record<string, unknown> | null)?.responseFormat, undefined);
  assert.equal((captured as Record<string, unknown> | null)?.disableRuntimeStateCard, true);
  console.log("OK: routed OpenAI chat shim can disable runtime state cards for internal memory writers");

  const shim = createRoutedOpenAIChatShim("[TestShim]");
  assert.equal(typeof shim.chat.completions.create, "function");
  console.log("OK: routed OpenAI chat shim exposes the existing chat.completions.create shape");

  console.log("\nAll routed chat completion assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
