import assert from "node:assert/strict";
import { previewRuntimePreflightFromAgentTools } from "../index";

const now = new Date("2026-06-08T13:00:00.000Z");

{
  let executed = false;
  const agentTools = [
    {
      name: "approval_gated_action",
      execute: async () => {
        executed = true;
        return { ok: true, content: "should not run" };
      },
    },
  ];
  const result = previewRuntimePreflightFromAgentTools({
    event: {
      eventId: "event-runtime-agent-tools",
      source: "app",
      userId: "user-1",
      message: "Send this email to Bill.",
      createdAt: now.toISOString(),
    },
    now,
    agentTools,
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

  assert.equal(executed, false);
  assert.equal(result.decision.responseMode, "approval_required");
  assert.ok(result.toolPreflight.blocked.some((tool) => tool.status === "approval_required"));
  console.log("OK: Runtime preflight adapts AgentTool metadata without executing tools");
}

{
  const result = previewRuntimePreflightFromAgentTools({
    event: {
      eventId: "event-runtime-agent-tools-ready",
      source: "app",
      userId: "user-1",
      message: "What can you do?",
      createdAt: now.toISOString(),
    },
    now,
    agentTools: [{ name: "read_context" }, { name: "draft_only" }],
  });

  assert.equal(result.gateResult.outcome, "inline_answer");
  assert.ok(result.toolPreflight.tools.every((tool) => tool.status === "ready"));
  console.log("OK: Runtime preflight accepts AgentTool-shaped read-only descriptors");
}

console.log("\nAll Runtime AgentTool preflight assertions passed.");
