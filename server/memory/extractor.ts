/**
 * Phase 4 — unified memory extractor.
 *
 * Replaces the three near-duplicate extractors that used to live in
 * routes.ts (chat), telegramRoutes.ts (Telegram), and heartbeat.ts. One
 * call site, one prompt, one dedup pass, one set of typed categories.
 *
 * Inspired by OpenClaw's memory layer (MIT, © 2025 Peter Steinberger).
 */
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
import { normalizeCategory, MEMORY_CATEGORIES } from "./categories";
import { markSoulStale } from "./soul";

export interface ExtractInput {
  userId: string;
  source: string;
  /** "chat" | "telegram" | "heartbeat" | "weekly_pattern" | "manual" */
  sourceType: string;
  sourceRef?: string;
  /** Optional context to bias extraction (e.g. proactive question being answered). */
  contextHint?: string;
  /** Cap on memories stored per call. Default 3. */
  maxNew?: number;
}

interface RawExtractedMemory {
  content: unknown;
  category: unknown;
  confidence?: unknown;
}

interface ExtractedMemory {
  content: string;
  category: schema.MemoryCategory;
  confidence: number;
}

function normalizeForDedup(s: string): string {
  return s.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function parseExtraction(raw: string): RawExtractedMemory[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "memories" in parsed) {
      const m = (parsed as { memories: unknown }).memories;
      if (Array.isArray(m)) return m as RawExtractedMemory[];
    }
    if (Array.isArray(parsed)) return parsed as RawExtractedMemory[];
  } catch {
    // fall through
  }
  return [];
}

export async function extractAndStore(input: ExtractInput): Promise<ExtractedMemory[]> {
  const { userId, source, sourceType, sourceRef, contextHint, maxNew = 3 } = input;
  if (!source.trim()) return [];

  let stored: ExtractedMemory[] = [];

  try {
    const existingRows = await db
      .select({ content: schema.userMemories.content })
      .from(schema.userMemories)
      .where(eq(schema.userMemories.userId, userId))
      .orderBy(desc(schema.userMemories.extractedAt))
      .limit(150);
    const existingMemories = existingRows.map((r) => r.content);
    const seen = new Set(existingMemories.map(normalizeForDedup));

    const existingList =
      existingMemories.length > 0
        ? `\nExisting memories (DO NOT duplicate or rephrase these):\n${existingMemories.slice(0, 80).map((m) => `- ${m}`).join("\n")}`
        : "";
    const contextNote = contextHint ? `\nContext: ${contextHint}` : "";

    const prompt = `You extract durable profile facts about a single user from one source.
Output JSON: { "memories": [{"content": string, "category": one-of-categories, "confidence": 0-100}] }

Categories (pick ONE per memory):
- work_patterns       — when/how they focus, schedule habits, tools, deep-work timing
- communication_style — humor, energy, decision style, message length preference
- energy_rhythms      — peak/low hours, sleep, exercise timing, recovery rituals
- goals_history       — goals stated or inferred over time, including past goals
- relationships       — specific named people (family, teammates, partners)
- values              — what they care about deeply, what motivates them
- blockers            — recurring frictions, fears, procrastination triggers
- accomplishments     — concrete wins, milestones reached
- preferences         — explicit preferences (meeting times, channels)
- fact                — anything else durable and specific

Rules:
- Only extract facts that are SPECIFIC, DURABLE, and not already captured.
- Skip emotional venting, one-off events, or generic statements.
- Confidence: 90+ user stated explicitly; 70-89 strongly implied; 50-69 plausible inference.
- Skip anything below 50.
- Return at most ${maxNew} new memories.${contextNote}
${existingList}

Source (${sourceType}):
${source.slice(0, 6000)}

Return { "memories": [] } if nothing new and high-confidence was learned.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || '{"memories":[]}';
    const raw = parseExtraction(content).slice(0, maxNew);

    for (const r of raw) {
      if (typeof r.content !== "string") continue;
      const text = r.content.trim();
      if (!text) continue;
      const norm = normalizeForDedup(text);
      if (seen.has(norm)) continue;
      const category = normalizeCategory(typeof r.category === "string" ? r.category : null);
      const confidence = clampInt(r.confidence, 0, 100, 70);
      if (confidence < 50) continue;

      let embedding: number[] | null = null;
      try {
        const { embedText } = await import("./retrieve");
        embedding = await embedText(text);
      } catch (embedErr) {
        console.error("[Memory] embed on insert failed:", embedErr);
      }
      await db.insert(schema.userMemories).values({
        userId,
        content: text,
        category,
        confidence,
        relevanceScore: 50,
        sourceType,
        sourceRef: sourceRef || null,
        embedding: embedding ?? undefined,
      });
      seen.add(norm);
      stored.push({ content: text, category, confidence });
      console.log(`[Memory] +${sourceType} [${category} c=${confidence}${embedding ? " e" : ""}] ${text.slice(0, 70)}`);
    }
  } catch (err) {
    console.error("[Memory] extract failed:", err);
  }

  if (stored.length > 0) {
    markSoulStale(userId).catch((err) => console.error("[Memory] markSoulStale:", err));
  }
  return stored;
}

export { MEMORY_CATEGORIES };
