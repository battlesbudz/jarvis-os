import assert from "node:assert/strict";
import { summarizeToolCapabilities, toolDescriptorsFromAgentTools } from "../index";

{
  const summary = summarizeToolCapabilities(toolDescriptorsFromAgentTools([
    { name: "memory_search" },
    { name: "send_email" },
    { name: "daemon_action" },
  ]));

  assert.equal(summary.totalTools, 3);
  assert.deepEqual(summary.providers, ["google", "memory", "runtime"]);
  assert.ok(summary.requiredScopes.includes("gmail"));
  assert.ok(summary.requiredScopes.includes("memory:read"));
  assert.equal(summary.approvalRequiredToolCount, 2);
  assert.equal(summary.maxRiskTier, "T3");
  console.log("OK: Tool capability summary captures providers, scopes, approvals, and risk");
}

{
  const summary = summarizeToolCapabilities([]);

  assert.equal(summary.totalTools, 0);
  assert.deepEqual(summary.providers, []);
  assert.equal(summary.maxRiskTier, null);
  console.log("OK: Tool capability summary handles empty tool surfaces");
}

console.log("\nAll Tool Capability Summary assertions passed.");
