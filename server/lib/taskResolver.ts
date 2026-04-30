import { db } from "../db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";

export interface ResolveResult {
  ok: true;
  taskTitle: string;
}

export interface ResolveError {
  ok: false;
  reason: "not_found" | "not_needs_attention";
}

/**
 * Resolves a "Needs You" task for the given user:
 * 1. Verifies the task exists, belongs to the user, and has needsAttention: true
 * 2. Stores the user's answer as a long-term memory (Task Guidance)
 * 3. Clears needsAttention and attentionQuestion on the task
 *
 * Returns `{ ok: true, taskTitle }` on success, or `{ ok: false, reason }` if
 * the task is not found or no longer needs attention.
 */
export async function resolveScheduledTaskAttention(
  userId: string,
  taskId: string,
  userAnswer: string
): Promise<ResolveResult | ResolveError> {
  const [task] = await db
    .select()
    .from(schema.jarvisScheduledTasks)
    .where(
      and(
        eq(schema.jarvisScheduledTasks.id, taskId),
        eq(schema.jarvisScheduledTasks.userId, userId)
      )
    )
    .limit(1);

  if (!task) return { ok: false, reason: "not_found" };
  if (!task.needsAttention) return { ok: false, reason: "not_needs_attention" };

  const memoryContent = `Task guidance for "${task.title}": ${task.attentionQuestion ? `Q: ${task.attentionQuestion} ` : ""}A: ${userAnswer}`;
  await db.insert(schema.userMemories).values({
    userId,
    content: memoryContent,
    category: "Task Guidance",
    confidence: 90,
    relevanceScore: 80,
    sourceType: "task_guidance",
    sourceRef: task.id,
  });

  await db
    .update(schema.jarvisScheduledTasks)
    .set({ needsAttention: false, attentionQuestion: null })
    .where(
      and(
        eq(schema.jarvisScheduledTasks.id, taskId),
        eq(schema.jarvisScheduledTasks.userId, userId)
      )
    );

  return { ok: true, taskTitle: task.title };
}
