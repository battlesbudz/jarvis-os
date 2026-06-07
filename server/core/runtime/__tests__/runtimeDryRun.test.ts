import assert from "node:assert/strict";
import { runRuntimeDryRun, runRuntimeDryRunFromAgentTools } from "../index";

const now = new Date("2026-06-08T13:00:00.000Z");

{
  const result = runRuntimeDryRun({
    event: {
      eventId: "event-dry-run-ready",
      source: "app",
      userId: "user-1",
      message: "What can you do?",
      createdAt: now.toISOString(),
    },
    now,
  });

  assert.equal(result.report.status, "ready");
  assert.equal(result.approvalPreview, null);
  assert.equal(result.preview.decision.responseMode, "answer");
  console.log("OK: Runtime dry run composes ready preview, report, and approval state");
}

{
  const result = runRuntimeDryRunFromAgentTools({
    event: {
      eventId: "event-dry-run-approval",
      source: "app",
      userId: "user-1",
      message: "Send this email to Bill.",
      createdAt: now.toISOString(),
    },
    now,
    agentTools: [{ name: "approval_gated_action" }],
    descriptorOverrides: {
      approval_gated_action: {
        provider: "runtime",
        riskTier: "T3",
        approvalRequired: true,
      },
    },
    auth: {
      connectedProviders: ["runtime"],
    },
  });

  assert.equal(result.report.status, "needs_approval");
  assert.ok(result.approvalPreview);
  assert.equal(result.approvalPreview.intent, "email_action");
  assert.ok(result.preview.toolPreflight.blocked.some((tool) => tool.status === "approval_required"));
  console.log("OK: Runtime dry run composes approval preview from AgentTool metadata");
}

{
  const result = runRuntimeDryRun({
    event: {
      eventId: "event-dry-run-preflight-approval",
      source: "app",
      userId: "user-1",
      message: "Research the latest cannabis licensing updates.",
      createdAt: now.toISOString(),
    },
    now,
    policy: {
      approvalRequiredTools: ["search"],
    },
  });

  assert.equal(result.report.status, "needs_approval");
  assert.ok(result.approvalPreview);
  assert.equal(result.approvalPreview.reason, "Tool preflight requires approval before execution.");
  assert.ok(result.approvalPreview.tools.some((tool) => tool.toolName === "search"));
  console.log("OK: Runtime dry run builds approval preview from preflight-required tools");
}

console.log("\nAll Runtime Dry Run assertions passed.");
