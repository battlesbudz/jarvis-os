import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import { batchIncrementAccessCount } from "../../memory/retrieve";
import type { RetrievedMemory } from "../../memory/retrieve";
import { retrieveMemoryContext, memoryContextItemsToRetrievedMemories, type MemoryContext } from "../../memory/memoryOs";
import { containsRawRestrictedContent, defaultMemoryWriteDeps, planMemoryWrite } from "../../memory/writePipeline";
import { db } from "../../db";
import { eq, sql } from "drizzle-orm";
import {
  MEMORY_CATEGORIES,
  MEMORY_TIERS,
  MEMORY_TYPES,
  lifeContext,
  userMemories,
  users,
  type MemoryCategory,
  type MemoryTier,
  type MemoryType,
} from "@shared/schema";

const RESTRICTED_MEMORY_SOURCE_SQL_PATTERN = "%(plaid|bank|banking|financial|transaction|credit_card|credit card|debit_card|debit card|tax_document|tax document|payroll|brokerage|account_balance|account balance|restricted_source|restricted summary|restricted_summary)%";

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  tier: string;
  memory_type: string;
  relevance_score: number;
  confidence: number;
  access_count: number;
}

interface MemorySearchDeps {
  retrieveMemoryContext?: (input: {
    userId: string;
    query: string;
    limit?: number;
    caller: string;
    skipAccessUpdate?: boolean;
  }) => Promise<MemoryContext>;
  retrieveMemories?: (
    userId: string,
    query: string,
    limit: number,
    skipAccessUpdate: boolean,
  ) => Promise<RetrievedMemory[]>;
  incrementAccessCount: (ids: string[]) => void;
  fetchProfileIdentity: (userId: string) => Promise<string | null>;
}

interface MemorySaveDeps {
  embedText: (text: string) => Promise<number[] | null>;
  upsertMemoryEmbedding: (memoryId: string, embedding: number[]) => Promise<unknown>;
  markSoulStale: (userId: string) => Promise<void>;
  projectApprovedMemories: (userId: string, options?: number | { limit?: number; memoryIds?: string[] }) => Promise<unknown>;
}

function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeCategory(value: unknown): MemoryCategory {
  const raw = String(value || "").trim().toLowerCase();
  return (MEMORY_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as MemoryCategory)
    : "fact";
}

function normalizeTier(value: unknown): MemoryTier {
  const raw = String(value || "").trim().toLowerCase();
  return (MEMORY_TIERS as readonly string[]).includes(raw)
    ? (raw as MemoryTier)
    : "long_term";
}

function normalizeMemoryType(value: unknown): MemoryType {
  const raw = String(value || "").trim().toLowerCase();
  return (MEMORY_TYPES as readonly string[]).includes(raw)
    ? (raw as MemoryType)
    : "semantic";
}

async function isMemoryReviewEnabledForUser(userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ data: lifeContext.data })
      .from(lifeContext)
      .where(eq(lifeContext.userId, userId))
      .limit(1);
    const data = rows[0]?.data as Record<string, unknown> | undefined;
    return typeof data?.memoryReviewEnabled === "boolean" ? data.memoryReviewEnabled : true;
  } catch {
    return true;
  }
}

