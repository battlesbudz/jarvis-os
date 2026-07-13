import assert from "node:assert/strict";

import type { MemoryContext } from "../../memory/memoryOs";
import {
  _setGroundedEvidencePacketDepsForTesting,
  buildGroundedEvidencePacket,
  buildGroundedEvidencePacketPrompt,
  renderGroundedEvidencePacket,
  type GroundedCommitmentRecord,
  type GroundedEvidencePacket,
} from "../groundedEvidencePacket";

process.env.JARVIS_TRACE_HMAC_KEY ??= "grounded-evidence-test-trace-key";

const userId = "grounded-evidence-user";
const fixedNow = new Date("2026-07-09T12:00:00.000Z");

function memoryContext(query: string): MemoryContext {
  return {
    userId,
    query,
    caller: "runtime_memory_inspection",
    items: [{
      memory: {
        id: "memory-direct-style",
        content: "User prefers direct, pragmatic answers with clear next actions.",
        category: "communication_style",
        tier: "long_term",
        memoryType: "semantic",
        relevanceScore: 91,
        confidence: 95,
        accessCount: 4,
        score: 0.96,
      },
      provenance: [{ kind: "user_memory", id: "memory-direct-style", source: "canonical", label: "communication_style" }],
    }],
    sources: { memories: ["memory-direct-style"], brainChunks: [], hotState: [] },
    provenance: [{ kind: "user_memory", id: "memory-direct-style", source: "canonical" }],
    uncertainty: [],
  };
}

const noisyCommitments: GroundedCommitmentRecord[] = [
  {
    id: "incident-1",
    content: "Investigate a repeated service configuration health alert.",
    dueDate: "2026-05-22",
    status: "pending",
    extractedAt: new Date("2026-05-22T12:00:00.000Z"),
    commitmentKind: "operational_incident",
    signalLevel: "normal",
    dedupeKey: "topic:service_configuration_health",
    sourceType: "heartbeat_crew",
  },
  {
    id: "incident-2",
    content: "Verify the same service configuration warning and restart the worker.",
    dueDate: "2026-05-23",
    status: "pending",
    extractedAt: new Date("2026-05-23T12:00:00.000Z"),
    commitmentKind: "operational_incident",
    signalLevel: "normal",
    dedupeKey: "topic:service_configuration_health",
    sourceType: "heartbeat_crew",
  },
  {
    id: "notification-1",
    content: "Acknowledge an informational phone notification.",
    dueDate: null,
    status: "pending",
    extractedAt: new Date("2026-07-09T11:00:00.000Z"),
    commitmentKind: "notification",
    signalLevel: "low",
    dedupeKey: "topic:informational_phone_notification",
    sourceType: "android_notification",
  },
  {
    id: "real-work",
    content: "Review Jarvis voice grounding PR after Codex returns a clean review.",
    dueDate: "2026-07-09",
    status: "pending",
    extractedAt: new Date("2026-07-09T10:00:00.000Z"),
    commitmentKind: "user_task",
    signalLevel: "normal",
    dedupeKey: "topic:review_voice_grounding",
    sourceType: "agent",
  },
  {
    id: "real-work-duplicate",
    content: "Review the voice grounding change after the clean automated review.",
    dueDate: "2026-07-09",
    status: "pending",
    extractedAt: new Date("2026-07-09T09:00:00.000Z"),
    commitmentKind: "user_task",
    signalLevel: "normal",
    dedupeKey: "topic:review_voice_grounding",
    sourceType: "agent",
  },
];

