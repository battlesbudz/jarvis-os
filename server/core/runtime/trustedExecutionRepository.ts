import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  authorityExecutionAttempts,
  authorityExecutionSteps,
  executionAuthorities,
  standingExecutionGrantHeads,
  standingExecutionGrantVersions,
  standingExecutionOccurrences,
  standingExecutionUsageAllocations,
  trustedExecutionAuditEvents,
  trustedExecutionGlobalControls,
  trustedExecutionUserControls,
} from "@shared/schema";
import type {
  AuthorityExecutionAttemptRecord,
  AuthorityExecutionStepRecord,
  AuthorityStepInput,
  AuthorityValidationInput,
  AuthorityValidationResult,
  CompensationReason,
  DirectAuthorityIssueInput,
  ExecutionAuthorityRecord,
  StandingAuthorityIssueInput,
  TrustedExecutionAuthorityIssueResult,
  TrustedExecutionControlSnapshot,
} from "./trustedExecutionTypes";

type Database = typeof import("../../db")["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function database(): Promise<Database> {
  return (await import("../../db")).db;
}

async function databaseNow(tx: Transaction): Promise<Date> {
  const result = await tx.execute(sql`SELECT CURRENT_TIMESTAMP AS now`);
  const row = result.rows?.[0] as { now: Date | string } | undefined;
  if (!row) throw new Error("Database time query returned no row.");
  return row.now instanceof Date ? row.now : new Date(row.now);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeAuditMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  const redactedKey = /(?:token|secret|password|credential|authorization|cookie|body|payload|content|message|path|command|args?)/i;
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, entry]) => {
    if (redactedKey.test(key)) return [key, "[REDACTED]"];
    if (entry === null || typeof entry === "boolean" || typeof entry === "number") return [key, entry];
    if (typeof entry === "string") return [key, entry.slice(0, 256)];
    if (Array.isArray(entry)) return [key, entry.slice(0, 20).map((item) => typeof item === "string" ? item.slice(0, 128) : "[STRUCTURED]")];
    return [key, "[STRUCTURED]"];
  }));
}

function authorityIdempotencyLineage(userId: string, kind: string, key: string): string {
  return `te-${sha256(`${userId}\u0000${kind}\u0000${key}`)}`;
}

export function fingerprintExecutionTarget(action: string, target: string): string {
  return `sha256:${sha256(`${action.trim()}\u0000${target.trim()}`)}`;
}

function mapAuthority(row: typeof executionAuthorities.$inferSelect): ExecutionAuthorityRecord {
  return {
    id: row.id,
    userId: row.userId,
    sourceType: row.sourceType,
    sourceTurnId: row.sourceTurnId,
    sourceActionKind: row.sourceActionKind,
    sourceActionKey: row.sourceActionKey,
    standingGrantId: row.standingGrantId,
    standingGrantVersion: row.standingGrantVersion,
    standingGrantStateRevision: row.standingGrantStateRevision,
    standingGrantCategory: row.standingGrantCategory,
    standingGrantTriggerLineageId: row.standingGrantTriggerLineageId,
    triggerOccurrenceKey: row.triggerOccurrenceKey,
    globalExecutionEpoch: row.globalExecutionEpoch,
    userExecutionEpoch: row.userExecutionEpoch,
    originChannel: row.originChannel,
    taskId: row.taskId,
    intent: row.intent,
    allowedActions: row.allowedActions,
    allowedTargets: row.allowedTargets,
    riskTier: row.riskTier,
    maxAttemptsPerStep: row.maxAttemptsPerStep,
    idempotencyLineageId: row.idempotencyLineageId,
    workflowPlanRevision: row.workflowPlanRevision,
    workflowPlanStatus: row.workflowPlanStatus,
    requiredStepManifestHash: row.requiredStepManifestHash,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    compensationExpiresAt: row.compensationExpiresAt,
    forwardAdmissionStatus: row.forwardAdmissionStatus,
    compensationReasons: (row.compensationReasons ?? []) as CompensationReason[],
    status: row.status,
    reconciliationStatus: row.reconciliationStatus,
    terminalReasonRef: row.terminalReasonRef,
  };
}

function mapStep(row: typeof authorityExecutionSteps.$inferSelect): AuthorityExecutionStepRecord {
  return {
    id: row.id,
    authorityId: row.authorityId,
    stepKey: row.stepKey,
    action: row.action,
    targetFingerprint: row.targetFingerprint,
    idempotencyKey: row.idempotencyKey,
    role: row.role,
    dependsOnStepKeys: row.dependsOnStepKeys,
    compensatesStepKeys: row.compensatesStepKeys,
    compensationTriggers: row.compensationTriggers as CompensationReason[],
    compensationEligibility: row.compensationEligibility as AuthorityExecutionStepRecord["compensationEligibility"],
    maxAttempts: row.maxAttempts,
    attemptCount: row.attemptCount,
    currentAttemptId: row.currentAttemptId,
    status: row.status,
    resultRef: row.resultRef,
    recoveryRef: row.recoveryRef,
  };
}

function mapAttempt(row: typeof authorityExecutionAttempts.$inferSelect): AuthorityExecutionAttemptRecord {
  return {
    id: row.id,
    authorityExecutionStepId: row.authorityExecutionStepId,
    attemptNumber: row.attemptNumber,
    leaseOwnerId: row.leaseOwnerId,
    leaseGeneration: row.leaseGeneration,
    leaseExpiresAt: row.leaseExpiresAt,
    boundaryState: row.boundaryState as AuthorityExecutionAttemptRecord["boundaryState"],
    status: row.status as AuthorityExecutionAttemptRecord["status"],
  };
}

async function controlSnapshotInTransaction(
  tx: Transaction,
  userId: string,
  lock = false,
): Promise<TrustedExecutionControlSnapshot> {
  const globalQuery = tx.select().from(trustedExecutionGlobalControls)
    .where(eq(trustedExecutionGlobalControls.id, "global")).limit(1);
  const userQuery = tx.select().from(trustedExecutionUserControls)
    .where(eq(trustedExecutionUserControls.userId, userId)).limit(1);
  const [globalRows, userRows] = lock
    ? await Promise.all([globalQuery.for("update"), userQuery.for("update")])
    : await Promise.all([globalQuery, userQuery]);
  const global = globalRows[0];
  const user = userRows[0];
  return {
    globalEnabled: global?.enabled ?? false,
    userEnabled: user?.enabled ?? false,
    globalEpoch: global?.executionEpoch ?? 0,
    userEpoch: user?.executionEpoch ?? 0,
    killSwitchEnabled: global?.killSwitchEnabled ?? false,
  };
}

async function assertStandingGrantCurrent(
  tx: Transaction,
  authority: typeof executionAuthorities.$inferSelect,
): Promise<void> {
  if (authority.sourceType !== "standing_grant") return;
  if (!authority.standingGrantId || authority.standingGrantVersion === null || authority.standingGrantStateRevision === null) {
    throw new Error("Standing authority is missing its immutable grant snapshot.");
  }
  const [head] = await tx.select().from(standingExecutionGrantHeads)
    .where(eq(standingExecutionGrantHeads.id, authority.standingGrantId)).limit(1).for("update");
  const now = await databaseNow(tx);
  if (!head || head.userId !== authority.userId || head.status !== "active" || head.pausedAt || head.revokedAt
    || head.expiresAt <= now || head.currentVersion !== authority.standingGrantVersion
    || head.stateRevision !== authority.standingGrantStateRevision) {
    throw new Error("Standing authority was invalidated by a grant lifecycle change.");
  }
}

