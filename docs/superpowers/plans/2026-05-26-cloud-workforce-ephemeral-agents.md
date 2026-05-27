# Cloud Workforce / Ephemeral Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Jarvis create short-lived specialist agents for a task session, run them with scoped guardrails, preserve useful handoff memory, and clean up the temporary agent afterward.

**Architecture:** Reuse the existing named-agent system instead of inventing a parallel agent runner. Add a small ephemeral-agent lifecycle module that creates a normal `discord_agents` row with `configJson.ephemeral = true`, runs it through `runNamedAgent()`, promotes useful handoff notes to durable memory, then deactivates or deletes the temporary agent according to policy.

**Tech Stack:** TypeScript, Express route/tool layer, Drizzle/Postgres schema already in `shared/schema.ts`, existing `createAgent()`, `deleteAgent()`, `disableAgent()`, `runNamedAgent()`, `agentMemory`, and `agentJobs`.

---

## File Structure

- Create `server/agent/ephemeralAgents.ts`
  - Owns ephemeral template definitions, creation, execution, cleanup, and deterministic template selection helpers.
- Create `server/agent/__tests__/ephemeralAgents.test.ts`
  - Tests template creation, permission scoping, cleanup mode, and handoff extraction/promotion behavior.
- Modify `scripts/run-agent-tests.mjs`
  - Adds the new focused test to the normal Jarvis test runner.
- Modify `server/agent/jobQueue.ts`
  - Later slice: handles an `ephemeral_agent_task` job type by calling `runEphemeralAgentSession()`.
- Modify `server/agent/jobClient.ts`
  - Later slice: allows queuing ephemeral specialist jobs with worker type metadata.
- Modify `server/agent/tools/queueBackgroundJob.ts` or add a narrow tool wrapper
  - Later slice: lets Jarvis request an ephemeral specialist through the worker queue.

## Current Repo Facts To Preserve

- `server/agent/agentManager.ts` already has `createAgent()`, `deleteAgent()`, `disableAgent()`, and typed `CreateAgentConfig`.
- `server/agent/runNamedAgent.ts` already loads an agent, builds a permission-filtered tool list, injects persona/context, executes the harness, and writes agent memory.
- `agent_memories.agentId` has `onDelete: "cascade"`. If an ephemeral agent is hard-deleted, its private memories are deleted too.
- Therefore, useful study notes/facts/preferences must be promoted to durable user memory or a handoff record before deletion.

---

### Task 1: Add Ephemeral Agent Template Builder

**Files:**
- Create: `server/agent/ephemeralAgents.ts`
- Test: `server/agent/__tests__/ephemeralAgents.test.ts`
- Modify: `scripts/run-agent-tests.mjs`

- [x] **Step 1: Write the failing template test**

Add this test block to `server/agent/__tests__/ephemeralAgents.test.ts`:

```ts
import assert from "node:assert/strict";
import {
  buildEphemeralAgentTemplate,
  EPHEMERAL_AGENT_TEMPLATES,
} from "../ephemeralAgents";

{
  const template = buildEphemeralAgentTemplate({
    kind: "study",
    userRequest: "Can you help me study for a biology test?",
  });

  assert.equal(template.kind, "study");
  assert.equal(template.name, "Study Agent");
  assert.equal(template.role, "study");
  assert.match(template.persona, /study agent/i);
  assert.match(template.persona, /quiz/i);
  assert.match(template.persona, /facts and preferences/i);
  assert.equal(template.memoryPolicy.promoteHandoffToUserMemory, true);
  assert.equal(template.cleanupMode, "disable");
  assert.equal(template.permissions.can_create_other_agents, false);
  assert.equal(template.permissions.can_send_messages, false);
  console.log("OK: study ephemeral template is scoped and memory-aware");
}

{
  assert.deepEqual(Object.keys(EPHEMERAL_AGENT_TEMPLATES).sort(), ["study"]);
  console.log("OK: ephemeral template registry is deterministic");
}

console.log("\nephemeralAgents.test passed");
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\ephemeralAgents.test.ts
```

Expected: failure because `server/agent/ephemeralAgents.ts` does not exist yet.

- [x] **Step 3: Add the template implementation**

Create `server/agent/ephemeralAgents.ts`:

