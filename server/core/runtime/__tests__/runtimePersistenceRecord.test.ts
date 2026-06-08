import assert from "node:assert/strict";
import { parseRuntimeDecision } from "../../protocol";
import {
  buildRuntimePersistenceRecord,
  executeRuntimeEvent,
  persistRuntimeRecord,
  type RuntimePersistenceRecord,
} from "../index";

const now = new Date("2026-06-08T20:00:00.000Z");

async function run(): Promise<void> {
  {
  const runtime = executeRuntimeEvent({
    event: {
      eventId: "event-persistence-general",
      source: "app",
      userId: "user-persistence",
      message: "What can you do?",
      createdAt: now.toISOString(),
      metadata: {
        route: "/api/runtime/read-only",
        token: "secret-token",
      },
    },
    now,
  });
  const record = buildRuntimePersistenceRecord({
    runtime,
    status: "completed",
    executionStatus: "completed",
    owner: "core_runtime",
    createdAt: now.toISOString(),
  });

  assert.equal(record.recordId, `runtime-record-${runtime.decision.decisionId}`);
  assert.equal(record.status, "completed");
  assert.equal(record.executionStatus, "completed");
  assert.equal(record.approvalRequired, false);
  assert.equal(record.owner, "core_runtime");
  assert.equal(record.event.metadata.token, "[redacted]");
  assert.doesNotMatch(JSON.stringify(record), /secret-token/);
  console.log("OK: Runtime persistence record captures completed runtime execution with redacted event metadata");
  }

  {
  const runtime = executeRuntimeEvent({
    event: {
      eventId: "event-persistence-approval",
      source: "app",
      userId: "user-persistence",
      message: "Send this email to Bill.",
      createdAt: now.toISOString(),
    },
    now,
  });
  const decision = parseRuntimeDecision({
    ...runtime.decision,
    tools: runtime.decision.tools.map((tool) => ({
      ...tool,
      argsPreview: {
        to: "bill@example.com",
        accessToken: "secret-access-token",
      },
    })),
  });
  const record = buildRuntimePersistenceRecord({
    runtime: {
      ...runtime,
      decision,
    },
    owner: "legacy_route",
    traceId: "trace-existing-owner",
    createdAt: now.toISOString(),
  });

  assert.equal(record.status, "needs_approval");
  assert.equal(record.approvalRequired, true);
  assert.equal(record.approvalStatus, "pending");
  assert.equal(record.approvalId, runtime.decision.approval.gateId);
  assert.equal(record.owner, "legacy_route");
  assert.equal(record.traceId, "trace-existing-owner");
  assert.doesNotMatch(JSON.stringify(record), /secret-access-token/);
  assert.match(JSON.stringify(record), /\[redacted\]/);
  console.log("OK: Runtime persistence record preserves approval state while redacting tool previews");
  }

  {
  const runtime = executeRuntimeEvent({
    event: {
      eventId: "event-persistence-writer",
      source: "app",
      userId: "user-persistence",
      message: "What can you do?",
      createdAt: now.toISOString(),
    },
    now,
  });
  const record = buildRuntimePersistenceRecord({ runtime });
  const disabled = await persistRuntimeRecord(record);
  const written: RuntimePersistenceRecord[] = [];
  const persisted = await persistRuntimeRecord(record, {
    writeRecord: async (item) => {
      written.push(item);
    },
  });

  assert.equal(disabled.persisted, false);
  assert.match(disabled.reason, /No runtime persistence writer/);
  assert.equal(persisted.persisted, true);
  assert.equal(written[0]?.recordId, record.recordId);
  console.log("OK: Runtime persistence writer hook is explicit and storage-neutral");
  }

  console.log("\nAll Runtime Persistence Record assertions passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