export async function getTrustedExecutionControlSnapshot(userId: string): Promise<TrustedExecutionControlSnapshot> {
  const db = await database();
  return db.transaction((tx) => controlSnapshotInTransaction(tx, userId));
}

async function audit(
  tx: Transaction,
  input: {
    userId: string;
    authorityId?: string;
    stepId?: string;
    eventType: string;
    targetFingerprint?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(trustedExecutionAuditEvents).values({
    userId: input.userId,
    authorityId: input.authorityId,
    stepId: input.stepId,
    eventType: input.eventType,
    targetFingerprint: input.targetFingerprint,
    metadata: input.metadata ?? {},
  });
}

function assertIssueWindow(expiresAt: Date, compensationExpiresAt: Date): void {
  const now = Date.now();
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now) {
    throw new Error("Execution authority expiry must be in the future.");
  }
  if (!Number.isFinite(compensationExpiresAt.getTime()) || compensationExpiresAt < expiresAt) {
    throw new Error("Compensation expiry must be at or after forward expiry.");
  }
}

function assertBoundedScope(actions: string[], targets: string[], maxAttempts: number): void {
  if (!uniqueStrings(actions).length) throw new Error("Execution authority requires at least one allowed action.");
  if (!uniqueStrings(targets).length) throw new Error("Execution authority requires at least one allowed target.");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("maxAttemptsPerStep must be an integer between 1 and 10.");
  }
}

