import { randomUUID } from "node:crypto";
import { AGENT_SDK_HITL_AGENT_ID, requestTelegramApprovalForPendingCall } from "./hitlApproval";
import type { AgentSdkPendingApproval, HitlApprovalDeps } from "./hitlApproval";
import { createFileAgentSdkRunStore } from "./runStore";
import type { AgentSdkRunStore } from "./runStore";
import { createAgentSdkTools } from "./toolRegistry";

type ConversationState<TTools = unknown> = Record<string, unknown> & {
  id?: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  messages?: unknown[];
  pendingToolCalls?: unknown[];
  tools?: TTools;
};
type Tool = Record<string, unknown>;

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
  getPendingToolCalls?: () => Promise<{ id: string; name: string; arguments: Record<string, unknown> }[]>;
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

const DEFAULT_MODEL = "chatgpt-codex-oauth/auto";
const DEFAULT_MAX_COST_USD = 0.25;
const DEFAULT_MAX_STEPS = 20;
const DEFAULT_PROGRESS_TEXT_CHUNK_CHARS = 80;
type AgentSdkWorkflowMode = "email_send_approval" | "email_draft_only" | "internal_reminder";

function createInitialState(id: string): ConversationState<any> {
  const now = Date.now();
  return {
    id,
    status: "in_progress",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function stepCountIs(maxSteps: number): Record<string, unknown> {
  return { type: "step_count", maxSteps };
}

function maxCost(maxCostUsd: number): Record<string, unknown> {
  return { type: "max_cost", maxCostUsd };
}

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
  const explicitEmailContext =
    /\b(email|e-mail|gmail|outlook|inbox|mail|thread)\b/.test(text)
    || /\b(reply|respond)\s+to\b/.test(text);
  if (!explicitEmailContext) return false;
  if (!/\b(draft|write|compose)\b/.test(text) && !/\b(reply|respond)\s+to\b/.test(text)) return false;
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
    maxCostUsd: parsePositiveNumber(deps.maxCostUsd ?? process.env.AGENT_SDK_MAX_COST, DEFAULT_MAX_COST_USD),
    maxSteps: Math.max(
      1,
      Math.floor(parsePositiveNumber(deps.maxSteps ?? process.env.AGENT_SDK_MAX_STEPS, DEFAULT_MAX_STEPS)),
    ),
    progressTextChunkChars: Math.max(
      20,
      Math.floor(parsePositiveNumber(deps.progressTextChunkChars, DEFAULT_PROGRESS_TEXT_CHUNK_CHARS)),
    ),
  };
}

