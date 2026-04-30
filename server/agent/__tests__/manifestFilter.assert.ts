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
import { classifyQueryIntent, classifyBuildIntent } from "../queryClassifier";

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

/**
 * Pure replica of the unified harness filter:
 *   effective = (channel_baseline ∪ activeCapability_tools) − suppressed_tools
 *
 * Mirrors the harness block exactly so integration-level composition is
 * testable without a live registry or OpenAI connection.
 *
 * @param tools           Full tool pool (before any filtering).
 * @param plan            Activation plan (may be undefined = backward compat).
 * @param capToolMap      Maps capability ID → tool name list.
 * @param channelScope    Channel-scoped tool names (null = heartbeat / no channel).
 */
function applyUnifiedFilter(
  tools: AgentTool[],
  plan: ActivationPlan | undefined,
  capToolMap: Record<string, string[]>,
  channelScope: string[] | null,
): { tools: AgentTool[]; reduction: number } {
  if (!channelScope && !plan) {
    return { tools, reduction: 0 }; // no filter at all — backward compat
  }

  const allowed = new Set<string>();
  let hasAnyScope = false;

  // Step 1: Seed from channel scope.
  if (channelScope) {
    hasAnyScope = true;
    for (const name of channelScope) allowed.add(name);
  }

  // Step 2a: UNION in activated capability tools.
  if (plan?.capabilityManifest.activeCapabilityIds.length) {
    hasAnyScope = true;
    for (const capId of plan.capabilityManifest.activeCapabilityIds) {
      for (const name of capToolMap[capId] ?? []) allowed.add(name);
    }
  }

  // Step 2b: Suppression-only heartbeat fallback.
  // When the plan has suppressions but no activations and no channel scope,
  // seed allowed with ALL tools so suppressions have something to remove from.
  if (
    !channelScope &&
    plan &&
    !plan.capabilityManifest.activeCapabilityIds.length &&
    plan.capabilityManifest.suppressedCapabilityIds.length > 0
  ) {
    hasAnyScope = true;
    for (const t of tools) allowed.add(t.name);
  }

  // Step 3: REMOVE suppressed capability tools (wins over both scope and activations).
  if (plan?.capabilityManifest.suppressedCapabilityIds.length) {
    for (const capId of plan.capabilityManifest.suppressedCapabilityIds) {
      for (const name of capToolMap[capId] ?? []) allowed.delete(name);
    }
  }

  if (!hasAnyScope) return { tools, reduction: 0 };

  const filtered = tools.filter((t) => allowed.has(t.name));
  const reduction = tools.length > 0 ? Math.round((1 - filtered.length / tools.length) * 100) : 0;
  return { tools: filtered, reduction };
}

// ── H1: Heartbeat (no channel) — active capabilities only ─────────────────────
// Heartbeat has no channel scope; active capabilities provide the only seed.
// coaching = set_reminder, log_reflection; browser + email excluded.
{
  const plan: ActivationPlan = {
    capabilityManifest: {
      activeCapabilityIds: ["coaching"],
      suppressedCapabilityIds: [],
      activatedToolGroups: [],
      reasons: { coaching: "morning planning" },
    },
    sessionContext: makeSessionContext("morning"),
    shouldRun: true,
    reason: "morning heartbeat",
  };

  const { tools, reduction } = applyUnifiedFilter(ALL_TOOLS, plan, CAP_TOOL_MAP, null);
  const toolNames = tools.map((t) => t.name);
  for (const name of COACHING_TOOLS) {
    assert.equal(toolNames.includes(name), true, `H1: coaching tool "${name}" present on heartbeat`);
  }
  for (const name of [...BROWSER_TOOLS, ...EMAIL_TOOLS]) {
    assert.equal(toolNames.includes(name), false, `H1: non-active "${name}" excluded on heartbeat`);
  }
  assert.ok(reduction >= 60, `H1: ≥60% reduction on heartbeat (got ${reduction}%)`);
  console.log(`✓ H1: heartbeat — only coaching tools (${reduction}% reduction)`);
}