export async function issueDirectExecutionAuthority(
  input: DirectAuthorityIssueInput,
): Promise<TrustedExecutionAuthorityIssueResult> {
  assertIssueWindow(input.expiresAt, input.compensationExpiresAt);
  assertBoundedScope(input.allowedActions, input.allowedTargets, input.maxAttemptsPerStep);
  if (!input.authenticatedUserId || !input.sourceTurnId || !input.sourceActionKind || !input.sourceActionKey) {
    throw new Error("Direct authority requires authenticated user, source turn, action kind, and stable source action key.");
  }
  const db = await database();
  return db.transaction(async (tx) => {
    const lockKey = `trusted-execution:direct:${input.authenticatedUserId}:${input.sourceActionKind}:${input.sourceActionKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [existing] = await tx.select().from(executionAuthorities).where(and(
      eq(executionAuthorities.userId, input.authenticatedUserId),
      eq(executionAuthorities.sourceActionKind, input.sourceActionKind),
      eq(executionAuthorities.sourceActionKey, input.sourceActionKey),
    )).limit(1);
    if (existing) {
      await audit(tx, {
        userId: input.authenticatedUserId,
        authorityId: existing.id,
        eventType: "trusted_source_action_deduplicated",
        metadata: { sourceActionKind: input.sourceActionKind },
      });
      return { authority: mapAuthority(existing), deduplicated: true };
    }
    const now = await databaseNow(tx);
    if (input.expiresAt <= now) throw new Error("Execution authority expiry elapsed before issuance.");
    const controls = await controlSnapshotInTransaction(tx, input.authenticatedUserId, true);
    if (controls.killSwitchEnabled || !controls.globalEnabled || !controls.userEnabled) {
      throw new Error("Trusted Execution is disabled for this user; use the legacy approval path.");
    }
    const idempotencyLineageId = authorityIdempotencyLineage(
      input.authenticatedUserId,
      input.sourceActionKind,
      input.sourceActionKey,
    );
    const [created] = await tx.insert(executionAuthorities).values({
      userId: input.authenticatedUserId,
      sourceType: "direct_command",
      sourceTurnId: input.sourceTurnId,
      sourceActionKind: input.sourceActionKind,
      sourceActionKey: input.sourceActionKey,
      globalExecutionEpoch: controls.globalEpoch,
      userExecutionEpoch: controls.userEpoch,
      originChannel: input.originChannel,
      taskId: input.taskId,
      intent: input.intent,
      allowedActions: uniqueStrings(input.allowedActions),
      allowedTargets: uniqueStrings(input.allowedTargets),
      riskTier: input.riskTier,
      maxAttemptsPerStep: input.maxAttemptsPerStep,
      idempotencyLineageId,
      expiresAt: input.expiresAt,
      compensationExpiresAt: input.compensationExpiresAt,
      auditMetadata: sanitizeAuditMetadata(input.auditMetadata),
    }).returning();
    await audit(tx, {
      userId: input.authenticatedUserId,
      authorityId: created.id,
      eventType: "execution_authority_issued",
      metadata: { sourceType: "direct_command", sourceActionKind: input.sourceActionKind },
    });
    return { authority: mapAuthority(created), deduplicated: false };
  });
}

function includesAll(allowed: string[], requested: string[]): boolean {
  const set = new Set(allowed);
  return requested.every((value) => set.has(value));
}

export async function issueStandingExecutionAuthority(
  input: StandingAuthorityIssueInput,
): Promise<TrustedExecutionAuthorityIssueResult> {
  assertIssueWindow(input.expiresAt, input.compensationExpiresAt);
  assertBoundedScope(input.requestedActions, input.requestedTargets, input.maxAttemptsPerStep);
  if (input.requestedActions.some((action) => /purchase|payment|financial|transfer/i.test(action))) {
    throw new Error("Standing grants cannot authorize a financial transaction.");
  }
  const db = await database();
  return db.transaction(async (tx) => {
    const lockKey = `trusted-execution:standing:${input.standingGrantId}:${input.triggerLineageId}:${input.triggerOccurrenceKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [existingOccurrence] = await tx.select().from(standingExecutionOccurrences).where(and(
      eq(standingExecutionOccurrences.grantId, input.standingGrantId),
      eq(standingExecutionOccurrences.triggerLineageId, input.triggerLineageId),
      eq(standingExecutionOccurrences.triggerOccurrenceKey, input.triggerOccurrenceKey),
    )).limit(1);
    if (existingOccurrence) {
      const [existingAuthority] = await tx.select().from(executionAuthorities)
        .where(eq(executionAuthorities.id, existingOccurrence.authorityId)).limit(1);
      if (!existingAuthority) throw new Error("Standing occurrence exists without its authority record.");
      await audit(tx, {
        userId: input.authenticatedUserId,
        authorityId: existingAuthority.id,
        eventType: "standing_grant_run_deduplicated",
      });
      return { authority: mapAuthority(existingAuthority), deduplicated: true };
    }
    const now = await databaseNow(tx);
    if (input.expiresAt <= now) throw new Error("Execution authority expiry elapsed before issuance.");
    const controls = await controlSnapshotInTransaction(tx, input.authenticatedUserId, true);
    if (controls.killSwitchEnabled || !controls.globalEnabled || !controls.userEnabled) {
      throw new Error("Trusted Execution is disabled for this user; standing execution is blocked.");
    }
    const [head] = await tx.select().from(standingExecutionGrantHeads)
      .where(eq(standingExecutionGrantHeads.id, input.standingGrantId)).limit(1).for("update");
    if (!head || head.userId !== input.authenticatedUserId) throw new Error("Standing grant is missing or owned by another user.");
    if (head.status !== "active" || head.pausedAt || head.revokedAt || head.expiresAt <= now) {
      throw new Error("Standing grant is not active.");
    }
    if (head.currentVersion !== input.expectedGrantVersion || head.stateRevision !== input.expectedStateRevision) {
      throw new Error("Standing grant revision is stale.");
    }
    if (head.triggerLineageId !== input.triggerLineageId) throw new Error("Standing trigger lineage does not match the live grant head.");
    if (!includesAll(head.allowedActions, input.requestedActions) || !includesAll(head.allowedTargets, input.requestedTargets)) {
      throw new Error("Standing occurrence exceeds the grant action or target scope.");
    }
    const [version] = await tx.select().from(standingExecutionGrantVersions).where(and(
      eq(standingExecutionGrantVersions.grantId, head.id),
      eq(standingExecutionGrantVersions.version, head.currentVersion),
    )).limit(1);
    if (!version || version.actorUserId !== input.authenticatedUserId || !version.consentSourceTurnId) {
      throw new Error("Standing grant lacks immutable authenticated consent provenance.");
    }
    const usageSnapshot: Record<string, unknown> = {};
    for (const request of input.usage) {
      const configuredLimit = Number(head.limits[request.limitKey]);
      if (!Number.isInteger(request.amount) || request.amount <= 0 || !Number.isFinite(configuredLimit) || configuredLimit < 0) {
        throw new Error(`Invalid standing usage request for ${request.limitKey}.`);
      }
      const charged = await tx.select({ total: sql<number>`coalesce(sum(${standingExecutionUsageAllocations.amount}), 0)::int` })
        .from(standingExecutionUsageAllocations)
        .where(and(
          eq(standingExecutionUsageAllocations.grantId, head.id),
          eq(standingExecutionUsageAllocations.limitKey, request.limitKey),
          eq(standingExecutionUsageAllocations.windowStart, request.windowStart),
          eq(standingExecutionUsageAllocations.windowEnd, request.windowEnd),
          inArray(standingExecutionUsageAllocations.status, ["reserved", "committed", "reconciliation_required"]),
        ));
      const chargedAmount = Number(charged[0]?.total ?? 0);
      if (chargedAmount + request.amount > configuredLimit) {
        throw new Error(`Standing grant limit exceeded for ${request.limitKey}.`);
      }
      usageSnapshot[request.limitKey] = {
        configuredLimit,
        chargedBefore: chargedAmount,
        reserved: request.amount,
        remaining: configuredLimit - chargedAmount - request.amount,
        windowStart: request.windowStart.toISOString(),
        windowEnd: request.windowEnd.toISOString(),
      };
    }
    const runId = randomUUID();
    const idempotencyLineageId = `te-standing-${sha256(`${head.id}\u0000${input.triggerLineageId}\u0000${input.triggerOccurrenceKey}`)}`;
    const [created] = await tx.insert(executionAuthorities).values({
      id: runId,
      userId: input.authenticatedUserId,
      sourceType: "standing_grant",
      standingGrantId: head.id,
      standingGrantVersion: head.currentVersion,
      standingGrantStateRevision: head.stateRevision,
      standingGrantCategory: head.category,
      standingGrantLimitSnapshot: head.limits,
      standingGrantConsentSourceTurnId: version.consentSourceTurnId,
      standingGrantTriggerLineageId: input.triggerLineageId,
      triggerOccurrenceKey: input.triggerOccurrenceKey,
      standingGrantUsageSnapshot: usageSnapshot,
      globalExecutionEpoch: controls.globalEpoch,
      userExecutionEpoch: controls.userEpoch,
      originChannel: input.originChannel,
      taskId: input.taskId,
      intent: input.intent,
      allowedActions: uniqueStrings(input.requestedActions),
      allowedTargets: uniqueStrings(input.requestedTargets),
      riskTier: input.riskTier,
      maxAttemptsPerStep: input.maxAttemptsPerStep,
      idempotencyLineageId,
      expiresAt: input.expiresAt,
      compensationExpiresAt: input.compensationExpiresAt,
      auditMetadata: sanitizeAuditMetadata(input.auditMetadata),
    }).returning();
    await tx.insert(standingExecutionOccurrences).values({
      grantId: head.id,
      triggerLineageId: input.triggerLineageId,
      triggerOccurrenceKey: input.triggerOccurrenceKey,
      authorityId: created.id,
    });
    if (input.usage.length) {
      await tx.insert(standingExecutionUsageAllocations).values(input.usage.map((request) => ({
        grantId: head.id,
        authorityId: created.id,
        limitKey: request.limitKey,
        windowStart: request.windowStart,
        windowEnd: request.windowEnd,
        amount: request.amount,
      })));
    }
    await audit(tx, {
      userId: input.authenticatedUserId,
      authorityId: created.id,
      eventType: "standing_grant_run_issued",
      metadata: { grantId: head.id, grantVersion: head.currentVersion, triggerLineageId: input.triggerLineageId },
    });
    return { authority: mapAuthority(created), deduplicated: false };
  });
}

function canonicalManifest(steps: Array<typeof authorityExecutionSteps.$inferSelect>): string {
  return JSON.stringify(steps
    .map((step) => ({
      stepKey: step.stepKey,
      action: step.action,
      targetFingerprint: step.targetFingerprint,
      role: step.role,
      dependsOnStepKeys: uniqueStrings(step.dependsOnStepKeys),
      compensatesStepKeys: uniqueStrings(step.compensatesStepKeys),
      compensationTriggers: uniqueStrings(step.compensationTriggers),
      maxAttempts: step.maxAttempts,
    }))
    .sort((a, b) => a.stepKey.localeCompare(b.stepKey)));
}

export async function registerAuthoritySteps(
  authenticatedUserId: string,
  authorityId: string,
  inputs: AuthorityStepInput[],
): Promise<AuthorityExecutionStepRecord[]> {
  if (!inputs.length) throw new Error("At least one execution step is required.");
  const db = await database();
  return db.transaction(async (tx) => {
    const [authority] = await tx.select().from(executionAuthorities)
      .where(eq(executionAuthorities.id, authorityId)).limit(1).for("update");
    if (!authority || authority.userId !== authenticatedUserId) throw new Error("Authority is missing or owned by another user.");
    if (authority.status !== "active" || authority.workflowPlanStatus !== "planning") {
      throw new Error("Only an active planning authority can register steps.");
    }
    const actionScope = new Set(authority.allowedActions);
    const targetScope = new Set(authority.allowedTargets);
    for (const input of inputs) {
      if (!input.stepKey.trim() || !actionScope.has(input.action) || !targetScope.has(input.targetFingerprint)) {
        throw new Error(`Step ${input.stepKey || "<missing>"} exceeds authority action or target scope.`);
      }
      if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > authority.maxAttemptsPerStep) {
        throw new Error(`Step ${input.stepKey} exceeds the parent attempt ceiling.`);
      }
      if (input.role === "compensation" && (!(input.compensatesStepKeys?.length) || !(input.compensationTriggers?.length))) {
        throw new Error(`Compensation step ${input.stepKey} requires referenced forward steps and triggers.`);
      }
      if (input.role === "forward" && ((input.compensatesStepKeys?.length ?? 0) > 0 || (input.compensationTriggers?.length ?? 0) > 0)) {
        throw new Error(`Forward step ${input.stepKey} cannot declare compensation metadata.`);
      }
      const idempotencyKey = `te-step-${sha256(`${authority.id}\u0000${input.stepKey}`)}`;
      await tx.insert(authorityExecutionSteps).values({
        authorityId: authority.id,
        stepKey: input.stepKey,
        action: input.action,
        targetFingerprint: input.targetFingerprint,
        idempotencyKey,
        role: input.role,
        dependsOnStepKeys: uniqueStrings(input.dependsOnStepKeys ?? []),
        compensatesStepKeys: uniqueStrings(input.compensatesStepKeys ?? []),
        compensationTriggers: uniqueStrings(input.compensationTriggers ?? []),
        maxAttempts: input.maxAttempts,
      }).onConflictDoNothing({ target: [authorityExecutionSteps.authorityId, authorityExecutionSteps.stepKey] });
    }
    const rows = await tx.select().from(authorityExecutionSteps)
      .where(eq(authorityExecutionSteps.authorityId, authority.id));
    for (const input of inputs) {
      const persisted = rows.find((row) => row.stepKey === input.stepKey);
      if (!persisted || persisted.action !== input.action || persisted.targetFingerprint !== input.targetFingerprint
        || persisted.role !== input.role || persisted.maxAttempts !== input.maxAttempts
        || JSON.stringify(uniqueStrings(persisted.dependsOnStepKeys)) !== JSON.stringify(uniqueStrings(input.dependsOnStepKeys ?? []))
        || JSON.stringify(uniqueStrings(persisted.compensatesStepKeys)) !== JSON.stringify(uniqueStrings(input.compensatesStepKeys ?? []))
        || JSON.stringify(uniqueStrings(persisted.compensationTriggers)) !== JSON.stringify(uniqueStrings(input.compensationTriggers ?? []))) {
        throw new Error(`Step key ${input.stepKey} is already registered with a different immutable definition.`);
      }
    }
    await audit(tx, {
      userId: authenticatedUserId,
      authorityId: authority.id,
      eventType: "authority_step_registered",
      metadata: { registeredStepKeys: uniqueStrings(inputs.map((step) => step.stepKey)) },
    });
    return rows.map(mapStep);
  });
}

