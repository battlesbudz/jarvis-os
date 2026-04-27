/**
 * Harness-level assertions for integration-error classification.
 *
 * Run with:  npx tsx server/agent/__tests__/integrationError.assert.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 *
 * These tests invoke the REAL `runAgent` from harness.ts with:
 *   - A fake OpenAI HTTP server (avoids real API calls)
 *   - Integration deps injected via _testOnlyIntegrationDeps (avoids the real
 *     capabilities/index dynamic import, which has a circular-dependency TDZ
 *     issue in test contexts where modules load in a different order than prod)
 *   - No context.userId (exercises the no-userId / background-run path)
 *
 * Covers the task #355 fix: toolToIntegrationKey is built unconditionally so
 * integration auth failures are classified even in headless runs without a userId.
 *
 * Tests:
 *   A. Tool throw with auth signal (no userId) → onIntegrationError fires
 *   B. Tool ok=false with auth signal (no userId) → onIntegrationError fires
 *   C. Tool throw with non-auth signal (no userId) → onIntegrationError NOT fired
 *   D. Auth error from tool unknown to registry → onIntegrationError NOT fired
 *   E. Multi-provider tool with google provider hint → 'google' key
 *   F. Multi-provider tool without provider hint → null (suppress misattribution)
 */

// ── IMPORTANT: env vars must be set BEFORE the harness module is loaded.
// The harness creates the OpenAI client at module level, so the baseURL must
// be set before the first import of harness.ts.
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-harness-key";

import assert from "node:assert/strict";
import http from "node:http";
import type { AgentTool, ToolContext } from "../types";

// ── Stubbed integration deps ───────────────────────────────────────────────────
// Passed to runAgent via _testOnlyIntegrationDeps so the harness builds
// toolToIntegrationKey without importing capabilities/index (which fails in
// test context due to circular dependency: subagents.ts → tools.ts →
// spawnSubagent.ts → subagents.ts TDZ).
//
//   discord_post → discord  (single-provider, unambiguous)
//   fetch_emails → google | outlook  (multi-provider, needs provider hint)
//   send_email   → google | outlook  (multi-provider, needs provider hint)

const TEST_INTEGRATION_DEPS = {
  discord: { label: "Discord", toolNames: ["discord_post"] },
  google:  { label: "Google",  toolNames: ["fetch_emails", "send_email"] },
  outlook: { label: "Outlook", toolNames: ["fetch_emails", "send_email"] },
};

// ── Fake OpenAI HTTP server ───────────────────────────────────────────────────
// A single server handles all test cases via a response queue.
// Each test case enqueues [tool-call response, text-reply response] before
// calling runAgent. The server dequeues one response per request.
//
// This design is required because the harness creates the OpenAI client at
// module level (reading process.env.AI_INTEGRATIONS_OPENAI_BASE_URL once).
// Using a single server means the URL is stable after the harness imports.

type ResponseFactory = () => object;
const responseQueue: ResponseFactory[] = [];

