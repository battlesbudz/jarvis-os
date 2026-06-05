import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isAgentSdkRunnerEnabled,
  getAgentSdkModelProvider,
  matchesAgentSdkEmailDraftOnlyWorkflow,
  matchesAgentSdkEmailWorkflow,
  matchesAgentSdkReminderWorkflow,
  resumeAgentSdkEmailWorkflowRun,
  resumeAgentSdkRunFromApprovalGate,
  runAgentSdkEmailWorkflow,
  runAgentSdkReminderWorkflow,
} from "../agentRunner";
import { requestTelegramApprovalForPendingCall } from "../hitlApproval";
import { createFileAgentSdkRunStore } from "../runStore";
import { createAgentSdkTools } from "../toolRegistry";

async function main() {
process.env.ENABLE_AGENT_SDK_RUNNER = "true";
process.env.AGENT_SDK_MODEL_PROVIDER = "openrouter";
process.env.OPENROUTER_API_KEY = "should-not-be-used";

assert.equal(isAgentSdkRunnerEnabled(), true);
assert.equal(getAgentSdkModelProvider(), "jarvis");
assert.equal(matchesAgentSdkEmailWorkflow("draft and send an email to sam@example.com"), true);
assert.equal(matchesAgentSdkEmailWorkflow("can you draft/send an email to Sam?"), true);
assert.equal(matchesAgentSdkEmailWorkflow("write an email draft but do not send it"), false);
assert.equal(matchesAgentSdkEmailWorkflow("check my inbox"), false);
assert.equal(matchesAgentSdkEmailWorkflow("send a calendar invite"), false);
assert.equal(matchesAgentSdkEmailDraftOnlyWorkflow("Draft a reply to this email."), true);
assert.equal(matchesAgentSdkEmailDraftOnlyWorkflow("write an email draft but do not send it"), true);
assert.equal(matchesAgentSdkEmailDraftOnlyWorkflow("draft and send an email to sam@example.com"), false);
assert.equal(matchesAgentSdkEmailDraftOnlyWorkflow("reply with FAST ROUTE OK"), false);
assert.equal(matchesAgentSdkEmailDraftOnlyWorkflow("please reply with hello world"), false);
assert.equal(matchesAgentSdkEmailDraftOnlyWorkflow("check my inbox"), false);
assert.equal(matchesAgentSdkReminderWorkflow("Remind me in an hour to call the company."), true);
assert.equal(matchesAgentSdkReminderWorkflow("Set a reminder tomorrow morning to follow up with Bill."), true);
assert.equal(matchesAgentSdkReminderWorkflow("Remind me to call the company."), false);
assert.equal(matchesAgentSdkReminderWorkflow("Schedule a calendar event tomorrow."), false);

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
  
  // Test SDK built-in tools (draft_email, send_email, create_internal_reminder)
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
  
  const draftOnlyTools = createAgentSdkTools({
    userId: "user_1",
    runId: "run_tools",
    store,
    includeSendEmailTool: false,
  });
  assert.equal(draftOnlyTools.length, 2);
  assert.equal(draftOnlyTools.some((tool: any) => tool.function?.name === "send_email"), false);
  
  const reminderTools = createAgentSdkTools({
    userId: "user_1",
    runId: "run_tools",
    store,
    includeDraftEmailTool: false,
    includeSendEmailTool: false,
    includeReminderTool: true,
    createInternalReminder: async ({ title, scheduledAt }) => ({
      ok: true,
      id: "task_123",
      scheduledAt,
      recurrence: null,
      deduped: false,
    }),
  });
  assert.equal(reminderTools.length, 2);
  assert.equal(reminderTools.some((tool: any) => tool.function?.name === "create_internal_reminder"), true);
  assert.equal(reminderTools.some((tool: any) => tool.function?.name === "send_email"), false);
  assert.equal(reminderTools.some((tool: any) => tool.function?.name === "draft_email"), false);
  
  const reminderTool: any = reminderTools.find((tool: any) => tool.function?.name === "create_internal_reminder");
  const reminderToolResult = await reminderTool.function.execute({
    title: "Call the company",
    scheduledAt: "2026-05-28T15:00:00.000Z",
  });
  assert.equal(reminderToolResult.created, true);
  assert.equal((await store.load("run_tools"))?.meta.reminder?.id, "task_123");
  
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

  const draftFallbackApprovals: any[] = [];
  const draftFallbackResult = await runAgentSdkEmailWorkflow(
    {
      userId: "user_1",
      userText: "Draft and send an email to sam@example.com saying the proposal is ready",
      originChannel: "telegram",
      originChannelId: "123",
    },
    {
      store,
      callModel: async (request) => {
        const draftEmailTool: any = (request.tools as any[]).find((tool) => tool.function?.name === "draft_email");
        await draftEmailTool.function.execute({
          to: "sam@example.com",
          subject: "Proposal ready",
          body: "The proposal is ready for review.",
        });
        return {
          requiresApproval: async () => false,
          getText: async () => "Draft ready.",
          getResponse: async () => ({
            state: {
              id: "state_draft_fallback",
              status: "complete",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            },
          }),
        };
      },
      requestApprovalForPendingCall: async (pending, deps) => {
        draftFallbackApprovals.push(pending);
        await deps.store.save({
          meta: {
            runId: pending.runId,
            userId: pending.userId,
            originChannel: pending.originChannel,
            originChannelId: pending.originChannelId,
            status: "awaiting_approval",
            pendingToolCallId: pending.toolCallId,
            gateId: "gate_draft_fallback",
            createdAt: baseNow,
            updatedAt: baseNow,
          },
          state: (await deps.store.load(pending.runId))?.state ?? null,
        });
        return "gate_draft_fallback";
      },
      sendEmail: async () => {
        sent = true;
        return { ok: true, messageId: "msg_should_not_send_from_draft_fallback" };
      },
    },
  );
  assert.equal(draftFallbackResult.status, "awaiting_approval");
  assert.equal(draftFallbackResult.gateId, "gate_draft_fallback");
  assert.equal(draftFallbackApprovals.length, 1);
  assert.equal(draftFallbackApprovals[0].toolName, "send_email");
  assert.equal(draftFallbackApprovals[0].arguments.subject, "Proposal ready");
  assert.equal(sent, false);

  const fallbackResumeMessages: string[] = [];
  const fallbackResumeResult = await resumeAgentSdkRunFromApprovalGate(
    {
      gate: {
        id: "gate_draft_fallback",
        userId: "user_1",
        toolName: "send_email",
        toolArgs: {
          __agentSdkRunId: draftFallbackResult.runId,
          __agentSdkToolCallId: draftFallbackApprovals[0].toolCallId,
        },
      },
      approved: true,
      originChannelId: "123",
    },
    {
      store,
      sendTelegramMessage: async (_chatId, text) => {
        fallbackResumeMessages.push(text);
      },
      sendEmail: async (_userId, args) => {
        sent = true;
        assert.equal(args.to, "sam@example.com");
        assert.equal(args.subject, "Proposal ready");
        assert.equal(args.body, "The proposal is ready for review.");
        return { ok: true, messageId: "msg_draft_fallback_sent" };
      },
    },
  );
  assert.equal(fallbackResumeResult.status, "complete");
  assert.equal(sent, true);
  assert.equal((await store.load(draftFallbackResult.runId))?.meta.status, "complete");
  assert.ok(fallbackResumeMessages.some((message) => /approved/i.test(message)));

  sent = false;

  const longHorizonRequests: any[] = [];
  const longHorizonMessages: string[] = [];
  const longHorizonResult = await runAgentSdkEmailWorkflow(
    {
      userId: "user_1",
      userText: "Draft and send an email to sam@example.com saying hello",
      originChannel: "telegram",
      originChannelId: "123",
    },
    {
      store,
      callModel: async (request) => {
        longHorizonRequests.push(request);
        return {
          requiresApproval: async () => false,
          getToolCallsStream: async function* () {
            yield { id: "call_context", name: "read_context", arguments: { query: "sam" } };
          },
          getTextStream: async function* () {
            yield "Drafting";
            yield " email";
          },
          getText: async () => "Email workflow complete.",
          getResponse: async () => ({
            state: {
              id: "state_long",
              status: "complete",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            },
            usage: { cost: 0.01 },
          }),
        };
      },
      sendTelegramMessage: async (_chatId, text) => {
        longHorizonMessages.push(text);
      },
    },
  );
  assert.equal(longHorizonResult.status, "complete");
  assert.equal(Array.isArray(longHorizonRequests[0].stopWhen), true);
  assert.equal(longHorizonRequests[0].stopWhen.length, 2);
  assert.ok(longHorizonMessages.some((message) => /read_context/.test(message)));
  assert.ok(longHorizonMessages.some((message) => /completed/i.test(message)));
  assert.equal((await store.load(longHorizonResult.runId))?.meta.status, "complete");

  const draftOnlyRequests: any[] = [];
  const draftOnlyResult = await runAgentSdkEmailWorkflow(
    {
      userId: "user_1",
      userText: "Draft a reply to this email but do not send it.",
      conversationContext: "customer@example.com wrote: Can you send the proposal today?",
      originChannel: "app",
    },
    {
      store,
      callModel: async (request) => {
        draftOnlyRequests.push(request);
        const draftEmailTool: any = (request.tools as any[]).find((tool) => tool.function?.name === "draft_email");
        await draftEmailTool.function.execute({
          to: "customer@example.com",
          subject: "Re: Proposal",
          body: "Yes, I can send the proposal today.",
        });
        return {
          requiresApproval: async () => false,
          getText: async () => "Draft ready. I did not send anything.",
          getResponse: async () => ({
            state: {
              id: "state_draft_only",
              status: "complete",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            },
          }),
        };
      },
    },
  );
  assert.equal(draftOnlyResult.status, "complete");
  assert.equal(draftOnlyRequests[0].tools.some((tool: any) => tool.function?.name === "send_email"), false);
  assert.match(draftOnlyRequests[0].input, /Relevant conversation context/);
  assert.equal((await store.load(draftOnlyResult.runId))?.meta.workflow, "email_draft_only");
  assert.equal((await store.load(draftOnlyResult.runId))?.meta.draft?.to, "customer@example.com");

  const reminderRequests: any[] = [];
  let reminderCreateCount = 0;
  const reminderResult = await runAgentSdkReminderWorkflow(
    {
      userId: "user_1",
      userText: "Remind me in an hour to call the company.",
      originChannel: "telegram",
      originChannelId: "123",
    },
    {
      store,
      callModel: async (request) => {
        reminderRequests.push(request);
        const createReminderTool: any = (request.tools as any[]).find((tool) => tool.function?.name === "create_internal_reminder");
        await createReminderTool.function.execute({
          title: "Call the company",
          description: "User asked Jarvis to remind them to call the company.",
          scheduledAt: "in an hour",
        });
        return {
          requiresApproval: async () => false,
          getText: async () => "Reminder scheduled for in an hour.",
          getResponse: async () => ({
            state: {
              id: "state_reminder",
              status: "complete",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            },
          }),
        };
      },
      createInternalReminder: async (_userId, args) => {
        reminderCreateCount += 1;
        return {
          ok: true,
          id: "task_agent_sdk",
          scheduledAt: args.scheduledAt,
          recurrence: null,
          deduped: false,
        };
      },
      sendTelegramMessage: async () => {},
    },
  );
  assert.equal(reminderResult.status, "complete");
  assert.equal(reminderCreateCount, 1);
  assert.equal(reminderRequests[0].tools.some((tool: any) => tool.function?.name === "create_internal_reminder"), true);
  assert.equal(reminderRequests[0].tools.some((tool: any) => tool.function?.name === "send_email"), false);
  assert.equal((await store.load(reminderResult.runId))?.meta.workflow, "internal_reminder");
  assert.equal((await store.load(reminderResult.runId))?.meta.reminder?.id, "task_agent_sdk");

  await store.save({
    meta: {
      runId: "run_restart",
      userId: "user_1",
      originChannel: "telegram",
      originChannelId: "123",
      status: "running",
      createdAt: baseNow,
      updatedAt: baseNow,
    },
    state: {
      id: "state_restart",
      status: "in_progress",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{ type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] }],
    } as any,
  });
  const restartRequests: any[] = [];
  const restartMessages: string[] = [];
  const restartResult = await resumeAgentSdkEmailWorkflowRun(
    { runId: "run_restart" },
    {
      store,
      callModel: async (request) => {
        restartRequests.push(request);
        return {
          requiresApproval: async () => false,
          getText: async () => "Resumed and finished.",
          getResponse: async () => ({
            state: {
              id: "state_restart",
              status: "complete",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            },
          }),
        };
      },
      sendTelegramMessage: async (_chatId, text) => {
        restartMessages.push(text);
      },
    },
  );
  assert.equal(restartResult.status, "complete");
  assert.deepEqual(restartRequests[0].input, []);
  assert.equal(Array.isArray(restartRequests[0].stopWhen), true);
  assert.ok(restartMessages.some((message) => /completed/i.test(message)));

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
