import { db } from "../db";
import { sql } from "drizzle-orm";
import { getSoulPromptBlock } from "./soul";
import { retrieveRelevantMemories } from "./retrieve";
import { getEmotionalState, buildEmotionalStatePromptBlock } from "../intelligence/emotional-state";

interface PatternRow {
  patterns: unknown;
  summary: string | null;
}
interface PatternEntry {
  observation?: string;
  summary?: string;
}

export interface AiContextSections {
  soulSection: string;
  patternSection: string;
  memorySection: string;
  emotionalStateSection: string;
}

export const EMPTY_AI_CONTEXT: AiContextSections = {
  soulSection: "",
  patternSection: "",
  memorySection: "",
  emotionalStateSection: "",
};

export async function buildAiContextSections(
  userId: string | undefined,
  seedQuery: string,
): Promise<AiContextSections> {
  if (!userId) return EMPTY_AI_CONTEXT;
  const out: AiContextSections = { ...EMPTY_AI_CONTEXT };

  try {
    const soulText = await getSoulPromptBlock(userId);
    if (soulText && soulText.trim().length > 0) {
      out.soulSection = `\n\nWhat I know about this person (JARVIS Soul):\n${soulText.trim()}\n`;
    }
  } catch (err) {
    console.error("[promptContext] soul load failed", err);
  }

  try {
    const rows = await db.execute<PatternRow>(sql`
      SELECT patterns, summary FROM weekly_insights
      WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 1
    `);
    const row = rows.rows?.[0];
    if (row) {
      const patterns: PatternEntry[] = Array.isArray(row.patterns)
        ? (row.patterns as PatternEntry[])
        : [];
      const top = patterns
        .slice(0, 3)
        .map((p) => `- ${p.observation || p.summary || JSON.stringify(p)}`)
        .join("\n");
      if (top || row.summary) {
        out.patternSection = `\n\nRecent weekly patterns I've noticed:\n${row.summary ? row.summary + "\n" : ""}${top}\n`;
      }
    }
  } catch (err) {
    console.error("[promptContext] patterns load failed", err);
  }

  try {
    const trimmed = (seedQuery || "").trim();
    if (trimmed.length > 0) {
      const mems = await retrieveRelevantMemories(userId, trimmed, 6);
      if (mems.length > 0) {
        out.memorySection =
          `\n\nRelevant memories:\n` +
          mems.map((m) => `- [${m.category}] ${m.content}`).join("\n") +
          `\n`;
      }
    }
  } catch (err) {
    console.error("[promptContext] retrieve failed", err);
  }

  try {
    const state = await getEmotionalState(userId);
    if (state) {
      out.emotionalStateSection = buildEmotionalStatePromptBlock(state);
    }
  } catch (err) {
    console.error("[promptContext] emotional state load failed", err);
  }

  return out;
}
