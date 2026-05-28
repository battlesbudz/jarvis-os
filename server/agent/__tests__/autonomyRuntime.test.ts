import assert from "node:assert/strict";
import { routeAutonomyRequest, type AutonomyRuntimeObservation } from "../autonomyRuntime";

async function main(): Promise<void> {
  {
    const submitted: Array<{ agentType: string; title: string; prompt: string; input?: Record<string, unknown> }> = [];
    const observations: AutonomyRuntimeObservation[] = [];
    const result = await routeAutonomyRequest(
      {
        userId: "user_1",
        userText: "Research the best CRM for my cannabis microbusiness and make a report",
        channelName: "Gateway",
        readiness: "ready",
      },
      {
        submitJob: async (job) => {
          submitted.push(job);
          return { id: "job_abc", isDuplicate: false };
        },
        observeDecision: (observation) => {
          observations.push(observation);
        },
      },
    );

    assert.equal(result.handled, true);
    assert.equal(result.decision.mode, "queue_background_job");
    assert.equal(result.jobId, "job_abc");
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].agentType, "deep_research");
    assert.equal(submitted[0].input?.originChannel, "Gateway");
    assert.equal(submitted[0].input?.autonomyPolicy, true);
    assert.deepEqual(observations, [
      {
        mode: "queue_background_job",
        userId: "user_1",
        originChannel: "Gateway",
        readinessStatus: "ready",
        readinessReady: true,
        agentType: "deep_research",
        jobId: "job_abc",
      },
    ]);
  }

  {
    let submitCalls = 0;
    const observations: AutonomyRuntimeObservation[] = [];
    const approvalRequests: Array<{
      agentId: string;
      userId: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
      description: string;
      initiatedBy?: string;
    }> = [];
    const notifications: Array<Record<string, unknown>> = [];
    const result = await routeAutonomyRequest(
      {
        userId: "user_1",
        userText: "Send this email to the regulator",
        channelName: "Gateway",
        readiness: "ready",
      },
      {
        submitJob: async () => {
          submitCalls += 1;
          return { id: "should_not_happen", isDuplicate: false };
        },
        requestApproval: async (request) => {
          approvalRequests.push(request);
          return { id: "gate_123", status: "pending" };
        },
        notifyApproval: async (payload) => {
          notifications.push(payload as unknown as Record<string, unknown>);
        },
        observeDecision: (observation) => {
          observations.push(observation);
        },
      },
    );

    assert.equal(result.handled, true);
    assert.equal(result.decision.mode, "requires_approval");
    assert.equal(result.gateId, "gate_123");
    assert.match(result.reply || "", /approval request/i);
    assert.equal(submitCalls, 0);
    assert.equal(approvalRequests.length, 1);
    assert.equal(approvalRequests[0].agentId, "coach_app:user_1");
    assert.equal(approvalRequests[0].userId, "user_1");
    assert.equal(approvalRequests[0].toolName, "send_email");
    assert.equal(approvalRequests[0].toolArgs.topLevelAutonomy, true);
    assert.equal(approvalRequests[0].toolArgs.userText, "Send this email to the regulator");
    assert.equal(approvalRequests[0].toolArgs.channelName, "Gateway");
    assert.equal(approvalRequests[0].initiatedBy, "user");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].gateId, "gate_123");
    assert.equal(notifications[0].originChannel, "Gateway");
    assert.equal(notifications[0].toolName, "send_email");
    assert.deepEqual(observations, [
      {
        mode: "requires_approval",
        userId: "user_1",
        originChannel: "Gateway",
        readinessStatus: "ready",
        readinessReady: true,
        approvalBoundary: "top_level_external_action",
        approvalToolName: "send_email",
        approvalGateId: "gate_123",
      },
    ]);
  }

  {
    const result = await routeAutonomyRequest({
      userId: "user_1",
      userText: "What should I focus on today?",
      channelName: "Gateway",
      readiness: "ready",
    });

    assert.equal(result.handled, false);
    assert.equal(result.decision.mode, "answer_inline");
  }

  {
    let readinessChecked = false;
    const observations: AutonomyRuntimeObservation[] = [];
    const result = await routeAutonomyRequest(
      {
        userId: "user_1",
        userText: "Analyze my inbox and draft replies",
        channelName: "Gateway",
      },
      {
        getReadiness: async () => {
          readinessChecked = true;
          return "blocked";
        },
        observeDecision: (observation) => {
          observations.push(observation);
        },
      },
    );

    assert.equal(readinessChecked, true);
    assert.equal(result.handled, true);
    assert.equal(result.decision.mode, "blocked_by_setup");
    assert.match(result.reply || "", /jarvis os setup is not ready/i);
    assert.deepEqual(observations, [
      {
        mode: "blocked_by_setup",
        userId: "user_1",
        originChannel: "Gateway",
        readinessStatus: "blocked",
        readinessReady: false,
      },
    ]);
  }

  {
    const observations: AutonomyRuntimeObservation[] = [];
    await assert.rejects(
      () =>
        routeAutonomyRequest(
          {
            userId: "user_1",
            userText: "Research CRM failure handling",
            channelName: "Gateway",
            readiness: "ready",
          },
          {
            submitJob: async () => {
              throw new Error("queue unavailable");
            },
            observeDecision: (observation) => {
              observations.push(observation);
            },
          },
        ),
      /queue unavailable/,
    );
    assert.deepEqual(observations, [
      {
        mode: "queue_background_job",
        userId: "user_1",
        originChannel: "Gateway",
        readinessStatus: "ready",
        readinessReady: true,
        agentType: "deep_research",
        error: "queue unavailable",
      },
    ]);
  }

  {
    const observations: AutonomyRuntimeObservation[] = [];
    await assert.rejects(
      () =>
        routeAutonomyRequest(
          {
            userId: "user_1",
            userText: "Send this email after approval fails",
            channelName: "Gateway",
            readiness: "ready",
          },
          {
            requestApproval: async () => {
              throw new Error("approval store unavailable");
            },
            observeDecision: (observation) => {
              observations.push(observation);
            },
          },
        ),
      /approval store unavailable/,
    );
    assert.deepEqual(observations, [
      {
        mode: "requires_approval",
        userId: "user_1",
        originChannel: "Gateway",
        readinessStatus: "ready",
        readinessReady: true,
        approvalBoundary: "top_level_external_action",
        approvalToolName: "send_email",
        approvalGateId: undefined,
        error: "approval store unavailable",
      },
    ]);
  }

  console.log("All autonomy runtime assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
