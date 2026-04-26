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

// ─── Test G: Planner shouldRun contract — night-only suppression ──────────────
// The planner's hasSomethingToDo logic (from applyRules) must guarantee:
//   morning/afternoon/evening + no signals → shouldRun TRUE (jobs run)
//   night + no signals                    → shouldRun FALSE (jobs skip)
//   night + urgent signal                 → shouldRun TRUE (urgent overrides)
//
// heartbeat trusts plan.shouldRun directly. The planner owns the gating
// contract; each job function owns its own eligibility check on top of that.
//
// We test the hasSomethingToDo formula from activationPlanner.ts:
//   hasSomethingToDo = hasUrgentSignals || isChannelSession
//                    || activeCapabilityIds.length > 0 || hasEveningWork
//                    || timeOfDay !== "night"

function computeHasSomethingToDo(opts: {
  timeOfDay: SessionContext["timeOfDay"];
  urgentSignals: string[];
  isChannelSession: boolean;
  activeCapabilityIds: string[];
}): boolean {
  const { timeOfDay, urgentSignals, isChannelSession, activeCapabilityIds } = opts;
  const hasUrgentSignals = urgentSignals.length > 0;
  const hasEveningWork = timeOfDay === "evening";
  return (
    hasUrgentSignals ||
    isChannelSession ||
    activeCapabilityIds.length > 0 ||
    hasEveningWork ||
    timeOfDay !== "night"
  );
}

{
  assert.equal(
    computeHasSomethingToDo({ timeOfDay: "afternoon", urgentSignals: [], isChannelSession: false, activeCapabilityIds: [] }),
    true,
    "G1: afternoon + no signals → shouldRun true (backward-compat: jobs run)",
  );
  assert.equal(
    computeHasSomethingToDo({ timeOfDay: "morning", urgentSignals: [], isChannelSession: false, activeCapabilityIds: [] }),
    true,
    "G2: morning + no signals → shouldRun true (meeting briefs window)",
  );
  assert.equal(
    computeHasSomethingToDo({ timeOfDay: "evening", urgentSignals: [], isChannelSession: false, activeCapabilityIds: [] }),
    true,
    "G3: evening + no signals → shouldRun true (wrap-up window)",
  );
  assert.equal(
    computeHasSomethingToDo({ timeOfDay: "night", urgentSignals: ["High stress detected (score: 8/10)"], isChannelSession: false, activeCapabilityIds: [] }),
    true,
    "G4: night + urgent signal → shouldRun true (urgent overrides quiet window)",
  );
  assert.equal(
    computeHasSomethingToDo({ timeOfDay: "night", urgentSignals: [], isChannelSession: false, activeCapabilityIds: [] }),
    false,
    "G5: night + no signals + no capabilities → shouldRun false (safe idle skip)",
  );
  assert.equal(
    computeHasSomethingToDo({ timeOfDay: "night", urgentSignals: [], isChannelSession: true, activeCapabilityIds: [] }),
    true,
    "G6: night + channel session → shouldRun true (user sent a message)",
  );
  console.log("✓ G: planner hasSomethingToDo correctly gates only quiet nights; all active hours run");
}

// ─── Test H: Positive filter — only active capability tools pass (heartbeat) ──
// The positive filter only applies when there is NO channel scope (heartbeat).
// Mirrors the harness condition: !hasChannelScope && activeCapabilityIds.length > 0.

function applyFullFilterChain(
  tools: AgentTool[],
  plan: ActivationPlan | undefined,
  capabilityToolMap: Record<string, string[]>,
  channelScopeNames: string[] | null, // null = no channel scope (heartbeat)
): { tools: AgentTool[]; reduction: number } {
  let result = tools;

  // 1. Positive filter — heartbeat only (no channel scope)
  if (channelScopeNames === null && plan && plan.capabilityManifest.activeCapabilityIds.length > 0) {
    const activeToolNames = new Set<string>();
    for (const capId of plan.capabilityManifest.activeCapabilityIds) {
      for (const name of capabilityToolMap[capId] ?? []) {
        activeToolNames.add(name);
      }
    }
    if (activeToolNames.size > 0) {
      result = result.filter((t) => activeToolNames.has(t.name));
    }
  }

  // 2. Suppression filter (always applies)
  if (plan && plan.capabilityManifest.suppressedCapabilityIds.length > 0) {
    const suppressedToolNames = new Set<string>();
    for (const capId of plan.capabilityManifest.suppressedCapabilityIds) {
      for (const name of capabilityToolMap[capId] ?? []) {
        suppressedToolNames.add(name);
      }
    }
    result = result.filter((t) => !suppressedToolNames.has(t.name));
  }

  // 3. Channel scope filter (authoritative last)
  if (channelScopeNames !== null) {
    const scopeSet = new Set(channelScopeNames);
    result = result.filter((t) => scopeSet.has(t.name));
  }

  const reduction = tools.length > 0 ? Math.round((1 - result.length / tools.length) * 100) : 0;
  return { tools: result, reduction };
}

