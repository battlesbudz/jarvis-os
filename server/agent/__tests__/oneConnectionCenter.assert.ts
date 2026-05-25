import assert from "node:assert/strict";
import {
  buildOneConnectIntent,
  buildOneStatusResponse,
  buildOneTestResponse,
  classifyOneActionPermission,
} from "../../oneConnectionCenter";
import { oneExecuteActionTool } from "../tools/oneCliActions";

const readyStatus = {
  apiKeyConfigured: true,
  apiKeyPreview: "one_sk_...abcd",
  installed: true,
  authenticated: true,
  ready: true,
  command: "one",
  dashboardUrl: "https://app.withone.ai",
  accountEmail: "justin@example.com",
  accountName: "Justin",
  configScope: "user",
  apiBase: "https://api.withone.ai",
  connections: [
    { platform: "gmail", state: "operational", keyPreview: "gmail...123", accountEmail: "justin@example.com" },
    { platform: "slack", state: "needs_reauth", keyPreview: "slack...456", accountName: "Jarvis HQ" },
  ],
  nextSteps: ["You are ready to use connected accounts."],
  error: null,
};

const formattedStatus = buildOneStatusResponse(readyStatus);
assert.equal(formattedStatus.installed, true);
assert.equal(formattedStatus.authenticated, true);
assert.equal(formattedStatus.ready, true);
assert.equal(formattedStatus.apiKeyPreview, "one_sk_...abcd");
assert.equal(formattedStatus.accountEmail, "justin@example.com");
assert.deepEqual(formattedStatus.connections.map((connection) => connection.platform), ["gmail", "slack"]);
assert.deepEqual(formattedStatus.nextSteps, ["You are ready to use connected accounts."]);
console.log("OK: One status response preserves setup status in a user-facing shape");

const connectIntent = buildOneConnectIntent("gmail", readyStatus);
assert.equal(connectIntent.platform, "gmail");
assert.equal(connectIntent.label, "Gmail");
assert.equal(connectIntent.recommendedAction, "Developer fallback for Gmail");
assert.ok(connectIntent.dashboardUrl?.startsWith("https://app.withone.ai/"));
assert.equal(new URL(connectIntent.dashboardUrl!).searchParams.get("connection"), "gmail");
assert.equal(connectIntent.cliFallbackCommand, "one add gmail");
assert.match(connectIntent.setupInstructions.join("\n"), /Developer fallback only/);
console.log("OK: One connect intent keeps CLI commands in developer fallback copy");

assert.equal(classifyOneActionPermission("gmail", "messages.list").approvalRequired, false);
assert.equal(classifyOneActionPermission("gmail", "draft.create").approvalRequired, true);
assert.equal(classifyOneActionPermission("gmail", "messages.send").approvalRequired, true);
assert.equal(classifyOneActionPermission("google-calendar", "events.update").approvalRequired, true);
console.log("OK: One action permission classification separates reads from risky writes");

const testResponse = buildOneTestResponse({
  ...readyStatus,
  connections: [
    { platform: "gmail", state: "operational", keyPreview: "gmail...123" },
    { platform: "outlook-mail", state: "error", keyPreview: "outlook...999" },
  ],
});
assert.equal(testResponse.ok, false);
assert.equal(testResponse.results[0].ok, true);
assert.equal(testResponse.results[1].ok, false);
assert.match(testResponse.summary, /1 of 2 connected accounts are ready/);
console.log("OK: One test response turns connection states into human pass/fail results");

async function main(): Promise<void> {
  let executed = false;
  const riskyResult = await oneExecuteActionTool.execute({
    platform: "gmail",
    action_id: "messages.send",
    connection_key: "gmail-key",
    data: { to: "friend@example.com", subject: "Hello" },
    _approved: false,
    _runOneCliForTest: () => {
      executed = true;
      return { ok: true, command: "one actions execute", stdout: "{}", stderr: "", status: 0 };
    },
  });

  assert.equal(riskyResult.ok, false);
  assert.equal(executed, false);
  assert.match(riskyResult.content, /approval/i);
  console.log("OK: one_execute_action blocks risky writes without approval");

  console.log("\nAll One Connection Center assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
