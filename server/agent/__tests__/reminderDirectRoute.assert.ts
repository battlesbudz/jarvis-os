import assert from "node:assert/strict";
import { parseDirectReminderIntent } from "../reminderDirectRoute";

const inSeven = parseDirectReminderIntent("Please remind me in 7 minutes to call H&R Block about my state taxes. This is an E2E test, so actually schedule the reminder.");
assert.match(inSeven?.scheduledAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
assert.equal(inSeven?.title, "Call H&R Block about my state taxes");
assert.equal(inSeven?.temporal.kind, "relative_point");

const trailingTime = parseDirectReminderIntent("Remind me to follow up with Bill tomorrow at 9am");
assert.match(trailingTime?.scheduledAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
assert.equal(trailingTime?.title, "Follow up with Bill");
assert.equal(trailingTime?.temporal.kind, "future_point");

const later = parseDirectReminderIntent("Remind me later to call the company");
assert.match(later?.scheduledAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
assert.equal(later?.title, "Call the company");
assert.equal(later?.temporal.ambiguous, true);

const noTime = parseDirectReminderIntent("Remind me to call the company");
assert.equal(noTime, null);

const notReminder = parseDirectReminderIntent("Can you draft an email tomorrow?");
assert.equal(notReminder, null);

const dailyTask = parseDirectReminderIntent('Can you add "Make $140 on DoorDash" as a recurring task every day?');
assert.equal(dailyTask?.title, "Make $140 on DoorDash");
assert.equal(dailyTask?.scheduledAt, "daily");

console.log("OK: direct reminder route parses clear natural-language reminders and rejects ambiguous prompts");