async function executeMemorySave(
  args: ToolArgs,
  ctx: ToolContext,
  deps: MemorySaveDeps,
): Promise<ToolResult> {
  const content = String(args.content || "").replace(/\s+/g, " ").trim();
  if (!content) {
    return { ok: false, content: "No memory content provided.", label: "Memory save failed" };
  }

  const category = normalizeCategory(args.category);
  const tier = normalizeTier(args.tier);
  const memoryType = normalizeMemoryType(args.memory_type ?? args.memoryType);
  const confidence = clampInt(args.confidence, 0, 100, 95);
  const sourceRef = String(args.source_ref || args.sourceRef || ctx.channel || "agent").trim();
  const supersedesMemoryId = String(args.supersedes_memory_id || args.supersedesMemoryId || "").trim();
  const normalized = normalizeForDedup(content);
  const reviewEnabled = await isMemoryReviewEnabledForUser(ctx.userId);
  const plan = planMemoryWrite({
    userId: ctx.userId,
    content,
    trigger: "explicit_remember",
    category,
    tier,
    memoryType,
    confidence,
    sourceType: "manual",
    sourceRef: sourceRef || null,
    supersedesMemoryId: supersedesMemoryId || null,
    reviewEnabled,
  });

  if (!plan.record) {
    return {
      ok: plan.status !== "invalid",
      content: plan.reason,
      label: plan.status === "excluded" ? "Memory save excluded" : "Memory save failed",
      metadata: { memoryWriteStatus: plan.status },
    };
  }

  try {
    const duplicateLifecycleFilter = plan.record.pendingReview
      ? sql`AND review_status NOT IN ('discarded', 'rejected', 'superseded', 'stale', 'archived')`
      : sql`
        AND (pending_review = FALSE OR pending_review IS NULL)
        AND review_status IN ('active', 'kept', 'edited')
      `;
    const duplicateResult = await db.execute<{ id: string }>(sql`
      SELECT id
      FROM user_memories
      WHERE user_id = ${ctx.userId}
        AND LOWER(REGEXP_REPLACE(TRIM(content), '\\s+', ' ', 'g')) = ${normalized}
        AND (expires_at IS NULL OR expires_at >= NOW())
        ${duplicateLifecycleFilter}
      LIMIT 1
    `);
    const duplicateId = duplicateResult.rows?.[0]?.id;
    if (duplicateId) {
      return {
        ok: true,
        content: `Memory already saved: ${content}`,
        label: "Memory save: duplicate",
        detail: duplicateId,
      };
    }

    let embedding: number[] | null = null;
    try {
      embedding = await deps.embedText(content);
    } catch (err) {
      console.warn("[MemorySave] embedding failed; saving without embedding:", err);
    }

    const [inserted] = await db.insert(userMemories).values({
      userId: ctx.userId,
      content: plan.record.content,
      category: plan.record.category,
      confidence: plan.record.confidence,
      relevanceScore: 75,
      sourceType: plan.record.sourceType,
      sourceRef: plan.record.sourceRef,
      embedding: embedding ?? undefined,
      tier: plan.record.tier,
      memoryType: plan.record.memoryType,
      expiresAt: plan.record.expiresAt ?? undefined,
      pendingReview: plan.record.pendingReview,
      reviewStatus: plan.record.reviewStatus,
      supersedesMemoryId: plan.record.supersedesMemoryId,
      sensitivity: plan.record.sensitivity,
      provenance: plan.record.provenance,
    }).returning({ id: userMemories.id });

    if (embedding && inserted?.id) {
      deps.upsertMemoryEmbedding(inserted.id, embedding).catch((err) =>
        console.warn("[MemorySave] embedding vector write failed:", err),
      );
    }

    console.log(
      `[${ctx.channel || "Agent"}] memory_save ${plan.record.pendingReview ? "pending_review" : "active"} [${category} ${tier}/${memoryType} c=${confidence}] ${content.slice(0, 70)}`,
    );

    if (!plan.record.pendingReview) {
      if (inserted?.id && plan.supersedeMemoryIds.length > 0) {
        await defaultMemoryWriteDeps.markMemoriesSuperseded(ctx.userId, plan.supersedeMemoryIds, inserted.id);
      }
      deps.markSoulStale(ctx.userId).catch(() => {});
      if (process.env.JARVIS_BRAIN_PROJECTION === "1") {
        deps.projectApprovedMemories(ctx.userId, {
          memoryIds: [inserted?.id, ...plan.supersedeMemoryIds].filter((id): id is string => Boolean(id)),
        }).catch(() => {});
      }
    }

    const tip = plan.oneTimeReviewTip
      ? " Tip: you can approve, edit, or delete memories later from Memory Review."
      : "";
    const action = plan.record.pendingReview ? "queued for review" : "saved";
    return {
      ok: true,
      content: `Memory ${action}: ${content}.${tip}`,
      label: plan.record.pendingReview ? "Memory queued for review" : "Memory saved",
      detail: inserted?.id,
      metadata: {
        memoryWriteStatus: plan.status,
        reviewStatus: plan.record.reviewStatus,
        pendingReview: plan.record.pendingReview,
        supersedesMemoryId: plan.record.supersedesMemoryId,
        supersededMemoryIds: plan.record.pendingReview ? [] : plan.supersedeMemoryIds,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, content: `Memory save failed: ${msg}`, label: "Memory save error" };
  }
}

function isIdentityFallbackQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return (
    /\b(what|which)\s+(name|nickname)\b/.test(normalized) ||
    /\bwhat\s+(is|['’]?s)\s+my\s+(name|nickname)\b/.test(normalized) ||
    /\bwho\s+am\s+i\s*\??\s*$/.test(normalized) ||
    /\b(name|nickname)\s+(you\s+should\s+)?call\s+me\b/.test(normalized) ||
    /\b(user\s+)?(name|nickname|identity)\b.*\bwhat\s+is\s+my\s+name\b/.test(normalized) ||
    /\bwhat\s+to\s+call\s+me\b/.test(normalized) ||
    /\bpreferred\s+name\b/.test(normalized)
  );
}

function appendProfileIdentityFallback(content: string, identity: string | null): string {
  if (!identity) return content;
  return [
    `Profile identity fallback: ${identity}`,
    "This comes from the user's account/profile identity, not a retrieved memory or stated preference. If no memory explicitly states a preferred name or nickname, answer with this fallback identity and say where it came from.",
    "",
    content,
  ].join("\n");
}

async function fetchProfileIdentity(userId: string): Promise<string | null> {
  const [user] = await db
    .select({
      displayName: users.displayName,
      username: users.username,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const identity = user?.displayName || user?.username || user?.email || null;
  return identity?.trim() || null;
}

function formatRetrievedMemoryLine(memory: RetrievedMemory, index: number): string {
  return `[${index + 1}] memory_id=${memory.id} [${memory.tier}/${memory.memoryType}] (${memory.category}, confidence: ${memory.confidence}%) ${memory.content}`;
}

function formatMemoryRowLine(memory: MemoryRow, index: number): string {
  return `[${index + 1}] memory_id=${memory.id} [${memory.tier || "long_term"}/${memory.memory_type || "semantic"}] (${memory.confidence}% confidence) ${memory.content}`;
}

async function executeMemorySearch(
  args: ToolArgs,
  ctx: ToolContext,
  deps: MemorySearchDeps,
): Promise<ToolResult> {
  const query = String(args.query || "").trim();
  if (!query) {
    return { ok: false, content: "No query provided.", label: "Memory search failed" };
  }

  const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));
  const category = args.category ? String(args.category).trim() : null;
  const tierFilter = args.tier ? String(args.tier).trim() : null;
  const shouldIncludeProfileFallback = isIdentityFallbackQuery(query);

  try {
    let memories: RetrievedMemory[];
    let uncertainty: string[] = [];
    if (deps.retrieveMemoryContext) {
      const memoryContext = await deps.retrieveMemoryContext({
        userId: ctx.userId,
        query,
        limit: limit * 2,
        caller: "memory_search",
        skipAccessUpdate: true,
      });
      memories = memoryContextItemsToRetrievedMemories(memoryContext.items);
      uncertainty = memoryContext.uncertainty;
    } else if (deps.retrieveMemories) {
      memories = await deps.retrieveMemories(ctx.userId, query, limit * 2, true);
    } else {
      throw new Error("No memory retrieval dependency configured.");
    }

    if (category) {
      memories = memories.filter(
        (m) => m.category.toLowerCase() === category.toLowerCase(),
      );
    }

    if (tierFilter) {
      memories = memories.filter(
        (m) => m.tier.toLowerCase() === tierFilter.toLowerCase(),
      );
    }

    const top = memories.slice(0, limit);
    const profileIdentity = shouldIncludeProfileFallback
      ? await deps.fetchProfileIdentity(ctx.userId)
      : null;

    deps.incrementAccessCount(top.map((m) => m.id));

    if (top.length === 0) {
      const retrievalFailure = uncertainty.find((note) => note.startsWith("Memory retrieval failed:"));
      if (retrievalFailure) {
        return {
          ok: false,
          content: retrievalFailure,
          label: "Memory search error",
          detail: retrievalFailure,
        };
      }

      return {
        ok: true,
        content: appendProfileIdentityFallback(
          `No memories found for query: "${query}"${category ? ` (category: ${category})` : ""}${tierFilter ? ` (tier: ${tierFilter})` : ""}.`,
          profileIdentity,
        ),
        label: "Memory search: no results",
      };
    }

    const formatted = top
      .map(formatRetrievedMemoryLine)
      .join("\n");

    const content = appendProfileIdentityFallback(
      [
        `Memory search returned ${top.length} actual retrieved memor${top.length === 1 ? "y" : "ies"} for: "${query}"`,
        "These are real memory entries from the user's memory store. In your final answer, summarize the entries below and do not claim there were no results.",
        "",
        "Format: memory_id=<id> [tier/type] (category, confidence%). Use memory_id as supersedes_memory_id when saving a user-approved correction to an existing memory.",
        "",
        formatted,
      ].join("\n"),
      profileIdentity,
    );

    console.log(
      `[${ctx.channel || "Agent"}] memory_search "${query}" -> ${top.length} result(s)`,
    );

    return {
      ok: true,
      content,
      label: `Memory search: ${query}`,
      detail: `${top.length} memories retrieved`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, content: `Memory search failed: ${msg}`, label: "Memory search error" };
  }
}

export function executeMemorySearchForTest(
  args: ToolArgs,
  ctx: ToolContext,
  deps: MemorySearchDeps,
): Promise<ToolResult> {
  return executeMemorySearch(args, ctx, deps);
}

const defaultMemorySearchDeps: MemorySearchDeps = {
  retrieveMemoryContext,
  incrementAccessCount: batchIncrementAccessCount,
  fetchProfileIdentity,
};

const defaultMemorySaveDeps: MemorySaveDeps = {
  async embedText(text) {
    const { embedText } = await import("../../memory/retrieve");
    return embedText(text);
  },
  async upsertMemoryEmbedding(memoryId, embedding) {
    const { upsertMemoryEmbedding } = await import("../../memory/vectorStore");
    return upsertMemoryEmbedding(memoryId, embedding);
  },
  async markSoulStale(userId) {
    const { markSoulStale } = await import("../../memory/soul");
    await markSoulStale(userId);
  },
  async projectApprovedMemories(userId, limit) {
    const { projectApprovedMemories } = await import("../../brain/adapter");
    return projectApprovedMemories(userId, limit);
  },
};

export const memorySearchTool: AgentTool = {
  name: "memory_search",
  description:
    "Search memory for facts, preferences, and context about this user. Use mid-task to look up specific things ('what are their preferred work hours?', 'what did they say about their goals?'). Returns the most relevant memories ranked by semantic + keyword match, each labeled with a tier (working/short_term/long_term) and type (episodic/semantic/procedural/contextual) so you can reason about how fresh and how stable each piece of knowledge is.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What you want to recall - a question or topic phrase",
      },
      category: {
        type: "string",
        description:
          "Optional - filter to a specific category: work_patterns, values, blockers, goals, relationships, preferences, health, communication_style, or any other label",
      },
      tier: {
        type: "string",
        description:
          "Optional - filter by memory tier: 'working' (minutes-fresh), 'short_term' (hours/days), or 'long_term' (permanent facts)",
      },
      limit: {
        type: "number",
        description: "Max memories to return (default 10, max 25)",
      },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    return executeMemorySearch(args, ctx, defaultMemorySearchDeps);
  },
};

