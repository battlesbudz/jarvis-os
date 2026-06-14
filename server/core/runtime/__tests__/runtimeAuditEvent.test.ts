import assert from "node:assert/strict";
import { buildRuntimeAuditEvent, runRuntimeDryRun } from "../index";

const now = new Date("2026-06-08T13:00:00.000Z");

{
  const dryRun = runRuntimeDryRun({
    event: {
      eventId: "event-audit",
      source: "app",
      userId: "user-1",
      message: "Send this email to Bill.",
      createdAt: now.toISOString(),
    },
    now,
  });

  const audit = buildRuntimeAuditEvent(dryRun, now.toISOString());

  assert.equal(audit.eventId, "event-audit");
  assert.equal(audit.userId, "user-1");
  assert.equal(audit.status, "needs_approval");
  assert.equal(audit.approvalRequired, true);
  assert.equal(audit.createdAt, now.toISOString());
  assert.match(audit.auditId, /^audit-decision-/);
  console.log("OK: Runtime audit event summarizes dry-run decision without persistence");
}

console.log("\nAll Runtime Audit Event assertions passed.");
