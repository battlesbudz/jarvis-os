import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

async function main() {
  const { buildQueueBackgroundJobInput } = await import("../tools/queueBackgroundJobInput");
  const queueToolSource = readFileSync(
    fileURLToPath(new URL("../tools/queueBackgroundJob.ts", import.meta.url).toString()),
    "utf8",
  );

  {
    assert.match(queueToolSource, /one-off scoped worker/i);
    assert.match(queueToolSource, /Do not use it for normal tutoring/i);
    assert.doesNotMatch(queueToolSource, /temporary Study Agent|study help|quiz-style/i);
    console.log("OK: queue tool describes ephemeral jobs as one-off workers, not study sessions");
  }

  {
    const input = buildQueueBackgroundJobInput("ephemeral_agent_task", {
      channel: "telegram",
      originChannelId: "telegram-chat-1",
      discordChannelId: "discord-channel-1",
    });

    assert.equal(input.workerType, "goal_task");
    assert.equal(input.originChannel, "telegram");
    assert.equal(input.originChannelId, "telegram-chat-1");
    assert.equal(input.originDiscordChannelId, "discord-channel-1");
    assert.deepEqual(input.ephemeralAgent, {
      kind: "task_worker",
      template: "task_worker",
      cleanupMode: "delete",
    });
    assert.equal(input.model, undefined);
    console.log("OK: ephemeral one-off worker jobs carry worker and lifecycle metadata");
  }

  {
    const input = buildQueueBackgroundJobInput("research", {
      channel: "app",
      originChannelId: undefined,
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
