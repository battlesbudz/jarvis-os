import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { chunkText } from "./chunk";
import { extractBrainLinks, type PersonLinkHint } from "./links";
import { memoryPageSlug, personPageSlug } from "./slug";
import { embedText } from "../memory/retrieve";
import type {
  BrainLinkInput,
  BrainScope,
  JarvisBrainAdapter,
  ProvenanceRef,
  QueryBrainInput,
  QueryBrainResult,
  UpsertEvidenceInput,
} from "./types";
import { rankBrainChunkCandidates, type BrainChunkCandidate } from "./vector";

function assertWritableApproval(input: Pick<UpsertEvidenceInput, "approvalMode">): void {
  if (input.approvalMode === "review_required") {
    throw new Error("Brain adapter cannot upsert review_required evidence in the first slice");
  }
}

function toDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

function compactPersonTruth(person: typeof schema.people.$inferSelect): string {
  const parts = [`Name: ${person.name}.`];
  if (person.email) parts.push(`Email: ${person.email}.`);
  if (person.relationship) parts.push(`Relationship: ${person.relationship}.`);
  if (person.notes) parts.push(`Notes: ${person.notes}.`);
  if (person.interactionCount > 0) parts.push(`Interaction count: ${person.interactionCount}.`);
  if (person.lastInteractionAt) parts.push(`Last interaction: ${person.lastInteractionAt.toISOString()}.`);
  if (person.nextInteractionAt) parts.push(`Next interaction: ${person.nextInteractionAt.toISOString()}.`);
  if (person.upcomingCount > 0) parts.push(`Upcoming shared events: ${person.upcomingCount}.`);
  return parts.join(" ");
}

function personSlugMap(people: Array<Pick<typeof schema.people.$inferSelect, "id" | "name">>): Map<string, string> {
  const nameCounts = new Map<string, number>();
  for (const person of people) {
    const name = person.name.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const slugs = new Map<string, string>();
  for (const person of people) {
    const name = person.name.trim();
    if (!name) continue;
    const hasDuplicateName = (nameCounts.get(name.toLocaleLowerCase()) ?? 0) > 1;
    slugs.set(person.id, personPageSlug(name, hasDuplicateName ? person.id : undefined));
  }
  return slugs;
}

async function replaceChunks(page: {
  id: string;
  userId: string;
  compiledTruth: string;
  provenance: ProvenanceRef[];
}): Promise<void> {
  await db.delete(schema.brainContentChunks).where(eq(schema.brainContentChunks.pageId, page.id));

  const chunks = chunkText(page.compiledTruth);
  if (chunks.length === 0) return;

  await db.insert(schema.brainContentChunks).values(
    chunks.map((content, index) => ({
      userId: page.userId,
      pageId: page.id,
      chunkIndex: index,
      content,
      provenance: page.provenance,
    })),
  );
}

async function appendTimelineEntries(input: UpsertEvidenceInput, pageId: string): Promise<void> {
  await db.delete(schema.brainTimelineEntries).where(eq(schema.brainTimelineEntries.pageId, pageId));

  if (!input.timelineAppend || input.timelineAppend.length === 0) return;

  await db.insert(schema.brainTimelineEntries).values(
    input.timelineAppend.map((entry) => ({
      userId: input.userId,
      pageId,
      occurredAt: toDate(entry.at),
      summary: entry.summary,
      detail: entry.detail,
      provenance: entry.provenance,
    })),
  );
}

async function insertLinks(input: UpsertEvidenceInput, pageId: string, links: BrainLinkInput[]): Promise<void> {
  await db.delete(schema.brainLinks).where(eq(schema.brainLinks.fromPageId, pageId));

  if (links.length === 0) return;

  await db
    .insert(schema.brainLinks)
    .values(
      links.map((link) => ({
        userId: input.userId,
        fromPageId: pageId,
        toSlug: link.toSlug,
        verb: link.verb,
        confidence: link.confidence ?? 70,
        provenance: input.provenance,
      })),
    )
    .onConflictDoNothing();
}

async function clearProjectedPageEdges(pageIds: string[]): Promise<void> {
  for (const pageId of pageIds) {
    await db.delete(schema.brainContentChunks).where(eq(schema.brainContentChunks.pageId, pageId));
    await db.delete(schema.brainTimelineEntries).where(eq(schema.brainTimelineEntries.pageId, pageId));
    await db.delete(schema.brainLinks).where(eq(schema.brainLinks.fromPageId, pageId));
  }
}

async function retireProjectedMemory(memory: { id: string; userId: string }): Promise<number> {
  const pages = await db
    .update(schema.brainPages)
    .set({
      reviewStatus: "discarded",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.brainPages.userId, memory.userId),
        eq(schema.brainPages.sourceKind, "user_memory"),
        eq(schema.brainPages.sourceId, memory.id),
        sql`${schema.brainPages.reviewStatus} <> 'discarded'`,
      ),
    )
    .returning({ id: schema.brainPages.id });

  await clearProjectedPageEdges(pages.map((page) => page.id));
  return pages.length;
}

