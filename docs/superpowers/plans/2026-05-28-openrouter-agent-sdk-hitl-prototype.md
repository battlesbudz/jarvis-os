# OpenRouter Agent SDK HITL Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small feature-flagged OpenRouter Agent SDK proof of concept where Jarvis drafts an email, pauses before sending, requests Telegram approval, resumes if approved, and refuses to send if rejected.

**Architecture:** Add an isolated experimental runner under `src/agent/` and route only explicit "draft/send an email" test requests through it when `ENABLE_AGENT_SDK_RUNNER=true`. Keep the existing Jarvis model router, harness, Gmail/Calendar behavior, and approval architecture intact; the prototype wraps existing utilities and uses OpenRouter Agent SDK state persistence only for this one workflow.

**Tech Stack:** TypeScript, `@openrouter/agent`, `zod`, existing Jarvis Express routes, existing Telegram approval cards, existing Gmail send adapter, existing memory retrieval, file-backed prototype run store.

---

## Current Architecture Inspection

These are the existing files to read before coding and the integration points this plan uses.

### Current Model Call Location

- `server/agent/modelRouter.ts`
  - Main routed model entrypoint: `routeModelTurn`.
  - Already supports OpenRouter as an OpenAI-compatible provider when OpenRouter env is available.
- `server/agent/routedChatCompletion.ts`
  - Shim used by many legacy `openai.chat.completions.create(...)` paths.
- `server/agent/harness.ts`
  - Current Jarvis tool loop / agent runner.
- `server/routes.ts`
  - App chat endpoint at `POST /api/coach/chat`.
  - Builds the large coach prompt, tool list, approval handling, streaming response, and current app chat flow.
- `server/channels/coachAgent.ts`
  - Shared channel coach flow used by Telegram and other channel surfaces.

Prototype rule: do not replace any of these. Add a narrow branch before the current path only when the feature flag and explicit workflow match.

### Telegram Handler Location

- `server/telegramRoutes.ts`
  - Telegram webhook/update handling.
  - `handleCoachReply(userId, chatId, userText, imageUrl?)` routes normal Telegram text to `runCoachAgent`.
  - `handleCallbackQuery(callbackQuery)` already handles approval callback data through `parseTelegramApprovalCallback`.
- `server/integrations/telegram.ts`
  - Telegram API helpers:
    - `sendMessage`
    - `sendLongMessage`
    - `sendMessageWithButtons`
    - `answerCallbackQuery`
- `server/agent/approvalNotifications.ts`
  - Existing Telegram approval keyboard:
    - `buildTelegramApprovalKeyboard(gateId)`
    - `parseTelegramApprovalCallback(data)`
    - `notifyApprovalRequest(...)`

Prototype rule: reuse existing approval card mechanics instead of inventing a second Telegram approval UX.

### Gmail / Email Tool Location

- `server/agent/tools/sendEmail.ts`
  - Existing `sendEmailTool`.
  - Sends via Gmail or Outlook.
  - Must only be called by the prototype after OpenRouter approval resumes and the existing Jarvis approval gate has resolved approved.
- `server/agent/tools/gmailActions.ts`
  - Existing `create_gmail_draft`.
  - Creates an actual Gmail draft.
  - Do not use this for the prototype's internal draft step unless explicitly expanded later, because the POC only needs a reviewable draft preview before send.
- `server/integrations/gmail.ts`
  - Lower-level Gmail integration:
    - `createGmailDraft`
    - `sendGmailEmail`
    - `getRecentEmailCommitments`
- `server/capabilities/emailCapability.ts`
  - Registers current email tools in the existing Jarvis capability system.

Prototype rule: the new draft tool should be internal and non-side-effecting. The send tool should be an isolated wrapper around `sendEmailTool.execute`.

### Memory / Context Loading Location

- `server/memory/retrieve.ts`
  - Existing semantic memory retrieval.
- `server/memory/promptContext.ts`
  - Existing helper for AI context sections.
- `server/memory/contextBuilder.ts`
  - Budgeted untrusted context blocks and prompt context helpers.
