import {
  decideAutonomyMode,
  type AutonomyMode,
  type AutonomyPolicyDecision,
  type AutonomyReadiness,
} from "./autonomyPolicy";
import type { ApprovalNotificationPayload } from "./approvalNotifications";
import type { ApprovalGate } from "./agentApproval";
import type { AppCoachChatAutonomyResult } from "./appCoachChatAutonomy";
import { getCoachAppAgentId } from "./coreAgentIds";
import type { AgentJobType, SubmitJobInput, SubmitJobResult } from "./jobClient";

export interface AutonomyRuntimeInput {
  userId: string;
  userText: string;
  channelName: string;
  originChannelId?: string;
  readiness?: AutonomyReadiness;
  hasApproval?: boolean;
}

export interface AutonomyRuntimeDeps {
  getReadiness?: (userId: string) => Promise<AutonomyReadiness>;
  submitJob?: (input: SubmitJobInput) => Promise<SubmitJobResult>;
  requestApproval?: (request: TopLevelApprovalRequest) => Promise<{ id: string; status: string }>;
  notifyApproval?: (payload: ApprovalNotificationPayload) => Promise<void>;
  observeDecision?: (observation: AutonomyRuntimeObservation) => void | Promise<void>;
}

export interface AutonomyRuntimeResult {
  handled: boolean;
  decision: AutonomyPolicyDecision;
  reply?: string;
  jobId?: string;
  gateId?: string;
  isDuplicate?: boolean;
}

export interface TopLevelApprovalRequest {
  agentId: string;
  userId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  initiatedBy: "user" | "jarvis";
}

export interface AutonomyRuntimeObservation {
  mode: AutonomyMode;
  userId: string;
  originChannel: string;
  readinessStatus: AutonomyReadiness | "not_checked";
  readinessReady: boolean;
  agentType?: AgentJobType;
  jobId?: string;
  approvalBoundary?: "top_level_external_action";
  approvalToolName?: string;
  approvalGateId?: string;
  error?: string;
}

const APPROVAL_PHRASES = [
  /\byes\b/i,
  /\bapproved?\b/i,
  /\bconfirmed?\b/i,
  /\bgo ahead\b/i,
  /\bdo it\b/i,
  /\bplease proceed\b/i,
  /\bthat is ok\b/i,
  /\bthat's ok\b/i,
];

export function inferExplicitApproval(text: string): boolean {
  return APPROVAL_PHRASES.some((pattern) => pattern.test(text));
}

export function deriveAutonomyTitle(text: string): string {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/\s+and\s+(make|create|write|draft|produce)\b.*$/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();

  return (normalized || "Autonomous Jarvis task").slice(0, 80);
}

async function defaultReadiness(userId: string): Promise<AutonomyReadiness> {
  try {
    const { getJarvisOsReadiness } = await import("../diagnostics/osReadiness");
    const report = await getJarvisOsReadiness(userId);
    return report.overallStatus;
  } catch (err) {
    console.warn("[autonomyRuntime] readiness check failed; running in limited mode:", err);
    return "limited";
  }
}

async function defaultSubmitJob(input: SubmitJobInput): Promise<SubmitJobResult> {
  const { submitAgentJob } = await import("./jobClient");
  return submitAgentJob(input);
}

async function defaultRequestApproval(request: TopLevelApprovalRequest): Promise<{ id: string; status: string }> {
  const { requestApproval } = await import("./agentApproval");
  const gate = await requestApproval({
    ...request,
    ttlMs: 24 * 60 * 60 * 1000,
  });
  return { id: gate.id, status: gate.status };
}

async function defaultNotifyApproval(payload: ApprovalNotificationPayload): Promise<void> {
  const { notifyApprovalRequest } = await import("./approvalNotifications");
  await notifyApprovalRequest(payload);
}

export type PrimeRuntimeChannel =
  | "appchat"
  | "app"
  | "telegram"
  | "discord"
  | "voice"
  | "daemon"
  | string;

