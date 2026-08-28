import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  authorityExecutionSteps,
  executionAuthorities,
  standingExecutionGrantHeads,
  standingExecutionGrantVersions,
  standingExecutionUsageAllocations,
  trustedExecutionAuditEvents,
} from "@shared/schema";

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

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function validateLimits(limits: Record<string, number>): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(limits)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || !Number.isInteger(value) || value < 0) {
      throw new Error("Standing-grant limits require non-negative integer values and stable keys.");
    }
    normalized[normalizedKey] = value;
  }
  if (!Object.keys(normalized).length) throw new Error("Standing grants require at least one explicit limit.");
  return normalized;
}

export interface StandingGrantConsentInput {
  authenticatedUserId: string;
  consentSourceTurnId: string;
  sourceActionKind: string;
  sourceActionKey: string;
  category: string;
  triggerLineageId: string;
  allowedActions: string[];
  allowedTargets: string[];
  limits: Record<string, number>;
  effectiveFrom: Date;
  expiresAt: Date;
}

export interface StandingGrantMutationInput extends StandingGrantConsentInput {
  grantId: string;
  expectedVersion: number;
  expectedStateRevision: number;
}

export interface StandingGrantResult {
  grantId: string;
  version: number;
  stateRevision: number;
  deduplicated: boolean;
}

function validateConsent(input: StandingGrantConsentInput): void {
  if (!input.authenticatedUserId || !input.consentSourceTurnId || !input.sourceActionKind || !input.sourceActionKey) {
    throw new Error("Standing-grant mutation requires a current authenticated consent turn and stable source action key.");
  }
  if (!input.category.trim() || !input.triggerLineageId.trim()) throw new Error("Standing grant requires category and trigger lineage.");
  if (!unique(input.allowedActions).length || !unique(input.allowedTargets).length) throw new Error("Standing grant requires bounded action and target scopes.");
  if (input.allowedActions.some((action) => /purchase|payment|financial|transfer/i.test(action))) {
    throw new Error("Standing grants cannot include financial transactions.");
  }
  validateLimits(input.limits);
  if (input.expiresAt <= input.effectiveFrom || input.expiresAt <= new Date()) throw new Error("Standing grant requires a future bounded expiry.");
}

async function audit(tx: Transaction, userId: string, eventType: string, metadata: Record<string, unknown>): Promise<void> {
  await tx.insert(trustedExecutionAuditEvents).values({ userId, eventType, metadata });
}

