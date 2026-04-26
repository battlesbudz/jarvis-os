/**
 * Jarvis Ego — Action Log
 *
 * Lightweight helpers for recording Jarvis actions and resolving their
 * outcomes. Fires-and-forgets; never throws so callers don't need try/catch.
 *
 * Signal integration: whenever an action is resolved as "acted_on" or
 * "completed", a skill pattern signal is emitted for that actionType so the
 * Behaviour-to-Skill pipeline can crystallise repeated engagement patterns.
 */
import { db } from "../db";
import { eq, and, gte, sql } from "drizzle-orm";
import { jarvisActionLog } from "@shared/schema";
import { userPreferences } from "@shared/schema";
import { recordSkillSignal } from "./skillWriter";

/**
 * Emit a skill signal for a resolved action (best-effort, never throws).
 */
function emitSkillSignal(userId: string, actionType: ActionType, outcome: ActionOutcome): void {
  if (outcome !== "acted_on" && outcome !== "completed") return;
  const patternId = `acted_on:${actionType}`;
  const example = `User consistently engaged with Jarvis's "${actionType}" actions (outcome: ${outcome})`;
  recordSkillSignal(userId, patternId, example).catch(() => {});
}

export type ActionType =
  | "email_drafted"
  | "task_suggested"
  | "plan_built"
  | "proactive_message"
  | "prediction_made"
  | "meeting_brief"
  | "evening_wrap"
  | "dream_insight"
  | "nervous_system_signal"
  | "commitment_extracted"
  | "memory_extracted";

export type ActionOutcome =
  | "pending"
  | "acted_on"
  | "ignored"
  | "completed"
  | "dismissed";

/**
 * Record a new action. Returns the new row ID (or null on failure).
 */
export async function logAction(
  userId: string,
  actionType: ActionType,
  metadata: Record<string, unknown> = {},
): Promise<string | null> {
  try {
    const rows = await db
      .insert(jarvisActionLog)
      .values({ userId, actionType, outcome: "pending", metadata })
      .returning({ id: jarvisActionLog.id });
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error("[Ego] logAction failed:", err);
    return null;
  }
}

/**
 * Update the outcome for a previously logged action.
 */
export async function resolveAction(
  actionId: string,
  outcome: ActionOutcome,
): Promise<void> {
  try {
    // Fetch the row first so we can emit a skill signal with userId + actionType.
    const rows = await db
      .select({ userId: jarvisActionLog.userId, actionType: jarvisActionLog.actionType })
      .from(jarvisActionLog)
      .where(eq(jarvisActionLog.id, actionId))
      .limit(1);
    await db
      .update(jarvisActionLog)
      .set({ outcome, updatedAt: new Date() })
      .where(eq(jarvisActionLog.id, actionId));
    if (rows[0]) {
      emitSkillSignal(rows[0].userId, rows[0].actionType as ActionType, outcome);
    }
  } catch (err) {
    console.error("[Ego] resolveAction failed:", err);
  }
}

/**
 * Resolve all pending actions of a given type for a user as "acted_on" or
 * "ignored". Used by inbox item accept/dismiss handlers to close the loop
 * without needing to track individual IDs.
 *
 * @param userId
 * @param actionType
 * @param outcome
 * @param withinMs  Only resolve actions created within this many ms (default 7 days)
 */
export async function resolvePendingActions(
  userId: string,
  actionType: ActionType,
  outcome: ActionOutcome,
  withinMs = 7 * 24 * 60 * 60 * 1000,
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - withinMs);
    await db
      .update(jarvisActionLog)
      .set({ outcome, updatedAt: new Date() })
      .where(
        and(
          eq(jarvisActionLog.userId, userId),
          eq(jarvisActionLog.actionType, actionType),
          eq(jarvisActionLog.outcome, "pending"),
          gte(jarvisActionLog.createdAt, cutoff),
        ),
      );
    emitSkillSignal(userId, actionType, outcome);
  } catch (err) {
    console.error("[Ego] resolvePendingActions failed:", err);
  }
}

/**
 * Resolve the specific pending action whose metadata[metadataKey] matches the given value.
 * Only touches the one action row correlated to that key — never does bulk updates.
 */
export async function resolveActionByMetadataKey(
  userId: string,
  actionType: ActionType,
  metadataKey: string,
  metadataValue: string,
  outcome: ActionOutcome,
  withinMs = 7 * 24 * 60 * 60 * 1000,
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - withinMs);
    await db
      .update(jarvisActionLog)
      .set({ outcome, updatedAt: new Date() })
      .where(
        and(
          eq(jarvisActionLog.userId, userId),
          eq(jarvisActionLog.actionType, actionType),
          eq(jarvisActionLog.outcome, "pending"),
          gte(jarvisActionLog.createdAt, cutoff),
          sql`${jarvisActionLog.metadata}->>${metadataKey} = ${metadataValue}`,
        ),
      );
    emitSkillSignal(userId, actionType, outcome);
  } catch (err) {
    console.error("[Ego] resolveActionByMetadataKey failed:", err);
  }
}

/**
 * Resolve the specific pending action whose metadata.taskId matches the given value.
 * Convenience wrapper around resolveActionByMetadataKey for task-related actions.
 */
export async function resolveActionByTaskId(
  userId: string,
  actionType: ActionType,
  taskId: string,
  outcome: ActionOutcome,
  withinMs = 7 * 24 * 60 * 60 * 1000,
): Promise<void> {
  return resolveActionByMetadataKey(userId, actionType, "taskId", taskId, outcome, withinMs);
}

/**
 * Check whether a given action type is suppressed for a user via self-correction prefs.
 * Returns true if Jarvis should skip this action type.
 */
export async function isActionSuppressed(
  userId: string,
  actionType: ActionType,
): Promise<boolean> {
  try {
    const rows = await db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    if (!rows[0]) return false;
    const suppressed = (rows[0].data as Record<string, unknown>)?.jarvisSuppressedActions;
    if (!Array.isArray(suppressed)) return false;
    return suppressed.includes(actionType);
  } catch {
    return false;
  }
}
