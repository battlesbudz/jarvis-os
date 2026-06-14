import { redactRuntimeDecision, redactRuntimeValue, type JarvisEvent, type RuntimeDecision } from "../protocol";
import type { ExecuteRuntimeEventResult, RuntimeGateResult } from "./runtimeTypes";

export type RuntimePersistenceStatus =
  | "ready"
  | "needs_approval"
  | "completed"
  | "declined"
  | "blocked"
  | "degraded"
  | "executed";

export interface RuntimePersistenceRecord {
  recordId: string;
  eventId: string;
  decisionId: string;
  userId: string;
  status: RuntimePersistenceStatus;
  intent: string;
  riskTier: RuntimeDecision["riskTier"];
  responseMode: RuntimeDecision["responseMode"];
  approvalRequired: boolean;
  approvalStatus: RuntimeDecision["approval"]["status"];
  approvalId: string | null;
  executionStatus?: string;
  owner: "core_runtime" | "legacy_route" | "existing_tool_owner";
  gateOutcome: RuntimeGateResult["outcome"];
  traceId: string;
  event: JarvisEvent;
  decision: RuntimeDecision;
  createdAt: string;
}

export interface RuntimePersistenceRecordInput {
  runtime: ExecuteRuntimeEventResult;
  status?: RuntimePersistenceStatus;
  executionStatus?: string;
  owner?: RuntimePersistenceRecord["owner"];
  traceId?: string;
  createdAt?: string;
}

export interface PersistRuntimeRecordDeps {
  writeRecord?: (record: RuntimePersistenceRecord) => Promise<void> | void;
}

export interface PersistRuntimeRecordResult {
  persisted: boolean;
  record: RuntimePersistenceRecord;
  reason: string;
}

function statusFromRuntime(runtime: ExecuteRuntimeEventResult): RuntimePersistenceStatus {
  if (runtime.gateResult.outcome === "blocked") return "blocked";
  if (runtime.decision.approval.required) return "needs_approval";
  if (runtime.decision.responseMode === "degraded") return "degraded";
  return "ready";
}

function redactedEvent(event: JarvisEvent): JarvisEvent {
  return {
    ...event,
    metadata: redactRuntimeValue(event.metadata ?? {}) as Record<string, unknown>,
  };
}

export function buildRuntimePersistenceRecord(input: RuntimePersistenceRecordInput): RuntimePersistenceRecord {
  const runtime = input.runtime;
  const decision = redactRuntimeDecision(runtime.decision);
  const event = redactedEvent(runtime.event);
  const createdAt = input.createdAt ?? decision.createdAt;
  const traceId = input.traceId ?? decision.trace.traceId;

  return {
    recordId: `runtime-record-${decision.decisionId}`,
    eventId: event.eventId,
    decisionId: decision.decisionId,
    userId: event.userId,
    status: input.status ?? statusFromRuntime(runtime),
    intent: decision.intent,
    riskTier: decision.riskTier,
    responseMode: decision.responseMode,
    approvalRequired: decision.approval.required,
    approvalStatus: decision.approval.status,
    approvalId: decision.approval.gateId ?? null,
    executionStatus: input.executionStatus,
    owner: input.owner ?? "core_runtime",
    gateOutcome: runtime.gateResult.outcome,
    traceId,
    event,
    decision,
    createdAt,
  };
}

export async function persistRuntimeRecord(
  record: RuntimePersistenceRecord,
  deps: PersistRuntimeRecordDeps = {},
): Promise<PersistRuntimeRecordResult> {
  if (!deps.writeRecord) {
    return {
      persisted: false,
      record,
      reason: "No runtime persistence writer configured.",
    };
  }

  await deps.writeRecord(record);
  return {
    persisted: true,
    record,
    reason: "Runtime persistence writer accepted record.",
  };
}