async function testGroundedPacketBuildsEvidenceAndOmitsNoise(): Promise<void> {
  const packet = await buildGroundedEvidencePacket({
    userId,
    requestText: "What do you know about me?",
    activeDevice: "android",
    activeModel: "gemma-4-e4b-it",
    currentContext: "phone_gemma_chat",
    memoryLimit: 4,
    commitmentLimit: 3,
  }, {
    now: () => fixedNow,
    loadProfileState: async () => ({
      userId,
      preferredName: "Justin",
      timezone: "America/New_York",
      communicationStyle: "direct",
      source: "profile_store",
    }),
    loadSoul: async () => ({
      content: "Jarvis should help the user operate across devices.",
      manualOverride: "Keep responses concise.",
      generatedAt: fixedNow,
      updatedAt: fixedNow,
    }),
    retrieveMemoryContext: async (input) => {
      assert.equal(input.modelTarget, "local");
      assert.equal(input.canonicalOnly, true);
      return memoryContext(input.query);
    },
    loadCommitments: async () => noisyCommitments,
  });

  assert.equal(packet.modelTarget, "local");
  assert.ok(packet.evidence.some((item) => item.id === "profile:core"));
  assert.ok(packet.evidence.some((item) => item.id === "soul:summary"));
  assert.ok(packet.evidence.some((item) => item.id === "memory:memory-direct-style"));
  assert.ok(packet.evidence.some((item) => item.id === "commitment:real-work"));
  assert.equal(packet.evidence.some((item) => /service configuration|phone notification/i.test(item.content)), false);
  assert.ok(packet.omitted.some((entry) => /duplicate/i.test(entry)));
  assert.ok(packet.omitted.some((entry) => /non-personal or low-signal/i.test(entry)));
  assert.equal(packet.trace?.contentFree, true);
  assert.equal(packet.trace?.identifiersOmitted, false);
  assert.equal(packet.trace?.queryFingerprint?.length, 24);
  assert.equal(packet.trace?.queryLength, "user profile preferences relationships work patterns goals blockers values commitments".length);
  assert.deepEqual(
    packet.trace?.stages.map((stage) => `${stage.source}:${stage.status}`),
    ["runtime:loaded", "profile:loaded", "soul:loaded", "memory:loaded", "commitment:loaded"],
  );
  assert.equal(
    packet.trace?.stages.find((stage) => stage.source === "commitment")?.selectedIds.length,
    1,
  );
  assert.match(
    packet.trace?.stages.find((stage) => stage.source === "commitment")?.selectedIds[0] ?? "",
    /^evidence_[a-f0-9]{24}$/,
  );
  assert.equal(packet.trace?.stages.find((stage) => stage.source === "commitment")?.omittedCount, 4);
  assert.notEqual(
    packet.trace?.stages.find((stage) => stage.source === "memory")?.selectedIds[0],
    "memory-direct-style",
  );
  assert.equal(JSON.stringify(packet.trace).includes("Review Jarvis voice grounding PR"), false);

  const rendered = renderGroundedEvidencePacket(packet, { maxChars: 5_000 });
  assert.match(rendered, /Jarvis Grounded Evidence Packet/);
  assert.match(rendered, /Use only EVIDENCE/);
  assert.match(rendered, /id=profile:core/);
  assert.match(rendered, /Review Jarvis voice grounding PR/);
  assert.doesNotMatch(rendered, /informational phone notification/);
  console.log("OK: grounded evidence packet loads profile, memory, commitments, and omits noisy duplicates");
}

async function testGlobalTestDepsFeedPromptBuilder(): Promise<void> {
  _setGroundedEvidencePacketDepsForTesting({
    now: () => fixedNow,
    loadProfileState: async () => ({
      userId,
      preferredName: "Justin",
      source: "profile_store",
    }),
    loadSoul: async () => ({ content: "", manualOverride: null, generatedAt: null, updatedAt: null }),
    retrieveMemoryContext: async (input) => memoryContext(input.query),
    loadCommitments: async () => [],
  });

  try {
    const prompt = await buildGroundedEvidencePacketPrompt({
      userId,
      requestText: "Just wondering how was your day can you tell me what you know about me",
      activeModel: "Phone Gemma",
      renderMaxChars: 2_000,
    });

    assert.match(prompt, /Preferred name: Justin/);
    assert.match(prompt, /direct, pragmatic answers/);
    assert.match(prompt, /Use only EVIDENCE/);
    assert.ok(prompt.length <= 2_000);
    console.log("OK: grounded evidence prompt builder supports runtime test deps");
  } finally {
    _setGroundedEvidencePacketDepsForTesting(null);
  }
}

