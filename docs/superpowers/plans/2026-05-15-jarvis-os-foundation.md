# Jarvis OS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jarvis reliably functional as a self-checking, self-routing agent OS foundation before adding deeper OpenClaw-style autonomy.

**Architecture:** Keep the current Express + Drizzle + Expo architecture intact. Add a thin "OS foundation" layer that verifies runtime readiness, gives every autonomous path a clear policy decision, proves background deliverables land in reviewable inbox surfaces, and documents one safe startup path.

**Tech Stack:** Node 22, TypeScript, tsx, Express, Drizzle/Postgres, existing `server/agent` harness, existing diagnostics service, existing job queue, existing channel registry.

---

## Scope

This is Phase 0 / Level 1 work. It does not move folders, replace the agent harness, redesign memory, or enable unrestricted daemon control. It makes the existing system dependable enough to build on:

- One command checks whether Jarvis is healthy enough to run.
- One typed readiness report explains missing setup clearly.
- One deterministic autonomy policy decides: answer inline, queue background job, require approval, or block until setup is fixed.
- One smoke path proves Jarvis can accept a request, use the harness/tool layer, queue work, and surface a deliverable.
- One runbook tells future agents and humans how to start, test, and debug the OS foundation.

## File Structure

- Create: `server/diagnostics/osReadiness.ts`
  - Converts the existing diagnostics service into a stable Jarvis OS readiness contract.
  - Does not create new probes where an existing diagnostic already exists.

- Create: `server/diagnostics/__tests__/osReadiness.test.ts`
  - Unit tests for readiness classification and plain-English setup guidance.

- Create: `scripts/jarvis-doctor.ts`
  - CLI wrapper around `getJarvisOsReadiness`.
  - Exits `0` when ready enough for local development, `1` when core systems are down.

- Modify: `package.json`
  - Add `jarvis:doctor`.
  - Add `jarvis:check` to run doctor plus existing agent tests.

- Create: `server/agent/autonomyPolicy.ts`
  - Deterministic first-pass policy for autonomous behavior.
  - Does not replace model reasoning; it gates model/tool behavior before risky work.

- Create: `server/agent/__tests__/autonomyPolicy.test.ts`
  - Unit tests for queue/approval/block/inline decisions.

- Create: `server/agent/osSmoke.ts`
  - A small programmatic smoke flow that proves the OS foundation works without requiring a live LLM call in tests.

- Create: `server/agent/__tests__/osSmoke.test.ts`
  - Tests the smoke flow using fake dependencies.

- Modify: `scripts/run-agent-tests.mjs`
  - Add the new tests.

- Create: `docs/operations/jarvis-os-runbook.md`
  - Human and future-agent instructions for setup, health checks, known boundaries, and the first safe autonomy path.

- Modify: `docs/architecture.md`
  - Add a short note that "Jarvis OS Foundation" is the reliability layer, not a new architecture.

---

### Task 1: Add Jarvis OS Readiness Contract

**Files:**
- Create: `server/diagnostics/osReadiness.ts`
- Create: `server/diagnostics/__tests__/osReadiness.test.ts`

- [x] **Step 1: Write the failing readiness tests**

Create `server/diagnostics/__tests__/osReadiness.test.ts`:

```ts
import assert from "node:assert/strict";
import {
  classifyJarvisOsReadiness,
  formatJarvisOsReadiness,
  type JarvisOsProbe,
} from "../osReadiness";

const healthyProbe = (id: string): JarvisOsProbe => ({
  id,
  label: id,
  status: "healthy",
  requiredFor: "core",
  message: `${id} is healthy`,
});

const downProbe = (id: string, requiredFor: JarvisOsProbe["requiredFor"]): JarvisOsProbe => ({
  id,
  label: id,
  status: "down",
  requiredFor,
  message: `${id} is down`,
  fix: `Fix ${id}`,
});

{
  const report = classifyJarvisOsReadiness([
    healthyProbe("database"),
    healthyProbe("agent_harness"),
    healthyProbe("job_queue"),
  ]);

  assert.equal(report.overallStatus, "ready");
  assert.equal(report.canStartServer, true);
  assert.equal(report.canRunAgentLoop, true);
  assert.equal(report.canRunBackgroundJobs, true);
  assert.equal(report.blockers.length, 0);
}

{
  const report = classifyJarvisOsReadiness([
    downProbe("database", "core"),
    healthyProbe("agent_harness"),
    healthyProbe("job_queue"),
  ]);

  assert.equal(report.overallStatus, "blocked");
  assert.equal(report.canStartServer, false);
  assert.equal(report.canRunAgentLoop, false);
  assert.equal(report.blockers[0].id, "database");
}

{
  const report = classifyJarvisOsReadiness([
    healthyProbe("database"),
    healthyProbe("agent_harness"),
    downProbe("telegram", "channel"),
  ]);

  assert.equal(report.overallStatus, "limited");
  assert.equal(report.canStartServer, true);
  assert.equal(report.canRunAgentLoop, true);
  assert.equal(report.canUseExternalChannels, false);
}

{
  const report = classifyJarvisOsReadiness([
    downProbe("openai", "agent_loop"),
    healthyProbe("database"),
    healthyProbe("job_queue"),
  ]);
  const text = formatJarvisOsReadiness(report);

  assert.match(text, /Jarvis OS readiness: blocked/i);
  assert.match(text, /Fix openai/i);
}
```

- [x] **Step 2: Run the new test to verify it fails**

Run:

```powershell
npx tsx server/diagnostics/__tests__/osReadiness.test.ts
```

Expected: fails because `server/diagnostics/osReadiness.ts` does not exist.

- [x] **Step 3: Create the readiness module**

Create `server/diagnostics/osReadiness.ts`:

```ts
import { runHealthCheck } from "./diagnosticsService";

export type JarvisOsProbeStatus = "healthy" | "degraded" | "down" | "unknown";

export type JarvisOsRequiredFor =
  | "core"
  | "agent_loop"
  | "background_jobs"
  | "channel"
  | "integration"
  | "optional";

export interface JarvisOsProbe {
  id: string;
  label: string;
  status: JarvisOsProbeStatus;
  requiredFor: JarvisOsRequiredFor;
  message: string;
  fix?: string;
}

export interface JarvisOsReadinessReport {
  overallStatus: "ready" | "limited" | "blocked";
  generatedAt: string;
  canStartServer: boolean;
  canRunAgentLoop: boolean;
  canRunBackgroundJobs: boolean;
  canUseExternalChannels: boolean;
  blockers: JarvisOsProbe[];
  warnings: JarvisOsProbe[];
  probes: JarvisOsProbe[];
}

function isBad(status: JarvisOsProbeStatus): boolean {
  return status === "down" || status === "unknown";
}

function hasBadProbe(probes: JarvisOsProbe[], requiredFor: JarvisOsRequiredFor): boolean {
  return probes.some((probe) => probe.requiredFor === requiredFor && isBad(probe.status));
}

export function classifyJarvisOsReadiness(probes: JarvisOsProbe[]): JarvisOsReadinessReport {
  const blockers = probes.filter((probe) =>
    isBad(probe.status) &&
    (probe.requiredFor === "core" || probe.requiredFor === "agent_loop" || probe.requiredFor === "background_jobs")
  );

  const warnings = probes.filter((probe) =>
    probe.status === "degraded" ||
    (isBad(probe.status) && (probe.requiredFor === "channel" || probe.requiredFor === "integration" || probe.requiredFor === "optional"))
  );

  const canStartServer = !hasBadProbe(probes, "core");
  const canRunAgentLoop = canStartServer && !hasBadProbe(probes, "agent_loop");
  const canRunBackgroundJobs = canRunAgentLoop && !hasBadProbe(probes, "background_jobs");
  const canUseExternalChannels = !hasBadProbe(probes, "channel");

  const overallStatus =
    blockers.length > 0 ? "blocked" :
    warnings.length > 0 ? "limited" :
    "ready";

  return {
    overallStatus,
    generatedAt: new Date().toISOString(),
    canStartServer,
    canRunAgentLoop,
    canRunBackgroundJobs,
    canUseExternalChannels,
    blockers,
    warnings,
    probes,
  };
}

export function formatJarvisOsReadiness(report: JarvisOsReadinessReport): string {
  const lines = [
    `Jarvis OS readiness: ${report.overallStatus}`,
    `Server: ${report.canStartServer ? "ready" : "blocked"}`,
    `Agent loop: ${report.canRunAgentLoop ? "ready" : "blocked"}`,
    `Background jobs: ${report.canRunBackgroundJobs ? "ready" : "blocked"}`,
    `External channels: ${report.canUseExternalChannels ? "ready" : "limited"}`,
  ];

  if (report.blockers.length > 0) {
    lines.push("", "Blockers:");
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker.label}: ${blocker.message}${blocker.fix ? ` | Fix: ${blocker.fix}` : ""}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) {
      lines.push(`- ${warning.label}: ${warning.message}${warning.fix ? ` | Fix: ${warning.fix}` : ""}`);
    }
  }

  return lines.join("\n");
}

export async function getJarvisOsReadiness(userId = "local-doctor"): Promise<JarvisOsReadinessReport> {
  const health = await runHealthCheck(userId);
  const probes: JarvisOsProbe[] = health.subsystems.map((subsystem) => {
    const requiredFor: JarvisOsRequiredFor =
      subsystem.name === "database" ? "core" :
      subsystem.name === "agent_harness" ? "agent_loop" :
      subsystem.name === "job_queue" ? "background_jobs" :
      subsystem.name === "channel_registry" ? "channel" :
      subsystem.name === "integration" ? "integration" :
      "optional";

    return {
      id: subsystem.name,
      label: subsystem.label,
      status: subsystem.status,
      requiredFor,
      message: subsystem.message || `${subsystem.label} status is ${subsystem.status}`,
      fix: subsystem.recommendedAction || undefined,
    };
  });

  return classifyJarvisOsReadiness(probes);
}
```

- [x] **Step 4: Run the readiness test**

Run:

```powershell
npx tsx server/diagnostics/__tests__/osReadiness.test.ts
```

Expected: passes.

---

### Task 2: Add Jarvis Doctor CLI

**Files:**
- Create: `scripts/jarvis-doctor.ts`
- Modify: `package.json`

- [x] **Step 1: Create the doctor CLI**

Create `scripts/jarvis-doctor.ts`:

```ts
import { formatJarvisOsReadiness, getJarvisOsReadiness } from "../server/diagnostics/osReadiness";

async function main(): Promise<void> {
  const userId = process.env.JARVIS_DOCTOR_USER_ID || "local-doctor";
  const report = await getJarvisOsReadiness(userId);

  console.log(formatJarvisOsReadiness(report));

  if (report.overallStatus === "blocked") {
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Jarvis doctor failed before producing a readiness report: ${message}`);
  process.exitCode = 1;
});
```

- [x] **Step 2: Add package scripts**

Modify the `scripts` section in `package.json` to include:

```json
{
  "jarvis:doctor": "tsx scripts/jarvis-doctor.ts",
  "jarvis:check": "npm run jarvis:doctor && npm test"
}
```

Keep all existing scripts unchanged.

- [x] **Step 3: Run the doctor without a database**

Run:

```powershell
npm run jarvis:doctor
```

Expected: prints a readable readiness report. If `DATABASE_URL` is missing or invalid, exits `1` and names database setup as a blocker.

- [x] **Step 4: Run the full local check**

Run:

```powershell
npm run jarvis:check
```

Expected: if local setup is incomplete, doctor fails first with a clear blocker. If core setup is complete, existing tests run.

---

### Task 3: Add First-Pass Autonomy Policy

**Files:**
- Create: `server/agent/autonomyPolicy.ts`
- Create: `server/agent/__tests__/autonomyPolicy.test.ts`

- [x] **Step 1: Write the failing policy tests**

Create `server/agent/__tests__/autonomyPolicy.test.ts`:

```ts
import assert from "node:assert/strict";
import { decideAutonomyMode } from "../autonomyPolicy";