function enqueueToolCallThenText(toolName: string, toolArgs: object = {}) {
  responseQueue.push(() => ({
    id: "chatcmpl-test-tool",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_test_1",
              type: "function",
              function: { name: toolName, arguments: JSON.stringify(toolArgs) },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));

  responseQueue.push(() => ({
    id: "chatcmpl-test-text",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Done." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
  }));
}

(async () => {
  // ── Boot: start fake server, set env, import harness ─────────────────────
  const fakeServer = http.createServer((_req, res) => {
    const factory = responseQueue.shift();
    const body = factory
      ? factory()
      : {
          id: "chatcmpl-fallback",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Done." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => fakeServer.listen(0, "127.0.0.1", resolve));
  const port = (fakeServer.address() as { port: number }).port;

  // Set baseURL BEFORE importing the harness so the OpenAI module-level client
  // is created pointing at the fake server.
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://localhost:${port}/v1`;

  const { runAgent } = await import("../harness");

  // ── Helper ────────────────────────────────────────────────────────────────
  async function callRunAgent(tool: AgentTool): Promise<string | null> {
    let integrationErrorKey: string | null = null;

    const context: ToolContext = { channel: "test" } as ToolContext; // no userId

    await runAgent({
      messages: [{ role: "user", content: "do something" }],
      tools: [tool],
      context,
      _testOnlyIntegrationDeps: TEST_INTEGRATION_DEPS,
      onIntegrationError: (key) => {
        integrationErrorKey = key;
      },
    });

    return integrationErrorKey;
  }

  // ── Test A: Tool throw with auth signal (no userId) → onIntegrationError fires ──
  // This pins the task #355 fix: toolToIntegrationKey is built unconditionally
  // so auth errors are classified even when context.userId is absent.
  {
    enqueueToolCallThenText("discord_post");
    let capturedMsg = "";

    const tool: AgentTool = {
      name: "discord_post",
      description: "Test tool",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        throw new Error("401 Unauthorized — Discord token revoked");
      },
    };

    let integrationErrorKey: string | null = null;
    const context: ToolContext = { channel: "test" } as ToolContext;

    await runAgent({
      messages: [{ role: "user", content: "do something" }],
      tools: [tool],
      context,
      _testOnlyIntegrationDeps: TEST_INTEGRATION_DEPS,
      onIntegrationError: (key, msg) => {
        integrationErrorKey = key;
        capturedMsg = msg;
      },
    });

    assert.equal(
      integrationErrorKey,
      "discord",
      "A: tool throw + auth signal (no userId) → onIntegrationError fires with 'discord'",
    );
    assert.ok(capturedMsg.includes("401"), "A: error message forwarded to onIntegrationError");
    console.log("✓ A: tool throw + auth signal (no userId) → onIntegrationError fires with correct key");
  }

  // ── Test B: ok=false with auth signal (no userId) → onIntegrationError fires ──
  {
    enqueueToolCallThenText("discord_post");

    const key = await callRunAgent({
      name: "discord_post",
      description: "Test tool",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => ({
        ok: false,
        content: "403 Forbidden — Discord credentials revoked",
        label: "discord_post",
      }),
    });

    assert.equal(key, "discord", "B: tool ok=false + auth signal (no userId) → 'discord'");
    console.log("✓ B: tool ok=false + auth signal (no userId) → onIntegrationError fires with correct key");
  }

  // ── Test C: Tool throw with non-auth signal → onIntegrationError NOT fired ──
  {
    enqueueToolCallThenText("discord_post");

    const key = await callRunAgent({
      name: "discord_post",
      description: "Test tool",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        throw new Error("network timeout after 30s");
      },
    });

    assert.equal(key, null, "C: non-auth tool throw (network timeout) → onIntegrationError NOT fired");
    console.log("✓ C: non-auth error (network timeout) → onIntegrationError NOT fired");
  }

  // ── Test D: Auth error from tool not in registry → onIntegrationError NOT fired ──
  {
    enqueueToolCallThenText("browse_web");

    const key = await callRunAgent({
      name: "browse_web",  // not in TEST_INTEGRATION_DEPS → no candidate
      description: "Test tool",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        throw new Error("401 Unauthorized");
      },
    });

    assert.equal(key, null, "D: auth error from unmapped tool → onIntegrationError NOT fired");
    console.log("✓ D: auth error from unmapped tool → onIntegrationError NOT fired");
  }

  // ── Test E: Multi-provider tool with google provider hint → 'google' key ─────
  // fetch_emails maps to both google and outlook; a Google-specific error message
  // should resolve to 'google' via the provider-hint disambiguation.
  {
    enqueueToolCallThenText("fetch_emails");

    const key = await callRunAgent({
      name: "fetch_emails",
      description: "Test tool",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        throw new Error("Google OAuth token expired — invalid_grant");
      },
    });

    assert.equal(key, "google", "E: multi-provider tool + google hint → 'google' key");
    console.log("✓ E: multi-provider tool with google provider hint → correct 'google' key");
  }

  // ── Test F: Multi-provider tool without provider hint → no misattribution ────
  // An ambiguous error (no google/outlook/microsoft keywords) must return null
  // rather than guessing the first candidate and sending the user to the wrong
  // reconnect flow.
  {
    enqueueToolCallThenText("fetch_emails");

    const key = await callRunAgent({
      name: "fetch_emails",
      description: "Test tool",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        throw new Error("authentication failed — token expired");  // no provider hint
      },
    });

    assert.equal(key, null, "F: multi-provider tool without provider hint → null (suppress misattribution)");
    console.log("✓ F: multi-provider tool without provider hint → no misattribution (null)");
  }

  fakeServer.close();
  console.log("\nAll harness-level integration-error assertions passed.");
})().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
