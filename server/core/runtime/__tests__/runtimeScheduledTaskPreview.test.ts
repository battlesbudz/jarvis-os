import assert from "node:assert/strict";
import {
  buildRuntimeScheduledTaskPreview,
  persistRuntimeScheduledTaskPreview,
  type RuntimeScheduledTaskPreview,
} from "../index";

const now = new Date("2026-06-08T23:00:00.000Z").toISOString();

async function run(): Promise<void> {
  {
    const preview = buildRuntimeScheduledTaskPreview({
      event: {
        eventId: "event-scheduled-task-user",
        source: "app",
        userId: "user-scheduled-task",
        message: "Remind me to call Bill tomorrow at 9am.",
        createdAt: now,
      },
      title: "Call Bill",
      scheduledAt: "2026-06-09T13:00:00.000Z",
      sourceTool: "schedule_jarvis_task",
      metadata: { sessionToken: "secret-session" },
    });

    assert.equal(preview.status, "ready_for_existing_owner");
    assert.equal(preview.owner, "existing_scheduler");
    assert.equal(preview.taskKind, "user_task");
    assert.equal(preview.executableByJarvis, false);
    assert.equal(preview.runtimeEnqueueAllowed, false);
    assert.equal(preview.approvalRequired, false);
    assert.equal(preview.scheduledAt.parseStatus, "iso_datetime");
    assert.equal(preview.dedupeScope.includeScheduledAt, true);
    assert.equal(preview.metadata.sessionToken, "[redacted]");
    assert.match(preview.policyReasons.join(" "), /non-executable/);
    console.log("OK: Runtime scheduled task preview keeps personal reminders with existing scheduler ownership");
  }

  {
    const preview = buildRuntimeScheduledTaskPreview({
      event: {
        eventId: "event-scheduled-task-cron",
        source: "app",
        userId: "user-scheduled-task",
        message: "Run my build script every morning.",
        createdAt: now,
      },
      title: "Morning build",
      description: "Run the local build and report the result.",
      scheduledAt: "daily",
      recurrence: "daily",
      taskKind: "jarvis_action",
      shellCommand: "npm run build -- --token secret-token",
      sourceTool: "cron_create",
    });

    const serialized = JSON.stringify(preview);
    assert.equal(preview.status, "ready_for_existing_owner");
    assert.equal(preview.taskKind, "jarvis_action");
    assert.equal(preview.executableByJarvis, true);
    assert.equal(preview.approvalRequired, true);
    assert.equal(preview.shellCommand.present, true);
    assert.match(String(preview.shellCommand.fingerprint), /^[a-f0-9]{64}$/);
    assert.equal(preview.scheduledAt.parseStatus, "natural_or_recurring");
    assert.equal(preview.dedupeScope.includeScheduledAt, false);
    assert.doesNotMatch(serialized, /npm run build|secret-token/);
    assert.match(preview.policyReasons.join(" "), /existing scheduler/);
    console.log("OK: Runtime scheduled task preview fingerprints executable shell jobs without enqueueing them");
  }

  {
    const preview = buildRuntimeScheduledTaskPreview({
      event: {
        eventId: "event-scheduled-task-blocked",
        source: "app",
        userId: "user-scheduled-task",
        message: "Remind me to run a shell command.",
        createdAt: now,
      },
      title: "Run command myself",
      scheduledAt: "2026-06-09T13:00:00.000Z",
      taskKind: "user_task",
      shellCommand: "rm -rf secret-path",
      sourceTool: "schedule_jarvis_task",
    });

    assert.equal(preview.status, "blocked");
    assert.equal(preview.executableByJarvis, false);
    assert.equal(preview.approvalRequired, true);
    assert.match(preview.errors.join(" "), /User tasks cannot carry shell commands/);
    assert.doesNotMatch(JSON.stringify(preview), /rm -rf|secret-path/);
    console.log("OK: Runtime scheduled task preview blocks shell commands on non-executable user tasks");
  }

  {
    const preview = buildRuntimeScheduledTaskPreview({
      event: {
        eventId: "event-scheduled-task-invalid",
        source: "app",
        userId: "user-scheduled-task",
        message: "Schedule this.",
        createdAt: now,
      },
      title: " ",
      scheduledAt: "",
    });

    assert.equal(preview.status, "invalid");
    assert.deepEqual(preview.errors, ["Scheduled task title is required.", "Scheduled task time is required."]);
    console.log("OK: Runtime scheduled task preview fails closed on missing title or time");
  }

  {
    const preview = buildRuntimeScheduledTaskPreview({
      event: {
        eventId: "event-scheduled-task-persist",
        source: "app",
        userId: "user-scheduled-task",
        message: "Remind me tomorrow.",
        createdAt: now,
      },
      title: "Follow up",
      scheduledAt: "2026-06-09T13:00:00.000Z",
    });
    const disabled = await persistRuntimeScheduledTaskPreview(preview);
    const written: RuntimeScheduledTaskPreview[] = [];
    const persisted = await persistRuntimeScheduledTaskPreview(preview, {
      writePreview: async (item) => {
        written.push(item);
      },
    });

    assert.equal(disabled.persisted, false);
    assert.match(disabled.reason, /No runtime scheduled task writer/);
    assert.equal(persisted.persisted, true);
    assert.equal(written[0]?.previewId, preview.previewId);
    console.log("OK: Runtime scheduled task preview persistence hook is explicit and storage-neutral");
  }

  console.log("\nAll Runtime Scheduled Task Preview assertions passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
