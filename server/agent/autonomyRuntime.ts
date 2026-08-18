import {
  decideAutonomyMode,
  type AutonomyMode,
  type AutonomyPolicyDecision,
  type AutonomyReadiness,
} from "./autonomyPolicy";
import type { ApprovalNotificationPayload } from "./approvalNotifications";
import type { ApprovalGate } from "./agentApproval";
import type { AppCoachChatAutonomyResult } from "./appCoachChatAutonomy";
import { decideContextPacks, type ContextPackDecision, type ContextTaskType } from "./contextPacks";
import { getCoachAppAgentId } from "./coreAgentIds";
import type { AgentJobType, SubmitJobInput, SubmitJobResult } from "./jobClient";
import { buildMindTrace, type JarvisMindTrace, type MindTraceToolInput } from "./mindTrace";
import { requestsReportFile, unsupportedReportFileFormat } from "./backgroundJobHandoff";

export interface AutonomyRuntimeInput {
  userId: string;
  userText: string;
  /** Self-contained worker prompt when the latest turn depends on chat history. */
  backgroundPrompt?: string;
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

export interface PrimeRuntimeMindTraceObservation {
  input: PrimeRuntimeInput;
  result: PrimeRuntimeResult;
  trace: JarvisMindTrace;
  durationMs: number;
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
  observePrimeDecision?: (observation: PrimeRuntimeMindTraceObservation) => void | Promise<void>;
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

function contextualWorkerRoutingText(backgroundPrompt: string, userText: string): string {
  const latestMarker = backgroundPrompt.lastIndexOf("Latest user request:");
  const context = latestMarker >= 0
    ? backgroundPrompt.slice(0, latestMarker)
    : backgroundPrompt;
  const priorUserTurns = Array.from(context.matchAll(/^User:\s*(.+)$/gim))
    .map((match) => match[1].trim())
    .filter(Boolean);
  for (let index = priorUserTurns.length - 1; index >= 0; index -= 1) {
    const candidate = priorUserTurns[index];
    const decision = decideAutonomyMode({
      userText: candidate,
      readiness: "ready",
      hasApproval: true,
    });
    if (decision.mode === "queue_background_job") {
      return `${candidate}\n${userText}`;
    }
  }
  return userText;
}

export async function routeAutonomyRequest(
  input: AutonomyRuntimeInput,
  deps: AutonomyRuntimeDeps = {},
): Promise<AutonomyRuntimeResult> {
  const userText = input.userText.trim();
  const backgroundPrompt = input.backgroundPrompt?.trim();
  const unsupportedFormat = unsupportedReportFileFormat(backgroundPrompt || userText);
  if (unsupportedFormat) {
    const decision: AutonomyPolicyDecision = {
      mode: "answer_inline",
      reason: `The requested ${unsupportedFormat} format is not supported by the background report renderer.`,
    };
    return {
      handled: true,
      decision,
      reply: `I can’t generate ${unsupportedFormat} from this background report flow yet. I can create a downloadable PDF or keep the result as Markdown instead.`,
    };
  }
  // A short referential turn such as "Make it a PDF" may classify inline by
  // itself. Use the bounded handoff only for routing when it establishes an
  // explicit file request; keep the original turn for titles and approvals.
  const durableReportRequested = requestsReportFile(backgroundPrompt || userText);
  const routingText = backgroundPrompt && durableReportRequested
    ? contextualWorkerRoutingText(backgroundPrompt, userText)
    : userText;
  const hasApproval = input.hasApproval ?? inferExplicitApproval(userText);
  // Approval risk belongs exclusively to the current user turn. Bounded
  // conversation context may contain stale external-action language, so use it
  // only to recover the background worker and self-contained prompt.
  const latestPreliminary = decideAutonomyMode({
    userText,
    readiness: "ready",
    hasApproval,
  });
  const preliminary = latestPreliminary.mode === "requires_approval"
    ? latestPreliminary
    : decideAutonomyMode({
        userText: routingText,
        readiness: "ready",
        hasApproval: true,
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
  const latestPolicyDecision = decideAutonomyMode({
    userText,
    readiness,
    hasApproval,
  });
  const emailFileDeliveryRequested = durableReportRequested && (
    /\b(?:email|send)\b[^.!?\n]{0,80}\b[\w.+-]+@[\w.-]+\b/i.test(userText)
    || /\b(?:send|email)\b[^.!?\n]{0,120}\b(?:via|by)\s+email\b/i.test(userText)
  );
  if (emailFileDeliveryRequested) {
    const decision: AutonomyPolicyDecision = {
      mode: "answer_inline",
      reason: "The email approval workflow cannot attach generated report files safely.",
    };
    return {
      handled: true,
      decision,
      reply: "I can create the PDF for download, or draft the email text, but I can’t attach and send a generated PDF through this approval flow yet. Please choose one of those options.",
    };
  }
  const policyDecision = latestPolicyDecision.mode === "requires_approval"
    ? latestPolicyDecision
    : decideAutonomyMode({
        userText: routingText,
        readiness,
        hasApproval: true,
      });
  // Only deep_research persists generated files in deliverableArtifacts. Any
  // explicit report-file request must use that durable path, even when its
  // subject would otherwise classify as ordinary research.
  const decision: AutonomyPolicyDecision = (
    policyDecision.mode === "queue_background_job"
    && durableReportRequested
    && (policyDecision.agentType === "research" || policyDecision.agentType === "deep_research")
  )
    ? { ...policyDecision, agentType: "deep_research" }
    : policyDecision;

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
          ...(backgroundPrompt ? { backgroundPrompt } : {}),
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
  const workerPrompt = backgroundPrompt || userText;
  const submitJob = deps.submitJob ?? defaultSubmitJob;
  let job: SubmitJobResult;
  try {
    job = await submitJob({
      userId: input.userId,
      agentType,
      title,
      prompt: workerPrompt,
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

function mapPrimeTaskType(taskType: string, fallback: ContextTaskType): ContextTaskType {
  if (taskType === "email") return "email_action";
  if (taskType === "reminder") return "calendar_action";
  if (taskType === "approval_resume") return "general";
  if (taskType === "app_chat") return fallback;
  return fallback;
}

function primeTraceDecision(input: PrimeRuntimeInput, result: PrimeRuntimeResult): ContextPackDecision {
  const base = decideContextPacks({
    userMessage: input.message,
    channel: input.channel,
  });
  return {
    ...base,
    taskType: mapPrimeTaskType(result.decision.taskTypeDetected, base.taskType),
    route: result.decision.routeChosen,
    riskLevel: result.decision.riskLevel,
    approvalRequired: result.decision.approvalRequired,
    reasons: [
      ...base.reasons,
      `PRIME runtime decision: ${result.decision.reason}`,
    ],
  };
}

function primeTraceTools(result: PrimeRuntimeResult): MindTraceToolInput[] {
  const tools: MindTraceToolInput[] = [];
  if (result.toolAction) {
    tools.push({
      name: result.toolAction.tool,
      status: result.toolAction.result === "success" ? "ok" : result.toolAction.result === "queued" ? "skipped" : "failed",
      result: result.toolAction,
      approvalRequired: result.decision.approvalRequired,
    });
  }
  if (result.approvalRequest) {
    tools.push({
      name: "prime_approval_request",
      status: "blocked",
      result: result.approvalRequest,
      approvalRequired: true,
    });
  }
  if (result.backgroundJob) {
    tools.push({
      name: "submit_agent_job",
      status: "ok",
      result: result.backgroundJob,
      approvalRequired: false,
    });
  }
  return tools;
}

export function buildPrimeRuntimeMindTrace(
  input: PrimeRuntimeInput,
  result: PrimeRuntimeResult,
  now = new Date(),
): JarvisMindTrace {
  return buildMindTrace({
    traceId: `prime-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId ?? undefined,
    userRequest: input.message,
    channel: input.channel,
    contextDecision: primeTraceDecision(input, result),
    contextLoaded: ["prime_runtime"],
    toolsCalled: primeTraceTools(result),
    approvalRequired: result.decision.approvalRequired,
    approvalGateId: result.approvalRequest?.gateId ?? null,
    jobCreated: result.backgroundJob
      ? {
          id: result.backgroundJob.jobId,
          type: result.backgroundJob.agentType,
          status: "queued",
          title: result.decision.taskTypeDetected,
        }
      : null,
    confidenceNotes: [
      `PRIME kind=${result.kind}; handled=${String(result.handled)}; modelRouting=${result.decision.modelRouting}.`,
    ],
    uncertaintyNotes: result.handled ? [] : ["PRIME did not handle this request; legacy channel path remains owner."],
    blockedSetupIssues: result.blockedSetup ? [result.blockedSetup.reason] : [],
    errors: result.status === "failed" ? [result.reply ?? "PRIME runtime failed."] : [],
    now,
  });
}

function primeTraceRecord(
  trace: JarvisMindTrace,
  input: PrimeRuntimeInput,
  result: PrimeRuntimeResult,
  durationMs: number,
) {
  return {
    traceId: trace.traceId,
    userId: input.userId ?? "",
    userRequest: input.message.slice(0, 1000),
    subtasks: [
      {
        type: "prime_runtime_decision",
        channel: input.channel,
        kind: result.kind,
        route: result.decision.routeChosen,
        taskType: result.decision.taskTypeDetected,
        riskLevel: result.decision.riskLevel,
        handled: result.handled,
      },
    ],
    results: [
      {
        type: "mind_trace",
        trace,
      },
      {
        type: "prime_runtime_result",
        handled: result.handled,
        kind: result.kind,
        status: result.status,
        route: result.decision.routeChosen,
      },
    ],
    finalAnswer: (result.reply ?? "").slice(0, 2000),
    totalRetries: 0,
    completedAt: new Date(),
    durationMs,
  };
}

async function defaultObservePrimeDecision(observation: PrimeRuntimeMindTraceObservation): Promise<void> {
  if (!process.env.DATABASE_URL || !observation.input.userId) return;

  const [{ db }, schema] = await Promise.all([
    import("../db"),
    import("@shared/schema"),
  ]);
  await db.insert(schema.orchestrationTraces).values(
    primeTraceRecord(
      observation.trace,
      observation.input,
      observation.result,
      observation.durationMs,
    ),
  );
}

async function observePrimeRuntimeDecision(
  deps: PrimeRuntimeDeps,
  input: PrimeRuntimeInput,
  result: PrimeRuntimeResult,
  startedAt: number,
): Promise<void> {
  const trace = buildPrimeRuntimeMindTrace(input, result);
  const observer = deps.observePrimeDecision ?? defaultObservePrimeDecision;
  try {
    await observer({
      input,
      result,
      trace,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.warn("[autonomyRuntime] PRIME mind trace capture failed:", err);
  }
}

export async function handlePrimeInput(
  input: PrimeRuntimeInput,
  deps: PrimeRuntimeDeps = {},
): Promise<PrimeRuntimeResult> {
  const startedAt = Date.now();
  const finish = async (result: PrimeRuntimeResult): Promise<PrimeRuntimeResult> => {
    await observePrimeRuntimeDecision(deps, input, result, startedAt);
    return result;
  };

  if (!isPrimeRuntimeEnabled()) {
    return finish({
      handled: false,
      kind: "not_handled",
      decision: primeDecision({
        reason: "ENABLE_PRIME_RUNTIME/ENABLE_JARVIS_CORE_RUNTIME is not true; existing channel behavior remains active.",
      }),
    });
  }

  const userId = input.userId?.trim();
  const message = input.message.trim();
  const channel = input.channel.trim().toLowerCase() || "unknown";
  if (!userId || !message) {
    return finish({
      handled: false,
      kind: "not_handled",
      decision: primeDecision({
        reason: "PRIME runtime requires an authenticated user and a non-empty message.",
      }),
    });
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
    return finish(sdkResultToPrime(reminderSdk, "jarvis_agent_sdk_reminder", "reminder"));
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
    return finish(sdkResultToPrime(emailSdk, "jarvis_agent_sdk_email", "email"));
  }

  const directEmailApproval = await (deps.handleDirectEmailApprovalRequest ?? defaultHandleDirectEmailApprovalRequest)({
    userId,
    text: message,
    channel,
  });
  if (directEmailApproval.handled) {
    return finish({
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
    });
  }

  const directReminder = await (deps.handleDirectReminderRequest ?? defaultHandleDirectReminderRequest)({
    userId,
    text: message,
    channel,
  });
  if (directReminder.handled) {
    return finish({
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
    });
  }

  if (channel === "appchat" || channel === "app" || channel === "app_chat") {
    const autonomy = await (deps.routeAppCoachChatAutonomy ?? defaultRouteAppCoachChatAutonomy)(
      { userId, messages, originChannel: channel },
      deps.appAutonomyDeps,
    );
    if (autonomy.handled && autonomy.reply) {
      return finish({
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
      });
    }
  }

  return finish({
    handled: false,
    kind: "not_handled",
    decision: primeDecision({
      routeChosen: "legacy_fallback",
      modelRouting: "existing_jarvis",
      reason: "No PRIME runtime proof route matched; caller should continue through the existing channel path.",
    }),
  });
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
