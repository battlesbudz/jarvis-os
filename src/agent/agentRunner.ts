import { randomUUID } from "node:crypto";
import type { CallModelInput, ConversationState, Tool } from "@openrouter/agent";
import { createInitialState, maxCost, stepCountIs } from "@openrouter/agent";
import { AGENT_SDK_HITL_AGENT_ID, requestTelegramApprovalForPendingCall } from "./hitlApproval";
import type { AgentSdkPendingApproval, HitlApprovalDeps } from "./hitlApproval";
import { createFileAgentSdkRunStore } from "./runStore";
import type { AgentSdkRunStore } from "./runStore";
import { createAgentSdkTools } from "./toolRegistry";

export type AgentSdkRunnerResult =
  | { handled: false }
  | { handled: true; status: "complete"; runId: string; reply: string }
  | { handled: true; status: "awaiting_approval"; runId: string; gateId: string; reply: string }
  | { handled: true; status: "rejected"; runId: string; reply: string }
  | { handled: true; status: "failed"; runId: string; reply: string; error: string };

export interface RunAgentSdkEmailWorkflowInput {
  userId: string;
  userText: string;
  conversationContext?: string;
  originChannel: "app" | "telegram" | string;
  originChannelId?: string;
}

export interface AgentSdkModelResultLike {
  requiresApproval?: () => Promise<boolean>;
  getPendingToolCalls?: () => Promise<Array<{ id: string; name: string; arguments: Record<string, unknown> }>>;
  getState?: () => Promise<ConversationState<any>>;
  getText?: () => Promise<string>;
  getResponse?: () => Promise<{ state?: ConversationState<any>; usage?: unknown }>;
  getToolCallsStream?: () => AsyncIterable<{ id: string; name: string; arguments: Record<string, unknown> }>;
  getTextStream?: () => AsyncIterable<string>;
}

export interface AgentSdkRunnerDeps {
  store?: AgentSdkRunStore;
  callModel?: (request: Record<string, unknown>) => Promise<AgentSdkModelResultLike> | AgentSdkModelResultLike;
  readContext?: (userId: string, query: string) => Promise<string>;
  sendEmail?: (
    userId: string,
    args: { to: string; subject: string; body: string; provider?: "google" | "microsoft" },
  ) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
  requestApprovalForPendingCall?: (
    pending: AgentSdkPendingApproval,
    deps: HitlApprovalDeps,
  ) => Promise<string>;
  requestApproval?: HitlApprovalDeps["requestApproval"];
  notifyApprovalRequest?: HitlApprovalDeps["notifyApprovalRequest"];
  sendTelegramMessage?: (chatId: string, text: string) => Promise<unknown>;
  maxCostUsd?: number;
  maxSteps?: number;
  progressTextChunkChars?: number;
  createInternalReminder?: (
    userId: string,
    args: { title: string; description?: string; scheduledAt: string; recurrence?: string },
  ) => Promise<{ ok: boolean; id?: string; scheduledAt?: string; recurrence?: string | null; deduped?: boolean; error?: string }>;
}

export interface ResumeAgentSdkEmailWorkflowRunInput {
  runId: string;
  originChannelId?: string;
}

