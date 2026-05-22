import {
  decideAutonomyMode,
  type AutonomyMode,
  type AutonomyPolicyDecision,
  type AutonomyReadiness,
} from "./autonomyPolicy";
import { getCoachAppAgentId } from "./coreAgentIds";
import type { AgentJobType, SubmitJobInput, SubmitJobResult } from "./jobClient";

export interface AutonomyRuntimeInput {
  userId: string;
  userText: string;
  channelName: string;
  readiness?: AutonomyReadiness;
  hasApproval?: boolean;
}

export interface AutonomyRuntimeDeps {
  getReadiness?: (userId: string) => Promise<AutonomyReadiness>;
  submitJob?: (input: SubmitJobInput) => Promise<SubmitJobResult>;
  requestApproval?: (request: TopLevelApprovalRequest) => Promise<{ id: string; status: string }>;
  notifyApproval?: (userId: string, text: string, gateId: string) => Promise<void>;
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

async function defaultNotifyApproval(userId: string, text: string, gateId: string): Promise<void> {
  const { notifyUser } = await import("../channels/registry");
  await notifyUser(userId, "approval_request", text, { gateId });
}

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
    return `I already have that ${agentType} job running, so I did not queue a duplicate. Job ID: ${job.id}.`;
  }

  return `I've queued that as a ${agentType} background job. Job ID: ${job.id}. You'll get the result in the reviewable inbox/deliverable flow when it finishes.`;
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
    let gate: { id: string; status: string } | undefined;
    try {
      gate = await requestApproval({
        agentId: getCoachAppAgentId(input.userId),
        userId: input.userId,
        toolName,
        toolArgs: {
          topLevelAutonomy: true,
          userText,
          channelName: input.channelName,
        },
        description,
        initiatedBy: "user",
      });
      const notificationText = `Approval required\n\n${description}\n\nGate ID: ${gate.id}`;
      await notifyApproval(input.userId, notificationText, gate.id);
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
