import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSystemApprovalOnBeforeTool } from "../systemApprovalGate";

const repoRoot = resolve(__dirname, "../../..");

async function main(): Promise<void> {
  const requests: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];
  let awaitCalls = 0;

  const onBeforeTool = createSystemApprovalOnBeforeTool({
    agentId: "coach_app:user_1",
    agentName: "Jarvis App Coach",
    userId: "user_1",
    platform: "Gateway",
    channelId: "gateway-chat",
    initiatedBy: "user",
    deps: {
      requiresApproval: (toolName) => toolName === "send_email",
      requestApproval: async (req) => {
        requests.push(req as unknown as Record<string, unknown>);
        return {
          id: "gate_1",
          agentId: req.agentId,
          userId: req.userId,
          toolName: req.toolName,
          toolArgs: req.toolArgs,
          description: req.description,
          status: "pending",
          createdAt: new Date("2026-05-28T00:00:00.000Z"),
          expiresAt: new Date("2026-05-29T00:00:00.000Z"),
        };
      },
      awaitApproval: async (gateId) => {
        awaitCalls += 1;
        assert.equal(gateId, "gate_1");
        return true;
      },
      notifyApprovalRequest: async (payload) => {
        notifications.push(payload as unknown as Record<string, unknown>);
      },
    },
  });

  const safeResult = await onBeforeTool("fetch_calendar", { date: "2026-05-28" });
  assert.equal(safeResult.allowed, true);
  assert.deepEqual(safeResult.params, { date: "2026-05-28" });
  assert.equal(requests.length, 0);

  const gatedResult = await onBeforeTool("send_email", { to: "sam@example.com" });
  assert.equal(gatedResult.allowed, true);
  assert.deepEqual(gatedResult.params, { to: "sam@example.com" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].agentId, "coach_app:user_1");
  assert.equal(requests[0].userId, "user_1");
  assert.equal(requests[0].toolName, "send_email");
  assert.equal(requests[0].initiatedBy, "user");
  assert.equal(awaitCalls, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].gateId, "gate_1");
  assert.equal(notifications[0].platform, "Gateway");

  const connectedAccountGate = createSystemApprovalOnBeforeTool({
    agentId: "coach_app:user_1",
    agentName: "Jarvis App Coach",
    userId: "user_1",
    deps: {
      requiresApproval: (toolName) => toolName === "connected_accounts_execute",
      requestApproval: async (req) => ({
        id: "gate_connected_account",
        agentId: req.agentId,
        userId: req.userId,
        toolName: req.toolName,
        toolArgs: req.toolArgs,
        description: req.description,
        status: "pending",
        createdAt: new Date("2026-05-28T00:00:00.000Z"),
        expiresAt: new Date("2026-05-29T00:00:00.000Z"),
      }),
      awaitApproval: async () => true,
      notifyApprovalRequest: async () => {},
    },
  });
  const connectedAccountResult = await connectedAccountGate("connected_accounts_execute", {
    platform: "gmail",
    tool_slug: "GMAIL_CREATE_DRAFT",
    arguments: { subject: "Hello" },
  });
  assert.equal(connectedAccountResult.allowed, true);
  assert.equal(connectedAccountResult.params?.approved, true);

  const missingUserGate = createSystemApprovalOnBeforeTool({
    agentId: "coach_app:missing",
    agentName: "Jarvis App Coach",
    deps: {
      requiresApproval: () => true,
      requestApproval: async () => {
        throw new Error("requestApproval must not run without a userId");
      },
      awaitApproval: async () => true,
      notifyApprovalRequest: async () => {},
    },
  });
  const missingUserResult = await missingUserGate("send_email", {});
  assert.equal(missingUserResult.allowed, false);
  assert.match(missingUserResult.reason ?? "", /approval requires a user/i);

  const orchestratorSource = readFileSync(resolve(repoRoot, "server/agent/orchestrator.ts"), "utf8");
  assert.match(
    orchestratorSource,
    /onBeforeTool:\s*createSystemApprovalOnBeforeTool/,
    "orchestrator bare runAgent fallback must supply the system approval hook",
  );

  const coachSource = readFileSync(resolve(repoRoot, "server/channels/coachAgent.ts"), "utf8");
  const coachHookUses = coachSource.match(/onBeforeTool:\s*coachApprovalOnBeforeTool/g) ?? [];
  assert.equal(
    coachHookUses.length,
    2,
    "coach direct fallback and quality-correction runAgent paths must use the approval hook",
  );

  console.log("systemApprovalGate assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
