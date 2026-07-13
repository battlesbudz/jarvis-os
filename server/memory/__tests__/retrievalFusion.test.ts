import assert from "node:assert/strict";

import { evaluateRetrievalRun } from "../retrievalEvaluation";
import type { RetrievedMemory } from "../retrieve";

process.env.DATABASE_URL ??= "postgres://localhost/jarvis_retrieval_fusion_import_only";
process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";

function memory(id: string, overrides: Partial<RetrievedMemory> = {}): RetrievedMemory {
  return {
    id,
    content: `Canonical content for ${id}.`,
    category: "fact",
    tier: "long_term",
    memoryType: "semantic",
    relevanceScore: 80,
    confidence: 90,
    accessCount: 0,
    score: 0.8,
    source: "canonical",
    sourceId: id,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const {
    fuseRetrievedMemoryCandidates,
    loadAndFuseRetrievedMemories,
  } = await import("../retrieve");

  const canonical = [
    memory("shared-memory", { content: "Canonical user statement wins." }),
    memory("canonical-only"),
  ];
  const gbrain = [
    memory("shared-memory", {
      content: "Derived summary must not replace canonical content.",
      source: "gbrain",
      sourceId: "brain/shared:0",
      sourceRefs: [{ kind: "user_memory", id: "shared-memory" }],
      score: 92,
    }),
    memory("brain-only", {
      content: "Approved derived-only context.",
      source: "gbrain",
      sourceId: "brain/derived:1",
      sourceRefs: [{ kind: "document", id: "doc-1" }],
      score: 81,
    }),
  ];

  const fused = fuseRetrievedMemoryCandidates(canonical, gbrain);
  assert.deepEqual(fused.map((item) => item.id), ["shared-memory", "canonical-only", "brain-only"]);
  assert.equal(fused[0]?.content, "Canonical user statement wins.");
  assert.equal(fused[0]?.source, "canonical");
  assert.equal(fused[0]?.retrieval?.strategy, "rrf");
  assert.deepEqual(
    fused[0]?.retrieval?.sources.map((source) => [source.source, source.sourceId]),
    [["canonical", "shared-memory"], ["gbrain", "brain/shared:0"]],
  );
  assert.equal(fused[0]?.sourceRefs?.some((ref) => ref.id === "shared-memory"), true);

  const baselineEvaluation = evaluateRetrievalRun({
    id: "source-first-baseline",
    query: "shared decision",
    expectedIds: ["shared-memory", "canonical-only"],
    topK: 2,
  }, { retrieved: gbrain });
  const fusedEvaluation = evaluateRetrievalRun({
    id: "rrf-fusion",
    query: "shared decision",
    expectedIds: ["shared-memory", "canonical-only"],
    topK: 2,
  }, { retrieved: fused });
  assert.equal(baselineEvaluation.passed, false);
  assert.equal(fusedEvaluation.passed, true);
  assert.ok(fusedEvaluation.metrics.recallAtK > baselineEvaluation.metrics.recallAtK);

  const accessUpdates: string[][] = [];
  const selected = await loadAndFuseRetrievedMemories({
    canonical: async () => canonical,
    gbrain: async () => gbrain,
  }, 3, false, {}, (ids) => accessUpdates.push(ids));
  assert.deepEqual(selected.map((item) => item.id), ["shared-memory", "canonical-only", "brain-only"]);
  assert.deepEqual(accessUpdates, [["shared-memory", "canonical-only"]]);

  const canonicalFallback = await loadAndFuseRetrievedMemories({
    canonical: async () => canonical,
    gbrain: async () => { throw new Error("brain unavailable"); },
  }, 2, true);
  assert.deepEqual(canonicalFallback.map((item) => item.id), ["shared-memory", "canonical-only"]);
  assert.deepEqual(canonicalFallback[0]?.retrieval?.degradedSources, ["gbrain"]);

  const brainFallback = await loadAndFuseRetrievedMemories({
    canonical: () => { throw new Error("canonical unavailable"); },
    gbrain: async () => gbrain,
  }, 2, true);
  assert.deepEqual(brainFallback.map((item) => item.id), ["shared-memory", "brain-only"]);
  assert.deepEqual(brainFallback[0]?.retrieval?.degradedSources, ["canonical"]);

  await assert.rejects(
    () => loadAndFuseRetrievedMemories({
      canonical: async () => { throw new Error("canonical unavailable"); },
      gbrain: async () => { throw new Error("brain unavailable"); },
    }, 2, true),
    /both failed/i,
  );

  const privacyFiltered = await loadAndFuseRetrievedMemories({
    canonical: async () => [
      memory("restricted", { sensitivity: "restricted_summary" }),
      memory("public"),
    ],
    gbrain: async () => [],
  }, 2, true);
  assert.deepEqual(privacyFiltered.map((item) => item.id), ["public"]);

  const privacyIncluded = await loadAndFuseRetrievedMemories({
    canonical: async () => [memory("restricted", { sensitivity: "restricted_summary" })],
    gbrain: async () => [],
  }, 1, true, { includeRestricted: true });
  assert.deepEqual(privacyIncluded.map((item) => item.id), ["restricted"]);

  console.log("OK: canonical and G-Brain candidates fuse with authority, provenance, privacy, and fallback");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
