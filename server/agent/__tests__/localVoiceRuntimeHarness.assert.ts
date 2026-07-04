import assert from "node:assert/strict";
import { resolveAndroidNotificationReference } from "../androidNotificationSummary";
import {
  FakeAndroidVoiceRuntime,
  LocalVoiceRuntimeHarnessError,
  ScriptedFakeLocalGemmaProvider,
  normalizeLocalVoiceToolName,
  runLocalVoiceRuntimeHarnessTurn,
  type LocalVoiceCapability,
  type LocalVoiceAndroidEvent,
  type LocalVoiceToolName,
  type ScriptedLocalGemmaStep,
} from "../../voiceLocalRuntimeHarness";

const notificationEvents: LocalVoiceAndroidEvent[] = [{
  type: "notification",
  notifications: [
    { app: "Codex", title: "Review finished", text: "No major issues found" },
    { app: "Reddit", title: "vivecoding thread is trending", text: "New replies in r/vivecoding" },
    { app: "Life360", title: "Justin arrived Home" },
  ],
}];

async function testCompleteLocalVoiceNotificationTurn() {
  const gemma = new ScriptedFakeLocalGemmaProvider([
    { type: "tool_call", name: "android_read_notifications", arguments: {} },
  ]);

  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma,
    androidEvents: notificationEvents,
  });

  assert.equal(result.diagnostics.outcome, "tool_call_executed");
  assert.equal(result.responseCount, 1);
  assert.equal(result.chatOutput, result.canonicalResponse);
  assert.equal(result.ttsOutput, result.canonicalResponse);
  assert.match(result.canonicalResponse, /I checked your Android notifications/i);
  assert.match(result.canonicalResponse, /Codex/i);
  assert.match(result.canonicalResponse, /Reddit/i);
  assert.match(result.canonicalResponse, /No major issues found/);
  assert.doesNotMatch(result.canonicalResponse, /Codex: Review finished - No major issues found/);
  assert.ok(result.workingContext.notifications);
  assert.match(result.workingContext.notifications?.summary ?? "", /Review finished/);
  assert.match(result.workingContext.notifications?.orderedDetail ?? "", /1\. Codex/);
  assert.deepEqual(result.modelCalls.map((call) => call.kind), ["local_gemma"]);
  assert.equal(result.androidExecutions[0].toolName, "android_read_notifications");
  assert.equal(gemma.prompts[0].transcript, "Read my notifications");
  assert.match(gemma.prompts[0].contextPacket, /Mode: Local/);
  console.log("OK: local voice harness runs transcript to one canonical chat/TTS response");
}

async function testEmptyNotificationReadSucceeds() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: [{ type: "notification", notifications: [] }],
  });

  assert.equal(result.androidExecutions[0].ok, true);
  assert.match(result.canonicalResponse, /no current notifications/i);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: empty notification shade is a successful local voice read");
}

async function testNotificationFollowUpSummaryUsesWorkingContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const followUp = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Summarize those again",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot access your notifications." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(followUp.diagnostics.outcome, "notification_context_summary");
  assert.equal(followUp.androidExecutions.length, 0);
  assert.match(followUp.canonicalResponse, /Codex/i);
  assert.match(followUp.canonicalResponse, /Reddit/i);
  assert.doesNotMatch(followUp.canonicalResponse, /cannot|do not have access|language model/i);
  console.log("OK: notification follow-up summaries use short-lived runtime working context");
}

async function testNotificationFollowUpReadAllUsesWorkingContextInOrder() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const readAll = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read all of them",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "notifications", text: "I cannot read notifications." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(readAll.diagnostics.outcome, "notification_context_read_all");
  assert.match(readAll.canonicalResponse, /1\. Codex/);
  assert.match(readAll.canonicalResponse, /2\. Reddit/);
  assert.match(readAll.canonicalResponse, /3\. Life360/);
  assert.doesNotMatch(readAll.canonicalResponse, /language model/i);
  console.log("OK: explicit read-all notification follow-ups preserve notification order");
}

