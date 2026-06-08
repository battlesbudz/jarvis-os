import assert from "node:assert/strict";
import {
  adaptRuntimeContextPacketFromEvent,
  contextPacketFromContextPackDecision,
} from "../index";
import { decideContextPacks } from "../../../agent/contextPacks";

async function main(): Promise<void> {
  const event = {
    eventId: "event-context-memory",
    source: "app",
    userId: "user-context",
    message: "What memory do you have about morning planning?",
    channel: "appchat",
    createdAt: "2026-06-08T13:00:00.000Z",
  };

  {
    const result = adaptRuntimeContextPacketFromEvent({ event });
    assert.equal(result.event.userId, "user-context");
    assert.equal(result.decision.taskType, "memory_query");
    assert.equal(result.contextPacket.packetId, "packet-event-context-memory");
    assert.equal(result.contextPacket.userId, "user-context");
    assert.ok(result.contextPacket.sources.some((source) => source.kind === "memory"));
    assert.deepEqual(result.contextPacket.provenance, ["server/agent/contextPacks.ts"]);
    console.log("OK: context-pack adapter builds protocol ContextPacket for runtime events");
  }

  {
    const decision = decideContextPacks({
      userMessage: "Research CRM options and make a report",
      channel: "appchat",
    });
    const packet = contextPacketFromContextPackDecision({
      event: adaptRuntimeContextPacketFromEvent({ event }).event,
      decision,
      createdAt: "2026-06-08T13:01:00.000Z",
    });
    assert.ok(packet.sources.some((source) => source.kind === "tool"));
    assert.ok(packet.omissions.some((item) => /does not retrieve live context/i.test(item)));
    console.log("OK: context-pack adapter preserves preview-only omissions");
  }

  {
    assert.throws(
      () => adaptRuntimeContextPacketFromEvent({ event: { ...event, createdAt: "not-a-date" } }),
      /Invalid/,
    );
    console.log("OK: context-pack adapter validates JarvisEvent input");
  }

  console.log("\nAll runtime context packet adapter assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
