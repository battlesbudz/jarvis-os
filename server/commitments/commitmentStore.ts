import { createHash } from "node:crypto";
import type { CommitmentRevision } from "@shared/schema";

export const COMMITMENT_KINDS = [
  "user_commitment",
  "user_task",
  "operational_incident",
  "notification",
] as const;

export const COMMITMENT_SIGNAL_LEVELS = ["normal", "low"] as const;
export const PERSONAL_COMMITMENT_KINDS = ["user_commitment", "user_task"] as const;
export const MAX_COMMITMENT_HISTORY_REVISIONS = 20;

export type CommitmentKind = typeof COMMITMENT_KINDS[number];
export type CommitmentSignalLevel = typeof COMMITMENT_SIGNAL_LEVELS[number];

export interface CommitmentSemanticsInput {
  content: string;
  sourceType?: unknown;
  commitmentKind?: unknown;
  signalLevel?: unknown;
}

export interface CommitmentSemantics {
  commitmentKind: CommitmentKind;
  signalLevel: CommitmentSignalLevel;
  sourceType: string;
}

export interface CommitmentWriteInput {
  userId: string;
  content: string;
  commitmentKind: CommitmentKind;
  signalLevel: CommitmentSignalLevel;
  sourceType: string;
  dueDate?: string | null;
  dedupeKey?: string | null;
  sourceMessage?: string | null;
}

export interface CommitmentPersistenceValues extends CommitmentSemantics {
  userId: string;
  content: string;
  dueDate: string | null;
  status: "pending";
  dedupeKey: string;
  sourceMessage: string | null;
  updatedAt: Date;
  history: CommitmentRevision[];
}

export interface StoredCommitment extends CommitmentPersistenceValues {
  id: string;
}

export type CommitmentUpdateValues = Omit<CommitmentPersistenceValues, "userId" | "status">;

export interface CommitmentRepository {
  findPendingByDedupeKey(userId: string, dedupeKey: string): Promise<StoredCommitment | null>;
  insert(values: CommitmentPersistenceValues): Promise<StoredCommitment>;
  update(id: string, values: CommitmentUpdateValues): Promise<StoredCommitment>;
}

export interface CommitmentWriteResult {
  action: "created" | "merged";
  commitment: StoredCommitment;
}

function enumValue<T extends readonly string[]>(values: T, value: unknown): T[number] | undefined {
  return typeof value === "string" && values.includes(value.trim() as T[number])
    ? value.trim() as T[number]
    : undefined;
}

export function parseCommitmentKind(value: unknown): CommitmentKind | null {
  return enumValue(COMMITMENT_KINDS, value) ?? null;
}

export function parseCommitmentSignalLevel(value: unknown): CommitmentSignalLevel | null {
  return enumValue(COMMITMENT_SIGNAL_LEVELS, value) ?? null;
}

export function normalizeCommitmentSourceType(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || "unknown";
}

function defaultCommitmentKind(sourceType: string): CommitmentKind {
  if (/^(?:heartbeat|crew|monitoring)(?:_|$)/.test(sourceType)) return "operational_incident";
  if (/(?:^|_)(?:notification|inbox)(?:_|$)/.test(sourceType)) return "notification";
  return "user_commitment";
}

export function resolveCommitmentSemantics(input: CommitmentSemanticsInput): CommitmentSemantics {
  const sourceType = normalizeCommitmentSourceType(input.sourceType);
  const commitmentKind = enumValue(COMMITMENT_KINDS, input.commitmentKind) ?? defaultCommitmentKind(sourceType);
  const signalLevel = enumValue(COMMITMENT_SIGNAL_LEVELS, input.signalLevel) ??
    (commitmentKind === "notification" ? "low" : "normal");
  return { commitmentKind, signalLevel, sourceType };
}

function explicitTopicKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^kind:[^:]+:/, "")
    .replace(/^(?:topic[:_])+/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function normalizedCommitmentContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().toLowerCase();
}

export function canonicalCommitmentDedupeKey(content: string, explicitKey?: string | null): string {
  const topicKey = typeof explicitKey === "string" ? explicitTopicKey(explicitKey) : "";
  if (topicKey) return `topic:${topicKey}`;
  const normalized = normalizedCommitmentContent(content);
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `content:${hash}`;
}

export function scopedCommitmentDedupeKey(
  commitmentKind: CommitmentKind,
  content: string,
  explicitKey?: string | null,
): string {
  return `kind:${commitmentKind}:${canonicalCommitmentDedupeKey(content, explicitKey)}`;
}

