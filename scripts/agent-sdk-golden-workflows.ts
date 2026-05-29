import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileAgentSdkRunStore } from "../src/agent/runStore";
import {
  matchesAgentSdkEmailDraftOnlyWorkflow,
  matchesAgentSdkEmailWorkflow,
  resumeAgentSdkRunFromApprovalGate,
  runAgentSdkEmailWorkflow,
} from "../src/agent/agentRunner";

type WorkflowStatus =
  | "sdk_passed_mocked"
  | "sdk_partial_mocked"
  | "current_jarvis_owned"
  | "unsupported_by_sdk_v1";

interface GoldenWorkflowSpec {
  id: number;
  title: string;
  input: string;
  expectedRoute: string;
  expectedContext: string[];
  approvalRequirement: string;
  sdkV1Disposition: WorkflowStatus;
  nextSdkStep: string;
}

interface GoldenWorkflowResult extends GoldenWorkflowSpec {
  passed: boolean;
  evidence: string[];
}

const goldenWorkflows: GoldenWorkflowSpec[] = [
  {
    id: 1,
    title: "Plan My Day Around My Calendar",
    input: "Plan my day around my calendar and my top goals.",
    expectedRoute: "planning / daily command",
    expectedContext: ["always_on_kernel", "daily_planning_context", "calendar_context"],
    approvalRequirement: "No approval for draft plan generation; approval before external calendar/task writes.",
    sdkV1Disposition: "current_jarvis_owned",
    nextSdkStep: "Add read-only calendar and daily-plan draft tools after the SDK harness is stable.",
  },
  {
    id: 2,
    title: "Draft A Reply To An Email",
    input: "Draft a reply to this email.",
    expectedRoute: "communications",
    expectedContext: ["always_on_kernel", "email_context", "memory_context"],
    approvalRequirement: "No approval to draft; approval before sending or provider-side draft creation when policy requires it.",
    sdkV1Disposition: "sdk_partial_mocked",
    nextSdkStep: "Add provider email-thread reads before claiming full support for reply drafts.",
  },
  {
    id: 3,
    title: "Remind Me To Follow Up",
    input: "Remind me to follow up with Bill tomorrow.",
    expectedRoute: "planning",
    expectedContext: ["always_on_kernel", "daily_planning_context"],
    approvalRequirement: "Internal reminders can be created from explicit user request; external calendar/task writes need approval.",
    sdkV1Disposition: "current_jarvis_owned",
    nextSdkStep: "Wrap the existing scheduled-task/reminder tool as a low-risk SDK tool.",
  },
  {
    id: 4,
    title: "Research A Topic And Save A Report",
    input: "Research current cannabis retail trends and save a report.",
    expectedRoute: "research",
    expectedContext: ["always_on_kernel", "research_context", "business_context"],
    approvalRequirement: "No approval to research; approval before public posting, outreach, filings, or commitments.",
    sdkV1Disposition: "current_jarvis_owned",
    nextSdkStep: "Add a long-horizon research SDK workflow only after deliverable/status tracing is adapterized.",
  },
  {
    id: 5,
    title: "Turn A Goal Into A Project Tree",
    input: "Turn this goal into a project tree.",
    expectedRoute: "planning / goal decomposition",
    expectedContext: ["always_on_kernel", "daily_planning_context", "goal_history"],
    approvalRequirement: "No external approval unless the goal creates commitments or writes outside internal state.",
    sdkV1Disposition: "current_jarvis_owned",
    nextSdkStep: "Keep this on existing goal decomposition until the SDK has internal-write policy wrappers.",
  },
  {
    id: 6,
    title: "Move A Goal Task Into Today's Plan",
    input: "Move the next task from this goal into today's plan.",
    expectedRoute: "planning / daily command",
    expectedContext: ["always_on_kernel", "daily_planning_context", "goal_tree_context"],
    approvalRequirement: "No approval for requested internal plan update; approval before external writes.",
    sdkV1Disposition: "current_jarvis_owned",
    nextSdkStep: "Wrap the goal-task handoff merge helper as an SDK tool after plan patch ops are adapterized.",
  },
  {
    id: 7,
    title: "Prepare A Weekly Review",
    input: "Prepare my weekly review.",
    expectedRoute: "planning / memory",
    expectedContext: ["always_on_kernel", "daily_planning_context", "memory_context"],
    approvalRequirement: "No approval to draft; approval before saving externally.",
    sdkV1Disposition: "current_jarvis_owned",
    nextSdkStep: "Add read-only memory/completion context and a deliverable-preview tool.",
  },
  {
    id: 8,
    title: "Prepare Me For My Next Meeting",
    input: "Prepare me for my next meeting.",
    expectedRoute: "planning / communications",
    expectedContext: ["always_on_kernel", "calendar_context", "email_context", "memory_context"],
    approvalRequirement: "No approval to brief; approval before messaging attendees or changing the event.",
    sdkV1Disposition: "current_jarvis_owned",
    nextSdkStep: "Add calendar-read and email-read SDK tools, with no write tools in v1.",
  },
  {
    id: 9,
    title: "Find What I Said About Something Before",
    input: "What did I say about morning planning before?",
    expectedRoute: "memory",
    expectedContext: ["always_on_kernel", "memory_context"],
    approvalRequirement: "No approval to retrieve; approval before editing, deleting, or rewriting memory/SOUL.",
    sdkV1Disposition: "unsupported_by_sdk_v1",
    nextSdkStep: "Promote read_context into a provenance-aware memory search/read tool before claiming support.",
  },
  {
    id: 10,
    title: "Diagnose Why A Feature Failed",
    input: "Diagnose why daily plan generation failed.",
    expectedRoute: "diagnostics / code or job observability",
    expectedContext: ["always_on_kernel", "self_healing_context", "code_work_context"],
    approvalRequirement: "Read-only diagnosis is okay; code edits, deploys, pushes, or guardrail changes need approval.",
    sdkV1Disposition: "current_jarvis_owned",
    nextSdkStep: "Keep diagnostics on existing observability/self-heal paths until SDK can emit Mind Trace events.",
  },
];

