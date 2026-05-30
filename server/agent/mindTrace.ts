import { randomUUID } from "crypto";
import {
  decideContextPacks,
  type ContextPackDecision,
  type ContextRiskLevel,
} from "./contextPacks";

export interface MindTraceMemoryInput {
  id?: string;
  category?: string | null;
  tier?: string | null;
  memoryType?: string | null;
  confidence?: number | null;
  relevanceScore?: number | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  reason?: string | null;
}

export interface MindTraceToolInput {
  name: string;
  status?: "ok" | "failed" | "blocked" | "skipped";
  args?: unknown;
  result?: unknown;
  approvalRequired?: boolean;
  error?: string | null;
}

export interface MindTraceInput {
  traceId?: string;
  userId?: string;
  userRequest: string;
  channel?: string;
  contextDecision?: ContextPackDecision;
  contextLoaded?: string[];
  memoriesRetrieved?: MindTraceMemoryInput[];
  soulSectionsUsed?: string[];
  toolsCalled?: MindTraceToolInput[];
  approvalGateId?: string | null;
  approvalRequired?: boolean;
  jobCreated?: { id?: string; type?: string; status?: string; title?: string } | null;
  deliverableCreated?: { id?: string; type?: string; status?: string; title?: string } | null;
  confidenceNotes?: string[];
  uncertaintyNotes?: string[];
  errors?: string[];
  blockedSetupIssues?: string[];
  now?: Date;
}

export interface JarvisMindTrace {
  traceId: string;
  createdAt: string;
  channel: string;
  taskTypeDetected: string;
  routeChosen: string;
  riskLevel: ContextRiskLevel;
  contextLoaded: string[];
  memoriesRetrieved: Array<{
    id?: string;
    category?: string | null;
    tier?: string | null;
    memoryType?: string | null;
    confidence?: number | null;
    relevanceScore?: number | null;
    sourceType?: string | null;
    sourceRef?: string | null;
    reason?: string | null;
  }>;
  soulSectionsUsed: string[];
  toolsCalled: Array<{
    name: string;
    status: "ok" | "failed" | "blocked" | "skipped";
    approvalRequired: boolean;
    argsPreview: unknown;
    resultPreview?: unknown;
    error?: string | null;
  }>;
  approval: {
    required: boolean;
    gateId?: string | null;
  };
  jobCreated: MindTraceInput["jobCreated"];
  deliverableCreated: MindTraceInput["deliverableCreated"];
  outputDestination?: string;
  confidenceNotes: string[];
  uncertaintyNotes: string[];
  blockedSetupIssues: string[];
  errors: string[];
  decision: ContextPackDecision;
}

const SECRET_KEY_PATTERN = /(^|_|\b)(token|secret|password|authorization|auth|api.?key|access.?token|refresh.?token|cookie|session)(_|$|\b)/i;
const MAX_STRING = 240;

export function redactTraceValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 12).map(redactTraceValue);

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactTraceValue(nested);
  }
  return output;
}

function buildContextLoaded(decision: ContextPackDecision, explicitContext: string[] | undefined): string[] {
  return [...new Set([...(explicitContext ?? []), ...decision.requiredContextPacks])];
}

export function buildMindTrace(input: MindTraceInput): JarvisMindTrace {
  const decision = input.contextDecision ?? decideContextPacks({
    userMessage: input.userRequest,
    channel: input.channel,
  });
  const approvalRequired = input.approvalRequired ?? decision.approvalRequired;

  return {
    traceId: input.traceId ?? randomUUID(),
    createdAt: (input.now ?? new Date()).toISOString(),
    channel: input.channel ?? "unknown",
    taskTypeDetected: decision.taskType,
    routeChosen: decision.route,
    riskLevel: decision.riskLevel,
    contextLoaded: buildContextLoaded(decision, input.contextLoaded),
    memoriesRetrieved: (input.memoriesRetrieved ?? []).map((memory) => ({
      id: memory.id,
      category: memory.category ?? null,
      tier: memory.tier ?? null,
      memoryType: memory.memoryType ?? null,
      confidence: memory.confidence ?? null,
      relevanceScore: memory.relevanceScore ?? null,
      sourceType: memory.sourceType ?? null,
      sourceRef: memory.sourceRef ?? null,
      reason: memory.reason ?? null,
    })),
    soulSectionsUsed: input.soulSectionsUsed ?? [],
    toolsCalled: (input.toolsCalled ?? []).map((tool) => ({
      name: tool.name,
      status: tool.status ?? "ok",
      approvalRequired: tool.approvalRequired ?? approvalRequired,
      argsPreview: redactTraceValue(tool.args ?? {}),
      resultPreview: tool.result === undefined ? undefined : redactTraceValue(tool.result),
      error: tool.error ?? null,
    })),
    approval: {
      required: approvalRequired,
      gateId: input.approvalGateId ?? null,
    },
    jobCreated: input.jobCreated ?? null,
    deliverableCreated: input.deliverableCreated ?? null,
    outputDestination: decision.outputDestination,
    confidenceNotes: input.confidenceNotes ?? [],
    uncertaintyNotes: input.uncertaintyNotes ?? [],
    blockedSetupIssues: input.blockedSetupIssues ?? [],
    errors: input.errors ?? [],
    decision,
  };
}