export interface ResumeAgentSdkRunInput {
  gate: {
    id: string;
    userId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
  };
  approved: boolean;
  originChannelId?: string;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_MAX_COST_USD = 0.25;
const DEFAULT_MAX_STEPS = 20;
const DEFAULT_PROGRESS_TEXT_CHUNK_CHARS = 80;
type AgentSdkWorkflowMode = "email_send_approval" | "email_draft_only" | "internal_reminder";

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

export function matchesAgentSdkEmailDraftOnlyWorkflow(message: string): boolean {
  const text = String(message || "").toLowerCase();
  if (!/\b(email|reply)\b/.test(text)) return false;
  if (!/\b(draft|write|compose|reply)\b/.test(text)) return false;
  if (/\b(send|sent)\b/.test(text) && !/\b(do not send|don't send|dont send|draft only|just draft)\b/.test(text)) {
    return false;
  }
  return true;
}

function getAgentSdkEmailWorkflowMode(message: string): AgentSdkWorkflowMode | null {
  if (matchesAgentSdkEmailWorkflow(message)) return "email_send_approval";
  if (matchesAgentSdkEmailDraftOnlyWorkflow(message)) return "email_draft_only";
  return null;
}

export function matchesAgentSdkReminderWorkflow(message: string): boolean {
  const text = String(message || "").toLowerCase();
  if (!/\b(remind\s+me|set\s+(a\s+)?reminder|reminder)\b/.test(text)) return false;
  if (!/\b(in|at|on|tomorrow|today|tonight|morning|afternoon|evening|hour|hours|minute|minutes|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)) {
    return false;
  }
  if (/\b(calendar|meeting|event|invite|shell|script|command|daemon|device)\b/.test(text)) return false;
  return true;
}

function createRunId(): string {
  return `asdk_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveLongHorizonOptions(deps: AgentSdkRunnerDeps = {}) {
  return {
    maxCostUsd: parsePositiveNumber(deps.maxCostUsd ?? process.env.OPENROUTER_AGENT_SDK_MAX_COST, DEFAULT_MAX_COST_USD),
    maxSteps: Math.max(
      1,
      Math.floor(parsePositiveNumber(deps.maxSteps ?? process.env.OPENROUTER_AGENT_SDK_MAX_STEPS, DEFAULT_MAX_STEPS)),
    ),
    progressTextChunkChars: Math.max(
      20,
      Math.floor(parsePositiveNumber(deps.progressTextChunkChars, DEFAULT_PROGRESS_TEXT_CHUNK_CHARS)),
    ),
  };
}

async function safeText(result: AgentSdkModelResultLike, fallback: string): Promise<string> {
  try {
    const text = await result.getText?.();
    return text?.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function defaultCallModel(request: Record<string, unknown>): Promise<AgentSdkModelResultLike> {
  const [{ OpenRouter }] = await Promise.all([import("@openrouter/agent")]);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required when ENABLE_AGENT_SDK_RUNNER=true");
  }
  const client = new OpenRouter({ apiKey });
  return client.callModel(request as CallModelInput<readonly Tool[]>);
}

async function defaultReadContext(userId: string, query: string): Promise<string> {
  try {
    const { retrieveRelevantMemories } = await import("../../server/memory/retrieve");
    const memories = await retrieveRelevantMemories(userId, query, 5).catch(() => []);
    return memories.map((memory: any) => `- ${memory.content}`).join("\n");
  } catch {
    return "";
  }
}

async function defaultSendEmail(
  userId: string,
  args: { to: string; subject: string; body: string; provider?: "google" | "microsoft" },
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { sendEmailTool } = await import("../../server/agent/tools/sendEmail");
  const result = await sendEmailTool.execute(args, {
    userId,
    channel: "agent-sdk-hitl",
    state: {},
  } as any);
  return result.ok
    ? { ok: true, messageId: typeof result.detail === "string" ? result.detail : undefined }
    : { ok: false, error: result.content || result.detail || "Email send failed" };
}

async function defaultCreateInternalReminder(
  userId: string,
  args: { title: string; description?: string; scheduledAt: string; recurrence?: string },
): Promise<{ ok: boolean; id?: string; scheduledAt?: string; recurrence?: string | null; deduped?: boolean; error?: string }> {
  const [{ createJarvisScheduledTask }, { parseNaturalTime, parseRecurringExpr }] = await Promise.all([
    import("../../server/jarvisScheduledTasks"),
    import("../../server/agent/tools/cronTools"),
  ]);
  const title = String(args.title || "").trim();
  const scheduledAtText = String(args.scheduledAt || "").trim();
  if (!title) return { ok: false, error: "title is required" };
  if (!scheduledAtText) return { ok: false, error: "scheduledAt is required" };
  const recurring = parseRecurringExpr(scheduledAtText);
  const scheduledAt = recurring?.scheduledAt ?? parseNaturalTime(scheduledAtText) ?? new Date(scheduledAtText);
  const recurrence = args.recurrence ? String(args.recurrence).trim() : recurring?.recurrence ?? null;
  if (isNaN(scheduledAt.getTime())) {
    return { ok: false, error: `Invalid scheduledAt: "${scheduledAtText}"` };
  }
  const { task, deduped } = await createJarvisScheduledTask({
    userId,
    title,
    description: args.description ? String(args.description).trim() : null,
    scheduledAt,
    recurrence,
  });
  return {
    ok: true,
    id: String(task.id),
    scheduledAt: task.scheduledAt instanceof Date ? task.scheduledAt.toISOString() : new Date(task.scheduledAt).toISOString(),
    recurrence: task.recurrence ?? recurrence,
    deduped,
  };
}

async function defaultRequestApproval(input: Parameters<HitlApprovalDeps["requestApproval"]>[0]) {
  const { requestApproval } = await import("../../server/agent/agentApproval");
  return requestApproval(input);
}

async function defaultNotifyApprovalRequest(input: Parameters<HitlApprovalDeps["notifyApprovalRequest"]>[0]) {
  const { notifyApprovalRequest } = await import("../../server/agent/approvalNotifications");
  return notifyApprovalRequest(input);
}

async function defaultSendTelegramMessage(chatId: string, text: string): Promise<void> {
  const { sendMessage } = await import("../../server/integrations/telegram");
  await sendMessage(chatId, text);
}

function buildRequest(
  userText: string | [],
  tools: readonly Tool[],
  state: ReturnType<AgentSdkRunStore["createStateAccessor"]>,
  options: { maxCostUsd: number; maxSteps: number },
  mode: AgentSdkWorkflowMode = "email_send_approval",
  decisions?: { approveToolCalls?: string[]; rejectToolCalls?: string[] },
): Record<string, unknown> {
  const workflowInstruction = mode === "internal_reminder"
    ? [
      "Handle only this task: create an internal Jarvis reminder.",
      "If the reminder title or time is missing or ambiguous, ask one short follow-up and do not call a tool.",
      "Call create_internal_reminder only for an explicit internal reminder with clear reminder text and time.",
      "Do not create calendar events, send messages, run shell commands, or control devices.",
      "Keep final user-facing text short and include the scheduled time returned by the tool.",
    ].join("\n")
    : mode === "email_draft_only"
    ? [
      "Handle only this task: create an internal email draft preview or reply draft.",
      "Call read_context only when useful, then call draft_email.",
      "No send_email tool is available in this mode. Do not imply the email was sent.",
      "Return the draft clearly with recipient, subject, and body when known.",
    ].join("\n")
    : [
      "Handle only this task: draft an email, then request the send_email tool.",
      "Always call draft_email before send_email.",
      "Never claim the email was sent unless send_email executes successfully.",
      "Keep final user-facing text short.",
    ].join("\n");
  return {
    model: process.env.OPENROUTER_AGENT_SDK_MODEL || DEFAULT_MODEL,
    instructions: [
      "You are Jarvis running a small experimental Agent SDK workflow.",
      workflowInstruction,
    ].join("\n"),
    input: Array.isArray(userText) || decisions ? [] : userText,
    tools,
    state,
    stopWhen: [stepCountIs(options.maxSteps), maxCost(options.maxCostUsd)],
    ...decisions,
  };
}

async function sendTelegramProgress(
  result: AgentSdkModelResultLike,
  deps: AgentSdkRunnerDeps,
  chatId: string | undefined,
): Promise<void> {
  if (!chatId) return;
  const send = deps.sendTelegramMessage ?? defaultSendTelegramMessage;
  const textChunkChars = resolveLongHorizonOptions(deps).progressTextChunkChars;
  const tasks: Promise<void>[] = [];

  if (result.getToolCallsStream) {
    tasks.push((async () => {
      for await (const call of result.getToolCallsStream!()) {
        await send(chatId, `Agent SDK progress: running ${call.name}.`);
      }
    })());
  }

  if (result.getTextStream) {
    tasks.push((async () => {
      let buffered = "";
      for await (const delta of result.getTextStream!()) {
        buffered += delta;
        if (buffered.trim().length >= textChunkChars) {
          await send(chatId, `Agent SDK progress: ${buffered.trim().slice(0, 500)}`);
          buffered = "";
        }
      }
    })());
  }

  await Promise.allSettled(tasks);
}

async function sendTelegramCompletion(
  deps: AgentSdkRunnerDeps,
  chatId: string | undefined,
  text: string,
  status: "complete" | "failed" | "rejected",
): Promise<void> {
  if (!chatId) return;
  const prefix = status === "complete"
    ? "Agent SDK workflow completed."
    : status === "rejected"
      ? "Agent SDK workflow finished without sending."
      : "Agent SDK workflow failed.";
  await (deps.sendTelegramMessage ?? defaultSendTelegramMessage)(chatId, `${prefix}\n\n${text}`.trim());
}

async function saveResponseState(
  store: AgentSdkRunStore,
  runId: string,
  response: { state?: ConversationState<any>; usage?: unknown } | undefined,
  status: "complete" | "rejected" | "failed",
  error?: string,
): Promise<void> {
  const record = await store.load(runId);
  if (!record) return;
  const now = new Date().toISOString();
  record.state = response?.state ?? record.state;
  record.meta.status = status;
  record.meta.updatedAt = now;
  if (status === "complete" || status === "rejected") {
    record.meta.completedAt = now;
  }
  if (response?.usage) {
    record.meta.usage = response.usage;
  }
  if (error) {
    record.meta.error = error;
  }
  await store.save(record);
}

export async function runAgentSdkEmailWorkflow(
  input: RunAgentSdkEmailWorkflowInput,
  deps: AgentSdkRunnerDeps = {},
): Promise<AgentSdkRunnerResult> {
  if (!isAgentSdkRunnerEnabled()) return { handled: false };
  const workflowMode = getAgentSdkEmailWorkflowMode(input.userText);
  if (!workflowMode) return { handled: false };

  const store = deps.store ?? createFileAgentSdkRunStore();
  const callModel = deps.callModel ?? defaultCallModel;
  const readContext = deps.readContext ?? defaultReadContext;
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const longHorizon = resolveLongHorizonOptions(deps);
  const runId = createRunId();
  const now = new Date().toISOString();
  const tools = createAgentSdkTools({
    userId: input.userId,
    runId,
    store,
    readContext: (query) => readContext(input.userId, query),
    sendEmail: (args) => sendEmail(input.userId, args),
    includeSendEmailTool: workflowMode === "email_send_approval",
  });
  const stateAccessor = store.createStateAccessor(runId);
  const userInput = input.conversationContext
    ? `${input.userText}\n\nRelevant conversation context:\n${input.conversationContext}`
    : input.userText;

  await store.save({
    meta: {
      runId,
      userId: input.userId,
      originChannel: input.originChannel,
      originChannelId: input.originChannelId,
      workflow: workflowMode,
      status: "running",
      createdAt: now,
      updatedAt: now,
      maxCostUsd: longHorizon.maxCostUsd,
      maxSteps: longHorizon.maxSteps,
    },
    state: createInitialState(runId),
  });

  try {
    const result = await callModel(buildRequest(userInput, tools, stateAccessor, longHorizon, workflowMode));
    const progressPromise = sendTelegramProgress(result, deps, input.originChannelId);
    const state = await result.getState?.();
    if (state) {
      const record = await store.load(runId);
      if (record) {
        record.state = state;
        record.meta.updatedAt = new Date().toISOString();
        await store.save(record);
      }
    }

    if (await result.requiresApproval?.()) {
      if (workflowMode === "email_draft_only") {
        throw new Error("Draft-only Agent SDK workflow unexpectedly requested approval");
      }
      await progressPromise;
      const pendingCalls = (await result.getPendingToolCalls?.()) ?? [];
      const pending = pendingCalls.find((call) => call.name === "send_email") ?? pendingCalls[0];
      if (!pending) {
        throw new Error("Agent SDK paused for approval but no pending tool call was returned");
      }
      const gateId = await (deps.requestApprovalForPendingCall ?? requestTelegramApprovalForPendingCall)(
        {
          runId,
          userId: input.userId,
          originChannel: input.originChannel,
          originChannelId: input.originChannelId,
          toolCallId: pending.id,
          toolName: pending.name,
          arguments: pending.arguments,
        },
        {
          store,
          requestApproval: deps.requestApproval ?? defaultRequestApproval,
          notifyApprovalRequest: deps.notifyApprovalRequest ?? defaultNotifyApprovalRequest,
        },
      );
      return {
        handled: true,
        status: "awaiting_approval",
        runId,
        gateId,
        reply: await safeText(result, "Draft is ready. I sent you an approval request before sending."),
      };
    }

    const response = await result.getResponse?.();
    await progressPromise;
    const reply = await safeText(result, workflowMode === "email_draft_only"
      ? "Draft is ready. I did not send anything."
      : "Agent SDK email workflow finished.");
    await saveResponseState(store, runId, response, "complete");
    await sendTelegramCompletion(deps, input.originChannelId, reply, "complete");
    return {
      handled: true,
      status: "complete",
      runId,
      reply,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveResponseState(store, runId, undefined, "failed", message);
    await sendTelegramCompletion(deps, input.originChannelId, `Agent SDK email prototype failed: ${message}`, "failed");
    return {
      handled: true,
      status: "failed",
      runId,
      reply: `Agent SDK email prototype failed: ${message}`,
      error: message,
    };
  }
}

export async function runAgentSdkReminderWorkflow(
  input: RunAgentSdkEmailWorkflowInput,
  deps: AgentSdkRunnerDeps = {},
): Promise<AgentSdkRunnerResult> {
  if (!isAgentSdkRunnerEnabled()) return { handled: false };
  if (!matchesAgentSdkReminderWorkflow(input.userText)) return { handled: false };

  const store = deps.store ?? createFileAgentSdkRunStore();
  const callModel = deps.callModel ?? defaultCallModel;
  const readContext = deps.readContext ?? defaultReadContext;
  const createInternalReminder = deps.createInternalReminder ?? defaultCreateInternalReminder;
  const longHorizon = resolveLongHorizonOptions(deps);
  const runId = createRunId();
  const now = new Date().toISOString();
  const tools = createAgentSdkTools({
    userId: input.userId,
    runId,
    store,
    includeDraftEmailTool: false,
    includeSendEmailTool: false,
    includeReminderTool: true,
    readContext: (query) => readContext(input.userId, query),
    createInternalReminder: (args) => createInternalReminder(input.userId, args),
  });
  const stateAccessor = store.createStateAccessor(runId);

  await store.save({
    meta: {
      runId,
      userId: input.userId,
      originChannel: input.originChannel,
      originChannelId: input.originChannelId,
      workflow: "internal_reminder",
      status: "running",
      createdAt: now,
      updatedAt: now,
      maxCostUsd: longHorizon.maxCostUsd,
      maxSteps: longHorizon.maxSteps,
    },
    state: createInitialState(runId),
  });

  try {
    const result = await callModel(buildRequest(input.userText, tools, stateAccessor, longHorizon, "internal_reminder"));
    const progressPromise = sendTelegramProgress(result, deps, input.originChannelId);
    const state = await result.getState?.();
    if (state) {
      const record = await store.load(runId);
      if (record) {
        record.state = state;
        record.meta.updatedAt = new Date().toISOString();
        await store.save(record);
      }
    }
    if (await result.requiresApproval?.()) {
      throw new Error("Internal reminder workflow unexpectedly requested approval");
    }
    const response = await result.getResponse?.();
    await progressPromise;
    const reply = await safeText(result, "Reminder scheduled.");
    await saveResponseState(store, runId, response, "complete");
    await sendTelegramCompletion(deps, input.originChannelId, reply, "complete");
    return {
      handled: true,
      status: "complete",
      runId,
      reply,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveResponseState(store, runId, undefined, "failed", message);
    await sendTelegramCompletion(deps, input.originChannelId, `Agent SDK reminder prototype failed: ${message}`, "failed");
    return {
      handled: true,
      status: "failed",
      runId,
      reply: `Agent SDK reminder prototype failed: ${message}`,
      error: message,
    };
  }
}

export async function resumeAgentSdkRunFromApprovalGate(
  input: ResumeAgentSdkRunInput,
  deps: AgentSdkRunnerDeps = {},
): Promise<Exclude<AgentSdkRunnerResult, { handled: false }>> {
  const runId = String(input.gate.toolArgs.__agentSdkRunId || "");
  if (!runId) {
    return {
      handled: true,
      status: "failed",
      runId: "unknown",
      reply: "Agent SDK approval could not resume because the run id was missing.",
      error: "Missing __agentSdkRunId",
    };
  }

  const store = deps.store ?? createFileAgentSdkRunStore();
  const record = await store.load(runId);
  if (!record) {
    return {
      handled: true,
      status: "failed",
      runId,
      reply: "Agent SDK approval could not resume because the run record was missing.",
      error: "Run record missing",
    };
  }

  const toolCallId = String(input.gate.toolArgs.__agentSdkToolCallId || record.meta.pendingToolCallId || "");
  if (!toolCallId) {
    record.meta.status = "failed";
    record.meta.error = "Missing pending tool call id";
    record.meta.updatedAt = new Date().toISOString();
    await store.save(record);
    return {
      handled: true,
      status: "failed",
      runId,
      reply: "Agent SDK approval could not resume because the tool call id was missing.",
      error: "Missing pending tool call id",
    };
  }

  if (!input.approved) {
    record.meta.status = "rejected";
    record.meta.updatedAt = new Date().toISOString();
    await store.save(record);
  }

  const callModel = deps.callModel ?? defaultCallModel;
  const readContext = deps.readContext ?? defaultReadContext;
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const longHorizon = resolveLongHorizonOptions(deps);
  const tools = createAgentSdkTools({
    userId: record.meta.userId,
    runId,
    store,
    readContext: (query) => readContext(record.meta.userId, query),
    sendEmail: (args) => sendEmail(record.meta.userId, args),
    includeSendEmailTool: record.meta.workflow !== "email_draft_only",
  });
  const stateAccessor = store.createStateAccessor(runId);

  try {
    const result = await callModel(buildRequest("", tools, stateAccessor, longHorizon, record.meta.workflow ?? "email_send_approval", input.approved
      ? { approveToolCalls: [toolCallId] }
      : { rejectToolCalls: [toolCallId] }));
    const progressPromise = sendTelegramProgress(result, deps, input.originChannelId || record.meta.originChannelId);
    const text = await safeText(result, input.approved ? "Email send approved and resumed." : "Email send declined. I did not send it.");
    const response = await result.getResponse?.();
    await progressPromise;
    await saveResponseState(store, runId, response, input.approved ? "complete" : "rejected");
    const chatId = input.originChannelId || record.meta.originChannelId;
    await sendTelegramCompletion(deps, chatId, text, input.approved ? "complete" : "rejected");
    return {
      handled: true,
      status: input.approved ? "complete" : "rejected",
      runId,
      reply: text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveResponseState(store, runId, undefined, "failed", message);
    await sendTelegramCompletion(deps, input.originChannelId || record.meta.originChannelId, `Agent SDK approval resume failed: ${message}`, "failed");
    return {
      handled: true,
      status: "failed",
      runId,
      reply: `Agent SDK approval resume failed: ${message}`,
      error: message,
    };
  }
}

export function isAgentSdkApprovalGate(gate: { agentId?: string; toolArgs?: Record<string, unknown> } | null | undefined): boolean {
  return gate?.agentId === AGENT_SDK_HITL_AGENT_ID && gate.toolArgs?.__agentSdkPrototype === true;
}

export async function resumeAgentSdkEmailWorkflowRun(
  input: ResumeAgentSdkEmailWorkflowRunInput,
  deps: AgentSdkRunnerDeps = {},
): Promise<Exclude<AgentSdkRunnerResult, { handled: false }>> {
  if (!isAgentSdkRunnerEnabled()) {
    return {
      handled: true,
      status: "failed",
      runId: input.runId,
      reply: "Agent SDK runner is disabled.",
      error: "ENABLE_AGENT_SDK_RUNNER is not true",
    };
  }

  const store = deps.store ?? createFileAgentSdkRunStore();
  const record = await store.load(input.runId);
  if (!record) {
    return {
      handled: true,
      status: "failed",
      runId: input.runId,
      reply: "Agent SDK run could not resume because the run record was missing.",
      error: "Run record missing",
    };
  }

  const callModel = deps.callModel ?? defaultCallModel;
  const readContext = deps.readContext ?? defaultReadContext;
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const longHorizon = resolveLongHorizonOptions(deps);
  const tools = createAgentSdkTools({
    userId: record.meta.userId,
    runId: input.runId,
    store,
    readContext: (query) => readContext(record.meta.userId, query),
    sendEmail: (args) => sendEmail(record.meta.userId, args),
    includeSendEmailTool: record.meta.workflow !== "email_draft_only",
  });
  const stateAccessor = store.createStateAccessor(input.runId);
  const now = new Date().toISOString();
  record.meta.status = "running";
  record.meta.resumedAt = now;
  record.meta.updatedAt = now;
  record.meta.maxCostUsd = longHorizon.maxCostUsd;
  record.meta.maxSteps = longHorizon.maxSteps;
  await store.save(record);

  try {
    const chatId = input.originChannelId || record.meta.originChannelId;
    const result = await callModel(buildRequest([], tools, stateAccessor, longHorizon, record.meta.workflow ?? "email_send_approval"));
    const progressPromise = sendTelegramProgress(result, deps, chatId);
    if (await result.requiresApproval?.()) {
      await progressPromise;
      const pendingCalls = (await result.getPendingToolCalls?.()) ?? [];
      const pending = pendingCalls.find((call) => call.name === "send_email") ?? pendingCalls[0];
      if (!pending) {
        throw new Error("Agent SDK resumed for approval but no pending tool call was returned");
      }
      const gateId = await (deps.requestApprovalForPendingCall ?? requestTelegramApprovalForPendingCall)(
        {
          runId: input.runId,
          userId: record.meta.userId,
          originChannel: record.meta.originChannel,
          originChannelId: chatId,
          toolCallId: pending.id,
          toolName: pending.name,
          arguments: pending.arguments,
        },
        {
          store,
          requestApproval: deps.requestApproval ?? defaultRequestApproval,
          notifyApprovalRequest: deps.notifyApprovalRequest ?? defaultNotifyApprovalRequest,
        },
      );
      return {
        handled: true,
        status: "awaiting_approval",
        runId: input.runId,
        gateId,
        reply: await safeText(result, "Resumed run is waiting for approval."),
      };
    }

    const text = await safeText(result, "Agent SDK email workflow resumed and finished.");
    const response = await result.getResponse?.();
    await progressPromise;
    await saveResponseState(store, input.runId, response, "complete");
    await sendTelegramCompletion(deps, chatId, text, "complete");
    return {
      handled: true,
      status: "complete",
      runId: input.runId,
      reply: text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveResponseState(store, input.runId, undefined, "failed", message);
    await sendTelegramCompletion(deps, input.originChannelId || record.meta.originChannelId, `Agent SDK resume failed: ${message}`, "failed");
    return {
      handled: true,
      status: "failed",
      runId: input.runId,
      reply: `Agent SDK resume failed: ${message}`,
      error: message,
    };
  }
}