export type PrimeRuntimeKind =
  | "not_handled"
  | "direct_response"
  | "tool_action"
  | "approval_request"
  | "background_job"
  | "delegation"
  | "blocked_setup";

export interface PrimeRuntimeInput {
  userId?: string | null;
  channel: PrimeRuntimeChannel;
  message: string;
  metadata?: {
    messages?: Array<{ role?: string; content?: unknown }>;
    conversationContext?: string;
    originChannelId?: string;
    goals?: unknown;
    stats?: unknown;
    [key: string]: unknown;
  };
}

export interface PrimeRuntimeDecision {
  taskTypeDetected: string;
  routeChosen: string;
  riskLevel: "low" | "medium" | "high";
  approvalRequired: boolean;
  modelRouting: "existing_jarvis" | "codex_oauth_gateway" | "none";
  bypassesPrime: boolean;
  reason: string;
}

export interface PrimeRuntimeResult {
  handled: boolean;
  kind: PrimeRuntimeKind;
  reply?: string;
  toolAction?: {
    tool: string;
    result: "success" | "error" | "queued";
    label?: string;
    detail?: unknown;
  };
  approvalRequest?: {
    gateId: string;
    runId?: string;
    description?: string;
  };
  backgroundJob?: {
    jobId: string;
    agentType?: string;
  };
  delegation?: {
    agentType: string;
    destination?: string;
  };
  blockedSetup?: {
    missing: string;
    reason: string;
  };
  sdkRunId?: string;
  status?: string;
  decision: PrimeRuntimeDecision;
}

export interface PrimeRuntimeApprovalInput {
  gate: ApprovalGate;
  approved: boolean;
  originChannelId?: string;
}

export interface PrimeRuntimeApprovalResult {
  handled: boolean;
  continuation?: unknown;
  decision: PrimeRuntimeDecision;
}

interface AgentSdkRunnerResult {
  handled: boolean;
  status?: string;
  runId?: string;
  gateId?: string;
  reply?: string;
  error?: string;
}

export interface PrimeRuntimeDeps extends AutonomyRuntimeDeps {
  runAgentSdkReminderWorkflow?: (input: {
    userId: string;
    userText: string;
    conversationContext?: string;
    originChannel: string;
    originChannelId?: string;
  }) => Promise<AgentSdkRunnerResult>;
  runAgentSdkEmailWorkflow?: (input: {
    userId: string;
    userText: string;
    conversationContext?: string;
    originChannel: string;
    originChannelId?: string;
  }) => Promise<AgentSdkRunnerResult>;
  handleDirectReminderRequest?: (input: {
    userId: string;
    text: string;
    channel?: string;
  }) => Promise<{
    handled: boolean;
    reply?: string;
    toolResult?: {
      ok: boolean;
      label?: string;
      detail?: unknown;
    };
  }>;
  handleDirectEmailApprovalRequest?: (input: {
    userId: string;
    text: string;
    channel?: string;
  }) => Promise<{
    handled: boolean;
    reply?: string;
    gateId?: string;
  }>;
  routeAppCoachChatAutonomy?: (
    input: { userId?: string | null; messages: Array<{ role?: string; content?: unknown }>; originChannel?: string },
    deps?: Record<string, unknown>,
  ) => Promise<AppCoachChatAutonomyResult>;
  resumeAgentSdkRunFromApprovalGate?: (input: {
    gate: ApprovalGate;
    approved: boolean;
    originChannelId?: string;
  }) => Promise<unknown>;
  isAgentSdkApprovalGate?: (gate: ApprovalGate) => boolean | Promise<boolean>;
  appAutonomyDeps?: Record<string, unknown>;
}

