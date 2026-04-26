/**
 * Skill Writer — Behaviour-to-Skill Pipeline
 *
 * Accumulates pattern signals (praise, corrections, confirmed coaching sequences)
 * in userPreferences.data.skillSignals. When a pattern crosses the threshold
 * (3 repetitions) it is "crystallised" into a versioned .skill.json file stored
 * in server/skills/<userId>/.
 *
 * The in-memory skill cache is invalidated whenever a new file is written, so
 * the agent harness always picks up new skills on the next session start.
 * An fs.watch listener on the skills root also invalidates the cache for the
 * affected user when external writes occur (e.g. manual hot-drops for testing).
 */
import { db } from "../db";
import { userPreferences } from "@shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import { watch } from "fs";
import path from "path";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export const SKILLS_DIR = path.join(process.cwd(), "server", "skills");
const CRYSTALLIZE_THRESHOLD = 3;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface SkillFile {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  sourcePatternId: string;
  userId: string;
  version: number;
}

interface SkillSignalState {
  count: number;
  lastSeen: string;
  example: string;
  crystallized: boolean;
}

// ── In-memory cache ─────────────────────────────────────────────────────────
const skillCache = new Map<string, { skills: SkillFile[]; loadedAt: number }>();

/**
 * Invalidate cache for a specific user (called from fs.watch and after writes).
 */
export function invalidateSkillCache(userId: string): void {
  skillCache.delete(userId);
}

/**
 * Load active skill files for a user.
 * Returns cached result if still fresh; otherwise reads from disk.
 */
export async function loadUserSkills(userId: string): Promise<SkillFile[]> {
  if (!userId) return [];
  const cached = skillCache.get(userId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.skills;
  }
  return refreshUserSkillCache(userId);
}

export async function refreshUserSkillCache(userId: string): Promise<SkillFile[]> {
  const dir = path.join(SKILLS_DIR, userId);
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".skill.json"));
    const skills = (
      await Promise.all(
        jsonFiles.map(async (f) => {
          try {
            const raw = await fs.readFile(path.join(dir, f), "utf-8");
            return JSON.parse(raw) as SkillFile;
          } catch {
            return null;
          }
        }),
      )
    ).filter((s): s is SkillFile => s !== null);
    const sorted = skills.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    skillCache.set(userId, { skills: sorted, loadedAt: Date.now() });
    return sorted;
  } catch {
    skillCache.set(userId, { skills: [], loadedAt: Date.now() });
    return [];
  }
}

/**
 * List all skills for a user (same as loadUserSkills but always fresh).
 */
export async function listUserSkills(userId: string): Promise<SkillFile[]> {
  invalidateSkillCache(userId);
  return loadUserSkills(userId);
}

/**
 * Delete a skill file by ID. Returns true if deleted successfully.
 */
export async function deleteSkill(userId: string, skillId: string): Promise<boolean> {
  const dir = path.join(SKILLS_DIR, userId);
  const filePath = path.join(dir, `${skillId}.skill.json`);
  try {
    await fs.unlink(filePath);
    invalidateSkillCache(userId);
    return true;
  } catch {
    return false;
  }
}

// ── Signal accumulation ──────────────────────────────────────────────────────

/**
 * Record a pattern signal for a user. When the signal count reaches the
 * crystallisation threshold, a skill file is generated asynchronously.
 *
 * @param userId       User to record the signal for
 * @param patternId    Stable identifier for the pattern (e.g. "proactive_message_morning")
 * @param example      Human-readable example of the behaviour
 */