async function testNotificationReadAllWinsOverSpecificReference() {
  const allHandsEvents: LocalVoiceAndroidEvent[] = [{
    type: "notification",
    notifications: [
      { app: "Calendar", title: "All hands", text: "Company meeting starts soon" },
      { app: "Reddit", title: "vivecoding thread is trending", text: "New replies in r/vivecoding" },
    ],
  }];
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: allHandsEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const readAll = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read all of them",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot access those." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(readAll.diagnostics.outcome, "notification_context_read_all");
  assert.match(readAll.canonicalResponse, /1\. Calendar/);
  assert.match(readAll.canonicalResponse, /2\. Reddit/);
  console.log("OK: read-all follow-ups win over specific notification references");
}

async function testNotificationReferenceOpensMatchingApp() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const open = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open the Reddit one",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot open notifications." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Reddit", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:03:00.000Z"),
  });

  assert.equal(open.diagnostics.outcome, "notification_reference_opened");
  assert.equal(open.androidExecutions[0]?.toolName, "android_open_app_by_name");
  assert.equal(open.androidExecutions[0]?.ok, true);
  assert.match(open.canonicalResponse, /opened Reddit/i);
  console.log("OK: notification references resolve to the matching app action");
}

async function testNotificationReferenceUsesStoredAppNames() {
  const teamsEvents: LocalVoiceAndroidEvent[] = [{
    type: "notification",
    notifications: [
      { app: "Microsoft Teams", title: "Alex sent a message", text: "Standup moved to 3 PM" },
      { app: "Instagram", title: "New follower", text: "Jordan followed you" },
    ],
  }];
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: teamsEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const open = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open the Teams one",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot open that." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Microsoft Teams", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(open.diagnostics.outcome, "notification_reference_opened");
  assert.equal(open.androidExecutions[0]?.ok, true);
  assert.match(open.canonicalResponse, /opened Microsoft Teams/i);
  console.log("OK: notification references use stored app names instead of a fixed whitelist");
}

function testOrdinalNotificationReferencesSelectWithinMatches() {
  const match = resolveAndroidNotificationReference([
    { app: "Second", title: "Payment card", text: "Statement ready" },
    { app: "Gmail", title: "Reddit digest", text: "Trending posts from Reddit" },
    { app: "Reddit", title: "First thread", text: "r/vivecoding" },
    { app: "Reddit", title: "Local models thread", text: "r/localmodels" },
  ], "Open the second Reddit one");

  assert.equal(match?.index, 3);
  assert.equal(match?.notification.title, "Local models thread");
  console.log("OK: ordinal notification references select within matched notifications");
}

function testShortAppNameNotificationReferencesResolve() {
  const match = resolveAndroidNotificationReference([
    { app: "X", title: "Direct message", text: "Alex sent a message" },
    { app: "Reddit", title: "Thread reply", text: "New reply in r/localmodels" },
  ], "Open the X one");

  assert.equal(match?.index, 0);
  assert.equal(match?.notification.app, "X");
  console.log("OK: short app-name notification references resolve exactly");
}

function testNotificationReferencePrefersAppNameTermsOverBodyMentions() {
  const match = resolveAndroidNotificationReference([
    { app: "Gmail", title: "Microsoft Teams digest", text: "A weekly Teams summary" },
    { app: "Microsoft Teams", title: "Alex sent a message", text: "Standup moved to 3 PM" },
  ], "Open the Teams one");

  assert.equal(match?.index, 1);
  assert.equal(match?.notification.app, "Microsoft Teams");
  console.log("OK: notification references prefer app-name tokens over body mentions");
}

function testShortAppNameReferencesRequireWholeTokenMatches() {
  const match = resolveAndroidNotificationReference([
    { app: "X", title: "Direct message", text: "Alex sent a message" },
    { app: "Gmail", title: "Tax alert", text: "Quarterly tax estimate is ready" },
  ], "Open the tax alert");

  assert.equal(match?.index, 1);
  assert.equal(match?.notification.app, "Gmail");
  console.log("OK: short app-name notification references require whole-token matches");
}

async function testNotificationWorkingContextIsNotInjectedIntoUnrelatedTurns() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });
  const gemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "Here is a short joke." }]);

  const unrelated = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Tell me a joke",
    gemma,
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(unrelated.diagnostics.outcome, "final");
  assert.doesNotMatch(gemma.prompts[0].contextPacket, /Recent notifications/);
  assert.doesNotMatch(unrelated.canonicalResponse, /Codex|Reddit|Life360/);
  console.log("OK: notification working context is not injected into unrelated voice turns");
}

