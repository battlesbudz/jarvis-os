import { createHash } from "node:crypto";
import { getScheduledTaskDedupeScope, normalizeScheduledTaskKind, shouldExecuteScheduledTask } from "../../jarvisScheduledTaskSemantics";
import { JarvisEventSchema, redactRuntimeValue } from "../protocol";
import type { ScheduledTaskKind } from "../../jarvisScheduledTaskSemantics";

export type RuntimeScheduledTaskPreviewStatus = "ready_for_existing_owner" | "invalid" | "blocked";
export type RuntimeScheduledTaskSourceTool = "schedule_jarvis_task" | "cron_create" | "unknown";
export type RuntimeScheduledAtParseStatus = "iso_datetime" | "natural_or_recurring" | "invalid";

export interface RuntimeScheduledTaskPreviewInput {
  event: unknown;
  title: string;
  description?: string | null;
  scheduledAt: string | Date;
  recurrence?: string | null;
  taskKind?: string | null;
  shellCommand?: string | null;
  sourceTool?: RuntimeScheduledTaskSourceTool;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface RuntimeScheduledTaskPreview {
  previewId: string;
  eventId: string;
  userId: string;
  status: RuntimeScheduledTaskPreviewStatus;
  owner: "existing_scheduler";
  sourceTool: RuntimeScheduledTaskSourceTool;
  title: string;
  description: string | null;
  scheduledAt: {
    input: string;
    iso: string | null;
    parseStatus: RuntimeScheduledAtParseStatus;
  };
  recurrence: string | null;
  taskKind: ScheduledTaskKind;
  executableByJarvis: boolean;
  runtimeEnqueueAllowed: false;
  approvalRequired: boolean;
  shellCommand: {
    present: boolean;
    fingerprint: string | null;
  };
  dedupeScope: {
    normalizedTitle: string;
    recurrence: string | null;
    taskKind: ScheduledTaskKind;
    includeScheduledAt: boolean;
  };
  metadata: Record<string, unknown>;
  policyReasons: string[];
  errors: string[];
  createdAt: string;
}

export interface PersistRuntimeScheduledTaskPreviewDeps {
  writePreview?: (preview: RuntimeScheduledTaskPreview) => Promise<void> | void;
}

export interface PersistRuntimeScheduledTaskPreviewResult {
  persisted: boolean;
  preview: RuntimeScheduledTaskPreview;
  reason: string;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
}

function fingerprintShellCommand(command: string | null | undefined): string | null {
  const trimmed = String(command ?? "").trim();
  if (!trimmed) return null;
  const redacted = redactRuntimeValue({ shellCommand: trimmed });
  return createHash("sha256").update(stableStringify(redacted)).digest("hex");
}

function scheduledAtInput(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "").trim();
}

function parseScheduledAt(value: string | Date): RuntimeScheduledTaskPreview["scheduledAt"] {
  const input = scheduledAtInput(value);
  if (!input) {
    return { input, iso: null, parseStatus: "invalid" };
  }

  const parsed = value instanceof Date ? value : new Date(input);
  if (!Number.isNaN(parsed.getTime()) && /[T:-]|\d{4}/.test(input)) {
    return { input, iso: parsed.toISOString(), parseStatus: "iso_datetime" };
  }

  return { input, iso: null, parseStatus: "natural_or_recurring" };
}

function policyReasons(input: {
  taskKind: ScheduledTaskKind;
  executableByJarvis: boolean;
  shellCommandPresent: boolean;
  sourceTool: RuntimeScheduledTaskSourceTool;
}): string[] {
  const reasons = ["Core Runtime preview is storage-neutral and cannot insert scheduled task rows."];

  if (input.taskKind === "user_task") {
    reasons.push("User tasks and reminders remain non-executable and are owned by the existing scheduled-task tool.");
  }
  if (input.executableByJarvis) {
    reasons.push("Executable Jarvis jobs must stay with the existing scheduler and approval/tool policy path.");
  }
  if (input.shellCommandPresent) {
    reasons.push("Shell command text is not stored in the runtime preview; only a redacted fingerprint is retained.");
  }
  if (input.sourceTool === "unknown") {
    reasons.push("No source tool was supplied, so the existing owner must resolve the final scheduling path.");
  }

  return reasons;
}

export function buildRuntimeScheduledTaskPreview(input: RuntimeScheduledTaskPreviewInput): RuntimeScheduledTaskPreview {
  const event = JarvisEventSchema.parse(input.event);
  const title = String(input.title ?? "").trim();
  const description = input.description ? String(input.description).trim() : null;
  const recurrence = input.recurrence ? String(input.recurrence).trim() : null;
  const taskKind = normalizeScheduledTaskKind(input.taskKind);
  const scheduledAt = parseScheduledAt(input.scheduledAt);
  const shellCommandFingerprint = fingerprintShellCommand(input.shellCommand);
  const shellCommandPresent = shellCommandFingerprint !== null;
  const executableByJarvis = shouldExecuteScheduledTask({ taskKind, shellCommand: shellCommandPresent ? "[fingerprinted]" : null });
  const errors: string[] = [];

  if (!title) errors.push("Scheduled task title is required.");
  if (scheduledAt.parseStatus === "invalid") errors.push("Scheduled task time is required.");
  if (taskKind === "user_task" && shellCommandPresent) {
    errors.push("User tasks cannot carry shell commands; use an explicit Jarvis action job instead.");
  }

  const dedupeInputDate = scheduledAt.iso ? new Date(scheduledAt.iso) : new Date(input.createdAt ?? event.createdAt);
  const dedupeScope = getScheduledTaskDedupeScope({
    title,
    scheduledAt: dedupeInputDate,
    recurrence,
    taskKind,
  });

  return {
    previewId: `runtime-scheduled-task-${event.eventId}`,
    eventId: event.eventId,
    userId: event.userId,
    status: errors.length > 0 ? (taskKind === "user_task" && shellCommandPresent ? "blocked" : "invalid") : "ready_for_existing_owner",
    owner: "existing_scheduler",
    sourceTool: input.sourceTool ?? "unknown",
    title,
    description,
    scheduledAt,
    recurrence,
    taskKind,
    executableByJarvis,
    runtimeEnqueueAllowed: false,
    approvalRequired: executableByJarvis || shellCommandPresent,
    shellCommand: {
      present: shellCommandPresent,
      fingerprint: shellCommandFingerprint,
    },
    dedupeScope,
    metadata: redactRuntimeValue(input.metadata ?? {}) as Record<string, unknown>,
    policyReasons: policyReasons({
      taskKind,
      executableByJarvis,
      shellCommandPresent,
      sourceTool: input.sourceTool ?? "unknown",
    }),
    errors,
    createdAt: input.createdAt ?? event.createdAt,
  };
}

export async function persistRuntimeScheduledTaskPreview(
  preview: RuntimeScheduledTaskPreview,
  deps: PersistRuntimeScheduledTaskPreviewDeps = {},
): Promise<PersistRuntimeScheduledTaskPreviewResult> {
  if (!deps.writePreview) {
    return {
      persisted: false,
      preview,
      reason: "No runtime scheduled task writer configured.",
    };
  }

  await deps.writePreview(preview);
  return {
    persisted: true,
    preview,
    reason: "Runtime scheduled task writer accepted preview.",
  };
}
