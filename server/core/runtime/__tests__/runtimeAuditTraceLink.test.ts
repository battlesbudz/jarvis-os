import assert from "node:assert/strict";
import { buildMindTrace } from "../../../agent/mindTrace";
import {
  buildRuntimeAuditEvent,
  buildRuntimeAuditTraceLink,
  formatRuntimeAuditTraceLink,
  runRuntimeDryRun,
  runtimeTraceInputFromMindTrace,
} from "../index";

const now = new Date("2026-06-08T14:00:00.000Z");

{
  const dryRun = runRuntimeDryRun({
    event: {
      eventId: "event-link-memory",
      source: "app",
      userId: "user-link",
      message: "What do you remember about my training plan?",
      createdAt: now.toISOString(),
    },
    now,
  });
  const audit = buildRuntimeAuditEvent(dryRun, now.toISOString());

  const link = buildRuntimeAuditTraceLink({
    audit,
    trace: {
      traceId: "orch-trace-link",
      source: "orchestration_trace",
      routeChosen: "memory_lookup",
      taskTypeDetected: "memory_query",
    },
  });

  assert.equal(link.auditId, audit.auditId);
  assert.equal(link.eventId, "event-link-memory");
  assert.equal(link.userId, "user-link");
  assert.equal(link.traceId, "orch-trace-link");
  assert.equal(link.traceSource, "orchestration_trace");
  assert.equal(link.previewOnly, true);
  assert.equal(link.createdAt, now.toISOString());
  assert.match(link.linkId, /^runtime-link-audit-decision-/);

  const formatted = formatRuntimeAuditTraceLink(link);
  assert.match(formatted, /Runtime audit trace link: ready/);
  assert.match(formatted, /Trace: orch-trace-link \(orchestration_trace\)/);
  console.log("OK: Runtime audit trace link connects audit metadata to an orchestration trace id");
}

{
  const trace = buildMindTrace({
    traceId: "mind-trace-link",
    userRequest: "Draft an email to Sam about tomorrow.",
    channel: "app",
    approvalRequired: true,
    toolsCalled: [{ name: "email.send", approvalRequired: true }],
    now,
  });

  const dryRun = runRuntimeDryRun({
    event: {
      eventId: "event-link-email",
      source: "app",
      userId: "user-link",
      message: "Draft an email to Sam about tomorrow.",
      createdAt: now.toISOString(),
    },
    now,
  });
  const audit = buildRuntimeAuditEvent(dryRun, now.toISOString());
  const traceInput = runtimeTraceInputFromMindTrace(trace);
  const link = buildRuntimeAuditTraceLink({ audit, trace });

  assert.deepEqual(traceInput, {
    traceId: "mind-trace-link",
    source: "existing_mind_trace",
    routeChosen: trace.routeChosen,
    taskTypeDetected: trace.taskTypeDetected,
  });
  assert.equal(link.traceId, "mind-trace-link");
  assert.equal(link.traceSource, "existing_mind_trace");
  assert.equal(link.routeChosen, trace.routeChosen);
  assert.equal(link.taskTypeDetected, trace.taskTypeDetected);
  assert.equal(link.approvalRequired, audit.approvalRequired);
  console.log("OK: Runtime audit trace link adapts existing Mind Trace metadata");
}

console.log("\nAll Runtime Audit Trace Link assertions passed.");