async function testTemporalPlanUsesOnlyMemoryAndMergesQueries(): Promise<void> {
  const queries: string[] = [];
  const packet = await buildGroundedEvidencePacket({
    userId,
    requestText: "What was that Android speech decision from a while ago?",
    activeModel: "Phone Gemma",
    memoryLimit: 3,
    commitmentLimit: 3,
  }, {
    now: () => fixedNow,
    loadProfileState: async () => {
      throw new Error("profile should be skipped");
    },
    loadSoul: async () => {
      throw new Error("soul should be skipped");
    },
    loadCommitments: async () => {
      throw new Error("commitments should be skipped");
    },
    retrieveMemoryContext: async (input) => {
      queries.push(input.query);
      const ids = queries.length === 1
        ? ["memory-android-context", "memory-android-speech-decision"]
        : ["memory-android-speech-decision", "memory-android-current-policy"];
      return {
        userId,
        query: input.query,
        caller: "runtime_memory_inspection",
        items: ids.map((id, index) => ({
          memory: {
            id,
            content: `Grounded Android decision ${index + 1}`,
            category: "decision",
            tier: "long_term",
            memoryType: "semantic",
            relevanceScore: 90 - index,
            confidence: 90,
            accessCount: 0,
            score: 0.9 - index / 10,
          },
          provenance: [{ kind: "user_memory", id, source: "canonical" }],
        })),
        sources: { memories: ids, brainChunks: [], hotState: [] },
        provenance: ids.map((id) => ({ kind: "user_memory" as const, id, source: "canonical" as const })),
        uncertainty: [],
      };
    },
  });

  assert.equal(packet.queryPlan.intent, "temporal_recall");
  assert.equal(packet.queryPlan.queries.length, 2);
  assert.deepEqual(packet.contextContract.sources, {
    profile: false,
    soul: false,
    memory: true,
    commitments: false,
  });
  assert.equal(packet.contextContract.memoryAuthority, "canonical_only");
  assert.equal(packet.contextContract.claimPolicy, "evidence_only");
  assert.equal(queries.length, 2);
  assert.deepEqual(
    packet.evidence.filter((item) => item.domain === "memory").map((item) => item.sourceId),
    ["memory-android-context", "memory-android-speech-decision", "memory-android-current-policy"],
  );
  assert.deepEqual(
    packet.trace?.stages.map((stage) => `${stage.source}:${stage.status}`),
    ["runtime:loaded", "profile:skipped", "soul:skipped", "memory:loaded", "commitment:skipped"],
  );
  assert.equal(packet.trace?.queryPlan.intent, "temporal_recall");
  assert.deepEqual(packet.trace?.queryPlan.purposes, ["primary", "temporal"]);

  const rendered = renderGroundedEvidencePacket(packet, { maxChars: 5_000 });
  assert.match(rendered, /Context contract: intent=temporal_recall/);
  assert.match(rendered, /memory=canonical_only/);
  console.log("OK: temporal grounding plans only memory queries and merges bounded results");
}

async function testTopicCommitmentStatusFiltersUnrelatedOverdueWork(): Promise<void> {
  const commitments: GroundedCommitmentRecord[] = [
    {
      id: "unrelated-overdue",
      content: "Prepare the quarterly inventory controls report.",
      dueDate: "2026-06-01",
      status: "pending",
      extractedAt: "2026-06-01T12:00:00.000Z",
      commitmentKind: "user_task",
      signalLevel: "normal",
    },
    {
      id: "android-daemon",
      content: "Verify Android daemon voice routing on the physical phone.",
      dueDate: "2026-07-20",
      status: "pending",
      extractedAt: "2026-07-08T12:00:00.000Z",
      commitmentKind: "user_task",
      signalLevel: "normal",
      dedupeKey: "topic:android_daemon_voice",
    },
    {
      id: "unrelated-today",
      content: "Review the production compliance checklist.",
      dueDate: "2026-07-09",
      status: "pending",
      extractedAt: "2026-07-09T08:00:00.000Z",
      commitmentKind: "user_commitment",
      signalLevel: "normal",
    },
    {
      id: "tomorrow-task",
      content: "Call the packaging supplier.",
      dueDate: "2026-07-10",
      status: "pending",
      extractedAt: "2026-07-09T09:00:00.000Z",
      commitmentKind: "user_task",
      signalLevel: "normal",
    },
  ];
  const retrieveEmptyMemoryContext = async (input: { query: string }): Promise<MemoryContext> => ({
    userId,
    query: input.query,
    caller: "runtime_memory_inspection",
    items: [],
    sources: { memories: [], brainChunks: [], hotState: [] },
    provenance: [],
    uncertainty: [],
  });
  const packet = await buildGroundedEvidencePacket({
    userId,
    requestText: "Do I have any pending tasks for the Android daemon?",
    activeModel: "Phone Gemma",
    memoryLimit: 2,
    commitmentLimit: 1,
  }, {
    now: () => fixedNow,
    retrieveMemoryContext: retrieveEmptyMemoryContext,
    loadCommitments: async () => commitments,
  });

  assert.equal(packet.queryPlan.intent, "commitment_status");
  assert.deepEqual(
    packet.evidence.filter((item) => item.domain === "commitment").map((item) => item.sourceId),
    ["android-daemon"],
  );
  assert.equal(packet.evidence.some((item) => item.sourceId === "unrelated-overdue"), false);
  assert.match(packet.omitted.join(" "), /3 pending commitment record\(s\) that did not match the requested topic/);

  for (const requestText of ["List my tasks", "Show my commitments"]) {
    const genericPacket = await buildGroundedEvidencePacket({
      userId,
      requestText,
      activeModel: "Phone Gemma",
      memoryLimit: 2,
      commitmentLimit: 1,
    }, {
      now: () => fixedNow,
      retrieveMemoryContext: retrieveEmptyMemoryContext,
      loadCommitments: async () => commitments,
    });
    assert.equal(genericPacket.queryPlan.intent, "commitment_status");
    assert.deepEqual(
      genericPacket.evidence.filter((item) => item.domain === "commitment").map((item) => item.sourceId),
      ["unrelated-overdue"],
      `${requestText} should retain broad due-date ranking`,
    );
  }

  const tomorrowPacket = await buildGroundedEvidencePacket({
    userId,
    requestText: "Do I have any tasks due tomorrow?",
    activeModel: "Phone Gemma",
    memoryLimit: 2,
    commitmentLimit: 1,
  }, {
    now: () => fixedNow,
    retrieveMemoryContext: retrieveEmptyMemoryContext,
    loadCommitments: async () => commitments,
  });
  assert.deepEqual(
    tomorrowPacket.evidence.filter((item) => item.domain === "commitment").map((item) => item.sourceId),
    ["tomorrow-task"],
  );
  assert.equal(tomorrowPacket.evidence.some((item) => item.sourceId === "unrelated-overdue"), false);

  const overduePacket = await buildGroundedEvidencePacket({
    userId,
    requestText: "Do I have any overdue tasks?",
    activeModel: "Phone Gemma",
    memoryLimit: 2,
    commitmentLimit: 4,
  }, {
    now: () => fixedNow,
    retrieveMemoryContext: retrieveEmptyMemoryContext,
    loadCommitments: async () => commitments,
  });
  assert.deepEqual(
    overduePacket.evidence.filter((item) => item.domain === "commitment").map((item) => item.sourceId),
    ["unrelated-overdue"],
  );
  assert.equal(overduePacket.evidence.some((item) => item.sourceId === "tomorrow-task"), false);
  console.log("OK: topic commitment grounding filters unrelated overdue work");
}