async function retireStaleProjectedMemorySlugs(memory: { id: string; userId: string; slug: string }): Promise<void> {
  const pages = await db
    .update(schema.brainPages)
    .set({
      reviewStatus: "discarded",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.brainPages.userId, memory.userId),
        eq(schema.brainPages.sourceKind, "user_memory"),
        eq(schema.brainPages.sourceId, memory.id),
        ne(schema.brainPages.slug, memory.slug),
      ),
    )
    .returning({ id: schema.brainPages.id });

  await clearProjectedPageEdges(pages.map((page) => page.id));
}

async function retireOrphanedProjectedMemories(userId: string): Promise<void> {
  const orphanedPages = await db
    .select({ id: schema.brainPages.id })
    .from(schema.brainPages)
    .leftJoin(schema.userMemories, eq(schema.userMemories.id, schema.brainPages.sourceId))
    .where(
      and(
        eq(schema.brainPages.userId, userId),
        eq(schema.brainPages.sourceKind, "user_memory"),
        sql`${schema.userMemories.id} IS NULL`,
        sql`${schema.brainPages.reviewStatus} <> 'discarded'`,
      ),
    );

  if (orphanedPages.length === 0) return;

  await db
    .update(schema.brainPages)
    .set({
      reviewStatus: "discarded",
      updatedAt: new Date(),
    })
    .where(inArray(schema.brainPages.id, orphanedPages.map((page) => page.id)));

  await clearProjectedPageEdges(orphanedPages.map((page) => page.id));
}

async function retireStaleProjectedPersonSlugs(person: { id: string; userId: string; slug: string }): Promise<void> {
  const pages = await db
    .update(schema.brainPages)
    .set({
      reviewStatus: "discarded",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.brainPages.userId, person.userId),
        eq(schema.brainPages.sourceKind, "people"),
        eq(schema.brainPages.sourceId, person.id),
        ne(schema.brainPages.slug, person.slug),
      ),
    )
    .returning({ id: schema.brainPages.id });

  await clearProjectedPageEdges(pages.map((page) => page.id));
}

async function retireOrphanedProjectedPeople(userId: string): Promise<void> {
  const orphanedPages = await db
    .select({ id: schema.brainPages.id })
    .from(schema.brainPages)
    .leftJoin(schema.people, eq(schema.people.id, schema.brainPages.sourceId))
    .where(
      and(
        eq(schema.brainPages.userId, userId),
        eq(schema.brainPages.sourceKind, "people"),
        sql`${schema.people.id} IS NULL`,
        sql`${schema.brainPages.reviewStatus} <> 'discarded'`,
      ),
    );

  if (orphanedPages.length === 0) return;

  await db
    .update(schema.brainPages)
    .set({
      reviewStatus: "discarded",
      updatedAt: new Date(),
    })
    .where(inArray(schema.brainPages.id, orphanedPages.map((page) => page.id)));

  await clearProjectedPageEdges(orphanedPages.map((page) => page.id));
}