async function resolveAgentSdkModel(userText: string | string[], mode: AgentSdkWorkflowMode): Promise<string> {
  const explicit = process.env.AGENT_SDK_MODEL?.trim();
  if (explicit) return explicit;
  const text = Array.isArray(userText) ? userText.join("\n") : userText;
  try {
    const { classifyTaskComplexity, classifyTaskPrivacy } = await import("../../server/agent/modelRouter");
    const complexity = classifyTaskComplexity(text);
    const privacy = classifyTaskPrivacy(text);
    if (privacy === "sensitive" || complexity === "hard") {
      return process.env.AGENT_SDK_SMART_MODEL || DEFAULT_MODEL;
    }
    if (mode === "internal_reminder") {
      return process.env.AGENT_SDK_CHEAP_MODEL || DEFAULT_MODEL;
    }
    return process.env.AGENT_SDK_BALANCED_MODEL || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

async function safeText(result: AgentSdkModelResultLike, fallback: string): Promise<string> {
  try {
    const text = await result.getText?.();
    return text?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function getAgentSdkModelProvider(_env = process.env): "jarvis" {
  return "jarvis";
}

function toolName(tool: unknown): string {
  const record = tool as any;
  return String(record?.function?.name || record?.name || "");
}

function toolDescription(tool: unknown): string {
  const record = tool as any;
  return String(record?.function?.description || record?.description || "");
}

function toolParameters(tool: unknown): Record<string, unknown> {
  const record = tool as any;
  return (record?.function?.parameters || record?.inputSchema || record?.schema || { type: "object", properties: {} }) as Record<string, unknown>;
}

function toolRequiresApproval(tool: unknown): boolean {
  const record = tool as any;
  return record?.function?.requireApproval === true
    || record?.requireApproval === true
    || record?.requiresApproval === true
    || toolName(tool) === "send_email";
}

async function executeAgentSdkTool(tool: unknown, args: Record<string, unknown>): Promise<unknown> {
  const record = tool as any;
  const fn = record?.function?.execute || record?.execute;
  if (typeof fn !== "function") throw new Error(`Tool ${toolName(tool) || "unknown"} has no executable adapter.`);
  return fn(args);
}

function toOpenAiTools(tools: readonly Tool[] | undefined): any[] | undefined {
  if (!tools?.length) return undefined;
  return tools
    .map((tool) => {
      const name = toolName(tool);
      if (!name) return null;
      return {
        type: "function",
        function: {
          name,
          description: toolDescription(tool),
          parameters: toolParameters(tool),
        },
      };
    })
    .filter(Boolean) as any[];
}

function parseToolArgs(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function createAdapterResult(params: {
  text: string;
  state: ConversationState<any>;
  pendingToolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  usage?: unknown;
}): AgentSdkModelResultLike {
  return {
    requiresApproval: async () => Boolean(params.pendingToolCalls?.length),
    getPendingToolCalls: async () => params.pendingToolCalls ?? [],
    getState: async () => params.state,
    getText: async () => params.text,
    getResponse: async () => ({ state: params.state, usage: params.usage }),
    getTextStream: async function* () {
      if (params.text) yield params.text;
    },
    getToolCallsStream: async function* () {
      for (const call of params.pendingToolCalls ?? []) yield call;
    },
  };
}

async function callJarvisModelAdapter(request: Record<string, unknown>): Promise<AgentSdkModelResultLike> {
  const { routeModelTurn } = await import("../../server/agent/modelRouter");
  const tools = (request.tools as readonly Tool[] | undefined) ?? [];
  const stateAccessor = request.state as { load?: () => Promise<ConversationState<any> | null>; save?: (state: ConversationState<any>) => Promise<void> } | undefined;
  const previousState = await stateAccessor?.load?.().catch(() => null) ?? null;
  const now = Date.now();
  const workflow = String((request.metadata as any)?.workflow || "agent_sdk");
  const instructions = String(request.instructions || "");
  const input = Array.isArray(request.input) ? "" : String(request.input || "");
  const maxSteps = Array.isArray(request.stopWhen) ? 20 : 20;
  const messages: any[] = Array.isArray((previousState as any)?.messages) ? [...(previousState as any).messages] : [];

  const approveToolCalls = Array.isArray((request as any).approveToolCalls) ? (request as any).approveToolCalls.map(String) : [];
  const rejectToolCalls = Array.isArray((request as any).rejectToolCalls) ? (request as any).rejectToolCalls.map(String) : [];
  const pendingFromState = Array.isArray((previousState as any)?.pendingToolCalls) ? (previousState as any).pendingToolCalls : [];

  if (approveToolCalls.length || rejectToolCalls.length) {
    const approvedIds = new Set(approveToolCalls);
    const rejectedIds = new Set(rejectToolCalls);
    const approvedCalls = pendingFromState.filter((call: any) => approvedIds.has(String(call.id)));
    const rejectedCalls = pendingFromState.filter((call: any) => rejectedIds.has(String(call.id)));
    const toolResults: unknown[] = [];
    for (const call of approvedCalls) {
      const tool = tools.find((candidate) => toolName(candidate) === String(call.name));
      if (!tool) throw new Error(`Approved tool ${String(call.name)} is not available.`);
      toolResults.push(await executeAgentSdkTool(tool, call.arguments || {}));
    }
    const text = rejectedCalls.length
      ? "Approval rejected. I did not send or execute the blocked action."
      : approvedCalls.length
        ? "Approval accepted. I resumed the workflow and executed the approved action."
        : "No matching pending approval was found for this run.";
    const nextState = {
      ...(previousState || { id: String((previousState as any)?.id || "jarvis-agent-sdk"), createdAt: now }),
      status: rejectedCalls.length ? "rejected" : "complete",
      updatedAt: now,
      messages: [
        ...messages,
        { role: "assistant", content: text, toolResults },
      ],
      pendingToolCalls: pendingFromState.filter((call: any) => !approvedIds.has(String(call.id)) && !rejectedIds.has(String(call.id))),
    } as ConversationState<any>;
    await stateAccessor?.save?.(nextState);
    return createAdapterResult({ text, state: nextState });
  }

  const conversation = [
    ...(instructions ? [{ role: "system", content: instructions }] : []),
    ...messages.filter((message) => message?.role && message?.content),
    ...(input ? [{ role: "user", content: input }] : []),
  ];

  let finalText = "";
  let latestMessages = [...conversation];
  let pendingToolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const turn = await routeModelTurn({
      tier: workflow === "internal_reminder" ? "cheap" : "balanced",
      messages: latestMessages,
      tools: toOpenAiTools(tools),
      toolChoice: tools.length ? "auto" : "none",
      maxCompletionTokens: 1200,
      stream: false,
      logPrefix: "[AgentSDK/JarvisAdapter]",
    });
    finalText = turn.textContent || finalText;
    const toolCalls = turn.toolCallList ?? [];
    if (!toolCalls.length) break;

    latestMessages.push({
      role: "assistant",
      content: turn.textContent || "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call.function.name;
      const args = parseToolArgs(call.function.arguments);
      const tool = tools.find((candidate) => toolName(candidate) === name);
      if (!tool) {
        latestMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: `Unknown tool ${name}` }) });
        continue;
      }
      if (toolRequiresApproval(tool)) {
        pendingToolCalls.push({ id: call.id, name, arguments: args });
        continue;
      }
      const output = await executeAgentSdkTool(tool, args);
      latestMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
    }

    if (pendingToolCalls.length) break;
  }

  const nextState = {
    ...(previousState || { id: String((previousState as any)?.id || `jarvis_agent_sdk_${now}`), createdAt: now }),
    status: pendingToolCalls.length ? "awaiting_approval" : "complete",
    updatedAt: now,
    messages: latestMessages,
    pendingToolCalls,
  } as ConversationState<any>;
  await stateAccessor?.save?.(nextState);
  return createAdapterResult({
    text: finalText || (pendingToolCalls.length ? "Draft is ready. I need approval before continuing." : "Agent SDK workflow finished."),
    state: nextState,
    pendingToolCalls,
  });
}

async function defaultCallModel(request: Record<string, unknown>): Promise<AgentSdkModelResultLike> {
  return callJarvisModelAdapter(request);
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
  model = DEFAULT_MODEL,
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
    model,
    instructions: [
      "You are Jarvis running a focused Agent SDK workflow through the Codex OAuth gateway.",
      workflowInstruction,
    ].join("\n"),
    input: Array.isArray(userText) || decisions ? [] : userText,
    tools,
    state,
    metadata: {
      jarvisRuntime: "jarvis_agent_sdk_codex_oauth",
      workflow: mode,
      loop: "think_tool_observe_continue_hitl",
      approvalRequiredTools: mode === "email_send_approval" ? ["send_email"] : [],
    },
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
  const model = await resolveAgentSdkModel(userInput, workflowMode);

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
      model,
    },
    state: createInitialState(runId),
  });

  try {
    const result = await callModel(buildRequest(userInput, tools, stateAccessor, longHorizon, workflowMode, undefined, model));
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

    if (workflowMode === "email_send_approval") {
      const record = await store.load(runId);
      const draft = record?.meta.draft;
      if (draft) {
        await progressPromise;
        const pending = {
          id: `send_email_from_draft_${runId}`,
          name: "send_email",
          arguments: draft,
        };
        if (record) {
          record.meta.status = "awaiting_approval";
          record.meta.pendingToolCallId = pending.id;
          record.meta.updatedAt = new Date().toISOString();
          record.state = {
            ...(record.state || createInitialState(runId)),
            status: "awaiting_approval",
            updatedAt: Date.now(),
            pendingToolCalls: [pending],
          };
          await store.save(record);
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
    await sendTelegramCompletion(deps, input.originChannelId, `Agent SDK email workflow failed: ${message}`, "failed");
    return {
      handled: true,
      status: "failed",
      runId,
      reply: `Agent SDK email workflow failed: ${message}`,
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
  const model = await resolveAgentSdkModel(input.userText, "internal_reminder");

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
      model,
    },
    state: createInitialState(runId),
  });

  try {
    const result = await callModel(buildRequest(input.userText, tools, stateAccessor, longHorizon, "internal_reminder", undefined, model));
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
    await sendTelegramCompletion(deps, input.originChannelId, `Agent SDK reminder workflow failed: ${message}`, "failed");
    return {
      handled: true,
      status: "failed",
      runId,
      reply: `Agent SDK reminder workflow failed: ${message}`,
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
  const model = await resolveAgentSdkModel("", record.meta.workflow ?? "email_send_approval");

  try {
    const result = await callModel(buildRequest("", tools, stateAccessor, longHorizon, record.meta.workflow ?? "email_send_approval", input.approved
      ? { approveToolCalls: [toolCallId] }
      : { rejectToolCalls: [toolCallId] }, model));
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
  return gate?.agentId === AGENT_SDK_HITL_AGENT_ID
    && (gate.toolArgs?.__jarvisAgentSdkRun === true || gate.toolArgs?.__agentSdkPrototype === true);
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
  const model = await resolveAgentSdkModel([], record.meta.workflow ?? "email_send_approval");
  const now = new Date().toISOString();
  record.meta.status = "running";
  record.meta.resumedAt = now;
  record.meta.updatedAt = now;
  record.meta.maxCostUsd = longHorizon.maxCostUsd;
  record.meta.maxSteps = longHorizon.maxSteps;
  await store.save(record);

  try {
    const chatId = input.originChannelId || record.meta.originChannelId;
    const result = await callModel(buildRequest([], tools, stateAccessor, longHorizon, record.meta.workflow ?? "email_send_approval", undefined, model));
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
