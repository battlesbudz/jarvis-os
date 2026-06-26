import { z } from "zod";
import {
  type ContextPackDecision,
  type ContextRiskLevel,
  type ContextToolAllowance,
} from "../../agent/contextPacks";
import {
  ContextPacketSchema,
  JarvisEventSchema,
  parseRuntimeDecision,
  type ContextSource,
  type JarvisEvent,
  type RuntimeDecision,
  type RuntimeRiskTier,
  type ToolIntent,
} from "../protocol";
import {
  adaptRuntimeContextPacketFromEvent,
  runtimeProtocolSafeId,
} from "./runtimeContextPacketAdapter";
import {
  createRuntimeExplanation,
  runtimeSource,
  type RuntimeExplanation,
  type RuntimeExplanationAction,
  type RuntimeExplanationSource,
  type RuntimeSourceLabel,
} from "./runtimeExplanation";
import type { ExecuteRuntimeEventInput, ExecuteRuntimeEventResult, RuntimeGateOutcome } from "./runtimeTypes";

const READ_ONLY_TOOLS = new Set<ContextToolAllowance>(["read_context", "draft_only", "search"]);

function isoNow(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function riskTierForDecision(decision: ContextPackDecision): RuntimeRiskTier {
  if (decision.approvalRequired) {
    return "T3";
  }
  return riskTierForLevel(decision.riskLevel);
}

function riskTierForLevel(level: ContextRiskLevel): RuntimeRiskTier {
  switch (level) {
    case "low":
      return "T0";
    case "medium":
      return "T1";
    case "high":
      return "T2";
    default:
      return "T0";
  }
}

function responseModeForDecision(decision: ContextPackDecision): RuntimeDecision["responseMode"] {
  if (decision.approvalRequired) {
    return "approval_required";
  }
  if (decision.toolsAllowed.includes("queue_job") && decision.taskType === "research") {
    return "queue";
  }
  return "answer";
}

function gateOutcomeForDecision(decision: ContextPackDecision): RuntimeGateOutcome {
  if (decision.approvalRequired) {
    return "needs_approval";
  }
  if (decision.toolsAllowed.includes("queue_job") && decision.taskType === "research") {
    return "queue_job";
  }
  if (decision.toolsAllowed.some((tool) => !READ_ONLY_TOOLS.has(tool))) {
    return "tool_candidate";
  }
  return "inline_answer";
}

function toolIntentForAllowance(tool: ContextToolAllowance, decision: ContextPackDecision): ToolIntent {
  const approvalRequired = decision.approvalRequired && !READ_ONLY_TOOLS.has(tool);
  return {
    toolName: tool,
    status: approvalRequired ? "approval_required" : "proposed",
    riskTier: approvalRequired ? "T3" : riskTierForLevel(decision.riskLevel),
    approvalRequired,
    reason: "Runtime Gate preview only; tool execution remains owned by existing modules.",
  };
}

function runtimeSourceLabelForContextSource(source: ContextSource): RuntimeSourceLabel {
  switch (source.kind) {
    case "memory":
      return "MemoryOS";
    case "soul":
      return "Soul";
    case "email":
    case "calendar":
      return "Connector";
    case "tool":
      return "Tool";
    case "hot_state":
    case "people":
    case "goals":
    case "workspace":
    case "trace":
    case "unknown":
    default:
      return "Diagnostics";
  }
}

function severityForGateOutcome(outcome: RuntimeGateOutcome): RuntimeExplanation["severity"] {
  if (outcome === "blocked") return "error";
  if (outcome === "needs_approval" || outcome === "degraded") return "warning";
  return "info";
}

function actionsForGateOutcome(outcome: RuntimeGateOutcome): RuntimeExplanationAction[] {
  if (outcome === "needs_approval") {
    return [{ id: "review_approval_gate", label: "Review approval", kind: "review" }];
  }
  if (outcome === "queue_job") {
    return [{ id: "review_queue", label: "Review queued work", kind: "review" }];
  }
  if (outcome === "blocked") {
    return [{ id: "retry_runtime_event", label: "Try again", kind: "retry" }];
  }
  return [];
}

function runtimeExplanationFromGate(input: {
  contextPacket: ExecuteRuntimeEventResult["contextPacket"];
  taskType: ExecuteRuntimeEventResult["gateResult"]["taskType"];
  route: string;
  outcome: RuntimeGateOutcome;
  reasons: string[];
}): RuntimeExplanation {
  const usedSources: RuntimeExplanationSource[] = input.contextPacket.sources.map((source) =>
    runtimeSource(runtimeSourceLabelForContextSource(source), source.label),
  );
  const attemptedSources: RuntimeExplanationSource[] = input.outcome === "tool_candidate" || input.outcome === "needs_approval"
    ? [runtimeSource("Tool", input.taskType)]
    : [];
  const reasonText = input.reasons.length > 0 ? ` ${input.reasons.join(" ")}` : "";

  return createRuntimeExplanation({
    title: "Runtime gate decision",
    message: `Runtime Gate classified this as ${input.taskType} via ${input.route} with outcome ${input.outcome}.${reasonText}`,
    severity: severityForGateOutcome(input.outcome),
    actions: actionsForGateOutcome(input.outcome),
    usedSources,
    attemptedSources,
  });
}

function runtimeDecisionFromContextDecision(
  event: JarvisEvent,
  decision: ContextPackDecision,
  createdAt: string,
): RuntimeDecision {
  const approvalRequired = decision.approvalRequired;
  return parseRuntimeDecision({
    decisionId: runtimeProtocolSafeId("decision", event.eventId),
    eventId: event.eventId,
    userId: event.userId,
    intent: decision.taskType,
    confidence: decision.reasons.length > 0 ? 0.82 : 0.62,
    riskTier: riskTierForDecision(decision),
    responseMode: responseModeForDecision(decision),
    tools: decision.toolsAllowed.map((tool) => toolIntentForAllowance(tool, decision)),
    approval: {
      required: approvalRequired,
      status: approvalRequired ? "pending" : "not_required",
      gateId: approvalRequired ? runtimeProtocolSafeId("gate", event.eventId) : null,
      reason: approvalRequired ? "Context classifier marked this request as approval-gated." : undefined,
    },
    modelRoute: {
      provider: "runtime-gate",
      model: "deterministic-context-pack-classifier",
      reason: `Mapped ${decision.taskType} through ${decision.route} route.`,
      fallbackAllowed: true,
    },
    trace: {
      traceId: runtimeProtocolSafeId("runtime", event.eventId),
      source: "runtime",
      routeChosen: decision.route,
      taskTypeDetected: decision.taskType,
    },
    errors: [],
    createdAt,
  });
}

function invalidEventResult(error: unknown, createdAt: string): ExecuteRuntimeEventResult {
  const message = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : "Unknown event validation error.";
  const event = JarvisEventSchema.parse({
    eventId: "invalid-event",
    source: "unknown",
    userId: "unknown-user",
    message: "",
    createdAt,
    metadata: {},
  });
  const contextPacket = ContextPacketSchema.parse({
    packetId: "packet-invalid-event",
    userId: event.userId,
    query: event.message,
    createdAt,
    sources: [{ kind: "unknown", label: "invalid_event", confidence: 1 }],
    provenance: ["server/core/protocol/JarvisEventSchema"],
    uncertainty: ["Incoming event failed protocol validation."],
    omissions: ["No context classification was attempted for an invalid event."],
  });
  const decision = parseRuntimeDecision({
    decisionId: "decision-invalid-event",
    eventId: event.eventId,
    userId: event.userId,
    intent: "invalid_event",
    confidence: 1,
    riskTier: "T5",
    responseMode: "blocked",
    tools: [],
    approval: {
      required: false,
      status: "blocked",
      reason: "Invalid runtime event cannot continue.",
    },
    modelRoute: {
      provider: "runtime-gate",
      model: "deterministic-validation",
      reason: "Fail-closed validation path for invalid JarvisEvent.",
      fallbackAllowed: false,
    },
    trace: {
      traceId: "runtime-invalid-event",
      source: "runtime",
      routeChosen: "blocked",
      taskTypeDetected: "invalid_event",
    },
    errors: [
      {
        code: "INVALID_RUNTIME_EVENT",
        message,
        severity: "blocked",
        recoverable: true,
      },
    ],
    createdAt,
  });

  return {
    event,
    contextPacket,
    decision,
    gateResult: {
      outcome: "blocked",
      route: "blocked",
      taskType: "invalid_event",
      reasons: ["Incoming event failed JarvisEvent protocol validation."],
    },
    runtimeExplanation: createRuntimeExplanation({
      title: "Runtime event blocked",
      message: "Incoming event failed JarvisEvent protocol validation.",
      severity: "error",
      attemptedSources: [runtimeSource("Diagnostics", "JarvisEventSchema")],
      actions: [{ id: "retry_runtime_event", label: "Try again", kind: "retry" }],
    }),
  };
}

export function executeRuntimeEvent(input: ExecuteRuntimeEventInput): ExecuteRuntimeEventResult {
  const createdAt = isoNow(input.now);
  const parsed = JarvisEventSchema.safeParse(input.event);
  if (!parsed.success) {
    return invalidEventResult(parsed.error, createdAt);
  }

  const {
    event,
    decision: contextDecision,
    contextPacket,
  } = adaptRuntimeContextPacketFromEvent({
    event: parsed.data,
    createdAt,
  });
  const decision = runtimeDecisionFromContextDecision(event, contextDecision, createdAt);

  const gateResult = {
    outcome: gateOutcomeForDecision(contextDecision),
    route: contextDecision.route,
    taskType: contextDecision.taskType,
    reasons: contextDecision.reasons,
  };

  return {
    event,
    contextPacket,
    decision,
    gateResult,
    runtimeExplanation: runtimeExplanationFromGate({
      contextPacket,
      taskType: gateResult.taskType,
      route: gateResult.route,
      outcome: gateResult.outcome,
      reasons: gateResult.reasons,
    }),
  };
}
