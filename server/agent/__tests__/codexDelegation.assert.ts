import assert from "node:assert/strict";
import {
  _setCodexDelegationRunnerForTest,
  buildCodexDelegationPrompt,
  isCodexDelegationEnabled,
  resolveCodexDelegationCwd,
  runCodexDelegation,
} from "../codexDelegation";

async function main(): Promise<void> {
  {
  const prompt = buildCodexDelegationPrompt({
    task: "Use Codex-side tools to summarize the current GitHub PR status.",
    context: "The user wants a read-only summary.",
    allowExternalSideEffects: false,
  });

  assert.match(prompt, /Use Codex-side tools to summarize the current GitHub PR status\./);
  assert.match(prompt, /The user wants a read-only summary\./);
  assert.match(prompt, /Do not send, post, delete, purchase, deploy, merge, commit, or mutate external systems/i);
  console.log("OK: Codex delegation prompt carries task, context, and read-only side-effect boundary");
  }

  {
  const projectRoot = process.cwd();
  assert.equal(resolveCodexDelegationCwd(undefined), projectRoot);
  assert.equal(resolveCodexDelegationCwd("server").startsWith(projectRoot), true);
  assert.throws(() => resolveCodexDelegationCwd(".."), /outside the Jarvis workspace/);
  console.log("OK: Codex delegation cwd is scoped to the Jarvis workspace");
  }

  {
  const previousUrl = process.env.JARVIS_CODEX_GATEWAY_URL;
  const previousToken = process.env.JARVIS_CODEX_GATEWAY_TOKEN;
  const previousEnabled = process.env.JARVIS_CODEX_OAUTH_ENABLED;
  delete process.env.JARVIS_CODEX_OAUTH_ENABLED;
  process.env.JARVIS_CODEX_GATEWAY_URL = "https://codex-gateway.example.test/";
  process.env.JARVIS_CODEX_GATEWAY_TOKEN = "secret-token";

  let seenUrl = "";
  let seenAuth = "";
  let seenBody: any = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(url);
    seenAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({
      content: "remote gateway ok",
      cwd: "/gateway/workspace",
      sandbox: "read-only",
      durationMs: 5,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    assert.equal(isCodexDelegationEnabled(), true);
    const result = await runCodexDelegation({
      task: "Check Codex gateway wiring.",
      cwd: process.cwd(),
      sandbox: "read-only",
      timeoutMs: 10_000,
    });
    assert.equal(result.content, "remote gateway ok");
    assert.equal(seenUrl, "https://codex-gateway.example.test/api/codex/delegate");
    assert.equal(seenAuth, "Bearer secret-token");
    assert.equal(seenBody.task, "Check Codex gateway wiring.");
    assert.equal(seenBody.sandbox, "read-only");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl == null) delete process.env.JARVIS_CODEX_GATEWAY_URL;
    else process.env.JARVIS_CODEX_GATEWAY_URL = previousUrl;
    if (previousToken == null) delete process.env.JARVIS_CODEX_GATEWAY_TOKEN;
    else process.env.JARVIS_CODEX_GATEWAY_TOKEN = previousToken;
    if (previousEnabled == null) delete process.env.JARVIS_CODEX_OAUTH_ENABLED;
    else process.env.JARVIS_CODEX_OAUTH_ENABLED = previousEnabled;
  }
  console.log("OK: Codex delegation can route through a remote OAuth gateway");
  }

  {
  process.env.DATABASE_URL ||= "postgresql://jarvis_test:jarvis_test@localhost:5432/jarvis_test";
  const { delegateToCodexTool } = await import("../tools/delegateToCodex");
  const { _setOwnerIdForTest } = await import("../../integrationOwner");

  let called = false;
  _setOwnerIdForTest("owner-user");
  _setCodexDelegationRunnerForTest(async () => {
    called = true;
    return {
      content: "should not run",
      cwd: process.cwd(),
      sandbox: "read-only",
      durationMs: 1,
    };
  });

  const result = await delegateToCodexTool.execute(
    { task: "Summarize my connected tools" },
    { userId: "not-owner", state: {}, channel: "test" },
  );

  assert.equal(result.ok, false);
  assert.equal(called, false);
  assert.match(result.content, /only the account owner/i);
  _setOwnerIdForTest(null);
  _setCodexDelegationRunnerForTest(null);
  console.log("OK: Codex delegation tool is owner-gated");
  }

  {
  process.env.DATABASE_URL ||= "postgresql://jarvis_test:jarvis_test@localhost:5432/jarvis_test";
  const { delegateToCodexTool } = await import("../tools/delegateToCodex");
  const { _setOwnerIdForTest } = await import("../../integrationOwner");

  let seen:
    | {
        task: string;
        context?: string;
        sandbox: "read-only" | "workspace-write";
        cwd: string;
        timeoutMs: number;
        allowExternalSideEffects?: boolean;
      }
    | undefined;

  _setOwnerIdForTest("owner-user");
  _setCodexDelegationRunnerForTest(async (request) => {
    seen = request;
    return {
      content: "Codex returned a scoped answer.",
      cwd: request.cwd,
      sandbox: request.sandbox,
      durationMs: 12,
    };
  });

  const result = await delegateToCodexTool.execute(
    {
      task: "Ask Codex which MCP servers are useful for this request.",
      context: "Keep it read-only.",
      sandbox: "read-only",
      timeout_seconds: 30,
    },
    { userId: "owner-user", state: {}, channel: "test" },
  );

  assert.equal(result.ok, true);
  assert.match(result.content, /Codex returned a scoped answer\./);
  assert.equal(seen?.task, "Ask Codex which MCP servers are useful for this request.");
  assert.equal(seen?.context, "Keep it read-only.");
  assert.equal(seen?.sandbox, "read-only");
  assert.equal(seen?.timeoutMs, 30_000);
  assert.equal(seen?.allowExternalSideEffects, false);
  _setOwnerIdForTest(null);
  _setCodexDelegationRunnerForTest(null);
  console.log("OK: Codex delegation tool forwards normalized requests to the runner");
  }

  console.log("\nAll Codex delegation assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
