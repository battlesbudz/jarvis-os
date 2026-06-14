import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import * as schema from "@shared/schema";
import {
  getScheduledTaskDedupeScope,
  normalizeScheduledTaskKind,
  type ScheduledTaskKind,
} from "./jarvisScheduledTaskSemantics";

export interface CreateJarvisScheduledTaskInput {
  userId: string;
  title: string;
  description?: string | null;
  scheduledAt: Date;
  recurrence?: string | null;
  taskKind?: ScheduledTaskKind | string | null;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export async function createJarvisScheduledTask(input: CreateJarvisScheduledTaskInput) {
  const title = normalizeText(input.title);
  const description = normalizeText(input.description) || null;
  const recurrence = normalizeText(input.recurrence) || null;
  const taskKind = normalizeScheduledTaskKind(input.taskKind);
  const dedupeScope = getScheduledTaskDedupeScope({ title, scheduledAt: input.scheduledAt, recurrence, taskKind });

  const recurrencePredicate = recurrence
    ? eq(schema.jarvisScheduledTasks.recurrence, recurrence)
    : isNull(schema.jarvisScheduledTasks.recurrence);
  const scheduledAtPredicate = dedupeScope.includeScheduledAt
    ? eq(schema.jarvisScheduledTasks.scheduledAt, input.scheduledAt)
    : undefined;

  const [existing] = await db
    .select()
    .from(schema.jarvisScheduledTasks)
    .where(and(
      eq(schema.jarvisScheduledTasks.userId, input.userId),
      sql`LOWER(TRIM(${schema.jarvisScheduledTasks.title})) = ${dedupeScope.normalizedTitle}`,
      recurrencePredicate,
      eq(schema.jarvisScheduledTasks.taskKind, taskKind),
      scheduledAtPredicate,
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
      taskKind,
    })
    .returning();

  return { task, deduped: false };
}