export async function upsertEvidence(input: UpsertEvidenceInput): Promise<{ pageId: string; versionId?: string }> {
  assertWritableApproval(input);

  const compiledTruth = input.compiledTruth ?? "";
  const [page] = await db
    .insert(schema.brainPages)
    .values({
      userId: input.userId,
      pageType: input.pageType,
      slug: input.slug,
      title: input.title,
      compiledTruth,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      provenance: input.provenance,
      reviewStatus: "active",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.brainPages.userId, schema.brainPages.slug],
      set: {
        pageType: input.pageType,
        title: input.title,
        compiledTruth,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        provenance: input.provenance,
        reviewStatus: "active",
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.brainPages.id });

  const [version] = await db
    .insert(schema.brainPageVersions)
    .values({
      userId: input.userId,
      pageId: page.id,
      compiledTruth,
      provenance: input.provenance,
    })
    .returning({ id: schema.brainPageVersions.id });

  await replaceChunks({
    id: page.id,
    userId: input.userId,
    compiledTruth,
    provenance: input.provenance,
  });
  await appendTimelineEntries(input, page.id);
  await insertLinks(input, page.id, input.links ?? []);

  return { pageId: page.id, versionId: version.id };
}

export async function projectApprovedMemories(
  userId: string,
  limit = 100,
): Promise<{ scanned: number; projected: number; skipped: number }> {
  await retireOrphanedProjectedMemories(userId);

  const people = await db
    .select({ id: schema.people.id, name: schema.people.name })
    .from(schema.people)
    .where(eq(schema.people.userId, userId));
  const personSlugs = personSlugMap(people);
  const personHints: PersonLinkHint[] = (
    people
      .map((person) => {
        const name = person.name.trim();
        const toSlug = personSlugs.get(person.id);
        return name && toSlug ? { name, toSlug } : null;
      })
      .filter((hint): hint is PersonLinkHint => hint !== null)
  );

  const memories = await db
    .select({
      id: schema.userMemories.id,
      content: schema.userMemories.content,
      category: schema.userMemories.category,
      sourceType: schema.userMemories.sourceType,
      sourceRef: schema.userMemories.sourceRef,
      extractedAt: schema.userMemories.extractedAt,
      expiresAt: schema.userMemories.expiresAt,
      pendingReview: schema.userMemories.pendingReview,
      reviewStatus: schema.userMemories.reviewStatus,
    })
    .from(schema.userMemories)
    .where(and(eq(schema.userMemories.userId, userId)))
    .limit(limit);

  const now = Date.now();
  let projected = 0;
  let skipped = 0;

  for (const memory of memories) {
    const expired = memory.expiresAt ? memory.expiresAt.getTime() <= now : false;
    const reviewBlocked =
      memory.pendingReview || memory.reviewStatus === "pending" || memory.reviewStatus === "discarded";

    if (expired || reviewBlocked) {
      skipped += await retireProjectedMemory({ id: memory.id, userId });
      continue;
    }

    const provenance: ProvenanceRef[] = [
      {
        kind: "user_memory",
        id: memory.id,
        sourceType: memory.sourceType,
        sourceRef: memory.sourceRef ?? undefined,
        timestamp: memory.extractedAt.toISOString(),
      },
    ];

    const slug = memoryPageSlug(memory.id, memory.content);

    await upsertEvidence({
      userId,
      actorId: "brain-adapter",
      pageType: "memory",
      slug,
      title: memory.content.slice(0, 80),
      compiledTruth: memory.content,
      sourceKind: "user_memory",
      sourceId: memory.id,
      provenance,
      links: extractBrainLinks(memory.content, personHints),
    });
    await retireStaleProjectedMemorySlugs({ id: memory.id, userId, slug });
    projected += 1;
  }

  return { scanned: memories.length, projected, skipped };
}

