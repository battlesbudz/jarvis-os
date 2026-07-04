import { and, desc, eq, gt } from "drizzle-orm";

import type { WorkingContextRecord, WorkingContextRecordInput } from "../memory/writePipeline";
import { memoryWorkingContext } from "@shared/schema";

export const LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS = 5 * 60 * 1000;
export const LOCAL_RUNTIME_WORKING_CONTEXT_SCOPE_TYPE = "local_runtime_observation";

export type LocalRuntimeObservationKind =
  | "notifications"
  | "screen_context"
  | "screenshot"
  | "search_result"
  | "tool_result"
  | "task_result";

export type LocalRuntimeTurnChannel = "text" | "voice";

export interface LocalRuntimeObservationInput {
  userId: string;
  kind: LocalRuntimeObservationKind;
  sourceChannel: LocalRuntimeTurnChannel;
  summary: string;
  detail?: string | null;
  eventId: string;
  conversationId?: string | null;
  activeGoal?: string | null;
  currentStep?: string | null;
  now?: Date;
  ttlMs?: number;
}

export interface StoredRuntimeWorkingContextRow {
  scopeType: string;
  scopeId: string;
  content: string;
  updatedAt: Date | string;
  expiresAt: Date | string;
}

export interface RuntimeWorkingContextItem {
  kind: LocalRuntimeObservationKind;
  label: string;
  content: string;
  provenance: string[];
  updatedAt: string;
  expiresAt: string;
}

export interface RuntimeWorkingContextDeps {
  upsertWorkingContext(input: WorkingContextRecordInput): Promise<WorkingContextRecord>;
  listActiveWorkingContext(input: {
    userId: string;
    now: Date;
    limit: number;
  }): Promise<StoredRuntimeWorkingContextRow[]>;
}

