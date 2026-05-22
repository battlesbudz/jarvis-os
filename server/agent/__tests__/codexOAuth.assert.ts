import assert from "node:assert/strict";
import { buildCodexSpawnCommand } from "../providers/codexCommand";
import {
  buildCodexOAuthProviderPrompt,
  codexGatewayFailureMessage,
  parseCodexOAuthOrchestratorOutput,
} from "../providers/codexOAuth";

{
  const previousComSpec = process.env.ComSpec;
  process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    const command = buildCodexSpawnCommand("C:\\Users\\justi\\AppData\\Roaming\\npm\\codex.cmd", ["login", "status"]);
    assert.equal(command.command, "C:\\Windows\\System32\\cmd.exe");
    assert.deepEqual(command.args, [
      "/d",
      "/s",
      "/c",
      "C:\\Users\\justi\\AppData\\Roaming\\npm\\codex.cmd",
      "login",
      "status",
    ]);
  } finally {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    if (previousComSpec == null) delete process.env.ComSpec;
    else process.env.ComSpec = previousComSpec;
  }
  console.log("OK: Codex OAuth uses cmd.exe for Windows .cmd launchers");
}

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

{
  const message = codexGatewayFailureMessage(
    "https://battles-pc.tailf68942.ts.net",
    new TypeError("fetch failed"),
    3,
  );
  assert.match(message, /after 3 attempts/);
  assert.match(message, /fetch failed/);
  assert.match(message, /battles-pc\.tailf68942\.ts\.net/);
  assert.match(message, /Tailscale/);
  console.log("OK: Codex OAuth gateway failures include actionable host/recovery guidance");
}

console.log("\nAll Codex OAuth provider assertions passed.");