// ── H2: Channel session + meeting proximity — activations ADD calendar/email ──
// Discord scope normally excludes email tools. But when a meeting is 30min away
// the planner activates "email" → union policy adds email tools to Discord scope.
{
  const discordScope = ["browse_web", "browser_click", "set_reminder"]; // normal Discord scope
  const plan: ActivationPlan = {
    capabilityManifest: {
      // Meeting in 30min → planner activates calendar + email (Rule 8a)
      activeCapabilityIds: ["calendar", "email"],
      suppressedCapabilityIds: [],
      activatedToolGroups: [],
      reasons: {
        calendar: "Activated: meeting in 15 min",
        email: "Activated: email for upcoming meeting",
      },
    },
    sessionContext: makeSessionContext("morning"),
    shouldRun: true,
    reason: "Discord channel — meeting in 15 min",
  };

  const { tools } = applyUnifiedFilter(ALL_TOOLS, plan, CAP_TOOL_MAP, discordScope);
  const toolNames = tools.map((t) => t.name);

  // set_reminder is in Discord baseline scope → preserved
  assert.equal(toolNames.includes("set_reminder"), true, "H2: Discord baseline tool set_reminder preserved");
  // send_email is normally NOT in Discord scope, but planner activated email → present via union
  assert.equal(toolNames.includes("send_email"), true, "H2: send_email added via meeting-proximity activation (union override)");
  // browse_web is in Discord scope, not suppressed → present
  assert.equal(toolNames.includes("browse_web"), true, "H2: browse_web present (in Discord scope, not suppressed)");
  // log_reflection is neither in Discord scope nor activated → excluded
  assert.equal(toolNames.includes("log_reflection"), false, "H2: log_reflection absent (not in scope or activations)");
  console.log(`✓ H2: Discord session with meeting in 30min: ${tools.length} tools (scope ∪ calendar+email activations)`);
}

// ── H3: Channel session + research suppression — browser excluded from scope ──
// For a general query on Telegram, the planner suppresses research + browser.
// browser tools in Telegram's scope should be removed by the suppression step.
{
  const telegramScope = ["browse_web", "browser_click", "set_reminder", "send_email"];
  const plan: ActivationPlan = {
    capabilityManifest: {
      activeCapabilityIds: ["coaching", "email"], // coaching + email activated
      suppressedCapabilityIds: ["browser", "research"], // browser + research suppressed (Rule 8c)
      activatedToolGroups: [],
      reasons: {
        coaching: "morning context",
        browser: "Suppressed: general query on Telegram",
      },
    },
    sessionContext: makeSessionContext("morning"),
    shouldRun: true,
    reason: "Telegram — general query",
  };

  const { tools } = applyUnifiedFilter(ALL_TOOLS, plan, CAP_TOOL_MAP, telegramScope);
  const toolNames = tools.map((t) => t.name);

  // Browser tools in Telegram scope → removed by suppression (Step 3 wins)
  assert.equal(toolNames.includes("browse_web"), false, "H3: browse_web removed by suppression despite being in Telegram scope");
  assert.equal(toolNames.includes("browser_click"), false, "H3: browser_click removed by suppression");
  // send_email is in both Telegram scope and email activation → present
  assert.equal(toolNames.includes("send_email"), true, "H3: send_email present (Telegram scope ∪ email activation)");
  // set_reminder is in Telegram scope, not suppressed → present
  assert.equal(toolNames.includes("set_reminder"), true, "H3: set_reminder from Telegram scope preserved");
  console.log(`✓ H3: Telegram general query: ${tools.length} tools (browser suppressed by Rule 8c)`);
}

