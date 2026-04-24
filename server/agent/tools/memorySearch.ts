import type { AgentTool } from "../types";
import { retrieveRelevantMemories } from "../../memory/retrieve";
import { db } from "../../db";
import { sql } from "drizzle-orm";

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  relevance_score: number;
  confidence: number;
}

export const memorySearchTool: AgentTool = {
  name: "memory_search",
  description:
    "Search your long-term memory for facts, preferences, and context about this user. Use this mid-task to look up specific things ('what are their preferred work hours?', 'what did they say about their goals?') without loading everything. Returns the most relevant memories ranked by semantic + keyword match.",
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

    try {
      let memories = await retrieveRelevantMemories(ctx.userId, query, limit * 2);

      if (category) {
        memories = memories.filter(
          (m) => m.category.toLowerCase() === category.toLowerCase(),
        );
      }

      const top = memories.slice(0, limit);

      if (top.length === 0) {
        return {
          ok: true,
          content: `No memories found for query: "${query}"${category ? ` (category: ${category})` : ""}.`,
          label: "Memory search: no results",
        };
      }

      const formatted = top
        .map((m, i) => `[${i + 1}] (${m.category}, confidence: ${m.confidence}%) ${m.content}`)
        .join("\n");

      const content = `Found ${top.length} relevant memories for: "${query}"\n\n${formatted}`;

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
      const rows = await db.execute<MemoryRow>(sql`
        SELECT id, content, category, relevance_score, confidence
        FROM user_memories
        WHERE user_id = ${ctx.userId}
          AND LOWER(category) = LOWER(${category})
        ORDER BY confidence DESC, relevance_score DESC
        LIMIT ${limit}
      `);

      const memories = rows.rows ?? [];

      if (memories.length === 0) {
        return {
          ok: true,
          content: `No memories found in category "${category}".`,
          label: `Memory get: ${category} (empty)`,
        };
      }

      const formatted = memories
        .map((m, i) => `[${i + 1}] (${m.confidence}% confidence) ${m.content}`)
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
