import assert from "node:assert/strict";
import {
  buildPrimeRuntimeMindTrace,
  handlePrimeInput,
  type PrimeRuntimeMindTraceObservation,
} from "../autonomyRuntime";

async function main(): Promise<void> {
  const previousPrime = process.env.ENABLE_PRIME_RUNTIME;

  try {
    process.env.ENABLE_PRIME_RUNTIME = "true";

    {
      const observations: PrimeRuntimeMindTraceObservation[] = [];
      const result = await handlePrimeInput(
        {
          userId: "user-prime-trace",
          channel: "discord",
          message: "Remind me to call Bill tomorrow at 9am.",
          metadata: { originChannelId: "discord-channel-1" },
        },
        {
          runAgentSdkReminderWorkflow: async () => ({
            handled: true,
            status: "complete",
            runId: "sdk-reminder-run-1",
            reply: "Reminder saved.",
          }),
          observePrimeDecision: (observation) => {
            observations.push(observation);
          },
        },
      );

      assert.equal(result.handled, true);
      assert.equal(result.decision.routeChosen, "jarvis_agent_sdk_reminder");
      assert.equal(observations.length, 1);
      assert.equal(observations[0].trace.channel, "discord");
      assert.equal(observations[0].trace.routeChosen, "jarvis_agent_sdk_reminder");
      assert.equal(observations[0].trace.approval.required, false);
      assert.ok(observations[0].trace.contextLoaded.includes("prime_runtime"));
      assert.match(observations[0].trace.confidenceNotes[0] ?? "", /PRIME kind=direct_response/);
      console.log("OK: handlePrimeInput captures handled PRIME decisions as Mind Trace observations");
    }

    {
      const observations: PrimeRuntimeMindTraceObservation[] = [];
      const result = await handlePrimeInput(
        {
          userId: "user-prime-fallback",
          channel: "discord",
          message: "What should I focus on today?",
        },
        {
          runAgentSdkReminderWorkflow: async () => ({ handled: false }),
          runAgentSdkEmailWorkflow: async () => ({ handled: false }),
          handleDirectEmailApprovalRequest: async () => ({ handled: false }),
          handleDirectReminderRequest: async () => ({ handled: false }),
          observePrimeDecision: (observation) => {
            observations.push(observation);
          },
        },
      );

      assert.equal(result.handled, false);
      assert.equal(result.decision.routeChosen, "legacy_fallback");
      assert.equal(observations.length, 1);
      assert.equal(observations[0].trace.routeChosen, "legacy_fallback");
      assert.match(observations[0].trace.uncertaintyNotes[0] ?? "", /legacy channel path/);
      console.log("OK: handlePrimeInput captures fallback PRIME decisions without claiming ownership");
    }

    {
      const trace = buildPrimeRuntimeMindTrace(
        {
          userId: "user-prime-tool",
          channel: "discord",
          message: "Send an email to Bill.",
        },
        {
          handled: true,
          kind: "approval_request",
          reply: "Approval needed.",
          approvalRequest: { gateId: "gate-prime-email" },
          decision: {
            taskTypeDetected: "email",
            routeChosen: "direct_email_approval_gate",
            riskLevel: "high",
            approvalRequired: true,
            modelRouting: "none",
            bypassesPrime: false,
            reason: "Email send requires approval.",
          },
        },
        new Date("2026-06-08T20:00:00.000Z"),
      );

      assert.equal(trace.traceId.startsWith("prime-"), true);
      assert.equal(trace.routeChosen, "direct_email_approval_gate");
      assert.equal(trace.taskTypeDetected, "email_action");
      assert.equal(trace.approval.required, true);
      assert.equal(trace.approval.gateId, "gate-prime-email");
      assert.equal(trace.toolsCalled[0]?.name, "prime_approval_request");
      assert.equal(trace.toolsCalled[0]?.status, "blocked");
      console.log("OK: PRIME Mind Trace builder records approval gates and runtime route metadata");
    }

    console.log("\nAll PRIME runtime Mind Trace assertions passed.");
  } finally {
    if (previousPrime === undefined) {
      delete process.env.ENABLE_PRIME_RUNTIME;
    } else {
      process.env.ENABLE_PRIME_RUNTIME = previousPrime;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
