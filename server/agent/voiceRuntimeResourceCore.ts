export const RESOURCE_PAUSED_STATUS = "resource_paused";
export const RESOURCE_PAUSE_REASON = "voice_active_local_runtime";
export const RESOURCE_PAUSE_STARTUP_RECOVERY_MS = 2 * 60 * 60 * 1000;

export type AgentJobCancellationStatus = "cancelled" | "cancelling";

export function cancellationStatusForAgentJobStatus(status: string): AgentJobCancellationStatus | null {
  if (status === "queued" || status === RESOURCE_PAUSED_STATUS) return "cancelled";
  if (status === "running") return "cancelling";
  return null;
}

export interface VoiceResourcePauseMetadata {
  reason: typeof RESOURCE_PAUSE_REASON;
  pausedBy: "voice_runtime";
  pausedAt: string;
  resumedAt?: string;
}

export interface VoiceRuntimeIncidentBundle {
  id: string;
  userId: string;
  reason: "unexpected_voice_session_end";
  recordedAt: string;
  lastState?: string;
  lastAction?: string;
  transcriptPreview?: string;
  activeTaskTitle?: string;
}

export interface VoiceRuntimeJobSummary {
  id: string;
  title: string;
  status: string;
}

export interface VoiceRuntimeStatusSnapshot {
  voiceActive: boolean;
  voiceState?: string;
  activeJobs: VoiceRuntimeJobSummary[];
  resourcePausedJobs: VoiceRuntimeJobSummary[];
  incident?: VoiceRuntimeIncidentBundle | null;
}

export interface VoiceRuntimeJobLike {
  agentType: string;
  input: unknown;
  status?: string;
}

const LOCAL_HEAVY_AGENT_TYPES = new Set([
  "app_project",
  "build_feature",
  "project_session",
]);

export function recordFromInput(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isLocalHeavyBackgroundJob(job: VoiceRuntimeJobLike): boolean {
  const input = recordFromInput(job.input);
  if (input.localHeavy === true) return true;
  if (input.usesLocalResources === true) return true;
  if (stringValue(input.resourceProfile) === "local_heavy") return true;
  const resource = recordFromInput(input.resource);
  if (resource.localHeavy === true) return true;
  return LOCAL_HEAVY_AGENT_TYPES.has(job.agentType);
}

export function resourcePauseMetadata(input: unknown): VoiceResourcePauseMetadata | null {
  const pause = recordFromInput(input).resourcePause;
  if (!pause || typeof pause !== "object" || Array.isArray(pause)) return null;
  const candidate = pause as Partial<VoiceResourcePauseMetadata>;
  return candidate.reason === RESOURCE_PAUSE_REASON && candidate.pausedBy === "voice_runtime"
    ? candidate as VoiceResourcePauseMetadata
    : null;
}

export function shouldAutoResumeResourcePausedJob(job: Pick<VoiceRuntimeJobLike, "status" | "input">): boolean {
  return job.status === RESOURCE_PAUSED_STATUS && !!resourcePauseMetadata(job.input);
}

export function shouldRecoverStaleResourcePausedJob(
  job: Pick<VoiceRuntimeJobLike, "status" | "input">,
  now: Date = new Date(),
): boolean {
  const pause = resourcePauseMetadata(job.input);
  if (job.status !== RESOURCE_PAUSED_STATUS || !pause) return false;
  const pausedAtMs = Date.parse(pause.pausedAt);
  if (!Number.isFinite(pausedAtMs)) return false;
  return now.getTime() - pausedAtMs >= RESOURCE_PAUSE_STARTUP_RECOVERY_MS;
}

export function buildVoiceRuntimeStatusAnswer(snapshot: VoiceRuntimeStatusSnapshot): string {
  const parts: string[] = [];
  if (snapshot.voiceActive) {
    parts.push(`I am in a local voice session${snapshot.voiceState ? ` (${snapshot.voiceState})` : ""}.`);
  } else {
    parts.push("No local voice session is active.");
  }

  if (snapshot.resourcePausedJobs.length > 0) {
    const titles = snapshot.resourcePausedJobs.map((job) => job.title).join(", ");
    parts.push(`Paused for call stability: ${titles}.`);
  }

  if (snapshot.activeJobs.length > 0) {
    const titles = snapshot.activeJobs.map((job) => `${job.title} (${job.status})`).join(", ");
    parts.push(`Background work: ${titles}.`);
  }

  if (snapshot.incident) {
    parts.push("A previous voice session ended unexpectedly, and I have a restore prompt waiting.");
  }

  return parts.join(" ");
}

export function buildVoiceRuntimeIncidentBundle(input: {
  userId: string;
  now?: Date;
  lastState?: string;
  lastAction?: string;
  transcript?: string;
  activeTaskTitle?: string;
}): VoiceRuntimeIncidentBundle {
  const recordedAt = (input.now ?? new Date()).toISOString();
  return {
    id: `voice-incident-${recordedAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
    userId: input.userId,
    reason: "unexpected_voice_session_end",
    recordedAt,
    lastState: stringValue(input.lastState) || undefined,
    lastAction: stringValue(input.lastAction) || undefined,
    transcriptPreview: stringValue(input.transcript).slice(0, 500) || undefined,
    activeTaskTitle: stringValue(input.activeTaskTitle) || undefined,
  };
}

export function buildVoiceRestorePrompt(bundle: VoiceRuntimeIncidentBundle): string {
  const context = bundle.activeTaskTitle
    ? ` while we were working on ${bundle.activeTaskTitle}`
    : "";
  return `The voice session ended unexpectedly${context}. Do you want me to restore the conversation context before we continue?`;
}

export function buildVoiceRestoreRecap(bundle: VoiceRuntimeIncidentBundle): string {
  const lines = ["Here is the context I can safely restore:"];
  if (bundle.activeTaskTitle) lines.push(`- Active task: ${bundle.activeTaskTitle}`);
  if (bundle.transcriptPreview) lines.push(`- Last voice transcript: ${bundle.transcriptPreview}`);
  if (bundle.lastState) lines.push(`- Last voice state: ${bundle.lastState}`);
  return lines.join("\n");
}