export async function recordSkillSignal(
  userId: string,
  patternId: string,
  example: string,
): Promise<void> {
  if (!userId || !patternId) return;
  try {
    const rows = await db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    const data = (rows[0]?.data ?? {}) as Record<string, unknown>;
    const signals = ((data.skillSignals ?? {}) as Record<string, SkillSignalState>);

    const sig: SkillSignalState = signals[patternId] ?? {
      count: 0,
      lastSeen: "",
      example: "",
      crystallized: false,
    };

    if (sig.crystallized) return; // already written — skip

    sig.count += 1;
    sig.lastSeen = new Date().toISOString();
    sig.example = example;
    signals[patternId] = sig;

    const updated = { ...data, skillSignals: signals };
    await db
      .insert(userPreferences)
      .values({ userId, data: updated })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { data: updated } });

    if (sig.count >= CRYSTALLIZE_THRESHOLD) {
      // Mark crystallised before the async write to prevent duplicate files
      signals[patternId] = { ...sig, crystallized: true };
      const updated2 = { ...data, skillSignals: signals };
      await db
        .insert(userPreferences)
        .values({ userId, data: updated2 })
        .onConflictDoUpdate({ target: userPreferences.userId, set: { data: updated2 } });

      // Fire-and-forget — crystalliseSkill does its own error handling
      crystalliseSkill(userId, patternId, sig.example).catch((err) =>
        console.error("[SkillWriter] crystalliseSkill error:", err),
      );
    }
  } catch (err) {
    console.error("[SkillWriter] recordSkillSignal failed:", err);
  }
}

/**
 * Generate and persist a skill file for the given pattern.
 */
async function crystalliseSkill(
  userId: string,
  patternId: string,
  example: string,
): Promise<void> {
  const prompt = `You are helping build a Jarvis AI assistant self-improvement system.
A repeated behaviour pattern has been observed 3 or more times, indicating a stable user preference that should become a standing instruction.

Pattern ID: ${patternId}
Example of this pattern: "${example}"

Generate a JSON object (no markdown fences) with exactly these fields:
{
  "name": "Short human-readable skill name (3-6 words)",
  "description": "One sentence describing what this skill instructs Jarvis to do",
  "instructions": "2-4 concise paragraphs of standing instructions Jarvis should follow in future sessions. Write in the second person imperative directed at Jarvis (e.g. 'When the user asks about X, always Y...'). Be specific and actionable. Under 200 words."
}

Reply with ONLY valid JSON.`;

  let skillData: { name?: string; description?: string; instructions?: string } = {};
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 600,
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "{}";
    skillData = JSON.parse(raw);
  } catch (err) {
    console.error("[SkillWriter] LLM call or parse failed:", err);
    return;
  }

  if (!skillData.name || !skillData.instructions) {
    console.error("[SkillWriter] incomplete skill data:", skillData);
    return;
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = patternId
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 40)
    .replace(/^-|-$/g, "");
  const id = `${timestamp}-${slug}`;

  const skill: SkillFile = {
    id,
    name: skillData.name,
    description: skillData.description ?? skillData.name,
    instructions: skillData.instructions,
    createdAt: now.toISOString(),
    sourcePatternId: patternId,
    userId,
    version: 1,
  };

  const dir = path.join(SKILLS_DIR, userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.skill.json`), JSON.stringify(skill, null, 2), "utf-8");

  invalidateSkillCache(userId);
  console.log(`[SkillWriter] crystallised skill "${skill.name}" for user ${userId} (pattern: ${patternId})`);
}

// ── Hot-reload watcher ───────────────────────────────────────────────────────

/**
 * Watch the skills root directory for new/deleted files and invalidate the
 * cache for the affected user. Call once at server startup.
 */
export function startSkillWatcher(): void {
  // Ensure the root skills directory exists before watching
  fs.mkdir(SKILLS_DIR, { recursive: true })
    .then(() => {
      watch(SKILLS_DIR, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith(".skill.json")) return;
        // filename is "<userId>/<timestamp>-<slug>.skill.json" on most platforms
        const parts = filename.split(path.sep);
        const userId = parts[0];
        if (userId) {
          invalidateSkillCache(userId);
          console.log(`[SkillWriter] hot-reload: cache invalidated for user ${userId}`);
        }
      });
      console.log("[SkillWriter] hot-reload watcher started on", SKILLS_DIR);
    })
    .catch((err) => console.error("[SkillWriter] watcher setup failed:", err));
}
