import assert from "node:assert/strict";
import { runRuntimeCapabilityPreview } from "../index";

{
  const result = runRuntimeCapabilityPreview({
    event: {
      eventId: "event-capability-preview",
      source: "app",
      userId: "user-1",
      message: "Send this email to Bill.",
      createdAt: "2026-06-08T13:00:00.000Z",
    },
    now: new Date("2026-06-08T13:00:00.000Z"),
    agentTools: [{ name: "send_email" }, { name: "memory_search" }],
    auth: {
      connectedProviders: ["google", "memory"],
      grantedScopes: ["gmail", "memory:read"],
    },
  });

  assert.equal(result.capabilitySummary.totalTools, 2);
  assert.deepEqual(result.capabilitySummary.providers, ["google", "memory"]);
  assert.equal(result.capabilitySummary.approvalRequiredToolCount, 1);
  assert.equal(result.dryRun.report.status, "needs_approval");
  assert.ok(result.dryRun.approvalPreview);
  console.log("OK: Runtime capability preview combines tool surface summary and dry run");
}

console.log("\nAll Runtime Capability Preview assertions passed.");