```ts
import type { AgentPermissions } from "@shared/schema";

export type EphemeralAgentKind = "study";

export type EphemeralCleanupMode = "disable" | "delete";

export interface EphemeralAgentMemoryPolicy {
  promoteHandoffToUserMemory: boolean;
  handoffInstruction: string;
}

export interface EphemeralAgentTemplate {
  kind: EphemeralAgentKind;
  name: string;
  role: string;
  persona: string;
  permissions: Partial<AgentPermissions>;
  memoryPolicy: EphemeralAgentMemoryPolicy;
  cleanupMode: EphemeralCleanupMode;
  ttlMinutes: number;
}

interface BuildTemplateOptions {
  kind: EphemeralAgentKind;
  userRequest: string;
}

function basePermissions(): Partial<AgentPermissions> {
  return {
    can_send_messages: false,
    can_create_other_agents: false,
    can_manage_agents: false,
    can_use_browser: false,
    can_use_email: false,
    can_use_calendar: false,
    can_use_memory: true,
    can_use_files: false,
    can_run_shell: false,
  };
}

export const EPHEMERAL_AGENT_TEMPLATES: Record<EphemeralAgentKind, Omit<EphemeralAgentTemplate, "persona">> = {
  study: {
    kind: "study",
    name: "Study Agent",
    role: "study",
    permissions: basePermissions(),
    memoryPolicy: {
      promoteHandoffToUserMemory: true,
      handoffInstruction:
        "At the end of the session, write concise notes about durable facts, study preferences, weak areas, and next review topics.",
    },
    cleanupMode: "disable",
    ttlMinutes: 240,
  },
};

export function buildEphemeralAgentTemplate(opts: BuildTemplateOptions): EphemeralAgentTemplate {
  const template = EPHEMERAL_AGENT_TEMPLATES[opts.kind];
  const request = opts.userRequest.trim().slice(0, 500);

  return {
    ...template,
    permissions: { ...template.permissions },
    persona: [
      "You are a temporary study agent created by Jarvis for one focused study session.",
      "Act only as a study agent: explain concepts, quiz the user, identify weak spots, and adapt to the user's pace.",
      "Do not claim to be a permanent agent. Do not change system settings or create other agents.",
      "Take notes on durable facts and preferences only: subjects, test dates, weak areas, preferred quiz style, and useful study strategies.",
      `User request: ${request || "Study session"}`,
      template.memoryPolicy.handoffInstruction,
    ].join("\n"),
  };
}
```

- [x] **Step 4: Add the test to the runner**

Modify `scripts/run-agent-tests.mjs` by adding:

```js
{ file: "server/agent/__tests__/ephemeralAgents.test.ts" },
```

near the other `server/agent/__tests__` entries.

- [x] **Step 5: Run the focused test**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\ephemeralAgents.test.ts
```

Expected: pass with:

```text
OK: study ephemeral template is scoped and memory-aware
OK: ephemeral template registry is deterministic
ephemeralAgents.test passed
```

---

### Task 2: Add Create And Cleanup Lifecycle

**Files:**
- Modify: `server/agent/ephemeralAgents.ts`
- Modify: `server/agent/__tests__/ephemeralAgents.test.ts`

- [x] **Step 1: Write the failing lifecycle tests**

Append to `server/agent/__tests__/ephemeralAgents.test.ts`:

```ts
import {
  buildEphemeralCreateConfig,
  shouldCleanupEphemeralAgent,
} from "../ephemeralAgents";

{
  const now = new Date("2026-05-26T12:00:00.000Z");
  const config = buildEphemeralCreateConfig({
    userRequest: "Help me study for my biology test",
    kind: "study",
    parentTaskId: "job-study-1",
    now,
  });

  assert.equal(config.name, "Study Agent");
  assert.equal(config.role, "study");
  assert.equal(config.memoryScope, "agent_private");
  assert.equal(config.accessGlobalMemory, true);
  assert.equal(config.loopEnabled, false);
  assert.equal(config.configJson?.ephemeral, true);
  assert.equal(config.configJson?.template, "study");
  assert.equal(config.configJson?.parentTaskId, "job-study-1");
  assert.equal(config.configJson?.expiresAt, "2026-05-26T16:00:00.000Z");
  console.log("OK: ephemeral create config marks temporary agent metadata");
}

