import assert from "node:assert/strict";
import { buildCodexSpawnCommand } from "../providers/codexCommand";
import {
  _setCodexOAuthDaemonBridgeForTesting,
  buildCodexOAuthProviderPrompt,
  CodexOAuthProvider,
  codexGatewayFailureMessage,
  getCodexOAuthRuntimeStatus,
  missingCodexGatewayMessage,
  parseCodexOAuthOrchestratorOutput,
} from "../providers/codexOAuth";

async function main() {
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
    maxCompletionTokens: 600,
    stream: false,
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

{
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousDaemonEnabled = process.env.JARVIS_CODEX_DAEMON_ENABLED;
  delete process.env.JARVIS_CODEX_GATEWAY_URL;
  process.env.JARVIS_CODEX_DAEMON_ENABLED = "false";
  try {
    const provider = new CodexOAuthProvider();
    await assert.rejects(
      async () => {
        for await (const _chunk of provider.query({
          model: "chatgpt-codex-oauth/auto",
          messages: [{ role: "user", content: "Hello" }],
          toolChoice: "none",
          maxCompletionTokens: 64,
          stream: false,
        })) {
          // exhaust generator
        }
      },
      /no available runtime/,
    );
    assert.match(missingCodexGatewayMessage(), /Desktop Daemon/);
  } finally {
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousDaemonEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_ENABLED = previousDaemonEnabled;
  }
  console.log("OK: Codex OAuth provider reports missing runtime when gateway and daemon are unavailable");
}

{
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousToken = process.env.JARVIS_CODEX_GATEWAY_TOKEN;
  const previousRuntime = process.env.JARVIS_CODEX_RUNTIME;
  const previousDaemonEnabled = process.env.JARVIS_CODEX_DAEMON_ENABLED;
  process.env.JARVIS_CODEX_GATEWAY_URL = "https://gateway.example.test";
  delete process.env.JARVIS_CODEX_GATEWAY_TOKEN;
  delete process.env.JARVIS_CODEX_RUNTIME;
  process.env.JARVIS_CODEX_DAEMON_ENABLED = "true";
  try {
    const status = await getCodexOAuthRuntimeStatus("user-1");
    assert.equal(status.available, false);
    assert.equal(status.selectedRuntime, "gateway");
    assert.equal(status.gatewayConfigured, true);
    assert.equal(status.gatewayTokenConfigured, false);
    assert.match(status.reason, /TOKEN/);
  } finally {
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousToken == null) delete process.env.JARVIS_CODEX_GATEWAY_TOKEN;
    else process.env.JARVIS_CODEX_GATEWAY_TOKEN = previousToken;
    if (previousRuntime == null) delete process.env.JARVIS_CODEX_RUNTIME;
    else process.env.JARVIS_CODEX_RUNTIME = previousRuntime;
    if (previousDaemonEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_ENABLED = previousDaemonEnabled;
  }
  console.log("OK: Codex OAuth runtime status reports a gateway URL without a token as unavailable");
}

{
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousToken = process.env.JARVIS_CODEX_GATEWAY_TOKEN;
  const previousRuntime = process.env.JARVIS_CODEX_RUNTIME;
  const previousDaemonEnabled = process.env.JARVIS_CODEX_DAEMON_ENABLED;
  delete process.env.JARVIS_CODEX_GATEWAY_URL;
  delete process.env.JARVIS_CODEX_GATEWAY_TOKEN;
  process.env.JARVIS_CODEX_RUNTIME = "daemon";
  process.env.JARVIS_CODEX_DAEMON_ENABLED = "true";
  try {
    _setCodexOAuthDaemonBridgeForTesting({
      isDesktopDaemonActive: (userId) => userId === "user-1",
      isDaemonActionAllowed: async () => false,
      sendDaemonOp: async () => ({ ok: true, data: { content: "" } }),
    });
    const status = await getCodexOAuthRuntimeStatus("user-1");
    assert.equal(status.available, false);
    assert.equal(status.selectedRuntime, "daemon");
    assert.equal(status.daemonActive, true);
    assert.equal(status.daemonShellAllowed, false);
    assert.match(status.reason, /Shell Execution/);
  } finally {
    _setCodexOAuthDaemonBridgeForTesting(null);
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousToken == null) delete process.env.JARVIS_CODEX_GATEWAY_TOKEN;
    else process.env.JARVIS_CODEX_GATEWAY_TOKEN = previousToken;
    if (previousRuntime == null) delete process.env.JARVIS_CODEX_RUNTIME;
    else process.env.JARVIS_CODEX_RUNTIME = previousRuntime;
    if (previousDaemonEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_ENABLED = previousDaemonEnabled;
  }
  console.log("OK: Codex OAuth runtime status reports connected daemons without Shell Execution as unavailable");
}

{
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousToken = process.env.JARVIS_CODEX_GATEWAY_TOKEN;
  const previousRuntime = process.env.JARVIS_CODEX_RUNTIME;
  const previousDaemonEnabled = process.env.JARVIS_CODEX_DAEMON_ENABLED;
  delete process.env.JARVIS_CODEX_GATEWAY_URL;
  delete process.env.JARVIS_CODEX_GATEWAY_TOKEN;
  process.env.JARVIS_CODEX_RUNTIME = "daemon";
  process.env.JARVIS_CODEX_DAEMON_ENABLED = "true";
  try {
    _setCodexOAuthDaemonBridgeForTesting({
      isDesktopDaemonActive: (userId) => userId === "user-1",
      isDaemonActionAllowed: async (userId, action) => userId === "user-1" && action === "shell",
      sendDaemonOp: async () => ({ ok: true, data: { content: "" } }),
    });
    const status = await getCodexOAuthRuntimeStatus("user-1");
    assert.equal(status.available, true);
    assert.equal(status.selectedRuntime, "daemon");
    assert.equal(status.daemonActive, true);
    assert.equal(status.daemonShellAllowed, true);
    assert.equal(status.resolvedUserId, "user-1");
  } finally {
    _setCodexOAuthDaemonBridgeForTesting(null);
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousToken == null) delete process.env.JARVIS_CODEX_GATEWAY_TOKEN;
    else process.env.JARVIS_CODEX_GATEWAY_TOKEN = previousToken;
    if (previousRuntime == null) delete process.env.JARVIS_CODEX_RUNTIME;
    else process.env.JARVIS_CODEX_RUNTIME = previousRuntime;
    if (previousDaemonEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_ENABLED = previousDaemonEnabled;
  }
  console.log("OK: Codex OAuth runtime status reports active daemon Shell Execution as available");
}

{
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousDaemonEnabled = process.env.JARVIS_CODEX_DAEMON_ENABLED;
  const previousRuntime = process.env.JARVIS_CODEX_RUNTIME;
  const previousAppServerEnabled = process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
  delete process.env.JARVIS_CODEX_GATEWAY_URL;
  process.env.JARVIS_CODEX_RUNTIME = "daemon";
  process.env.JARVIS_CODEX_DAEMON_ENABLED = "true";
  delete process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
  try {
    let observedOpType = "";
    _setCodexOAuthDaemonBridgeForTesting({
      isDesktopDaemonActive: (userId) => userId === "user-1",
      isDaemonActionAllowed: async (userId, action) => userId === "user-1" && action === "shell",
      sendDaemonOp: async (_userId, op) => {
        observedOpType = op.type;
        return { ok: true, data: { content: `{"type":"final","content":"Cold daemon by default."}` } };
      },
    });

    const provider = new CodexOAuthProvider();
    const chunks = [];
    for await (const chunk of provider.query({
      model: "chatgpt-codex-oauth/auto",
      messages: [{ role: "user", content: "Hello with default daemon mode" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      stream: false,
      userId: "user-1",
    })) {
      chunks.push(chunk);
    }

    assert.equal(observedOpType, "codex_oauth_prompt");
    assert.deepEqual(chunks, [
      { type: "text", delta: "Cold daemon by default." },
      { type: "finish", reason: "stop" },
    ]);
  } finally {
    _setCodexOAuthDaemonBridgeForTesting(null);
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousRuntime == null) delete process.env.JARVIS_CODEX_RUNTIME;
    else process.env.JARVIS_CODEX_RUNTIME = previousRuntime;
    if (previousDaemonEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_ENABLED = previousDaemonEnabled;
    if (previousAppServerEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED = previousAppServerEnabled;
  }
  console.log("OK: Codex OAuth provider uses the stable daemon prompt by default");
}

{
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousDaemonEnabled = process.env.JARVIS_CODEX_DAEMON_ENABLED;
  const previousRuntime = process.env.JARVIS_CODEX_RUNTIME;
  const previousAppServerEnabled = process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
  delete process.env.JARVIS_CODEX_GATEWAY_URL;
  process.env.JARVIS_CODEX_RUNTIME = "daemon";
  process.env.JARVIS_CODEX_DAEMON_ENABLED = "true";
  delete process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
  try {
    _setCodexOAuthDaemonBridgeForTesting({
      isDesktopDaemonActive: (userId) => userId === "user-1",
      isDaemonActionAllowed: async (userId, action) => userId === "user-1" && action === "shell",
      sendDaemonOp: async () => ({ ok: false, error: "daemon disconnected" }),
    });

    const provider = new CodexOAuthProvider();
    await assert.rejects(
      async () => {
        for await (const _chunk of provider.query({
          model: "chatgpt-codex-oauth/auto",
          messages: [{ role: "user", content: "Hello with disconnect" }],
          toolChoice: "none",
          maxCompletionTokens: 64,
          stream: false,
          userId: "user-1",
        })) {
          // exhaust generator
        }
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /runtime was selected but the request failed/);
        assert.match(message, /daemon disconnected/);
        assert.doesNotMatch(message, /no available runtime/);
        assert.doesNotMatch(message, /No action required/);
        return true;
      },
    );
  } finally {
    _setCodexOAuthDaemonBridgeForTesting(null);
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousRuntime == null) delete process.env.JARVIS_CODEX_RUNTIME;
    else process.env.JARVIS_CODEX_RUNTIME = previousRuntime;
    if (previousDaemonEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_ENABLED = previousDaemonEnabled;
    if (previousAppServerEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED = previousAppServerEnabled;
  }
  console.log("OK: Codex OAuth daemon disconnect failures do not reuse missing-runtime copy");
}

{
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousDaemonEnabled = process.env.JARVIS_CODEX_DAEMON_ENABLED;
  const previousRuntime = process.env.JARVIS_CODEX_RUNTIME;
  const previousCommand = process.env.JARVIS_CODEX_COMMAND;
  const previousLegacyCommand = process.env.CODEX_COMMAND;
  const previousAppServerEnabled = process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
  process.env.JARVIS_CODEX_GATEWAY_URL = "https://gateway.example.test";
  process.env.JARVIS_CODEX_RUNTIME = "daemon";
  process.env.JARVIS_CODEX_DAEMON_ENABLED = "true";
  process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED = "false";
  process.env.JARVIS_CODEX_COMMAND = "codex";
  delete process.env.CODEX_COMMAND;
  try {
    let observedPrompt = "";
    _setCodexOAuthDaemonBridgeForTesting({
      isDesktopDaemonActive: (userId) => userId === "user-1",
      isDaemonActionAllowed: async (userId, action) => userId === "user-1" && action === "shell",
      sendDaemonOp: async (userId, op) => {
        assert.equal(userId, "user-1");
        assert.equal(op.type, "codex_oauth_prompt");
        assert.equal(op.command, "codex");
        observedPrompt = op.prompt;
        return { ok: true, data: { content: `{"type":"final","content":"Daemon pong."}` } };
      },
    });

    const provider = new CodexOAuthProvider();
    const chunks = [];
    for await (const chunk of provider.query({
      model: "chatgpt-codex-oauth/auto",
      messages: [{ role: "user", content: "Hello from daemon" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      stream: false,
      userId: "user-1",
    })) {
      chunks.push(chunk);
    }

    assert.match(observedPrompt, /Hello from daemon/);
    assert.deepEqual(chunks, [
      { type: "text", delta: "Daemon pong." },
      { type: "finish", reason: "stop" },
    ]);
  } finally {
    _setCodexOAuthDaemonBridgeForTesting(null);
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousRuntime == null) delete process.env.JARVIS_CODEX_RUNTIME;
    else process.env.JARVIS_CODEX_RUNTIME = previousRuntime;
    if (previousDaemonEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_ENABLED = previousDaemonEnabled;
    if (previousCommand == null) delete process.env.JARVIS_CODEX_COMMAND;
    else process.env.JARVIS_CODEX_COMMAND = previousCommand;
    if (previousLegacyCommand == null) delete process.env.CODEX_COMMAND;
    else process.env.CODEX_COMMAND = previousLegacyCommand;
    if (previousAppServerEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED = previousAppServerEnabled;
  }
  console.log("OK: Codex OAuth provider can force the user-scoped desktop daemon runtime");
}

{
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousDaemonEnabled = process.env.JARVIS_CODEX_DAEMON_ENABLED;
  const previousRuntime = process.env.JARVIS_CODEX_RUNTIME;
  const previousAppServerEnabled = process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
  process.env.JARVIS_CODEX_GATEWAY_URL = "https://gateway.example.test";
  process.env.JARVIS_CODEX_RUNTIME = "daemon";
  process.env.JARVIS_CODEX_DAEMON_ENABLED = "true";
  process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED = "true";
  try {
    let observedOpType = "";
    _setCodexOAuthDaemonBridgeForTesting({
      isDesktopDaemonActive: (userId) => userId === "user-1",
      isDaemonActionAllowed: async (userId, action) => userId === "user-1" && action === "shell",
      sendDaemonOp: async (userId, op) => {
        assert.equal(userId, "user-1");
        observedOpType = op.type;
        assert.equal(op.type, "codex_oauth_app_server_prompt");
        return { ok: true, data: { content: `{"type":"final","content":"Warm daemon pong."}` } };
      },
    });

    const provider = new CodexOAuthProvider();
    const chunks = [];
    for await (const chunk of provider.query({
      model: "chatgpt-codex-oauth/auto",
      messages: [{ role: "user", content: "Hello from warm daemon" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      stream: false,
      userId: "user-1",
    })) {
      chunks.push(chunk);
    }

    assert.equal(observedOpType, "codex_oauth_app_server_prompt");
    assert.deepEqual(chunks, [
      { type: "text", delta: "Warm daemon pong." },
      { type: "finish", reason: "stop" },
    ]);
  } finally {
    _setCodexOAuthDaemonBridgeForTesting(null);
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousRuntime == null) delete process.env.JARVIS_CODEX_RUNTIME;
    else process.env.JARVIS_CODEX_RUNTIME = previousRuntime;
    if (previousDaemonEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_ENABLED = previousDaemonEnabled;
    if (previousAppServerEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED = previousAppServerEnabled;
  }
  console.log("OK: Codex OAuth provider prefers the warm desktop app-server daemon runtime");
}

{
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousDaemonEnabled = process.env.JARVIS_CODEX_DAEMON_ENABLED;
  const previousRuntime = process.env.JARVIS_CODEX_RUNTIME;
  const previousAppServerEnabled = process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
  process.env.JARVIS_CODEX_GATEWAY_URL = "https://gateway.example.test";
  process.env.JARVIS_CODEX_RUNTIME = "daemon";
  process.env.JARVIS_CODEX_DAEMON_ENABLED = "true";
  process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED = "false";
  try {
    let selectedUserId = "";
    _setCodexOAuthDaemonBridgeForTesting({
      listPairedUsers: () => ["user-1", "user-2"],
      isDesktopDaemonActive: (userId) => userId === "user-1",
      isDaemonActionAllowed: async (userId, action) => userId === "user-1" && action === "shell",
      sendDaemonOp: async (userId, op) => {
        selectedUserId = userId;
        assert.equal(op.type, "codex_oauth_prompt");
        return { ok: true, data: { content: `{"type":"final","content":"Singleton daemon pong."}` } };
      },
    });

    const provider = new CodexOAuthProvider();
    const chunks = [];
    for await (const chunk of provider.query({
      model: "chatgpt-codex-oauth/auto",
      messages: [{ role: "user", content: "Hello without user id" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      stream: false,
    })) {
      chunks.push(chunk);
    }

    assert.equal(selectedUserId, "user-1");
    assert.deepEqual(chunks, [
      { type: "text", delta: "Singleton daemon pong." },
      { type: "finish", reason: "stop" },
    ]);
  } finally {
    _setCodexOAuthDaemonBridgeForTesting(null);
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousRuntime == null) delete process.env.JARVIS_CODEX_RUNTIME;
    else process.env.JARVIS_CODEX_RUNTIME = previousRuntime;
    if (previousDaemonEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_ENABLED = previousDaemonEnabled;
    if (previousAppServerEnabled == null) delete process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED;
    else process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED = previousAppServerEnabled;
  }
  console.log("OK: Codex OAuth provider uses the single active desktop daemon when route userId is absent");
}

console.log("\nAll Codex OAuth provider assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