export async function closeAuthorityManifest(
  authenticatedUserId: string,
  authorityId: string,
): Promise<ExecutionAuthorityRecord> {
  const db = await database();
  return db.transaction(async (tx) => {
    const [authority] = await tx.select().from(executionAuthorities)
      .where(eq(executionAuthorities.id, authorityId)).limit(1).for("update");
    if (!authority || authority.userId !== authenticatedUserId) throw new Error("Authority is missing or owned by another user.");
    const steps = await tx.select().from(authorityExecutionSteps)
      .where(eq(authorityExecutionSteps.authorityId, authority.id));
    if (!steps.length) throw new Error("Cannot close an empty execution manifest.");
    const keys = new Set(steps.map((step) => step.stepKey));
    for (const step of steps) {
      if (step.maxAttempts > authority.maxAttemptsPerStep) throw new Error(`Step ${step.stepKey} exceeds the parent attempt ceiling.`);
      for (const dependency of step.dependsOnStepKeys) {
        if (!keys.has(dependency) || dependency === step.stepKey) throw new Error(`Step ${step.stepKey} has an invalid dependency.`);
      }
      if (step.role === "compensation") {
        for (const referenced of step.compensatesStepKeys) {
          const target = steps.find((candidate) => candidate.stepKey === referenced);
          if (!target || target.role !== "forward") throw new Error(`Compensation step ${step.stepKey} references a missing forward step.`);
        }
      }
    }
    const dependencies = new Map(steps.map((step) => [step.stepKey, step.dependsOnStepKeys]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (stepKey: string): void => {
      if (visiting.has(stepKey)) throw new Error("Execution manifest contains a dependency cycle.");
      if (visited.has(stepKey)) return;
      visiting.add(stepKey);
      for (const dependency of dependencies.get(stepKey) ?? []) visit(dependency);
      visiting.delete(stepKey);
      visited.add(stepKey);
    };
    for (const step of steps) visit(step.stepKey);
    const manifestHash = `sha256:${sha256(canonicalManifest(steps))}`;
    if (authority.workflowPlanStatus === "closed") {
      if (authority.requiredStepManifestHash !== manifestHash) throw new Error("Closed authority manifest cannot be extended or rewritten.");
      return mapAuthority(authority);
    }
    const [closed] = await tx.update(executionAuthorities).set({
      workflowPlanStatus: "closed",
      requiredStepManifestHash: manifestHash,
      updatedAt: new Date(),
    }).where(and(
      eq(executionAuthorities.id, authority.id),
      eq(executionAuthorities.workflowPlanStatus, "planning"),
    )).returning();
    if (!closed) throw new Error("Authority manifest closure lost a concurrent race.");
    await audit(tx, {
      userId: authenticatedUserId,
      authorityId: authority.id,
      eventType: "authority_workflow_plan_closed",
      metadata: { manifestHash, stepCount: steps.length },
    });
    return mapAuthority(closed);
  });
}

export async function validateAuthorityForStep(input: AuthorityValidationInput): Promise<AuthorityValidationResult> {
  const db = await database();
  return db.transaction(async (tx) => {
    const now = input.now ?? await databaseNow(tx);
    const [authority] = await tx.select().from(executionAuthorities)
      .where(eq(executionAuthorities.id, input.authorityId)).limit(1);
    if (!authority) return { valid: false, code: "not_found", reason: "Authority was not found." };
    if (authority.userId !== input.authenticatedUserId) return { valid: false, code: "wrong_owner", reason: "Authority belongs to another user." };
    if (authority.status !== "active" && authority.status !== "compensating") return { valid: false, code: "inactive", reason: "Authority is terminal or inactive." };
    if (authority.workflowPlanStatus !== "closed") return { valid: false, code: "manifest_open", reason: "The external-step manifest is not closed." };
    if (authority.expiresAt <= now && authority.status === "active") return { valid: false, code: "expired", reason: "Forward authority has expired." };
    const controls = await controlSnapshotInTransaction(tx, authority.userId);
    if (controls.killSwitchEnabled || !controls.globalEnabled || !controls.userEnabled
      || authority.globalExecutionEpoch !== controls.globalEpoch
      || authority.userExecutionEpoch !== controls.userEpoch) {
      return { valid: false, code: "epoch_mismatch", reason: "Authority was invalidated by a Trusted Execution control change." };
    }
    try {
      await assertStandingGrantCurrent(tx, authority);
    } catch {
      return { valid: false, code: "inactive", reason: "Standing authority was invalidated by a grant lifecycle change." };
    }
    if (!authority.allowedActions.includes(input.action) || !authority.allowedTargets.includes(input.targetFingerprint)) {
      return { valid: false, code: "scope_mismatch", reason: "Requested action or target exceeds authority scope." };
    }
    const [step] = await tx.select().from(authorityExecutionSteps).where(and(
      eq(authorityExecutionSteps.authorityId, authority.id),
      eq(authorityExecutionSteps.stepKey, input.stepKey),
    )).limit(1);
    if (!step) return { valid: false, code: "step_not_manifested", reason: "Step is not in the closed manifest." };
    if (!["pending", "retryable_failed"].includes(step.status)) return { valid: false, code: "step_not_pending", reason: "Step is not eligible to start." };
    return {
      valid: true,
      code: "valid",
      reason: "Authority and manifested step are valid.",
      authorityId: authority.id,
      stepKey: step.stepKey,
      action: step.action,
      targetFingerprint: step.targetFingerprint,
    };
  });
}

export async function startAuthorityStepAttempt(input: {
  authenticatedUserId: string;
  authorityId: string;
  stepKey: string;
  leaseOwnerId: string;
  leaseDurationMs: number;
}): Promise<{ authority: ExecutionAuthorityRecord; step: AuthorityExecutionStepRecord; attempt: AuthorityExecutionAttemptRecord }> {
  const db = await database();
  return db.transaction(async (tx) => {
    const [authority] = await tx.select().from(executionAuthorities)
      .where(eq(executionAuthorities.id, input.authorityId)).limit(1).for("update");
    if (!authority || authority.userId !== input.authenticatedUserId) throw new Error("Authority is missing or owned by another user.");
    const controls = await controlSnapshotInTransaction(tx, authority.userId, true);
    if (controls.killSwitchEnabled || !controls.globalEnabled || !controls.userEnabled
      || controls.globalEpoch !== authority.globalExecutionEpoch || controls.userEpoch !== authority.userExecutionEpoch) {
      throw new Error("Authority was invalidated by a Trusted Execution control change.");
    }
    await assertStandingGrantCurrent(tx, authority);
    if (authority.workflowPlanStatus !== "closed") throw new Error("Cannot execute from an open manifest.");
    const [step] = await tx.select().from(authorityExecutionSteps).where(and(
      eq(authorityExecutionSteps.authorityId, authority.id),
      eq(authorityExecutionSteps.stepKey, input.stepKey),
    )).limit(1).for("update");
    if (!step || !["pending", "retryable_failed"].includes(step.status)) throw new Error("Step is missing or not eligible to start.");
    if (step.maxAttempts > authority.maxAttemptsPerStep || step.attemptCount >= step.maxAttempts) {
      throw new Error("Step attempt budget is exhausted or exceeds the parent ceiling.");
    }
    const now = await databaseNow(tx);
    if (step.role === "forward") {
      if (authority.status !== "active" || authority.forwardAdmissionStatus !== "open" || authority.expiresAt <= now) {
        throw new Error("Forward admission is closed or expired.");
      }
    } else if (authority.status !== "compensating" || step.compensationEligibility !== "executable" || authority.compensationExpiresAt <= now) {
      throw new Error("Compensation step is not executable within the recovery window.");
    }
    if (step.dependsOnStepKeys.length) {
      const dependencies = await tx.select().from(authorityExecutionSteps).where(and(
        eq(authorityExecutionSteps.authorityId, authority.id),
        inArray(authorityExecutionSteps.stepKey, step.dependsOnStepKeys),
      ));
      if (dependencies.length !== step.dependsOnStepKeys.length || dependencies.some((dependency) => dependency.status !== "consumed")) {
        throw new Error("Step dependencies are not consumed.");
      }
    }
    const attemptNumber = step.attemptCount + 1;
    const leaseGeneration = attemptNumber;
    const leaseExpiresAt = new Date(now.getTime() + Math.max(1_000, input.leaseDurationMs));
    const [attempt] = await tx.insert(authorityExecutionAttempts).values({
      authorityExecutionStepId: step.id,
      attemptNumber,
      leaseOwnerId: input.leaseOwnerId,
      leaseGeneration,
      leaseExpiresAt,
    }).returning();
    const [startedStep] = await tx.update(authorityExecutionSteps).set({
      attemptCount: attemptNumber,
      currentAttemptId: attempt.id,
      status: "consuming",
      startedAt: step.startedAt ?? now,
      updatedAt: now,
    }).where(eq(authorityExecutionSteps.id, step.id)).returning();
    await audit(tx, {
      userId: authority.userId,
      authorityId: authority.id,
      stepId: step.id,
      eventType: "authority_attempt_leased",
      targetFingerprint: step.targetFingerprint,
      metadata: { attemptNumber, leaseGeneration },
    });
    return { authority: mapAuthority(authority), step: mapStep(startedStep), attempt: mapAttempt(attempt) };
  });
}

export async function crossAuthorityStepBoundary(input: {
  authenticatedUserId: string;
  authorityId: string;
  stepKey: string;
  attemptId: string;
  leaseOwnerId: string;
  leaseGeneration: number;
}): Promise<{ idempotencyKey: string; fencingToken: number }> {
  const db = await database();
  return db.transaction(async (tx) => {
    const [authority] = await tx.select().from(executionAuthorities)
      .where(eq(executionAuthorities.id, input.authorityId)).limit(1).for("update");
    if (!authority || authority.userId !== input.authenticatedUserId) throw new Error("Authority is missing or owned by another user.");
    const controls = await controlSnapshotInTransaction(tx, authority.userId, true);
    if (controls.killSwitchEnabled || !controls.globalEnabled || !controls.userEnabled
      || controls.globalEpoch !== authority.globalExecutionEpoch || controls.userEpoch !== authority.userExecutionEpoch) {
      throw new Error("Authority was invalidated before the external boundary.");
    }
    await assertStandingGrantCurrent(tx, authority);
    const [step] = await tx.select().from(authorityExecutionSteps).where(and(
      eq(authorityExecutionSteps.authorityId, authority.id),
      eq(authorityExecutionSteps.stepKey, input.stepKey),
    )).limit(1).for("update");
    if (!step || step.status !== "consuming" || step.currentAttemptId !== input.attemptId) throw new Error("Attempt is not the current consuming step attempt.");
    const [attempt] = await tx.select().from(authorityExecutionAttempts)
      .where(eq(authorityExecutionAttempts.id, input.attemptId)).limit(1).for("update");
    const now = await databaseNow(tx);
    if (!attempt || attempt.status !== "leased" || attempt.boundaryState !== "not_started"
      || attempt.leaseOwnerId !== input.leaseOwnerId || attempt.leaseGeneration !== input.leaseGeneration
      || attempt.leaseExpiresAt <= now) {
      throw new Error("Attempt lease is stale, expired, or already crossed the boundary.");
    }
    if (step.role === "forward") {
      if (authority.status !== "active" || authority.forwardAdmissionStatus !== "open" || authority.expiresAt <= now) {
        throw new Error("Forward admission closed before the external boundary.");
      }
    } else if (authority.status !== "compensating" || step.compensationEligibility !== "executable" || authority.compensationExpiresAt <= now) {
      throw new Error("Compensation admission closed before the external boundary.");
    }
    const updated = await tx.update(authorityExecutionAttempts).set({
      boundaryState: "started",
      boundaryStartedAt: now,
    }).where(and(
      eq(authorityExecutionAttempts.id, attempt.id),
      eq(authorityExecutionAttempts.boundaryState, "not_started"),
      eq(authorityExecutionAttempts.leaseGeneration, input.leaseGeneration),
    )).returning();
    if (!updated.length) throw new Error("Attempt boundary compare-and-set failed.");
    await audit(tx, {
      userId: authority.userId,
      authorityId: authority.id,
      stepId: step.id,
      eventType: "authority_step_consuming",
      targetFingerprint: step.targetFingerprint,
      metadata: { attemptId: attempt.id, leaseGeneration: attempt.leaseGeneration },
    });
    return { idempotencyKey: step.idempotencyKey, fencingToken: attempt.leaseGeneration };
  });
}

export async function renewAuthorityStepAttemptLease(input: {
  authenticatedUserId: string;
  authorityId: string;
  stepKey: string;
  attemptId: string;
  leaseOwnerId: string;
  leaseGeneration: number;
  leaseDurationMs: number;
}): Promise<AuthorityExecutionAttemptRecord> {
  const db = await database();
  return db.transaction(async (tx) => {
    const [authority] = await tx.select().from(executionAuthorities)
      .where(eq(executionAuthorities.id, input.authorityId)).limit(1).for("update");
    if (!authority || authority.userId !== input.authenticatedUserId) throw new Error("Authority is missing or owned by another user.");
    const controls = await controlSnapshotInTransaction(tx, authority.userId, true);
    if (controls.killSwitchEnabled || !controls.globalEnabled || !controls.userEnabled
      || controls.globalEpoch !== authority.globalExecutionEpoch || controls.userEpoch !== authority.userExecutionEpoch) {
      throw new Error("Authority was invalidated before lease renewal.");
    }
    await assertStandingGrantCurrent(tx, authority);
    const [step] = await tx.select().from(authorityExecutionSteps).where(and(
      eq(authorityExecutionSteps.authorityId, authority.id),
      eq(authorityExecutionSteps.stepKey, input.stepKey),
    )).limit(1).for("update");
    if (!step || step.status !== "consuming" || step.currentAttemptId !== input.attemptId) throw new Error("Attempt is not current.");
    const now = await databaseNow(tx);
    const deadline = step.role === "forward" ? authority.expiresAt : authority.compensationExpiresAt;
    const proposedExpiry = new Date(Math.min(deadline.getTime(), now.getTime() + Math.max(1_000, input.leaseDurationMs)));
    const [renewed] = await tx.update(authorityExecutionAttempts).set({ leaseExpiresAt: proposedExpiry }).where(and(
      eq(authorityExecutionAttempts.id, input.attemptId),
      eq(authorityExecutionAttempts.leaseOwnerId, input.leaseOwnerId),
      eq(authorityExecutionAttempts.leaseGeneration, input.leaseGeneration),
      eq(authorityExecutionAttempts.boundaryState, "not_started"),
      eq(authorityExecutionAttempts.status, "leased"),
      sql`${authorityExecutionAttempts.leaseExpiresAt} > ${now}`,
      sql`${deadline} > ${now}`,
    )).returning();
    if (!renewed) throw new Error("Attempt lease is stale, expired, or already crossed the side-effect boundary.");
    return mapAttempt(renewed);
  });
}

export async function recoverExpiredAuthorityStepAttempt(input: {
  authenticatedUserId: string;
  authorityId: string;
  stepKey: string;
  attemptId: string;
  confirmedNoEffect: boolean;
  recoveryRef: string;
  now?: Date;
}): Promise<AuthorityExecutionStepRecord> {
  const db = await database();
  return db.transaction(async (tx) => {
    const [authority] = await tx.select().from(executionAuthorities)
      .where(eq(executionAuthorities.id, input.authorityId)).limit(1).for("update");
    if (!authority || authority.userId !== input.authenticatedUserId) throw new Error("Authority is missing or owned by another user.");
    const [step] = await tx.select().from(authorityExecutionSteps).where(and(
      eq(authorityExecutionSteps.authorityId, authority.id),
      eq(authorityExecutionSteps.stepKey, input.stepKey),
    )).limit(1).for("update");
    const [attempt] = await tx.select().from(authorityExecutionAttempts)
      .where(eq(authorityExecutionAttempts.id, input.attemptId)).limit(1).for("update");
    const now = input.now ?? await databaseNow(tx);
    if (!step || !attempt || step.currentAttemptId !== attempt.id || step.status !== "consuming"
      || attempt.status !== "leased" || attempt.leaseExpiresAt > now) {
      throw new Error("Attempt is not the current expired lease.");
    }
    const provenNoEffect = input.confirmedNoEffect && attempt.boundaryState === "not_started";
    const nextStatus = provenNoEffect
      ? step.attemptCount < step.maxAttempts ? "retryable_failed" : "failed"
      : "reconciliation_required";
    await tx.update(authorityExecutionAttempts).set({
      boundaryState: provenNoEffect ? "confirmed_no_effect" : "uncertain",
      status: provenNoEffect ? "abandoned" : "reconciliation_required",
      finishedAt: now,
    }).where(eq(authorityExecutionAttempts.id, attempt.id));
    const [recovered] = await tx.update(authorityExecutionSteps).set({
      status: nextStatus,
      recoveryRef: input.recoveryRef,
      updatedAt: now,
    }).where(eq(authorityExecutionSteps.id, step.id)).returning();
    if (!provenNoEffect) {
      await tx.update(executionAuthorities).set({ reconciliationStatus: "required", updatedAt: now })
        .where(eq(executionAuthorities.id, authority.id));
    } else if (nextStatus === "failed" && step.role === "forward") {
      await failForwardWorkflow(tx, authority, step.id, input.recoveryRef, now);
    }
    if (authority.sourceType === "standing_grant") {
      await tx.update(standingExecutionUsageAllocations).set({
        status: provenNoEffect ? "released" : "reconciliation_required",
        reconciliationOwner: provenNoEffect ? null : "trusted-execution-reconciler",
        reconciliationDeadline: provenNoEffect ? null : authority.compensationExpiresAt,
        recoveryRef: input.recoveryRef,
        updatedAt: now,
      }).where(and(
        eq(standingExecutionUsageAllocations.authorityId, authority.id),
        eq(standingExecutionUsageAllocations.status, "reserved"),
      ));
    }
    await audit(tx, {
      userId: authority.userId,
      authorityId: authority.id,
      stepId: step.id,
      eventType: provenNoEffect ? "authority_attempt_recovered_no_effect" : "authority_attempt_reconciliation_required",
      targetFingerprint: step.targetFingerprint,
      metadata: { attemptNumber: attempt.attemptNumber, recoveryRef: input.recoveryRef.slice(0, 256) },
    });
    return mapStep(recovered);
  });
}

export async function completeAuthorityStepAttempt(input: {
  authenticatedUserId: string;
  authorityId: string;
  stepKey: string;
  attemptId: string;
  outcome: "confirmed_effect" | "confirmed_no_effect" | "uncertain";
  resultRef?: string;
  recoveryRef?: string;
}): Promise<AuthorityExecutionStepRecord> {
  const db = await database();
  return db.transaction(async (tx) => {
    const [authority] = await tx.select().from(executionAuthorities)
      .where(eq(executionAuthorities.id, input.authorityId)).limit(1).for("update");
    if (!authority || authority.userId !== input.authenticatedUserId) throw new Error("Authority is missing or owned by another user.");
    const [step] = await tx.select().from(authorityExecutionSteps).where(and(
      eq(authorityExecutionSteps.authorityId, authority.id),
      eq(authorityExecutionSteps.stepKey, input.stepKey),
    )).limit(1).for("update");
    if (!step || step.currentAttemptId !== input.attemptId || step.status !== "consuming") throw new Error("Attempt is not current for the consuming step.");
    const [attempt] = await tx.select().from(authorityExecutionAttempts)
      .where(eq(authorityExecutionAttempts.id, input.attemptId)).limit(1).for("update");
    if (!attempt || !["not_started", "started"].includes(attempt.boundaryState)) throw new Error("Attempt is already resolved.");
    const now = await databaseNow(tx);
    if (input.outcome === "confirmed_effect" && attempt.boundaryState !== "started") {
      throw new Error("An effect cannot be confirmed before the boundary was durably started.");
    }
    let stepStatus: typeof authorityExecutionSteps.$inferInsert.status;
    let attemptStatus: typeof authorityExecutionAttempts.$inferInsert.status;
    if (input.outcome === "confirmed_effect") {
      stepStatus = "consumed";
      attemptStatus = "completed";
    } else if (input.outcome === "uncertain") {
      stepStatus = "reconciliation_required";
      attemptStatus = "reconciliation_required";
    } else if (step.attemptCount < step.maxAttempts) {
      stepStatus = "retryable_failed";
      attemptStatus = "abandoned";
    } else {
      stepStatus = "failed";
      attemptStatus = "abandoned";
    }
    await tx.update(authorityExecutionAttempts).set({
      boundaryState: input.outcome,
      status: attemptStatus,
      finishedAt: now,
    }).where(eq(authorityExecutionAttempts.id, attempt.id));
    const [updatedStep] = await tx.update(authorityExecutionSteps).set({
      status: stepStatus,
      resultRef: input.resultRef,
      recoveryRef: input.recoveryRef,
      consumedAt: stepStatus === "consumed" ? now : null,
      updatedAt: now,
    }).where(eq(authorityExecutionSteps.id, step.id)).returning();
    if (authority.sourceType === "standing_grant") {
      const allocationStatus = stepStatus === "consumed"
        ? "committed"
        : stepStatus === "reconciliation_required"
          ? "reconciliation_required"
          : "released";
      await tx.update(standingExecutionUsageAllocations).set({
        status: allocationStatus,
        authorityExecutionStepId: step.id,
        reconciliationOwner: allocationStatus === "reconciliation_required" ? "trusted-execution-reconciler" : null,
        reconciliationDeadline: allocationStatus === "reconciliation_required" ? authority.compensationExpiresAt : null,
        recoveryRef: input.recoveryRef,
        updatedAt: now,
      }).where(and(
        eq(standingExecutionUsageAllocations.authorityId, authority.id),
        eq(standingExecutionUsageAllocations.status, "reserved"),
      ));
    }
    if (stepStatus === "reconciliation_required") {
      await tx.update(executionAuthorities).set({ reconciliationStatus: "required", updatedAt: now })
        .where(eq(executionAuthorities.id, authority.id));
    }
    if (stepStatus === "failed" && step.role === "forward") {
      await failForwardWorkflow(tx, authority, step.id, input.recoveryRef ?? "forward_step_failed", now);
    } else if (stepStatus === "consumed") {
      await deriveSuccessfulCompletion(tx, authority.id, authority.userId, now);
    }
    await audit(tx, {
      userId: authority.userId,
      authorityId: authority.id,
      stepId: step.id,
      eventType: stepStatus === "consumed" ? "authority_step_consumed" : stepStatus === "reconciliation_required" ? "authority_step_reconciliation_required" : stepStatus === "failed" ? "authority_step_failed" : "authority_step_retryable_failed",
      targetFingerprint: step.targetFingerprint,
      metadata: { outcome: input.outcome, attemptNumber: attempt.attemptNumber },
    });
    return mapStep(updatedStep);
  });
}

async function deriveSuccessfulCompletion(tx: Transaction, authorityId: string, userId: string, now: Date): Promise<void> {
  const steps = await tx.select().from(authorityExecutionSteps)
    .where(eq(authorityExecutionSteps.authorityId, authorityId));
  const forward = steps.filter((step) => step.role === "forward");
  if (!forward.length || forward.some((step) => step.status !== "consumed")) return;
  const compensation = steps.filter((step) => step.role === "compensation");
  if (compensation.some((step) => ["consuming", "consumed", "failed", "reconciliation_required"].includes(step.status))) return;
  if (compensation.length) {
    await tx.update(authorityExecutionSteps).set({
      status: "skipped",
      compensationEligibility: "inapplicable",
      updatedAt: now,
    }).where(and(
      eq(authorityExecutionSteps.authorityId, authorityId),
      eq(authorityExecutionSteps.role, "compensation"),
      inArray(authorityExecutionSteps.status, ["pending", "retryable_failed"]),
    ));
  }
  await tx.update(executionAuthorities).set({
    status: "completed",
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(executionAuthorities.id, authorityId),
    eq(executionAuthorities.status, "active"),
  ));
  await audit(tx, { userId, authorityId, eventType: "execution_authority_completed" });
}

async function failForwardWorkflow(
  tx: Transaction,
  authority: typeof executionAuthorities.$inferSelect,
  failedStepId: string,
  recoveryRef: string,
  now: Date,
): Promise<void> {
  await tx.update(authorityExecutionSteps).set({ status: "cancelled", recoveryRef: "upstream_failure", updatedAt: now })
    .where(and(
      eq(authorityExecutionSteps.authorityId, authority.id),
      eq(authorityExecutionSteps.role, "forward"),
      inArray(authorityExecutionSteps.status, ["pending", "retryable_failed"]),
    ));
  const steps = await tx.select().from(authorityExecutionSteps)
    .where(eq(authorityExecutionSteps.authorityId, authority.id));
  if (!steps.some((step) => step.id === failedStepId)) throw new Error("Failed forward step disappeared during compensation classification.");
  const forwardByKey = new Map(steps.filter((step) => step.role === "forward").map((step) => [step.stepKey, step]));
  let compensationCanRun = false;
  for (const candidate of steps.filter((step) => step.role === "compensation")) {
    const triggerMatches = candidate.compensationTriggers.includes("forward_failure");
    const referenced = candidate.compensatesStepKeys.map((stepKey) => forwardByKey.get(stepKey)).filter(Boolean);
    const confirmedEffect = referenced.some((step) => step?.status === "consumed");
    const uncertainEffect = referenced.some((step) => ["consuming", "reconciliation_required"].includes(step?.status ?? ""));
    const compensationEligibility = triggerMatches && confirmedEffect
      ? "executable"
      : triggerMatches && uncertainEffect
        ? "awaiting_effect_reconciliation"
        : "inapplicable";
    compensationCanRun ||= compensationEligibility !== "inapplicable";
    await tx.update(authorityExecutionSteps).set({
      compensationEligibility,
      status: compensationEligibility === "inapplicable" ? "skipped" : candidate.status,
      updatedAt: now,
    }).where(eq(authorityExecutionSteps.id, candidate.id));
  }
  if (compensationCanRun) {
    await tx.update(executionAuthorities).set({
      status: "compensating",
      reconciliationStatus: steps.some((step) => step.status === "reconciliation_required") ? "required" : authority.reconciliationStatus,
      compensationReasons: uniqueStrings([...(authority.compensationReasons ?? []), "forward_failure"]),
      terminalReasonRef: recoveryRef,
      updatedAt: now,
    }).where(eq(executionAuthorities.id, authority.id));
  } else {
    await tx.update(executionAuthorities).set({
      status: "failed",
      compensationReasons: uniqueStrings([...(authority.compensationReasons ?? []), "forward_failure"]),
      terminalReasonRef: recoveryRef,
      failedAt: now,
      updatedAt: now,
    }).where(eq(executionAuthorities.id, authority.id));
  }
}

export async function cancelExecutionAuthority(
  authenticatedUserId: string,
  authorityId: string,
  reasonRef = "user_cancelled",
): Promise<ExecutionAuthorityRecord> {
  const db = await database();
  return db.transaction(async (tx) => {
    const [authority] = await tx.select().from(executionAuthorities)
      .where(eq(executionAuthorities.id, authorityId)).limit(1).for("update");
    if (!authority || authority.userId !== authenticatedUserId) throw new Error("Authority is missing or owned by another user.");
    if (["completed", "failed", "cancelled", "expired"].includes(authority.status)) return mapAuthority(authority);
    const now = await databaseNow(tx);
    const consumingSteps = await tx.select({ id: authorityExecutionSteps.id }).from(authorityExecutionSteps).where(and(
      eq(authorityExecutionSteps.authorityId, authority.id),
      eq(authorityExecutionSteps.status, "consuming"),
    ));
    const hasUncertainWork = consumingSteps.length > 0 || authority.reconciliationStatus === "required";
    await tx.update(authorityExecutionSteps).set({ status: "cancelled", recoveryRef: reasonRef, updatedAt: now })
      .where(and(
        eq(authorityExecutionSteps.authorityId, authority.id),
        inArray(authorityExecutionSteps.status, ["pending", "retryable_failed"]),
      ));
    await tx.update(authorityExecutionSteps).set({ status: "reconciliation_required", recoveryRef: reasonRef, updatedAt: now })
      .where(and(
        eq(authorityExecutionSteps.authorityId, authority.id),
        eq(authorityExecutionSteps.status, "consuming"),
      ));
    if (authority.sourceType === "standing_grant") {
      await tx.update(standingExecutionUsageAllocations).set({
        status: sql`CASE WHEN ${standingExecutionUsageAllocations.status} = 'reserved' THEN ${hasUncertainWork ? "reconciliation_required" : "released"} ELSE ${standingExecutionUsageAllocations.status} END`,
        reconciliationOwner: hasUncertainWork ? "trusted-execution-reconciler" : null,
        reconciliationDeadline: hasUncertainWork ? authority.compensationExpiresAt : null,
        recoveryRef: reasonRef,
        updatedAt: now,
      }).where(eq(standingExecutionUsageAllocations.authorityId, authority.id));
    }
    const [cancelled] = await tx.update(executionAuthorities).set({
      status: "cancelled",
      reconciliationStatus: hasUncertainWork ? "required" : authority.reconciliationStatus,
      terminalReasonRef: reasonRef,
      cancelledAt: now,
      updatedAt: now,
    }).where(eq(executionAuthorities.id, authority.id)).returning();
    await audit(tx, { userId: authority.userId, authorityId: authority.id, eventType: "execution_authority_cancelled", metadata: { reasonRef } });
    return mapAuthority(cancelled);
  });
}

export async function setTrustedExecutionUserEnabled(
  authenticatedUserId: string,
  enabled: boolean,
): Promise<TrustedExecutionControlSnapshot> {
  const db = await database();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`trusted-execution:user-control:${authenticatedUserId}`}, 0))`);
    const [current] = await tx.select().from(trustedExecutionUserControls)
      .where(eq(trustedExecutionUserControls.userId, authenticatedUserId)).limit(1).for("update");
    const nextEpoch = enabled ? current?.executionEpoch ?? 0 : (current?.executionEpoch ?? 0) + 1;
    await tx.insert(trustedExecutionUserControls).values({
      userId: authenticatedUserId,
      enabled,
      executionEpoch: nextEpoch,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: trustedExecutionUserControls.userId,
      set: { enabled, executionEpoch: nextEpoch, updatedAt: new Date() },
    });
    if (!enabled) await invalidateAuthoritiesForControl(tx, authenticatedUserId, "trusted_execution_user_disabled");
    return controlSnapshotInTransaction(tx, authenticatedUserId);
  });
}

export async function setTrustedExecutionGlobalControl(input: {
  enabled?: boolean;
  killSwitchEnabled?: boolean;
}): Promise<void> {
  const db = await database();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('trusted-execution:global-control', 0))`);
    const [current] = await tx.select().from(trustedExecutionGlobalControls)
      .where(eq(trustedExecutionGlobalControls.id, "global")).limit(1).for("update");
    const enabled = input.enabled ?? current?.enabled ?? false;
    const killSwitchEnabled = input.killSwitchEnabled ?? current?.killSwitchEnabled ?? false;
    const disabling = Boolean(input.enabled === false || input.killSwitchEnabled === true);
    const executionEpoch = (current?.executionEpoch ?? 0) + (disabling ? 1 : 0);
    await tx.insert(trustedExecutionGlobalControls).values({
      id: "global",
      enabled,
      killSwitchEnabled,
      executionEpoch,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: trustedExecutionGlobalControls.id,
      set: { enabled, killSwitchEnabled, executionEpoch, updatedAt: new Date() },
    });
    if (disabling) await invalidateAuthoritiesForControl(tx, undefined, "trusted_execution_global_disabled");
  });
}