export async function projectPeopleIntoBrain(
  userId: string,
  limit = 100,
): Promise<{ scanned: number; projected: number; skipped: number }> {
  await retireOrphanedProjectedPeople(userId);

  const people = await db
    .select()
    .from(schema.people)
    .where(eq(schema.people.userId, userId))
    .limit(limit);

  let projected = 0;
  let skipped = 0;
  const personSlugs = personSlugMap(people);

  for (const person of people) {
    const name = person.name.trim();
    if (!name) {
      skipped += 1;
      continue;
    }

    const slug = personSlugs.get(person.id) ?? personPageSlug(name);
    const compiledTruth = compactPersonTruth(person);
    const [existing] = await db
      .select({
        compiledTruth: schema.brainPages.compiledTruth,
        sourceKind: schema.brainPages.sourceKind,
        sourceId: schema.brainPages.sourceId,
      })
      .from(schema.brainPages)
      .where(and(eq(schema.brainPages.userId, userId), eq(schema.brainPages.slug, slug)))
      .limit(1);

    if (
      existing?.compiledTruth === compiledTruth &&
      existing.sourceKind === "people" &&
      existing.sourceId === person.id
    ) {
      skipped += 1;
      continue;
    }

    await upsertEvidence({
      userId,
      actorId: "brain-people-projection",
      pageType: "person",
      slug,
      title: name,
      compiledTruth,
      sourceKind: "people",
      sourceId: person.id,
      provenance: [
        {
          kind: "people",
          id: person.id,
          timestamp: person.updatedAt.toISOString(),
        },
      ],
    });
    await retireStaleProjectedPersonSlugs({ id: person.id, userId, slug });
    projected += 1;
  }

  return { scanned: people.length, projected, skipped };
}

type QueryRow = {
  page_slug: string;
  page_title: string;
  page_provenance: ProvenanceRef[];
  chunk_content: string;
  chunk_provenance: ProvenanceRef[];
  chunk_embedding: number[] | null;
  score: number;
};

