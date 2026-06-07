import assert from "node:assert/strict";
import {
  ContextPacketSchema,
  JarvisEventSchema,
  parseRuntimeDecision,
  runtimeDecisionFromMindTrace,
} from "../index";
import { buildMindTrace } from "../../../agent/mindTrace";

{
  const event = JarvisEventSchema.parse({
    eventId: "event-1",
    source: "app",
    userId: "user-1",
    message: "Plan my day around my calendar and top goals.",
    createdAt: "2026-06-08T13:00:00.000Z",
  });

  const packet = ContextPacketSchema.parse({
    packetId: "packet-1",
    userId: event.userId,
    query: event.message,
    createdAt: event.createdAt,
    sources: [
      { kind: "workspace", label: "daily_planning_context", confidence: 0.9 },
      { kind: "calendar", label: "calendar_context", confidence: 0.7 },
    ],
    provenance: ["docs/operations/jarvis-golden-workflows.md#1"],
    uncertainty: ["calendar may be disconnected in local dev"],
  });

  assert.equal(event.source, "app");
  assert.equal(packet.sources.length, 2);
  console.log("OK: JarvisEvent and ContextPacket validate core runtime inputs");
}

{
  const decision = parseRuntimeDecision({
    decisionId: "decision-1",
    eventId: "event-1",
    userId: "user-1",
    intent: "daily_planning",
    confidence: 0.82,
    riskTier: "T1",
    responseMode: "answer",
    tools: [
      {
        toolName: "read_context",
        status: "executed",
        riskTier: "T0",
        approvalRequired: false,
      },
    ],
    approval: {
      required: false,
      status: "not_required",
    },
    modelRoute: {
      provider: "legacy-harness",
      model: "existing-route",
      reason: "Golden workflow protocol validation.",
    },
    trace: {
      traceId: "trace-1",
      source: "golden_workflow",
      routeChosen: "planning",
      taskTypeDetected: "daily_planning",
    },
    createdAt: "2026-06-08T13:00:00.000Z",
  });

  assert.equal(decision.intent, "daily_planning");
  assert.equal(decision.approval.required, false);
  console.log("OK: RuntimeDecision validates a low-risk golden workflow decision");
}

{
  assert.throws(
    () => parseRuntimeDecision({
      decisionId: "decision-invalid",
      eventId: "event-invalid",
      userId: "user-1",
      intent: "email_action",
      confidence: 0.8,
      riskTier: "T3",
      responseMode: "answer",
      tools: [],
      approval: {
        required: true,
        status: "pending",
      },
      modelRoute: {
        provider: "legacy-harness",
        model: "existing-route",
        reason: "Invalid approval-required direct answer.",
      },
      trace: {
        traceId: "trace-invalid",
        source: "runtime",
      },
      createdAt: "2026-06-08T13:00:00.000Z",
    }),
    /fails closed/,
  );
  console.log("OK: RuntimeDecision fails closed when approval-required output tries to answer directly");
}

{
  const trace = buildMindTrace({
    traceId: "trace-golden-memory",
    userId: "user-1",
    userRequest: "What memory do you have about morning planning?",
    channel: "app",
    now: new Date("2026-06-08T13:00:00.000Z"),
    memoriesRetrieved: [
      {
        id: "mem-1",
        category: "preferences",
        tier: "long_term",
        memoryType: "semantic",
        confidence: 91,
        sourceType: "chat",
        reason: "Golden workflow 9 provenance lookup.",
      },
    ],
    toolsCalled: [
      {
        name: "memory_search",
        status: "ok",
        args: { query: "morning planning", accessToken: "secret" },
      },
    ],
  });

  const decision = runtimeDecisionFromMindTrace(trace, {
    userId: "user-1",
    decisionId: "decision-golden-memory",
  });

  assert.equal(decision.intent, "memory_query");
  assert.equal(decision.riskTier, "T0");
  assert.equal(decision.responseMode, "answer");
  assert.equal(decision.tools[0]?.toolName, "memory_search");
  assert.equal(decision.tools[0]?.status, "executed");
  assert.equal(decision.trace.source, "existing_mind_trace");
  console.log("OK: existing Mind Trace adapts into a runtime decision for golden workflow 9");
}

{
  const trace = buildMindTrace({
    traceId: "trace-email-approval",
    userId: "user-1",
    userRequest: "Send this email to Bill.",
    channel: "app",
    now: new Date("2026-06-08T13:00:00.000Z"),
    toolsCalled: [
      {
        name: "send_email",
        status: "blocked",
        approvalRequired: true,
        args: { to: "bill@example.com", body: "Done" },
        error: "Approval required before sending email.",
      },
    ],
  });

  const decision = runtimeDecisionFromMindTrace(trace, {
    userId: "user-1",
    decisionId: "decision-email-approval",
  });

  assert.equal(decision.intent, "email_action");
  assert.equal(decision.riskTier, "T3");
  assert.equal(decision.responseMode, "approval_required");
  assert.equal(decision.approval.required, true);
  assert.equal(decision.tools[0]?.status, "approval_required");
  console.log("OK: approval-gated Mind Trace adapts without permitting direct execution");
}

console.log("\nAll Jarvis Runtime Protocol seed assertions passed.");
