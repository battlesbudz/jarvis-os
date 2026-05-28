import assert from "node:assert/strict";
import {
  CONNECTION_APPS,
  getConnectionStatusLabel,
  normalizeConnectionsStatus,
  normalizeConnectionTestResult,
} from "../connectionUx";

assert.deepEqual(
  CONNECTION_APPS.map((app) => app.id),
  ["gmail", "google-calendar", "outlook-mail", "outlook-calendar", "slack", "google-drive", "google-tasks"],
);
console.log("OK: Composio app tiles include the expected no-code connection surfaces");

const status = normalizeConnectionsStatus({
  connections: [
    { platform: "gmail", state: "operational", accountEmail: "justin@example.com" },
    { app: "outlookMail", status: "needs_reauth", accountName: "Justin Outlook" },
    { appId: "google_tasks", connected: true, name: "Tasks" },
  ],
  nextSteps: ["Reconnect Outlook Mail"],
});

assert.equal(status.apps.gmail.connected, true);
assert.equal(status.apps.gmail.accountLabel, "justin@example.com");
assert.equal(status.apps["outlook-mail"].connected, false);
assert.equal(getConnectionStatusLabel(status.apps["outlook-mail"]), "Reconnect");
assert.equal(status.apps["google-tasks"].connected, true);
assert.equal(status.apps.slack.connected, false);
assert.deepEqual(status.nextSteps, ["Reconnect Outlook Mail"]);
console.log("OK: status normalization tolerates platform/app/appId shapes and fills missing tiles");

const nestedStatus = normalizeConnectionsStatus({
  apps: {
    googleCalendar: { connected: true, email: "calendar@example.com" },
    googleDrive: { state: "ready" },
  },
});

assert.equal(nestedStatus.apps["google-calendar"].connected, true);
assert.equal(nestedStatus.apps["google-calendar"].accountLabel, "calendar@example.com");
assert.equal(nestedStatus.apps["google-drive"].connected, true);
console.log("OK: status normalization tolerates keyed app response shapes");

assert.equal(normalizeConnectionTestResult({ ok: true, summary: "Gmail test passed." }).summary, "Gmail test passed.");
assert.equal(normalizeConnectionTestResult({ error: "Token expired" }).summary, "Token expired");
assert.equal(normalizeConnectionTestResult(null).summary, "Connection test finished.");
console.log("OK: test result normalization keeps endpoint response shapes forgiving");