export type JarvisInputChannel = PrimeRuntimeChannel;
export type JarvisCoreRuntimeKind = PrimeRuntimeKind;
export type JarvisCoreRuntimeInput = PrimeRuntimeInput;
export type JarvisCoreRuntimeDecision = PrimeRuntimeDecision & { bypassesLegacyPrime?: boolean };
export type JarvisCoreRuntimeResult = PrimeRuntimeResult;
export type JarvisCoreRuntimeApprovalInput = PrimeRuntimeApprovalInput;
export type JarvisCoreRuntimeApprovalResult = PrimeRuntimeApprovalResult;
export type JarvisCoreRuntimeDeps = PrimeRuntimeDeps;

async function observeAutonomyDecision(
  deps: AutonomyRuntimeDeps,
  observation: AutonomyRuntimeObservation,
): Promise<void> {
  const observer = deps.observeDecision ?? defaultObserveDecision;

  try {
    await observer(observation);
  } catch (err) {
    console.warn("[autonomyRuntime] observability callback failed:", err);
  }
}

function defaultObserveDecision(observation: AutonomyRuntimeObservation): void {
  if (process.env.NODE_ENV !== "production") return;
  console.info("[autonomyRuntime] autonomy decision", observation);
}

function observationError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function inferApprovalToolName(text: string): string {
  if (/\bemail\b|\bgmail\b/i.test(text)) return "send_email";
  if (/\bpost\b|\bdiscord\b|\bslack\b|\btelegram\b/i.test(text)) return "discord_post";
  if (/\bschedule\b|\bcalendar\b|\bmeeting\b|\bevent\b/i.test(text)) return "schedule_jarvis_task";
  if (/\bdeploy\b/i.test(text)) return "deploy";
  if (/\bdelete\b|\bremove\b/i.test(text)) return "delete";
  if (/\bcommit\b|\bpush\b|\bmerge\b/i.test(text)) return "code_change";
  if (/\bpurchase\b|\bbuy\b|\border\b/i.test(text)) return "purchase";
  if (/\bcontact\b|\bmessage\b|\bsend\b/i.test(text)) return "external_message";
  return "top_level_external_action";
}

function approvalDescription(userText: string, channelName: string): string {
  return `Top-level Jarvis chat request from ${channelName} needs approval before taking an external action: "${userText}"`;
}

function approvalReply(gateId: string): string {
  return `I created an approval request for that action. Review it in Jarvis approvals/inbox before I proceed. Gate ID: ${gateId}.`;
}

function blockedReply(reason: string): string {
  return `Jarvis OS setup is not ready for autonomous work yet: ${reason} Run npm run jarvis:doctor and fix the listed blocker first.`;
}

function queuedReply(agentType: AgentJobType, job: SubmitJobResult): string {
  if (job.isDuplicate) {
    return `I already have that ${agentType} job running, so I did not queue a duplicate. Job ID: ${job.id}. Open Inbox to watch it under Running Jobs; when it finishes, the result appears under Needs your review.`;
  }

  return `I've queued that as a ${agentType} background job. Job ID: ${job.id}. Open Inbox to watch it under Running Jobs; when it finishes, the result appears under Needs your review as a Jarvis deliverable. Approving it saves it to Documents, and Save to Drive creates a Drive file when available.`;
}