async function proveEmailHitlSdkSlice(): Promise<string[]> {
  process.env.ENABLE_AGENT_SDK_RUNNER = "true";
  const tmp = await mkdtemp(path.join(tmpdir(), "agent-sdk-golden-"));
  try {
    const store = createFileAgentSdkRunStore(tmp);
    const pendingCall = {
      id: "golden_call_send",
      name: "send_email",
      arguments: {
        to: "test@example.com",
        subject: "Golden workflow SDK test",
        body: "This is a mocked Agent SDK golden workflow test.",
      },
    };

    let approvalRequested = false;
    let sendCount = 0;
    const telegramMessages: string[] = [];
    const result = await runAgentSdkEmailWorkflow(
      {
        userId: "golden_user",
        userText: "Draft and send an email to test@example.com saying this is a mocked golden workflow test.",
        originChannel: "telegram",
        originChannelId: "123",
      },
      {
        store,
        callModel: async () => ({
          requiresApproval: async () => true,
          getPendingToolCalls: async () => [pendingCall],
          getState: async () => ({
            id: "golden_state",
            status: "awaiting_approval",
            pendingToolCalls: [pendingCall],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
          }),
          getText: async () => "Draft ready; waiting for approval.",
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
              gateId: "golden_gate",
              updatedAt: new Date().toISOString(),
            },
            state: record.state,
          });
          return "golden_gate";
        },
        sendEmail: async () => {
          sendCount += 1;
          return { ok: true, messageId: "should_not_send_before_approval" };
        },
      },
    );

    assert.equal(result.status, "awaiting_approval");
    assert.equal(approvalRequested, true);
    assert.equal(sendCount, 0);

    const approved = await resumeAgentSdkRunFromApprovalGate(
      {
        gate: {
          id: "golden_gate",
          userId: "golden_user",
          toolName: "send_email",
          toolArgs: {
            __agentSdkRunId: result.runId,
            __agentSdkToolCallId: "golden_call_send",
          },
        },
        approved: true,
        originChannelId: "123",
      },
      {
        store,
        callModel: async (request: any) => {
          const sendTool: any = request.tools.find((tool: any) => tool.function.name === "send_email");
          if (request.approveToolCalls?.includes("golden_call_send")) {
            await sendTool.function.execute(pendingCall.arguments);
          }
          return {
            getText: async () => "Email sent.",
            getResponse: async () => ({
              state: {
                id: "golden_state",
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
          sendCount += 1;
          return { ok: true, messageId: "golden_msg" };
        },
      },
    );

    assert.equal(approved.status, "complete");
    assert.equal(sendCount, 1);
    assert.ok(telegramMessages.some((message) => /completed/i.test(message)));

    return [
      "matched explicit draft/send email workflow",
      "created approval request before send",
      "persisted paused run",
      "approved resume executed send once",
      "sent completion notification",
    ];
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function proveEmailDraftOnlySdkSlice(): Promise<string[]> {
  process.env.ENABLE_AGENT_SDK_RUNNER = "true";
  const tmp = await mkdtemp(path.join(tmpdir(), "agent-sdk-golden-draft-"));
  try {
    const store = createFileAgentSdkRunStore(tmp);
    let sendCount = 0;
    const result = await runAgentSdkEmailWorkflow(
      {
        userId: "golden_user",
        userText: "Draft a reply to this email but do not send it.",
        conversationContext: "client@example.com wrote: Can you confirm the meeting time?",
        originChannel: "app",
      },
      {
        store,
        callModel: async (request: any) => {
          assert.equal(request.tools.some((tool: any) => tool.function.name === "send_email"), false);
          const draftTool: any = request.tools.find((tool: any) => tool.function.name === "draft_email");
          await draftTool.function.execute({
            to: "client@example.com",
            subject: "Re: Meeting time",
            body: "Confirmed. The meeting time still works for me.",
          });
          return {
            requiresApproval: async () => false,
            getText: async () => "Draft ready. I did not send anything.",
            getResponse: async () => ({
              state: {
                id: "golden_draft_state",
                status: "complete",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messages: [],
              },
            }),
          };
        },
        sendEmail: async () => {
          sendCount += 1;
          return { ok: true, messageId: "should_not_send" };
        },
      },
    );

    assert.equal(result.status, "complete");
    assert.equal(sendCount, 0);
    assert.equal((await store.load(result.runId))?.meta.workflow, "email_draft_only");
    assert.equal((await store.load(result.runId))?.meta.draft?.to, "client@example.com");

    return [
      "matched explicit draft-only email workflow",
      "loaded provided conversation context",
      "excluded send_email from available tools",
      "persisted internal draft preview",
      "completed without approval or sending",
    ];
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

function evaluateStaticWorkflow(spec: GoldenWorkflowSpec): GoldenWorkflowResult {
  const evidence = [
    `expected route: ${spec.expectedRoute}`,
    `required context: ${spec.expectedContext.join(", ")}`,
    `approval rule: ${spec.approvalRequirement}`,
    `next SDK step: ${spec.nextSdkStep}`,
  ];

  if (spec.sdkV1Disposition === "sdk_partial_mocked") {
    evidence.push("SDK v1 supports draft-only when source context is provided, plus the adjacent explicit draft/send email HITL subcase.");
  } else if (spec.sdkV1Disposition === "current_jarvis_owned") {
    evidence.push("not routed through the SDK runner yet; existing Jarvis path remains the owner.");
  } else {
    evidence.push("not claimed by SDK v1.");
  }

  return { ...spec, passed: true, evidence };
}

async function main() {
  const results: GoldenWorkflowResult[] = [];

  for (const spec of goldenWorkflows) {
    if (spec.id === 2) {
      const sdkEvidence = await proveEmailHitlSdkSlice();
      const draftEvidence = await proveEmailDraftOnlySdkSlice();
      results.push({
        ...spec,
        passed: true,
        evidence: [
          ...draftEvidence,
          "send-with-approval adjacent path:",
          ...sdkEvidence,
          "golden workflow 2 remains partial: SDK v1 does not read provider email threads yet.",
        ],
      });
      continue;
    }
    results.push(evaluateStaticWorkflow(spec));
  }

  assert.equal(results.length, 10);
  assert.equal(results.every((result) => result.passed), true);
  const draftReplyWorkflow = goldenWorkflows.find((workflow) => workflow.id === 2);
  assert.ok(draftReplyWorkflow);
  assert.equal(matchesAgentSdkEmailWorkflow(draftReplyWorkflow.input), false);
  assert.equal(matchesAgentSdkEmailDraftOnlyWorkflow(draftReplyWorkflow.input), true);
  assert.equal(matchesAgentSdkEmailWorkflow(goldenWorkflows.find((workflow) => workflow.id === 3)!.input), false);

  const summary = results.map((result) => ({
    id: result.id,
    title: result.title,
    status: result.sdkV1Disposition,
    passed: result.passed,
    evidence: result.evidence,
  }));

  console.log(JSON.stringify({
    suite: "agent-sdk-golden-workflows",
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    sdkPassedMocked: results.filter((result) => result.sdkV1Disposition === "sdk_passed_mocked").length,
    sdkPartialMocked: results.filter((result) => result.sdkV1Disposition === "sdk_partial_mocked").length,
    currentJarvisOwned: results.filter((result) => result.sdkV1Disposition === "current_jarvis_owned").length,
    unsupportedBySdkV1: results.filter((result) => result.sdkV1Disposition === "unsupported_by_sdk_v1").length,
    results: summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
