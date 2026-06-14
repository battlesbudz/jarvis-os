import assert from "node:assert/strict";
import {
  decideContextPacks,
  type ContextPackDecision,
} from "../contextPacks";
import {
  buildMindTrace,
  redactTraceValue,
} from "../mindTrace";
import {
  buildHarnessMindTrace,
  buildMindTracePersistenceRecord,
  extractMemoriesFromToolCalls,
} from "../mindTraceRecorder";
import {
  buildMemoryTrustSummary,
  normalizeMemoryTrustRecord,
} from "../../memory/trust";
import {
  buildDailyCommandStatusReasons,
} from "../../dailyCommand/planOps";

function hasPack(decision: ContextPackDecision, pack: string): boolean {
  return decision.requiredContextPacks.includes(pack as never);
}

{
  const decision = decideContextPacks({
    userMessage: "Plan my day around my calendar and today's goal tasks.",
    channel: "app",
  });

  assert.equal(decision.taskType, "daily_planning");
  assert.equal(decision.riskLevel, "medium");
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.outputDestination, "workspaces/battles/daily-command-center/");
  assert.ok(hasPack(decision, "always_on_kernel"));
  assert.ok(hasPack(decision, "daily_planning_context"));
  assert.ok(hasPack(decision, "calendar_context"));
  assert.ok(decision.toolsAllowed.includes("read_context"));
  console.log("OK: daily planning uses daily and calendar context without requiring approval");
}

{
  const decision = decideContextPacks({
    userMessage: "Send this email to Bill and add the follow-up to my calendar.",
    channel: "telegram",
  });

  assert.equal(decision.taskType, "email_action");
  assert.equal(decision.riskLevel, "high");
  assert.equal(decision.approvalRequired, true);
  assert.ok(hasPack(decision, "email_context"));
  assert.ok(hasPack(decision, "calendar_context"));
  assert.ok(decision.toolsAllowed.includes("approval_gated_action"));
  console.log("OK: external email/calendar actions require approval-gated tools");
}

{
  const decision = decideContextPacks({
    userMessage: "Fix the memory retrieval bug and explain why the feature failed.",
    channel: "app",
  });

  assert.equal(decision.taskType, "code_work");
  assert.equal(decision.riskLevel, "high");
  assert.equal(decision.approvalRequired, true);
  assert.ok(hasPack(decision, "code_work_context"));
  assert.ok(hasPack(decision, "self_healing_context"));
  assert.ok(hasPack(decision, "memory_context"));
  console.log("OK: code self-healing work loads code, self-healing, and memory context packs");
}

{
  const previous = process.env.JARVIS_BRAIN_RETRIEVAL;
  try {
    process.env.JARVIS_BRAIN_RETRIEVAL = "1";
    const decision = decideContextPacks({
      userMessage: "Why did Jarvis remember this preference?",
      channel: "app",
    });

    assert.ok(hasPack(decision, "memory_context"));
    assert.ok(hasPack(decision, "brain_context"));
    assert.ok(decision.reasons.includes("Derived brain retrieval is enabled."));
  } finally {
    if (previous === undefined) {
      delete process.env.JARVIS_BRAIN_RETRIEVAL;
    } else {
      process.env.JARVIS_BRAIN_RETRIEVAL = previous;
    }
  }

  console.log("OK: brain retrieval flag adds derived brain context to memory tasks");
}

{
  const redacted = redactTraceValue({
    token: "tok_live_secret",
    nested: {
      apiKey: "sk-secret",
      safe: "visible",
      authorization: "Bearer abc",
    },
  }) as Record<string, unknown>;

  assert.equal(redacted.token, "[redacted]");
  assert.deepEqual(redacted.nested, {
    apiKey: "[redacted]",
    safe: "visible",
    authorization: "[redacted]",
  });
  console.log("OK: mind trace redacts credential-shaped fields");
}

{
  const trace = buildMindTrace({
    traceId: "trace-test",
    userRequest: "Why did Jarvis learn that I prefer morning planning?",
    channel: "app",
    contextLoaded: ["SOUL:Relationship And Memory"],
    memoriesRetrieved: [
      {
        id: "mem-1",
        category: "preferences",
        tier: "long_term",
        memoryType: "semantic",
        confidence: 92,
        relevanceScore: 80,
        sourceType: "chat",
        reason: "Asked about morning planning preference.",
      },
    ],
    soulSectionsUsed: ["Relationship And Memory"],
    toolsCalled: [
      {
        name: "memory_search",
        status: "ok",
        args: { query: "morning planning", accessToken: "secret-token" },
      },
    ],
    confidenceNotes: ["High confidence because the matching memory was explicit."],
  });

  assert.equal(trace.traceId, "trace-test");
  assert.equal(trace.taskTypeDetected, "memory_query");
  assert.equal(trace.routeChosen, "memory");
  assert.equal(trace.memoriesRetrieved[0]?.id, "mem-1");
  assert.equal((trace.toolsCalled[0]?.argsPreview as { accessToken?: string } | undefined)?.accessToken, "[redacted]");
  assert.equal(trace.approval.required, false);
  assert.ok(trace.contextLoaded.includes("memory_context"));
  console.log("OK: mind trace explains route, context, memory, SOUL, tools, and approval state");
}

