import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getLiveActionBaselineReport,
  getLiveActionAggregateReport,
  isClientSubmittedLiveActionBaselineMetric,
  observeTerminalStateDrift,
  recordLiveActionBaseline,
  recordRenderedRepresentationSnapshot,
  recordStatusCheckFollowUp,
  resetLiveActionBaselinesForTests,
} from "../baselineMetrics";
import { getLiveActionFeatureFlags } from "../rollout";

const disabled = getLiveActionFeatureFlags({});
assert.deepEqual(disabled, { projectCapsule: false, projector: false, ui: false, stream: false });

const names = ["JARVIS_PROJECT_CAPSULE", "JARVIS_LIVE_ACTIONS_PROJECTOR", "JARVIS_LIVE_ACTIONS_UI", "JARVIS_LIVE_ACTIONS_STREAM"];
for (const name of names) {
  const flags = getLiveActionFeatureFlags({ [name]: "1" });
  assert.equal(Object.values(flags).filter(Boolean).length, 1, `${name} must enable independently`);
}

assert.deepEqual(getLiveActionFeatureFlags({
  JARVIS_PROJECT_CAPSULE: "true",
  JARVIS_LIVE_ACTIONS_PROJECTOR: "TRUE",
  JARVIS_LIVE_ACTIONS_UI: "1",
  JARVIS_LIVE_ACTIONS_STREAM: "false",
}), { projectCapsule: true, projector: true, ui: true, stream: false });
assert.equal(isClientSubmittedLiveActionBaselineMetric("reconnect_restoration_ms"), true);
assert.equal(isClientSubmittedLiveActionBaselineMetric("acknowledgement_visible_latency_ms"), true);
assert.equal(isClientSubmittedLiveActionBaselineMetric("terminal_state_drift_count"), false);
assert.equal(isClientSubmittedLiveActionBaselineMetric("terminal_representation_count"), false);
assert.equal(isClientSubmittedLiveActionBaselineMetric("duplicate_representation_count"), false);