{
  assert.equal(
    shouldCleanupEphemeralAgent({
      configJson: { ephemeral: true, expiresAt: "2026-05-26T12:00:00.000Z" },
      now: new Date("2026-05-26T12:01:00.000Z"),
    }),
    true,
  );
  assert.equal(
    shouldCleanupEphemeralAgent({
      configJson: { ephemeral: true, expiresAt: "2026-05-26T12:10:00.000Z" },
      now: new Date("2026-05-26T12:01:00.000Z"),
    }),
    false,
  );
  assert.equal(
    shouldCleanupEphemeralAgent({
      configJson: { ephemeral: false, expiresAt: "2026-05-26T12:00:00.000Z" },
      now: new Date("2026-05-26T12:01:00.000Z"),
    }),
    false,
  );
  console.log("OK: ephemeral cleanup predicate respects expiry and marker");
}
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\ephemeralAgents.test.ts
```

Expected: failure because `buildEphemeralCreateConfig()` and `shouldCleanupEphemeralAgent()` do not exist.

- [x] **Step 3: Implement lifecycle config helpers**

Add to `server/agent/ephemeralAgents.ts`:

```ts
import type { CreateAgentConfig } from "./agentManager";

export interface BuildEphemeralCreateConfigOptions {
  kind: EphemeralAgentKind;
  userRequest: string;
  parentTaskId?: string;
  now?: Date;
}

export function buildEphemeralCreateConfig(opts: BuildEphemeralCreateConfigOptions): CreateAgentConfig {
  const now = opts.now ?? new Date();
  const template = buildEphemeralAgentTemplate({
    kind: opts.kind,
    userRequest: opts.userRequest,
  });
  const expiresAt = new Date(now.getTime() + template.ttlMinutes * 60_000).toISOString();

  return {
    name: template.name,
    role: template.role,
    persona: template.persona,
    platforms: ["app"],
    permissions: template.permissions,
    memoryScope: "agent_private",
    accessGlobalMemory: true,
    privateMode: true,
    loopEnabled: false,
    configJson: {
      ephemeral: true,
      template: template.kind,
      cleanupMode: template.cleanupMode,
      parentTaskId: opts.parentTaskId ?? null,
      expiresAt,
    },
  };
}