export async function routeAutonomyRequest(
  input: AutonomyRuntimeInput,
  deps: AutonomyRuntimeDeps = {},
): Promise<AutonomyRuntimeResult> {
  const userText = input.userText.trim();
  const hasApproval = input.hasApproval ?? inferExplicitApproval(userText);
  const preliminary = decideAutonomyMode({
    userText,
    readiness: "ready",
    hasApproval,
  });

  if (!userText || preliminary.mode === "answer_inline") {
    await observeAutonomyDecision(deps, {
      mode: preliminary.mode,
      userId: input.userId,
      originChannel: input.channelName,
      readinessStatus: "not_checked",
      readinessReady: false,
    });
    return { handled: false, decision: preliminary };
  }

  const readiness = input.readiness ?? await (deps.getReadiness ?? defaultReadiness)(input.userId);
  const decision = decideAutonomyMode({
    userText,
    readiness,
    hasApproval,
  });

  if (decision.mode === "answer_inline") {
    await observeAutonomyDecision(deps, {
      mode: decision.mode,
      userId: input.userId,
      originChannel: input.channelName,
      readinessStatus: readiness,
      readinessReady: readiness === "ready",
    });
    return { handled: false, decision };
  }

  if (decision.mode === "blocked_by_setup") {
    await observeAutonomyDecision(deps, {
      mode: decision.mode,
      userId: input.userId,
      originChannel: input.channelName,
      readinessStatus: readiness,
      readinessReady: readiness === "ready",
    });
    return {
      handled: true,
      decision,
      reply: blockedReply(decision.reason),
    };
  }

  if (decision.mode === "requires_approval") {
    const toolName = inferApprovalToolName(userText);
    const description = approvalDescription(userText, input.channelName);
    const requestApproval = deps.requestApproval ?? defaultRequestApproval;
    const notifyApproval = deps.notifyApproval ?? defaultNotifyApproval;
    const agentId = getCoachAppAgentId(input.userId);
    let gate: { id: string; status: string } | undefined;
    try {
      gate = await requestApproval({
        agentId,
        userId: input.userId,
        toolName,
        toolArgs: {
          topLevelAutonomy: true,
          userText,
          channelName: input.channelName,
          ...(input.originChannelId ? { originChannelId: input.originChannelId } : {}),
        },
        description,
        initiatedBy: "user",
      });
      await notifyApproval({
        gateId: gate.id,
        agentId,
        agentName: "Jarvis App Coach",
        userId: input.userId,
        toolName,
        description,
        originChannel: input.channelName,
        originChannelId: input.originChannelId,
      });
    } catch (err) {
      await observeAutonomyDecision(deps, {
        mode: decision.mode,
        userId: input.userId,
        originChannel: input.channelName,
        readinessStatus: readiness,
        readinessReady: readiness === "ready",
        approvalBoundary: "top_level_external_action",
        approvalToolName: toolName,
        approvalGateId: gate?.id,
        error: observationError(err),
      });
      throw err;
    }
    await observeAutonomyDecision(deps, {
      mode: decision.mode,
      userId: input.userId,
      originChannel: input.channelName,
      readinessStatus: readiness,
      readinessReady: readiness === "ready",
      approvalBoundary: "top_level_external_action",
      approvalToolName: toolName,
      approvalGateId: gate.id,
    });

    return {
      handled: true,
      decision,
      reply: approvalReply(gate.id),
      gateId: gate.id,
    };
  }

  const agentType = (decision.agentType || "research") as AgentJobType;
  const title = deriveAutonomyTitle(userText);
  const submitJob = deps.submitJob ?? defaultSubmitJob;
  let job: SubmitJobResult;
  try {
    job = await submitJob({
      userId: input.userId,
      agentType,
      title,
      prompt: userText,
      input: {
        originChannel: input.channelName,
        ...(input.originChannelId ? { originChannelId: input.originChannelId } : {}),
        autonomyPolicy: true,
      },
    });
  } catch (err) {
    await observeAutonomyDecision(deps, {
      mode: decision.mode,
      userId: input.userId,
      originChannel: input.channelName,
      readinessStatus: readiness,
      readinessReady: readiness === "ready",
      agentType,
      error: observationError(err),
    });
    throw err;
  }
  await observeAutonomyDecision(deps, {
    mode: decision.mode,
    userId: input.userId,
    originChannel: input.channelName,
    readinessStatus: readiness,
    readinessReady: readiness === "ready",
    agentType,
    jobId: job.id,
  });

  return {
    handled: true,
    decision,
    reply: queuedReply(agentType, job),
    jobId: job.id,
    isDuplicate: job.isDuplicate,
  };
}

