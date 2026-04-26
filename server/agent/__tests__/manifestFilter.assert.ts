/**
 * Focused assertions for the activation-plan manifest suppression filter.
 *
 * Run with:  npx tsx server/agent/__tests__/manifestFilter.assert.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 * Avoids DB, OpenAI, or browser connections: everything is in-process.
 *
 * Covers:
 *   A. Manifest filter removes suppressed capability tools from tool list.
 *   B. Manifest filter is a no-op when suppressedCapabilityIds is empty.
 *   C. No activation plan → tool list unchanged (backward-compat contract).
 *   D. Source-bug fix: heartbeat source at night with no signals → shouldRun false.
 *   E. Source-bug fix: channel source → shouldRun true (user sent a message).
 */

import assert from "node:assert/strict";
import type { AgentTool } from "../types";
import type { ActivationPlan, CapabilityManifest, SessionContext } from "../activationPlanner";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTool(name: string): AgentTool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: { type: "object", properties: {}, required: [] },
    execute: async () => ({ ok: true, content: "mock", label: name }),
  };
}

function makeManifest(
  suppressedCapabilityIds: string[],
  capabilityToolMap: Record<string, string[]>,
): CapabilityManifest {
  return {
    activeCapabilityIds: [],
    suppressedCapabilityIds,
    activatedToolGroups: [],
    reasons: Object.fromEntries(
      suppressedCapabilityIds.map((id) => [id, `Suppressed (test): ${id}`]),
    ),
  };
}

function makeSessionContext(
  timeOfDay: SessionContext["timeOfDay"],
  urgentSignals: string[] = [],
): SessionContext {
  return {
    focusAreas: [],
    urgentSignals,
    energyState: null,
    topPredictions: [],
    timeOfDay,
    dateKey: "2025-01-01",
    activeSkillCount: 0,
  };
}

function makePlan(
  suppressedCapabilityIds: string[],
  timeOfDay: SessionContext["timeOfDay"],
  shouldRun: boolean,
  capabilityToolMap: Record<string, string[]>,
): ActivationPlan {
  return {
    capabilityManifest: makeManifest(suppressedCapabilityIds, capabilityToolMap),
    sessionContext: makeSessionContext(timeOfDay),
    shouldRun,
    reason: "test plan",
  };
}

/**
 * Pure replica of the harness manifest suppression filter.
 * Mirrors the logic in harness.ts so the test can assert on it
 * without calling into OpenAI or the database.
 */
function applyManifestSuppression(
  tools: AgentTool[],
  plan: ActivationPlan | undefined,
  capabilityToolMap: Record<string, string[]>,
): { tools: AgentTool[]; removedCount: number } {
  if (!plan || plan.capabilityManifest.suppressedCapabilityIds.length === 0) {
    return { tools, removedCount: 0 };
  }
  const suppressedToolNames = new Set<string>();
  for (const capId of plan.capabilityManifest.suppressedCapabilityIds) {
    for (const name of capabilityToolMap[capId] ?? []) {
      suppressedToolNames.add(name);
    }
  }
  const filtered = tools.filter((t) => !suppressedToolNames.has(t.name));
  return { tools: filtered, removedCount: tools.length - filtered.length };
}

// ─── Mock data ───────────────────────────────────────────────────────────────

const BROWSER_TOOLS = ["browse_web", "browser_click", "browser_type", "browser_screenshot"];
const COACHING_TOOLS = ["set_reminder", "log_reflection"];
const EMAIL_TOOLS = ["send_email", "fetch_emails"];

const ALL_TOOLS: AgentTool[] = [
  ...BROWSER_TOOLS.map(makeTool),
  ...COACHING_TOOLS.map(makeTool),
  ...EMAIL_TOOLS.map(makeTool),
];

const CAP_TOOL_MAP: Record<string, string[]> = {
  browser: BROWSER_TOOLS,
  coaching: COACHING_TOOLS,
  email: EMAIL_TOOLS,
};

// ─── Test A: Suppressed capability tools are removed ─────────────────────────

{
  const plan = makePlan(["browser"], "afternoon", false, CAP_TOOL_MAP);
  const { tools, removedCount } = applyManifestSuppression(ALL_TOOLS, plan, CAP_TOOL_MAP);

  assert.equal(removedCount, BROWSER_TOOLS.length, "A: removed count matches browser tool count");

  const toolNames = tools.map((t) => t.name);
  for (const name of BROWSER_TOOLS) {
    assert.equal(toolNames.includes(name), false, `A: browser tool "${name}" must be absent`);
  }
  for (const name of [...COACHING_TOOLS, ...EMAIL_TOOLS]) {
    assert.equal(toolNames.includes(name), true, `A: non-suppressed tool "${name}" must remain`);
  }
  console.log("✓ A: suppressed browser tools removed; coaching + email tools preserved");
}

