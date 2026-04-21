import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@shared/schema";

export interface UpsertPersonInput {
  userId: string;
  name: string;
  email?: string | null;
  relationship?: string | null;
  notes?: string | null;
  bumpInteraction?: boolean;
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

export async function upsertPerson(input: UpsertPersonInput): Promise<void> {
  const name = input.name.trim();
  if (!name) return;
  const email = normalizeEmail(input.email);

  try {
    // Match by (userId, email) when email present, else (userId, name).
    const matchExpr = email
      ? and(eq(schema.people.userId, input.userId), eq(schema.people.email, email))
      : and(eq(schema.people.userId, input.userId), eq(schema.people.name, name));
    const [existing] = await db.select().from(schema.people).where(matchExpr).limit(1);

    const now = new Date();
    if (existing) {
      await db
        .update(schema.people)
        .set({
          name: existing.name || name,
          email: existing.email || email,
          relationship: input.relationship?.trim() || existing.relationship,
          notes: input.notes?.trim() || existing.notes,
          interactionCount: input.bumpInteraction
            ? sql`${schema.people.interactionCount} + 1`
            : existing.interactionCount,
          lastInteractionAt: input.bumpInteraction ? now : existing.lastInteractionAt,
          updatedAt: now,
        })
        .where(eq(schema.people.id, existing.id));
    } else {
      await db.insert(schema.people).values({
        userId: input.userId,
        name,
        email,
        relationship: input.relationship?.trim() || null,
        notes: input.notes?.trim() || null,
        interactionCount: input.bumpInteraction ? 1 : 0,
        lastInteractionAt: input.bumpInteraction ? now : null,
      });
    }
  } catch (err) {
    console.error("[People] upsert failed:", err);
  }
}

export async function listPeople(userId: string): Promise<typeof schema.people.$inferSelect[]> {
  return db
    .select()
    .from(schema.people)
    .where(eq(schema.people.userId, userId))
    .orderBy(sql`COALESCE(${schema.people.lastInteractionAt}, ${schema.people.createdAt}) DESC`);
}

export async function deletePerson(userId: string, id: string): Promise<void> {
  await db
    .delete(schema.people)
    .where(and(eq(schema.people.userId, userId), eq(schema.people.id, id)));
}
