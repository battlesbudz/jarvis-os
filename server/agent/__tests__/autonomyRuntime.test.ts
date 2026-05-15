import assert from "node:assert/strict";
import { routeAutonomyRequest } from "../autonomyRuntime";

async function main(): Promise<void> {
  {
    const submitted: Array<{ agentType: string; title: string; prompt: string; input?: Record<string, unknown> }> = [];
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
      },
    );

    assert.equal(result.handled, true);
    assert.equal(result.decision.mode, "queue_background_job");
    assert.equal(result.jobId, "job_abc");
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].agentType, "deep_research");
    assert.equal(submitted[0].input?.originChannel, "Gateway");
    assert.equal(submitted[0].input?.autonomyPolicy, true);
  }

  {
    let submitCalls = 0;
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
      },
    );

    assert.equal(result.handled, true);
    assert.equal(result.decision.mode, "requires_approval");
    assert.match(result.reply || "", /need explicit approval/i);
    assert.equal(submitCalls, 0);
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
      },
    );

    assert.equal(readinessChecked, true);
    assert.equal(result.handled, true);
    assert.equal(result.decision.mode, "blocked_by_setup");
    assert.match(result.reply || "", /jarvis os setup is not ready/i);
  }

  console.log("All autonomy runtime assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
