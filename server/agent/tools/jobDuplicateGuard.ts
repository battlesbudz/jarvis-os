import { db } from "../../db";
import { eq, and, gte, inArray, or } from "drizzle-orm";
import * as schema from "@shared/schema";
import { RESOURCE_PAUSED_STATUS } from "../voiceRuntimeResourceCore";

/** Lowercase, strip punctuation, collapse whitespace for comparison. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Two titles are considered similar if:
 * 1. Their normalized forms are exactly equal, OR
 * 2. The first 25 normalized characters match (catches minor suffix differences), OR
 * 3. They share ≥60% word overlap (catches reordered or paraphrased titles).
 */
export function titlesAreSimilar(a: string, b: string): boolean {
  if (a === b) return true;

  const prefixLen = 25;
  if (a.length >= prefixLen && b.length >= prefixLen && a.slice(0, prefixLen) === b.slice(0, prefixLen)) {
    return true;
  }

  const wordsA = new Set(a.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const similarity = overlap / Math.max(wordsA.size, wordsB.size);
  return similarity >= 0.6;
}

/**
 * Query the DB for an active (queued, resource-paused, or running) job belonging to `userId`
 * with the same `agentType` and a title similar to `title`, created within
 * the last `windowMs` milliseconds (default 10 minutes).
 *
 * Returns the matching job `{ id, title }` if a duplicate exists, or `null`.
 * Throws on DB error — callers should catch and treat as non-fatal.
 */
export async function findDuplicateJob(
  userId: string,
  agentType: string,
  title: string,
  windowMs = 10 * 60 * 1000,
): Promise<{ id: string; title: string } | null> {
  const since = new Date(Date.now() - windowMs);
  const activeJobs = await db
    .select({ id: schema.agentJobs.id, title: schema.agentJobs.title })
    .from(schema.agentJobs)
    .where(
      and(
        eq(schema.agentJobs.userId, userId),
        eq(schema.agentJobs.agentType, agentType),
        inArray(schema.agentJobs.status, ["queued", "running", RESOURCE_PAUSED_STATUS]),
        or(
          eq(schema.agentJobs.status, RESOURCE_PAUSED_STATUS),
          gte(schema.agentJobs.createdAt, since),
        ),
      ),
    );

  if (activeJobs.length === 0) return null;

  const normalizedNew = normalizeTitle(title);
  return activeJobs.find((j) => titlesAreSimilar(normalizeTitle(j.title), normalizedNew)) ?? null;
}
