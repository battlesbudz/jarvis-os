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
import { eq, and, sql } from "drizzle-orm";
import {
  skillPacks,
  userSkillPacks,
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

  // Count only rows that have at least one meaningful active override
  // (non-empty suppressActionTypes, or a coachingNote, or customInstructions).
  // Rows written with an empty suppression list after recovery are excluded so
  // the count reflects "users with active behavioural adjustments" not "users
  // that have ever had an ego cycle write".
  const overrideCounts = await db
    .select({
      packId: userSkillPacks.packId,
      count: sql<number>`count(*)::int`,
    })
    .from(userSkillPacks)
    .where(
      sql`(
        jsonb_array_length(COALESCE(${userSkillPacks.instructionOverrides}->'suppressActionTypes', '[]'::jsonb)) > 0
        OR ${userSkillPacks.instructionOverrides}->>'coachingNote' IS NOT NULL
        OR ${userSkillPacks.instructionOverrides}->>'customInstructions' IS NOT NULL
      )`,
    )
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
    .where(and(eq(userSkillPacks.userId, userId), eq(userSkillPacks.packId, packId)))
    .limit(1);

  const pack = await db
    .select({ version: skillPacks.version })
    .from(skillPacks)
    .where(eq(skillPacks.id, packId))
    .limit(1);

  const packVersion = pack[0]?.version ?? 1;

  const prev: EgoInstructionOverrides = existing[0]?.instructionOverrides ?? {};

  // Replacement semantics: the caller always passes the full computed list, so
  // we overwrite (not union) suppressActionTypes. This lets Ego recovery cycles
  // clear entries that were previously suppressed.
  const merged: EgoInstructionOverrides = {
    ...prev,
    ...overrides,
    suppressActionTypes: overrides.suppressActionTypes ?? prev.suppressActionTypes ?? [],
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
 * Load skill packs for a user and merge their `instruction_overrides` on top
 * of the base pack instructions.
 *
 * Two categories are loaded:
 *   1. The system pack ("Jarvis Core Behaviour") — always, so Ego-written
 *      coaching overrides survive pack selection changes.
 *   2. User-activated store packs — only those the user has enabled via the
 *      Skill Store (user_skill_packs.is_active = true).
 *
 * Called by the agent harness at session start so the model receives the
 * latest operator instructions and per-user adjustments without a code deploy.
 *
 * Returns only packs with non-empty merged content so the system prompt is not
 * polluted with empty blocks.
 */
export async function loadPackInstructionsForUser(
  userId: string,
): Promise<MergedPackInstructions[]> {
  if (!userId) return [];

  const userRows = await db
    .select()
    .from(userSkillPacks)
    .where(eq(userSkillPacks.userId, userId));

  const activePackIds = new Set(
    userRows.filter((r) => r.isActive).map((r) => r.packId),
  );

  const overrideMap = new Map(userRows.map((r) => [r.packId, r]));

  const allPacks = await db.select().from(skillPacks).orderBy(skillPacks.createdAt);
  if (allPacks.length === 0) return [];

  const result: MergedPackInstructions[] = [];

  for (const pack of allPacks) {
    const isSystemPack = pack.name === SYSTEM_PACK_NAME;
    const isUserActivated = activePackIds.has(pack.id);

    if (!isSystemPack && !isUserActivated) continue;

    const row = overrideMap.get(pack.id);
    const overrides: EgoInstructionOverrides = row?.instructionOverrides ?? {};

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

// ── User-facing Skill Store path ──────────────────────────────────────────────

export interface StorePackView extends SkillPack {
  isActive: boolean;
}

/**
 * List all store-visible skill packs with the given user's activation status.
 * Used by the Skill Store UI to render the pack catalogue.
 */
export async function listStorePacksForUser(userId: string): Promise<StorePackView[]> {
  const packs = await db
    .select()
    .from(skillPacks)
    .where(eq(skillPacks.isStoreVisible, true))
    .orderBy(skillPacks.createdAt);

  if (packs.length === 0) return [];

  const userRows = await db
    .select({ packId: userSkillPacks.packId, isActive: userSkillPacks.isActive })
    .from(userSkillPacks)
    .where(eq(userSkillPacks.userId, userId));

  const activeSet = new Set(
    userRows.filter((r) => r.isActive).map((r) => r.packId),
  );

  return packs.map((p) => ({ ...p, isActive: activeSet.has(p.id) }));
}

/**
 * Activate or deactivate a store pack for a user.
 *
 * Upserts the user_skill_packs row so:
 *   - Existing overrides written by the Ego loop are preserved.
 *   - Only is_active and updated_at are touched when the row already exists.
 */
export async function setUserPackActive(
  userId: string,
  packId: string,
  isActive: boolean,
): Promise<void> {
  const pack = await db
    .select({ version: skillPacks.version })
    .from(skillPacks)
    .where(eq(skillPacks.id, packId))
    .limit(1);

  if (pack.length === 0) throw new Error(`Pack ${packId} not found`);

  await db
    .insert(userSkillPacks)
    .values({
      userId,
      packId,
      appliedVersion: pack[0].version,
      isActive,
      instructionOverrides: {},
    })
    .onConflictDoUpdate({
      target: [userSkillPacks.userId, userSkillPacks.packId],
      set: {
        isActive,
        updatedAt: new Date(),
      },
    });

  console.log(`[BehaviorStore] user ${userId} ${isActive ? "activated" : "deactivated"} pack ${packId}`);
}

// First-party pack definitions seeded on server startup.
interface SeedPackDef {
  name: string;
  description: string;
  instructions: string;
}

const SEED_PACKS: SeedPackDef[] = [
  {
    name: "ADHD Focus Mode",
    description: "Keeps Jarvis concise, task-driven and distraction-free. Short responses, one action at a time, regular gentle focus nudges.",
    instructions: `You are operating in ADHD Focus Mode for this user.

Key rules:
- Keep all responses concise — maximum 3 sentences unless the user explicitly asks for more detail.
- Suggest only ONE action at a time. Never present a list of options when a single clear recommendation is possible.
- When the user drifts off-topic during a task, gently redirect: "We were working on [X] — shall we finish that first?"
- Avoid cognitive overload: no walls of text, no multiple questions in a row.
- Celebrate small completions with brief, genuine acknowledgement.
- If the user hasn't responded to a task-in-progress for more than 30 minutes, send a soft check-in.`,
  },
  {
    name: "Deep Work Mode",
    description: "Protects focus blocks and discourages context-switching. Jarvis batches interruptions and guards your deep work hours.",
    instructions: `You are operating in Deep Work Mode for this user.

Key rules:
- Respect and protect the user's calendar focus blocks. Do not suggest new tasks or action items during scheduled deep-work windows.
- Batch non-urgent notifications and present them outside focus hours.
- When the user asks you to schedule something, default to placing it outside their deep-work slots.
- Discourage context-switching: if the user starts switching topics mid-task, acknowledge it and ask if they want to pause the current task first.
- Keep all proactive messages short during deep-work hours — one line maximum.
- After a focus block ends, offer a brief summary of what was deferred during the block.`,
  },
  {
    name: "Research Mode",
    description: "Activates deep research habits. Jarvis goes broader and deeper, tracks sources, and builds structured summaries.",
    instructions: `You are operating in Research Mode for this user.

Key rules:
- When researching any topic, use web search proactively — do not rely on knowledge cutoff alone.
- Always cite sources inline (URL or domain at minimum) when presenting research findings.
- Structure research output as: Key Findings → Evidence → Open Questions → Recommended Next Steps.
- Go deeper by default: if a topic has sub-topics worth exploring, surface them.
- When the user asks a research question, automatically consider adjacent angles they may not have thought of.
- Save significant research outputs to Drive automatically (if connected) and confirm with the user.`,
  },
  {
    name: "Email Zero",
    description: "Aggressive email triage to keep your inbox at zero. Jarvis surfaces only what matters and drafts replies proactively.",
    instructions: `You are operating in Email Zero mode for this user.

Key rules:
- Triage email aggressively: anything that can be archived, archived. Flag only emails that require a decision or reply.
- Draft replies proactively for emails that have been pending more than 24 hours — don't wait to be asked.
- Group related emails in briefings rather than surfacing them one by one.
- When presenting inbox items, always include a suggested action: Reply / Archive / Delegate / Schedule.
- Unsubscribe from newsletters and promotional emails on behalf of the user without prompting (just report the action taken).
- Target: inbox count below 10 actionable items at all times. Alert the user if it exceeds this threshold.`,
  },
];

/**
 * Seed the four first-party skill packs if they haven't been created yet.
 * Safe to call on every server start — uses INSERT...ON CONFLICT DO NOTHING.
 *
 * The system pack ("Jarvis Core Behaviour") is intentionally excluded from
 * seeding here; it is created on-demand by getOrCreateSystemPackId() and is
 * never visible in the store.
 */
export async function seedDefaultPacks(): Promise<void> {
  const now = new Date();
  for (const def of SEED_PACKS) {
    try {
      const existing = await db
        .select({ id: skillPacks.id })
        .from(skillPacks)
        .where(eq(skillPacks.name, def.name))
        .limit(1);

      if (existing.length > 0) continue;

      await db.insert(skillPacks).values({
        name: def.name,
        description: def.description,
        instructions: def.instructions,
        version: 1,
        isStoreVisible: true,
        publishedAt: now,
        changelog: [
          {
            version: 1,
            note: "Initial first-party pack.",
            publishedAt: now.toISOString(),
          },
        ],
      });

      console.log(`[BehaviorStore] seeded default pack "${def.name}"`);
    } catch (err) {
      console.warn(`[BehaviorStore] seed pack "${def.name}" failed (non-fatal):`, err);
    }
  }
}

/**
 * Return the "system" pack id, creating it if it doesn't exist.
 * Used by the Ego loop to target a canonical pack for its overrides.
 * The system pack is identified by the name "Jarvis Core Behaviour".
 */
export const SYSTEM_PACK_NAME = "Jarvis Core Behaviour";

/**
 * Return the id of the canonical system pack (named "Jarvis Core Behaviour"),
 * creating it if it doesn't exist.
 *
 * Uses the pack name as the stable identifier so this function returns the
 * correct row even when multiple operator packs exist in the table.
 */
export async function getOrCreateSystemPackId(): Promise<string> {
  const existing = await db
    .select({ id: skillPacks.id })
    .from(skillPacks)
    .where(eq(skillPacks.name, SYSTEM_PACK_NAME))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [created] = await db
    .insert(skillPacks)
    .values({
      name: "Jarvis Core Behaviour",
      description: "Internal system pack used by the Ego loop for coaching adjustments. Not visible in the Skill Store.",
      instructions: "",
      version: 1,
      isStoreVisible: false,
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
