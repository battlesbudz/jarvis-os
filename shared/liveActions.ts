import { z } from "zod";

export const LiveActionStatusSchema = z.enum([
  "created",
  "queued",
  "running",
  "waiting_approval",
  "waiting_user",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);
export type LiveActionStatus = z.infer<typeof LiveActionStatusSchema>;

export const LiveActionEventTypeSchema = z.enum([
  "action.created",
  "action.queued",
  "action.started",
  "action.progress_updated",
  "action.waiting_approval",
  "action.approval_resolved",
  "action.waiting_user",
  "action.paused",
  "action.resumed",
  "action.cancel_requested",
  "action.cancelled",
  "action.artifact_attached",
  "action.warning",
  "action.retry_scheduled",
  "action.succeeded",
  "action.failed",
  "action.expired",
]);
export type LiveActionEventType = z.infer<typeof LiveActionEventTypeSchema>;

export const LiveActionProgressSchema = z.object({
  kind: z.enum(["indeterminate", "percent"]),
  currentStep: z.string().min(1).max(300),
  value: z.number().min(0).max(100).nullable(),
  updatedAt: z.string().datetime(),
});
export type LiveActionProgress = z.infer<typeof LiveActionProgressSchema>;

export const LiveActionAttentionSchema = z.object({
  kind: z.enum(["approval", "user_input", "authentication", "provider", "device", "warning"]),
  reason: z.string().min(1).max(500),
  referenceId: z.string().min(1).max(200).optional(),
});
export type LiveActionAttention = z.infer<typeof LiveActionAttentionSchema>;

export const LiveActionControlCapabilitySchema = z.object({
  type: z.enum(["open", "cancel", "pause", "resume", "retry", "open_approval", "open_artifact"]),
  enabled: z.boolean(),
  disabledReason: z.string().max(300).optional(),
  targetRoute: z.string().max(500).optional(),
});
export type LiveActionControlCapability = z.infer<typeof LiveActionControlCapabilitySchema>;

export const LiveActionArtifactRefSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(["deliverable", "file", "url"]),
  title: z.string().min(1).max(300),
  provenance: z.string().min(1).max(200),
  availability: z.enum(["available", "pending", "unavailable"]),
  mimeType: z.string().max(200).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  deepLink: z.string().max(1_000).optional(),
});
export type LiveActionArtifactRef = z.infer<typeof LiveActionArtifactRefSchema>;

export const LiveActionSourceSchema = z.object({
  type: z.literal("agent_job"),
  id: z.string().min(1).max(200),
  lineageType: z.literal("agent_job"),
  lineageKey: z.string().min(1).max(200),
});
export type LiveActionSource = z.infer<typeof LiveActionSourceSchema>;

export const LiveActionEventSchema = z.object({
  id: z.string().min(1),
  actionId: z.string().min(1),
  sequence: z.number().int().positive(),
  type: LiveActionEventTypeSchema,
  message: z.string().max(500).nullable(),
  safeMetadata: z.record(z.string(), z.unknown()),
  userVisible: z.boolean(),
  createdAt: z.string().datetime(),
});
export type LiveActionEvent = z.infer<typeof LiveActionEventSchema>;

export const LiveActionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().nullable(),
  parentActionId: z.string().nullable(),
  source: LiveActionSourceSchema,
  kind: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  status: LiveActionStatusSchema,
  version: z.number().int().positive(),
  progress: LiveActionProgressSchema.nullable(),
  attention: LiveActionAttentionSchema.nullable(),
  capabilities: z.array(LiveActionControlCapabilitySchema).max(10),
  artifacts: z.array(LiveActionArtifactRefSchema).max(25),
  error: z.object({
    category: z.string().min(1).max(100),
    summary: z.string().min(1).max(500),
    retryEligible: z.boolean(),
  }).nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type LiveAction = z.infer<typeof LiveActionSchema>;

export const LiveActionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  actions: z.array(LiveActionSchema),
});
export type LiveActionSnapshot = z.infer<typeof LiveActionSnapshotSchema>;

export const LiveActionDetailSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  action: LiveActionSchema,
  events: z.array(LiveActionEventSchema),
});
export type LiveActionDetail = z.infer<typeof LiveActionDetailSchema>;
