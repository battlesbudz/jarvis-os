import assert from "node:assert/strict";
import { formatRuntimePreview, runRuntimeDryRun } from "../index";

const now = new Date("2026-06-08T13:00:00.000Z");

{
  const dryRun = runRuntimeDryRun({
    event: {
      eventId: "event-format-ready",
      source: "app",
      userId: "user-1",
      message: "What can you do?",
      createdAt: now.toISOString(),
    },
    now,
  });
  const output = formatRuntimePreview(dryRun);

  assert.match(output, /Runtime preview: ready/);
  assert.match(output, /Intent: general/);
  assert.doesNotMatch(output, /Approval:/);
  console.log("OK: Runtime preview formatter renders ready preview");
}

{
  const dryRun = runRuntimeDryRun({
    event: {
      eventId: "event-format-approval",
      source: "app",
      userId: "user-1",
      message: "Send this email to Bill.",
      createdAt: now.toISOString(),
    },
    now,
  });
  const output = formatRuntimePreview(dryRun);

  assert.match(output, /Runtime preview: needs_approval/);
  assert.match(output, /Approval:/);
  assert.match(output, /email_action/);
  console.log("OK: Runtime preview formatter renders approval preview");
}

console.log("\nAll Runtime Preview Formatter assertions passed.");
