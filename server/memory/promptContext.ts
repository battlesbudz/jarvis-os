import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getSoulPromptBlock } from "./soul";
import { retrieveMemoryContext } from "./memoryOs";
import { getEmotionalState, buildEmotionalStatePromptBlock } from "../intelligence/emotional-state";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import { buildBudgetedContextBlock, BUDGET_PRESETS } from "./contextBuilder";

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
  vaultSection: string;
}

export const EMPTY_AI_CONTEXT: AiContextSections = {
  soulSection: "",
  patternSection: "",
  memorySection: "",
  emotionalStateSection: "",
  vaultSection: "",
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
      out.soulSection = buildBudgetedContextBlock({
        title: "User context from JARVIS Soul",
        items: [{ text: soulText.trim() }],
        budget: BUDGET_PRESETS.planning.soul,
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[promptContext] soul load failed", err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "warning",
      message: `Memory soul context load failed (optional enrichment): ${detail.slice(0, 300)}`,
      metadata: { operation: "getSoulPromptBlock", classification: "optional_enrichment" },
    }).catch(() => {});
  }

  try {
    const rows = await db.execute(sql`
      SELECT patterns, summary FROM weekly_insights
      WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 1
    `);
    const row = (rows.rows?.[0] ?? null) as PatternRow | null;
    if (row) {
      const patterns: PatternEntry[] = Array.isArray(row.patterns)
        ? (row.patterns as PatternEntry[])
        : [];
      const top = patterns
        .slice(0, 3)
        .map((p) => `- ${p.observation || p.summary || JSON.stringify(p)}`)
        .join("\n");
      if (top || row.summary) {
        out.patternSection = buildBudgetedContextBlock({
          title: "Recent weekly patterns",
          items: [{ text: `${row.summary ? row.summary + "\n" : ""}${top}` }],
          budget: BUDGET_PRESETS.planning.dreams,
        });
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[promptContext] patterns load failed", err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "warning",
      message: `Memory patterns context load failed (optional enrichment): ${detail.slice(0, 300)}`,
      metadata: { operation: "weeklyInsightsQuery", classification: "optional_enrichment" },
    }).catch(() => {});
  }

  try {
    const trimmed = (seedQuery || "").trim();
    if (trimmed.length > 0) {
      const memoryContext = await retrieveMemoryContext({
        userId,
        query: trimmed,
        limit: 6,
        caller: "coach_context",
      });
      const mems = memoryContext.items.map((item) => item.memory);
      if (mems.length > 0) {
        out.memorySection = buildBudgetedContextBlock({
          title: "Relevant memories",
          items: mems.map((m) => ({ label: m.category, text: m.content })),
          budget: BUDGET_PRESETS.planning.memory,
        });
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[promptContext] retrieve failed", err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Memory retrieval failed: ${detail.slice(0, 300)}`,
      metadata: { operation: "retrieveRelevantMemories" },
    }).catch(() => {});
  }

  try {
    const state = await getEmotionalState(userId);
    if (state) {
      out.emotionalStateSection = buildEmotionalStatePromptBlock(state);
    }
  } catch (err) {
    console.error("[promptContext] emotional state load failed", err);
  }

  try {
    const vaultPages = await db
      .select({ slug: schema.knowledgeVaultPages.slug, content: schema.knowledgeVaultPages.content })
      .from(schema.knowledgeVaultPages)
      .where(eq(schema.knowledgeVaultPages.userId, userId));

    const aboutYou = vaultPages.find((p) => p.slug === "about-you");
    const patterns = vaultPages.find((p) => p.slug === "patterns");

    const parts: string[] = [];
    if (aboutYou?.content) parts.push(`### About You\n${aboutYou.content}`);
    if (patterns?.content) parts.push(`### Patterns Jarvis Has Noticed\n${patterns.content}`);

    if (parts.length > 0) {
      const combined = parts.join("\n\n");
      out.vaultSection = buildBudgetedContextBlock({
        title: "Knowledge Vault",
        items: [{ text: combined }],
        budget: BUDGET_PRESETS.planning.vault,
      });
    }
  } catch (err) {
    console.error("[promptContext] vault load failed", err);
  }

  return out;
}
