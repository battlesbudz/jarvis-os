import { decideAutonomyMode, type AutonomyPolicyDecision, type AutonomyReadiness } from "./autonomyPolicy";
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
}

export interface AutonomyRuntimeResult {
  handled: boolean;
  decision: AutonomyPolicyDecision;
  reply?: string;
  jobId?: string;
  isDuplicate?: boolean;
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

function approvalReply(): string {
  return [
    "I can help with that, but it touches an external action, so I need explicit approval before I do it.",
    "Please confirm the exact action you want me to take, including the recipient, destination, or target if one is involved.",
  ].join(" ");
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
    return { handled: false, decision: preliminary };
  }

  const readiness = input.readiness ?? await (deps.getReadiness ?? defaultReadiness)(input.userId);
  const decision = decideAutonomyMode({
    userText,
    readiness,
    hasApproval,
  });

  if (decision.mode === "answer_inline") {
    return { handled: false, decision };
  }

  if (decision.mode === "blocked_by_setup") {
    return {
      handled: true,
      decision,
      reply: blockedReply(decision.reason),
    };
  }

  if (decision.mode === "requires_approval") {
    return {
      handled: true,
      decision,
      reply: approvalReply(),
    };
  }

  const agentType = (decision.agentType || "research") as AgentJobType;
  const title = deriveAutonomyTitle(userText);
  const submitJob = deps.submitJob ?? defaultSubmitJob;
  const job = await submitJob({
    userId: input.userId,
    agentType,
    title,
    prompt: userText,
    input: {
      originChannel: input.channelName,
      autonomyPolicy: true,
    },
  });

  return {
    handled: true,
    decision,
    reply: queuedReply(agentType, job),
    jobId: job.id,
    isDuplicate: job.isDuplicate,
  };
}
