import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileAgentSdkRunStore } from "../src/agent/runStore";
import { createAgentSdkTools } from "../src/agent/toolRegistry";
import {
  resumeAgentSdkEmailWorkflowRun,
  resumeAgentSdkRunFromApprovalGate,
  runAgentSdkEmailWorkflow,
  runAgentSdkReminderWorkflow,
} from "../src/agent/agentRunner";

async function main() {
  process.env.ENABLE_AGENT_SDK_RUNNER = "true";

  const tmp = await mkdtemp(path.join(tmpdir(), "agent-sdk-hitl-smoke-"));

  try {
    const store = createFileAgentSdkRunStore(tmp);
    const now = new Date().toISOString();

    await store.save({
      meta: {
        runId: "smoke_draft",
        userId: "user_smoke",
        originChannel: "telegram",
        status: "running",
        createdAt: now,
        updatedAt: now,
      },
      state: null,
    });

    const draftTools = createAgentSdkTools({
      userId: "user_smoke",
      runId: "smoke_draft",
      store,
    });
    const draftTool: any = draftTools.find((tool: any) => tool.function.name === "draft_email");
    await draftTool.function.execute({
      to: "test@example.com",
      subject: "Jarvis Agent SDK approval test",
      body: "This is a mocked HITL approval smoke test.",
    });
    assert.equal((await store.load("smoke_draft"))?.meta.draft?.to, "test@example.com");
    console.log("OK: draft generated");

    let approvalRequested = false;
    const pendingCall = {
      id: "call_smoke_send",
      name: "send_email",
      arguments: {
        to: "test@example.com",
        subject: "Jarvis Agent SDK approval test",
        body: "This is a mocked HITL approval smoke test.",
      },
    };
    const startResult = await runAgentSdkEmailWorkflow(
      {
        userId: "user_smoke",
        userText: "Draft and send an email to test@example.com saying this is a Jarvis Agent SDK approval test.",
        originChannel: "telegram",
        originChannelId: "123",
      },
      {
        store,
        callModel: async () => ({
          requiresApproval: async () => true,
          getPendingToolCalls: async () => [pendingCall],
          getState: async () => ({
            id: "state_smoke",
            status: "awaiting_approval",
            pendingToolCalls: [pendingCall],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
          }),
          getText: async () => "Draft is ready and waiting for approval.",
        }),
        requestApprovalForPendingCall: async (pending, deps) => {
          approvalRequested = true;
          const record = await deps.store.load(pending.runId);
          assert.ok(record);
          await deps.store.save({
            meta: {
              ...record.meta,
              status: "awaiting_approval",
              pendingToolCallId: pending.toolCallId,
              gateId: "gate_smoke",
              updatedAt: new Date().toISOString(),
            },
            state: record.state,
          });
          return "gate_smoke";
        },
      },
    );
    assert.equal(startResult.status, "awaiting_approval");
    assert.equal(approvalRequested, true);
    console.log("OK: approval requested");
    assert.equal((await store.load(startResult.runId))?.meta.status, "awaiting_approval");
    console.log("OK: paused run persisted");

    let sendCount = 0;
    const approvalMessages: string[] = [];
    const approved = await resumeAgentSdkRunFromApprovalGate(
      {
        gate: {
          id: "gate_smoke",
          userId: "user_smoke",
          toolName: "send_email",
          toolArgs: {
            __agentSdkRunId: startResult.runId,
            __agentSdkToolCallId: "call_smoke_send",
          },
        },
        approved: true,
        originChannelId: "123",
      },
      {
        store,
        callModel: async (request: any) => {
          const sendTool: any = request.tools.find((tool: any) => tool.function.name === "send_email");
          if (request.approveToolCalls?.includes("call_smoke_send")) {
            await sendTool.function.execute(pendingCall.arguments);
          }
          return {
            getText: async () => "Email sent.",
            getResponse: async () => ({
              state: {
                id: "state_smoke",
                status: "complete",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messages: [],
              },
            }),
          };
        },
        sendTelegramMessage: async (_chatId, text) => {
          approvalMessages.push(text);
        },
        sendEmail: async () => {
          sendCount += 1;
          return { ok: true, messageId: "msg_smoke" };
        },
      },
    );
    assert.equal(approved.status, "complete");
    assert.equal(sendCount, 1);
    console.log("OK: approval resumes and sends");
    assert.ok(approvalMessages.some((message) => /completed/i.test(message)));
    console.log("OK: completion notification sent");

    await store.save({
      meta: {
        runId: "smoke_restart",
        userId: "user_smoke",
        originChannel: "telegram",
        originChannelId: "123",
        status: "running",
        createdAt: now,
        updatedAt: now,
      },
      state: {
        id: "state_restart",
        status: "in_progress",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      } as any,
    });
    const restartRequests: any[] = [];
    const progressMessages: string[] = [];
    const restartResult = await resumeAgentSdkEmailWorkflowRun(
      { runId: "smoke_restart" },
      {
        store,
        callModel: async (request) => {
          restartRequests.push(request);
          return {
            requiresApproval: async () => false,
            getToolCallsStream: async function* () {
              yield { id: "call_context", name: "read_context", arguments: { query: "test" } };
            },
            getText: async () => "Restarted run finished.",
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
          progressMessages.push(text);
        },
      },
    );
    assert.equal(restartResult.status, "complete");
    assert.deepEqual(restartRequests[0].input, []);
    assert.ok(Array.isArray(restartRequests[0].stopWhen));
    assert.ok(progressMessages.some((message) => /read_context/.test(message)));
    console.log("OK: restart resume uses persisted state");
    console.log("OK: Telegram progress updates sent");

    let reminderCreateCount = 0;
    const reminderResult = await runAgentSdkReminderWorkflow(
      {
        userId: "user_smoke",
        userText: "Remind me in an hour to call the company.",
        originChannel: "telegram",
        originChannelId: "123",
      },
      {
        store,
        callModel: async (request: any) => {
          assert.equal(request.tools.some((tool: any) => tool.function.name === "send_email"), false);
          assert.equal(request.tools.some((tool: any) => tool.function.name === "draft_email"), false);
          const reminderTool: any = request.tools.find((tool: any) => tool.function.name === "create_internal_reminder");
          await reminderTool.function.execute({
            title: "Call the company",
            description: "User asked Jarvis for a reminder.",
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
            id: "task_smoke",
            scheduledAt: args.scheduledAt,
            recurrence: null,
            deduped: false,
          };
        },
        sendTelegramMessage: async () => undefined,
      },
    );
    assert.equal(reminderResult.status, "complete");
    assert.equal(reminderCreateCount, 1);
    assert.equal((await store.load(reminderResult.runId))?.meta.reminder?.id, "task_smoke");
    console.log("OK: internal reminder wrapper creates Jarvis scheduled-task request");

    await store.save({
      meta: {
        runId: "smoke_reject",
        userId: "user_smoke",
        originChannel: "telegram",
        originChannelId: "123",
        status: "awaiting_approval",
        pendingToolCallId: "call_reject",
        gateId: "gate_reject",
        createdAt: now,
        updatedAt: now,
      },
      state: {
        id: "state_reject",
        status: "awaiting_approval",
        pendingToolCalls: [{ ...pendingCall, id: "call_reject" }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      } as any,
    });
    sendCount = 0;
    const rejected = await resumeAgentSdkRunFromApprovalGate(
      {
        gate: {
          id: "gate_reject",
          userId: "user_smoke",
          toolName: "send_email",
          toolArgs: {
            __agentSdkRunId: "smoke_reject",
            __agentSdkToolCallId: "call_reject",
          },
        },
        approved: false,
        originChannelId: "123",
      },
      {
        store,
        callModel: async () => ({
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
        }),
        sendTelegramMessage: async () => undefined,
        sendEmail: async () => {
          sendCount += 1;
          return { ok: true };
        },
      },
    );
    assert.equal(rejected.status, "rejected");
    assert.equal(sendCount, 0);
    console.log("OK: rejection prevents sending");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