export const memorySaveTool: AgentTool = {
  name: "memory_save",
  description:
    "Durably save an explicit user-provided fact, preference, identity correction, or instruction to long-term memory. Use this when the user says to remember, save, add to memory, or correct what Jarvis should know. Do not use it for inferred guesses; save only the user's stated content.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The exact fact or preference to save as memory.",
      },
      category: {
        type: "string",
        description: "Optional category: fact, preferences, relationships, values, work_patterns, communication_style, goals_history, blockers, accomplishments, or energy_rhythms. Defaults to fact.",
      },
      confidence: {
        type: "number",
        description: "Optional confidence from 0 to 100. Defaults to 95 for explicit user instructions.",
      },
      tier: {
        type: "string",
        description: "Optional tier: working, short_term, or long_term. Defaults to long_term.",
      },
      memory_type: {
        type: "string",
        description: "Optional memory type: semantic, procedural, episodic, or contextual. Defaults to semantic.",
      },
      source_ref: {
        type: "string",
        description: "Optional source reference for where the memory came from.",
      },
      supersedes_memory_id: {
        type: "string",
        description: "Optional existing memory_id returned by memory_search or memory_get that this correction should supersede after the user approves it.",
      },
    },
    required: ["content"],
  },
  async execute(args, ctx) {
    return executeMemorySave(args, ctx, defaultMemorySaveDeps);
  },
};