export function isPrimeRuntimeEnabled(env = process.env): boolean {
  return String(env.ENABLE_PRIME_RUNTIME || env.ENABLE_JARVIS_CORE_RUNTIME || "").toLowerCase() === "true";
}

export const isJarvisCoreRuntimeEnabled = isPrimeRuntimeEnabled;

function primeDecision(patch: Partial<PrimeRuntimeDecision>): PrimeRuntimeDecision {
  return {
    taskTypeDetected: patch.taskTypeDetected ?? "unknown",
    routeChosen: patch.routeChosen ?? "legacy",
    riskLevel: patch.riskLevel ?? "low",
    approvalRequired: patch.approvalRequired ?? false,
    modelRouting: patch.modelRouting ?? "none",
    bypassesPrime: patch.bypassesPrime ?? false,
    reason: patch.reason ?? "No PRIME runtime route selected.",
  };
}

function latestPrimeMessages(input: PrimeRuntimeInput): Array<{ role?: string; content?: unknown }> {
  if (Array.isArray(input.metadata?.messages)) return input.metadata.messages;
  return [{ role: "user", content: input.message }];
}

function recentPrimeConversationContext(messages: Array<{ role?: string; content?: unknown }>): string {
  return messages
    .slice(-8)
    .map((message) => `${message.role || "message"}: ${String(message.content || "").slice(0, 2000)}`)
    .join("\n");
}

async function defaultRunAgentSdkReminderWorkflow(input: Parameters<NonNullable<PrimeRuntimeDeps["runAgentSdkReminderWorkflow"]>>[0]) {
  const { runAgentSdkReminderWorkflow } = await import("../../src/agent/agentRunner");
  return runAgentSdkReminderWorkflow(input);
}

async function defaultRunAgentSdkEmailWorkflow(input: Parameters<NonNullable<PrimeRuntimeDeps["runAgentSdkEmailWorkflow"]>>[0]) {
  const { runAgentSdkEmailWorkflow } = await import("../../src/agent/agentRunner");
  return runAgentSdkEmailWorkflow(input);
}

async function defaultHandleDirectReminderRequest(input: Parameters<NonNullable<PrimeRuntimeDeps["handleDirectReminderRequest"]>>[0]) {
  const { handleDirectReminderRequest } = await import("./reminderDirectRoute");
  return handleDirectReminderRequest(input);
}

async function defaultHandleDirectEmailApprovalRequest(input: Parameters<NonNullable<PrimeRuntimeDeps["handleDirectEmailApprovalRequest"]>>[0]) {
  const { handleDirectEmailApprovalRequest } = await import("./directEmailApprovalRoute");
  return handleDirectEmailApprovalRequest(input);
}

async function defaultRouteAppCoachChatAutonomy(
  input: Parameters<NonNullable<PrimeRuntimeDeps["routeAppCoachChatAutonomy"]>>[0],
  deps?: Record<string, unknown>,
) {
  const { routeAppCoachChatAutonomy } = await import("./appCoachChatAutonomy");
  return routeAppCoachChatAutonomy(input, deps as any);
}

async function defaultResumeAgentSdkRunFromApprovalGate(
  input: Parameters<NonNullable<PrimeRuntimeDeps["resumeAgentSdkRunFromApprovalGate"]>>[0],
) {
  const { resumeAgentSdkRunFromApprovalGate } = await import("../../src/agent/agentRunner");
  return resumeAgentSdkRunFromApprovalGate(input);
}

async function defaultIsAgentSdkApprovalGate(gate: ApprovalGate): Promise<boolean> {
  const { isAgentSdkApprovalGate } = await import("../../src/agent/agentRunner");
  return isAgentSdkApprovalGate(gate);
}

