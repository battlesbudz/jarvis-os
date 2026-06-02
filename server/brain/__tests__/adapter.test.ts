import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { pool } from "../../db";
import { db } from "../../db";
import { jarvisBrainAdapter } from "../adapter";
import * as schema from "@shared/schema";

const TEST_USER_ID = "adapter-test-user";

async function cleanup(): Promise<void> {
  await db.delete(schema.brainPages).where(eq(schema.brainPages.userId, TEST_USER_ID));
  await db.delete(schema.brainIngestLog).where(eq(schema.brainIngestLog.userId, TEST_USER_ID));
  await db.delete(schema.brainConfig).where(eq(schema.brainConfig.userId, TEST_USER_ID));
  await db.delete(schema.userMemories).where(eq(schema.userMemories.userId, TEST_USER_ID));
  await db.delete(schema.users).where(eq(schema.users.id, TEST_USER_ID));
}

async function main(): Promise<void> {
  await cleanup();
  await db.insert(schema.users).values({ id: TEST_USER_ID, username: TEST_USER_ID });

  const refreshed = await jarvisBrainAdapter.refreshIndex({
    userId: TEST_USER_ID,
    actorId: "adapter-test",
  });
  assert.deepEqual(refreshed, { embedded: 0, linked: 0 });

  const queued = await jarvisBrainAdapter.queueMaintenance({
    userId: TEST_USER_ID,
    actorId: "adapter-test",
    job: "compact",
  });
  assert.deepEqual(queued, { jobId: "not-queued-first-slice" });

  await assert.rejects(
    () =>
      jarvisBrainAdapter.upsertEvidence({
        userId: TEST_USER_ID,
        actorId: "adapter-test",
        approvalMode: "review_required",
        pageType: "memory",
        slug: "memory/test",
        title: "Test",
        compiledTruth: "Should not be written.",
        sourceKind: "test",
        sourceId: "test",
        provenance: [{ kind: "user_memory", id: "test" }],
      }),
    /review_required/,
  );

  const firstUpsert = await jarvisBrainAdapter.upsertEvidence({
    userId: TEST_USER_ID,
    actorId: "adapter-test",
    pageType: "memory",
    slug: "memory/idempotent",
    title: "Idempotent memory",
    compiledTruth: "The first truth should become a searchable chunk.",
    sourceKind: "test",
    sourceId: "idempotent",
    provenance: [{ kind: "user_memory", id: "idempotent" }],
    links: [
      { toSlug: "memory/old-link", verb: "mentions", confidence: 25 },
      { toSlug: "memory/current-link", verb: "supports", confidence: 55 },
    ],
    timelineAppend: [{ summary: "Original timeline", detail: "first", at: "2026-01-01T00:00:00.000Z" }],
  });

  await jarvisBrainAdapter.upsertEvidence({
    userId: TEST_USER_ID,
    actorId: "adapter-test",
    pageType: "memory",
    slug: "memory/idempotent",
    title: "Idempotent memory",
    compiledTruth: "The replacement truth should be the only chunk.",
    sourceKind: "test",
    sourceId: "idempotent",
    provenance: [{ kind: "user_memory", id: "idempotent-replacement" }],
    links: [{ toSlug: "memory/current-link", verb: "supports", confidence: 90 }],
    timelineAppend: [{ summary: "Replacement timeline", detail: "second", at: "2026-01-02T00:00:00.000Z" }],
  });

  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainTimelineEntries)
          .where(eq(schema.brainTimelineEntries.pageId, firstUpsert.pageId))
      )[0]?.count ?? 0,
    ),
    1,
    "upsertEvidence replaces timeline entries for the page",
  );
  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainLinks)
          .where(eq(schema.brainLinks.fromPageId, firstUpsert.pageId))
      )[0]?.count ?? 0,
    ),
    1,
    "upsertEvidence removes omitted links for the page",
  );

  const [currentLink] = await db
    .select({ toSlug: schema.brainLinks.toSlug, confidence: schema.brainLinks.confidence })
    .from(schema.brainLinks)
    .where(eq(schema.brainLinks.fromPageId, firstUpsert.pageId));
  assert.deepEqual(currentLink, { toSlug: "memory/current-link", confidence: 90 });

  const memoryId = "adapter-expired-memory";
  await db.insert(schema.userMemories).values({
    id: memoryId,
    userId: TEST_USER_ID,
    content: "A projected memory that should later retire.",
    category: "fact",
    reviewStatus: "active",
    pendingReview: false,
  });

  const projected = await jarvisBrainAdapter.projectApprovedMemories(TEST_USER_ID);
  assert.equal(projected.projected, 1);

  const [projectedPage] = await db
    .select({ id: schema.brainPages.id })
    .from(schema.brainPages)
    .where(eq(schema.brainPages.sourceId, memoryId));

  await db.insert(schema.brainTimelineEntries).values({
    userId: TEST_USER_ID,
    pageId: projectedPage.id,
    occurredAt: new Date("2026-01-03T00:00:00.000Z"),
    summary: "Retired stale timeline",
    detail: "This should be removed when the projected memory is retired.",
    provenance: [{ kind: "user_memory", id: memoryId }],
  });

  await db
    .update(schema.userMemories)
    .set({ reviewStatus: "discarded", pendingReview: true })
    .where(eq(schema.userMemories.id, memoryId));

  const retired = await jarvisBrainAdapter.projectApprovedMemories(TEST_USER_ID);
  assert.equal(retired.skipped, 1);

  const [retiredPage] = await db
    .select({ id: schema.brainPages.id, reviewStatus: schema.brainPages.reviewStatus })
    .from(schema.brainPages)
    .where(eq(schema.brainPages.sourceId, memoryId));
  assert.equal(retiredPage.reviewStatus, "discarded");
  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainContentChunks)
          .where(eq(schema.brainContentChunks.pageId, retiredPage.id))
      )[0]?.count ?? 0,
    ),
    0,
    "retired projected memories remove stale chunks",
  );
  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainTimelineEntries)
          .where(eq(schema.brainTimelineEntries.pageId, retiredPage.id))
      )[0]?.count ?? 0,
    ),
    0,
    "retired projected memories remove stale timeline entries",
  );

  const orphanMemoryId = "adapter-orphaned-memory";
  await db.insert(schema.userMemories).values({
    id: orphanMemoryId,
    userId: TEST_USER_ID,
    content: "A hard-deleted memory projection should be retired.",
    category: "fact",
    reviewStatus: "active",
    pendingReview: false,
  });

  const orphanProjected = await jarvisBrainAdapter.projectApprovedMemories(TEST_USER_ID);
  assert.equal(orphanProjected.projected, 1);

  const [orphanPage] = await db
    .select({ id: schema.brainPages.id })
    .from(schema.brainPages)
    .where(eq(schema.brainPages.sourceId, orphanMemoryId));

  await db.insert(schema.brainLinks).values({
    userId: TEST_USER_ID,
    fromPageId: orphanPage.id,
    toSlug: "memory/orphan-target",
    verb: "mentions",
    confidence: 70,
    provenance: [{ kind: "user_memory", id: orphanMemoryId }],
  });
  await db.insert(schema.brainTimelineEntries).values({
    userId: TEST_USER_ID,
    pageId: orphanPage.id,
    occurredAt: new Date("2026-01-04T00:00:00.000Z"),
    summary: "Orphan stale timeline",
    detail: "This should be removed when the orphaned projection is retired.",
    provenance: [{ kind: "user_memory", id: orphanMemoryId }],
  });

  const otherSource = await jarvisBrainAdapter.upsertEvidence({
    userId: TEST_USER_ID,
    actorId: "adapter-test",
    pageType: "memory",
    slug: "memory/non-user-memory-source",
    title: "Non-user-memory source",
    compiledTruth: "This orphan is from a different source kind and should stay active.",
    sourceKind: "test",
    sourceId: "missing-test-source",
    provenance: [{ kind: "user_memory", id: "missing-test-source" }],
  });

  await db.delete(schema.userMemories).where(eq(schema.userMemories.id, orphanMemoryId));

  const orphanRetired = await jarvisBrainAdapter.projectApprovedMemories(TEST_USER_ID);
  assert.equal(orphanRetired.skipped, 0);

  const [retiredOrphanPage] = await db
    .select({ reviewStatus: schema.brainPages.reviewStatus })
    .from(schema.brainPages)
    .where(eq(schema.brainPages.id, orphanPage.id));
  assert.equal(retiredOrphanPage.reviewStatus, "discarded");
  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainContentChunks)
          .where(eq(schema.brainContentChunks.pageId, orphanPage.id))
      )[0]?.count ?? 0,
    ),
    0,
    "orphaned projected memories remove stale chunks",
  );
  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainTimelineEntries)
          .where(eq(schema.brainTimelineEntries.pageId, orphanPage.id))
      )[0]?.count ?? 0,
    ),
    0,
    "orphaned projected memories remove stale timeline entries",
  );
  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainLinks)
          .where(eq(schema.brainLinks.fromPageId, orphanPage.id))
      )[0]?.count ?? 0,
    ),
    0,
    "orphaned projected memories remove stale outgoing links",
  );

  const [untouchedOtherSource] = await db
    .select({ reviewStatus: schema.brainPages.reviewStatus })
    .from(schema.brainPages)
    .where(eq(schema.brainPages.id, otherSource.pageId));
  assert.equal(untouchedOtherSource.reviewStatus, "active");

  const editedMemoryId = "adapter-edited-memory";
  await db.insert(schema.userMemories).values({
    id: editedMemoryId,
    userId: TEST_USER_ID,
    content: "Original approved memory content should be replaced.",
    category: "fact",
    reviewStatus: "active",
    pendingReview: false,
  });

  const originalEditProjection = await jarvisBrainAdapter.projectApprovedMemories(TEST_USER_ID);
  assert.equal(originalEditProjection.projected, 1);

  const [originalEditPage] = await db
    .select({ id: schema.brainPages.id, slug: schema.brainPages.slug })
    .from(schema.brainPages)
    .where(eq(schema.brainPages.sourceId, editedMemoryId));

  await db.insert(schema.brainLinks).values({
    userId: TEST_USER_ID,
    fromPageId: originalEditPage.id,
    toSlug: "memory/edited-target",
    verb: "mentions",
    confidence: 65,
    provenance: [{ kind: "user_memory", id: editedMemoryId }],
  });
  await db.insert(schema.brainTimelineEntries).values({
    userId: TEST_USER_ID,
    pageId: originalEditPage.id,
    occurredAt: new Date("2026-01-05T00:00:00.000Z"),
    summary: "Edited stale timeline",
    detail: "This should be removed when the edited memory gets a new slug.",
    provenance: [{ kind: "user_memory", id: editedMemoryId }],
  });

  await db
    .update(schema.userMemories)
    .set({ content: "Edited approved memory content should get the active projection." })
    .where(eq(schema.userMemories.id, editedMemoryId));

  const editedProjection = await jarvisBrainAdapter.projectApprovedMemories(TEST_USER_ID);
  assert.equal(editedProjection.projected, 1);

  const editedPages = await db
    .select({
      id: schema.brainPages.id,
      slug: schema.brainPages.slug,
      reviewStatus: schema.brainPages.reviewStatus,
    })
    .from(schema.brainPages)
    .where(eq(schema.brainPages.sourceId, editedMemoryId));

  const currentEditPage = editedPages.find((page) => page.slug !== originalEditPage.slug);
  const staleEditPage = editedPages.find((page) => page.id === originalEditPage.id);
  assert.equal(currentEditPage?.reviewStatus, "active");
  assert.equal(staleEditPage?.reviewStatus, "discarded");
  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainContentChunks)
          .where(eq(schema.brainContentChunks.pageId, originalEditPage.id))
      )[0]?.count ?? 0,
    ),
    0,
    "edited projected memories remove stale chunks from the old slug",
  );
  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainTimelineEntries)
          .where(eq(schema.brainTimelineEntries.pageId, originalEditPage.id))
      )[0]?.count ?? 0,
    ),
    0,
    "edited projected memories remove stale timeline entries from the old slug",
  );
  assert.equal(
    Number(
      (
        await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.brainLinks)
          .where(eq(schema.brainLinks.fromPageId, originalEditPage.id))
      )[0]?.count ?? 0,
    ),
    0,
    "edited projected memories remove stale outgoing links from the old slug",
  );

  console.log("OK: brain adapter idempotency, retirement, orphan cleanup, first-slice stubs, and approval gate");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await pool.end();
  });
