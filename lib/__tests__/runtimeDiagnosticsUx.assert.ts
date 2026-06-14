import assert from "node:assert/strict";
import {
  buildRuntimeDiagnosticRequest,
  RUNTIME_DIAGNOSTIC_PROBES,
  runtimeDiagnosticStatusFromResponse,
  runtimeDiagnosticStatusLabel,
  summarizeRuntimeDiagnosticResponse,
} from "../runtimeDiagnosticsUx";

assert.deepEqual(
  RUNTIME_DIAGNOSTIC_PROBES.map((probe) => probe.id),
  ["ready-auth", "approval-tool", "blocked-policy", "readonly-owner"],
);
console.log("OK: runtime diagnostics exposes auth, tool, policy, and read-only probes");

const readyProbe = buildRuntimeDiagnosticRequest("ready-auth");
assert.equal(readyProbe.route, "/api/runtime/dry-run");
assert.deepEqual(readyProbe.body.auth?.connectedProviders, ["runtime"]);
assert.equal(readyProbe.body.availableTools?.[0]?.riskTier, "T0");
assert.equal(readyProbe.body.policy?.maxAllowedRiskTier, "T2");

const approvalProbe = buildRuntimeDiagnosticRequest("approval-tool", "Draft a reply to Bill.");
assert.equal(approvalProbe.body.message, "Draft a reply to Bill.");
assert.equal(approvalProbe.body.availableTools?.[0]?.approvalRequired, true);
assert.deepEqual(approvalProbe.body.policy?.approvalRequiredTools, ["email_action"]);

const blockedProbe = buildRuntimeDiagnosticRequest("blocked-policy");
assert.deepEqual(blockedProbe.body.policy?.blockedTools, ["approval_gated_action"]);

const readOnlyProbe = buildRuntimeDiagnosticRequest("readonly-owner");
assert.equal(readOnlyProbe.route, "/api/runtime/read-only");
assert.equal(readOnlyProbe.body.channel, "settings-runtime-readonly");
console.log("OK: runtime diagnostic probe requests carry the expected snapshots");

assert.equal(runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse()), "Idle");
assert.equal(runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse({ disabled: true })), "Disabled");
assert.equal(runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse({
  report: {
    status: "ready",
    eventId: "event-ready",
    userId: "user",
    intent: "general_answer",
    responseMode: "answer",
    riskTier: "T0",
    readyToolCount: 0,
    blockedToolCount: 0,
    approvalRequired: false,
    reasons: [],
  },
})), "Ready");
assert.equal(runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse({
  report: {
    status: "needs_approval",
    eventId: "event-approval",
    userId: "user",
    intent: "email_action",
    responseMode: "tool",
    riskTier: "T4",
    readyToolCount: 0,
    blockedToolCount: 1,
    approvalRequired: true,
    reasons: ["Approval is required."],
  },
})), "Approval");
assert.equal(runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse({
  report: {
    status: "blocked",
    eventId: "event-blocked",
    userId: "user",
    intent: "email_action",
    responseMode: "tool",
    riskTier: "T4",
    readyToolCount: 0,
    blockedToolCount: 1,
    approvalRequired: false,
    reasons: ["Runtime policy blocked approval_gated_action."],
  },
})), "Blocked");
assert.equal(runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse({
  runtimeOwned: true,
  routeOwner: "core_runtime",
  runtimeWorkflowId: "general-answer",
  decision: {
    riskTier: "T0",
    approvalRequired: false,
  },
})), "Ready");
assert.equal(runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse({
  ok: false,
  gateStatus: "blocked",
})), "Blocked");
assert.equal(runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse({
  ok: false,
  gateStatus: "legacy_route_allowed",
})), "Disabled");
assert.equal(runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse(undefined, "401: Not authenticated")), "Blocked");
console.log("OK: runtime diagnostics maps route responses into Ready, Approval, Blocked, and Disabled states");

assert.equal(
  summarizeRuntimeDiagnosticResponse({
    runtimeOwned: true,
    routeOwner: "core_runtime",
    runtimeWorkflowId: "general-answer",
    decision: {
      riskTier: "T0",
    },
  }),
  "general-answer / core_runtime / T0",
);
console.log("OK: runtime diagnostics summarizes runtime-owned read-only workflow results");
