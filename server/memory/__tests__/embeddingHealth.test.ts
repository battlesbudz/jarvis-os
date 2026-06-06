import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://localhost/jarvis_memory_embedding_health_import_only";
process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";

async function main(): Promise<void> {
  const {
    classifyMemoryEmbeddingHealth,
    getMemoryEmbeddingHealth,
  } = await import("../embeddingHealth");

  const healthy = classifyMemoryEmbeddingHealth({
    vectorRetrievalEnabled: true,
    pgvectorAvailable: true,
    approvedMemoryCount: 100,
    jsonEmbeddingCount: 98,
    vectorEmbeddingCount: 97,
    recentVectorErrors15m: 0,
  });
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.vectorCoveragePct, 97);
  assert.deepEqual(healthy.alerts, []);

  const degraded = classifyMemoryEmbeddingHealth({
    vectorRetrievalEnabled: false,
    pgvectorAvailable: true,
    approvedMemoryCount: 100,
    jsonEmbeddingCount: 80,
    vectorEmbeddingCount: 72,
    recentVectorErrors15m: 0,
  });
  assert.equal(degraded.status, "degraded");
  assert.match(degraded.alerts[0]?.message ?? "", /vector coverage/i);
  assert.equal(degraded.missingVectorEmbeddingCount, 28);

  const unavailable = classifyMemoryEmbeddingHealth({
    vectorRetrievalEnabled: true,
    pgvectorAvailable: false,
    approvedMemoryCount: 10,
    jsonEmbeddingCount: 10,
    vectorEmbeddingCount: 10,
    recentVectorErrors15m: 0,
  });
  assert.equal(unavailable.status, "down");
  assert.match(unavailable.alerts[0]?.message ?? "", /pgvector/i);

  const erroring = classifyMemoryEmbeddingHealth({
    vectorRetrievalEnabled: true,
    pgvectorAvailable: true,
    approvedMemoryCount: 10,
    jsonEmbeddingCount: 10,
    vectorEmbeddingCount: 10,
    recentVectorErrors15m: 3,
  });
  assert.equal(erroring.status, "down");
  assert.match(erroring.alerts[0]?.message ?? "", /vector-path error/i);

  const collected = await getMemoryEmbeddingHealth({
    env: { JARVIS_MEMORY_VECTOR_RETRIEVAL: "1" },
    now: () => new Date("2026-06-05T12:00:00.000Z"),
    countEmbeddingRows: async () => ({
      approvedMemoryCount: 20,
      jsonEmbeddingCount: 18,
      vectorEmbeddingCount: 18,
    }),
    isPgvectorAvailable: async () => true,
    countRecentVectorErrors: async () => 1,
  });
  assert.equal(collected.generatedAt, "2026-06-05T12:00:00.000Z");
  assert.equal(collected.vectorRetrievalEnabled, true);
  assert.equal(collected.approvedMemoryCount, 20);
  assert.equal(collected.recentVectorErrors15m, 1);

  console.log("OK: memory embedding health classifies coverage, pgvector, and vector-path errors");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