interface StoredRuntimeObservationPayload {
  kind: LocalRuntimeObservationKind;
  sourceChannel: LocalRuntimeTurnChannel;
  summary: string;
  detail?: string | null;
  observedAt: string;
  eventId: string;
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function observationScopeId(input: Pick<LocalRuntimeObservationInput, "conversationId" | "kind">): string {
  return `${compactText(input.conversationId) || "global"}:${input.kind}`;
}

function observationLabel(kind: LocalRuntimeObservationKind): string {
  switch (kind) {
    case "notifications":
      return "Recent notifications";
    case "screen_context":
      return "Recent screen context";
    case "screenshot":
      return "Recent temporary screen capture";
    case "search_result":
      return "Recent search result";
    case "tool_result":
      return "Recent tool result";
    case "task_result":
      return "Recent task result";
  }
}

export function buildRuntimeObservationContent(input: LocalRuntimeObservationInput): string {
  const now = input.now ?? new Date();
  const payload: StoredRuntimeObservationPayload = {
    kind: input.kind,
    sourceChannel: input.sourceChannel,
    summary: compactText(input.summary),
    detail: compactText(input.detail) || null,
    observedAt: now.toISOString(),
    eventId: compactText(input.eventId),
  };

  if (!payload.summary) throw new Error("Runtime working context requires a summary.");
  if (!payload.eventId) throw new Error("Runtime working context requires an event id.");

  return JSON.stringify(payload);
}

export async function recordLocalRuntimeObservation(
  input: LocalRuntimeObservationInput,
  deps: Pick<RuntimeWorkingContextDeps, "upsertWorkingContext"> = defaultRuntimeWorkingContextDeps,
): Promise<WorkingContextRecord> {
  const now = input.now ?? new Date();
  return deps.upsertWorkingContext({
    userId: input.userId,
    scopeType: LOCAL_RUNTIME_WORKING_CONTEXT_SCOPE_TYPE,
    scopeId: observationScopeId(input),
    activeGoal: input.activeGoal,
    currentStep: input.currentStep,
    lastEventId: input.eventId,
    content: buildRuntimeObservationContent({ ...input, now }),
    now,
    ttlMs: input.ttlMs ?? LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS,
  });
}

export function selectRuntimeWorkingContextKinds(query: string): Set<LocalRuntimeObservationKind> {
  const text = compactText(query);
  const kinds = new Set<LocalRuntimeObservationKind>();
  if (!text) return kinds;

  if (/\bnotifications?\b|\bnotification\s+shade\b/i.test(text)) kinds.add("notifications");
  if (/\b(?:screen|display|what(?:'s| is)?\s+on\s+(?:my\s+)?phone|visible)\b/i.test(text)) kinds.add("screen_context");
  if (/\b(?:screenshot|screen\s+shot|screen\s+grab|capture)\b/i.test(text)) kinds.add("screenshot");
  if (/\b(?:search results?|results?|found|youtube videos?|videos?)\b/i.test(text)) kinds.add("search_result");
  if (/\b(?:tool result|phone action|action result|clipboard|copied)\b/i.test(text)) kinds.add("tool_result");
  if (/\b(?:task result|background task|job result|completed job|what happened)\b/i.test(text)) kinds.add("task_result");

  const followUpNeedsRecentContext =
    /\b(?:summari[sz]e|rank|prioriti[sz]e|which|what|open|reply|read|tell me|explain)\b/i.test(text) &&
    /\b(?:it|that|those|them|there|last|previous|result|one)\b/i.test(text);
  if (followUpNeedsRecentContext) {
    kinds.add("notifications");
    kinds.add("screen_context");
    kinds.add("screenshot");
    kinds.add("search_result");
    kinds.add("tool_result");
    kinds.add("task_result");
  }

  return kinds;
}

function parseObservationPayload(row: StoredRuntimeWorkingContextRow): StoredRuntimeObservationPayload | null {
  try {
    const parsed = JSON.parse(row.content) as Partial<StoredRuntimeObservationPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.kind || !parsed.summary || !parsed.eventId || !parsed.sourceChannel || !parsed.observedAt) return null;
    return parsed as StoredRuntimeObservationPayload;
  } catch {
    return null;
  }
}

export async function retrieveRelevantRuntimeWorkingContext(
  input: {
    userId: string;
    query: string;
    now?: Date;
    limit?: number;
  },
  deps: Pick<RuntimeWorkingContextDeps, "listActiveWorkingContext"> = defaultRuntimeWorkingContextDeps,
): Promise<RuntimeWorkingContextItem[]> {
  const kinds = selectRuntimeWorkingContextKinds(input.query);
  if (kinds.size === 0) return [];

  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 3, 12));
  const rows = await deps.listActiveWorkingContext({
    userId: input.userId,
    now,
    limit: Math.max(limit, 12),
  });

  return rows.flatMap((row): RuntimeWorkingContextItem[] => {
    const payload = parseObservationPayload(row);
    if (!payload || !kinds.has(payload.kind)) return [];
    const detail = compactText(payload.detail);
    return [{
      kind: payload.kind,
      label: observationLabel(payload.kind),
      content: detail ? `${payload.summary}\n${detail}` : payload.summary,
      provenance: [`working_context:${payload.kind}:${payload.eventId}`],
      updatedAt: isoString(row.updatedAt),
      expiresAt: isoString(row.expiresAt),
    }];
  }).slice(0, limit);
}

export const defaultRuntimeWorkingContextDeps: RuntimeWorkingContextDeps = {
  async upsertWorkingContext(input) {
    const { upsertWorkingContext } = await import("../memory/writePipeline");
    return upsertWorkingContext(input);
  },
  async listActiveWorkingContext(input) {
    if (typeof process !== "undefined" && !process.env.DATABASE_URL) return [];
    const { db } = await import("../db");

    return db.select({
      scopeType: memoryWorkingContext.scopeType,
      scopeId: memoryWorkingContext.scopeId,
      content: memoryWorkingContext.content,
      updatedAt: memoryWorkingContext.updatedAt,
      expiresAt: memoryWorkingContext.expiresAt,
    })
      .from(memoryWorkingContext)
      .where(and(
        eq(memoryWorkingContext.userId, input.userId),
        eq(memoryWorkingContext.scopeType, LOCAL_RUNTIME_WORKING_CONTEXT_SCOPE_TYPE),
        eq(memoryWorkingContext.state, "active"),
        gt(memoryWorkingContext.expiresAt, input.now),
      ))
      .orderBy(desc(memoryWorkingContext.updatedAt))
      .limit(input.limit);
  },
};