async function testGenericOneAppRequestDoesNotUseNotificationContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const generic = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open one app",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "Which app should I open?" },
    ]),
    androidEvents: [{ type: "app_control", appName: "Codex", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(generic.diagnostics.outcome, "final");
  assert.equal(generic.androidExecutions.length, 0);
  assert.equal(generic.canonicalResponse, "Which app should I open?");
  console.log("OK: generic one-app requests do not hijack recent notification context");
}

async function testPlainAppOpenDoesNotUseNotificationTitleReference() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: [{
      type: "notification",
      notifications: [
        { app: "Gmail", title: "Reddit digest", text: "Trending posts from Reddit" },
        { app: "Calendar", title: "Standup", text: "Starts in 10 minutes" },
      ],
    }],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const open = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open Reddit",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot open apps." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Reddit", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(open.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(open.androidExecutions[0]?.toolName, "android_open_app_by_name");
  assert.equal(open.androidExecutions[0]?.label, "Opened Reddit");
  assert.doesNotMatch(open.canonicalResponse, /Gmail/i);
  console.log("OK: plain app opens do not use notification title references");
}

async function testNegatedNotificationFollowUpsDoNotUseWorkingContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const dontOpen = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't open the Reddit one",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I will not open it." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Reddit", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(dontOpen.diagnostics.outcome, "final");
  assert.equal(dontOpen.androidExecutions.length, 0);
  assert.equal(dontOpen.canonicalResponse, "I will not open it.");

  const dontRead = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't read all of them",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I will not read them." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(dontRead.diagnostics.outcome, "final");
  assert.equal(dontRead.androidExecutions.length, 0);
  assert.equal(dontRead.canonicalResponse, "I will not read them.");
  console.log("OK: negated notification follow-ups do not use working context");
}

async function testLaterPositiveNotificationClauseAfterNegationRuns() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const mixed = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't open the Reddit one, open the Life360 one",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot open that." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Life360", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:03:00.000Z"),
  });

  assert.equal(mixed.diagnostics.outcome, "notification_reference_opened");
  assert.equal(mixed.androidExecutions[0]?.toolName, "android_open_app_by_name");
  assert.equal(mixed.androidExecutions[0]?.ok, true);
  assert.match(mixed.canonicalResponse, /opened Life360/i);
  console.log("OK: later positive notification clauses still run after an earlier negation");
}

async function testEarlierPositiveNotificationClauseSurvivesLaterNegation() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const summarize = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Summarize those, but don't read all of them",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot summarize notifications." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:03:00.000Z"),
  });

  assert.equal(summarize.diagnostics.outcome, "notification_context_summary");
  assert.match(summarize.canonicalResponse, /Codex/i);
  assert.doesNotMatch(summarize.canonicalResponse, /1\. Codex/);

  const open = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open the Reddit one and don't open Life360",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot open that." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Reddit", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:04:00.000Z"),
  });

  assert.equal(open.diagnostics.outcome, "notification_reference_opened");
  assert.equal(open.androidExecutions[0]?.toolName, "android_open_app_by_name");
  assert.equal(open.androidExecutions[0]?.label, "Opened Reddit");
  console.log("OK: earlier positive notification clauses survive later unrelated negations");
}

async function testLaterPronounNegationCancelsNotificationAction() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const cancelled = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open the Reddit one, but don't open it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "Okay, I won't open it." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Reddit", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:05:00.000Z"),
  });

  assert.equal(cancelled.diagnostics.outcome, "final");
  assert.equal(cancelled.androidExecutions.length, 0);
  assert.equal(cancelled.canonicalResponse, "Okay, I won't open it.");

  const explicitCancel = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open the Reddit one, but don't open the Reddit one",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "Okay, I won't open it." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Reddit", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:04:30.000Z"),
  });

  assert.equal(explicitCancel.diagnostics.outcome, "final");
  assert.equal(explicitCancel.androidExecutions.length, 0);
  assert.equal(explicitCancel.canonicalResponse, "Okay, I won't open it.");
  console.log("OK: later pronoun negations cancel earlier notification actions");
}

async function testSpecificNotificationReadUsesWorkingContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const read = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read the Reddit one",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot access your notifications." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:04:30.000Z"),
  });

  assert.equal(read.diagnostics.outcome, "notification_reference_read");
  assert.equal(read.androidExecutions.length, 0);
  assert.match(read.canonicalResponse, /Reddit: vivecoding thread is trending: New replies in r\/vivecoding/);
  assert.doesNotMatch(read.canonicalResponse, /cannot access/i);
  console.log("OK: specific notification reads use short-lived working context");
}