export function rescopeCommitmentDedupeKey(
  commitmentKind: CommitmentKind,
  dedupeKey: string | null | undefined,
  content: string,
): string {
  const baseKey = dedupeKey?.replace(/^kind:[^:]+:/, "") || canonicalCommitmentDedupeKey(content);
  return `kind:${commitmentKind}:${baseKey}`;
}

export function appendCommitmentRevision(
  history: CommitmentRevision[],
  revision: CommitmentRevision,
): CommitmentRevision[] {
  return [
    ...history.slice(-(MAX_COMMITMENT_HISTORY_REVISIONS - 1)),
    revision,
  ];
}

export function isPersonalCommitment(
  record: { commitmentKind?: unknown; signalLevel?: unknown },
): boolean {
  const kind = enumValue(COMMITMENT_KINDS, record.commitmentKind);
  const signal = enumValue(COMMITMENT_SIGNAL_LEVELS, record.signalLevel);
  return signal === "normal" && (kind === "user_commitment" || kind === "user_task");
}

export async function createOrMergeCommitment(
  input: CommitmentWriteInput,
  repository: CommitmentRepository,
): Promise<CommitmentWriteResult> {
  const content = input.content.replace(/\s+/g, " ").trim();
  if (!content) throw new Error("Commitment content is required.");
  const userId = input.userId.trim();
  if (!userId) throw new Error("Commitment userId is required.");

  const commitmentKind = parseCommitmentKind(input.commitmentKind);
  const signalLevel = parseCommitmentSignalLevel(input.signalLevel);
  if (!commitmentKind) throw new Error("A valid commitmentKind is required.");
  if (!signalLevel) throw new Error("A valid signalLevel is required.");
  const semantics: CommitmentSemantics = {
    commitmentKind,
    signalLevel,
    sourceType: normalizeCommitmentSourceType(input.sourceType),
  };
  const dedupeKey = scopedCommitmentDedupeKey(commitmentKind, content, input.dedupeKey);
  const existing = await repository.findPendingByDedupeKey(userId, dedupeKey);
  const dueDate = typeof input.dueDate === "string" && input.dueDate.trim()
    ? input.dueDate.trim()
    : null;
  const sourceMessage = typeof input.sourceMessage === "string" && input.sourceMessage.trim()
    ? input.sourceMessage.trim()
    : null;
  const updatedAt = new Date();

  if (existing) {
    const nextDueDate = existing.dueDate ?? dueDate;
    const observation: CommitmentRevision = {
      content,
      dueDate,
      status: "pending",
      commitmentKind: semantics.commitmentKind,
      signalLevel: semantics.signalLevel,
      dedupeKey,
      sourceType: semantics.sourceType,
      sourceMessage,
      recordedAt: updatedAt.toISOString(),
    };
    const lastObservation = existing.history.at(-1);
    const matches = (revision: CommitmentRevision | undefined): boolean => Boolean(revision) &&
      revision?.content === observation.content &&
      revision.dueDate === observation.dueDate &&
      revision.commitmentKind === observation.commitmentKind &&
      revision.signalLevel === observation.signalLevel &&
      revision.sourceType === observation.sourceType &&
      revision.sourceMessage === observation.sourceMessage;
    const materiallyChanged = !matches(lastObservation) && !(
      content === existing.content &&
      dueDate === existing.dueDate &&
      semantics.commitmentKind === existing.commitmentKind &&
      semantics.signalLevel === existing.signalLevel &&
      semantics.sourceType === existing.sourceType &&
      sourceMessage === existing.sourceMessage
    );
    const commitment = await repository.update(existing.id, {
      content: existing.content,
      dueDate: nextDueDate,
      dedupeKey,
      sourceMessage: existing.sourceMessage,
      updatedAt,
      history: materiallyChanged
        ? appendCommitmentRevision(existing.history, observation)
        : existing.history.slice(-MAX_COMMITMENT_HISTORY_REVISIONS),
      commitmentKind: existing.commitmentKind,
      signalLevel: existing.signalLevel,
      sourceType: existing.sourceType,
    });
    return { action: "merged", commitment };
  }

  const commitment = await repository.insert({
    userId,
    content,
    dueDate,
    status: "pending",
    dedupeKey,
    sourceMessage,
    updatedAt,
    history: [],
    ...semantics,
  });
  return { action: "created", commitment };
}
