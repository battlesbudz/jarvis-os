import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ??= "postgres://localhost/jarvis_memory_retrieve_vector_import_only";
process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";

async function main(): Promise<void> {
  const { rankMemoryRowsForRetrieval } = await import("../retrieve");

  const now = new Date("2026-06-05T12:00:00.000Z");
  const ranked = rankMemoryRowsForRetrieval(
    [
      {
        id: "lexical-memory",
        content: "Contains the lexical query terms.",
        category: "fact",
        source_type: "chat",
        source_ref: "chat-1",
        tier: "long_term",
        memory_type: "semantic",
        relevance_score: 80,
        confidence: 70,
        access_count: 0,
        embedding: [0, 1],
        sensitivity: "normal",
        provenance: [],
        extracted_at: now,
        fts_rank: 0.2,
      },
      {
        id: "semantic-memory",
        content: "Semantically closest approved memory.",
        category: "preferences",
        source_type: "chat",
        source_ref: "chat-2",
        tier: "long_term",
        memory_type: "semantic",
        relevance_score: 60,
        confidence: 90,
        access_count: 4,
        embedding: [1, 0],
        sensitivity: "normal",
        provenance: [],
        extracted_at: now,
        fts_rank: 0,
      },
    ],
    [1, 0],
    2,
  );

  assert.equal(ranked[0]?.id, "semantic-memory", "semantic pgvector candidates should feed the existing reranker");
  assert.equal(ranked[0]?.memoryType, "semantic");
  assert.equal(ranked[0]?.category, "preferences");
  assert.equal(ranked.length, 2);

  assert.deepEqual(rankMemoryRowsForRetrieval([], [1, 0], 3), []);

  const retrieveSource = fs.readFileSync(path.resolve(process.cwd(), "server/memory/retrieve.ts"), "utf8");
  assert.match(
    retrieveSource,
    /new Map<string, MemoryRow>/,
    "vector retrieval should merge pgvector rows with FTS rows before final ranking",
  );
  assert.match(
    retrieveSource,
    /mode:\s*"pgvector\+fts"/,
    "vector retrieval diagnostics should reflect merged pgvector and FTS retrieval",
  );

  console.log("OK: memory retrieval reranker works for canonical vector candidates");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