export async function createStandingExecutionGrant(input: StandingGrantConsentInput): Promise<StandingGrantResult> {
  validateConsent(input);
  const db = await database();
  return db.transaction(async (tx) => {
    const now = await databaseNow(tx);
    if (input.expiresAt <= now) throw new Error("Standing grant expiry elapsed before creation.");
    const lockKey = `trusted-execution:grant-consent:${input.authenticatedUserId}:${input.sourceActionKind}:${input.sourceActionKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [duplicate] = await tx.select().from(standingExecutionGrantVersions).where(and(
      eq(standingExecutionGrantVersions.userId, input.authenticatedUserId),
      eq(standingExecutionGrantVersions.sourceActionKind, input.sourceActionKind),
      eq(standingExecutionGrantVersions.sourceActionKey, input.sourceActionKey),
    )).limit(1);
    if (duplicate) {
      const [head] = await tx.select().from(standingExecutionGrantHeads)
        .where(eq(standingExecutionGrantHeads.id, duplicate.grantId)).limit(1);
      if (!head) throw new Error("Grant consent record exists without its mutable head.");
      await audit(tx, input.authenticatedUserId, "trusted_source_action_deduplicated", { grantId: head.id, version: duplicate.version });
      return { grantId: head.id, version: duplicate.version, stateRevision: head.stateRevision, deduplicated: true };
    }
    const grantId = randomUUID();
    const actions = unique(input.allowedActions);
    const targets = unique(input.allowedTargets);
    const limits = validateLimits(input.limits);
    const [head] = await tx.insert(standingExecutionGrantHeads).values({
      id: grantId,
      userId: input.authenticatedUserId,
      category: input.category.trim(),
      triggerLineageId: input.triggerLineageId.trim(),
      allowedActions: actions,
      allowedTargets: targets,
      limits,
      expiresAt: input.expiresAt,
    }).returning();
    await tx.insert(standingExecutionGrantVersions).values({
      grantId,
      userId: input.authenticatedUserId,
      version: 1,
      actorUserId: input.authenticatedUserId,
      consentSourceTurnId: input.consentSourceTurnId,
      sourceActionKind: input.sourceActionKind,
      sourceActionKey: input.sourceActionKey,
      category: input.category.trim(),
      triggerLineageId: input.triggerLineageId.trim(),
      allowedActions: actions,
      allowedTargets: targets,
      limits,
      effectiveFrom: input.effectiveFrom,
    });
    await audit(tx, input.authenticatedUserId, "standing_grant_created", { grantId, version: 1, category: input.category.trim() });
    return { grantId, version: 1, stateRevision: head.stateRevision, deduplicated: false };
  });
}

export async function replaceStandingExecutionGrant(input: StandingGrantMutationInput): Promise<StandingGrantResult> {
  validateConsent(input);
  const db = await database();
  return db.transaction(async (tx) => {
    const now = await databaseNow(tx);
    if (input.expiresAt <= now) throw new Error("Standing grant expiry elapsed before replacement.");
    const lockKey = `trusted-execution:grant-consent:${input.authenticatedUserId}:${input.sourceActionKind}:${input.sourceActionKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [duplicate] = await tx.select().from(standingExecutionGrantVersions).where(and(
      eq(standingExecutionGrantVersions.userId, input.authenticatedUserId),
      eq(standingExecutionGrantVersions.sourceActionKind, input.sourceActionKind),
      eq(standingExecutionGrantVersions.sourceActionKey, input.sourceActionKey),
    )).limit(1);
    if (duplicate) {
      const [head] = await tx.select().from(standingExecutionGrantHeads)
        .where(eq(standingExecutionGrantHeads.id, duplicate.grantId)).limit(1);
      if (!head || head.id !== input.grantId) throw new Error("Consent source action is already bound to another grant.");
      return { grantId: head.id, version: duplicate.version, stateRevision: head.stateRevision, deduplicated: true };
    }
    const [head] = await tx.select().from(standingExecutionGrantHeads)
      .where(eq(standingExecutionGrantHeads.id, input.grantId)).limit(1).for("update");
    if (!head || head.userId !== input.authenticatedUserId) throw new Error("Standing grant is missing or owned by another user.");
    if (head.currentVersion !== input.expectedVersion || head.stateRevision !== input.expectedStateRevision) {
      throw new Error("Standing grant mutation used a stale version or revision.");
    }
    if (!["active", "paused"].includes(head.status)) throw new Error("Revoked, expired, or replaced standing grants cannot be reactivated.");
    if (input.triggerLineageId !== head.triggerLineageId && input.effectiveFrom <= now) {
      throw new Error("A new logical trigger lineage requires a future nonoverlapping effective boundary.");
    }
    const limits = validateLimits(input.limits);
    const charged = await tx.select({
      limitKey: standingExecutionUsageAllocations.limitKey,
      total: sql<number>`coalesce(sum(${standingExecutionUsageAllocations.amount}), 0)::int`,
    }).from(standingExecutionUsageAllocations).where(and(
      eq(standingExecutionUsageAllocations.grantId, head.id),
      inArray(standingExecutionUsageAllocations.status, ["reserved", "committed", "reconciliation_required"]),
    )).groupBy(standingExecutionUsageAllocations.limitKey);
    for (const usage of charged) {
      if (!(usage.limitKey in limits)) {
        throw new Error(`Cannot remove active limit ${usage.limitKey} while charged usage exists.`);
      }
    }
    const nextVersion = head.currentVersion + 1;
    const nextRevision = head.stateRevision + 1;
    await tx.update(standingExecutionGrantVersions).set({ effectiveThrough: input.effectiveFrom })
      .where(and(
        eq(standingExecutionGrantVersions.grantId, head.id),
        eq(standingExecutionGrantVersions.version, head.currentVersion),
      ));
    await tx.insert(standingExecutionGrantVersions).values({
      grantId: head.id,
      userId: input.authenticatedUserId,
      version: nextVersion,
      actorUserId: input.authenticatedUserId,
      consentSourceTurnId: input.consentSourceTurnId,
      sourceActionKind: input.sourceActionKind,
      sourceActionKey: input.sourceActionKey,
      category: input.category.trim(),
      triggerLineageId: input.triggerLineageId.trim(),
      allowedActions: unique(input.allowedActions),
      allowedTargets: unique(input.allowedTargets),
      limits,
      effectiveFrom: input.effectiveFrom,
    });
    await tx.update(standingExecutionGrantHeads).set({
      status: "active",
      category: input.category.trim(),
      currentVersion: nextVersion,
      stateRevision: nextRevision,
      triggerLineageId: input.triggerLineageId.trim(),
      allowedActions: unique(input.allowedActions),
      allowedTargets: unique(input.allowedTargets),
      limits,
      expiresAt: input.expiresAt,
      pausedAt: null,
      updatedAt: now,
    }).where(eq(standingExecutionGrantHeads.id, head.id));
    await cancelUnstartedGrantAuthorities(tx, head.id, "grant_replaced");
    await audit(tx, input.authenticatedUserId, "standing_grant_replaced", {
      grantId: head.id,
      previousVersion: head.currentVersion,
      version: nextVersion,
      chargedUsage: Object.fromEntries(charged.map((entry) => [entry.limitKey, Number(entry.total)])),
    });
    return { grantId: head.id, version: nextVersion, stateRevision: nextRevision, deduplicated: false };
  });
}

export async function setStandingExecutionGrantState(input: {
  authenticatedUserId: string;
  grantId: string;
  expectedStateRevision: number;
  action: "pause" | "revoke";
}): Promise<{ stateRevision: number; status: string }> {
  const db = await database();
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(standingExecutionGrantHeads)
      .where(eq(standingExecutionGrantHeads.id, input.grantId)).limit(1).for("update");
    if (!head || head.userId !== input.authenticatedUserId) throw new Error("Standing grant is missing or owned by another user.");
    if (head.stateRevision !== input.expectedStateRevision) throw new Error("Standing grant state mutation used a stale revision.");
    const now = await databaseNow(tx);
    const stateRevision = head.stateRevision + 1;
    const status = input.action === "pause" ? "paused" : "revoked";
    await tx.update(standingExecutionGrantHeads).set({
      status,
      stateRevision,
      pausedAt: input.action === "pause" ? now : head.pausedAt,
      revokedAt: input.action === "revoke" ? now : head.revokedAt,
      updatedAt: now,
    }).where(eq(standingExecutionGrantHeads.id, head.id));
    await cancelUnstartedGrantAuthorities(tx, head.id, `grant_${status}`);
    await audit(tx, input.authenticatedUserId, input.action === "pause" ? "standing_grant_paused" : "standing_grant_revoked", {
      grantId: head.id,
      stateRevision,
    });
    return { stateRevision, status };
  });
}

async function cancelUnstartedGrantAuthorities(tx: Transaction, grantId: string, reasonRef: string): Promise<void> {
  const authorities = await tx.select({
    id: executionAuthorities.id,
    compensationExpiresAt: executionAuthorities.compensationExpiresAt,
  })
    .from(executionAuthorities).where(and(
      eq(executionAuthorities.standingGrantId, grantId),
      inArray(executionAuthorities.status, ["active", "compensating"]),
    ));
  if (!authorities.length) return;
  const ids = authorities.map((authority) => authority.id);
  const now = await databaseNow(tx);
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
  for (const authority of authorities) {
    const needsReconciliation = uncertainAuthorityIds.has(authority.id);
    await tx.update(standingExecutionUsageAllocations).set({
      status: sql`CASE
        WHEN ${standingExecutionUsageAllocations.status} = 'reserved' THEN ${needsReconciliation ? "reconciliation_required" : "released"}
        ELSE ${standingExecutionUsageAllocations.status}
      END`,
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
}
