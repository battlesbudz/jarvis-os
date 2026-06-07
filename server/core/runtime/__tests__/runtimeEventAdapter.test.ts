import assert from "node:assert/strict";
import { jarvisEventFromMessage, runRuntimeDryRun } from "../index";

{
  const event = jarvisEventFromMessage({
    eventId: "event-adapter",
    source: "app",
    userId: "user-1",
    message: "What can you do?",
    channel: "app-chat",
    createdAt: "2026-06-08T13:00:00.000Z",
    metadata: {
      route: "/api/chat",
    },
  });

  assert.equal(event.eventId, "event-adapter");
  assert.equal(event.message, "What can you do?");
  assert.equal(event.channel, "app-chat");
  assert.equal(event.metadata.route, "/api/chat");

  const dryRun = runRuntimeDryRun({ event, now: new Date("2026-06-08T13:00:00.000Z") });
  assert.equal(dryRun.report.status, "ready");
  console.log("OK: Runtime event adapter creates dry-run-ready JarvisEvent objects");
}

{
  assert.throws(
    () => jarvisEventFromMessage({
      eventId: "event-invalid-user",
      source: "app",
      userId: "",
      createdAt: "2026-06-08T13:00:00.000Z",
    }),
    /Too small/,
  );
  console.log("OK: Runtime event adapter validates event fields");
}

console.log("\nAll Runtime Event Adapter assertions passed.");
