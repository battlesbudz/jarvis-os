import assert from "node:assert/strict";

import {
  ABOUT_YOU_GROUNDING_QUERY,
  buildGroundingQueryPlan,
  classifyGroundingIntent,
  shouldGroundPersonalMemoryRequest,
} from "../groundingQueryPlanner";

function testBroadPersonalSummary(): void {
  const plan = buildGroundingQueryPlan({ requestText: "What do you know about me?" });
  assert.equal(plan.intent, "broad_personal_summary");
  assert.deepEqual(plan.queries, [{ id: "primary", purpose: "primary", query: ABOUT_YOU_GROUNDING_QUERY }]);
  assert.deepEqual(plan.sources, { profile: true, soul: true, memory: true, commitments: true });
  assert.equal(plan.canonicalOnly, true);
  assert.equal(classifyGroundingIntent("What have I told you?"), "broad_personal_summary");
}

function testTemporalPlanning(): void {
  const plan = buildGroundingQueryPlan({
    requestText: "What was that thing I decided about the Android app a while ago?",
  });
  assert.equal(plan.intent, "temporal_recall");
  assert.equal(plan.queries.length, 2);
  assert.equal(plan.queries[0]?.purpose, "primary");
  assert.equal(plan.queries[1]?.purpose, "temporal");
  assert.match(plan.queries[1]?.query ?? "", /Android app/i);
  assert.match(plan.queries[1]?.query ?? "", /current latest updated supersedes/);
  assert.deepEqual(plan.sources, { profile: false, soul: false, memory: true, commitments: false });
}

function testIntentSpecificSources(): void {
  const relationship = buildGroundingQueryPlan({
    requestText: "What did I tell you about my project collaborator?",
  });
  assert.equal(relationship.intent, "relationship_recall");
  assert.equal(relationship.queries[1]?.purpose, "relationship");

  const commitments = buildGroundingQueryPlan({
    requestText: "What are my current commitments?",
  });
  assert.equal(commitments.intent, "commitment_status");
  assert.equal(commitments.sources.commitments, true);
  assert.equal(commitments.sources.profile, true);

  const forwardCommitments = buildGroundingQueryPlan({
    requestText: "Do I have any pending tasks?",
  });
  assert.equal(forwardCommitments.intent, "commitment_status");
  assert.equal(forwardCommitments.sources.commitments, true);
  assert.equal(forwardCommitments.queries[1]?.purpose, "commitment");
  assert.equal(classifyGroundingIntent("Do I have any deadlines?"), "commitment_status");
  assert.equal(shouldGroundPersonalMemoryRequest("Do I have any pending tasks?"), true);

  assert.equal(classifyGroundingIntent("What is my timezone?"), "profile_recall");
  assert.equal(classifyGroundingIntent("What is my current timezone?"), "profile_recall");
  assert.equal(classifyGroundingIntent("What is my current preference for local voice?"), "temporal_recall");
  assert.equal(classifyGroundingIntent("What are Kubernetes tasks?"), "exact_recall");
  assert.equal(classifyGroundingIntent("Explain project goals in OKRs."), "exact_recall");
  assert.equal(classifyGroundingIntent("What is your name?"), "exact_recall");
  assert.equal(classifyGroundingIntent("What's the latest Android version?"), "exact_recall");
  assert.equal(classifyGroundingIntent("Do you remember the latest Android version?"), "exact_recall");
  assert.equal(shouldGroundPersonalMemoryRequest("Do you remember the latest Android version?"), false);
  assert.equal(classifyGroundingIntent("Explain family relationships."), "exact_recall");
  assert.equal(classifyGroundingIntent("What's on my current screen?"), "exact_recall");
  assert.equal(classifyGroundingIntent("What are my current notifications?"), "exact_recall");
  assert.equal(classifyGroundingIntent("What have I told you about Android speech?"), "exact_recall");

  const topicPlan = buildGroundingQueryPlan({
    requestText: "What have I told you about Android speech?",
    explicitQuery: "Android speech",
  });
  assert.deepEqual(topicPlan.sources, { profile: false, soul: false, memory: true, commitments: false });
  assert.deepEqual(topicPlan.queries, [{ id: "primary", purpose: "primary", query: "Android speech" }]);
}

function testExplicitQueryAndGroundingBoundary(): void {
  const plan = buildGroundingQueryPlan({
    requestText: "What did I decide about Android speech before?",
    explicitQuery: "Android native speech decision",
  });
  assert.equal(plan.queries[0]?.query, "Android native speech decision");
  assert.equal(plan.queries.length, 2);

  assert.equal(shouldGroundPersonalMemoryRequest("Do you remember what I decided about Android speech?"), true);
  assert.equal(shouldGroundPersonalMemoryRequest("Remember that my birthday is Jan 1"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("Can you remember that my birthday is Jan 1?"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("Do you remember that my birthday is Jan 1?"), true);
  assert.equal(shouldGroundPersonalMemoryRequest("Show memories about native speech."), true);
  assert.equal(shouldGroundPersonalMemoryRequest("What do you know about Kubernetes?"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("How are you today?"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("How do I debug an Android memory leak?"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("How does memory recall work?"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("What are Kubernetes tasks?"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("Explain project goals in OKRs."), false);
  assert.equal(shouldGroundPersonalMemoryRequest("What is your name?"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("What's the latest Android version?"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("Explain family relationships."), false);
  assert.equal(shouldGroundPersonalMemoryRequest("What's on my current screen?"), false);
  assert.equal(shouldGroundPersonalMemoryRequest("What are my current notifications?"), false);
}

function main(): void {
  testBroadPersonalSummary();
  testTemporalPlanning();
  testIntentSpecificSources();
  testExplicitQueryAndGroundingBoundary();
  console.log("OK: grounding query planner chooses bounded queries and source contracts");
}

main();
