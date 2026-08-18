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
        originChannelId: "telegram-chat-1",
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
    assert.equal(submitted[0].input?.originChannelId, "telegram-chat-1");
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
    const submitted: Array<{ agentType: string; prompt: string }> = [];
    const contextualPrompt = [
      "Complete the latest user request as a self-contained background task.",
      "Relevant conversation context (oldest to newest):",
      "User: Research sunflower seed nutrition.",
      "Latest user request:",
      "Make it a PDF",
      "End latest user request.",
    ].join("\n");
    const result = await routeAutonomyRequest(
      {
        userId: "user_contextual_pdf",
        userText: "Make it a PDF",
        backgroundPrompt: contextualPrompt,
        channelName: "App Chat",
        readiness: "ready",
      },
      {
        submitJob: async (job) => {
          submitted.push({ agentType: job.agentType, prompt: job.prompt });
          return { id: "job_contextual_pdf", isDuplicate: false };
        },
      },
    );

    assert.equal(result.handled, true);
    assert.equal(result.decision.agentType, "deep_research");
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].agentType, "deep_research");
    assert.equal(submitted[0].prompt, contextualPrompt);
  }

  {
    const submitted: Array<{ agentType: string; prompt: string }> = [];
    const contextualPrompt = [
      "Complete the latest user request as a self-contained background task.",
      "Relevant conversation context (oldest to newest):",
      "User: Summarize these notes.",
      "Assistant: Here is the concise summary.",
      "Latest user request:",
      "Make it a PDF",
      "End latest user request.",
    ].join("\n");
    const result = await routeAutonomyRequest(
      {
        userId: "user_inline_summary_pdf",
        userText: "Make it a PDF",
        backgroundPrompt: contextualPrompt,
        channelName: "App Chat",
        readiness: "ready",
      },
      {
        submitJob: async (job) => {
          submitted.push({ agentType: job.agentType, prompt: job.prompt });
          return { id: "job_inline_summary_pdf", isDuplicate: false };
        },
      },
    );
    assert.equal(result.handled, true);
    assert.equal(result.decision.agentType, "writing");
    assert.deepEqual(submitted, [{ agentType: "writing", prompt: contextualPrompt }]);
  }

  {
    const submitted: Array<{ agentType: string; prompt: string }> = [];
    let approvalCalls = 0;
    const contextualPrompt = [
      "Complete the latest user request as a self-contained background task.",
      "Relevant conversation context (oldest to newest):",
      "User: Draft an email to the board.",
      "Assistant: I can send a summary when it is ready.",
      "User: Research sunflower seed nutrition.",
      "Latest user request:",
      "Make it a PDF",
      "End latest user request.",
    ].join("\n");
    const result = await routeAutonomyRequest(
      {
        userId: "user_stale_approval_context",
        userText: "Make it a PDF",
        backgroundPrompt: contextualPrompt,
        channelName: "App Chat",
        readiness: "ready",
      },
      {
        requestApproval: async () => {
          approvalCalls += 1;
          return { id: "unexpected_gate", status: "pending" };
        },
        submitJob: async (job) => {
          submitted.push({ agentType: job.agentType, prompt: job.prompt });
          return { id: "job_stale_approval_context", isDuplicate: false };
        },
      },
    );

    assert.equal(result.handled, true);
    assert.equal(result.decision.mode, "queue_background_job");
    assert.equal(result.decision.agentType, "deep_research");
    assert.equal(approvalCalls, 0);
    assert.deepEqual(submitted, [{ agentType: "deep_research", prompt: contextualPrompt }]);
  }

  for (const workerCase of [
    { text: "Write a PDF memo for the board", expectedAgentType: "writing" },
    { text: "Create a PDF project plan", expectedAgentType: "planning" },
  ]) {
    const submitted: string[] = [];
    const result = await routeAutonomyRequest(
      {
        userId: "user_worker_pdf",
        userText: workerCase.text,
        channelName: "App Chat",
        readiness: "ready",
      },
      {
        submitJob: async (job) => {
          submitted.push(job.agentType);
          return { id: `job_${workerCase.expectedAgentType}_pdf`, isDuplicate: false };
        },
      },
    );

    assert.equal(result.handled, true);
    assert.equal(result.decision.agentType, workerCase.expectedAgentType);
    assert.deepEqual(submitted, [workerCase.expectedAgentType]);
  }

  {
    let submitCalls = 0;
    const result = await routeAutonomyRequest(
      {
        userId: "user_unsupported_csv",
        userText: "Research competitors and export the results as CSV",
        channelName: "App Chat",
        readiness: "ready",
      },
      {
        submitJob: async () => {
          submitCalls += 1;
          return { id: "not_queued", isDuplicate: false };
        },
      },
    );
    assert.equal(result.handled, true);
    assert.equal(result.decision.mode, "answer_inline");
    assert.match(result.reply || "", /can’t generate CSV/i);
    assert.match(result.reply || "", /PDF or.*Markdown/i);
    assert.equal(submitCalls, 0);
  }

  for (const emailFileText of [
    "Email alice@example.com the report as a PDF",
    "Send alice@example.com the report as a PDF",
  ]) {
    let submitCalls = 0;
    let approvalCalls = 0;
    const result = await routeAutonomyRequest(
      {
        userId: "user_email_pdf",
        userText: emailFileText,
        channelName: "App Chat",
        readiness: "ready",
      },
      {
        submitJob: async () => {
          submitCalls += 1;
          return { id: "unexpected_email_pdf_job", isDuplicate: false };
        },
        requestApproval: async () => {
          approvalCalls += 1;
          return { id: "unexpected_email_pdf_gate", status: "pending" };
        },
      },
    );
    assert.equal(result.handled, true);
    assert.equal(result.decision.mode, "answer_inline");
    assert.match(result.reply || "", /can’t attach.*generated PDF/i);
    assert.equal(submitCalls, 0);
    assert.equal(approvalCalls, 0);
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
        originChannelId: "telegram-chat-2",
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
    assert.equal(approvalRequests[0].toolArgs.originChannelId, "telegram-chat-2");
    assert.equal(approvalRequests[0].initiatedBy, "user");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].gateId, "gate_123");
    assert.equal(notifications[0].originChannel, "Gateway");
    assert.equal(notifications[0].originChannelId, "telegram-chat-2");
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