- `server/routes.ts`
  - Current app chat cold-start prompt loading retrieves memories, commitments, Gmail context, documents, SOUL, and cross-channel context.
- `server/channels/coachAgent.ts`
  - Channel-specific context collection for Telegram / WhatsApp / Slack / daemon / Discord.

Prototype rule: use only a tiny context read adapter. Do not inject the full coach prompt stack.

### Persistence / Database Layer

- `shared/schema.ts`
  - Drizzle schema definitions.
  - Existing useful tables:
    - `agentApprovalGates`
    - `agentJobs`
    - `deliverables`
    - `emailDrafts`
    - `userMemories`
    - `telegramLinks`
- `server/db.ts`
  - Drizzle database instance and `ensureTablesExist()`.
- `server/agent/agentApproval.ts`
  - Existing persistent approval gate system:
    - `requestApproval`
    - `approveGate`
    - `rejectGate`
    - `getGate`

Prototype persistence decision: use a file-backed run store first to avoid schema churn. The file store should live outside tracked source by default, e.g. `.jarvis/runtime/agent-sdk-runs/`, and be replaceable through a `RunStore` interface.

## OpenRouter SDK Notes

Use `@openrouter/agent` because OpenRouter documents it as the Agent SDK for multi-turn loops, tools, stop conditions, and conversation state.

For this email-send POC, use `requireApproval`, not `onToolCalled`, for the send step:

- `requireApproval` pauses before sensitive tool execution and resumes with approval/rejection decisions.
- HITL `onToolCalled` is better when the human supplies or transforms the tool result.
- Sending email is a consent gate, so `requireApproval: true` is the safer fit.

Relevant OpenRouter docs:

- `@openrouter/agent` overview: https://openrouter.ai/docs/agent-sdk/overview
- Tool approval and state persistence: https://openrouter.ai/docs/agent-sdk/call-model/tool-approval-state
- HITL cookbook: https://openrouter.ai/docs/cookbook/building-agents/hitl-tools/

## Non-Goals

- Do not refactor existing Jarvis flows.
- Do not replace `server/agent/modelRouter.ts`.
- Do not convert current tools to OpenRouter Agent SDK tools.
- Do not change normal Gmail, Calendar, or Composio behavior.
- Do not add a general subagent platform.
- Do not add a new production approval UX.
- Do not route broad email requests through this runner.
- Do not silently send email without Telegram approval.

## File Structure

### Create

- `src/agent/agentRunner.ts`
  - Feature flag gate, explicit workflow matcher, OpenRouter `callModel` orchestration, state persistence, pause/resume handling, and integration-facing result shape.

- `src/agent/hitlApproval.ts`
  - Bridge between OpenRouter pending tool calls and Jarvis approval/Telegram callbacks.
  - Creates existing Jarvis approval gates for pending OpenRouter send calls.
  - Sends Telegram approval cards.
  - Resumes the paused OpenRouter state after approve/reject.

- `src/agent/toolRegistry.ts`
  - Defines the tiny OpenRouter tool set:
    - `read_context`
    - `draft_email`
    - `send_email` with `requireApproval: true`
  - Wraps existing Jarvis utilities.

- `src/agent/runStore.ts`
  - File-backed `StateAccessor` and prototype metadata store.
  - Keeps OpenRouter conversation state and local metadata together.

- `src/agent/__tests__/agentSdkHitl.assert.ts`
  - Unit/integration-style assertion test using mocked OpenRouter calls and mocked send adapter.

- `scripts/agent-sdk-hitl-smoke.mjs`
  - Manual/dev smoke script that demonstrates draft, pause, persisted run, approval resume, and rejection path without sending a real email.

- `docs/agent-sdk-hitl-prototype.md`
  - Operator docs for enabling, testing, and disabling the prototype.

### Modify

- `package.json`
  - Add `@openrouter/agent`.
  - Add script: `jarvis:qa:agent-sdk-hitl`.

- `server/routes.ts`
  - In `POST /api/coach/chat`, add an early feature-flag branch after validating `messages` and `userId`, before the normal autonomy/model path.