{
  const decision = decideAutonomyMode({
    userText: "Research the best CRM for a cannabis microbusiness and make a report",
    readiness: "ready",
    hasApproval: false,
  });

  assert.equal(decision.mode, "queue_background_job");
  assert.equal(decision.agentType, "deep_research");
}

{
  const decision = decideAutonomyMode({
    userText: "Send this email to the regulator",
    readiness: "ready",
    hasApproval: false,
  });

  assert.equal(decision.mode, "requires_approval");
  assert.match(decision.reason, /external action/i);
}

{
  const decision = decideAutonomyMode({
    userText: "What should I focus on today?",
    readiness: "ready",
    hasApproval: false,
  });

  assert.equal(decision.mode, "answer_inline");
}

{
  const decision = decideAutonomyMode({
    userText: "Analyze my inbox and draft replies",
    readiness: "blocked",
    hasApproval: false,
  });

  assert.equal(decision.mode, "blocked_by_setup");
}
```

- [x] **Step 2: Run the policy test to verify it fails**

Run:

```powershell
npx tsx server/agent/__tests__/autonomyPolicy.test.ts
```

Expected: fails because `server/agent/autonomyPolicy.ts` does not exist.

- [x] **Step 3: Create the autonomy policy**

Create `server/agent/autonomyPolicy.ts`:

```ts
export type AutonomyReadiness = "ready" | "limited" | "blocked";

export type AutonomyMode =
  | "answer_inline"
  | "queue_background_job"
  | "requires_approval"
  | "blocked_by_setup";

export interface AutonomyPolicyInput {
  userText: string;
  readiness: AutonomyReadiness;
  hasApproval: boolean;
}

export interface AutonomyPolicyDecision {
  mode: AutonomyMode;
  reason: string;
  agentType?: "research" | "deep_research" | "writing" | "planning" | "email";
}

const BACKGROUND_PATTERNS = [
  /\bresearch\b/i,
  /\blook into\b/i,
  /\bcompare\b/i,
  /\breport\b/i,
  /\bdeep dive\b/i,
  /\bwrite (a|an|the)\b/i,
  /\bdraft (a|an|the)\b/i,
  /\bplan\b/i,
];

const EXTERNAL_ACTION_PATTERNS = [
  /\bsend\b/i,
  /\bpost\b/i,
  /\bschedule\b/i,
  /\bdelete\b/i,
  /\bpurchase\b/i,
  /\bcommit\b/i,
  /\bcontact\b/i,
  /\bdeploy\b/i,
  /\bsubmit\b/i,
];

function inferAgentType(text: string): AutonomyPolicyDecision["agentType"] {
  if (/\bemail\b|\breply\b/i.test(text)) return "email";
  if (/\bplan\b|\broadmap\b|\bsequence\b/i.test(text)) return "planning";
  if (/\bwrite\b|\bdraft\b|\bmemo\b|\bdoc\b/i.test(text)) return "writing";
  if (/\bcompare\b|\bdeep dive\b|\bmarket\b|\bstrategy\b/i.test(text)) return "deep_research";
  return "research";
}