async function testMissingAppControlFixtureFails() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_open_app_by_name", arguments: { appName: "YouTube" } },
    ]),
    androidEvents: [],
  });

  assert.equal(result.androidExecutions[0].ok, false);
  assert.match(result.canonicalResponse, /could not complete that phone action/i);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: app-control harness turns require an app-control fixture");
}

async function testMismatchedAppControlFixtureFails() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open Spotify",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_open_app_by_name", arguments: { appName: "Spotify" } },
    ]),
    androidEvents: [{ type: "app_control", appName: "YouTube", action: "open", success: true }],
  });

  assert.equal(result.androidExecutions[0].ok, false);
  assert.match(result.canonicalResponse, /could not complete that phone action/i);
  assert.match(result.canonicalResponse, /Could not open Spotify/);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: app-control harness fixtures must match the requested app");
}

async function testAppControlFalseDenialRecoveryKeepsRequestedApp() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot open apps." },
    ]),
    androidEvents: [{ type: "app_control", appName: "YouTube", action: "open", success: true }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.androidExecutions[0].ok, true);
  assert.equal(result.androidExecutions[0].label, "Opened YouTube");
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: app-control false-denial recovery preserves the requested app");
}

async function testAppControlFalseDenialUsesActiveOpenRequest() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "I didn't ask you to open YouTube; open Chrome instead",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot open apps." },
    ]),
    androidEvents: [{ type: "app_control", appName: "YouTube", action: "open", success: true }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.androidExecutions[0].ok, false);
  assert.match(result.androidExecutions[0].label, /Could not open Chrome/);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: app-control false-denial recovery uses the active open request");
}

async function testAppControlFalseDenialUsesPunctuationFreeCorrection() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't open YouTube but open Chrome",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot open apps." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Chrome", action: "open", success: true }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.androidExecutions[0].ok, true);
  assert.equal(result.androidExecutions[0].label, "Opened Chrome");
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: app-control false-denial recovery handles punctuation-free corrections");
}

async function testAppControlFalseDenialBlocksNegatedOpenRequest() {
  for (const transcript of ["Don't open YouTube", "Could you not open YouTube?"]) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot open apps." },
      ]),
      androidEvents: [{ type: "app_control", appName: "YouTube", action: "open", success: true }],
    });

    assert.equal(result.diagnostics.outcome, "tool_recovery_blocked", transcript);
    assert.equal(result.androidExecutions.length, 0, transcript);
    assert.match(result.canonicalResponse, /not completed/i, transcript);
    assert.equal(result.chatOutput, result.ttsOutput, transcript);
  }
  console.log("OK: app-control false-denial recovery blocks negated open requests");
}

async function testFalseDenialRecoveryBlocksNegatedNonAppCapabilities() {
  const cases: Array<{
    name: string;
    transcript: string;
    capability: LocalVoiceCapability;
    androidEvents: LocalVoiceAndroidEvent[];
  }> = [
    {
      name: "notifications",
      transcript: "Don't read my notifications",
      capability: "notifications",
      androidEvents: notificationEvents,
    },
    {
      name: "screen",
      transcript: "Do not read my screen",
      capability: "screen",
      androidEvents: [{ type: "screen", activeApp: "Settings", title: "Settings", text: "Device control" }],
    },
    {
      name: "clipboard",
      transcript: "Please don't copy that to my clipboard",
      capability: "clipboard",
      androidEvents: [{ type: "clipboard", text: "diagnostic details" }],
    },
    {
      name: "approval",
      transcript: "Don't request approval for deleting anything",
      capability: "approval",
      androidEvents: [{ type: "approval", action: "delete file", approved: true }],
    },
    {
      name: "scheduler",
      transcript: "Don't check scheduler jobs",
      capability: "scheduler",
      androidEvents: [{ type: "scheduler", activeJobs: ["voice call"] }],
    },
    {
      name: "scheduler coordinated nouns",
      transcript: "Don't check scheduler jobs and tasks",
      capability: "scheduler",
      androidEvents: [{ type: "scheduler", activeJobs: ["voice call"] }],
    },
    {
      name: "service",
      transcript: "Don't check daemon status",
      capability: "service",
      androidEvents: [{ type: "crash", service: "android-daemon", message: "service restarted" }],
    },
    {
      name: "service coordinated nouns",
      transcript: "Don't check daemon status and service",
      capability: "service",
      androidEvents: [{ type: "crash", service: "android-daemon", message: "service restarted" }],
    },
  ];

  for (const testCase of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: testCase.transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: testCase.capability, text: "I cannot do that." },
      ]),
      androidEvents: testCase.androidEvents,
    });

    assert.equal(result.diagnostics.outcome, "tool_recovery_blocked", testCase.name);
    assert.equal(result.androidExecutions.length, 0, testCase.name);
    assert.equal(result.chatOutput, result.ttsOutput, testCase.name);
  }
  console.log("OK: false-denial recovery blocks negated non-app capabilities");
}

