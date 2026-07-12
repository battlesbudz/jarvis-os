import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  console.log("server/commitments/__tests__/dbCommitmentRepository.assert.ts: DATABASE_URL not set - skipped");
  process.exit(0);
}

async function main(): Promise<void> {
  const { and, eq } = await import("drizzle-orm");
  const schema = await import("@shared/schema");
  const { db, ensureTablesExist, pool } = await import("../../db");
  const {
    CommitmentDedupeConflictError,
    createOrMergeCommitmentInDb,
    listPendingCommitmentsForReview,
    listPendingPersonalCommitments,
    updateCommitmentInDb,
  } = await import("../dbCommitmentRepository");

  const marker = `commitment-repository-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userId = marker;

  await ensureTablesExist();
  try {
    await db.insert(schema.users).values({ id: userId, username: userId });

    const concurrent = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      createOrMergeCommitmentInDb({
        userId,
        content: `Service report revision ${index + 1}`,
        commitmentKind: "operational_incident",
        signalLevel: "normal",
        sourceType: "heartbeat_crew",
        sourceMessage: "Added via heartbeat/crew",
        dedupeKey: "concurrent-service-report",
      })));

    assert.equal(new Set(concurrent.map((result) => result.commitment.id)).size, 1);
    const concurrentKey = "kind:operational_incident:topic:concurrent_service_report";
    const concurrentRows = await db
      .select()
      .from(schema.commitments)
      .where(and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.dedupeKey, concurrentKey),
      ));
    assert.equal(concurrentRows.length, 1, "concurrent writes should produce one canonical row");
    assert.equal(concurrentRows[0]?.history.length, 5, "every merged revision should remain auditable");
    const reclassified = await updateCommitmentInDb({
      userId,
      id: concurrent[0]!.commitment.id,
      commitmentKind: "user_task",
      signalLevel: "normal",
      includeNonPersonal: true,
    });
    assert.equal(reclassified?.commitmentKind, "user_task");
    assert.equal(reclassified?.history.length, 6, "reclassification should preserve the prior type");
    const completed = await updateCommitmentInDb({
      userId,
      id: concurrent[0]!.commitment.id,
      status: "done",
    });
    const reclassifiedAfterCompletion = await updateCommitmentInDb({
      userId,
      id: concurrent[0]!.commitment.id,
      commitmentKind: "user_commitment",
      signalLevel: "normal",
    });
    assert.equal(
      reclassifiedAfterCompletion?.resolvedAt?.getTime(),
      completed?.resolvedAt?.getTime(),
      "classification-only updates should preserve resolvedAt",
    );

    const personal = await createOrMergeCommitmentInDb({
      userId,
      content: "Review the production checklist.",
      commitmentKind: "user_task",
      signalLevel: "normal",
      sourceType: "agent",
      dedupeKey: "shared-topic",
    });
    const operational = await createOrMergeCommitmentInDb({
      userId,
      content: "Investigate the production checklist service warning.",
      commitmentKind: "operational_incident",
      signalLevel: "normal",
      sourceType: "monitoring",
      dedupeKey: "shared-topic",
    });
    assert.notEqual(personal.commitment.id, operational.commitment.id, "different kinds must not collide");
    await assert.rejects(
      updateCommitmentInDb({
        userId,
        id: operational.commitment.id,
        commitmentKind: "user_task",
        signalLevel: "normal",
        includeNonPersonal: true,
      }),
      (error: unknown) => error instanceof CommitmentDedupeConflictError,
      "reclassification should reject an occupied target key",
    );

    const exactFirst = await createOrMergeCommitmentInDb({
      userId,
      content: "Call the supplier tomorrow.",
      commitmentKind: "user_commitment",
      signalLevel: "normal",
      sourceType: "message_extract",
    });
    const exactSecond = await createOrMergeCommitmentInDb({
      userId,
      content: "  call   THE supplier tomorrow. ",
      commitmentKind: "user_commitment",
      signalLevel: "normal",
      sourceType: "message_extract",
    });
    assert.equal(exactFirst.commitment.id, exactSecond.commitment.id, "content keys should canonicalize once");

    await createOrMergeCommitmentInDb({
      userId,
      content: "Acknowledge an informational device alert.",
      commitmentKind: "notification",
      signalLevel: "low",
      sourceType: "android_notification",
      dedupeKey: "device-alert",
    });

    const personalRows = await listPendingPersonalCommitments(userId);
    assert.ok(personalRows.every((row) =>
      ["user_commitment", "user_task"].includes(row.commitmentKind) && row.signalLevel === "normal"));
    const reviewRows = await listPendingCommitmentsForReview(userId);
    assert.ok(reviewRows.some((row) => row.commitmentKind === "operational_incident"));
    assert.ok(reviewRows.some((row) => row.commitmentKind === "notification"));

    await db.insert(schema.commitments).values({
      userId,
      content: "Investigate an automatically reported service incident.",
      sourceMessage: "Added via heartbeat/crew",
    });
    await db.insert(schema.commitments).values({
      userId,
      content: "Review the supplier agreement tomorrow.",
      sourceMessage: "I will review the supplier agreement tomorrow.",
    });
    const malformedHash = "a".repeat(64);
    await db.insert(schema.commitments).values({
      userId,
      content: "Repair a previously scoped malformed key.",
      commitmentKind: "user_task",
      signalLevel: "normal",
      sourceType: "agent",
      dedupeKey: `kind:user_task:topic:content_${malformedHash}`,
      history: Array.from({ length: 25 }, (_, index) => ({
        content: `Historical observation ${index + 1}`,
        dueDate: null,
        status: "pending",
        commitmentKind: "user_task",
        signalLevel: "normal",
        dedupeKey: `kind:user_task:topic:content_${malformedHash}`,
        sourceType: "agent",
        sourceMessage: null,
        recordedAt: new Date(index * 1_000).toISOString(),
      })),
    });
    await ensureTablesExist();
    const [backfilled] = await db
      .select()
      .from(schema.commitments)
      .where(and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.content, "Investigate an automatically reported service incident."),
      ))
      .limit(1);
    assert.equal(backfilled?.commitmentKind, "operational_incident");
    assert.equal(backfilled?.history.length, 1, "legacy inference should retain its prior classification");
    const [legacyUserCommitment] = await db
      .select()
      .from(schema.commitments)
      .where(and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.content, "Review the supplier agreement tomorrow."),
      ))
      .limit(1);
    assert.equal(legacyUserCommitment?.commitmentKind, "user_commitment");
    assert.equal(legacyUserCommitment?.sourceType, "legacy_import");
    const [repaired] = await db
      .select()
      .from(schema.commitments)
      .where(and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.content, "Repair a previously scoped malformed key."),
      ))
      .limit(1);
    assert.equal(repaired?.dedupeKey, `kind:user_task:content:${malformedHash}`);
    assert.equal(repaired?.history.length, 20, "migration should bound pre-existing histories");

    console.log("OK: DB commitment ingestion is typed, concurrent, auditable, and reviewable");
  } finally {
    await db.delete(schema.commitments).where(eq(schema.commitments.userId, userId)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, userId)).catch(() => {});
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