export function decideAutonomyMode(input: AutonomyPolicyInput): AutonomyPolicyDecision {
  const text = input.userText.trim();

  if (input.readiness === "blocked") {
    return {
      mode: "blocked_by_setup",
      reason: "Jarvis core setup is blocked, so autonomous work should not start until doctor blockers are fixed.",
    };
  }

  if (!input.hasApproval && EXTERNAL_ACTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      mode: "requires_approval",
      reason: "The request appears to involve an external action or irreversible side effect.",
    };
  }

  if (BACKGROUND_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      mode: "queue_background_job",
      reason: "The request is multi-step and should produce a reviewable deliverable instead of blocking the chat.",
      agentType: inferAgentType(text),
    };
  }

  return {
    mode: "answer_inline",
    reason: "The request is short, low-risk, and can be answered immediately.",
  };
}
```

- [x] **Step 4: Run the policy test**

Run:

```powershell
npx tsx server/agent/__tests__/autonomyPolicy.test.ts
```

Expected: passes.

---

### Task 4: Add OS Smoke Flow With Fake Dependencies

**Files:**
- Create: `server/agent/osSmoke.ts`
- Create: `server/agent/__tests__/osSmoke.test.ts`

- [x] **Step 1: Write the failing smoke test**

Create `server/agent/__tests__/osSmoke.test.ts`:

```ts
import assert from "node:assert/strict";
import { runJarvisOsSmoke } from "../osSmoke";

