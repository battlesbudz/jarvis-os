import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";

export interface MemoryAutoReviewDecision {
  action: "keep" | "pending";
  reason: string;
}

type PendingMemoryRow = Pick<
  typeof schema.userMemories.$inferSelect,
  | "id"
  | "userId"
  | "content"
  | "category"
  | "confidence"
  | "sourceType"
  | "tier"
  | "memoryType"
  | "pendingReview"
  | "reviewStatus"
  | "supersedesMemoryId"
>;

export interface MemoryAutoReviewResult {
  users: number;
  processed: number;
  skipped: number;
  failed: number;
  scanned: number;
  autoKept: number;
}

interface MemoryAutoReviewDeps {
  listUserIds(): Promise<string[]>;
  claimRun(userId: string, messageType: string, sentDate: string): Promise<boolean>;
  listPendingMemories(userId: string): Promise<PendingMemoryRow[]>;
  keepMemories(userId: string, memoryIds: string[]): Promise<number>;
  markSoulStale(userId: string): Promise<void>;
  projectApprovedMemories(userId: string, memoryIds?: string[]): Promise<void>;
  log(message: string): void;
  error(message: string, error: unknown): void;
}

const AUTO_KEEP_CATEGORIES = new Set([
  "work_patterns",
  "communication_style",
  "energy_rhythms",
  "goals_history",
  "blockers",
  "accomplishments",
  "preferences",
  "fact",
]);

const AUTO_KEEP_SOURCES = new Set([
  "weekly_pattern",
  "dream_cycle",
  "chat",
  "telegram",
  "manual",
]);

const SENSITIVE_CONTENT_PATTERNS = [
  /\b(password|passcode|api[\s_-]*key|secret|token|credential|private key|seed phrase|oauth)\b/i,
  /\b(ssn|social security|credit card|debit card|routing number|bank account|tax return|irs)\b/i,
  /\b(diagnosis|diagnosed|prescription|medication|therapy|therapist|medical|symptom)\b/i,
  /\b(lawsuit|sue|attorney|lawyer|contract|nda|legal|compliance)\b/i,
  /\b(husband|wife|girlfriend|boyfriend|partner|dating|married|divorced|pregnant)\b/i,
];

const GENERIC_CONTENT_PATTERNS = [
  /\b(user\s+(is|was|seems)\s+(busy|stressed|tired|overwhelmed|good|fine))\b/i,
  /\b(currently|right now|today|tomorrow|this week)\b/i,
];

function dateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function isSensitiveContent(content: string): boolean {
  return SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

function isTooGeneric(content: string): boolean {
  if (content.trim().length < 24) return true;
  return GENERIC_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

export function evaluateMemoryAutoReviewDecision(memory: PendingMemoryRow): MemoryAutoReviewDecision {
  if (!memory.pendingReview || memory.reviewStatus !== "pending") {
    return { action: "pending", reason: "not-pending-review" };
  }
  if (memory.supersedesMemoryId) {
    return { action: "pending", reason: "correction-requires-user-approval" };
  }
  if (memory.tier !== "long_term") {
    return { action: "pending", reason: "non-long-term" };
  }
  if (memory.memoryType !== "semantic" && memory.memoryType !== "procedural") {
    return { action: "pending", reason: "non-durable-type" };
  }
  if (memory.confidence < 80) {
    return { action: "pending", reason: "low-confidence" };
  }
  if (!AUTO_KEEP_CATEGORIES.has(memory.category)) {
    return { action: "pending", reason: "sensitive-or-unsupported-category" };
  }
  if (!AUTO_KEEP_SOURCES.has(memory.sourceType)) {
    return { action: "pending", reason: "unsupported-source" };
  }
  if (isSensitiveContent(memory.content)) {
    return { action: "pending", reason: "sensitive-content" };
  }
  if (isTooGeneric(memory.content)) {
    return { action: "pending", reason: "generic-content" };
  }
  return { action: "keep", reason: "high-confidence-low-risk" };
}

const defaultDeps: MemoryAutoReviewDeps = {
  async listUserIds() {
    const [{ db }, shared] = await Promise.all([import("../db"), import("@shared/schema")]);
    const users = await db.select({ id: shared.users.id }).from(shared.users).catch(() => []);
    return users.map((user) => user.id);
  },
  async claimRun(userId, messageType, sentDate) {
    const [{ db }, shared] = await Promise.all([import("../db"), import("@shared/schema")]);
    const claimed = await db
      .insert(shared.proactiveScheduleLog)
      .values({ userId, messageType, sentDate })
      .onConflictDoNothing()
      .returning({ id: shared.proactiveScheduleLog.id });
    return claimed.length > 0;
  },
  async listPendingMemories(userId) {
    const [{ db }, shared] = await Promise.all([import("../db"), import("@shared/schema")]);
    return db
      .select({
        id: shared.userMemories.id,
        userId: shared.userMemories.userId,
        content: shared.userMemories.content,
        category: shared.userMemories.category,
        confidence: shared.userMemories.confidence,
        sourceType: shared.userMemories.sourceType,
        tier: shared.userMemories.tier,
        memoryType: shared.userMemories.memoryType,
        pendingReview: shared.userMemories.pendingReview,
        reviewStatus: shared.userMemories.reviewStatus,
        supersedesMemoryId: shared.userMemories.supersedesMemoryId,
      })
      .from(shared.userMemories)
      .where(
        and(
          eq(shared.userMemories.userId, userId),
          eq(shared.userMemories.pendingReview, true),
          eq(shared.userMemories.reviewStatus, "pending"),
        ),
      )
      .limit(200);
  },
  async keepMemories(userId, memoryIds) {
    if (memoryIds.length === 0) return 0;
    const { keepPendingMemoryWrites } = await import("./writePipeline");
    const result = await keepPendingMemoryWrites({ userId, memoryIds });
    return result.approved;
  },
  async markSoulStale(userId) {
    const { markSoulStale } = await import("./soul");
    await markSoulStale(userId);
  },
  async projectApprovedMemories(userId, memoryIds) {
    if (process.env.JARVIS_BRAIN_PROJECTION !== "1") return;
    const { projectApprovedMemories } = await import("../brain/adapter");
    await projectApprovedMemories(userId, memoryIds && memoryIds.length > 0 ? { memoryIds } : 50);
  },
  log(message) {
    console.log(message);
  },
  error(message, error) {
    console.error(message, error);
  },
};

export async function runMemoryAutoReviewForAllUsers(
  now = new Date(),
  deps: MemoryAutoReviewDeps = defaultDeps,
): Promise<MemoryAutoReviewResult> {
  const sentDate = dateKey(now);
  const messageType = `memory:auto_review:${sentDate}`;
  const userIds = await deps.listUserIds();
  const result: MemoryAutoReviewResult = {
    users: userIds.length,
    processed: 0,
    skipped: 0,
    failed: 0,
    scanned: 0,
    autoKept: 0,
  };

  for (const userId of userIds) {
    try {
      if (!(await deps.claimRun(userId, messageType, sentDate))) {
        result.skipped += 1;
        continue;
      }

      const pending = await deps.listPendingMemories(userId);
      result.scanned += pending.length;

      const keepIds = pending
        .filter((memory) => evaluateMemoryAutoReviewDecision(memory).action === "keep")
        .map((memory) => memory.id);

      const kept = await deps.keepMemories(userId, keepIds);
      if (kept > 0) {
        await deps.markSoulStale(userId);
        await deps.projectApprovedMemories(userId, keepIds);
      }

      result.processed += 1;
      result.autoKept += kept;
    } catch (err) {
      result.failed += 1;
      deps.error(`[MemoryAutoReview] Failed for user ${userId}:`, err);
    }
  }

  deps.log(
    `[MemoryAutoReview] Complete - users=${result.users} processed=${result.processed} ` +
      `skipped=${result.skipped} failed=${result.failed} scanned=${result.scanned} autoKept=${result.autoKept}`,
  );

  return result;
}