function sdkResultToPrime(
  result: AgentSdkRunnerResult,
  routeChosen: string,
  taskTypeDetected: string,
): PrimeRuntimeResult {
  const awaitingApproval = result.status === "awaiting_approval";
  const failedSetup = result.status === "failed" && /provider|configured/i.test(result.error || result.reply || "");
  return {
    handled: true,
    kind: failedSetup ? "blocked_setup" : awaitingApproval ? "approval_request" : "direct_response",
    reply: result.reply,
    sdkRunId: result.runId,
    status: result.status,
    approvalRequest: awaitingApproval && result.gateId
      ? { gateId: result.gateId, runId: result.runId }
      : undefined,
    blockedSetup: failedSetup
      ? { missing: "agent_sdk_model_provider", reason: result.error || result.reply || "Agent SDK model provider is not configured." }
      : undefined,
    decision: primeDecision({
      taskTypeDetected,
      routeChosen,
      riskLevel: awaitingApproval ? "high" : "medium",
      approvalRequired: awaitingApproval,
      modelRouting: "codex_oauth_gateway",
      reason: "Feature-flagged PRIME runtime routed this explicit workflow through the Jarvis Agent SDK worker using the Codex OAuth gateway.",
    }),
  };
}

function isAgentSdkSetupFailure(result: AgentSdkRunnerResult): boolean {
  return result.handled === true
    && result.status === "failed"
    && /provider|configured/i.test(result.error || result.reply || "");
}

export async function handlePrimeInput(
  input: PrimeRuntimeInput,
  deps: PrimeRuntimeDeps = {},
): Promise<PrimeRuntimeResult> {
  if (!isPrimeRuntimeEnabled()) {
    return {
      handled: false,
      kind: "not_handled",
      decision: primeDecision({
        reason: "ENABLE_PRIME_RUNTIME/ENABLE_JARVIS_CORE_RUNTIME is not true; existing channel behavior remains active.",
      }),
    };
  }

  const userId = input.userId?.trim();
  const message = input.message.trim();
  const channel = input.channel.trim().toLowerCase() || "unknown";
  if (!userId || !message) {
    return {
      handled: false,
      kind: "not_handled",
      decision: primeDecision({
        reason: "PRIME runtime requires an authenticated user and a non-empty message.",
      }),
    };
  }

  const messages = latestPrimeMessages(input);
  const context = input.metadata?.conversationContext || recentPrimeConversationContext(messages);
  const originChannelId = typeof input.metadata?.originChannelId === "string" ? input.metadata.originChannelId : undefined;

  const runReminder = deps.runAgentSdkReminderWorkflow ?? defaultRunAgentSdkReminderWorkflow;
  const reminderSdk = await runReminder({
    userId,
    userText: message,
    conversationContext: context,
    originChannel: channel,
    originChannelId,
  });
  if (reminderSdk.handled) {
    return sdkResultToPrime(reminderSdk, "jarvis_agent_sdk_reminder", "reminder");
  }

  const runEmail = deps.runAgentSdkEmailWorkflow ?? defaultRunAgentSdkEmailWorkflow;
  const emailSdk = await runEmail({
    userId,
    userText: message,
    conversationContext: context,
    originChannel: channel,
    originChannelId,
  });
  if (emailSdk.handled && !isAgentSdkSetupFailure(emailSdk)) {
    return sdkResultToPrime(emailSdk, "jarvis_agent_sdk_email", "email");
  }

  const directEmailApproval = await (deps.handleDirectEmailApprovalRequest ?? defaultHandleDirectEmailApprovalRequest)({
    userId,
    text: message,
    channel,
  });
  if (directEmailApproval.handled) {
    return {
      handled: true,
      kind: "approval_request",
      reply: directEmailApproval.reply,
      approvalRequest: directEmailApproval.gateId ? { gateId: directEmailApproval.gateId } : undefined,
      status: "awaiting_approval",
      decision: primeDecision({
        taskTypeDetected: "email",
        routeChosen: "direct_email_approval_gate",
        riskLevel: "high",
        approvalRequired: true,
        modelRouting: "none",
        reason: "PRIME runtime routed an explicit email send request to a deterministic approval gate before sending.",
      }),
    };
  }

  const directReminder = await (deps.handleDirectReminderRequest ?? defaultHandleDirectReminderRequest)({
    userId,
    text: message,
    channel,
  });
  if (directReminder.handled) {
    return {
      handled: true,
      kind: "tool_action",
      reply: directReminder.reply,
      toolAction: directReminder.toolResult
        ? {
            tool: "schedule_jarvis_task",
            result: directReminder.toolResult.ok ? "success" : "error",
            label: directReminder.toolResult.label,
            detail: directReminder.toolResult.detail,
          }
        : undefined,
      decision: primeDecision({
        taskTypeDetected: "reminder",
        routeChosen: "direct_reminder_tool",
        riskLevel: "medium",
        approvalRequired: false,
        modelRouting: "none",
        reason: "PRIME runtime routed clear natural-language reminder text to the existing scheduled-task tool.",
      }),
    };
  }

  if (channel === "appchat" || channel === "app" || channel === "app_chat") {
    const autonomy = await (deps.routeAppCoachChatAutonomy ?? defaultRouteAppCoachChatAutonomy)(
      { userId, messages, originChannel: channel },
      deps.appAutonomyDeps,
    );
    if (autonomy.handled && autonomy.reply) {
      return {
        handled: true,
        kind: autonomy.jobId ? "background_job" : "direct_response",
        reply: autonomy.reply,
        backgroundJob: autonomy.jobId
          ? { jobId: autonomy.jobId, agentType: autonomy.decision.agentType }
          : undefined,
        decision: primeDecision({
          taskTypeDetected: autonomy.decision.agentType || "app_chat",
          routeChosen: "existing_app_chat_autonomy",
          riskLevel: autonomy.jobId ? "medium" : "low",
          approvalRequired: false,
          modelRouting: "existing_jarvis",
          reason: autonomy.decision.reason || "PRIME runtime delegated app chat to the existing app autonomy route.",
        }),
      };
    }
  }

  return {
    handled: false,
    kind: "not_handled",
    decision: primeDecision({
      routeChosen: "legacy_fallback",
      modelRouting: "existing_jarvis",
      reason: "No PRIME runtime proof route matched; caller should continue through the existing channel path.",
    }),
  };
}

