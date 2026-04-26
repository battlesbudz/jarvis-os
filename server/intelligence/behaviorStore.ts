/**
 * Behaviour Store — Operator-side skill pack management + Ego override writes.
 *
 * Provides two independent pathways for updating Jarvis behaviour without a
 * code deploy:
 *
 *   1. Operator publish path — the Jarvis team calls `/api/admin/skills/publish`
 *      to push new pack versions (updated base instructions, heartbeat rule
 *      changes) that all users receive on their next session start.
 *
 *   2. Ego override path — the Ego self-correction loop calls
 *      `writeEgoOverrides()` to persist per-user coaching adjustments directly
 *      into `user_skill_packs.instruction_overrides`, bypassing a code deploy.
 *
 * The agent harness calls `loadPackInstructionsForUser()` at session start to
 * merge both signals into the system prompt.
 */

import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import {
  skillPacks,
  userSkillPacks,
  users,
  type SkillPack,
  type SkillPackChangelogEntry,
  type EgoInstructionOverrides,
} from "@shared/schema";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PublishPackPayload {
  packId?: string;
  name: string;
  instructions: string;
  changeNote: string;
}

export interface MergedPackInstructions {
  packId: string;
  name: string;
  version: number;
  baseInstructions: string;
  overrides: EgoInstructionOverrides;
  merged: string;
}

export interface AdminPackView extends SkillPack {
  userOverrideCount: number;
}

// ── Operator publish path ─────────────────────────────────────────────────────

/**
 * Create or update a skill pack.
 *
 * If `packId` is provided and a pack with that id exists, its instructions are
 * updated and the version is incremented. Otherwise a new pack row is created.
 * A changelog entry is appended for every publish call.
 *
 * Returns the updated/created pack.
 */
export async function publishSkillPack(payload: PublishPackPayload): Promise<SkillPack> {
  const now = new Date();

  if (payload.packId) {
    const existing = await db
      .select()
      .from(skillPacks)
      .where(eq(skillPacks.id, payload.packId))
      .limit(1);

    if (existing.length > 0) {
      const old = existing[0];
      const newVersion = old.version + 1;
      const newChangelog: SkillPackChangelogEntry[] = [
        ...(old.changelog ?? []),
        {
          version: newVersion,
          note: payload.changeNote,
          publishedAt: now.toISOString(),
        },
      ];

      const [updated] = await db
        .update(skillPacks)
        .set({
          name: payload.name,
          instructions: payload.instructions,
          version: newVersion,
          publishedAt: now,
          changelog: newChangelog,
        })
        .where(eq(skillPacks.id, payload.packId))
        .returning();

      console.log(`[BehaviorStore] published pack "${updated.name}" v${updated.version}`);
      return updated;
    }
  }

  const initChangelog: SkillPackChangelogEntry[] = [
    {
      version: 1,
      note: payload.changeNote,
      publishedAt: now.toISOString(),
    },
  ];

  const [created] = await db
    .insert(skillPacks)
    .values({
      ...(payload.packId ? { id: payload.packId } : {}),
      name: payload.name,
      instructions: payload.instructions,
      version: 1,
      publishedAt: now,
      changelog: initChangelog,
    })
    .returning();

  console.log(`[BehaviorStore] created pack "${created.name}" v1`);
  return created;
}

/**
 * List all skill packs enriched with per-user override counts.
 * Used by the admin GET endpoint.
 */
export async function getAdminPackViews(): Promise<AdminPackView[]> {
  const packs = await db.select().from(skillPacks).orderBy(skillPacks.createdAt);

  const overrideCounts = await db
    .select({
      packId: userSkillPacks.packId,
      count: sql<number>`count(*)::int`,
    })
    .from(userSkillPacks)
    .groupBy(userSkillPacks.packId);

  const countMap = new Map(overrideCounts.map((r) => [r.packId, r.count]));

  return packs.map((p) => ({
    ...p,
    userOverrideCount: countMap.get(p.id) ?? 0,
  }));
}

// ── Ego override path ────────────────────────────────────────────────────────

/**
 * Write Ego-generated coaching adjustments for a specific user into their
 * `user_skill_packs.instruction_overrides` row.
 *
 * Merges with any existing overrides (most-recent values win) so multiple Ego
 * cycles accumulate rather than overwrite each other.
 *
 * If the user doesn't yet have a row for this pack, one is created.
 */