function testCompactRendererRetainsIncompleteContextLimits(): void {
  const packet: GroundedEvidencePacket = {
    userId,
    requestText: "What do you know about me?",
    generatedAt: fixedNow.toISOString(),
    modelTarget: "local",
    queryPlan: {
      schemaVersion: 1,
      intent: "broad_personal_summary",
      queries: [{ id: "primary", purpose: "primary", query: "user profile" }],
      sources: { profile: true, soul: true, memory: true, commitments: true },
      canonicalOnly: true,
      maxQueries: 2,
    },
    contextContract: {
      schemaVersion: 1,
      intent: "broad_personal_summary",
      sources: { profile: true, soul: true, memory: true, commitments: true },
      memoryAuthority: "canonical_only",
      claimPolicy: "evidence_only",
      missingEvidencePolicy: "admit_not_loaded",
      maxMemoryItems: 2,
      maxCommitmentItems: 0,
    },
    evidence: [{
      id: "profile:core",
      domain: "profile",
      label: "Core profile",
      content: "Preferred name: Justin",
      source: "profile_store",
    }, {
      id: "memory:memory-direct-style",
      domain: "memory",
      label: "communication_style",
      content: "User prefers direct, pragmatic answers with clear next actions.",
      source: "MemoryOS",
      sourceId: "memory-direct-style",
    }],
    omitted: ["Omitted 4 lower-ranked pending commitment records beyond the packet limit."],
    uncertainty: ["MemoryOS retrieval was unavailable for one source."],
  };

  const rendered = renderGroundedEvidencePacket(packet, { compact: true, maxChars: 556 });

  assert.match(rendered, /id=profile:core/);
  assert.match(rendered, /id=memory:memory-direct-style/);
  assert.match(rendered, /omitted=/);
  assert.match(rendered, /Omitted 4 lower-ranked/);
  assert.match(rendered, /uncertainty=/);
  assert.match(rendered, /MemoryOS retrieval was unavailable/);
  assert.ok(rendered.length <= 556);
  console.log("OK: compact grounded evidence retains omitted and uncertainty limits");
}

async function main(): Promise<void> {
  await testGroundedPacketBuildsEvidenceAndOmitsNoise();
  await testGlobalTestDepsFeedPromptBuilder();
  await testTemporalPlanUsesOnlyMemoryAndMergesQueries();
  await testTopicCommitmentStatusFiltersUnrelatedOverdueWork();
  testCompactRendererRetainsIncompleteContextLimits();
}

main().catch((error) => {
  _setGroundedEvidencePacketDepsForTesting(null);
  console.error(error);
  process.exit(1);
});
