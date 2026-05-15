import assert from "node:assert/strict";
import { decideAutonomyMode } from "../autonomyPolicy";

{
  const decision = decideAutonomyMode({
    userText: "Research the best CRM for a cannabis microbusiness and make a report",
    readiness: "ready",
    hasApproval: false,
  });

  assert.equal(decision.mode, "queue_background_job");
  assert.equal(decision.agentType, "deep_research");
}

{
  const decision = decideAutonomyMode({
    userText: "Send this email to the regulator",
    readiness: "ready",
    hasApproval: false,
  });

  assert.equal(decision.mode, "requires_approval");
  assert.match(decision.reason, /external action/i);
}

{
  const decision = decideAutonomyMode({
    userText: "What should I focus on today?",
    readiness: "ready",
    hasApproval: false,
  });

  assert.equal(decision.mode, "answer_inline");
}

{
  const decision = decideAutonomyMode({
    userText: "Analyze my inbox and draft replies",
    readiness: "blocked",
    hasApproval: false,
  });

  assert.equal(decision.mode, "blocked_by_setup");
}

console.log("All autonomy policy assertions passed.");
