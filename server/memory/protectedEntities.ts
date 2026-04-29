/**
 * Protected Entity Extraction
 *
 * Extracts the names of projects and products that the user has explicitly
 * set as their own goals — so Jarvis can catch accidental typos before
 * queuing a research job about the wrong thing.
 *
 * IMPORTANT: sources are intentionally narrow.
 * We only look at goal_trees titles and life_context priorityGoal — data the
 * user explicitly created. We do NOT scan soul text, memories, or any other
 * freeform content, because those sources include knowledge about external
 * products (OpenAI, Stripe, Google…) that belong to the world, not the user.
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";

const ENTITY_CACHE = new Map<string, { names: string[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Words that appear in goal titles but are NOT project names.
// These are the "Launch X", "Build Y", "Ship Z" words we want to strip out.
const GOAL_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "nor", "so", "yet",
  "in", "on", "at", "to", "by", "of", "up", "it", "as", "if",
  "my", "our", "this", "that", "with", "from", "into", "about",
  "new", "old", "big", "top", "key", "via", "per",
  // action verbs common in goal titles
  "launch", "build", "ship", "release", "create", "start", "grow",
  "make", "run", "get", "set", "fix", "improve", "deploy", "write",
  "develop", "design", "plan", "test", "finish", "complete", "define",
  "explore", "research", "learn", "establish", "scale", "hire",
  "move", "migrate", "upgrade", "update", "review", "close",
  // project management words
  "mvp", "v1", "v2", "beta", "alpha", "phase", "milestone",
  "project", "product", "app", "site", "platform", "feature",
  "goal", "goals", "task", "tasks", "plan", "strategy", "roadmap",
  "version", "release", "sprint", "q1", "q2", "q3", "q4",
  "by", "until", "before", "after", "next", "last", "first",
  "week", "month", "year", "today", "day", "end", "due",
  // misc
  "draft", "working", "done", "progress", "idea",
]);

/**
 * Extract candidate project/product tokens from a goal title.
 * Returns tokens that are at least 3 characters and not generic goal words.
 * Handles compound tokens like "OpenClaw", "my-startup", "HealthTrackr".
 */
function extractTokensFromGoalTitle(title: string): string[] {
  const tokens = new Set<string>();
  const parts = title.split(/[\s,;:/()\[\]{}"'`|]+/);
  for (const raw of parts) {
    const token = raw.replace(/[^a-zA-Z0-9_-]/g, "").trim();
    if (token.length < 3) continue;
    if (GOAL_STOP_WORDS.has(token.toLowerCase())) continue;
    tokens.add(token);
  }
  return Array.from(tokens);
}

interface LifeContextData {
  priorityGoal?: string;
  [key: string]: unknown;
}

/**
 * Returns the names of projects/products the user has explicitly registered
 * as their own goals. Results are cached per-user for 5 minutes.
 *
 * Sources (narrow by design):
 *  1. goal_trees.title — explicit named goals/projects set by the user
 *  2. life_context.data.priorityGoal — the user's stated top priority
 */
export async function getProtectedEntityNames(userId: string): Promise<string[]> {
  const cached = ENTITY_CACHE.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.names;
  }

  const names = new Set<string>();

  try {
    // 1. Goal tree titles — the most reliable "this is my project" signal.
    // A goal_tree title like "Launch OpenClaw" or "OpenClaw MVP v1" contains
    // the product name once we strip the action words.
    const trees = await db
      .select({ title: schema.goalTrees.title })
      .from(schema.goalTrees)
      .where(eq(schema.goalTrees.userId, userId))
      .limit(30);
    for (const t of trees) {
      if (t.title && t.title.trim().length >= 3) {
        for (const token of extractTokensFromGoalTitle(t.title)) {
          names.add(token);
        }
      }
    }
  } catch (err) {
    console.warn("[protectedEntities] goal_trees query failed:", err);
  }

  try {
    // 2. Life context priorityGoal — user's explicit current priority.
    const [lc] = await db
      .select({ data: schema.lifeContext.data })
      .from(schema.lifeContext)
      .where(eq(schema.lifeContext.userId, userId))
      .limit(1);
    if (lc?.data) {
      const d = lc.data as LifeContextData;
      if (d.priorityGoal && typeof d.priorityGoal === "string") {
        for (const token of extractTokensFromGoalTitle(d.priorityGoal)) {
          names.add(token);
        }
      }
    }
  } catch (err) {
    console.warn("[protectedEntities] life_context query failed:", err);
  }

  // Only keep tokens that are at least 3 characters
  const result = Array.from(names).filter((n) => n.length >= 3);
  ENTITY_CACHE.set(userId, { names: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * Invalidate the entity name cache for a user (call after a new goal is added).
 */
export function invalidateProtectedEntityCache(userId: string): void {
  ENTITY_CACHE.delete(userId);
}

export interface EntityMatchResult {
  queryWord: string;
  matchedEntity: string;
  distance: number;
}

/**
 * Optimal String Alignment (OSA) distance — a variant of Damerau-Levenshtein
 * that counts single-character transpositions (e.g. "claw" ↔ "calw") as one
 * edit rather than two. This makes it much better at catching the
 * voice-to-text and OCR errors that motivate this check.
 *
 * Capped at `limit` — returns limit+1 if the true distance exceeds the cap.
 */
export function editDistance(a: string, b: string, limit = 3): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  if (Math.abs(s.length - t.length) > limit) return limit + 1;

  const m = s.length;
  const n = t.length;

  // d[i][j] = OSA distance between s[0..i-1] and t[0..j-1]
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      // Transposition: if s[i-1]==t[j-2] and s[i-2]==t[j-1]
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[m][n];
}

/**
 * Check whether any word in `searchQuery` closely resembles (but does not
 * exactly match) a known protected entity name.
 *
 * Returns the first near-match found, or null if none.
 * A "near-match" requires:
 *  - edit distance 1 or 2 (NOT an exact match)
 *  - both the query word AND the entity name are at least 4 characters
 *    (short tokens like "MVP" / "App" generate too many false positives)
 */
export function findEntityNearMatch(
  searchQuery: string,
  entityNames: string[],
  maxDistance = 2,
): EntityMatchResult | null {
  if (entityNames.length === 0) return null;

  const queryWords = searchQuery
    .split(/[\s,;:()\[\]{}"'`|]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9_-]/g, "").trim())
    .filter((w) => w.length >= 4);  // ignore short tokens to cut false positives

  for (const qw of queryWords) {
    for (const entity of entityNames) {
      if (entity.length < 4) continue;
      const dist = editDistance(qw, entity, maxDistance);
      if (dist > 0 && dist <= maxDistance) {
        return { queryWord: qw, matchedEntity: entity, distance: dist };
      }
    }
  }
  return null;
}
