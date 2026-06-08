import type { ContextPacket, RuntimeDecision } from "../protocol";
import { executeRuntimeEvent } from "./executeRuntimeEvent";
import type { ExecuteRuntimeEventInput, ExecuteRuntimeEventResult } from "./runtimeTypes";

export type RuntimeReadOnlyExecutionStatus = "completed" | "declined" | "blocked";

export interface RuntimeReadOnlyExecution {
  executorId: "core-runtime-readonly-v0";
  mode: "read_only";
  owner: "core_runtime";
  status: RuntimeReadOnlyExecutionStatus;
  eventId: string;
  decisionId: string;
  userId: string;
  responseMode: RuntimeDecision["responseMode"];
  intent: string;
  response: string;
  reason: string;
  sideEffects: [];
  executedToolCount: 0;
  createdAt: string;
}

export interface RuntimeReadOnlyExecutionResult extends ExecuteRuntimeEventResult {
  execution: RuntimeReadOnlyExecution;
}

function sourceLabels(packet: ContextPacket): string[] {
  return packet.sources.map((source) => source.label ?? source.kind).filter((label) => label.length > 0);
}

function readOnlyResponse(runtime: ExecuteRuntimeEventResult): string {
  const labels = sourceLabels(runtime.contextPacket);
  const contextSummary = labels.length > 0 ? labels.join(", ") : "no additional context sources";
  return [
    `Runtime handled this read-only ${runtime.decision.intent} request.`,
    `Selected context: ${contextSummary}.`,
    "No tools were executed and no state was changed.",
  ].join(" ");
}

function declinedReason(runtime: ExecuteRuntimeEventResult): string {
  if (runtime.gateResult.outcome === "blocked") {
    return "Runtime event is blocked and cannot be executed.";
  }
  if (runtime.decision.approval.required) {
    return "Runtime decision requires approval, so the read-only executor must decline.";
  }
  if (runtime.decision.responseMode !== "answer") {
    return `Runtime response mode is ${runtime.decision.responseMode}, not answer.`;
  }
  if (runtime.gateResult.outcome !== "inline_answer") {
    return `Runtime gate outcome is ${runtime.gateResult.outcome}, not inline_answer.`;
  }
  return "Runtime decision is outside the read-only executor boundary.";
}

function buildExecution(runtime: ExecuteRuntimeEventResult, createdAt: string): RuntimeReadOnlyExecution {
  const blocked = runtime.gateResult.outcome === "blocked";
  const canComplete =
    runtime.gateResult.outcome === "inline_answer" &&
    runtime.decision.responseMode === "answer" &&
    !runtime.decision.approval.required;

  if (canComplete) {
    return {
      executorId: "core-runtime-readonly-v0",
      mode: "read_only",
      owner: "core_runtime",
      status: "completed",
      eventId: runtime.event.eventId,
      decisionId: runtime.decision.decisionId,
      userId: runtime.event.userId,
      responseMode: runtime.decision.responseMode,
      intent: runtime.decision.intent,
      response: readOnlyResponse(runtime),
      reason: "Runtime gate produced a safe inline answer decision.",
      sideEffects: [],
      executedToolCount: 0,
      createdAt,
    };
  }

  const reason = declinedReason(runtime);
  return {
    executorId: "core-runtime-readonly-v0",
    mode: "read_only",
    owner: "core_runtime",
    status: blocked ? "blocked" : "declined",
    eventId: runtime.event.eventId,
    decisionId: runtime.decision.decisionId,
    userId: runtime.event.userId,
    responseMode: runtime.decision.responseMode,
    intent: runtime.decision.intent,
    response: reason,
    reason,
    sideEffects: [],
    executedToolCount: 0,
    createdAt,
  };
}

export function executeRuntimeReadOnly(input: ExecuteRuntimeEventInput): RuntimeReadOnlyExecutionResult {
  const runtime = executeRuntimeEvent(input);
  const createdAt = runtime.decision.createdAt;

  return {
    ...runtime,
    execution: buildExecution(runtime, createdAt),
  };
}