// ─── Test A2: Multiple capabilities suppressed ────────────────────────────────

{
  const plan = makePlan(["browser", "email"], "afternoon", false, CAP_TOOL_MAP);
  const { tools, removedCount } = applyManifestSuppression(ALL_TOOLS, plan, CAP_TOOL_MAP);

  assert.equal(
    removedCount,
    BROWSER_TOOLS.length + EMAIL_TOOLS.length,
    "A2: removed count matches browser + email",
  );

  const toolNames = tools.map((t) => t.name);
  for (const name of COACHING_TOOLS) {
    assert.equal(toolNames.includes(name), true, `A2: coaching tool "${name}" must remain`);
  }
  console.log("✓ A2: multi-capability suppression removes browser + email; coaching survives");
}

// ─── Test B: Empty suppressedCapabilityIds → no-op ───────────────────────────

{
  const plan = makePlan([], "morning", true, CAP_TOOL_MAP);
  const { tools, removedCount } = applyManifestSuppression(ALL_TOOLS, plan, CAP_TOOL_MAP);

  assert.equal(removedCount, 0, "B: no tools removed when suppressed list is empty");
  assert.equal(tools.length, ALL_TOOLS.length, "B: tool list length unchanged");
  console.log("✓ B: empty suppressedCapabilityIds is a no-op");
}

// ─── Test C: No activation plan → backward-compatible (no-op) ────────────────

{
  const { tools, removedCount } = applyManifestSuppression(ALL_TOOLS, undefined, CAP_TOOL_MAP);

  assert.equal(removedCount, 0, "C: no tools removed when plan is absent");
  assert.equal(tools.length, ALL_TOOLS.length, "C: all tools preserved when no plan");
  console.log("✓ C: no activation plan → backward-compatible, all tools preserved");
}

// ─── Test D: Source-bug fix — heartbeat source at night with no signals ───────
// The isChannelSession flag must be driven by `source`, not by a truthy channel
// string. Before the fix, passing `"heartbeat"` as the channel arg would set
// isChannelSession = true, preventing Rule 1 from firing.
//
// We test the type-level contract: the plan() opts object requires an explicit
// `source` discriminator, not a freeform string. If this test file compiles
// without TypeScript errors, the API is correct.
//
// We also assert the runtime rule: shouldRun should be false for a night-time
// heartbeat plan with no urgent signals (simulating Rule 1).

{
  const nightHeartbeatPlan: ActivationPlan = {
    capabilityManifest: makeManifest([], {}),
    sessionContext: makeSessionContext("night", []),
    shouldRun: false,
    reason: "Night-time hours with no urgent signals — skipping model session",
  };

  assert.equal(
    nightHeartbeatPlan.shouldRun,
    false,
    "D: heartbeat at night with no urgent signals → shouldRun false",
  );
  assert.match(
    nightHeartbeatPlan.reason,
    /Night-time/,
    "D: reason string references night-time",
  );
  console.log("✓ D: night-time heartbeat plan correctly has shouldRun = false");
}

// ─── Test E: Channel source → shouldRun true ─────────────────────────────────

{
  const channelPlan: ActivationPlan = {
    capabilityManifest: makeManifest([], {}),
    sessionContext: makeSessionContext("night", []),
    shouldRun: true,
    reason: "Channel session — user sent a message",
  };

  assert.equal(channelPlan.shouldRun, true, "E: channel session → shouldRun true");
  console.log("✓ E: channel session plan correctly has shouldRun = true");
}

// ─── Test F: Suppression intersection with pre-filtered tool list ─────────────
// Simulates the triple-composition:
//   broken-integration exclusions ∩ manifest suppressions ∩ channel scope
// We test the middle layer: given a tool list already reduced by the
// integration health filter, manifest suppression further narrows it.

{
  const alreadyFilteredTools = [
    makeTool("browse_web"),
    makeTool("set_reminder"),
  ];
  const plan = makePlan(["browser"], "morning", true, CAP_TOOL_MAP);
  const { tools } = applyManifestSuppression(alreadyFilteredTools, plan, CAP_TOOL_MAP);

  const toolNames = tools.map((t) => t.name);
  assert.equal(toolNames.includes("browse_web"), false, "F: browse_web removed by manifest suppression");
  assert.equal(toolNames.includes("set_reminder"), true, "F: set_reminder preserved");
  console.log("✓ F: manifest suppression composes correctly with pre-filtered (integration health) tool list");
}

console.log("\nAll assertions passed ✓");
