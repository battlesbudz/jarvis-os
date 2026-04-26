/**
 * AgentMemory — per-agent private memory namespace.
 *
 * Each agent's memories are stored in `agent_memories`, keyed by agentId.
 * Agents with memory_scope = "agent_private" can ONLY read/write their own
 * namespace. Agents with access_global_memory = true can also call
 * retrieveRelevantMemories (global user_memories) via the memory_search tool.
 *
 * One agent CANNOT read another agent's private memories even if both belong
 * to the same user.
 */
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { agentMemories } from "@shared/schema";
import type { AgentMemory } from "@shared/schema";
import { logAgentEvent } from "./agentLogger";

const MEMORY_SIZE_LIMIT = 500;
const SUMMARIZATION_THRESHOLD = 400;

// ── writeAgentMemory ───────────────────────────────────────────────────────────

/**
 * Write a new memory entry into an agent's private namespace.
 * Triggers auto-summarization if the count exceeds the threshold.
 */
export async function writeAgentMemory(
  agentId: string,
  userId: string,
  content: string,
  category = "fact",
): Promise<string> {
  const [row] = await db
    .insert(agentMemories)
    .values({ agentId, userId, content, category })
    .returning({ id: agentMemories.id });

  logAgentEvent({ event: "memory_written", agentId, userId, detail: `category=${category}` });

  // Check count for auto-summarization trigger (async, non-blocking).
  autoSummarizeIfNeeded(agentId, userId).catch(() => {});

  return row.id;
}

// ── readAgentMemories ──────────────────────────────────────────────────────────

/**
 * Retrieve relevant memories from an agent's private namespace.
 * Uses keyword FTS (via plainto_tsquery) + recency ordering.
 * Returns at most `limit` entries.
 */
export async function readAgentMemories(
  agentId: string,
  userId: string,
  query: string,
  limit = 10,
): Promise<AgentMemory[]> {
  const safeLimit = Math.min(limit, 25);
  const trimmedQuery = (query || "").trim();

  if (!trimmedQuery) {
    // Return recent memories if no query
    return db
      .select()
      .from(agentMemories)
      .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.userId, userId)))
      .orderBy(desc(agentMemories.createdAt))
      .limit(safeLimit);
  }

  // FTS search with plainto_tsquery
  try {
    const rows = await db.execute<AgentMemory & { ts_rank: number }>(sql`
      SELECT *, ts_rank(
        to_tsvector('english', content),
        plainto_tsquery('english', ${trimmedQuery})
      ) AS ts_rank
      FROM agent_memories
      WHERE agent_id = ${agentId}
        AND user_id = ${userId}
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ${trimmedQuery})
      ORDER BY ts_rank DESC, created_at DESC
      LIMIT ${safeLimit}
    `);
    return rows.rows as AgentMemory[];
  } catch {
    // FTS fallback: return recent memories
    return db
      .select()
      .from(agentMemories)
      .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.userId, userId)))
      .orderBy(desc(agentMemories.createdAt))
      .limit(safeLimit);
  }
}

// ── summarizeAgentMemory ───────────────────────────────────────────────────────

/**
 * LLM summarization of agent memories when count exceeds threshold.
 * Condenses the oldest half of memories into a single "summary" entry,
 * then deletes the source rows to stay under the limit.
 */
export async function summarizeAgentMemory(
  agentId: string,
  userId: string,
): Promise<void> {
  const count = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count FROM agent_memories WHERE agent_id = ${agentId} AND user_id = ${userId}
  `);
  const total = parseInt(count.rows[0]?.count ?? "0", 10);
  if (total < SUMMARIZATION_THRESHOLD) return;

  // Grab the oldest 200 entries to summarize
  const toSummarize = await db
    .select()
    .from(agentMemories)
    .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.userId, userId)))
    .orderBy(agentMemories.createdAt)
    .limit(200);

  if (toSummarize.length < 10) return;

  const memoryText = toSummarize
    .map((m) => `[${m.category}] ${m.content}`)
    .join("\n");

  // LLM summarization
  let summary = "";
  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Compress the following agent memories into a concise summary (max 500 words). Preserve key facts, patterns, and context. Output plain text." },
        { role: "user", content: memoryText.slice(0, 8000) },
      ],
      max_completion_tokens: 700,
    });
    summary = resp.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error(`[AgentMemory] summarization LLM failed for ${agentId}:`, err);
    return;
  }

  if (!summary) return;

  // Write the summary entry, delete the source rows
  const ids = toSummarize.map((m) => m.id);
  await db.transaction(async (tx) => {
    await tx.insert(agentMemories).values({
      agentId,
      userId,
      content: `[SUMMARY OF ${ids.length} EARLIER MEMORIES]\n${summary}`,
      category: "summary",
      confidence: 80,
    });
    // Delete old rows in batches of 50
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      await tx.execute(sql`
        DELETE FROM agent_memories WHERE id = ANY(${batch}::varchar[])
      `);
    }
  });

  logAgentEvent({
    event: "memory_summarized",
    agentId,
    userId,
    detail: `condensed ${ids.length} entries`,
  });
  console.log(`[AgentMemory] summarized ${ids.length} memories for agent ${agentId}`);
}

// ── clearAgentMemory ───────────────────────────────────────────────────────────

export async function clearAgentMemory(
  agentId: string,
  userId: string,
): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    DELETE FROM agent_memories WHERE agent_id = ${agentId} AND user_id = ${userId}
    RETURNING id
  `);
  const deleted = (result.rows ?? []).length;
  console.log(`[AgentMemory] cleared ${deleted} memories for agent ${agentId}`);
  return deleted;
}

// ── getAgentMemoryCount ────────────────────────────────────────────────────────

export async function getAgentMemoryCount(agentId: string, userId: string): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count FROM agent_memories WHERE agent_id = ${agentId} AND user_id = ${userId}
  `);
  return parseInt(result.rows[0]?.count ?? "0", 10);
}

// ── autoSummarizeIfNeeded ──────────────────────────────────────────────────────

async function autoSummarizeIfNeeded(agentId: string, userId: string): Promise<void> {
  const count = await getAgentMemoryCount(agentId, userId);
  if (count >= MEMORY_SIZE_LIMIT) {
    await summarizeAgentMemory(agentId, userId);
  }
}