type BrainEmbedder = (content: string) => Promise<number[] | null>;

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value) || 0).join(",")}]`;
}

export async function queryBrainWithEmbedder(
  input: QueryBrainInput,
  queryEmbedder: BrainEmbedder,
): Promise<QueryBrainResult> {
  const topK = Math.max(1, Math.min(input.topK ?? 10, 50));
  const approvalPredicate =
    input.approvalFilter === "include_pending"
      ? sql`AND ${schema.brainPages.reviewStatus} IN ('active', 'pending', 'kept', 'edited')`
      : sql`AND ${schema.brainPages.reviewStatus} IN ('active', 'kept', 'edited')`;
  const queryEmbedding = await queryEmbedder(input.query);

  if (queryEmbedding) {
    const literal = vectorLiteral(queryEmbedding);
    const vectorResult = await db.execute(sql`
      SELECT
        ${schema.brainPages.slug} AS page_slug,
        ${schema.brainPages.title} AS page_title,
        ${schema.brainPages.provenance} AS page_provenance,
        ${schema.brainContentChunks.content} AS chunk_content,
        ${schema.brainContentChunks.provenance} AS chunk_provenance,
        ${schema.brainContentChunks.embedding} AS chunk_embedding,
        ts_rank_cd(
          to_tsvector('english', ${schema.brainContentChunks.content}),
          websearch_to_tsquery('english', ${input.query})
        ) AS score
      FROM ${schema.brainContentChunks}
      INNER JOIN ${schema.brainPages}
        ON ${schema.brainPages.id} = ${schema.brainContentChunks.pageId}
      WHERE ${schema.brainPages.userId} = ${input.userId}
        ${approvalPredicate}
        AND ${schema.brainContentChunks.embeddingVector} IS NOT NULL
      ORDER BY ${schema.brainContentChunks.embeddingVector} <=> ${literal}::vector ASC,
        score DESC,
        ${schema.brainPages.updatedAt} DESC
      LIMIT ${Math.min(topK * 3, 100)}
    `);
    const vectorRows = (vectorResult as unknown as { rows: QueryRow[] }).rows;
    const candidates: BrainChunkCandidate[] = vectorRows.map((row) => ({
      pageSlug: row.page_slug,
      pageTitle: row.page_title,
      content: row.chunk_content,
      pageProvenance: row.page_provenance ?? [],
      chunkProvenance: row.chunk_provenance ?? [],
      ftsScore: Number(row.score),
      embedding: row.chunk_embedding,
    }));
    return rankBrainChunkCandidates(candidates, queryEmbedding, topK);
  }

  const result = await db.execute(sql`
    SELECT
      ${schema.brainPages.slug} AS page_slug,
      ${schema.brainPages.title} AS page_title,
      ${schema.brainPages.provenance} AS page_provenance,
      ${schema.brainContentChunks.content} AS chunk_content,
      ${schema.brainContentChunks.provenance} AS chunk_provenance,
      ${schema.brainContentChunks.embedding} AS chunk_embedding,
      ts_rank_cd(
        to_tsvector('english', ${schema.brainContentChunks.content}),
        websearch_to_tsquery('english', ${input.query})
      ) AS score
    FROM ${schema.brainContentChunks}
    INNER JOIN ${schema.brainPages}
      ON ${schema.brainPages.id} = ${schema.brainContentChunks.pageId}
    WHERE ${schema.brainPages.userId} = ${input.userId}
      ${approvalPredicate}
      AND to_tsvector('english', ${schema.brainContentChunks.content})
        @@ websearch_to_tsquery('english', ${input.query})
    ORDER BY score DESC, ${schema.brainPages.updatedAt} DESC
    LIMIT ${topK}
  `);
  const rows = (result as unknown as { rows: QueryRow[] }).rows;

  const pagesBySlug = new Map<string, QueryBrainResult["pages"][number]>();
  const chunks: QueryBrainResult["chunks"] = [];

  for (const row of rows) {
    if (!pagesBySlug.has(row.page_slug)) {
      pagesBySlug.set(row.page_slug, {
        slug: row.page_slug,
        title: row.page_title,
        score: Number(row.score),
        citations: row.page_provenance ?? [],
      });
    }

    chunks.push({
      pageSlug: row.page_slug,
      content: row.chunk_content,
      score: Number(row.score),
      citations: row.chunk_provenance ?? [],
    });
  }

  return { pages: [...pagesBySlug.values()], chunks };
}

export async function queryBrain(input: QueryBrainInput): Promise<QueryBrainResult> {
  const queryEmbedder = process.env.JARVIS_BRAIN_VECTOR_RETRIEVAL === "1" ? embedText : async () => null;
  return queryBrainWithEmbedder(input, queryEmbedder);
}

export async function refreshIndexWithEmbedder(
  scope: BrainScope & { staleOnly?: boolean; limit?: number },
  embedder: BrainEmbedder,
): Promise<{ embedded: number; linked: number }> {
  const limit = Math.max(1, Math.min(scope.limit ?? 25, 100));
  const staleOnly = scope.staleOnly ?? true;
  const where = staleOnly
    ? and(eq(schema.brainContentChunks.userId, scope.userId), sql`${schema.brainContentChunks.embedding} IS NULL`)
    : eq(schema.brainContentChunks.userId, scope.userId);

  const chunks = await db
    .select({
      id: schema.brainContentChunks.id,
      content: schema.brainContentChunks.content,
    })
    .from(schema.brainContentChunks)
    .where(where)
    .limit(limit);

  let embedded = 0;
  for (const chunk of chunks) {
    const embedding = await embedder(chunk.content);
    if (!embedding) continue;

    await db
      .update(schema.brainContentChunks)
      .set({
        embedding,
        embeddingVector: embedding,
        updatedAt: new Date(),
      })
      .where(eq(schema.brainContentChunks.id, chunk.id));
    embedded += 1;
  }

  return { embedded, linked: 0 };
}

export async function refreshIndex(
  scope: BrainScope & { staleOnly?: boolean; limit?: number },
): Promise<{ embedded: number; linked: number }> {
  return refreshIndexWithEmbedder(scope, embedText);
}

export async function queueMaintenance(
  _scope: BrainScope & { job: "citation_fix" | "link_refresh" | "compact" | "daily_synthesis" },
): Promise<{ jobId: string }> {
  return { jobId: "not-queued-first-slice" };
}

export const jarvisBrainAdapter: JarvisBrainAdapter = {
  upsertEvidence,
  projectApprovedMemories,
  projectPeopleIntoBrain,
  query: queryBrain,
  refreshIndex,
  queueMaintenance,
};
