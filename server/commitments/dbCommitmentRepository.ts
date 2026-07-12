import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import * as schema from "@shared/schema";
import { db } from "../db";
import {
  PERSONAL_COMMITMENT_KINDS,
  appendCommitmentRevision,
  createOrMergeCommitment,
  parseCommitmentKind,
  parseCommitmentSignalLevel,
  rescopeCommitmentDedupeKey,
  resolveCommitmentSemantics,
  scopedCommitmentDedupeKey,
  type CommitmentKind,
  type CommitmentPersistenceValues,
  type CommitmentRepository,
  type CommitmentSignalLevel,
  type CommitmentUpdateValues,
  type CommitmentWriteInput,
  type CommitmentWriteResult,
  type StoredCommitment,
} from "./commitmentStore";

type CommitmentRow = typeof schema.commitments.$inferSelect;
type CommitmentDbClient = Pick<typeof db, "select" | "insert" | "update">;

function toStoredCommitment(row: CommitmentRow): StoredCommitment {
  const semantics = resolveCommitmentSemantics({
    content: row.content,
    sourceType: row.sourceType,
    commitmentKind: row.commitmentKind,
    signalLevel: row.signalLevel,
  });
  return {
    id: row.id,
    userId: row.userId,
    content: row.content,
    dueDate: row.dueDate,
    status: "pending",
    dedupeKey: row.dedupeKey || scopedCommitmentDedupeKey(semantics.commitmentKind, row.content),
    sourceMessage: row.sourceMessage,
    updatedAt: row.updatedAt,
    history: Array.isArray(row.history) ? row.history : [],
    ...semantics,
  };
}

export function personalCommitmentCondition(userId: string) {
  return and(
    eq(schema.commitments.userId, userId),
    inArray(schema.commitments.commitmentKind, [...PERSONAL_COMMITMENT_KINDS]),
    eq(schema.commitments.signalLevel, "normal"),
  );
}

export function pendingPersonalCommitmentCondition(userId: string) {
  return and(
    personalCommitmentCondition(userId),
    eq(schema.commitments.status, "pending"),
  );
}

export function pendingCommitmentCondition(userId: string) {
  return and(
    eq(schema.commitments.userId, userId),
    eq(schema.commitments.status, "pending"),
  );
}

export async function listPendingPersonalCommitments(
  userId: string,
  limit?: number,
): Promise<CommitmentRow[]> {
  const query = db
    .select()
    .from(schema.commitments)
    .where(pendingPersonalCommitmentCondition(userId))
    .orderBy(desc(schema.commitments.updatedAt));
  return typeof limit === "number" ? query.limit(limit) : query;
}

export async function listPendingCommitmentsForReview(
  userId: string,
  limit?: number,
): Promise<CommitmentRow[]> {
  const query = db
    .select()
    .from(schema.commitments)
    .where(pendingCommitmentCondition(userId))
    .orderBy(desc(schema.commitments.updatedAt));
  return typeof limit === "number" ? query.limit(limit) : query;
}

function commitmentRepositoryFor(client: CommitmentDbClient): CommitmentRepository {
  return {
    async findPendingByDedupeKey(userId, dedupeKey) {
      const [row] = await client
        .select()
        .from(schema.commitments)
        .where(and(
          eq(schema.commitments.userId, userId),
          eq(schema.commitments.status, "pending"),
          eq(schema.commitments.dedupeKey, dedupeKey),
        ))
        .orderBy(desc(schema.commitments.updatedAt))
        .limit(1);
      return row ? toStoredCommitment(row) : null;
    },

    async insert(values: CommitmentPersistenceValues) {
      const [row] = await client
        .insert(schema.commitments)
        .values(values)
        .returning();
      if (!row) throw new Error("Commitment insert did not return a row.");
      return toStoredCommitment(row);
    },

    async update(id: string, values: CommitmentUpdateValues) {
      const [row] = await client
        .update(schema.commitments)
        .set(values)
        .where(eq(schema.commitments.id, id))
        .returning();
      if (!row) throw new Error(`Commitment ${id} was not found during merge.`);
      return toStoredCommitment(row);
    },
  };
}

export const dbCommitmentRepository = commitmentRepositoryFor(db);

