import assert from "node:assert/strict";
import {
  buildOneActionSearchUrl,
  createOneApiClient,
  maskOneApiKey,
  type OneApiFetch,
} from "../../oneApiConnection";
import {
  buildOneStatusResponse,
  buildOneTestResponse,
  classifyOneActionPermission,
} from "../../oneConnectionCenter";
import { oneExecuteActionTool, oneSearchActionsTool } from "../tools/oneCliActions";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

assert.equal(maskOneApiKey("one_sk_1234567890abcdef"), "one_sk_...cdef");
assert.equal(maskOneApiKey("short"), "sh...5");
assert.ok(!maskOneApiKey("one_sk_1234567890abcdef").includes("1234567890"));
console.log("OK: One API key previews are masked");

const searchUrl = new URL(buildOneActionSearchUrl("gmail", "recent unread"));
assert.equal(searchUrl.origin + searchUrl.pathname, "https://api.withone.ai/v1/available-actions/search/gmail");
assert.equal(searchUrl.searchParams.get("query"), "recent unread");
assert.equal(searchUrl.searchParams.get("includeKnowledge"), "true");
console.log("OK: One action search URL includes query and knowledge");

const calls: { url: string; init?: RequestInit }[] = [];
const fetchImpl: OneApiFetch = async (input, init) => {
  calls.push({ url: String(input), init });
  if (String(input).endsWith("/v1/vault/connections")) {
    return jsonResponse({ connections: [{ platform: "gmail", accountEmail: "justin@example.com", key: "gmail_123" }] });
  }
  if (String(input).includes("/v1/available-actions/search/gmail")) {
    return jsonResponse({ actions: [{ id: "messages.list", name: "List messages", knowledge: "Read inbox" }] });
  }
  if (String(input).endsWith("/v1/passthrough/gmail_123")) {
    return jsonResponse({ ok: true, result: { id: "m_1" } });
  }
  return jsonResponse({ ok: true });
};

async function main(): Promise<void> {
  const client = createOneApiClient("one_sk_test_secret", fetchImpl);
  const connections = await client.listConnections();
  assert.equal(connections.ok, true);
  assert.equal(calls[0].url, "https://api.withone.ai/v1/vault/connections");
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-one-secret"], "one_sk_test_secret");
  assert.deepEqual(connections.connections.map((connection) => connection.platform), ["gmail"]);
  console.log("OK: One API connection listing uses x-one-secret");

  const paginatedClient = createOneApiClient("one_sk_test_secret", async (input) => {
    if (String(input).endsWith("/v1/vault/connections")) {
      return jsonResponse({
        rows: [
          {
            platform: "outlook-mail",
            key: "live::outlook-mail::default::abc123",
            state: "operational",
          },
        ],
        total: 1,
        pages: 1,
        page: 1,
      });
    }
    return jsonResponse({ rows: [] });
  });
  const paginatedConnections = await paginatedClient.listConnections();
  assert.equal(paginatedConnections.ok, true);
  assert.deepEqual(paginatedConnections.connections.map((connection) => connection.platform), ["outlook-mail"]);
  assert.equal(paginatedConnections.connections[0].state, "operational");
  console.log("OK: One API paginated rows are parsed as connections");

  await client.searchActions("gmail", "recent unread");
  assert.ok(calls.some((call) => call.url.includes("/v1/available-actions/search/gmail?")));
  assert.ok(calls.some((call) => new URL(call.url).searchParams.get("includeKnowledge") === "true"));
  console.log("OK: One API action search calls the documented endpoint");

const status = buildOneStatusResponse({
  apiKeyConfigured: true,
  apiKeyPreview: "one_sk_...cret",
  installed: true,
  authenticated: true,
  ready: true,
  command: "one",
  dashboardUrl: "https://app.withone.ai",
  accountEmail: "justin@example.com",
  accountName: null,
  connections: [{ platform: "gmail", accountEmail: "justin@example.com", keyPreview: "gmail...123", state: "operational" }],
  nextSteps: ["Jarvis can access 1 One connected account."],
  error: null,
});
assert.equal(status.apiKeyConfigured, true);
assert.equal(status.apiKeyPreview, "one_sk_...cret");
assert.equal(status.ready, true);
assert.equal(status.connections[0].accountEmail, "justin@example.com");
console.log("OK: One API status formatting preserves masked key and connections");

const testResponse = buildOneTestResponse(status);
assert.equal(testResponse.ok, true);
assert.match(testResponse.summary, /1 of 1 connected accounts are ready/);
console.log("OK: One API test response is human-readable");

assert.equal(classifyOneActionPermission("gmail", "messages.list").approvalRequired, false);
assert.equal(classifyOneActionPermission("gmail", "messages.search").approvalRequired, false);
assert.equal(classifyOneActionPermission("gmail", "messages.send").approvalRequired, true);
assert.equal(classifyOneActionPermission("gmail", "message.delete").approvalRequired, true);
assert.equal(classifyOneActionPermission("slack", "chat.postMessage").approvalRequired, true);
assert.equal(classifyOneActionPermission("google-calendar", "calendar.events.update").approvalRequired, true);
console.log("OK: One permission classifier allows reads and gates writes");

  let passthroughCalled = false;
  const riskyResult = await oneExecuteActionTool.execute({
    platform: "gmail",
    action_id: "messages.send",
    connection_key: "gmail_123",
    data: { to: "friend@example.com", subject: "Hello" },
    _oneApiKeyForTest: "one_sk_test_secret",
    _oneApiFetchForTest: async () => {
      passthroughCalled = true;
      return jsonResponse({ ok: true });
    },
  }, { userId: "user_1", state: {} });
  assert.equal(riskyResult.ok, false);
  assert.equal(passthroughCalled, false);
  assert.match(riskyResult.content, /approval/i);
  console.log("OK: one_execute_action blocks risky API writes without approval");

  const searchToolResult = await oneSearchActionsTool.execute({
    platform: "gmail",
    query: "recent unread",
    _oneApiKeyForTest: "one_sk_test_secret",
    _oneApiFetchForTest: fetchImpl,
  }, { userId: "user_1", state: {} });
  assert.equal(searchToolResult.ok, true);
  assert.match(searchToolResult.content, /messages\.list/);
  console.log("OK: One tools prefer the saved API-key path when available");

  console.log("\nAll One API Connection Center assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
