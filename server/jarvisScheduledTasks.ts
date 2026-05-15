import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import * as schema from "@shared/schema";

export interface CreateJarvisScheduledTaskInput {
  userId: string;
  title: string;
  description?: string | null;
  scheduledAt: Date;
  recurrence?: string | null;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export async function createJarvisScheduledTask(input: CreateJarvisScheduledTaskInput) {
  const title = normalizeText(input.title);
  const description = normalizeText(input.description) || null;
  const recurrence = normalizeText(input.recurrence) || null;

  const recurrencePredicate = recurrence
    ? eq(schema.jarvisScheduledTasks.recurrence, recurrence)
    : isNull(schema.jarvisScheduledTasks.recurrence);

  const [existing] = await db
    .select()
    .from(schema.jarvisScheduledTasks)
    .where(and(
      eq(schema.jarvisScheduledTasks.userId, input.userId),
      sql`LOWER(TRIM(${schema.jarvisScheduledTasks.title})) = ${title.toLowerCase()}`,
      eq(schema.jarvisScheduledTasks.scheduledAt, input.scheduledAt),
      recurrencePredicate,
      isNull(schema.jarvisScheduledTasks.completedAt),
      eq(schema.jarvisScheduledTasks.active, true),
    ))
    .limit(1);

  if (existing) {
    return { task: existing, deduped: true };
  }

  const [task] = await db
    .insert(schema.jarvisScheduledTasks)
    .values({
      userId: input.userId,
      title,
      description,
      scheduledAt: input.scheduledAt,
      recurrence,
    })
    .returning();

  return { task, deduped: false };
}
