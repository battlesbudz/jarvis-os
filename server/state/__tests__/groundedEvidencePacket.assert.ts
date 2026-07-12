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
    id: "discord-1",
    content: "TRIAGE RECORD: Five Jarvis Agent Health Summary alerts report DISCORD_BOT_TOKEN is not configured.",
    dueDate: "2026-05-22",
    status: "pending",
    extractedAt: new Date("2026-05-22T12:00:00.000Z"),
  },
  {
    id: "discord-2",
    content: "Consolidated triage: duplicate Agent Health Summary alerts for the same DISCORD_BOT_TOKEN issue.",
    dueDate: "2026-05-23",
    status: "pending",
    extractedAt: new Date("2026-05-23T12:00:00.000Z"),
  },
  {
    id: "spam-risk",
    content: "Acknowledge notification: Missed call from Spam Risk.",
    dueDate: null,
    status: "pending",
    extractedAt: new Date("2026-07-09T11:00:00.000Z"),
  },
  {
    id: "real-work",
    content: "Review Jarvis voice grounding PR after Codex returns a clean review.",
    dueDate: "2026-07-09",
    status: "pending",
    extractedAt: new Date("2026-07-09T10:00:00.000Z"),
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
  assert.equal(packet.evidence.some((item) => /DISCORD_BOT_TOKEN|Spam Risk/i.test(item.content)), false);
  assert.ok(packet.omitted.some((entry) => /duplicate/i.test(entry)));
  assert.ok(packet.omitted.some((entry) => /low-signal/i.test(entry)));

  const rendered = renderGroundedEvidencePacket(packet, { maxChars: 5_000 });
  assert.match(rendered, /Jarvis Grounded Evidence Packet/);
  assert.match(rendered, /Use only EVIDENCE/);
  assert.match(rendered, /id=profile:core/);
  assert.match(rendered, /Review Jarvis voice grounding PR/);
  assert.doesNotMatch(rendered, /Missed call from Spam Risk/);
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

function testCompactRendererRetainsIncompleteContextLimits(): void {
  const packet: GroundedEvidencePacket = {
    userId,
    requestText: "What do you know about me?",
    generatedAt: fixedNow.toISOString(),
    modelTarget: "local",
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
  testCompactRendererRetainsIncompleteContextLimits();
}

main().catch((error) => {
  _setGroundedEvidencePacketDepsForTesting(null);
  console.error(error);
  process.exit(1);
});
