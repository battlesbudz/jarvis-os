import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

async function main() {
  const { buildQueueBackgroundJobInput } = await import("../tools/queueBackgroundJobInput");

  {
    const input = buildQueueBackgroundJobInput("ephemeral_agent_task", {
      channel: "telegram",
      discordChannelId: "discord-channel-1",
    });

    assert.equal(input.workerType, "goal_task");
    assert.equal(input.originChannel, "telegram");
    assert.equal(input.originDiscordChannelId, "discord-channel-1");
    assert.deepEqual(input.ephemeralAgent, {
      kind: "study",
      template: "study",
      cleanupMode: "disable",
    });
    assert.equal(input.model, undefined);
    console.log("OK: ephemeral study agent jobs carry worker and lifecycle metadata");
  }

  {
    const input = buildQueueBackgroundJobInput("research", {
      channel: "app",
      discordChannelId: undefined,
    });

    assert.equal(input.model, "gpt-4.1-mini");
    assert.equal(input.originChannel, "app");
    assert.equal(input.originDiscordChannelId, undefined);
    assert.equal(input.workerType, undefined);
    assert.equal(input.ephemeralAgent, undefined);
    console.log("OK: normal queued jobs keep model routing without ephemeral metadata");
  }

  console.log("\nAll queue background job assertions passed.");
}

void main();