- `server/telegramRoutes.ts`
  - In `handleCoachReply`, add the same feature-flag branch before the current `runCoachAgent` path.
  - In `handleCallbackQuery`, after existing approval gate approval/rejection resolves, call the prototype resume bridge only when the gate belongs to the prototype.

- `scripts/run-agent-tests.mjs`
  - Include `src/agent/__tests__/agentSdkHitl.assert.ts`.

## Task 1: Add Dependency And Feature Flag Guard

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/agent/agentRunner.ts`
- Test: `src/agent/__tests__/agentSdkHitl.assert.ts`

- [ ] **Step 1: Install dependency**

Run:

```powershell
npm.cmd install @openrouter/agent
```

Expected:

- `package.json` includes `@openrouter/agent`.
- `package-lock.json` updates.
- No existing dependencies are removed.

- [ ] **Step 2: Create the explicit workflow matcher test**

Create `src/agent/__tests__/agentSdkHitl.assert.ts` with initial assertions:

```ts
import assert from "node:assert/strict";
import {
  isAgentSdkRunnerEnabled,
  matchesAgentSdkEmailWorkflow,
} from "../agentRunner";

process.env.ENABLE_AGENT_SDK_RUNNER = "true";

assert.equal(isAgentSdkRunnerEnabled(), true);
assert.equal(matchesAgentSdkEmailWorkflow("draft and send an email to sam@example.com"), true);
assert.equal(matchesAgentSdkEmailWorkflow("can you draft/send an email to Sam?"), true);
assert.equal(matchesAgentSdkEmailWorkflow("write an email draft but do not send it"), false);
assert.equal(matchesAgentSdkEmailWorkflow("check my inbox"), false);
assert.equal(matchesAgentSdkEmailWorkflow("send a calendar invite"), false);

process.env.ENABLE_AGENT_SDK_RUNNER = "false";
assert.equal(isAgentSdkRunnerEnabled(), false);

console.log("agentSdkHitl matcher assertions passed");
```

- [ ] **Step 3: Implement minimal matcher**

In `src/agent/agentRunner.ts`, start with:

```ts
export function isAgentSdkRunnerEnabled(env = process.env): boolean {
  return String(env.ENABLE_AGENT_SDK_RUNNER || "").toLowerCase() === "true";
}