export const handleJarvisInput = handlePrimeInput;

export async function handlePrimeApprovalDecision(
  input: PrimeRuntimeApprovalInput,
  deps: PrimeRuntimeDeps = {},
): Promise<PrimeRuntimeApprovalResult> {
  if (!isPrimeRuntimeEnabled()) {
    return {
      handled: false,
      decision: primeDecision({
        routeChosen: "legacy_approval_resume",
        reason: "ENABLE_PRIME_RUNTIME/ENABLE_JARVIS_CORE_RUNTIME is not true; existing approval resume remains active.",
      }),
    };
  }

  const isSdkGate = await (deps.isAgentSdkApprovalGate ?? defaultIsAgentSdkApprovalGate)(input.gate);
  if (!isSdkGate) {
    return {
      handled: false,
      decision: primeDecision({
        routeChosen: "legacy_approval_resume",
        reason: "Approval gate is not owned by the Jarvis Agent SDK worker.",
      }),
    };
  }

  const continuation = await (deps.resumeAgentSdkRunFromApprovalGate ?? defaultResumeAgentSdkRunFromApprovalGate)({
    gate: input.gate,
    approved: input.approved,
    originChannelId: input.originChannelId,
  });

  return {
    handled: true,
    continuation,
    decision: primeDecision({
      taskTypeDetected: "approval_resume",
      routeChosen: "jarvis_agent_sdk_approval_resume",
      riskLevel: "high",
      approvalRequired: true,
      modelRouting: "codex_oauth_gateway",
      reason: "PRIME runtime resumed an Agent SDK run from the canonical Jarvis approval gate.",
    }),
  };
}

export const handleJarvisApprovalDecision = handlePrimeApprovalDecision;