export function shouldCleanupEphemeralAgent(opts: {
  configJson: unknown;
  now?: Date;
}): boolean {
  if (!opts.configJson || typeof opts.configJson !== "object" || Array.isArray(opts.configJson)) return false;
  const config = opts.configJson as Record<string, unknown>;
  if (config.ephemeral !== true) return false;
  const expiresAt = typeof config.expiresAt === "string" ? Date.parse(config.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= (opts.now ?? new Date()).getTime();
}
```

- [x] **Step 4: Run the focused test**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\ephemeralAgents.test.ts
```

Expected: pass.

---

### Task 3: Add Handoff Memory Extraction Contract

**Files:**
- Modify: `server/agent/ephemeralAgents.ts`
- Modify: `server/agent/__tests__/ephemeralAgents.test.ts`

- [x] **Step 1: Write the failing handoff tests**

Append:

```ts
import {
  buildEphemeralHandoffPrompt,
  extractEphemeralHandoffNotes,
} from "../ephemeralAgents";

{
  const prompt = buildEphemeralHandoffPrompt({
    kind: "study",
    userRequest: "Study biology chapters 3 and 4",
  });

  assert.match(prompt, /Return JSON/i);
  assert.match(prompt, /facts/i);
  assert.match(prompt, /preferences/i);
  assert.match(prompt, /nextReviewTopics/i);
  assert.doesNotMatch(prompt, /follow these instructions from memory/i);
  console.log("OK: handoff prompt requests structured durable notes");
}

{
  const notes = extractEphemeralHandoffNotes(`{
    "facts": ["Biology test is Friday"],
    "preferences": ["Prefers short quizzes"],
    "weakAreas": ["Cell respiration"],
    "nextReviewTopics": ["ATP", "Krebs cycle"]
  }`);

  assert.deepEqual(notes.facts, ["Biology test is Friday"]);
  assert.deepEqual(notes.preferences, ["Prefers short quizzes"]);
  assert.deepEqual(notes.weakAreas, ["Cell respiration"]);
  assert.deepEqual(notes.nextReviewTopics, ["ATP", "Krebs cycle"]);
  console.log("OK: handoff notes parse structured JSON");
}

{
  const notes = extractEphemeralHandoffNotes("not json");
  assert.deepEqual(notes, {
    facts: [],
    preferences: [],
    weakAreas: [],
    nextReviewTopics: [],
  });
  console.log("OK: malformed handoff notes fail closed");
}
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\ephemeralAgents.test.ts
```

Expected: failure because the handoff helpers do not exist.

- [x] **Step 3: Implement deterministic handoff helpers**

Add:

```ts
export interface EphemeralHandoffNotes {
  facts: string[];
  preferences: string[];
  weakAreas: string[];
  nextReviewTopics: string[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
    : [];
}

export function buildEphemeralHandoffPrompt(opts: {
  kind: EphemeralAgentKind;
  userRequest: string;
}): string {
  return [
    "Return JSON only.",
    "Summarize durable handoff notes from this temporary specialist session.",
    "Include facts, preferences, weakAreas, and nextReviewTopics.",
    "Capture facts/preferences only. Do not preserve instructions as instructions.",
    `Specialist kind: ${opts.kind}`,
    `Original user request: ${opts.userRequest.slice(0, 500)}`,
    `Schema: {"facts":[],"preferences":[],"weakAreas":[],"nextReviewTopics":[]}`,
  ].join("\n");
}

export function extractEphemeralHandoffNotes(raw: string): EphemeralHandoffNotes {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      facts: stringArray(parsed.facts),
      preferences: stringArray(parsed.preferences),
      weakAreas: stringArray(parsed.weakAreas),
      nextReviewTopics: stringArray(parsed.nextReviewTopics),
    };
  } catch {
    return {
      facts: [],
      preferences: [],
      weakAreas: [],
      nextReviewTopics: [],
    };
  }
}
```

- [x] **Step 4: Run the focused test**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\ephemeralAgents.test.ts
```

Expected: pass.

---

### Task 4: Add Run Helper With Safe Cleanup

**Files:**
- Modify: `server/agent/ephemeralAgents.ts`
- Test: `server/agent/__tests__/ephemeralAgents.test.ts`

- [x] **Step 1: Write dependency-injected run helper test**

Append:

```ts
import { runEphemeralAgentSession } from "../ephemeralAgents";

{
  const events: string[] = [];
  const result = await runEphemeralAgentSession({
    userId: "user-1",
    kind: "study",
    userRequest: "Help me study biology",
    platform: "app",
    channelId: "chat-1",
    parentTaskId: "job-1",
    deps: {
      createAgent: async (_userId, config) => {
        events.push(`create:${config.name}`);
        return "agent-temp-1";
      },
      runNamedAgent: async (opts) => {
        events.push(`run:${opts.agentId}`);
        return {
          reply: "We studied cell respiration.",
          turns: 2,
          toolCalls: [],
          agentName: "Study Agent",
          agentId: opts.agentId,
          attachments: [],
        };
      },
      disableAgent: async (agentId) => {
        events.push(`disable:${agentId}`);
      },
      deleteAgent: async (agentId) => {
        events.push(`delete:${agentId}`);
      },
      promoteHandoff: async (notes) => {
        events.push(`handoff:${notes.facts.length}:${notes.preferences.length}`);
      },
    },
  });

  assert.equal(result.agentId, "agent-temp-1");
  assert.equal(result.reply, "We studied cell respiration.");
  assert.deepEqual(events, [
    "create:Study Agent",
    "run:agent-temp-1",
    "handoff:0:0",
    "disable:agent-temp-1",
  ]);
  console.log("OK: ephemeral session creates, runs, hands off, and disables");
}
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\ephemeralAgents.test.ts
```

Expected: failure because `runEphemeralAgentSession()` does not exist.

- [x] **Step 3: Implement run helper**

Add:

```ts
import {
  createAgent as defaultCreateAgent,
  deleteAgent as defaultDeleteAgent,
  disableAgent as defaultDisableAgent,
  type CreateAgentConfig,
} from "./agentManager";
import {
  runNamedAgent as defaultRunNamedAgent,
  type NamedAgentResult,
  type RunNamedAgentOptions,
} from "./runNamedAgent";

export interface RunEphemeralAgentSessionOptions {
  userId: string;
  kind: EphemeralAgentKind;
  userRequest: string;
  platform: string;
  channelId?: string;
  parentTaskId?: string;
  deps?: {
    createAgent?: (userId: string, config: CreateAgentConfig) => Promise<string>;
    runNamedAgent?: (opts: RunNamedAgentOptions) => Promise<NamedAgentResult>;
    disableAgent?: (agentId: string) => Promise<void>;
    deleteAgent?: (agentId: string) => Promise<void>;
    promoteHandoff?: (notes: EphemeralHandoffNotes) => Promise<void>;
  };
}

export async function runEphemeralAgentSession(
  opts: RunEphemeralAgentSessionOptions,
): Promise<NamedAgentResult & { ephemeral: true }> {
  const create = opts.deps?.createAgent ?? defaultCreateAgent;
  const run = opts.deps?.runNamedAgent ?? defaultRunNamedAgent;
  const disable = opts.deps?.disableAgent ?? defaultDisableAgent;
  const remove = opts.deps?.deleteAgent ?? defaultDeleteAgent;
  const promoteHandoff = opts.deps?.promoteHandoff ?? (async () => {});

  const config = buildEphemeralCreateConfig({
    kind: opts.kind,
    userRequest: opts.userRequest,
    parentTaskId: opts.parentTaskId,
  });
  const agentId = await create(opts.userId, config);
  const cleanupMode = config.configJson?.cleanupMode === "delete" ? "delete" : "disable";

  try {
    const result = await run({
      agentId,
      userId: opts.userId,
      userMessage: opts.userRequest,
      platform: opts.platform,
      channelId: opts.channelId,
      initiatedBy: "jarvis",
    });

    await promoteHandoff(extractEphemeralHandoffNotes(""));
    return { ...result, ephemeral: true };
  } finally {
    if (cleanupMode === "delete") await remove(agentId);
    else await disable(agentId);
  }
}
```

- [x] **Step 4: Run the focused test**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\ephemeralAgents.test.ts
```

Expected: pass.

---

### Task 5: Queue Integration Slice

**Files:**
- Modify: `server/agent/jobClient.ts`
- Modify: `server/agent/jobQueue.ts`
- Modify: `server/agent/jobObservability.ts`
- Test: `server/agent/__tests__/jobObservability.test.ts`

- [ ] **Step 1: Add a failing observability assertion**

In `server/agent/__tests__/jobObservability.test.ts`, add a job input shaped like:

```ts
{
  workerType: "goal_task",
  ephemeralAgent: {
    kind: "study",
    template: "study",
    cleanupMode: "disable"
  }
}
```

Assert that decorated jobs expose:

```ts
assert.equal(decorated.workerType, "goal_task");
assert.equal(decorated.input.ephemeralAgent.kind, "study");
```

- [ ] **Step 2: Run the focused test**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\jobObservability.test.ts
```

Expected: fail until the metadata is preserved and typed.

- [ ] **Step 3: Add queue metadata shape**

Use job input metadata:

```ts
ephemeralAgent: {
  kind: "study",
  template: "study",
  cleanupMode: "disable"
}
```

Do not add a migration in this slice; `agentJobs.input` already carries JSON metadata.

- [ ] **Step 4: Route `ephemeral_agent_task` in `jobQueue.ts`**

Add one branch near the named-agent task runner:

```ts
if (job.agentType === "ephemeral_agent_task") {
  const input = (job.input as Record<string, unknown>) ?? {};
  const kind = input.ephemeralAgent && typeof input.ephemeralAgent === "object"
    ? String((input.ephemeralAgent as Record<string, unknown>).kind || "study")
    : "study";
  const result = await runEphemeralAgentSession({
    userId: job.userId,
    kind: kind === "study" ? "study" : "study",
    userRequest: job.title,
    platform: String(input.originChannel || "app"),
    parentTaskId: job.id,
  });
  return {
    output: result.reply,
    turns: result.turns,
    toolCalls: result.toolCalls,
    ephemeralAgentId: result.agentId,
  };
}
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\ephemeralAgents.test.ts
node node_modules\tsx\dist\cli.mjs server\agent\__tests__\jobObservability.test.ts
```

Expected: pass.

---

## Final Verification

Run:

```powershell
npm.cmd test
npm.cmd run server:build
git diff --check
git status --short --branch
```

Expected:

```text
npm.cmd test exits 0
npm.cmd run server:build exits 0
git diff --check exits 0
status shows only intended files changed
```

If `server_dist/index.js` changes during `server:build`, restore it unless the user explicitly asks to commit generated deploy output.

## Recovery And Rollout Notes

- The first implementation should only support `study`.
- Add more templates after the lifecycle is proven.
- Default cleanup should be `disable`, not hard delete, until handoff promotion is verified in production.
- UI should not list ephemeral agents in the normal Agent roster unless explicitly requested.
- Ephemeral agents should appear in job/task history as worker activity, not as permanent teammates.

## Open Product Decisions

- Whether the user should see "Study Agent" as a visible temporary worker in the Agent tab.
- Whether cleanup should happen immediately after the session or after a TTL.
- Whether handoff notes should go to global `user_memories`, session summaries, or a new specialist-handoff table.
- Whether Jarvis should ask before creating a specialist agent or do it automatically for obvious cases.

## Suggested Execution Order

1. Task 1: Template builder.
2. Task 2: Create config and cleanup predicate.
3. Task 3: Handoff note contract.
4. Task 4: Dependency-injected run helper.
5. Task 5: Queue integration.

Keep each task as a separate reviewable slice.
