import assert from "node:assert/strict";
import {
  buildOneActionSearchUrl,
  buildOnePassthroughRequest,
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
assert.equal(searchUrl.searchParams.get("executeAgent"), "true");
console.log("OK: One action search URL includes query and knowledge");

const calls: { url: string; init?: RequestInit }[] = [];
const fetchImpl: OneApiFetch = async (input, init) => {
  calls.push({ url: String(input), init });
  if (String(input).endsWith("/v1/vault/connections")) {
    return jsonResponse({ connections: [{ platform: "gmail", accountEmail: "justin@example.com", key: "gmail_123" }] });
  }
  if (String(input).includes("/v1/available-actions/search/gmail")) {
    return jsonResponse([
      {
        systemId: "conn_mod_def::messages-list",
        key: "api::gmail::v1::messages::list",
        title: "List a User's Gmail Messages",
        method: "GET",
        path: "/gmail/v1/users/{{userId}}/messages",
        knowledge: "Read inbox",
      },
    ]);
  }
  if (String(input).includes("/v1/knowledge")) {
    return jsonResponse({
      rows: [
        {
          _id: "conn_mod_def::messages-send",
          title: "Send a User's Gmail Message",
          method: "POST",
          path: "/gmail/v1/users/{{userId}}/messages/send",
        },
      ],
    });
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
  const actionSearch = await client.searchActions("gmail", "list messages");
  assert.equal(actionSearch.actions.length, 1);
  assert.equal((actionSearch.actions[0] as { systemId?: string }).systemId, "conn_mod_def::messages-list");
  console.log("OK: One API action search handles One's top-level array response");

  const draftPassthrough = buildOnePassthroughRequest({
    action: {
      _id: "conn_mod_def::draft-create",
      title: "Create a User's Draft",
      method: "POST",
      path: "/gmail/v1/users/{{userId}}/drafts",
    },
    connectionKey: "live::gmail::default::abc123",
    data: { to: "friend@example.com", subject: "Hello", body: "Friendly test" },
    baseUrl: "https://api.withone.ai",
  });
  assert.equal(draftPassthrough.url, "https://api.withone.ai/v1/passthrough/gmail/v1/users/me/drafts");
  assert.equal((draftPassthrough.init.headers as Record<string, string>)["x-one-connection-key"], "live::gmail::default::abc123");
  assert.equal((draftPassthrough.init.headers as Record<string, string>)["x-one-action-id"], "conn_mod_def::draft-create");
  assert.ok(((draftPassthrough.body as { message?: { raw?: string } }).message?.raw || "").length > 20);
  console.log("OK: One passthrough builder creates Gmail draft requests with encoded raw MIME");

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
    action_id: "conn_mod_def::messages-send",
    connection_key: "gmail_123",
    data: { to: "friend@example.com", subject: "Hello" },
    _oneApiKeyForTest: "one_sk_test_secret",
    _oneApiFetchForTest: async (input) => {
      if (String(input).includes("/v1/passthrough")) passthroughCalled = true;
      if (String(input).includes("/v1/knowledge")) {
        return jsonResponse({
          rows: [
            {
              _id: "conn_mod_def::messages-send",
              title: "Send a User's Gmail Message",
              method: "POST",
              path: "/gmail/v1/users/{{userId}}/messages/send",
            },
          ],
        });
      }
      return jsonResponse({ ok: true });
    },
  }, { userId: "user_1", state: {} });
  assert.equal(riskyResult.ok, false);
  assert.equal(passthroughCalled, false);
  assert.match(riskyResult.content, /approval/i);
  console.log("OK: one_execute_action blocks risky API writes without approval");

  let executeCall: { url: string; init?: RequestInit } | null = null;
  const approvedResult = await oneExecuteActionTool.execute({
    platform: "gmail",
    action_id: "conn_mod_def::draft-create",
    connection_key: "live::gmail::default::abc123",
    data: { to: "friend@example.com", subject: "Hello", body: "Friendly test" },
    approved: true,
    _oneApiKeyForTest: "one_sk_test_secret",
    _oneApiFetchForTest: async (input, init) => {
      if (String(input).includes("/v1/knowledge")) {
        return jsonResponse({
          rows: [
            {
              _id: "conn_mod_def::draft-create",
              title: "Create a User's Draft",
              method: "POST",
              path: "/gmail/v1/users/{{userId}}/drafts",
            },
          ],
        });
      }
      executeCall = { url: String(input), init };
      return jsonResponse({ id: "draft_1", message: { id: "msg_1" } });
    },
  }, { userId: "user_1", state: {} });
  assert.equal(approvedResult.ok, true);
  assert.ok(executeCall?.url.endsWith("/v1/passthrough/gmail/v1/users/me/drafts"));
  assert.equal((executeCall?.init?.headers as Record<string, string>)["x-one-action-id"], "conn_mod_def::draft-create");
  assert.match(String(executeCall?.init?.body), /"message"/);
  console.log("OK: one_execute_action uses the live One passthrough contract for approved Gmail drafts");

  const searchToolResult = await oneSearchActionsTool.execute({
    platform: "gmail",
    query: "recent unread",
    _oneApiKeyForTest: "one_sk_test_secret",
    _oneApiFetchForTest: fetchImpl,
  }, { userId: "user_1", state: {} });
  assert.equal(searchToolResult.ok, true);
  assert.match(searchToolResult.content, /conn_mod_def::messages-list/);
  console.log("OK: One tools prefer the saved API-key path when available");

  console.log("\nAll One API Connection Center assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