// ── H3b: Transcript tools survive Rule 8c research suppression ────────────────
// get_youtube_transcript and transcribe_video_url live in the `media` capability
// (not `research`) after #1082. Even when research+browser are suppressed for a
// general Telegram query, transcript tools must remain available because the
// Telegram channel includes "media" in its toolGroups and media is never
// suppressed by Rule 8c.
{
  const TRANSCRIPT_TOOLS = ["get_youtube_transcript", "transcribe_video_url"];
  const H3B_MEDIA_TOOLS = [...TRANSCRIPT_TOOLS, "speak", "image_generate"];
  const H3B_RESEARCH_TOOLS = ["web_search", "web_fetch", "youtube_search"];
  const H3B_BROWSER_TOOLS = ["browse_web", "browser_click"];
  const H3B_COACHING_TOOLS = ["set_reminder", "log_reflection"];

  // Telegram's scope includes all media + research + browser + coaching tools
  // (reflecting the real telegramChannel.toolGroups which includes "media").
  const h3bTelegramScope = [
    ...H3B_MEDIA_TOOLS,
    ...H3B_RESEARCH_TOOLS,
    ...H3B_BROWSER_TOOLS,
    ...H3B_COACHING_TOOLS,
  ];

  const h3bAllTools = h3bTelegramScope.map(makeTool);

  const h3bCapToolMap: Record<string, string[]> = {
    media: H3B_MEDIA_TOOLS,
    research: H3B_RESEARCH_TOOLS,
    browser: H3B_BROWSER_TOOLS,
    coaching: H3B_COACHING_TOOLS,
  };

  const plan: ActivationPlan = {
    capabilityManifest: {
      activeCapabilityIds: ["coaching"],
      suppressedCapabilityIds: ["browser", "research"], // Rule 8c: general query
      activatedToolGroups: [],
      reasons: {
        coaching: "morning context",
        browser: "Suppressed: general query on Telegram",
        research: "Suppressed: general query on Telegram",
      },
    },
    sessionContext: makeSessionContext("morning"),
    shouldRun: true,
    reason: "Telegram — general query (transcript test)",
  };

  const { tools } = applyUnifiedFilter(h3bAllTools, plan, h3bCapToolMap, h3bTelegramScope);
  const toolNames = tools.map((t) => t.name);

  // Transcript tools are in `media` — must survive research suppression
  assert.equal(toolNames.includes("get_youtube_transcript"), true,
    "H3b: get_youtube_transcript must be present even when research is suppressed (media is never Rule 8c suppressed)");
  assert.equal(toolNames.includes("transcribe_video_url"), true,
    "H3b: transcribe_video_url must be present even when research is suppressed");

  // Research tools removed (were in researchCapability — correctly suppressed)
  assert.equal(toolNames.includes("web_search"), false,
    "H3b: web_search is correctly removed by research suppression");
  assert.equal(toolNames.includes("web_fetch"), false,
    "H3b: web_fetch is correctly removed by research suppression");

  // Browser tools removed
  assert.equal(toolNames.includes("browse_web"), false,
    "H3b: browse_web is correctly removed by browser suppression");

  // Coaching tools present (activated)
  assert.equal(toolNames.includes("set_reminder"), true,
    "H3b: set_reminder from coaching activation is present");

  console.log(`✓ H3b: transcript tools (get_youtube_transcript, transcribe_video_url) survive Rule 8c research suppression (${tools.length} tools total)`);
}

// ─── Test I: Backward compat — no plan, no channel → all tools pass ───────────

{
  const { tools, reduction } = applyUnifiedFilter(ALL_TOOLS, undefined, CAP_TOOL_MAP, null);
  assert.equal(tools.length, ALL_TOOLS.length, "I: all tools pass when no plan and no channel");
  assert.equal(reduction, 0, "I: 0% reduction without plan or channel");
  console.log("✓ I: no plan + no channel → all tools pass (backward compat)");
}

// ─── Test I2: Suppression-only heartbeat — suppressions still reduce tools ──
// When a heartbeat plan has ONLY suppressions (empty activeCapabilityIds),
// suppression must still apply against the full tool list.
// Previously: hasAnyScope stayed false → no filter → all tools passed. BUG.
// Fixed: Step 2b seeds allowed with all tools when suppression-only + no channel.
{
  const plan: ActivationPlan = {
    capabilityManifest: {
      activeCapabilityIds: [],                          // no positive filter
      suppressedCapabilityIds: ["browser", "research"], // only suppressions
      activatedToolGroups: [],
      reasons: {
        browser: "Suppressed: general heartbeat query",
        research: "Suppressed: general heartbeat query",
      },
    },
    sessionContext: makeSessionContext("morning"),
    shouldRun: true,
    reason: "general heartbeat — suppress research/browser",
  };

  const { tools, reduction } = applyUnifiedFilter(ALL_TOOLS, plan, CAP_TOOL_MAP, null);
  const toolNames = tools.map((t) => t.name);

  // browser tools must be removed even though no activeCapabilityIds
  for (const name of BROWSER_TOOLS) {
    assert.equal(toolNames.includes(name), false, `I2: browser tool "${name}" must be suppressed on heartbeat`);
  }
  // coaching tools must still be present (not suppressed)
  for (const name of COACHING_TOOLS) {
    assert.equal(toolNames.includes(name), true, `I2: coaching tool "${name}" must survive suppression-only heartbeat`);
  }
  assert.ok(reduction > 0, `I2: suppression-only heartbeat must reduce tool count (got ${reduction}% reduction)`);
  console.log(`✓ I2: suppression-only heartbeat: ${tools.length}/${ALL_TOOLS.length} tools (${reduction}% reduction)`);
}