{
  const events: string[] = [];

  const result = await runJarvisOsSmoke({
    userText: "Research local grant options and make a short report",
    readiness: "ready",
    hasApproval: false,
    queueBackgroundJob: async (job) => {
      events.push(`${job.agentType}:${job.title}`);
      return { jobId: "job_123" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "queue_background_job");
  assert.equal(result.jobId, "job_123");
  assert.deepEqual(events, ["deep_research:Research local grant options"]);
}

{
  const result = await runJarvisOsSmoke({
    userText: "Send an email to the regulator",
    readiness: "ready",
    hasApproval: false,
    queueBackgroundJob: async () => {
      throw new Error("queue should not run");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "requires_approval");
  assert.equal(result.jobId, undefined);
}
```

- [x] **Step 2: Run the smoke test to verify it fails**

Run:

```powershell
npx tsx server/agent/__tests__/osSmoke.test.ts
```

Expected: fails because `server/agent/osSmoke.ts` does not exist.

- [x] **Step 3: Create the smoke flow**

Create `server/agent/osSmoke.ts`:

```ts
import { decideAutonomyMode, type AutonomyReadiness } from "./autonomyPolicy";

export interface QueueBackgroundJobInput {
  agentType: "research" | "deep_research" | "writing" | "planning" | "email";
  title: string;
  prompt: string;
}

export interface RunJarvisOsSmokeDeps {
  userText: string;
  readiness: AutonomyReadiness;
  hasApproval: boolean;
  queueBackgroundJob: (job: QueueBackgroundJobInput) => Promise<{ jobId: string }>;
}

export interface JarvisOsSmokeResult {
  ok: boolean;
  mode: string;
  reason: string;
  jobId?: string;
}

function deriveTitle(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .slice(0, 80);
}

export async function runJarvisOsSmoke(deps: RunJarvisOsSmokeDeps): Promise<JarvisOsSmokeResult> {
  const decision = decideAutonomyMode({
    userText: deps.userText,
    readiness: deps.readiness,
    hasApproval: deps.hasApproval,
  });

  if (decision.mode !== "queue_background_job") {
    return {
      ok: true,
      mode: decision.mode,
      reason: decision.reason,
    };
  }

  const agentType = decision.agentType || "research";
  const queued = await deps.queueBackgroundJob({
    agentType,
    title: deriveTitle(deps.userText),
    prompt: deps.userText,
  });

  return {
    ok: true,
    mode: decision.mode,
    reason: decision.reason,
    jobId: queued.jobId,
  };
}
```

- [x] **Step 4: Run the smoke test**

Run:

```powershell
npx tsx server/agent/__tests__/osSmoke.test.ts
```

Expected: passes.

---

### Task 5: Wire New Tests Into The Agent Test Runner

**Files:**
- Modify: `scripts/run-agent-tests.mjs`

- [x] **Step 1: Add new non-database tests to the test list**

Modify the `tests` array in `scripts/run-agent-tests.mjs` by adding:

```js
  { file: "server/diagnostics/__tests__/osReadiness.test.ts" },
  { file: "server/agent/__tests__/autonomyPolicy.test.ts" },
  { file: "server/agent/__tests__/osSmoke.test.ts" },
```

Place them before the DB-backed tests so foundational failures appear early.

- [x] **Step 2: Run the test runner**

Run:

```powershell
npm test
```

Expected: new tests pass. DB-backed tests still skip when `DATABASE_URL` is absent, matching current behavior.

---

### Task 6: Add The Operations Runbook

**Files:**
- Create: `docs/operations/jarvis-os-runbook.md`

- [x] **Step 1: Create the operations directory**

Run:

```powershell
New-Item -ItemType Directory -Force -Path 'docs\operations' | Out-Null
```

Expected: `docs/operations` exists.

- [x] **Step 2: Create the runbook**

Create `docs/operations/jarvis-os-runbook.md`:

```md
# Jarvis OS Runbook

## Purpose

This is the startup and reliability guide for Jarvis as an agent operating system. It explains how to verify the foundation before adding autonomy.

## Canonical Runtime

Use this repo as the current source of truth:

`C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-gameplanjarvisai\github-push\Gameplanjarvisai`

## First Command

Run:

```powershell
npm run jarvis:doctor
```

Read the blocker list before starting the server. Fix core blockers first.

## Local Verification

Run:

```powershell
npm run jarvis:check
```

This runs the doctor first, then the agent test suite.

## Safe Autonomy Path

Jarvis may act autonomously only through this first-level flow:

1. Check OS readiness.
2. Classify the user request with the autonomy policy.
3. Answer inline for low-risk requests.
4. Queue a background job for multi-step work.
5. Require approval for external actions.
6. Surface results in reviewable inbox/deliverable channels.

## Approval Boundaries

Jarvis must ask before sending messages, changing calendars, posting publicly, deleting data, triggering daemon/device actions, making purchases, committing code, deploying, or taking any licensing/compliance/business-finance action.

## What This Foundation Does Not Do

- It does not replace `server/agent/harness.ts`.
- It does not move folders.
- It does not enable free-form daemon control.
- It does not make memory writes automatic without consent-safe rules.
- It does not bypass existing channel or integration checks.

## When Something Breaks

1. Run `npm run jarvis:doctor`.
2. If doctor is blocked, fix the named blocker.
3. If doctor is limited, keep core server work going but avoid affected integrations.
4. Run `npm test`.
5. Use `jarvis_self_diagnose` from the agent tool layer when debugging live user-facing behavior.
```

- [x] **Step 3: Confirm the runbook exists**

Run:

```powershell
Test-Path 'docs\operations\jarvis-os-runbook.md'
```

Expected: `True`.

---

### Task 7: Document The Foundation In Architecture Notes

**Files:**
- Modify: `docs/architecture.md`

- [x] **Step 1: Add a short section after "Design Principle"**

Append this section after the existing `## Design Principle` section:

```md
## Jarvis OS Foundation

The Jarvis OS Foundation is the reliability layer that sits above the existing server and agent modules. It does not replace the current architecture. It defines a readiness contract, a doctor command, a first-pass autonomy policy, and smoke tests that prove Jarvis can safely decide between inline answers, background jobs, and approval-gated actions.

This layer exists so OpenClaw-style capabilities can be added incrementally without turning setup and debugging into guesswork.
```

- [x] **Step 2: Review the architecture doc**

Run:

```powershell
rg -n "Jarvis OS Foundation|readiness contract|doctor command" docs\architecture.md
```

Expected: the new section appears once.

---

### Task 8: Final Verification

**Files:**
- No new files.

- [x] **Step 1: Run tests**

Run:

```powershell
npm test
```

Expected: all non-DB tests pass. DB-backed tests skip if `DATABASE_URL` is not set.

- [x] **Step 2: Run doctor**

Run:

```powershell
npm run jarvis:doctor
```

Expected: prints a readiness report. It may return `blocked` on machines without database/env setup, but the output must name the blocker clearly.

- [x] **Step 3: Run full check**

Run:

```powershell
npm run jarvis:check
```

Expected: if the local environment is complete, doctor and tests pass. If the local environment is incomplete, doctor exits first with actionable setup guidance.

- [x] **Step 4: Inspect changed files**

Run:

```powershell
git status --short
```

Expected: only the files named in this plan changed.

---

## Success Criteria

- A future worker can run one command to know whether Jarvis is usable.
- Core readiness failures are explicit, not mysterious runtime crashes.
- Background work is gated through a deterministic first-pass policy.
- External actions require approval before execution.
- Tests prove the readiness contract, autonomy policy, and smoke flow.
- The runbook gives humans and agents the same operating path.

## Follow-up Implementation Status

Completed after the original checklist:

- [x] Live coach/chat path now calls the autonomy runtime before the orchestrator for obvious autonomous work.
- [x] Multi-step research, writing, planning, and email-draft requests are queued through the existing `agent_jobs` system instead of being answered as text-only coaching.
- [x] External side-effect requests are paused with an explicit approval message before Jarvis proceeds.
- [x] The autonomy runtime lazily loads the real job queue so unit tests can run without `DATABASE_URL`.
- [x] `server/agent/__tests__/autonomyRuntime.test.ts` covers queue, approval, inline, and blocked-readiness behavior.
- [x] `scripts/run-agent-tests.mjs` runs the autonomy runtime test with the rest of the foundation tests.
- [x] Top-level chat approval requests now create durable `agent_approval_gates`, approval deliverables, and in-app approval notifications instead of only returning a text prompt.
- [x] Approved top-level autonomy gates now queue a safe continuation job with the original request, approval gate id, and origin channel.

Next work to avoid drift:

- [ ] Tighten approved-action execution so continuation jobs can pass a scoped approval receipt into specific tool calls and avoid duplicate final-send approval when the original gate already covers the exact action.
- [ ] Surface queued autonomy jobs in the Jarvis UI with status, result preview, retry, approve, and revise actions.
- [ ] Expand tool-aware routing for weather, calendar, Gmail, memory, browser, GitHub, Railway, and code-writing requests so Jarvis uses tools before giving capability disclaimers.
- [ ] Add an end-to-end app-chat test that fakes DB/job dependencies and proves `/api/coach/chat` routes a research request into a background job.
- [ ] Add production observability for autonomy decisions: mode, agent type, job ID, readiness status, and approval boundary.

## Intentional Non-Goals

- No folder migration.
- No full OpenClaw port.
- No new daemon powers.
- No production deployment.
- No automatic memory rewriting.
- No changes to `agents/PRIME.md`, `agents/ROUTING.md`, or `agents/SOUL.md`.

## Self-Review

Spec coverage:
- "Make Jarvis functional on his own" is covered by readiness, doctor, autonomy policy, smoke flow, and deliverable-safe routing.
- "Without hard setup and breaking" is covered by doctor, runbook, tests, and clear blocked/limited states.
- "Long-term success" is covered by a foundation layer that preserves the current architecture and gives future features a stable gate.

Placeholder scan:
- This plan uses concrete file names, commands, and code snippets. There are no deferred implementation markers.

Type consistency:
- `AutonomyReadiness`, `AutonomyPolicyDecision`, `JarvisOsProbe`, and `JarvisOsReadinessReport` are introduced before use and referenced consistently.
