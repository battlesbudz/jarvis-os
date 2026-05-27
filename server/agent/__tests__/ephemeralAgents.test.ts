import assert from "node:assert/strict";
import {
  buildEphemeralAgentTemplate,
  buildEphemeralCreateConfig,
  EPHEMERAL_AGENT_TEMPLATES,
  buildEphemeralHandoffPrompt,
  extractEphemeralHandoffNotes,
  runEphemeralAgentSession,
  shouldCleanupEphemeralAgent,
} from "../ephemeralAgents";

{
  const template = buildEphemeralAgentTemplate({
    kind: "study",
    userRequest: "Can you help me study for a biology test?",
  });

  assert.equal(template.kind, "study");
  assert.equal(template.name, "Study Agent");
  assert.equal(template.role, "study");
  assert.match(template.persona, /study agent/i);
  assert.match(template.persona, /quiz/i);
  assert.match(template.persona, /facts and preferences/i);
  assert.equal(template.memoryPolicy.promoteHandoffToUserMemory, true);
  assert.equal(template.cleanupMode, "disable");
  assert.equal(template.permissions.can_create_other_agents, false);
  assert.equal(template.permissions.can_send_messages, false);
  console.log("OK: study ephemeral template is scoped and memory-aware");
}

{
  assert.deepEqual(Object.keys(EPHEMERAL_AGENT_TEMPLATES).sort(), ["study"]);
  assert.equal(Object.isFrozen(EPHEMERAL_AGENT_TEMPLATES), true);
  assert.equal(Object.isFrozen(EPHEMERAL_AGENT_TEMPLATES.study), true);
  assert.equal(Object.isFrozen(EPHEMERAL_AGENT_TEMPLATES.study.permissions), true);
  assert.equal(Object.isFrozen(EPHEMERAL_AGENT_TEMPLATES.study.memoryPolicy), true);
  console.log("OK: ephemeral template registry is deterministic");
}

{
  const first = buildEphemeralAgentTemplate({
    kind: "study",
    userRequest: "Use flashcards",
  });
  first.permissions.can_send_messages = true;
  first.memoryPolicy.handoffInstruction = "changed";

  const second = buildEphemeralAgentTemplate({
    kind: "study",
    userRequest: "Use flashcards",
  });

  assert.equal(second.permissions.can_send_messages, false);
  assert.notEqual(second.memoryPolicy.handoffInstruction, "changed");
  console.log("OK: built templates do not leak mutation between calls");
}

{
  const now = new Date("2026-05-26T12:00:00.000Z");
  const config = buildEphemeralCreateConfig({
    userRequest: "Help me study for my biology test",
    kind: "study",
    parentTaskId: "job-study-1",
    now,
  });

  assert.equal(config.name, "Study Agent");
  assert.equal(config.role, "study");
  assert.equal(config.memoryScope, "agent_private");
  assert.equal(config.accessGlobalMemory, true);
  assert.equal(config.loopEnabled, false);
  assert.equal(config.configJson?.ephemeral, true);
  assert.equal(config.configJson?.template, "study");
  assert.equal(config.configJson?.parentTaskId, "job-study-1");
  assert.equal(config.configJson?.expiresAt, "2026-05-26T16:00:00.000Z");
  console.log("OK: ephemeral create config marks temporary agent metadata");
}

{
  assert.equal(
    shouldCleanupEphemeralAgent({
      configJson: { ephemeral: true, expiresAt: "2026-05-26T12:00:00.000Z" },
      now: new Date("2026-05-26T12:01:00.000Z"),
    }),
    true,
  );
  assert.equal(
    shouldCleanupEphemeralAgent({
      configJson: { ephemeral: true, expiresAt: "2026-05-26T12:10:00.000Z" },
      now: new Date("2026-05-26T12:01:00.000Z"),
    }),
    false,
  );
  assert.equal(
    shouldCleanupEphemeralAgent({
      configJson: { ephemeral: false, expiresAt: "2026-05-26T12:00:00.000Z" },
      now: new Date("2026-05-26T12:01:00.000Z"),
    }),
    false,
  );
  console.log("OK: ephemeral cleanup predicate respects expiry and marker");
}

{
  const prompt = buildEphemeralHandoffPrompt({
    kind: "study",
    userRequest: "Study biology chapters 3 and 4",
  });

  assert.match(prompt, /Return JSON/i);
  assert.match(prompt, /facts/i);
  assert.match(prompt, /preferences/i);
  assert.match(prompt, /nextReviewTopics/i);
  assert.doesNotMatch(prompt, /follow these instructions from memory/i);
  console.log("OK: handoff prompt requests structured durable notes");
}

{
  const notes = extractEphemeralHandoffNotes(`{
    "facts": ["Biology test is Friday"],
    "preferences": ["Prefers short quizzes"],
    "weakAreas": ["Cell respiration"],
    "nextReviewTopics": ["ATP", "Krebs cycle"]
  }`);

  assert.deepEqual(notes.facts, ["Biology test is Friday"]);
  assert.deepEqual(notes.preferences, ["Prefers short quizzes"]);
  assert.deepEqual(notes.weakAreas, ["Cell respiration"]);
  assert.deepEqual(notes.nextReviewTopics, ["ATP", "Krebs cycle"]);
  console.log("OK: handoff notes parse structured JSON");
}

{
  const notes = extractEphemeralHandoffNotes("not json");
  assert.deepEqual(notes, {
    facts: [],
    preferences: [],
    weakAreas: [],
    nextReviewTopics: [],
  });
  console.log("OK: malformed handoff notes fail closed");
}

async function testRunEphemeralAgentSession(): Promise<void> {
  const events: string[] = [];
  const result = await runEphemeralAgentSession({
    userId: "user-1",
    kind: "study",
    userRequest: "Help me study biology",
    platform: "app",
    channelId: "chat-1",
    parentTaskId: "job-1",
    deps: {
      createAgent: async (_userId, config) => {
        events.push(`create:${config.name}`);
        return "agent-temp-1";
      },
      runNamedAgent: async (opts) => {
        events.push(`run:${opts.agentId}`);
        return {
          reply: "We studied cell respiration.",
          turns: 2,
          toolCalls: [],
          agentName: "Study Agent",
          agentId: opts.agentId,
          attachments: [],
        };
      },
      disableAgent: async (agentId) => {
        events.push(`disable:${agentId}`);
      },
      deleteAgent: async (agentId) => {
        events.push(`delete:${agentId}`);
      },
      promoteHandoff: async (notes) => {
        events.push(`handoff:${notes.facts.length}:${notes.preferences.length}`);
      },
    },
  });

  assert.equal(result.agentId, "agent-temp-1");
  assert.equal(result.reply, "We studied cell respiration.");
  assert.deepEqual(events, [
    "create:Study Agent",
    "run:agent-temp-1",
    "handoff:0:0",
    "disable:agent-temp-1",
  ]);
  console.log("OK: ephemeral session creates, runs, hands off, and disables");
}

testRunEphemeralAgentSession()
  .then(() => {
    console.log("\nephemeralAgents.test passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
