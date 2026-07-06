import assert from "node:assert/strict";

import { withApprovalMarkerForTool } from "../approvalMarkers";
import { requiresApproval, requiresHumanApproval, STRICTLY_IRREVERSIBLE_TOOLS } from "../approvalToolRisk";
import { classifyToolAwareRoute } from "../toolAwareRouting";
import {
  connectedAccountsExecuteTool,
  connectedAccountsGetToolSchemaTool,
  connectedAccountsListTool,
  connectedAccountsSearchToolsTool,
} from "../tools/connectedAccounts";

async function main(): Promise<void> {
  assert.equal(requiresApproval("connected_accounts_execute"), true);
  assert.equal(STRICTLY_IRREVERSIBLE_TOOLS.has("connected_accounts_execute"), true);
  assert.equal(requiresHumanApproval("queue_background_job", { task_scoped_cloud: true }), true);
  assert.equal(requiresHumanApproval("queue_background_job", { prompt: "Normal background task" }), false);
  assert.deepEqual(
    withApprovalMarkerForTool("connected_accounts_execute", { tool_slug: "GMAIL_SEND_EMAIL" }),
    { tool_slug: "GMAIL_SEND_EMAIL", approved: true, _approved: true },
  );
  console.log("OK: connected account execution uses the approval marker path");

  const expectedConnectedAccountTools = [
    "connected_accounts_list",
    "connected_accounts_search_tools",
    "connected_accounts_get_tool_schema",
    "connected_accounts_execute",
  ];
  const emailPlan = classifyToolAwareRoute("check my Gmail and draft a reply");
  assert.deepEqual(emailPlan.priorityToolNames.slice(0, 4), expectedConnectedAccountTools);
  const calendarPlan = classifyToolAwareRoute("what is on my Google Calendar tomorrow?");
  assert.deepEqual(calendarPlan.priorityToolNames.slice(0, 4), expectedConnectedAccountTools);
  assert.match(emailPlan.guidance, /Composio/);
  assert.doesNotMatch(emailPlan.guidance, /One/);
  assert.equal(emailPlan.priorityToolNames.some((name) => name.startsWith("one_")), false);
  assert.equal(calendarPlan.priorityToolNames.some((name) => name.startsWith("one_")), false);
  console.log("OK: email/calendar routing prioritizes Composio tools without One wording");

  const calls: string[] = [];
  const storedAccounts: any[] = [];
  const store = {
    async list(userId: string) {
      return storedAccounts.filter((account) => account.userId === userId);
    },
    async upsert(account: any) {
      storedAccounts.push(account);
      return account;
    },
    async delete() {
      storedAccounts.length = 0;
      return 1;
    },
  };
  const session = {
    async search(args: unknown) {
      calls.push(`session.search:${JSON.stringify(args)}`);
      return [{ slug: "GMAIL_FETCH_EMAILS", name: "Fetch emails", description: "Read Gmail messages" }];
    },
    async execute(toolSlug: string, args: unknown) {
      calls.push(`session.execute:${toolSlug}:${JSON.stringify(args)}`);
      return { successful: true, data: [{ id: "m_1" }] };
    },
  };
  const client = {
    async create(userId: string, config?: Record<string, unknown>) {
      calls.push(`create:${userId}:${JSON.stringify(config)}`);
      return session;
    },
    connectedAccounts: {
      async list(args: unknown) {
        calls.push(`connectedAccounts.list:${JSON.stringify(args)}`);
        return {
          items: [
            {
              id: "ca_gmail_1",
              status: "ACTIVE",
              toolkit: { slug: "gmail", name: "Gmail" },
              userId: "user_1",
            },
          ],
        };
      },
    },
    tools: {
      async get(userId: string, args: unknown) {
        calls.push(`tools.get:${userId}:${JSON.stringify(args)}`);
        return [{ slug: "GMAIL_FETCH_EMAILS" }];
      },
    },
  };

  const ctx = { userId: "user_1", state: {} };
  const listResult = await connectedAccountsListTool.execute({
    _composioClientForTest: client,
    _composioStoreForTest: store,
  }, ctx);
  assert.equal(listResult.ok, true);
  assert.match(listResult.content, /ca_gmail_1/);
  assert.ok(calls.some((call) => call.startsWith("connectedAccounts.list")));
  console.log("OK: connected_accounts_list calls the Composio connection center");

  const searchResult = await connectedAccountsSearchToolsTool.execute({
    platform: "gmail",
    query: "email",
    _composioClientForTest: client,
  }, ctx);
  assert.equal(searchResult.ok, true);
  assert.match(searchResult.content, /GMAIL_FETCH_EMAILS/);
  console.log("OK: connected_accounts_search_tools searches Composio tools");

  const schemaResult = await connectedAccountsGetToolSchemaTool.execute({
    platform: "gmail",
    tool_slug: "GMAIL_FETCH_EMAILS",
    _composioClientForTest: client,
  }, ctx);
  assert.equal(schemaResult.ok, true);
  assert.match(schemaResult.content, /GMAIL_FETCH_EMAILS/);
  console.log("OK: connected_accounts_get_tool_schema fetches tool schema");

  const readResult = await connectedAccountsExecuteTool.execute({
    platform: "gmail",
    tool_slug: "GMAIL_FETCH_EMAILS",
    arguments: { query: "newer_than:1d" },
    _composioClientForTest: client,
  }, ctx);
  assert.equal(readResult.ok, true);
  assert.ok(calls.some((call) => call.startsWith("session.execute:GMAIL_FETCH_EMAILS")));
  console.log("OK: connected_accounts_execute allows read tools after connection details are provided");

  const riskyResult = await connectedAccountsExecuteTool.execute({
    platform: "gmail",
    tool_slug: "GMAIL_SEND_EMAIL",
    arguments: { to: "friend@example.com", subject: "Hello" },
    _composioClientForTest: client,
  }, ctx);
  assert.equal(riskyResult.ok, false);
  assert.match(riskyResult.content, /Approval required/);
  assert.equal(
    calls.some((call) => call.startsWith("session.execute:GMAIL_SEND_EMAIL")),
    false,
    "risky send must not execute before approval",
  );
  console.log("OK: connected_accounts_execute blocks risky Composio writes without approval");

  const approvedResult = await connectedAccountsExecuteTool.execute({
    platform: "gmail",
    tool_slug: "GMAIL_SEND_EMAIL",
    arguments: { to: "friend@example.com", subject: "Hello" },
    _approved: true,
    _composioClientForTest: client,
  }, ctx);
  assert.equal(approvedResult.ok, true);
  assert.equal(
    calls.some((call) => call.startsWith("session.execute:GMAIL_SEND_EMAIL")),
    true,
    "approved send should execute after approval marker",
  );
  console.log("OK: connected_accounts_execute allows risky Composio writes after approval marker");

  console.log("\nAll Composio connected accounts assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