async function testScriptedFakeLocalGemmaVariants() {
  const cases: Array<{
    name: string;
    step: ScriptedLocalGemmaStep;
    expectedOutcome: string;
    expectedTool?: LocalVoiceToolName;
    expectedExecutions?: number;
  }> = [
    {
      name: "valid tool call",
      step: { type: "tool_call", name: "android_read_notifications" },
      expectedOutcome: "tool_call_executed",
      expectedTool: "android_read_notifications",
      expectedExecutions: 1,
    },
    {
      name: "invalid but recoverable tool call",
      step: { type: "invalid_tool_call", name: "android_read _notifications" },
      expectedOutcome: "tool_call_recovered",
      expectedTool: "android_read_notifications",
      expectedExecutions: 1,
    },
    {
      name: "invalid unavailable tool call",
      step: { type: "invalid_tool_call", name: "android_launch_moon" },
      expectedOutcome: "tool_unavailable",
      expectedExecutions: 0,
    },
    {
      name: "malformed output",
      step: { type: "malformed_output", raw: "{\"tool_calls\":" },
      expectedOutcome: "model_output_invalid",
      expectedExecutions: 0,
    },
    {
      name: "blank response",
      step: { type: "blank_response" },
      expectedOutcome: "blank_model_response",
      expectedExecutions: 0,
    },
    {
      name: "timeout",
      step: { type: "timeout", afterMs: 90_000 },
      expectedOutcome: "model_timeout",
      expectedExecutions: 0,
    },
    {
      name: "false denial",
      step: { type: "false_denial", capability: "notifications", text: "I cannot read your notifications." },
      expectedOutcome: "tool_executed_after_false_denial",
      expectedTool: "android_read_notifications",
      expectedExecutions: 1,
    },
    {
      name: "false completion",
      step: { type: "false_completion", action: "android_open_app_by_name", text: "I opened YouTube." },
      expectedOutcome: "false_completion_blocked",
      expectedExecutions: 0,
    },
  ];

  for (const testCase of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: "Read my notifications",
      gemma: new ScriptedFakeLocalGemmaProvider([testCase.step]),
      androidEvents: notificationEvents,
    });

    assert.equal(result.diagnostics.outcome, testCase.expectedOutcome, testCase.name);
    assert.equal(result.androidExecutions.length, testCase.expectedExecutions ?? 0, testCase.name);
    if (testCase.expectedTool) {
      assert.equal(result.diagnostics.executedToolName, testCase.expectedTool, testCase.name);
    }
    assert.equal(result.chatOutput, result.ttsOutput, testCase.name);
    assert.equal(result.responseCount, 1, testCase.name);
  }

  console.log("OK: scripted fake Local Gemma covers tool calls, bad output, denials, completions, and timeouts");
}

