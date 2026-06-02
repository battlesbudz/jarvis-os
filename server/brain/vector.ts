import type { ProvenanceRef, QueryBrainResult } from "./types";

export type BrainChunkCandidate = {
  pageSlug: string;
  pageTitle: string;
  content: string;
  pageProvenance: ProvenanceRef[];
  chunkProvenance: ProvenanceRef[];
  ftsScore: number;
  embedding: number[] | null;
};

export function cosineSimilarity(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < len; index += 1) {
    const av = Number(a[index]) || 0;
    const bv = Number(b[index]) || 0;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }

  const denominator = Math.sqrt(aNorm) * Math.sqrt(bNorm);
  if (denominator === 0) return 0;
  return dot / denominator;
}

function blendedScore(candidate: BrainChunkCandidate, queryEmbedding: number[] | null): number {
  const fts = Math.max(0, Math.min(1, Number(candidate.ftsScore) || 0));
  if (!queryEmbedding || !candidate.embedding) return fts;

  const semantic = Math.max(0, Math.min(1, (cosineSimilarity(queryEmbedding, candidate.embedding) + 1) / 2));
  return 0.35 * fts + 0.65 * semantic;
}

export function rankBrainChunkCandidates(
  candidates: BrainChunkCandidate[],
  queryEmbedding: number[] | null,
  topK: number,
): QueryBrainResult {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      score: blendedScore(candidate, queryEmbedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));

  const pages = new Map<string, QueryBrainResult["pages"][number]>();
  const chunks: QueryBrainResult["chunks"] = [];

  for (const candidate of ranked) {
    if (!pages.has(candidate.pageSlug)) {
      pages.set(candidate.pageSlug, {
        slug: candidate.pageSlug,
        title: candidate.pageTitle,
        score: candidate.score,
        citations: candidate.pageProvenance,
      });
    }

    chunks.push({
      pageSlug: candidate.pageSlug,
      content: candidate.content,
      score: candidate.score,
      citations: candidate.chunkProvenance,
    });
  }

  return { pages: [...pages.values()], chunks };
}
