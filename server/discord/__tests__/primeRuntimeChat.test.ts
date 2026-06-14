import assert from "node:assert/strict";
import { tryHandleDiscordChatWithPrime } from "../primeRuntimeChat";
import type { PrimeRuntimeInput, PrimeRuntimeResult } from "../../agent/autonomyRuntime";

function primeResult(patch: Partial<PrimeRuntimeResult> = {}): PrimeRuntimeResult {
  return {
    handled: patch.handled ?? true,
    kind: patch.kind ?? "direct_response",
    reply: patch.reply,
    decision: patch.decision ?? {
      taskTypeDetected: "general",
      routeChosen: "test_prime_route",
      riskLevel: "low",
      approvalRequired: false,
      modelRouting: "existing_jarvis",
      bypassesPrime: false,
      reason: "test",
    },
  };
}

async function main(): Promise<void> {
  {
    const seen: PrimeRuntimeInput[] = [];
    const reply = await tryHandleDiscordChatWithPrime(
      {
        userId: "user-discord-prime",
        message: "Remind me to call Bill tomorrow.",
        originChannelId: "discord-channel-123",
        guildId: "discord-guild-456",
      },
      async (input) => {
        seen.push(input);
        return primeResult({ reply: "Reminder saved by PRIME." });
      },
    );

    assert.equal(reply, "Reminder saved by PRIME.");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].userId, "user-discord-prime");
    assert.equal(seen[0].channel, "discord");
    assert.equal(seen[0].message, "Remind me to call Bill tomorrow.");
    assert.equal(seen[0].metadata?.originChannelId, "discord-channel-123");
    assert.equal(seen[0].metadata?.discordGuildId, "discord-guild-456");
    console.log("OK: Discord chat adapter sends /jarvis chat input through PRIME runtime");
  }

  {
    const reply = await tryHandleDiscordChatWithPrime(
      {
        userId: "user-discord-legacy",
        message: "What should I focus on today?",
      },
      async () => primeResult({
        handled: false,
        kind: "not_handled",
        reply: undefined,
        decision: {
          taskTypeDetected: "unknown",
          routeChosen: "legacy_fallback",
          riskLevel: "low",
          approvalRequired: false,
          modelRouting: "existing_jarvis",
          bypassesPrime: false,
          reason: "No PRIME route matched.",
        },
      }),
    );

    assert.equal(reply, null);
    console.log("OK: Discord chat adapter lets legacy coach path continue when PRIME declines");
  }

  {
    const reply = await tryHandleDiscordChatWithPrime(
      {
        userId: "user-discord-no-reply",
        message: "Queue a task.",
      },
      async () => primeResult({ reply: undefined }),
    );

    assert.match(reply ?? "", /PRIME handled/);
    console.log("OK: Discord chat adapter returns a safe fallback string for handled no-reply results");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
