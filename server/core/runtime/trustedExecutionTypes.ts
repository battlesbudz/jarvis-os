export const TRUSTED_EXECUTION_DECISIONS = ["execute", "clarify", "block"] as const;
export type TrustedExecutionDecision = typeof TRUSTED_EXECUTION_DECISIONS[number];

export const EXECUTION_AUTHORITY_SOURCE_TYPES = ["direct_command", "standing_grant"] as const;
export type ExecutionAuthoritySourceType = typeof EXECUTION_AUTHORITY_SOURCE_TYPES[number];

export const EXECUTION_AUTHORITY_STATUSES = [
  "active",
  "compensating",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;
export type ExecutionAuthorityStatus = typeof EXECUTION_AUTHORITY_STATUSES[number];

export const EXECUTION_STEP_STATUSES = [
  "pending",
  "consuming",
  "consumed",
  "retryable_failed",
  "failed",
  "cancelled",
  "skipped",
  "reconciliation_required",
] as const;
export type ExecutionStepStatus = typeof EXECUTION_STEP_STATUSES[number];

export const EXECUTION_ATTEMPT_BOUNDARY_STATES = [
  "not_started",
  "started",
  "confirmed_no_effect",
  "confirmed_effect",
  "uncertain",
] as const;
export type ExecutionAttemptBoundaryState = typeof EXECUTION_ATTEMPT_BOUNDARY_STATES[number];

export const COMPENSATION_REASONS = ["forward_failure", "workflow_incomplete_at_expiry"] as const;
export type CompensationReason = typeof COMPENSATION_REASONS[number];

export const COMPENSATION_ELIGIBILITY = [
  "inactive",
  "executable",
  "awaiting_trigger",
  "awaiting_effect_reconciliation",
  "inapplicable",
] as const;
export type CompensationEligibility = typeof COMPENSATION_ELIGIBILITY[number];

export type TrustedExecutionRiskTier = "low" | "medium" | "high";

export interface TrustedExecutionControlSnapshot {
  globalEnabled: boolean;
  userEnabled: boolean;
  globalEpoch: number;
  userEpoch: number;
  killSwitchEnabled: boolean;
}

export interface TrustedExecutionCapabilitySnapshot {
  authenticated: boolean;
  ownsTargets: boolean;
  requiredScopesPresent: boolean;
  providerAvailable: boolean;
  devicePermissionsPresent: boolean;
  withinLimits: boolean;
}

export interface TrustedExecutionResolutionInput {
  sourceType: ExecutionAuthoritySourceType;
  authenticatedUserId?: string;
  sourceTurnId?: string;
  sourceActionKey?: string;
  taskId?: string;
  originChannel?: string;
  intent?: string;
  allowedActions: string[];
  allowedTargets: string[];
  riskTier: TrustedExecutionRiskTier;
  missingMaterialFields?: string[];
  hardBlockReasons?: string[];
  genericAffirmativeWithoutTask?: boolean;
  financialTransaction?: boolean;
  capabilities: TrustedExecutionCapabilitySnapshot;
  controls: TrustedExecutionControlSnapshot;
}

export interface TrustedExecutionResolution {
  decision: TrustedExecutionDecision;
  code:
    | "ready"
    | "feature_disabled"
    | "kill_switch"
    | "missing_trusted_identity"
    | "missing_material_field"
    | "hard_block"
    | "capability_block"
    | "generic_affirmative"
    | "standing_financial_block";
  reason: string;
  missingFields: string[];
}

export interface DirectAuthorityIssueInput {
  authenticatedUserId: string;
  sourceTurnId: string;
  sourceActionKind: string;
  sourceActionKey: string;
  originChannel: string;
  taskId: string;
  intent: string;
  allowedActions: string[];
  allowedTargets: string[];
  riskTier: TrustedExecutionRiskTier;
  maxAttemptsPerStep: number;
  expiresAt: Date;
  compensationExpiresAt: Date;
  auditMetadata?: Record<string, unknown>;
}

export interface StandingAuthorityIssueInput {
  authenticatedUserId: string;
  standingGrantId: string;
  expectedGrantVersion: number;
  expectedStateRevision: number;
  triggerLineageId: string;
  triggerOccurrenceKey: string;
  originChannel: string;
  taskId: string;
  intent: string;
  requestedActions: string[];
  requestedTargets: string[];
  usage: Array<{
    limitKey: string;
    amount: number;
    windowStart: Date;
    windowEnd: Date;
  }>;
  riskTier: TrustedExecutionRiskTier;
  maxAttemptsPerStep: number;
  expiresAt: Date;
  compensationExpiresAt: Date;
  auditMetadata?: Record<string, unknown>;
}

export interface ExecutionAuthorityRecord {
  id: string;
  userId: string;
  sourceType: ExecutionAuthoritySourceType;
  sourceTurnId: string | null;
  sourceActionKind: string | null;
  sourceActionKey: string | null;
  standingGrantId: string | null;
  standingGrantVersion: number | null;
  standingGrantStateRevision: number | null;
  standingGrantCategory: string | null;
  standingGrantTriggerLineageId: string | null;
  triggerOccurrenceKey: string | null;
  globalExecutionEpoch: number;
  userExecutionEpoch: number;
  originChannel: string;
  taskId: string;
  intent: string;
  allowedActions: string[];
  allowedTargets: string[];
  riskTier: TrustedExecutionRiskTier;
  maxAttemptsPerStep: number;
  idempotencyLineageId: string;
  workflowPlanRevision: number;
  workflowPlanStatus: "planning" | "closed";
  requiredStepManifestHash: string | null;
  issuedAt: Date;
  expiresAt: Date;
  compensationExpiresAt: Date;
  forwardAdmissionStatus: "open" | "closed";
  compensationReasons: CompensationReason[];
  status: ExecutionAuthorityStatus;
  reconciliationStatus: "none" | "required" | "resolved";
  terminalReasonRef: string | null;
}

export interface AuthorityStepInput {
  stepKey: string;
  action: string;
  targetFingerprint: string;
  role: "forward" | "compensation";
  dependsOnStepKeys?: string[];
  compensatesStepKeys?: string[];
  compensationTriggers?: CompensationReason[];
  maxAttempts: number;
}

export interface AuthorityExecutionStepRecord extends AuthorityStepInput {
  id: string;
  authorityId: string;
  idempotencyKey: string;
  compensationEligibility: CompensationEligibility;
  attemptCount: number;
  currentAttemptId: string | null;
  status: ExecutionStepStatus;
  resultRef: string | null;
  recoveryRef: string | null;
}

export interface AuthorityExecutionAttemptRecord {
  id: string;
  authorityExecutionStepId: string;
  attemptNumber: number;
  leaseOwnerId: string;
  leaseGeneration: number;
  leaseExpiresAt: Date;
  boundaryState: ExecutionAttemptBoundaryState;
  status: "leased" | "completed" | "abandoned" | "reconciliation_required";
}

export interface TrustedExecutionAuthorityIssueResult {
  authority: ExecutionAuthorityRecord;
  deduplicated: boolean;
}

export interface AuthorityValidationInput {
  authorityId: string;
  authenticatedUserId: string;
  action: string;
  targetFingerprint: string;
  stepKey: string;
  now?: Date;
}

export interface AuthorityValidationResult {
  valid: boolean;
  code:
    | "valid"
    | "not_found"
    | "wrong_owner"
    | "inactive"
    | "expired"
    | "epoch_mismatch"
    | "scope_mismatch"
    | "manifest_open"
    | "step_not_manifested"
    | "step_not_pending";
  reason: string;
  authorityId?: string;
  stepKey?: string;
  action?: string;
  targetFingerprint?: string;
}