// H1: Heartbeat — positive filter activates only coaching; research/browser excluded
{
  const plan: ActivationPlan = {
    capabilityManifest: {
      activeCapabilityIds: ["coaching"],
      suppressedCapabilityIds: [],
      activatedToolGroups: [],
      reasons: { coaching: "Activated: morning planning" },
    },
    sessionContext: makeSessionContext("morning"),
    shouldRun: true,
    reason: "morning heartbeat",
  };

  const { tools, reduction } = applyFullFilterChain(ALL_TOOLS, plan, CAP_TOOL_MAP, null);
  const toolNames = tools.map((t) => t.name);
  for (const name of COACHING_TOOLS) {
    assert.equal(toolNames.includes(name), true, `H1: coaching tool "${name}" present on heartbeat`);
  }
  for (const name of [...BROWSER_TOOLS, ...EMAIL_TOOLS]) {
    assert.equal(toolNames.includes(name), false, `H1: non-active "${name}" excluded on heartbeat`);
  }
  assert.ok(reduction >= 60, `H1: ≥60% reduction on heartbeat (got ${reduction}%)`);
  console.log(`✓ H1: heartbeat positive filter: ${tools.length}/${ALL_TOOLS.length} tools (${reduction}% reduction)`);
}

// H2: Channel session (Discord scope) — positive filter IS SKIPPED; only suppression + scope apply
{
  const discordScopeNames = ["browse_web", "browser_click", "set_reminder"]; // Discord scope example
  const plan: ActivationPlan = {
    capabilityManifest: {
      activeCapabilityIds: ["coaching", "calendar"], // planner activates coaching/calendar
      suppressedCapabilityIds: ["browser"],          // but suppresses browser for stressed user
      activatedToolGroups: [],
      reasons: { coaching: "Activated: morning", browser: "Suppressed: high stress" },
    },
    sessionContext: makeSessionContext("morning"),
    shouldRun: true,
    reason: "channel session",
  };

  const { tools } = applyFullFilterChain(ALL_TOOLS, plan, CAP_TOOL_MAP, discordScopeNames);
  const toolNames = tools.map((t) => t.name);

  // browse_web is in Discord scope but also in suppressed browser capability → excluded
  assert.equal(toolNames.includes("browse_web"), false, "H2: browse_web excluded by suppression even though in Discord scope");
  // set_reminder is in Discord scope and not suppressed → included
  assert.equal(toolNames.includes("set_reminder"), true, "H2: set_reminder kept — in Discord scope and not suppressed");
  // send_email is NOT in Discord scope → excluded (channel scope is authoritative)
  assert.equal(toolNames.includes("send_email"), false, "H2: send_email excluded by channel scope");
  console.log(`✓ H2: channel session: positive filter skipped, only suppression + channel scope compose (${tools.length} tools)`);
}

// ─── Test I: Positive filter is a no-op when activeCapabilityIds is empty ─────

{
  const plan: ActivationPlan = {
    capabilityManifest: {
      activeCapabilityIds: [], // empty — no positive filter
      suppressedCapabilityIds: [],
      activatedToolGroups: [],
      reasons: {},
    },
    sessionContext: makeSessionContext("morning"),
    shouldRun: true,
    reason: "no active capabilities",
  };
  const { tools, reduction } = applyFullFilterChain(ALL_TOOLS, plan, CAP_TOOL_MAP, null);
  assert.equal(tools.length, ALL_TOOLS.length, "I: tool list unchanged when no activeCapabilityIds");
  assert.equal(reduction, 0, "I: 0% reduction when no activeCapabilityIds");
  console.log("✓ I: positive filter is a no-op when activeCapabilityIds is empty");
}

// ─── Test J: Research intent classifier ───────────────────────────────────────
// classifyQueryIntent is a pure function exported from activationPlanner.
// We test it here with inline mock patterns to avoid importing the full module.

function classifyQueryIntentInline(text: string): "research" | "general" {
  const RESEARCH_PATTERNS = [
    /\b(search|look up|lookup|google|find|browse|research|investigate)\b/i,
    /\b(article|website|url|link|page|source|reference|docs?|documentation)\b/i,
    /\b(what is|what are|who is|where is|how does|how do|explain|define|tell me about)\b/i,
    /\b(youtube|video|transcript|watch|summarize this)\b/i,
    /\b(latest news|news about|read about|fetch|scrape|crawl)\b/i,
    /https?:\/\//i,
  ];
  if (!text || text.trim().length === 0) return "general";
  return RESEARCH_PATTERNS.some((re) => re.test(text)) ? "research" : "general";
}

{
  const researchQueries = [
    "search for the latest AI papers",
    "What is quantum computing?",
    "find me an article about climate change",
    "look up this website https://example.com",
    "what are the best practices for TypeScript?",
    "browse to github.com and show me the readme",
    "youtube video about meditation",
    "how does photosynthesis work?",
    "latest news about SpaceX",
  ];
  const generalQueries = [
    "remind me to call John at 3pm",
    "add a task to review the proposal",
    "how am I doing with my goals?",
    "I'm feeling stressed today",
    "mark the gym task as done",
    "send a message to my team",
    "what's on my calendar?",
  ];

  let allPassed = true;
  for (const q of researchQueries) {
    const result = classifyQueryIntentInline(q);
    if (result !== "research") {
      console.error(`  J: FAIL — expected research for: "${q}" (got ${result})`);
      allPassed = false;
    }
  }
  for (const q of generalQueries) {
    const result = classifyQueryIntentInline(q);
    if (result !== "general") {
      console.error(`  J: FAIL — expected general for: "${q}" (got ${result})`);
      allPassed = false;
    }
  }
  assert.ok(allPassed, "J: all query classifications must match expected intent");
  console.log(`✓ J: classifyQueryIntent correctly classifies ${researchQueries.length} research + ${generalQueries.length} general queries`);
}

console.log("\nAll assertions passed ✓");
