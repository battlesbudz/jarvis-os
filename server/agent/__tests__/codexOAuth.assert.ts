import assert from "node:assert/strict";
import { buildCodexOAuthProviderPrompt, parseCodexOAuthOrchestratorOutput } from "../providers/codexOAuth";

{
  const parsed = parseCodexOAuthOrchestratorOutput(`{"type":"final","content":"Done."}`);
  assert.deepEqual(parsed, { type: "final", content: "Done." });
  console.log("OK: Codex OAuth parser reads final JSON responses");
}

{
  const parsed = parseCodexOAuthOrchestratorOutput([
    "```json",
    JSON.stringify({
      type: "tool_calls",
      tool_calls: [
        {
          name: "manage_tasks",
          arguments: { action: "create", title: "Review plan" },
        },
      ],
    }),
    "```",
  ].join("\n"));

  assert.equal(parsed.type, "tool_calls");
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].type, "function");
  assert.equal(parsed.toolCalls[0].function.name, "manage_tasks");
  assert.equal(parsed.toolCalls[0].function.arguments, JSON.stringify({ action: "create", title: "Review plan" }));
  assert.ok(parsed.toolCalls[0].id.startsWith("codex_call_"));
  console.log("OK: Codex OAuth parser converts fenced JSON tool calls to OpenAI-compatible calls");
}

{
  const parsed = parseCodexOAuthOrchestratorOutput("Plain answer from Codex.");
  assert.deepEqual(parsed, { type: "final", content: "Plain answer from Codex." });
  console.log("OK: Codex OAuth parser treats non-JSON output as final text");
}

{
  const prompt = buildCodexOAuthProviderPrompt({
    model: "chatgpt-codex-oauth/auto",
    messages: [{ role: "user", content: "Use a tool if needed." }],
    tools: [
      {
        type: "function",
        function: {
          name: "memory_search",
          description: "Search memory",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    toolChoice: "auto",
  });
  assert.match(prompt, /main brain orchestrator/);
  assert.match(prompt, /"type":"tool_calls"/);
  assert.match(prompt, /memory_search/);
  console.log("OK: Codex OAuth provider prompt preserves tool-call protocol for remote gateway");
}

console.log("\nAll Codex OAuth provider assertions passed.");
