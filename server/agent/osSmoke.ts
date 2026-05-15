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
    .replace(/\s+and\s+(make|create|write|draft|produce)\b.*$/i, "")
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