{
  const toolCalls = [
    {
      name: "memory_search",
      args: { query: "morning planning", accessToken: "secret-token" },
      result: {
        ok: true,
        label: "Memory search: morning planning",
        detail: "1 memories retrieved",
        content: [
          'Memory search returned 1 actual retrieved memory for: "morning planning"',
          "",
          "[1] [long_term/semantic] (preferences, confidence: 91%) User prefers crisp morning plans.",
        ].join("\n"),
      },
      durationMs: 12,
    },
    {
      name: "send_email",
      args: { to: "bill@example.com", body: "done" },
      result: {
        ok: false,
        label: "Blocked",
        content: "[Tool blocked] Approval required before sending email.",
      },
      durationMs: 4,
    },
  ];

  const memories = extractMemoriesFromToolCalls(toolCalls);
  assert.equal(memories.length, 1);
  assert.equal(memories[0]?.tier, "long_term");
  assert.equal(memories[0]?.memoryType, "semantic");
  assert.equal(memories[0]?.category, "preferences");
  assert.equal(memories[0]?.confidence, 91);

  const trace = buildHarnessMindTrace({
    traceId: "harness-trace-test",
    userId: "user-1",
    userRequest: "What do you remember about morning planning, then send Bill an update?",
    channel: "app",
    model: "test-model",
    turns: 2,
    finishReason: "tool_error",
    reply: "I found the memory and need approval before sending.",
    toolCalls,
    durationMs: 42,
    contextLoaded: ["workspace_context"],
  });

  assert.equal(trace.traceId, "harness-trace-test");
  assert.equal((trace.toolsCalled[0]?.argsPreview as { accessToken?: string } | undefined)?.accessToken, "[redacted]");
  assert.equal(trace.toolsCalled[1]?.status, "blocked");
  assert.equal(trace.approval.required, true);
  assert.ok(trace.contextLoaded.includes("memory_context"));
  assert.ok(trace.contextLoaded.includes("email_context"));

  const record = buildMindTracePersistenceRecord({
    traceId: "harness-row-test",
    userId: "user-1",
    userRequest: "Find the memory and draft the send.",
    channel: "app",
    turns: 2,
    finishReason: "stop",
    reply: "Draft ready.",
    toolCalls,
    durationMs: 33,
  });

  assert.equal(record.traceId, "harness-row-test");
  assert.equal(record.userRequest, "Find the memory and draft the send.");
  assert.ok(Array.isArray(record.subtasks));
  assert.ok(Array.isArray(record.results));
  assert.equal((record.results[0] as { type?: string }).type, "mind_trace");
  console.log("OK: harness Mind Trace captures real tool, memory, approval, and persistence payload events");
}

{
  const memory = normalizeMemoryTrustRecord({
    id: "mem-pending",
    content: "User prefers crisp morning plans.",
    category: "preferences",
    tier: "long_term",
    memoryType: "semantic",
    confidence: 88,
    relevanceScore: 76,
    sourceType: "chat",
    sourceRef: "conversation:123",
    pendingReview: true,
    reviewStatus: "pending",
    extractedAt: new Date("2026-05-28T12:00:00.000Z"),
    lastReferencedAt: null,
  });

  assert.equal(memory.status, "pending");
  assert.equal(memory.source.type, "chat");
  assert.equal(memory.relevance, 76);
  assert.match(memory.whyJarvisLearnedIt, /conversation/i);
  console.log("OK: memory trust records expose status, source, confidence, relevance, and why learned");
}

{
  const summary = buildMemoryTrustSummary([
    { id: "p", content: "Pending", pendingReview: true, reviewStatus: "pending" },
    { id: "a", content: "Active", pendingReview: false, reviewStatus: "active" },
    { id: "e", content: "Edited", pendingReview: false, reviewStatus: "edited" },
    { id: "d", content: "Discarded", pendingReview: true, reviewStatus: "discarded" },
  ]);

  assert.equal(summary.counts.pending, 1);
  assert.equal(summary.counts.active, 1);
  assert.equal(summary.counts.edited, 1);
  assert.equal(summary.counts.rejected, 1);
  assert.deepEqual(summary.buckets.pending.map((m) => m.id), ["p"]);
  console.log("OK: memory trust summary groups pending, active, edited, and rejected memories");
}

{
  const reasons = buildDailyCommandStatusReasons({
    activeJobsCount: 1,
    failedJobsCount: 1,
    pendingApprovalCount: 2,
    planTaskCount: 0,
    contextWarnings: [
      { source: "calendar", severity: "error", message: "Calendar unavailable" },
    ],
  });

  assert.equal(reasons[0]?.state, "waiting_approval");
  assert.ok(reasons.some((reason) => reason.state === "working"));
  assert.ok(reasons.some((reason) => reason.state === "failed" && reason.action === "retry_available"));
  assert.ok(reasons.some((reason) => reason.state === "blocked"));
  console.log("OK: daily command status reasons expose working, failed, approval, and setup blocks");
}

console.log("\nAll mind trace, context pack, memory trust, and daily status assertions passed.");
