import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isAgentSdkRunnerEnabled,
  matchesAgentSdkEmailWorkflow,
  resumeAgentSdkRunFromApprovalGate,
  runAgentSdkEmailWorkflow,
} from "../agentRunner";
import { requestTelegramApprovalForPendingCall } from "../hitlApproval";
import { createFileAgentSdkRunStore } from "../runStore";
import { createAgentSdkTools } from "../toolRegistry";

async function main() {
  process.env.ENABLE_AGENT_SDK_RUNNER = "true";

assert.equal(isAgentSdkRunnerEnabled(), true);
assert.equal(matchesAgentSdkEmailWorkflow("draft and send an email to sam@example.com"), true);
assert.equal(matchesAgentSdkEmailWorkflow("can you draft/send an email to Sam?"), true);
assert.equal(matchesAgentSdkEmailWorkflow("write an email draft but do not send it"), false);
assert.equal(matchesAgentSdkEmailWorkflow("check my inbox"), false);
assert.equal(matchesAgentSdkEmailWorkflow("send a calendar invite"), false);

process.env.ENABLE_AGENT_SDK_RUNNER = "false";
assert.equal(isAgentSdkRunnerEnabled(), false);
process.env.ENABLE_AGENT_SDK_RUNNER = "true";

const tmp = await mkdtemp(path.join(tmpdir(), "agent-sdk-hitl-"));
try {
  const store = createFileAgentSdkRunStore(tmp);
  const baseNow = "2026-05-28T00:00:00.000Z";
  await store.save({
    meta: {
      runId: "run_test",
      userId: "user_1",
      originChannel: "telegram",
      originChannelId: "123",
      status: "awaiting_approval",
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    state: {
      id: "state_test",
      status: "awaiting_approval",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    } as any,
  });
  const loaded = await store.load("run_test");
  assert.equal(loaded?.meta.status, "awaiting_approval");
  assert.equal(loaded?.state?.status, "awaiting_approval");

  let sent = false;
  await store.save({
    meta: {
      runId: "run_tools",
      userId: "user_1",
      originChannel: "telegram",
      status: "running",
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    state: null,
  });
  const tools = createAgentSdkTools({
    userId: "user_1",
    runId: "run_tools",
    store,
    readContext: async () => "Remember to be concise.",
    sendEmail: async () => {
      sent = true;
      return { ok: true, messageId: "msg_123" };
    },
  });
  assert.equal(tools.length, 3);
  assert.ok(tools.some((tool: any) => tool.function?.name === "send_email"));
  const draftTool: any = tools.find((tool: any) => tool.function?.name === "draft_email");
  const draftResult = await draftTool.function.execute({
    to: "sam@example.com",
    subject: "Hello",
    body: "Draft body",
  });
  assert.equal(draftResult.drafted, true);
  assert.equal((await store.load("run_tools"))?.meta.draft?.subject, "Hello");
  assert.equal(sent, false);

  const approvalCalls: any[] = [];
  const notifyCalls: any[] = [];
  await store.save({
    meta: {
      runId: "run_approval",
      userId: "user_1",
      originChannel: "telegram",
      originChannelId: "123",
      status: "running",
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    state: null,
  });
  const gateId = await requestTelegramApprovalForPendingCall(
    {
      runId: "run_approval",
      userId: "user_1",
      originChannel: "telegram",
      originChannelId: "123",
      toolCallId: "call_send_1",
      toolName: "send_email",
      arguments: { to: "sam@example.com", subject: "Hello", body: "Draft body" },
    },
    {
      store,
      requestApproval: async (input) => {
        approvalCalls.push(input);
        return { id: "gate_123" };
      },
      notifyApprovalRequest: async (payload) => {
        notifyCalls.push(payload);
        return [];
      },
    },
  );
  assert.equal(gateId, "gate_123");
  assert.equal(approvalCalls[0].toolArgs.__agentSdkRunId, "run_approval");
  assert.equal(approvalCalls[0].toolArgs.__agentSdkToolCallId, "call_send_1");
  assert.match(approvalCalls[0].description, /To: sam@example\.com/);
  assert.match(approvalCalls[0].description, /Subject: Hello/);
  assert.equal(notifyCalls[0].originChannel, "telegram");
  assert.equal((await store.load("run_approval"))?.meta.gateId, "gate_123");

  const fakePendingCall = {
    id: "call_send_2",
    name: "send_email",
    arguments: { to: "sam@example.com", subject: "Hello", body: "Draft body" },
  };
  let requestApprovalForPendingCallCount = 0;
  const runnerResult = await runAgentSdkEmailWorkflow(
    {
      userId: "user_1",
      userText: "Draft and send an email to sam@example.com saying hello",
      originChannel: "telegram",
      originChannelId: "123",
    },
    {
      store,
      callModel: async () => ({
        requiresApproval: async () => true,
        getPendingToolCalls: async () => [fakePendingCall],
        getState: async () => ({
          id: "state_2",
          status: "awaiting_approval",
          pendingToolCalls: [fakePendingCall],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        }),
        getText: async () => "Draft is ready and waiting for approval.",
      }),
      requestApprovalForPendingCall: async (pending, deps) => {
        requestApprovalForPendingCallCount += 1;
        assert.equal(pending.toolCallId, "call_send_2");
        await deps.store.save({
          meta: {
            runId: pending.runId,
            userId: pending.userId,
            originChannel: pending.originChannel,
            originChannelId: pending.originChannelId,
            status: "awaiting_approval",
            pendingToolCallId: pending.toolCallId,
            gateId: "gate_runner",
            createdAt: baseNow,
            updatedAt: baseNow,
          },
          state: (await deps.store.load(pending.runId))?.state ?? null,
        });
        return "gate_runner";
      },
      readContext: async () => "context",
      sendEmail: async () => {
        sent = true;
        return { ok: true, messageId: "msg_should_not_send_before_approval" };
      },
    },
  );
  assert.equal(runnerResult.handled, true);
  assert.equal(runnerResult.status, "awaiting_approval");
  assert.equal(requestApprovalForPendingCallCount, 1);
  assert.equal(sent, false);
  assert.equal((await store.load(runnerResult.runId))?.meta.status, "awaiting_approval");

  const resumeCalls: any[] = [];
  const telegramMessages: string[] = [];
  const approvedResume = await resumeAgentSdkRunFromApprovalGate(
    {
      gate: {
        id: "gate_runner",
        userId: "user_1",
        toolName: "send_email",
        toolArgs: {
          to: "sam@example.com",
          subject: "Hello",
          body: "Draft body",
          __agentSdkRunId: runnerResult.runId,
          __agentSdkToolCallId: "call_send_2",
        },
      },
      approved: true,
      originChannelId: "123",
    },
    {
      store,
      callModel: async (request) => {
        resumeCalls.push(request);
        const sendTool: any = (request.tools as any[]).find((tool) => tool.function?.name === "send_email");
        if (request.approveToolCalls?.includes("call_send_2")) {
          await sendTool.function.execute({
            to: "sam@example.com",
            subject: "Hello",
            body: "Draft body",
          });
        }
        return {
          getText: async () => "Email sent.",
          getResponse: async () => ({
            state: {
              id: "state_2",
              status: "complete",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            },
          }),
        };
      },
      sendTelegramMessage: async (_chatId, text) => {
        telegramMessages.push(text);
      },
      sendEmail: async () => {
        sent = true;
        return { ok: true, messageId: "msg_approved" };
      },
    },
  );
  assert.equal(approvedResume.status, "complete");
  assert.deepEqual(resumeCalls[0].approveToolCalls, ["call_send_2"]);
  assert.equal(sent, true);
  assert.match(telegramMessages[0], /Email sent/);

  sent = false;
  await store.save({
    meta: {
      runId: "run_reject",
      userId: "user_1",
      originChannel: "telegram",
      originChannelId: "123",
      status: "awaiting_approval",
      pendingToolCallId: "call_send_3",
      gateId: "gate_reject",
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    state: {
      id: "state_reject",
      status: "awaiting_approval",
      pendingToolCalls: [{ ...fakePendingCall, id: "call_send_3" }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    } as any,
  });
  const rejectedResume = await resumeAgentSdkRunFromApprovalGate(
    {
      gate: {
        id: "gate_reject",
        userId: "user_1",
        toolName: "send_email",
        toolArgs: {
          __agentSdkRunId: "run_reject",
          __agentSdkToolCallId: "call_send_3",
        },
      },
      approved: false,
      originChannelId: "123",
    },
    {
      store,
      callModel: async (request) => {
        resumeCalls.push(request);
        return {
          getText: async () => "Email was not sent.",
          getResponse: async () => ({
            state: {
              id: "state_reject",
              status: "complete",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            },
          }),
        };
      },
      sendTelegramMessage: async () => {},
      sendEmail: async () => {
        sent = true;
        return { ok: true };
      },
    },
  );
  assert.equal(rejectedResume.status, "rejected");
  assert.equal(sent, false);
  assert.equal((await store.load("run_reject"))?.meta.status, "rejected");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

  console.log("agentSdkHitl assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
