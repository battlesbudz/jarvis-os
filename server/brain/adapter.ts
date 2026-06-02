import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { chunkText } from "./chunk";
import { memoryPageSlug } from "./slug";
import type {
  BrainLinkInput,
  BrainScope,
  JarvisBrainAdapter,
  ProvenanceRef,
  QueryBrainInput,
  QueryBrainResult,
  UpsertEvidenceInput,
} from "./types";

function assertWritableApproval(input: Pick<UpsertEvidenceInput, "approvalMode">): void {
  if (input.approvalMode === "review_required") {
    throw new Error("Brain adapter cannot upsert review_required evidence in the first slice");
  }
}

function toDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
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

async function retireProjectedMemory(memory: { id: string; userId: string }): Promise<void> {
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
      ),
    )
    .returning({ id: schema.brainPages.id });

  await clearProjectedPageEdges(pages.map((page) => page.id));
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
      await retireProjectedMemory({ id: memory.id, userId });
      skipped += 1;
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
    });
    await retireStaleProjectedMemorySlugs({ id: memory.id, userId, slug });
    projected += 1;
  }

  return { scanned: memories.length, projected, skipped };
}

type QueryRow = {
  page_slug: string;
  page_title: string;
  page_provenance: ProvenanceRef[];
  chunk_content: string;
  chunk_provenance: ProvenanceRef[];
  score: number;
};

export async function queryBrain(input: QueryBrainInput): Promise<QueryBrainResult> {
  const topK = Math.max(1, Math.min(input.topK ?? 10, 50));
  const approvalPredicate =
    input.approvalFilter === "include_pending"
      ? sql`AND ${schema.brainPages.reviewStatus} IN ('active', 'pending', 'kept', 'edited')`
      : sql`AND ${schema.brainPages.reviewStatus} IN ('active', 'kept', 'edited')`;

  const result = await db.execute(sql`
    SELECT
      ${schema.brainPages.slug} AS page_slug,
      ${schema.brainPages.title} AS page_title,
      ${schema.brainPages.provenance} AS page_provenance,
      ${schema.brainContentChunks.content} AS chunk_content,
      ${schema.brainContentChunks.provenance} AS chunk_provenance,
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

export async function refreshIndex(
  _scope: BrainScope & { staleOnly?: boolean },
): Promise<{ embedded: number; linked: number }> {
  return { embedded: 0, linked: 0 };
}

export async function queueMaintenance(
  _scope: BrainScope & { job: "citation_fix" | "link_refresh" | "compact" | "daily_synthesis" },
): Promise<{ jobId: string }> {
  return { jobId: "not-queued-first-slice" };
}

export const jarvisBrainAdapter: JarvisBrainAdapter = {
  upsertEvidence,
  projectApprovedMemories,
  query: queryBrain,
  refreshIndex,
  queueMaintenance,
};