export function matchesAgentSdkEmailWorkflow(message: string): boolean {
  const text = String(message || "").toLowerCase();
  if (!/\bemail\b/.test(text)) return false;
  if (!/\b(send|sent)\b/.test(text)) return false;
  if (!/\b(draft|write|compose)\b/.test(text)) return false;
  if (/\b(do not send|don't send|dont send|draft only|just draft)\b/.test(text)) return false;
  return true;
}
```

- [ ] **Step 4: Run matcher test**

Run:

```powershell
npx.cmd tsx src/agent/__tests__/agentSdkHitl.assert.ts
```

Expected:

```txt
agentSdkHitl matcher assertions passed
```

## Task 2: File-Backed Run Store

**Files:**

- Create: `src/agent/runStore.ts`
- Modify: `src/agent/__tests__/agentSdkHitl.assert.ts`

- [ ] **Step 1: Add run store interface and file implementation**

Create `src/agent/runStore.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConversationState, StateAccessor } from "@openrouter/agent";

export interface AgentSdkRunMeta {
  runId: string;
  userId: string;
  originChannel: "app" | "telegram" | string;
  originChannelId?: string;
  status: "running" | "awaiting_approval" | "approved" | "rejected" | "complete" | "failed";
  draft?: { to: string; subject: string; body: string };
  pendingToolCallId?: string;
  gateId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSdkRunRecord {
  meta: AgentSdkRunMeta;
  state: ConversationState<any> | null;
}

export interface AgentSdkRunStore {
  load(runId: string): Promise<AgentSdkRunRecord | null>;
  save(record: AgentSdkRunRecord): Promise<void>;
  createStateAccessor(runId: string): StateAccessor<any>;
}

export function createFileAgentSdkRunStore(rootDir = path.join(process.cwd(), ".jarvis", "runtime", "agent-sdk-runs")): AgentSdkRunStore {
  const fileFor = (runId: string) => path.join(rootDir, `${runId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);

  async function load(runId: string): Promise<AgentSdkRunRecord | null> {
    try {
      return JSON.parse(await readFile(fileFor(runId), "utf8")) as AgentSdkRunRecord;
    } catch {
      return null;
    }
  }

  async function save(record: AgentSdkRunRecord): Promise<void> {
    await mkdir(rootDir, { recursive: true });
    await writeFile(fileFor(record.meta.runId), JSON.stringify(record, null, 2), "utf8");
  }

  return {
    load,
    save,
    createStateAccessor(runId: string) {
      return {
        load: async () => (await load(runId))?.state ?? null,
        save: async (state) => {
          const existing = await load(runId);
          const now = new Date().toISOString();
          await save({
            meta: existing?.meta ?? {
              runId,
              userId: "unknown",
              originChannel: "unknown",
              status: "running",
              createdAt: now,
              updatedAt: now,
            },
            state,
          });
        },
      };
    },
  };
}
```

- [ ] **Step 2: Add persistence assertions**

Extend `agentSdkHitl.assert.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileAgentSdkRunStore } from "../runStore";

const tmp = await mkdtemp(path.join(tmpdir(), "agent-sdk-hitl-"));
const store = createFileAgentSdkRunStore(tmp);
await store.save({
  meta: {
    runId: "run_test",
    userId: "user_1",
    originChannel: "telegram",
    originChannelId: "123",
    status: "awaiting_approval",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
  },
  state: { id: "state_test", status: "awaiting_approval", createdAt: Date.now(), updatedAt: Date.now(), messages: [] } as any,
});
const loaded = await store.load("run_test");
assert.equal(loaded?.meta.status, "awaiting_approval");
assert.equal(loaded?.state?.status, "awaiting_approval");
await rm(tmp, { recursive: true, force: true });
```

- [ ] **Step 3: Run test**

Run:

```powershell
npx.cmd tsx src/agent/__tests__/agentSdkHitl.assert.ts
```

Expected:

```txt
agentSdkHitl matcher assertions passed
```

## Task 3: Tool Registry

**Files:**

- Create: `src/agent/toolRegistry.ts`
- Modify: `src/agent/__tests__/agentSdkHitl.assert.ts`

- [ ] **Step 1: Define adapter dependencies**

In `src/agent/toolRegistry.ts`, define wrappers rather than importing production behavior directly into tests:

```ts
import { tool } from "@openrouter/agent";
import { z } from "zod";
import type { AgentSdkRunStore } from "./runStore";

export interface AgentSdkToolDeps {
  userId: string;
  runId: string;
  store: AgentSdkRunStore;
  readContext?: (query: string) => Promise<string>;
  sendEmail?: (args: { to: string; subject: string; body: string; provider?: string }) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
}
```

- [ ] **Step 2: Implement `read_context`, `draft_email`, and approval-gated `send_email`**

Still in `toolRegistry.ts`:

```ts
export function createAgentSdkTools(deps: AgentSdkToolDeps) {
  const readContext = tool({
    name: "read_context",
    description: "Read a small amount of Jarvis memory/context relevant to drafting the email.",
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.object({ context: z.string() }),
    execute: async ({ query }) => ({
      context: deps.readContext ? await deps.readContext(query) : "",
    }),
  });

  const draftEmail = tool({
    name: "draft_email",
    description: "Create an internal email draft preview. This does not create a Gmail draft and does not send.",
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string().min(1),
      body: z.string().min(1),
    }),
    outputSchema: z.object({
      drafted: z.boolean(),
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
    execute: async ({ to, subject, body }) => {
      const record = await deps.store.load(deps.runId);
      if (record) {
        record.meta.draft = { to, subject, body };
        record.meta.updatedAt = new Date().toISOString();
        await deps.store.save(record);
      }
      return { drafted: true, to, subject, body };
    },
  });

  const sendEmail = tool({
    name: "send_email",
    description: "Send the reviewed email. This requires human approval before execution.",
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string().min(1),
      body: z.string().min(1),
      provider: z.enum(["google", "microsoft"]).optional(),
    }),
    outputSchema: z.object({
      sent: z.boolean(),
      messageId: z.string().optional(),
      error: z.string().optional(),
    }),
    requireApproval: true,
    execute: async ({ to, subject, body, provider }) => {
      if (!deps.sendEmail) return { sent: false, error: "sendEmail adapter missing" };
      const result = await deps.sendEmail({ to, subject, body, provider });
      return result.ok
        ? { sent: true, messageId: result.messageId }
        : { sent: false, error: result.error || "Email send failed" };
    },
  });

  return [readContext, draftEmail, sendEmail] as const;
}
```

- [ ] **Step 3: Add tool registry assertions**

In `agentSdkHitl.assert.ts`, assert:

```ts
import { createAgentSdkTools } from "../toolRegistry";

const tools = createAgentSdkTools({
  userId: "user_1",
  runId: "run_tools",
  store,
  readContext: async () => "Remember to be concise.",
  sendEmail: async () => ({ ok: true, messageId: "msg_123" }),
});
assert.equal(tools.length, 3);
assert.ok(tools.some((t: any) => t.name === "send_email"));
```

- [ ] **Step 4: Run test**

Run:

```powershell
npx.cmd tsx src/agent/__tests__/agentSdkHitl.assert.ts
```

Expected: assertions pass.

## Task 4: HITL Approval Bridge

**Files:**

- Create: `src/agent/hitlApproval.ts`
- Modify: `server/telegramRoutes.ts`
- Modify: `src/agent/__tests__/agentSdkHitl.assert.ts`

- [ ] **Step 1: Create approval bridge types**

Create `src/agent/hitlApproval.ts`:

```ts
import type { AgentSdkRunStore } from "./runStore";

export interface AgentSdkPendingApproval {
  runId: string;
  userId: string;
  originChannel: string;
  originChannelId?: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface HitlApprovalDeps {
  store: AgentSdkRunStore;
  requestApproval: (input: {
    agentId: string;
    userId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    description: string;
    initiatedBy: "user" | "jarvis";
  }) => Promise<{ id: string }>;
  notifyApprovalRequest: (payload: {
    gateId: string;
    agentId: string;
    agentName: string;
    userId: string;
    toolName: string;
    description: string;
    originChannel?: string;
    originChannelId?: string;
  }) => Promise<unknown>;
}

export const AGENT_SDK_HITL_AGENT_ID = "openrouter-agent-sdk-hitl-prototype";
```

- [ ] **Step 2: Implement `requestTelegramApprovalForPendingCall`**

```ts
export async function requestTelegramApprovalForPendingCall(
  pending: AgentSdkPendingApproval,
  deps: HitlApprovalDeps,
): Promise<string> {
  const args = pending.arguments;
  const to = String(args.to || "");
  const subject = String(args.subject || "");
  const body = String(args.body || "");
  const description = [
    "Jarvis drafted an email and wants approval before sending.",
    "",
    `To: ${to}`,
    `Subject: ${subject}`,
    "",
    body.slice(0, 1200),
  ].join("\n");

  const gate = await deps.requestApproval({
    agentId: AGENT_SDK_HITL_AGENT_ID,
    userId: pending.userId,
    toolName: pending.toolName,
    toolArgs: {
      ...args,
      __agentSdkRunId: pending.runId,
      __agentSdkToolCallId: pending.toolCallId,
      __agentSdkPrototype: true,
    },
    description,
    initiatedBy: "user",
  });

  const record = await deps.store.load(pending.runId);
  if (record) {
    record.meta.status = "awaiting_approval";
    record.meta.pendingToolCallId = pending.toolCallId;
    record.meta.gateId = gate.id;
    record.meta.updatedAt = new Date().toISOString();
    await deps.store.save(record);
  }

  await deps.notifyApprovalRequest({
    gateId: gate.id,
    agentId: AGENT_SDK_HITL_AGENT_ID,
    agentName: "OpenRouter Agent SDK Prototype",
    userId: pending.userId,
    toolName: pending.toolName,
    description,
    originChannel: pending.originChannel || "telegram",
    originChannelId: pending.originChannelId,
  });

  return gate.id;
}
```

- [ ] **Step 3: Plan Telegram callback integration**

In `server/telegramRoutes.ts`, after existing `approveGate` / `rejectGate` succeeds, add a narrow bridge:

```ts
if (gate.agentId === "openrouter-agent-sdk-hitl-prototype") {
  const { resumeAgentSdkRunFromApprovalGate } = await import("../src/agent/agentRunner");
  await resumeAgentSdkRunFromApprovalGate({
    gate,
    approved: approvalCallback.decision === "approve",
    originChannelId: chatId,
  }).catch((err) => console.error("[AgentSDK/HITL] resume failed:", err));
}
```

Use the actual relative path that TypeScript accepts from `server/telegramRoutes.ts` to `src/agent/agentRunner.ts`.

- [ ] **Step 4: Add approval bridge assertions**

Mock `requestApproval` and `notifyApprovalRequest` in `agentSdkHitl.assert.ts` and assert:

- approval description contains `To`, `Subject`, and body preview
- gate id is stored in the run record
- `__agentSdkRunId` and `__agentSdkToolCallId` are present in `toolArgs`

## Task 5: Agent Runner

**Files:**

- Modify: `src/agent/agentRunner.ts`
- Modify: `src/agent/__tests__/agentSdkHitl.assert.ts`

- [ ] **Step 1: Define runner result shape**

Add to `agentRunner.ts`:

```ts
export type AgentSdkRunnerResult =
  | { handled: false }
  | { handled: true; status: "complete"; runId: string; reply: string }
  | { handled: true; status: "awaiting_approval"; runId: string; gateId: string; reply: string }
  | { handled: true; status: "rejected"; runId: string; reply: string }
  | { handled: true; status: "failed"; runId: string; reply: string; error: string };
```

- [ ] **Step 2: Implement dependency-injected runner**

Use dependency injection so tests do not hit OpenRouter or Gmail:

```ts
export interface RunAgentSdkEmailWorkflowInput {
  userId: string;
  userText: string;
  originChannel: "app" | "telegram" | string;
  originChannelId?: string;
}

export interface AgentSdkRunnerDeps {
  store?: import("./runStore").AgentSdkRunStore;
  callModel?: (params: Record<string, unknown>) => Promise<any>;
  readContext?: (userId: string, query: string) => Promise<string>;
  sendEmail?: (userId: string, args: { to: string; subject: string; body: string; provider?: string }) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
  requestApprovalForPendingCall?: typeof import("./hitlApproval").requestTelegramApprovalForPendingCall;
}
```

Implementation rules:

- If feature flag is off, return `{ handled: false }`.
- If the text does not match the explicit workflow, return `{ handled: false }`.
- Create a `runId` like `asdk_${Date.now()}_${random}`.
- Save initial run meta before `callModel`.
- Use `createAgentSdkTools`.
- Use `state = store.createStateAccessor(runId)`.
- Call OpenRouter `callModel` with a short system/user input that forces:
  1. draft internally with `draft_email`
  2. call `send_email` only after draft exists
  3. rely on approval pause before execution
- If `result.requiresApproval()` is true:
  - read `result.getPendingToolCalls()`
  - create Jarvis approval gate and Telegram approval card
  - return `awaiting_approval`
- Otherwise return final text.

- [ ] **Step 3: Implement real adapters**

Real adapters should be thin:

```ts
async function defaultReadContext(userId: string, query: string): Promise<string> {
  const { retrieveRelevantMemories } = await import("../../server/memory/retrieve");
  const memories = await retrieveRelevantMemories(userId, query, 5).catch(() => []);
  return memories.map((m: any) => `- ${m.content}`).join("\n");
}

async function defaultSendEmail(userId: string, args: { to: string; subject: string; body: string; provider?: string }) {
  const { sendEmailTool } = await import("../../server/agent/tools/sendEmail");
  const result = await sendEmailTool.execute(args, { userId, channel: "agent-sdk-hitl", state: {} } as any);
  return result.ok
    ? { ok: true, messageId: typeof result.detail === "string" ? result.detail : undefined }
    : { ok: false, error: result.content };
}
```

Do not import lower-level Gmail send APIs directly.

- [ ] **Step 4: Implement `resumeAgentSdkRunFromApprovalGate`**

Inputs:

```ts
{
  gate: { id: string; userId: string; toolName: string; toolArgs: Record<string, unknown> };
  approved: boolean;
  originChannelId?: string;
}
```

Behavior:

- Load run by `gate.toolArgs.__agentSdkRunId`.
- Load `toolCallId` from `gate.toolArgs.__agentSdkToolCallId` or stored meta.
- If approved:
  - call OpenRouter `callModel` with same `state`, same tools, `input: []`, `approveToolCalls: [toolCallId]`.
  - send final text to Telegram using `originChannelId` when available.
  - mark run `complete` or `failed`.
- If rejected:
  - call OpenRouter `callModel` with same `state`, `rejectToolCalls: [toolCallId]`.
  - do not call send adapter.
  - send rejection summary to Telegram.
  - mark run `rejected`.

- [ ] **Step 5: Add runner tests**

In `agentSdkHitl.assert.ts`, mock `callModel` with a fake object:

```ts
const fakePendingCall = {
  id: "call_send_1",
  name: "send_email",
  arguments: { to: "sam@example.com", subject: "Hello", body: "Draft body" },
};

const fakePausedResult = {
  requiresApproval: async () => true,
  getPendingToolCalls: async () => [fakePendingCall],
  getState: async () => ({ id: "state_1", status: "awaiting_approval", pendingToolCalls: [fakePendingCall], createdAt: Date.now(), updatedAt: Date.now(), messages: [] }),
  getText: async () => "Draft is ready and waiting for approval.",
};
```

Assert:

- draft request is handled
- pending call creates an approval gate
- run file contains `awaiting_approval`
- no send adapter call happens before approval

## Task 6: Route Integration

**Files:**

- Modify: `server/routes.ts`
- Modify: `server/telegramRoutes.ts`

- [ ] **Step 1: App chat branch**

In `POST /api/coach/chat`, after validating `messages` and before existing autonomy/model handling:

```ts
const latestUserMessage = [...messages].reverse().find((m: any) => m?.role === "user")?.content ?? "";
const { runAgentSdkEmailWorkflow } = await import("../src/agent/agentRunner");
const agentSdkResult = await runAgentSdkEmailWorkflow({
  userId,
  userText: String(latestUserMessage),
  originChannel,
});
if (agentSdkResult.handled) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ content: agentSdkResult.reply, agentSdkRunId: agentSdkResult.runId, status: agentSdkResult.status })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
  return;
}
```

Use the correct relative import path from `server/routes.ts`.

- [ ] **Step 2: Telegram message branch**

In `handleCoachReply`, before creating placeholder streaming state or before `runCoachAgent` if preserving placeholder is easier:

```ts
const { runAgentSdkEmailWorkflow } = await import("../src/agent/agentRunner");
const sdkResult = await runAgentSdkEmailWorkflow({
  userId,
  userText,
  originChannel: "telegram",
  originChannelId: chatId,
});
if (sdkResult.handled) {
  await sendMessage(chatId, sdkResult.reply);
  return;
}
```

Keep this branch behind `ENABLE_AGENT_SDK_RUNNER=true` and explicit matcher.

## Task 7: Manual Smoke Script

**Files:**

- Create: `scripts/agent-sdk-hitl-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add script**

In `package.json`:

```json
"jarvis:qa:agent-sdk-hitl": "tsx scripts/agent-sdk-hitl-smoke.mjs"
```

- [ ] **Step 2: Create smoke script**

The smoke script should use mocked OpenRouter and mocked send adapters by default.

It must print and assert:

1. draft generated
2. approval requested
3. paused run persisted
4. approval resumes run
5. rejection prevents sending

Suggested output:

```txt
OK: draft generated
OK: approval requested
OK: paused run persisted
OK: approval resumes and sends
OK: rejection prevents sending
```

## Task 8: Operator Docs

**Files:**

- Create: `docs/agent-sdk-hitl-prototype.md`

- [ ] **Step 1: Document feature flag and non-goals**

Include:

- `ENABLE_AGENT_SDK_RUNNER=true`
- `OPENROUTER_API_KEY` required for real model calls
- The prototype only handles explicit "draft and send an email" requests.
- All other Jarvis routes remain unchanged.
- Send approval is required through Telegram approval buttons.
- File-backed run state is experimental and not durable production infrastructure.

- [ ] **Step 2: Document manual test**

Include:

```powershell
npm.cmd run jarvis:qa:agent-sdk-hitl
```

For real end-to-end local testing:

```powershell
$env:ENABLE_AGENT_SDK_RUNNER="true"
$env:OPENROUTER_API_KEY="<set locally>"
npm.cmd run server:dev
```

Then ask:

```txt
Draft and send an email to test@example.com saying this is a Jarvis Agent SDK approval test.
```

Expected:

- Jarvis drafts.
- Telegram receives approve/decline buttons.
- Approve resumes and sends.
- Decline does not send.

## Task 9: Verification

**Files:**

- Modify: `scripts/run-agent-tests.mjs`

- [ ] **Step 1: Add assertion test to runner**

Add `src/agent/__tests__/agentSdkHitl.assert.ts` to the non-DB test runner.

- [ ] **Step 2: Run targeted checks**

Run:

```powershell
npx.cmd tsx src/agent/__tests__/agentSdkHitl.assert.ts
npm.cmd run jarvis:qa:agent-sdk-hitl
```

Expected:

- Both pass.
- No real email is sent in mocked smoke.

- [ ] **Step 3: Run standard checks**

Run:

```powershell
npm.cmd test
npm.cmd run server:build
```

Expected:

- Existing non-DB tests pass.
- `server:build` passes.
- DB-backed tests may skip if `DATABASE_URL` is missing; report this explicitly.

## Acceptance Criteria

- `ENABLE_AGENT_SDK_RUNNER` defaults off.
- With flag off, all app and Telegram requests continue through the current Jarvis path.
- With flag on, only explicit draft/send email workflow requests use the prototype.
- The prototype creates a draft preview before send approval.
- The send tool has `requireApproval: true`.
- A paused run is persisted before Telegram approval is sent.
- Telegram approve resumes OpenRouter state and calls the wrapped send adapter.
- Telegram reject resumes/reports without calling the send adapter.
- No normal Gmail/Calendar production behavior is changed.
- Existing approval gates remain the canonical approval record.
- Tests or smoke script prove draft, pause, persistence, approve-resume-send, and reject-no-send.

## Rollback Plan

1. Set `ENABLE_AGENT_SDK_RUNNER=false`.
2. Remove or ignore `.jarvis/runtime/agent-sdk-runs/`.
3. Revert only:
   - `src/agent/*`
   - route branch in `server/routes.ts`
   - Telegram branch and prototype callback hook in `server/telegramRoutes.ts`
   - docs and smoke script
   - `@openrouter/agent` dependency if no longer needed

No data migration rollback is needed because the initial implementation uses a file-backed store and existing approval gate rows.

## Open Questions To Resolve During Implementation

- Whether `@openrouter/agent` exports exact `ConversationState` / `StateAccessor` names as shown in the docs version currently installed. If names differ, adapt only inside `src/agent/runStore.ts`.
- Whether the prototype should notify only Telegram or both Telegram and in-app. The plan uses existing `notifyApprovalRequest`, which always includes in-app as canonical fallback.
- Whether real-send testing should use Gmail or Outlook first. The wrapper supports both through existing `sendEmailTool`, but the POC prompt should default to Gmail unless the user specifies provider.