async function invalidateAuthoritiesForControl(
  tx: Transaction,
  userId: string | undefined,
  reasonRef: string,
): Promise<void> {
  const now = await databaseNow(tx);
  const authorityPredicate = userId
    ? and(eq(executionAuthorities.userId, userId), inArray(executionAuthorities.status, ["active", "compensating"]))
    : inArray(executionAuthorities.status, ["active", "compensating"]);
  const active = await tx.select({
    id: executionAuthorities.id,
    userId: executionAuthorities.userId,
    compensationExpiresAt: executionAuthorities.compensationExpiresAt,
  })
    .from(executionAuthorities).where(authorityPredicate);
  if (!active.length) return;
  const ids = active.map((authority) => authority.id);
  const uncertain = await tx.select({ authorityId: authorityExecutionSteps.authorityId })
    .from(authorityExecutionSteps).where(and(
      inArray(authorityExecutionSteps.authorityId, ids),
      inArray(authorityExecutionSteps.status, ["consuming", "reconciliation_required"]),
    ));
  const uncertainAuthorityIds = new Set(uncertain.map((step) => step.authorityId));
  await tx.update(authorityExecutionSteps).set({ status: "cancelled", recoveryRef: reasonRef, updatedAt: now })
    .where(and(
      inArray(authorityExecutionSteps.authorityId, ids),
      inArray(authorityExecutionSteps.status, ["pending", "retryable_failed"]),
    ));
  await tx.update(authorityExecutionSteps).set({ status: "reconciliation_required", recoveryRef: reasonRef, updatedAt: now })
    .where(and(
      inArray(authorityExecutionSteps.authorityId, ids),
      eq(authorityExecutionSteps.status, "consuming"),
    ));
  for (const authority of active) {
    const needsReconciliation = uncertainAuthorityIds.has(authority.id);
    await tx.update(standingExecutionUsageAllocations).set({
      status: sql`CASE WHEN ${standingExecutionUsageAllocations.status} = 'reserved' THEN ${needsReconciliation ? "reconciliation_required" : "released"} ELSE ${standingExecutionUsageAllocations.status} END`,
      reconciliationOwner: needsReconciliation ? "trusted-execution-reconciler" : null,
      reconciliationDeadline: needsReconciliation ? authority.compensationExpiresAt : null,
      recoveryRef: reasonRef,
      updatedAt: now,
    }).where(eq(standingExecutionUsageAllocations.authorityId, authority.id));
    await tx.update(executionAuthorities).set({
      status: "cancelled",
      reconciliationStatus: needsReconciliation ? "required" : "none",
      terminalReasonRef: reasonRef,
      cancelledAt: now,
      updatedAt: now,
    }).where(eq(executionAuthorities.id, authority.id));
  }
  for (const authority of active) {
    await audit(tx, { userId: authority.userId, authorityId: authority.id, eventType: reasonRef });
  }
}
