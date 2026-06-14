import assert from "node:assert/strict";
import {
  handleJarvisApprovalDecision,
  handleJarvisInput,
  isJarvisCoreRuntimeEnabled,
} from "../jarvisCoreRuntime";
import type { ApprovalGate } from "../agentApproval";

async function main() {
  process.env.ENABLE_JARVIS_CORE_RUNTIME = "false";
  assert.equal(isJarvisCoreRuntimeEnabled(), false);
  const disabled = await handleJarvisInput({
    userId: "user_1",
    channel: "appchat",
    message: "Remind me in an hour to call Bill.",
  });
  assert.equal(disabled.handled, false);

  process.env.ENABLE_JARVIS_CORE_RUNTIME = "true";
  assert.equal(isJarvisCoreRuntimeEnabled(), true);

  const sdkEmail = await handleJarvisInput(
    {
      userId: "user_1",
      channel: "appchat",
      message: "Draft and send an email to sam@example.com saying hello.",
      metadata: { messages: [{ role: "user", content: "Draft and send an email to sam@example.com saying hello." }] },
    },
    {
      runAgentSdkReminderWorkflow: async () => ({ handled: false }),
      runAgentSdkEmailWorkflow: async () => ({
        handled: true,
        status: "awaiting_approval",
        runId: "run_1",
        gateId: "gate_1",
        reply: "Draft ready. Waiting for approval.",
      }),
      handleDirectReminderRequest: async () => ({ handled: false }),
    },
  );
  assert.equal(sdkEmail.handled, true);
  assert.equal(sdkEmail.kind, "approval_request");
  assert.equal(sdkEmail.approvalRequest?.gateId, "gate_1");
  assert.equal(sdkEmail.decision.routeChosen, "jarvis_agent_sdk_email");
  assert.equal(sdkEmail.decision.modelRouting, "codex_oauth_gateway");

  const sdkSetupFallback = await handleJarvisInput(
    {
      userId: "user_1",
      channel: "appchat",
      message: "Draft and send an email to sam@example.com with subject Test and body Hello there. Ask me for approval before sending.",
      metadata: { messages: [{ role: "user", content: "Draft and send an email to sam@example.com with subject Test and body Hello there. Ask me for approval before sending." }] },
    },
    {
      runAgentSdkReminderWorkflow: async () => ({ handled: false }),
      runAgentSdkEmailWorkflow: async () => ({
        handled: true,
        status: "failed",
        runId: "run_setup_missing",
        reply: "Agent SDK email workflow failed: model provider is not configured",
        error: "model provider is not configured",
      }),
      handleDirectEmailApprovalRequest: async () => ({
        handled: true,
        reply: "Approval card created.",
        gateId: "gate_fallback",
      }),
      handleDirectReminderRequest: async () => ({ handled: false }),
    },
  );
  assert.equal(sdkSetupFallback.kind, "approval_request");
  assert.equal(sdkSetupFallback.approvalRequest?.gateId, "gate_fallback");
  assert.equal(sdkSetupFallback.decision.routeChosen, "direct_email_approval_gate");

  const directReminder = await handleJarvisInput(
    {
      userId: "user_1",
      channel: "appchat",
      message: "Remind me later to call Bill.",
    },
    {
      runAgentSdkReminderWorkflow: async () => ({ handled: false }),
      runAgentSdkEmailWorkflow: async () => ({ handled: false }),
      handleDirectReminderRequest: async () => ({
        handled: true,
        reply: "Scheduled.",
        toolResult: { ok: true, label: "Scheduled: Call Bill", detail: { id: "task_1" } },
      }),
    },
  );
  assert.equal(directReminder.kind, "tool_action");
  assert.equal(directReminder.toolAction?.tool, "schedule_jarvis_task");

  const appAutonomy = await handleJarvisInput(
    {
      userId: "user_1",
      channel: "appchat",
      message: "Research this and create a report.",
    },
    {
      runAgentSdkReminderWorkflow: async () => ({ handled: false }),
      runAgentSdkEmailWorkflow: async () => ({ handled: false }),
      handleDirectReminderRequest: async () => ({ handled: false }),
      routeAppCoachChatAutonomy: async () => ({
        handled: true,
        reply: "Queued research job.",
        jobId: "job_1",
        decision: {
          mode: "queue_background_job",
          reason: "Research should run as a background job.",
          agentType: "research",
        },
      }),
    },
  );
  assert.equal(appAutonomy.kind, "background_job");
  assert.equal(appAutonomy.backgroundJob?.jobId, "job_1");

  const gate: ApprovalGate = {
    id: "gate_1",
    userId: "user_1",
    agentId: "jarvis-agent-sdk-hitl",
    toolName: "send_email",
    toolArgs: { __jarvisAgentSdkRun: true },
    description: "Approve send.",
    status: "pending",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
  };
  const approval = await handleJarvisApprovalDecision(
    { gate, approved: true },
    {
      isAgentSdkApprovalGate: async () => true,
      resumeAgentSdkRunFromApprovalGate: async () => ({ handled: true, status: "complete", runId: "run_1" }),
    },
  );
  assert.equal(approval.handled, true);
  assert.equal(approval.decision.routeChosen, "jarvis_agent_sdk_approval_resume");
  assert.equal(approval.decision.modelRouting, "codex_oauth_gateway");

  console.log("jarvisCoreRuntime assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