export async function writeEgoOverrides(
  userId: string,
  packId: string,
  overrides: Partial<EgoInstructionOverrides>,
): Promise<void> {
  const existing = await db
    .select({ instructionOverrides: userSkillPacks.instructionOverrides, appliedVersion: userSkillPacks.appliedVersion })
    .from(userSkillPacks)
    .where(eq(userSkillPacks.userId, userId))
    .limit(1);

  const pack = await db
    .select({ version: skillPacks.version })
    .from(skillPacks)
    .where(eq(skillPacks.id, packId))
    .limit(1);

  const packVersion = pack[0]?.version ?? 1;

  const prev: EgoInstructionOverrides = existing[0]?.instructionOverrides ?? {};

  const merged: EgoInstructionOverrides = {
    ...prev,
    ...overrides,
    suppressActionTypes: Array.from(
      new Set([...(prev.suppressActionTypes ?? []), ...(overrides.suppressActionTypes ?? [])]),
    ),
    updatedAt: new Date().toISOString(),
  };

  await db
    .insert(userSkillPacks)
    .values({
      userId,
      packId,
      appliedVersion: packVersion,
      instructionOverrides: merged,
    })
    .onConflictDoUpdate({
      target: [userSkillPacks.userId, userSkillPacks.packId],
      set: {
        instructionOverrides: merged,
        appliedVersion: packVersion,
        updatedAt: new Date(),
      },
    });

  console.log(`[BehaviorStore] ego overrides written for user ${userId} (pack ${packId})`);
}

// ── Harness loading path ──────────────────────────────────────────────────────

/**
 * Load all skill packs for a user and merge their `instruction_overrides` on
 * top of the base pack instructions.
 *
 * Called by the agent harness at session start so the model receives operator
 * updates and Ego-written adjustments without a server restart.
 *
 * Returns only packs that have non-empty merged content so the system prompt
 * is not polluted with empty blocks.
 */
export async function loadPackInstructionsForUser(
  userId: string,
): Promise<MergedPackInstructions[]> {
  if (!userId) return [];

  const allPacks = await db.select().from(skillPacks).orderBy(skillPacks.createdAt);
  if (allPacks.length === 0) return [];

  const userRows = await db
    .select()
    .from(userSkillPacks)
    .where(eq(userSkillPacks.userId, userId));

  const overrideMap = new Map(userRows.map((r) => [r.packId, r.instructionOverrides]));

  const result: MergedPackInstructions[] = [];

  for (const pack of allPacks) {
    const overrides: EgoInstructionOverrides = overrideMap.get(pack.id) ?? {};
    const parts: string[] = [];

    if (pack.instructions.trim()) parts.push(pack.instructions.trim());

    if (overrides.customInstructions?.trim()) {
      parts.push(`User-specific adjustment: ${overrides.customInstructions.trim()}`);
    }

    if (overrides.coachingNote?.trim()) {
      parts.push(`Coaching note: ${overrides.coachingNote.trim()}`);
    }

    if (overrides.suppressActionTypes && overrides.suppressActionTypes.length > 0) {
      parts.push(
        `Reduce frequency of these action types for this user: ${overrides.suppressActionTypes.join(", ")}.`,
      );
    }

    const merged = parts.join("\n\n");
    if (!merged) continue;

    result.push({
      packId: pack.id,
      name: pack.name,
      version: pack.version,
      baseInstructions: pack.instructions,
      overrides,
      merged,
    });
  }

  return result;
}

/**
 * Return the "system" pack id, creating it if it doesn't exist.
 * Used by the Ego loop to target a canonical pack for its overrides.
 * The system pack is identified by the name "Jarvis Core Behaviour".
 */
export async function getOrCreateSystemPackId(): Promise<string> {
  const existing = await db
    .select({ id: skillPacks.id })
    .from(skillPacks)
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [created] = await db
    .insert(skillPacks)
    .values({
      name: "Jarvis Core Behaviour",
      instructions: "",
      version: 1,
      publishedAt: new Date(),
      changelog: [
        {
          version: 1,
          note: "Auto-created system pack for Ego-written overrides.",
          publishedAt: new Date().toISOString(),
        },
      ],
    })
    .returning({ id: skillPacks.id });

  return created.id;
}
