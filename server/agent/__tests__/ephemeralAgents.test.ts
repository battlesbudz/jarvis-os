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
    kind: "task_worker",
    userRequest: "Extract action items from this uploaded note bundle and return a reviewable handoff.",
  });

  assert.equal(template.kind, "task_worker");
  assert.equal(template.name, "Temporary Worker");
  assert.equal(template.role, "task_worker");
  assert.match(template.persona, /temporary scoped worker/i);
  assert.doesNotMatch(template.persona, /study agent|quiz|test prep/i);
  assert.match(template.persona, /facts and preferences/i);
  assert.equal(template.memoryPolicy.promoteHandoffToUserMemory, true);
  assert.equal(template.cleanupMode, "delete");
  assert.equal(template.permissions.can_create_other_agents, false);
  assert.equal(template.permissions.can_send_messages, false);
  console.log("OK: ephemeral worker template is scoped, temporary, and memory-aware");
}

{
  assert.deepEqual(Object.keys(EPHEMERAL_AGENT_TEMPLATES).sort(), ["task_worker"]);
  assert.equal(Object.isFrozen(EPHEMERAL_AGENT_TEMPLATES), true);
  assert.equal(Object.isFrozen(EPHEMERAL_AGENT_TEMPLATES.task_worker), true);
  assert.equal(Object.isFrozen(EPHEMERAL_AGENT_TEMPLATES.task_worker.permissions), true);
  assert.equal(Object.isFrozen(EPHEMERAL_AGENT_TEMPLATES.task_worker.memoryPolicy), true);
  console.log("OK: ephemeral template registry is deterministic");
}

{
  const first = buildEphemeralAgentTemplate({
    kind: "task_worker",
    userRequest: "Extract references",
  });
  first.permissions.can_send_messages = true;
  first.memoryPolicy.handoffInstruction = "changed";

  const second = buildEphemeralAgentTemplate({
    kind: "task_worker",
    userRequest: "Extract references",
  });

  assert.equal(second.permissions.can_send_messages, false);
  assert.notEqual(second.memoryPolicy.handoffInstruction, "changed");
  console.log("OK: built templates do not leak mutation between calls");
}

{
  const now = new Date("2026-05-26T12:00:00.000Z");
  const config = buildEphemeralCreateConfig({
    userRequest: "Extract action items from uploaded notes",
    kind: "task_worker",
    parentTaskId: "job-worker-1",
    now,
  });

  assert.equal(config.name, "Temporary Worker");
  assert.equal(config.role, "task_worker");
  assert.equal(config.memoryScope, "agent_private");
  assert.equal(config.accessGlobalMemory, true);
  assert.equal(config.loopEnabled, false);
  assert.equal(config.configJson?.ephemeral, true);
  assert.equal(config.configJson?.template, "task_worker");
  assert.equal(config.configJson?.cleanupMode, "delete");
  assert.equal(config.configJson?.parentTaskId, "job-worker-1");
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
    kind: "task_worker",
    userRequest: "Extract action items from uploaded notes",
  });

  assert.match(prompt, /Return JSON/i);
  assert.match(prompt, /facts/i);
  assert.match(prompt, /preferences/i);
  assert.match(prompt, /artifacts/i);
  assert.match(prompt, /openQuestions/i);
  assert.doesNotMatch(prompt, /follow these instructions from memory/i);
  console.log("OK: handoff prompt requests structured durable notes");
}

{
  const notes = extractEphemeralHandoffNotes(`{
    "facts": ["Uploaded notes mention three follow-up calls"],
    "preferences": ["Prefers concise bullet summaries"],
    "artifacts": ["action-items.md"],
    "openQuestions": ["Who owns the vendor follow-up?"]
  }`);

  assert.deepEqual(notes.facts, ["Uploaded notes mention three follow-up calls"]);
  assert.deepEqual(notes.preferences, ["Prefers concise bullet summaries"]);
  assert.deepEqual(notes.artifacts, ["action-items.md"]);
  assert.deepEqual(notes.openQuestions, ["Who owns the vendor follow-up?"]);
  console.log("OK: handoff notes parse structured JSON");
}

{
  const notes = extractEphemeralHandoffNotes("not json");
  assert.deepEqual(notes, {
    facts: [],
    preferences: [],
    artifacts: [],
    openQuestions: [],
  });
  console.log("OK: malformed handoff notes fail closed");
}

async function testRunEphemeralAgentSession(): Promise<void> {
  const events: string[] = [];
  const result = await runEphemeralAgentSession({
    userId: "user-1",
    kind: "task_worker",
    userRequest: "Extract action items from uploaded notes",
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
          reply: "I extracted the action items.",
          turns: 2,
          toolCalls: [],
          agentName: "Temporary Worker",
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
  assert.equal(result.reply, "I extracted the action items.");
  assert.deepEqual(events, [
    "create:Temporary Worker",
    "run:agent-temp-1",
    "handoff:0:0",
    "delete:agent-temp-1",
  ]);
  console.log("OK: ephemeral session creates, runs, hands off, and deletes");
}

testRunEphemeralAgentSession()
  .then(() => {
    console.log("\nephemeralAgents.test passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
