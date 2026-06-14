import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://localhost/jarvis_memory_vector_import_only";
process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";

async function main(): Promise<void> {
  const {
    APPROVED_MEMORY_REVIEW_STATUSES,
    isMemoryVectorRetrievalEnabled,
    isPgvectorUnavailableError,
    vectorLiteral,
  } = await import("../vectorStore");

  assert.deepEqual(
    APPROVED_MEMORY_REVIEW_STATUSES,
    ["active", "kept", "edited"],
    "canonical vector search should only consider approved memory review states",
  );

  assert.equal(isMemoryVectorRetrievalEnabled({ JARVIS_MEMORY_VECTOR_RETRIEVAL: "1" }), true);
  assert.equal(isMemoryVectorRetrievalEnabled({ JARVIS_MEMORY_VECTOR_RETRIEVAL: "true" }), true);
  assert.equal(isMemoryVectorRetrievalEnabled({ JARVIS_MEMORY_VECTOR_RETRIEVAL: "0" }), false);
  assert.equal(isMemoryVectorRetrievalEnabled({}), false);

  assert.equal(
    vectorLiteral([1, Number.NaN, -0.25, "0.5" as unknown as number]),
    "[1,0,-0.25,0.5]",
    "vector literals should sanitize non-finite values before pgvector casts",
  );

  assert.equal(
    isPgvectorUnavailableError({ code: "42703", message: 'column "embedding_vector" does not exist' }),
    true,
    "missing embedding_vector column should be treated as a fallback-safe pgvector outage",
  );
  assert.equal(
    isPgvectorUnavailableError({ code: "42704", message: 'type "vector" does not exist' }),
    true,
    "missing pgvector type should be treated as a fallback-safe pgvector outage",
  );
  assert.equal(isPgvectorUnavailableError(new Error("ordinary query failure")), false);

  console.log("OK: memory vector store contract is fallback-safe and approval-scoped");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