const tasksScreen = fs.readFileSync("components/missionControl/TasksScreen.tsx", "utf8");
assert.match(tasksScreen, /const isFocused = useIsFocused\(\)/);
assert.match(tasksScreen, /const renderedJobs = isFocused \?/);
assert.match(tasksScreen, /useEffect, useRef, useState/);
assert.match(tasksScreen, /clientId: representationClientId\.current/);
assert.match(tasksScreen, /sequence: \+\+representationSequence\.current/);
assert.match(tasksScreen, /useEffect\(\(\) => \(\) => \{[\s\S]*?surface: 'mission_control',[\s\S]*?representations: \[\]/);
const projectsScreen = fs.readFileSync("app/(tabs)/projects.tsx", "utf8");
assert.match(projectsScreen, /!isFocused \|\| selectedId \? \[\]/);
assert.match(projectsScreen, /useState, useCallback, useEffect, useRef/);
assert.match(projectsScreen, /clientId: representationClientId\.current/);
assert.match(projectsScreen, /sequence: \+\+representationSequence\.current/);
const inboxScreen = fs.readFileSync("app/(tabs)/inbox.tsx", "utf8");
assert.match(inboxScreen, /const renderedJobs = isFocused \?/);
assert.match(inboxScreen, /clientId: representationClientId\.current/);
assert.match(inboxScreen, /sequence: \+\+representationSequence\.current/);
const discordManager = fs.readFileSync("server/discord/manager.ts", "utf8");
assert.match(discordManager, /recordStatusCheckFollowUp\(\{[\s\S]*?observationId: message\.id/);
assert.doesNotMatch(discordManager, /observeStatusCheck/);
const coachAgent = fs.readFileSync("server/channels/coachAgent.ts", "utf8");
assert.match(coachAgent, /channelName\.startsWith\("Discord"\) \? "discord" : channelLower/);
assert.match(coachAgent, /if \(input\.observeStatusCheck\) \{\s+recordStatusCheckFollowUp/);
const scheduler = fs.readFileSync("server/scheduler.ts", "utf8");
assert.doesNotMatch(scheduler, /observeStatusCheck/);
const slackWebhook = fs.readFileSync("server/channels/slackWebhook.ts", "utf8");
assert.match(slackWebhook, /arg \? `What's the status of \$\{arg\}\?`/);
assert.match(slackWebhook, /statusObservationId: String\(body\.event_id/);
assert.match(slackWebhook, /const statusObservationId = String\(req\.body\.trigger_id/);
const whatsappWebhook = fs.readFileSync("server/channels/whatsappWebhook.ts", "utf8");
assert.match(whatsappWebhook, /statusObservationId = String\(req\.body\?\.MessageSid/);
const telegramRoutes = fs.readFileSync("server/telegramRoutes.ts", "utf8");
assert.match(telegramRoutes, /recordStatusCheckFollowUp\(\{[\s\S]*?observationId: statusObservationId/);
assert.match(telegramRoutes, /statusObservationId,\s+metadata: \{ originChannelId: chatId \}/);
assert.doesNotMatch(telegramRoutes, /observeStatusCheck/);
const discordSlashCommands = fs.readFileSync("server/discord/slashCommands.ts", "utf8");
assert.match(discordSlashCommands, /statusObservationId: String\(interaction\.id/);
const baselineMetrics = fs.readFileSync("server/liveActions/baselineMetrics.ts", "utf8");
assert.match(baselineMetrics, /for \(const \[key, mismatch\] of firstSeen\)[\s\S]*?nowMs - mismatch\.lastSeenAt > MAX_MISMATCH_HEARTBEAT_GAP_MS/);

resetLiveActionBaselinesForTests();
recordStatusCheckFollowUp({ userId: "surface-aliases", message: "Status update?", surface: "appchat" });
recordStatusCheckFollowUp({ userId: "surface-aliases", message: "Status update?", surface: "Gateway" });
assert.equal(getLiveActionBaselineReport("surface-aliases").metrics["status_check_follow_up:chat"].count, 1);
assert.equal(getLiveActionBaselineReport("surface-aliases").metrics["status_check_follow_up:gateway"].count, 1);
resetLiveActionBaselinesForTests();
assert.equal(recordStatusCheckFollowUp({ userId: "status-phrases", message: "What's the status?", surface: "slack" }), true);
assert.equal(recordStatusCheckFollowUp({ userId: "status-phrases", message: "Status update?", surface: "slack" }), true);
assert.equal(recordStatusCheckFollowUp({ userId: "status-phrases", message: "What's the status of my day?", surface: "slack" }), true);
assert.equal(getLiveActionBaselineReport("status-phrases").metrics["status_check_follow_up:slack"].count, 3);
assert.equal(getLiveActionBaselineReport("status-phrases").metrics["status_check_exposure_count:slack"].count, 3);
resetLiveActionBaselinesForTests();
assert.equal(recordStatusCheckFollowUp({
  userId: "retry-user",
  message: "What's the status?",
  surface: "discord",
  observationId: "discord-message-1",
}), true);
assert.equal(recordStatusCheckFollowUp({
  userId: "retry-user",
  message: "What's the status?",
  surface: "discord",
  observationId: "discord-message-1",
}), true);
assert.equal(getLiveActionBaselineReport("retry-user").metrics["status_check_follow_up:discord"].count, 1);
assert.equal(getLiveActionBaselineReport("retry-user").metrics["status_check_exposure_count:discord"].count, 1);
resetLiveActionBaselinesForTests();
assert.equal(recordStatusCheckFollowUp({ userId: "user-a", message: "Is it still running?", surface: "chat" }), true);
assert.equal(recordStatusCheckFollowUp({ userId: "user-a", message: "Tell me about basil.", surface: "chat" }), false);
assert.equal(getLiveActionBaselineReport("user-a").metrics["status_check_exposure_count:chat"].count, 2);
recordLiveActionBaseline({
  userId: "user-a",
  metric: "acknowledgement_visible_latency_ms",
  surface: "not-a-real-surface",
  value: 125,
  now: new Date("2026-08-16T12:00:00.000Z"),
});
recordLiveActionBaseline({
  userId: "user-a",
  metric: "reconnect_restoration_ms",
  surface: "inbox",
  value: 250,
});
assert.deepEqual(recordRenderedRepresentationSnapshot({
  userId: "user-a",
  kind: "agent_job",
  surface: "inbox",
  clientId: "client-a",
  identities: ["job-1", "job-1", "job-2"],
  sequence: 1,
  nowMs: 1_250,
}), { duplicateCount: 1, representationCount: 3 });
assert.deepEqual(recordRenderedRepresentationSnapshot({
  userId: "user-a",
  kind: "agent_job",
  surface: "mission_control",
  clientId: "client-a",
  identities: ["job-1"],
  sequence: 1,
  nowMs: 1_300,
}), { duplicateCount: 2, representationCount: 4 });
assert.deepEqual(recordRenderedRepresentationSnapshot({
  userId: "stale-snapshot-user",
  kind: "agent_job",
  surface: "inbox",
  clientId: "client-a",
  identities: [],
  sequence: 2,
  nowMs: 1_400,
}), { duplicateCount: 0, representationCount: 0 });
assert.equal(recordRenderedRepresentationSnapshot({
  userId: "stale-snapshot-user",
  kind: "agent_job",
  surface: "inbox",
  clientId: "client-a",
  identities: ["job-stale"],
  sequence: 1,
  nowMs: 1_500,
}), null);
assert.equal(getLiveActionBaselineReport("stale-snapshot-user").metrics["rendered_representation_count:inbox"].sum, 0);
assert.deepEqual(recordRenderedRepresentationSnapshot({
  userId: "stale-snapshot-user",
  kind: "agent_job",
  surface: "inbox",
  clientId: "client-b",
  identities: ["job-current"],
  sequence: 1,
  nowMs: 1_600,
}), { duplicateCount: 0, representationCount: 1 });
assert.deepEqual(observeTerminalStateDrift({
  userId: "user-a",
  kind: "project",
  surface: "projects",
  clientId: "client-a",
  entries: [{ id: "project-1", status: "building" }],
  canonicalStatuses: new Map([["project-1", "complete"]]),
  terminalStatuses: new Set(["complete", "failed"]),
  nowMs: 1_000,
}), { persistentDriftCount: 0, pendingMismatchCount: 1 });
for (const nowMs of [61_000, 121_000, 181_000, 241_000]) {
  assert.deepEqual(observeTerminalStateDrift({
    userId: "user-a",
    kind: "project",
    surface: "projects",
    clientId: "client-a",
    entries: [{ id: "project-1", status: "building" }],
    canonicalStatuses: new Map([["project-1", "complete"]]),
    terminalStatuses: new Set(["complete", "failed"]),
    nowMs,
  }), { persistentDriftCount: 0, pendingMismatchCount: 1 });
}
assert.equal(getLiveActionBaselineReport("user-a").metrics["terminal_representation_count:projects"].sum, 0);
assert.deepEqual(observeTerminalStateDrift({
  userId: "user-a",
  kind: "project",
  surface: "projects",
  clientId: "client-a",
  entries: [{ id: "project-1", status: "building" }],
  canonicalStatuses: new Map([["project-1", "complete"]]),
  terminalStatuses: new Set(["complete", "failed"]),
  nowMs: 301_000,
}), { persistentDriftCount: 1, pendingMismatchCount: 0 });
assert.deepEqual(observeTerminalStateDrift({
  userId: "user-a",
  kind: "project",
  surface: "projects",
  clientId: "client-a",
  entries: [{ id: "project-1", status: "complete" }],
  canonicalStatuses: new Map([["project-1", "complete"]]),
  terminalStatuses: new Set(["complete", "failed"]),
  nowMs: 302_000,
}), { persistentDriftCount: 0, pendingMismatchCount: 0 });
observeTerminalStateDrift({
  userId: "user-b",
  kind: "agent_job",
  surface: "inbox",
  clientId: "client-a",
  entries: [{ id: "job-gap", status: "running" }],
  canonicalStatuses: new Map([["job-gap", "complete"]]),
  terminalStatuses: new Set(["complete", "delivered", "failed", "cancelled"]),
  nowMs: 1_000,
});
assert.deepEqual(observeTerminalStateDrift({
  userId: "user-b",
  kind: "agent_job",
  surface: "inbox",
  clientId: "client-a",
  entries: [{ id: "job-gap", status: "running" }],
  canonicalStatuses: new Map([["job-gap", "complete"]]),
  terminalStatuses: new Set(["complete", "delivered", "failed", "cancelled"]),
  nowMs: 301_001,
}), { persistentDriftCount: 0, pendingMismatchCount: 1 });
const report = getLiveActionBaselineReport("user-a");
assert.equal(report.metrics["status_check_follow_up:chat"].count, 1);
assert.equal(report.metrics["acknowledgement_visible_latency_ms:unknown"].average, 125);
assert.equal(report.metrics["acknowledgement_visible_latency_ms:unknown"].p95, 250);
assert.equal(report.metrics["acknowledgement_visible_latency_ms:unknown"].histogram?.reduce((sum, bucket) => sum + bucket.count, 0), 1);
assert.equal(report.metrics["acknowledgement_visible_latency_ms:unknown"].histogram?.some((bucket) => bucket.upperBoundMs === 1_500), true);
assert.equal(report.metrics["acknowledgement_visible_latency_ms:unknown"].histogram?.some((bucket) => bucket.upperBoundMs === 3_000), true);
assert.equal(report.metrics["reconnect_restoration_ms:inbox"].average, 250);
assert.equal(report.metrics["duplicate_representation_count:inbox"].average, 1);
assert.equal(report.metrics["duplicate_representation_count:mission_control"].average, 2);
assert.equal(report.metrics["rendered_representation_count:mission_control"].sum, 4);
assert.equal(report.metrics["terminal_representation_count:projects"].sum, 2);
assert.deepEqual(report.privacy, {
  contentStored: false,
  identifiersStoredInMetrics: false,
  allowedDimensions: ["metric", "surface"],
});
const aggregate = getLiveActionAggregateReport();
assert.equal(aggregate.scope, "deployment");
assert.equal(aggregate.userCount, 1);
assert.equal(aggregate.metrics["status_check_follow_up:chat"].count, 1);
assert.equal(aggregate.metrics["status_check_exposure_count:chat"].sum, 2);
assert.equal(aggregate.metrics["acknowledgement_visible_latency_ms:unknown"], undefined);
assert.equal(aggregate.metrics["duplicate_representation_count:inbox"], undefined);
assert.equal(aggregate.metrics["terminal_state_drift_count:projects"], undefined);
assert.equal(aggregate.metrics["terminal_representation_count:projects"], undefined);

console.log("OK: live-action rollout flags and privacy-safe baselines are independent and bounded");