export const memoryGetTool: AgentTool = {
  name: "memory_get",
  description:
    "Retrieve memories from a specific category (e.g. 'work_patterns', 'values', 'goals', 'blockers', 'preferences'). Use when you need all context in a category rather than a semantic search. Returns up to 20 entries sorted by confidence.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description:
          "The memory category to read: work_patterns, values, blockers, goals, relationships, preferences, health, communication_style, etc.",
      },
      limit: {
        type: "number",
        description: "Max entries to return (default 20, max 40)",
      },
    },
    required: ["category"],
  },
  async execute(args, ctx) {
    const category = String(args.category || "").trim();
    if (!category) {
      return { ok: false, content: "No category provided.", label: "Memory get failed" };
    }

    const limit = Math.min(40, Math.max(1, Number(args.limit) || 20));

    try {
      const rawRowsResult = await db.execute(sql`
        SELECT id, content, category, tier, memory_type, relevance_score, confidence, access_count
        FROM user_memories
        WHERE user_id = ${ctx.userId}
          AND LOWER(category) = LOWER(${category})
          AND (expires_at IS NULL OR expires_at >= NOW())
          AND (pending_review = FALSE OR pending_review IS NULL)
          AND review_status IN ('active', 'kept', 'edited')
          AND COALESCE(sensitivity, 'normal') = 'normal'
          AND LOWER(COALESCE(source_type, '')) NOT SIMILAR TO ${RESTRICTED_MEMORY_SOURCE_SQL_PATTERN}
          AND LOWER(COALESCE(source_ref, '')) NOT SIMILAR TO ${RESTRICTED_MEMORY_SOURCE_SQL_PATTERN}
        ORDER BY confidence DESC, relevance_score DESC
        LIMIT ${limit}
      `);

      const memories = ((rawRowsResult.rows ?? []) as MemoryRow[])
        .filter((row) => !containsRawRestrictedContent(row.content ?? ""));

      if (memories.length === 0) {
        return {
          ok: true,
          content: `No memories found in category "${category}".`,
          label: `Memory get: ${category} (empty)`,
        };
      }

      const ids = memories.map((m) => m.id);
      db.execute(sql`
        UPDATE user_memories
        SET access_count = access_count + 1,
            last_referenced_at = NOW()
        WHERE id = ANY(${ids})
      `).catch((err) => console.error("[MemoryGet] access_count update failed:", err));

      const formatted = memories
        .map(formatMemoryRowLine)
        .join("\n");

      const content = `${memories.length} memories in category "${category}":\n\n${formatted}`;

      console.log(
        `[${ctx.channel || "Agent"}] memory_get category="${category}" -> ${memories.length} row(s)`,
      );

      return {
        ok: true,
        content,
        label: `Memory get: ${category}`,
        detail: `${memories.length} entries`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Memory get failed: ${msg}`, label: "Memory get error" };
    }
  },
};
