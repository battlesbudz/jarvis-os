import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { routeModelTurn } from "../agent/modelRouter";

async function isMemoryReviewEnabledForUser(userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ data: schema.lifeContext.data })
      .from(schema.lifeContext)
      .where(eq(schema.lifeContext.userId, userId))
      .limit(1);
    const data = rows[0]?.data as Record<string, unknown> | undefined;
    if (data && typeof data.memoryReviewEnabled === "boolean") return data.memoryReviewEnabled;
    return true;
  } catch {
    return true;
  }
}

import { normalizeCategory, MEMORY_CATEGORIES } from "./categories";
import { markSoulStale } from "./soul";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";

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
  tier?: unknown;
  memory_type?: unknown;
}

interface ExtractedMemory {
  content: string;
  category: schema.MemoryCategory;
  confidence: number;
  tier: schema.MemoryTier;
  memoryType: schema.MemoryType;
}

let memoryExtractionCooldownUntil = 0;

function normalizeForDedup(s: string): string {
  return s.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeTier(raw: string | null): schema.MemoryTier {
  if (raw === "working" || raw === "short_term" || raw === "long_term") return raw;
  return "long_term";
}

function normalizeMemoryType(raw: string | null): schema.MemoryType {
  if (raw === "episodic" || raw === "semantic" || raw === "procedural" || raw === "contextual") return raw;
  return "semantic";
}

function expiresAtForTier(tier: schema.MemoryTier): Date | null {
  const now = Date.now();
  if (tier === "working") return new Date(now + 3 * 60 * 60 * 1000); // 3 hours
  if (tier === "short_term") return new Date(now + 60 * 60 * 1000 * 60); // 60 hours (~2.5 days)
  return null; // long_term never expires
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

function isProviderBackpressure(err: unknown): boolean {
  const anyErr = err as { status?: unknown; code?: unknown; type?: unknown; message?: unknown };
  const message = typeof anyErr?.message === "string" ? anyErr.message.toLowerCase() : "";
  return (
    anyErr?.status === 429 ||
    anyErr?.code === "rate_limit_exceeded" ||
    anyErr?.code === "insufficient_quota" ||
    anyErr?.type === "tokens" ||
    message.includes("rate limit") ||
    message.includes("insufficient_quota") ||
    message.includes("exceeded your current quota")
  );
}

function shouldSkipLowSignalExtraction(source: string): boolean {
  const normalized = source.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return true;
  if (
    normalized.startsWith("please reply with exactly") ||
    normalized.includes("please reply with exactly") ||
    normalized.includes("router works") ||
    normalized.includes("final chat works") ||
    normalized.includes("optional ai is quiet") ||
    normalized.includes("logs checked") ||
    normalized.includes("logs are clean") ||
    normalized.includes("tell a joke") ||
    normalized === "who are you" ||
    normalized === "who are you?" ||
    normalized === "hey" ||
    normalized === "yo" ||
    normalized === "yo yo"
  ) return true;
  if (normalized.length > 240) return false;
  return false;
}

export async function extractAndStore(input: ExtractInput): Promise<ExtractedMemory[]> {
  const { userId, source, sourceType, sourceRef, contextHint, maxNew = 3 } = input;
  if (!source.trim()) return [];
  if (shouldSkipLowSignalExtraction(source)) return [];
  if (Date.now() < memoryExtractionCooldownUntil) {
    console.warn("[Memory] extraction skipped: provider backpressure cooldown active");
    return [];
  }

  let stored: ExtractedMemory[] = [];
  let hadAnyError = false;

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
        ? `\nExisting memories (DO NOT duplicate or rephrase these):\n${existingMemories.slice(0, 35).map((m) => `- ${m}`).join("\n")}`
        : "";
    const contextNote = contextHint ? `\nContext: ${contextHint}` : "";

    const prompt = `You extract profile facts about a single user from one source.
Output JSON: { "memories": [{"content": string, "category": one-of-categories, "confidence": 0-100, "tier": one-of-tiers, "memory_type": one-of-types}] }

Categories (pick ONE per memory):
- work_patterns       - when/how they focus, schedule habits, tools, deep-work timing
- communication_style - humor, energy, decision style, message length preference
- energy_rhythms      - peak/low hours, sleep, exercise timing, recovery rituals
- goals_history       - goals stated or inferred over time, including past goals
- relationships       - specific named people (family, teammates, partners)
- values              - what they care about deeply, what motivates them
- blockers            - recurring frictions, fears, procrastination triggers
- accomplishments     - concrete wins, milestones reached
- preferences         - explicit preferences (meeting times, channels)
- fact                - anything else durable and specific

Memory Tiers (pick ONE per memory):
- working     - fleeting context valid for minutes only (e.g. "user is currently stressed about X")
- short_term  - conversational facts valid for 48-72 hours (e.g. "user said they're busy today")
- long_term   - stable, durable patterns and facts that persist indefinitely

Memory Types (pick ONE per memory):
- episodic    - an event, action, or fact tied to a specific moment ("user finished the project on Friday", "user said they are busy today")
- semantic    - a general fact or stable preference that holds across time ("user prefers morning deep work")
- procedural  - a repeated behavioral habit or workflow ("user reviews email at 9am daily")
- contextual  - momentary internal state with no factual claim ("user seems stressed right now")

Tier/Type canonical assignments - follow these exactly:
- Facts from the current conversation  -> short_term + episodic  (expires 48-72 h)
- Current fleeting/emotional state     -> working    + contextual (expires 2-4 h)
- Inferred stable patterns/preferences -> long_term  + semantic
- Specific past events                 -> long_term  + episodic
- Repeated behavioral habits           -> long_term  + procedural

Rules:
- Only extract facts that are SPECIFIC and not already captured.
- Skip emotional venting or generic statements unless they reveal a stable pattern.
- Confidence: 90+ user stated explicitly; 70-89 strongly implied; 50-69 plausible inference.
- Skip anything below 50.
- Return at most ${maxNew} new memories.${contextNote}
${existingList}

Source (${sourceType}):
${source.slice(0, 1800)}

Return { "memories": [] } if nothing new and high-confidence was learned.`;

    const response = await routeModelTurn({
      tier: "cheap",
      messages: [
        {
          role: "system",
          content: "Return only valid JSON. Do not include markdown fences, prose, or commentary.",
        },
        { role: "user", content: prompt },
      ],
      maxCompletionTokens: 250,
      logPrefix: "[MemoryExtract]",
    });

    const content = response.textContent || '{"memories":[]}';
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
      const tier = normalizeTier(typeof r.tier === "string" ? r.tier : null);
      const memoryType = normalizeMemoryType(typeof r.memory_type === "string" ? r.memory_type : null);
      const expiresAt = expiresAtForTier(tier);

      // Determine if this memory needs human review before becoming active.
      let pendingReview = false;
      let reviewStatus = "active";
      if (tier === "long_term" && (memoryType === "semantic" || memoryType === "procedural")) {
        const reviewEnabled = await isMemoryReviewEnabledForUser(userId);
        if (reviewEnabled) {
          pendingReview = true;
          reviewStatus = "pending";
        }
      }

      let embedding: number[] | null = null;
      try {
        const { embedText } = await import("./retrieve");
        embedding = await embedText(text);
      } catch (embedErr) {
        console.error("[Memory] embed on insert failed:", embedErr);
        diagEmit({
          userId,
          subsystem: "memory",
          severity: "warning",
          message: `Memory embedding failed on insert: ${embedErr instanceof Error ? embedErr.message : String(embedErr)}`.slice(0, 300),
          metadata: { operation: "embedOnInsert", sourceType },
        }).catch(() => {});
      }
      try {
        await db.insert(schema.userMemories).values({
          userId,
          content: text,
          category,
          confidence,
          relevanceScore: 50,
          sourceType,
          sourceRef: sourceRef || null,
          embedding: embedding ?? undefined,
          tier,
          memoryType,
          expiresAt: expiresAt ?? undefined,
          pendingReview,
          reviewStatus,
        });
        seen.add(norm);
        stored.push({ content: text, category, confidence, tier, memoryType });
        console.log(`[Memory] +${sourceType} [${category} ${tier}/${memoryType} c=${confidence}${embedding ? " e" : ""}${expiresAt ? " ttl" : ""}] ${text.slice(0, 70)}`);
      } catch (insertErr) {
        hadAnyError = true;
        console.error("[Memory] DB insert failed:", insertErr);
        diagEmit({
          userId,
          subsystem: "memory",
          severity: "error",
          message: `Memory DB insert failed: ${insertErr instanceof Error ? insertErr.message : String(insertErr)}`.slice(0, 300),
          metadata: { operation: "extractAndStore_insert", sourceType, category, tier },
        }).catch(() => {});
      }
    }
  } catch (err) {
    hadAnyError = true;
    if (isProviderBackpressure(err)) {
      memoryExtractionCooldownUntil = Date.now() + 60_000;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Memory] extraction skipped: provider backpressure (${msg.slice(0, 180)})`);
      return stored;
    }

    console.error("[Memory] extract failed:", err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Memory extraction failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      metadata: { operation: "extractAndStore", sourceType },
    }).catch(() => {});
  }

  if (stored.length > 0) {
    markSoulStale(userId).catch((err) => console.error("[Memory] markSoulStale:", err));

    // For rich source types use ingestSource (compounding wiki) instead of
    // the legacy TTL-gated maybeRegenerateVault.
    const richSourceTypes = ["chat", "telegram", "email", "transcript", "document", "voice"];
    if (richSourceTypes.includes(sourceType)) {
      import("./vaultWriter").then(({ ingestSource }) => {
        ingestSource(userId, source, sourceType).catch((err) =>
          console.error("[Memory] ingestSource:", err),
        );
      }).catch((err) => console.error("[Memory] vaultWriter import failed:", err));
    } else {
      import("./vaultWriter").then(({ maybeRegenerateVault }) => {
        maybeRegenerateVault(userId).catch((err) => console.error("[Memory] maybeRegenerateVault:", err));
      }).catch((err) => console.error("[Memory] vaultWriter import failed:", err));
    }
  }

  if (!hadAnyError) {
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "info",
      message: "Memory extraction completed successfully",
      metadata: { recovery: true, operation: "extractAndStore", sourceType, stored: stored.length },
    }).catch(() => {});
  }

  return stored;
}

export { MEMORY_CATEGORIES };
