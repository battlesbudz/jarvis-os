import type { AgentTool } from "../types";
import { retrieveRelevantMemories, batchIncrementAccessCount } from "../../memory/retrieve";
import { db } from "../../db";
import { sql } from "drizzle-orm";

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

export const memorySearchTool: AgentTool = {
  name: "memory_search",
  description:
    "Search memory for facts, preferences, and context about this user. Use mid-task to look up specific things ('what are their preferred work hours?', 'what did they say about their goals?'). Returns the most relevant memories ranked by semantic + keyword match, each labeled with a tier (working/short_term/long_term) and type (episodic/semantic/procedural/contextual) so you can reason about how fresh and how stable each piece of knowledge is.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What you want to recall — a question or topic phrase",
      },
      category: {
        type: "string",
        description:
          "Optional — filter to a specific category: work_patterns, values, blockers, goals, relationships, preferences, health, communication_style, or any other label",
      },
      tier: {
        type: "string",
        description:
          "Optional — filter by memory tier: 'working' (minutes-fresh), 'short_term' (hours/days), or 'long_term' (permanent facts)",
      },
      limit: {
        type: "number",
        description: "Max memories to return (default 10, max 25)",
      },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    const query = String(args.query || "").trim();
    if (!query) {
      return { ok: false, content: "No query provided.", label: "Memory search failed" };
    }

    const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));
    const category = args.category ? String(args.category).trim() : null;
    const tierFilter = args.tier ? String(args.tier).trim() : null;

    try {
      // skipAccessUpdate=true so we only count accesses for the final filtered set.
      let memories = await retrieveRelevantMemories(ctx.userId, query, limit * 2, true);

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

      // Increment access_count only for memories actually returned to the agent.
      batchIncrementAccessCount(top.map((m) => m.id));

      if (top.length === 0) {
        return {
          ok: true,
          content: `No memories found for query: "${query}"${category ? ` (category: ${category})` : ""}${tierFilter ? ` (tier: ${tierFilter})` : ""}.`,
          label: "Memory search: no results",
        };
      }

      const formatted = top
        .map((m, i: number) => `[${i + 1}] [${m.tier}/${m.memoryType}] (${m.category}, confidence: ${m.confidence}%) ${m.content}`)
        .join("\n");

      const content = `Found ${top.length} relevant memories for: "${query}"\n\nFormat: [tier/type] (category, confidence%)\n\n${formatted}`;

      console.log(
        `[${ctx.channel || "Agent"}] memory_search "${query}" → ${top.length} result(s)`,
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
        ORDER BY confidence DESC, relevance_score DESC
        LIMIT ${limit}
      `);

      const memories = (rawRowsResult.rows ?? []) as MemoryRow[];

      if (memories.length === 0) {
        return {
          ok: true,
          content: `No memories found in category "${category}".`,
          label: `Memory get: ${category} (empty)`,
        };
      }

      // Increment access_count and last_referenced_at for all returned rows.
      const ids = memories.map((m) => m.id);
      db.execute(sql`
        UPDATE user_memories
        SET access_count = access_count + 1,
            last_referenced_at = NOW()
        WHERE id = ANY(${ids})
      `).catch((err) => console.error("[MemoryGet] access_count update failed:", err));

      const formatted = memories
        .map((m, i) => `[${i + 1}] [${m.tier || "long_term"}/${m.memory_type || "semantic"}] (${m.confidence}% confidence) ${m.content}`)
        .join("\n");

      const content = `${memories.length} memories in category "${category}":\n\n${formatted}`;

      console.log(
        `[${ctx.channel || "Agent"}] memory_get category="${category}" → ${memories.length} row(s)`,
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
