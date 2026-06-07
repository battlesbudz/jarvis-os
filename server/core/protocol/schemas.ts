import { z } from "zod";

export const RuntimeRiskTierSchema = z.enum(["T0", "T1", "T2", "T3", "T4", "T5"]);
export type RuntimeRiskTier = z.infer<typeof RuntimeRiskTierSchema>;

export const RuntimeResponseModeSchema = z.enum([
  "answer",
  "ask_clarifying",
  "queue",
  "approval_required",
  "silent",
  "blocked",
  "degraded",
]);
export type RuntimeResponseMode = z.infer<typeof RuntimeResponseModeSchema>;

export const JarvisEventSchema = z.object({
  eventId: z.string().min(1),
  source: z.enum(["app", "telegram", "discord", "slack", "whatsapp", "webchat", "daemon", "job", "system", "unknown"]),
  userId: z.string().min(1),
  message: z.string().default(""),
  channel: z.string().optional(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type JarvisEvent = z.infer<typeof JarvisEventSchema>;

export const ContextSourceSchema = z.object({
  kind: z.enum(["hot_state", "memory", "people", "goals", "calendar", "email", "tool", "workspace", "soul", "trace", "unknown"]),
  id: z.string().optional(),
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;

export const ContextPacketSchema = z.object({
  packetId: z.string().min(1),
  userId: z.string().min(1),
  query: z.string(),
  createdAt: z.string().datetime(),
  sources: z.array(ContextSourceSchema).default([]),
  provenance: z.array(z.string()).default([]),
  uncertainty: z.array(z.string()).default([]),
  omissions: z.array(z.string()).default([]),
});
export type ContextPacket = z.infer<typeof ContextPacketSchema>;

export const ToolIntentSchema = z.object({
  toolName: z.string().min(1),
  status: z.enum(["proposed", "ready", "needs_auth", "missing_scope", "provider_down", "blocked_by_policy", "approval_required", "executed", "failed"]),
  riskTier: RuntimeRiskTierSchema,
  approvalRequired: z.boolean().default(false),
  reason: z.string().optional(),
  argsPreview: z.unknown().optional(),
});
export type ToolIntent = z.infer<typeof ToolIntentSchema>;

export const ApprovalRequirementSchema = z.object({
  required: z.boolean(),
  status: z.enum(["not_required", "pending", "approved", "rejected", "blocked"]),
  gateId: z.string().nullable().optional(),
  reason: z.string().optional(),
});
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

export const ModelRouteSchema = z.object({
  provider: z.string().default("unknown"),
  model: z.string().default("unknown"),
  reason: z.string().min(1),
  fallbackAllowed: z.boolean().default(true),
});
export type ModelRoute = z.infer<typeof ModelRouteSchema>;

export const MindTraceRefSchema = z.object({
  traceId: z.string().min(1),
  source: z.enum(["existing_mind_trace", "runtime", "golden_workflow"]),
  routeChosen: z.string().optional(),
  taskTypeDetected: z.string().optional(),
});
export type MindTraceRef = z.infer<typeof MindTraceRefSchema>;

export const RuntimeErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "error", "blocked"]),
  recoverable: z.boolean().default(true),
});
export type RuntimeError = z.infer<typeof RuntimeErrorSchema>;

export const RuntimeDecisionSchema = z.object({
  decisionId: z.string().min(1),
  eventId: z.string().min(1),
  userId: z.string().min(1),
  intent: z.string().min(1),
  confidence: z.number().min(0).max(1),
  riskTier: RuntimeRiskTierSchema,
  responseMode: RuntimeResponseModeSchema,
  tools: z.array(ToolIntentSchema).default([]),
  approval: ApprovalRequirementSchema,
  modelRoute: ModelRouteSchema,
  trace: MindTraceRefSchema,
  errors: z.array(RuntimeErrorSchema).default([]),
  createdAt: z.string().datetime(),
});
export type RuntimeDecision = z.infer<typeof RuntimeDecisionSchema>;

export function parseRuntimeDecision(value: unknown): RuntimeDecision {
  const decision = RuntimeDecisionSchema.parse(value);
  if (decision.approval.required && decision.responseMode === "answer" && decision.riskTier !== "T0") {
    throw new Error("RuntimeDecision fails closed: approval-required decisions cannot use answer responseMode.");
  }
  return decision;
}