export async function createOrMergeCommitmentInDb(
  input: CommitmentWriteInput,
): Promise<CommitmentWriteResult> {
  const dedupeKey = scopedCommitmentDedupeKey(input.commitmentKind, input.content, input.dedupeKey);
  const lockKey = `${input.userId.trim()}:${dedupeKey}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    return createOrMergeCommitment(input, commitmentRepositoryFor(tx));
  });
}

export interface CommitmentMutationInput {
  userId: string;
  id: string;
  status?: "done" | "skipped" | "pending";
  commitmentKind?: CommitmentKind;
  signalLevel?: CommitmentSignalLevel;
  includeNonPersonal?: boolean;
  requirePending?: boolean;
}

export class CommitmentDedupeConflictError extends Error {
  constructor(public readonly conflictingCommitmentId: string) {
    super("Another pending commitment already owns the requested topic and kind.");
    this.name = "CommitmentDedupeConflictError";
  }
}

export async function updateCommitmentInDb(
  input: CommitmentMutationInput,
): Promise<CommitmentRow | null> {
  const lockKey = `${input.userId.trim()}:commitment:${input.id}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const ownership = input.includeNonPersonal
      ? eq(schema.commitments.userId, input.userId)
      : personalCommitmentCondition(input.userId);
    let [row] = await tx
      .select()
      .from(schema.commitments)
      .where(and(
        eq(schema.commitments.id, input.id),
        ownership,
        input.requirePending ? eq(schema.commitments.status, "pending") : undefined,
      ))
      .limit(1);
    if (!row) return null;

    const requestedKind = input.commitmentKind ?? parseCommitmentKind(row.commitmentKind) ?? "user_commitment";
    const currentKey = row.dedupeKey || scopedCommitmentDedupeKey(requestedKind, row.content);
    const requestedKey = rescopeCommitmentDedupeKey(requestedKind, currentKey, row.content);
    for (const dedupeKey of [...new Set([currentKey, requestedKey])].sort()) {
      const dedupeLockKey = `${input.userId.trim()}:${dedupeKey}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${dedupeLockKey}, 0))`);
    }

    [row] = await tx
      .select()
      .from(schema.commitments)
      .where(and(
        eq(schema.commitments.id, input.id),
        ownership,
        input.requirePending ? eq(schema.commitments.status, "pending") : undefined,
      ))
      .limit(1);
    if (!row) return null;

    const commitmentKind = input.commitmentKind ?? parseCommitmentKind(row.commitmentKind) ?? "user_commitment";
    const signalLevel = input.signalLevel ?? parseCommitmentSignalLevel(row.signalLevel) ?? "normal";
    const status = input.status ?? row.status;
    const targetKey = rescopeCommitmentDedupeKey(commitmentKind, row.dedupeKey, row.content);
    if (status === "pending") {
      const [conflict] = await tx
        .select({ id: schema.commitments.id })
        .from(schema.commitments)
        .where(and(
          eq(schema.commitments.userId, input.userId),
          eq(schema.commitments.status, "pending"),
          eq(schema.commitments.dedupeKey, targetKey),
          ne(schema.commitments.id, input.id),
        ))
        .limit(1);
      if (conflict) throw new CommitmentDedupeConflictError(conflict.id);
    }
    const classificationChanged = commitmentKind !== row.commitmentKind || signalLevel !== row.signalLevel;
    const statusChanged = status !== row.status;
    const revision = {
      content: row.content,
      dueDate: row.dueDate,
      status: row.status,
      commitmentKind: row.commitmentKind,
      signalLevel: row.signalLevel,
      dedupeKey: row.dedupeKey || scopedCommitmentDedupeKey(commitmentKind, row.content),
      sourceType: row.sourceType,
      sourceMessage: row.sourceMessage,
      recordedAt: row.updatedAt.toISOString(),
    };
    const [updated] = await tx
      .update(schema.commitments)
      .set({
        status,
        resolvedAt: statusChanged ? (status === "pending" ? null : new Date()) : row.resolvedAt,
        commitmentKind,
        signalLevel,
        dedupeKey: targetKey,
        updatedAt: new Date(),
        history: classificationChanged || statusChanged
          ? appendCommitmentRevision(row.history, revision)
          : row.history,
      })
      .where(and(eq(schema.commitments.id, input.id), eq(schema.commitments.userId, input.userId)))
      .returning();
    return updated ?? null;
  });
}