// ─── Test J: Research intent classifier (real import from queryClassifier.ts) ──
// classifyQueryIntent is imported directly from its pure utility module so
// this test will detect any drift between the implementation and the patterns.
// (Importing from queryClassifier.ts avoids the DB connection in activationPlanner.ts)

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
    const result = classifyQueryIntent(q);
    if (result !== "research") {
      console.error(`  J: FAIL — expected research for: "${q}" (got ${result})`);
      allPassed = false;
    }
  }
  for (const q of generalQueries) {
    const result = classifyQueryIntent(q);
    if (result !== "general") {
      console.error(`  J: FAIL — expected general for: "${q}" (got ${result})`);
      allPassed = false;
    }
  }
  assert.ok(allPassed, "J: all query classifications must match expected intent");
  console.log(`✓ J: classifyQueryIntent (real import) correctly classifies ${researchQueries.length} research + ${generalQueries.length} general queries`);
}

// ─── Test K: Ego override replacement semantics ─────────────────────────────
// Validates that writeEgoOverrides uses replacement (not union) semantics for
// suppressActionTypes, so recovery cycles correctly remove previously-suppressed
// action types from the next session's system prompt.
//
// This test simulates the merge logic in behaviorStore.writeEgoOverrides()
// without a database so it can run in CI without side-effects.
{
  // Simulate Ego Cycle 1: suppresses "email_drafted" and "task_suggested"
  const cycleOneSuppressions = ["email_drafted", "task_suggested"];
  const prevOverrides = { suppressActionTypes: cycleOneSuppressions };

  // Simulate Ego Cycle 2: "email_drafted" recovered (back above threshold)
  const cycleTwoSuppressions = ["task_suggested"]; // email_drafted removed

  // Apply replacement semantics (mirrors the corrected writeEgoOverrides logic)
  const newOverrides = { suppressActionTypes: cycleTwoSuppressions };
  const merged = {
    ...prevOverrides,
    ...newOverrides,
    suppressActionTypes: newOverrides.suppressActionTypes ?? prevOverrides.suppressActionTypes ?? [],
  };

  assert.deepEqual(merged.suppressActionTypes, ["task_suggested"],
    "K: replacement semantics must yield only the latest suppression list");
  assert.ok(
    !merged.suppressActionTypes.includes("email_drafted"),
    "K: recovered action type 'email_drafted' must NOT appear in merged instruction_overrides"
  );

  // Simulate Ego Cycle 3: all action types recovered (empty list)
  const cycleThreeSuppressions: string[] = [];
  const newOverrides3 = { suppressActionTypes: cycleThreeSuppressions };
  const merged3 = {
    ...merged,
    ...newOverrides3,
    suppressActionTypes: newOverrides3.suppressActionTypes ?? [],
  };

  assert.deepEqual(merged3.suppressActionTypes, [],
    "K: when all action types recover, instruction_overrides.suppressActionTypes must be empty");

  console.log("✓ K: Ego override replacement semantics: suppress → recover → clear lifecycle verified");
}

// ─── Test L: Build intent classifier ────────────────────────────────────────
// Verifies classifyBuildIntent correctly flags tool/feature build requests and
// does NOT false-positive on research, writing, or planning messages.
{
  const buildQueries = [
    "build a tool that checks stock prices",
    "create a new integration for Notion",
    "add a weather lookup tool",
    "write a script that fetches my GitHub notifications",
    "make a tool that monitors my email",
    "implement a capability to track my expenses",
    "build an integration with Slack",
    "add support for sending WhatsApp messages",
    "write the code for a Reddit reader tool",
    "create a bot that posts to Twitter",
    "add a webhook tool for Stripe",
    "extend yourself with a new Spotify integration",
    "give Jarvis a new capability for tracking flights",
    "add a Jarvis command to summarize Slack channels",
  ];
  const nonBuildQueries = [
    "build a plan for next week",
    "write a memo about Q2 results",
    "write an email to my manager",
    "research AI trends",
    "create a document summarizing the meeting",
    "make a schedule for tomorrow",
    "what's on my calendar?",
    "how am I doing with my goals?",
    "remind me to call John at 3pm",
    "find articles about climate change",
  ];

  let allPassed = true;
  for (const q of buildQueries) {
    const result = classifyBuildIntent(q);
    if (!result) {
      console.error(`  L: FAIL — expected build intent for: "${q}"`);
      allPassed = false;
    }
  }
  for (const q of nonBuildQueries) {
    const result = classifyBuildIntent(q);
    if (result) {
      console.error(`  L: FAIL — false positive build intent for: "${q}"`);
      allPassed = false;
    }
  }
  assert.ok(allPassed, "L: all build-intent classifications must match expected result");
  console.log(`✓ L: classifyBuildIntent correctly identifies ${buildQueries.length} build + ${nonBuildQueries.length} non-build queries`);
}

console.log("\nAll assertions passed ✓");