function testFakeAndroidRuntimeEventCoverage() {
  const events: LocalVoiceAndroidEvent[] = [
    ...notificationEvents,
    { type: "screen", activeApp: "YouTube", title: "Shorts", text: "Video details", elements: ["Search", "Subscribe"] },
    { type: "app_control", appName: "YouTube", action: "open", success: true, detail: "Ready to search" },
    { type: "clipboard", text: "diagnostic details" },
    { type: "approval", action: "delete file", approved: false },
    { type: "scheduler", activeJobs: ["voice call"], pausedJobs: ["cloud research"] },
    { type: "crash", service: "android-daemon", message: "service restarted" },
  ];
  const runtime = new FakeAndroidVoiceRuntime(events);

  assert.deepEqual(runtime.availableEventTypes.sort(), [
    "app_control",
    "approval",
    "clipboard",
    "crash",
    "notification",
    "scheduler",
    "screen",
  ]);

  assert.equal(runtime.execute("android_read_notifications").ok, true);
  assert.match(runtime.execute("android_read_screen_context").label, /YouTube/);
  assert.match(runtime.execute("android_capture_screen").detail, /Subscribe/);
  assert.equal(runtime.execute("android_open_app_by_name", { appName: "YouTube" }).ok, true);
  assert.match(runtime.execute("android_copy_to_clipboard").detail, /diagnostic details/);
  assert.equal(runtime.execute("runtime_request_approval").ok, false);
  assert.match(runtime.execute("runtime_scheduler_status").detail, /cloud research/);
  assert.equal(runtime.execute("runtime_service_status").ok, false);
  assert.equal(runtime.executions.length, 8);
  assert.equal(normalizeLocalVoiceToolName("android_view_screenshot"), "android_capture_screen");
  console.log("OK: fake Android runtime simulates notification, screen, app, clipboard, approval, scheduler, and crash events");
}

async function testLocalVoiceBlocksCloudAndSecondaryModels() {
  for (const flags of [
    { simulateCloudRoute: true },
    { simulateSecondaryLlmRoute: true },
  ]) {
    await assert.rejects(
      () =>
        runLocalVoiceRuntimeHarnessTurn({
          userId: "user-local-voice",
          transcript: "Read my notifications",
          gemma: new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "This should not run." }]),
          androidEvents: notificationEvents,
          ...flags,
        }),
      (error) => {
        assert.ok(error instanceof LocalVoiceRuntimeHarnessError);
        assert.equal(error.code, "LOCAL_VOICE_CLOUD_MODEL_BLOCKED");
        return true;
      },
    );
  }
  console.log("OK: local voice harness fails any live-turn cloud or secondary LLM route");
}

async function testCanonicalFinalResponseContract() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Who are you?",
    gemma: new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "I am JARVIS running locally." }]),
  });

  assert.equal(result.canonicalResponse, "I am JARVIS running locally.");
  assert.equal(result.chatOutput, "I am JARVIS running locally.");
  assert.equal(result.ttsOutput, "I am JARVIS running locally.");
  assert.equal(result.responseCount, 1);
  console.log("OK: final local voice answers share one canonical response for chat and TTS");
}

async function main() {
  await testCompleteLocalVoiceNotificationTurn();
  await testEmptyNotificationReadSucceeds();
  await testNotificationFollowUpSummaryUsesWorkingContext();
  await testNotificationFollowUpReadAllUsesWorkingContextInOrder();
  await testNotificationReadAllWinsOverSpecificReference();
  await testNotificationReferenceOpensMatchingApp();
  await testNotificationReferenceUsesStoredAppNames();
  testOrdinalNotificationReferencesSelectWithinMatches();
  testShortAppNameNotificationReferencesResolve();
  testNotificationReferencePrefersAppNameTermsOverBodyMentions();
  testShortAppNameReferencesRequireWholeTokenMatches();
  await testNotificationWorkingContextIsNotInjectedIntoUnrelatedTurns();
  await testGenericOneAppRequestDoesNotUseNotificationContext();
  await testPlainAppOpenDoesNotUseNotificationTitleReference();
  await testNegatedNotificationFollowUpsDoNotUseWorkingContext();
  await testLaterPositiveNotificationClauseAfterNegationRuns();
  await testEarlierPositiveNotificationClauseSurvivesLaterNegation();
  await testLaterPronounNegationCancelsNotificationAction();
  await testSpecificNotificationReadUsesWorkingContext();
  await testMissingAppControlFixtureFails();
  await testMismatchedAppControlFixtureFails();
  await testAppControlFalseDenialRecoveryKeepsRequestedApp();
  await testAppControlFalseDenialUsesActiveOpenRequest();
  await testAppControlFalseDenialUsesPunctuationFreeCorrection();
  await testAppControlFalseDenialBlocksNegatedOpenRequest();
  await testFalseDenialRecoveryBlocksNegatedNonAppCapabilities();
  await testScriptedFakeLocalGemmaVariants();
  testFakeAndroidRuntimeEventCoverage();
  await testLocalVoiceBlocksCloudAndSecondaryModels();
  await testCanonicalFinalResponseContract();
  console.log("\nAll Local Voice Runtime harness assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
