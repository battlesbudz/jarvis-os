import assert from "node:assert/strict";
import type { RetrievedMemory } from "../retrieve";
import type { MemoryCorrectionInput } from "../memoryOs";
import type { MemoryWriteInput } from "../writePipeline";

process.env.DATABASE_URL ??= "postgres://localhost/jarvis_memory_os_import_only";
process.env.JARVIS_DISABLE_DIRECT_OPENAI = "1";
process.env.JARVIS_TRACE_HMAC_KEY ??= "memory-os-test-trace-key";

function memory(overrides: Partial<RetrievedMemory> = {}): RetrievedMemory {
  return {
    id: "memory-os-1",
    content: "The user prefers crisp morning plans.",
    category: "preferences",
    tier: "long_term",
    memoryType: "semantic",
    relevanceScore: 86,
    confidence: 92,
    accessCount: 2,
    score: 0.93,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const {
    retrieveMemoryContext,
    memoryContextItemsToRetrievedMemories,
    explainMemoryAnswer,
    recordMemoryCorrection,
    buildMemoryCorrectionReview,
  } = await import("../memoryOs");

  const context = await retrieveMemoryContext(
    {
      userId: "memory-os-user",
      query: "morning planning",
      limit: 3,
      caller: "memory_search",
      skipAccessUpdate: true,
    },
    {
      retrieveMemories: async (userId, query, limit, skipAccessUpdate, options) => {
        assert.equal(userId, "memory-os-user");
        assert.equal(query, "morning planning");
        assert.equal(limit, 12);
        assert.equal(skipAccessUpdate, true);
        assert.equal(options?.includeRestricted, true);
        return [memory()];
      },
    },
  );

  assert.equal(context.query, "morning planning");
  assert.equal(context.caller, "memory_search");
  assert.equal(context.items.length, 1);
  assert.deepEqual(context.sources.memories, ["memory-os-1"]);
  assert.deepEqual(context.sources.brainChunks, []);
  assert.deepEqual(context.sources.hotState, []);
  assert.equal(context.provenance[0]?.kind, "user_memory");
  assert.equal(context.provenance[0]?.id, "memory-os-1");
  assert.equal(context.provenance[0]?.source, "canonical");
  assert.deepEqual(context.uncertainty, []);
  assert.equal(context.items[0]?.provenance[0]?.id, "memory-os-1");
  assert.equal(context.items[0]?.memory.category, "preferences");
  assert.equal(context.trace?.contentFree, true);
  assert.equal(context.trace?.input.queryLength, "morning planning".length);
  assert.equal(context.trace?.input.queryFingerprint?.length, 24);
  assert.equal(context.trace?.identifiersOmitted, false);
  assert.equal(context.trace?.selectedIds.length, 1);
  assert.match(context.trace?.selectedIds[0] ?? "", /^memory_[a-f0-9]{24}$/);
  assert.notEqual(context.trace?.selectedIds[0], "memory-os-1");
  assert.deepEqual(
    context.trace?.stages.map((stage) => stage.stage),
    ["primary_retrieval", "privacy_boundary", "context_selection"],
  );
  assert.equal(JSON.stringify(context.trace).includes("crisp morning plans"), false);

  const roundTrip = memoryContextItemsToRetrievedMemories(context.items);
  assert.deepEqual(roundTrip, [memory()]);

  const gbrainContext = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "derived planning", caller: "gbrain_retrieval" },
    {
      retrieveMemories: async () => [
        memory({
          id: "memory-canonical-2",
          content: "A derived G-Brain chunk with canonical citation.",
          source: "gbrain",
          sourceId: "memory/derived-planning:0",
          sourceRefs: [{ kind: "user_memory", id: "memory-canonical-2" }],
        }),
      ],
    },
  );

  assert.deepEqual(gbrainContext.sources.brainChunks, ["memory/derived-planning:0"]);
  assert.deepEqual(gbrainContext.sources.memories, ["memory-canonical-2"]);
  assert.equal(gbrainContext.items[0]?.provenance[0]?.kind, "brain_chunk");
  assert.equal(gbrainContext.items[0]?.provenance[0]?.source, "gbrain");
  assert.equal(gbrainContext.items[0]?.provenance[1]?.kind, "user_memory");
  assert.equal(gbrainContext.items[0]?.provenance[1]?.source, "canonical");
  assert.equal(JSON.stringify(gbrainContext.trace).includes("memory/derived-planning"), false);
  assert.equal(JSON.stringify(gbrainContext.trace).includes("memory-canonical-2"), false);

  const fusedContext = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "fused planning", caller: "gbrain_retrieval" },
    {
      retrieveMemories: async () => [
        memory({
          id: "memory-fused-1",
          source: "canonical",
          sourceId: "memory-fused-1",
          sourceRefs: [{ kind: "user_memory", id: "memory-fused-1" }],
          retrieval: {
            strategy: "rrf",
            fusionScore: 0.03,
            sources: [
              { source: "canonical", sourceId: "memory-fused-1", rank: 1, score: 0.9 },
              { source: "gbrain", sourceId: "memory/fused-planning:0", rank: 2, score: 88 },
            ],
          },
        }),
      ],
    },
  );
  assert.deepEqual(fusedContext.sources.memories, ["memory-fused-1"]);
  assert.deepEqual(fusedContext.sources.brainChunks, ["memory/fused-planning:0"]);
  assert.deepEqual(
    fusedContext.items[0]?.provenance.map((ref) => ref.kind),
    ["brain_chunk", "user_memory"],
  );

  const degradedContext = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "degraded planning", caller: "memory_search" },
    {
      retrieveMemories: async () => [
        memory({
          retrieval: {
            strategy: "rrf",
            fusionScore: 0.02,
            degradedSources: ["gbrain"],
            sources: [{ source: "canonical", sourceId: "memory-os-1", rank: 1, score: 0.9 }],
          },
        }),
      ],
    },
  );
  assert.match(degradedContext.uncertainty.join(" "), /G-Brain retrieval was unavailable/);

  const empty = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "   ", caller: "coach_context" },
    {
      retrieveMemories: async () => {
        throw new Error("empty query should not hit retrieval");
      },
    },
  );
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.uncertainty, ["No memory query was provided."]);
  assert.equal(empty.trace?.outcome, "invalid_input");

  const failed = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "planning", caller: "daily_command" },
    {
      retrieveMemories: async () => {
        throw new Error("database unavailable");
      },
    },
  );
  assert.deepEqual(failed.items, []);
  assert.match(failed.uncertainty[0] ?? "", /database unavailable/);
  assert.equal(failed.trace?.outcome, "error");
  assert.equal(failed.trace?.errorName, "Error");

  const restricted = memory({
    id: "restricted-summary-1",
    content: "Food delivery spending is trending up. Account number 123456789, debit card ending in 1234, and available balance $500 were present in the raw source.",
    sensitivity: "restricted_summary",
    provenance: [{
      sourceType: "plaid_transaction_rollup",
      sourceRef: "rollup-1",
      restricted: true,
      sensitivity: "restricted_summary",
    }],
  });

  const cloudRestricted = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "food delivery spending", caller: "coach_context" },
    { retrieveMemories: async () => [restricted] },
  );
  assert.deepEqual(cloudRestricted.items, []);
  assert.match(cloudRestricted.uncertainty.join(" "), /withheld from cloud model context/);
  assert.equal(
    cloudRestricted.trace?.stages.find((stage) => stage.stage === "privacy_boundary")?.candidates[0]?.disposition,
    "withheld",
  );

  const legacyRestricted = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "legacy plaid", caller: "coach_context" },
    {
      retrieveMemories: async () => [
        memory({
          id: "legacy-plaid-1",
          content: "Legacy Plaid memory from before the restricted metadata migration.",
          sourceType: "plaid_transaction_rollup",
          sourceRef: "legacy-rollup-1",
          sensitivity: "normal",
          provenance: [],
        }),
      ],
    },
  );
  assert.deepEqual(legacyRestricted.items, []);
  assert.match(legacyRestricted.uncertainty.join(" "), /withheld from cloud model context/);

  const legacyAccountBalanceRestricted = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "account balance", caller: "coach_context" },
    {
      retrieveMemories: async () => [
        memory({
          id: "legacy-account-balance-1",
          content: "Legacy account balance memory from before the restricted metadata migration.",
          sourceType: "account_balance",
          sourceRef: "account-balance:primary",
          sensitivity: "normal",
          provenance: [],
        }),
      ],
    },
  );
  assert.deepEqual(legacyAccountBalanceRestricted.items, []);
  assert.match(legacyAccountBalanceRestricted.uncertainty.join(" "), /withheld from cloud model context/);

  const legacyRestrictedRefOnly = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "transaction source ref", caller: "coach_context" },
    {
      retrieveMemories: async () => [
        memory({
          id: "legacy-ref-only-1",
          content: "Legacy source-ref-only restricted memory from before metadata normalization.",
          sourceType: "manual",
          sourceRef: "plaid:transactions:123",
          sensitivity: "normal",
          provenance: [],
        }),
      ],
    },
  );
  assert.deepEqual(legacyRestrictedRefOnly.items, []);
  assert.match(legacyRestrictedRefOnly.uncertainty.join(" "), /withheld from cloud model context/);

  const legacyRawContentRestricted = await retrieveMemoryContext(
    { userId: "memory-os-user", query: "checking balance", caller: "coach_context" },
    {
      retrieveMemories: async () => [
        memory({
          id: "legacy-raw-balance-1",
          content: "My current checking balance is $5,000.",
          sourceType: "manual",
          sourceRef: "legacy-chat",
          sensitivity: "normal",
          provenance: [],
        }),
      ],
    },
  );
  assert.deepEqual(legacyRawContentRestricted.items, []);
  assert.match(legacyRawContentRestricted.uncertainty.join(" "), /withheld from cloud model context/);

  const underfilledCloudContext = await retrieveMemoryContext(
    {
      userId: "memory-os-user",
      query: "spending preference",
      caller: "coach_context",
      limit: 1,
    },
    {
      retrieveMemories: async (_userId, _query, limit) => {
        assert.equal(limit, 4);
        return [
          restricted,
          memory({
            id: "normal-memory-after-restricted",
            content: "The user prefers weekly spending summaries.",
            category: "preferences",
          }),
        ];
      },
    },
  );
  assert.equal(underfilledCloudContext.items.length, 1);
  assert.equal(underfilledCloudContext.items[0]?.memory.id, "normal-memory-after-restricted");
  assert.match(underfilledCloudContext.uncertainty.join(" "), /withheld from cloud model context/);

  const fallbackCalls: { limit: number; canonicalOnly?: boolean }[] = [];
  const canonicalFallbackAfterRestrictedBrain = await retrieveMemoryContext(
    {
      userId: "memory-os-user",
      query: "spending fallback",
      caller: "coach_context",
      limit: 2,
    },
    {
      retrieveMemories: async (_userId, _query, limit, _skipAccessUpdate, options) => {
        fallbackCalls.push({ limit, canonicalOnly: options?.canonicalOnly });
        if (options?.canonicalOnly) {
          return [
            memory({
              id: "canonical-normal-after-restricted-brain",
              content: "The user prefers monthly spending summaries.",
              category: "preferences",
            }),
          ];
        }
        return [
          memory({
            id: "restricted-brain-hit",
            content: "Restricted projected spending summary.",
            source: "gbrain",
            sourceId: "memory/restricted-spending:0",
            sourceRefs: [{
              kind: "user_memory",
              id: "restricted-brain-hit",
              sourceType: "plaid:transactions",
              sourceRef: "plaid:transactions:123",
            }],
          }),
        ];
      },
    },
  );
  assert.deepEqual(fallbackCalls, [
    { limit: 8, canonicalOnly: false },
    { limit: 8, canonicalOnly: true },
  ]);
  assert.equal(canonicalFallbackAfterRestrictedBrain.items.length, 1);
  assert.equal(
    canonicalFallbackAfterRestrictedBrain.items[0]?.memory.id,
    "canonical-normal-after-restricted-brain",
  );
  assert.match(canonicalFallbackAfterRestrictedBrain.uncertainty.join(" "), /withheld from cloud model context/);
  assert.equal(canonicalFallbackAfterRestrictedBrain.trace?.fallbackUsed, true);
  assert.deepEqual(
    canonicalFallbackAfterRestrictedBrain.trace?.stages.map((stage) => stage.stage),
    ["primary_retrieval", "privacy_boundary", "canonical_fallback", "context_selection"],
  );

  const filteredAccessUpdates: string[][] = [];
  const filteredAccessContext = await retrieveMemoryContext(
    {
      userId: "memory-os-user",
      query: "restricted access update",
      caller: "coach_context",
      limit: 2,
    },
    {
      retrieveMemories: async (_userId, _query, _limit, skipAccessUpdate) => {
        assert.equal(skipAccessUpdate, true);
        return [
          restricted,
          memory({
            id: "returned-normal-memory",
            content: "Normal memory that should receive the access update.",
          }),
        ];
      },
      incrementAccessCount: (ids) => {
        filteredAccessUpdates.push(ids);
      },
    },
  );
  assert.equal(filteredAccessContext.items.length, 1);
  assert.deepEqual(filteredAccessUpdates, [["returned-normal-memory"]]);

  const localRestricted = await retrieveMemoryContext(
    {
      userId: "memory-os-user",
      query: "food delivery spending",
      caller: "coach_context",
      modelTarget: "local",
    },
    { retrieveMemories: async () => [restricted] },
  );
  assert.equal(localRestricted.items.length, 1);
  assert.match(localRestricted.items[0]?.memory.content ?? "", /^Restricted summary:/);
  assert.doesNotMatch(localRestricted.items[0]?.memory.content ?? "", /123456789/);
  assert.doesNotMatch(localRestricted.items[0]?.memory.content ?? "", /1234/);
  assert.doesNotMatch(localRestricted.items[0]?.memory.content ?? "", /\$500/);
  assert.match(localRestricted.uncertainty.join(" "), /sanitized for local model context/);
  assert.equal(
    localRestricted.trace?.stages.find((stage) => stage.stage === "privacy_boundary")?.candidates[0]?.disposition,
    "sanitized",
  );

  const allowedCloudRestricted = await retrieveMemoryContext(
    {
      userId: "memory-os-user",
      query: "food delivery spending",
      caller: "coach_context",
      modelTarget: "cloud",
      allowRestrictedMemory: true,
    },
    { retrieveMemories: async () => [restricted] },
  );
  assert.equal(allowedCloudRestricted.items.length, 1);
  assert.match(allowedCloudRestricted.items[0]?.memory.content ?? "", /123456789/);

  const answerExplanation = await explainMemoryAnswer({
    answer: "You prefer crisp morning plans.",
    context: {
      ...context,
      items: [{
        memory: memory({
          source: "canonical",
          sourceId: "memory-os-1",
          sourceType: "conversation",
          sourceRef: "chat-turn-42",
          retrieval: {
            strategy: "rrf",
            fusionScore: 0.03,
            sources: [
              { source: "canonical", sourceId: "memory-os-1", rank: 1, score: 0.93 },
              { source: "gbrain", sourceId: "memory/planning:0", rank: 2, score: 88 },
            ],
          },
        }),
        provenance: [
          { kind: "brain_chunk", id: "memory/planning:0", source: "gbrain" },
          { kind: "user_memory", id: "memory-os-1", source: "canonical" },
        ],
      }],
      provenance: [
        { kind: "brain_chunk", id: "memory/planning:0", source: "gbrain" },
        { kind: "user_memory", id: "memory-os-1", source: "canonical" },
      ],
      sources: {
        memories: ["memory-os-1"],
        brainChunks: ["memory/planning:0"],
        hotState: [],
      },
    },
  });
  assert.equal(answerExplanation.available, true);
  assert.equal(answerExplanation.answer, "You prefer crisp morning plans.");
  assert.equal(answerExplanation.evidence[0]?.memoryId, "memory-os-1");
  assert.equal(answerExplanation.evidence[0]?.authority, "canonical");
  assert.match(answerExplanation.evidence[0]?.whyJarvisLearnedIt ?? "", /conversation context/);
  assert.match(answerExplanation.evidence[0]?.whyJarvisLearnedIt ?? "", /G-Brain/);
  assert.deepEqual(
    answerExplanation.evidence[0]?.provenance.map((ref) => `${ref.kind}:${ref.id}`),
    ["brain_chunk:memory/planning:0", "user_memory:memory-os-1"],
  );

  const savedTraceKey = process.env.JARVIS_TRACE_HMAC_KEY;
  const savedJwtSecret = process.env.JWT_SECRET;
  delete process.env.JARVIS_TRACE_HMAC_KEY;
  delete process.env.JWT_SECRET;
  try {
    const traceWithoutKey = await retrieveMemoryContext(
      { userId: "memory-os-user", query: "planning without trace key", caller: "memory_search" },
      { retrieveMemories: async () => [memory()] },
    );
    assert.equal(traceWithoutKey.trace?.identifiersOmitted, true);
    assert.equal(traceWithoutKey.trace?.input.queryFingerprint, undefined);
    assert.deepEqual(traceWithoutKey.trace?.selectedIds, []);
    assert.equal(traceWithoutKey.trace?.stages[0]?.candidates[0]?.id, undefined);
  } finally {
    if (savedTraceKey === undefined) delete process.env.JARVIS_TRACE_HMAC_KEY;
    else process.env.JARVIS_TRACE_HMAC_KEY = savedTraceKey;
    if (savedJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwtSecret;
  }

  const correctionWriteInputs: MemoryWriteInput[] = [];
  const correctionInput: MemoryCorrectionInput = {
    userId: "memory-os-user",
    operation: "correct_existing_memory",
    currentMemoryId: "memory-os-1",
    currentMemoryContent: "The user starts daily planning at 9:00.",
    proposedContent: " The user starts daily planning at 8:30. ",
    reason: "User corrected the previous schedule.",
    confidence: 0.94,
    source: {
      kind: "runtime_memory_calibration",
      eventId: "runtime-memory-event-1",
      eventSource: "app",
      channel: "settings-runtime-preview",
      previewId: "runtime-memory-calibration-runtime-memory-event-1",
      createdAt: "2026-06-08T21:00:00.000Z",
    },
    provenance: [
      {
        kind: "runtime_event",
        id: "runtime-memory-event-1",
        source: "runtime",
        label: "settings-runtime-preview",
      },
      {
        kind: "user_memory",
        id: "memory-os-1",
        source: "canonical",
        label: "preferences",
      },
    ],
  };
  const correction = await recordMemoryCorrection(correctionInput, {
    loadCurrentMemory: async (loadedUserId, memoryId) => {
      assert.equal(loadedUserId, "memory-os-user");
      assert.equal(memoryId, "memory-os-1");
      return {
        id: "memory-os-1",
        content: "The user starts daily planning at 9:00.",
        category: "preferences",
        tier: "long_term",
        memoryType: "semantic",
        confidence: 91,
      };
    },
    findCorrectionBySource: async () => null,
    writeMemory: async (input) => {
      correctionWriteInputs.push(input);
      return {
        status: "review_required",
        reason: "Queued for review.",
        insertedMemoryId: "memory-os-correction-1",
        supersededMemoryIds: [],
        oneTimeReviewTip: false,
      };
    },
  });

  assert.equal(correction.recorded, true);
  assert.equal(correction.reviewOnly, true);
  assert.equal(correction.status, "review_required");
  assert.equal(correction.correctionMemoryId, "memory-os-correction-1");
  assert.equal(correction.operation, "correct_existing_memory");
  assert.equal(correction.currentMemoryId, "memory-os-1");
  assert.equal(correction.proposedContent, "The user starts daily planning at 8:30.");
  assert.equal(correction.source?.eventId, "runtime-memory-event-1");
  assert.deepEqual(
    correction.provenance.map((ref) => `${ref.kind}:${ref.source}:${ref.id}`),
    [
      "runtime_event:runtime:runtime-memory-event-1",
      "user_memory:canonical:memory-os-1",
    ],
  );
  assert.equal(correctionWriteInputs[0]?.trigger, "inferred");
  assert.equal(correctionWriteInputs[0]?.reviewEnabled, true);
  assert.equal(correctionWriteInputs[0]?.supersedesMemoryId, "memory-os-1");
  assert.equal(correctionWriteInputs[0]?.confidence, 94);

  let duplicateWriteCalled = false;
  const duplicateCorrection = await recordMemoryCorrection(correctionInput, {
    loadCurrentMemory: async () => {
      throw new Error("an already processed source event must bypass stale source-memory validation");
    },
    findCorrectionBySource: async () => ({
      id: "memory-os-correction-existing",
      pendingReview: true,
      reviewStatus: "pending",
    }),
    writeMemory: async () => {
      duplicateWriteCalled = true;
      throw new Error("duplicate correction must not write again");
    },
  });
  assert.equal(duplicateWriteCalled, false);
  assert.equal(duplicateCorrection.recorded, false);
  assert.equal(duplicateCorrection.correctionMemoryId, "memory-os-correction-existing");
  assert.equal(duplicateCorrection.status, "review_required");

  let raceLookupCount = 0;
  const racedCorrection = await recordMemoryCorrection(correctionInput, {
    loadCurrentMemory: async () => ({
      id: "memory-os-1",
      content: "The user starts daily planning at 9:00.",
      category: "preferences",
      tier: "long_term",
      memoryType: "semantic",
      confidence: 91,
    }),
    findCorrectionBySource: async () => {
      raceLookupCount += 1;
      return raceLookupCount === 1
        ? null
        : { id: "memory-os-correction-race", pendingReview: true, reviewStatus: "pending" };
    },
    writeMemory: async () => {
      throw Object.assign(new Error("duplicate correction source"), { code: "23505" });
    },
  });
  assert.equal(raceLookupCount, 2);
  assert.equal(racedCorrection.recorded, false);
  assert.equal(racedCorrection.correctionMemoryId, "memory-os-correction-race");
  assert.equal(racedCorrection.status, "review_required");

  const staleCorrection = await recordMemoryCorrection(correctionInput, {
    loadCurrentMemory: async () => ({
      id: "memory-os-1",
      content: "The user already changed daily planning to 8:45.",
      category: "preferences",
      tier: "long_term",
      memoryType: "semantic",
      confidence: 95,
    }),
    findCorrectionBySource: async () => null,
    writeMemory: async () => {
      throw new Error("stale correction must not be queued");
    },
  });
  assert.equal(staleCorrection.recorded, false);
  assert.equal(staleCorrection.status, "conflict");
  assert.match(staleCorrection.uncertainty.join(" "), /changed since the correction was prepared/);

  const missingSnapshotCorrection = buildMemoryCorrectionReview({
    ...correctionInput,
    currentMemoryContent: null,
  });
  assert.equal(missingSnapshotCorrection.status, "invalid");
  assert.match(
    missingSnapshotCorrection.uncertainty.join(" "),
    /without the reviewed current memory content/,
  );

  const invalidCorrection = buildMemoryCorrectionReview({
    userId: "",
    operation: "correct_existing_memory",
    proposedContent: "   ",
    source: {
      kind: "runtime_memory_calibration",
      eventId: "runtime-memory-event-invalid",
      eventSource: "app",
    },
  });

  assert.equal(invalidCorrection.recorded, false);
  assert.equal(invalidCorrection.reviewOnly, true);
  assert.equal(invalidCorrection.status, "invalid");
  assert.equal(invalidCorrection.correctionMemoryId, null);
  assert.match(invalidCorrection.uncertainty.join(" "), /No user id/);
  assert.match(invalidCorrection.uncertainty.join(" "), /No proposed memory correction content/);
  assert.match(invalidCorrection.uncertainty.join(" "), /without an existing memory id/);

  console.log("OK: Memory OS facade normalizes memories, provenance, and fallback uncertainty");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
