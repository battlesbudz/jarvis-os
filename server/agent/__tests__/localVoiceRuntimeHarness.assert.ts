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
import { _setGroundedEvidencePacketDepsForTesting } from "../../state/groundedEvidencePacket";
import { _setRuntimeMemoryInspectionDepsForTesting } from "../../state/runtimeMemoryInspection";

const notificationEvents: LocalVoiceAndroidEvent[] = [{
  type: "notification",
  notifications: [
    { app: "Codex", title: "Review finished", text: "No major issues found" },
    { app: "Reddit", title: "vivecoding thread is trending", text: "New replies in r/vivecoding" },
    { app: "Life360", title: "Justin arrived Home" },
  ],
}];

const accessibilityScreenEvent: LocalVoiceAndroidEvent = {
  type: "screen",
  source: "accessibility",
  activeApp: "YouTube",
  title: "Alex Hormozi videos - YouTube",
  text: "Search results are visible.",
  elements: ["Search", "Alex Hormozi podcast", "Subscribe"],
};

const freshAccessibilityScreenEvent: LocalVoiceAndroidEvent = {
  type: "screen",
  source: "accessibility",
  activeApp: "Gmail",
  title: "Inbox - Gmail",
  text: "Fresh inbox screen is visible.",
  elements: ["Primary", "Invoice from bank", "Compose"],
};

const emptyAccessibilityScreenEvent: LocalVoiceAndroidEvent = {
  type: "screen",
  source: "accessibility",
  activeApp: "Bank",
  title: "",
  text: "",
  elements: [],
};

const temporaryCaptureEvent: LocalVoiceAndroidEvent = {
  type: "screen",
  source: "temporary_capture",
  activeApp: "YouTube",
  title: "Temporary capture",
  text: "OCR fallback sees YouTube search results.",
  elements: ["Search", "Video card"],
  captureId: "capture-yt-1",
  capturePath: "/tmp/jarvis-captures/capture-yt-1.png",
};

const imageOnlyTemporaryCaptureEvent: LocalVoiceAndroidEvent = {
  type: "screen",
  source: "temporary_capture",
  activeApp: "YouTube",
  text: "",
  captureId: "capture-image-only-1",
  capturePath: "/tmp/jarvis-captures/capture-image-only-1.png",
};

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

async function testNotificationFalseDenialIgnoresNegatedUnrelatedFollowUp() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications but don't open Reddit",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "notifications", text: "I cannot read notifications." },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_read_notifications");
  assert.match(result.canonicalResponse, /Codex/i);
  assert.doesNotMatch(result.canonicalResponse, /could not|blocked|language model/i);
  console.log("OK: notification false-denial recovery ignores negated unrelated follow-ups");
}

async function testNotificationFalseDenialBlocksPronounCancellation() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications and don't read them",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "notifications", text: "I cannot read notifications." },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_recovery_blocked");
  assert.equal(result.androidExecutions.length, 0);
  assert.match(result.canonicalResponse, /not completed/i);
  console.log("OK: notification false-denial recovery blocks pronoun cancellations");
}

async function testNotificationFalseDenialIgnoresDifferentPronounCapabilityCancellation() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications and don't copy them",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "notifications", text: "I cannot read notifications." },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_read_notifications");
  assert.match(result.canonicalResponse, /Codex/i);
  assert.doesNotMatch(result.canonicalResponse, /not completed|language model/i);
  console.log("OK: notification false-denial recovery ignores pronoun cancellations for other capabilities");
}

async function testNotificationFalseDenialIgnoresPunctuatedNoRushAside() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications, no rush",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "notifications", text: "I cannot read notifications." },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_read_notifications");
  assert.match(result.canonicalResponse, /Codex/i);
  assert.doesNotMatch(result.canonicalResponse, /not completed|language model/i);
  console.log("OK: notification false-denial recovery ignores punctuated no-rush asides");
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

async function testNotificationToolCallFollowUpUsesWorkingContext() {
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
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(readAll.diagnostics.outcome, "notification_context_read_all");
  assert.equal(readAll.androidExecutions.length, 0);
  assert.match(readAll.canonicalResponse, /1\. Codex/);
  assert.match(readAll.canonicalResponse, /2\. Reddit/);
  assert.match(readAll.canonicalResponse, /3\. Life360/);
  console.log("OK: notification tool-call follow-ups use stored working context first");
}

async function testVoiceScreenReadUsesAccessibilityBeforeTemporaryCapture() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I cannot access your screen." },
    ]),
    androidEvents: [accessibilityScreenEvent, temporaryCaptureEvent],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_read_screen_context");
  assert.equal(result.androidExecutions.length, 1);
  assert.equal(result.androidExecutions[0]?.toolName, "android_read_screen_context");
  assert.match(result.canonicalResponse, /Alex Hormozi videos - YouTube/);
  assert.doesNotMatch(result.canonicalResponse, /Temporary screen capture/i);
  assert.equal(result.workingContext.screen?.source, "accessibility");
  assert.equal(result.workingContext.screen?.activeApp, "YouTube");
  assert.equal(result.workingContext.screen?.capture, undefined);

  const readOnlyCaptureCall = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_capture_screen", arguments: {} },
    ]),
    androidEvents: [accessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:30.000Z"),
  });

  assert.equal(readOnlyCaptureCall.diagnostics.outcome, "tool_call_executed");
  assert.equal(readOnlyCaptureCall.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(readOnlyCaptureCall.androidExecutions.map((execution) => execution.toolName), ["android_read_screen_context"]);
  assert.match(readOnlyCaptureCall.canonicalResponse, /Alex Hormozi videos - YouTube/);
  assert.doesNotMatch(readOnlyCaptureCall.canonicalResponse, /Temporary screen capture/i);
  assert.equal(readOnlyCaptureCall.workingContext.screen?.capture, undefined);

  for (const transcript of ["What's on screen?", "Read screen"]) {
    const articlelessRead = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "final", text: "I cannot see the screen." },
      ]),
      androidEvents: [accessibilityScreenEvent],
      now: new Date("2026-07-04T12:01:00.000Z"),
    });

    assert.equal(articlelessRead.diagnostics.outcome, "tool_executed_after_final_screen_refresh", transcript);
    assert.equal(articlelessRead.diagnostics.executedToolName, "android_read_screen_context", transcript);
    assert.deepEqual(articlelessRead.androidExecutions.map((execution) => execution.toolName), ["android_read_screen_context"], transcript);
    assert.match(articlelessRead.canonicalResponse, /Alex Hormozi videos - YouTube/, transcript);
    assert.equal(articlelessRead.workingContext.screen?.source, "accessibility", transcript);
  }

  console.log("OK: voice screen reads use accessibility before temporary capture fallback");
}

async function testVoiceScreenReadFallsBackToTemporaryCapturePreview() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_call_capture_fallback");
  assert.deepEqual(result.androidExecutions.map((execution) => execution.toolName), [
    "android_read_screen_context",
    "android_capture_screen",
  ]);
  assert.equal(result.androidExecutions[0]?.ok, false);
  assert.equal(result.androidExecutions[1]?.ok, true);
  assert.match(result.canonicalResponse, /Temporary screen capture/i);
  assert.match(result.canonicalResponse, /Attached to chat; Gallery save not intended/i);
  assert.match(result.canonicalResponse, /OCR fallback sees YouTube search results/);
  assert.equal(result.workingContext.screen?.source, "temporary_capture");
  assert.equal(result.workingContext.screen?.capture?.path, "/tmp/jarvis-captures/capture-yt-1.png");
  assert.equal(result.workingContext.screen?.capture?.savedToGallery, false);
  assert.deepEqual(result.workingContext.screen?.capture?.previewActions, ["copy_details", "delete"]);
  assert.equal("imageBase64" in (result.workingContext.screen?.capture ?? {}), false);
  console.log("OK: voice screen reads fall back to temporary capture previews when accessibility is unavailable");
}

async function testVoiceScreenReadFallsBackWhenAccessibilityIsEmpty() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [emptyAccessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_call_capture_fallback");
  assert.deepEqual(result.androidExecutions.map((execution) => execution.toolName), [
    "android_read_screen_context",
    "android_capture_screen",
  ]);
  assert.equal(result.androidExecutions[0]?.ok, false);
  assert.equal(result.androidExecutions[1]?.ok, true);
  assert.match(result.canonicalResponse, /Temporary screen capture/i);
  assert.match(result.canonicalResponse, /OCR fallback sees YouTube search results/);
  assert.equal(result.workingContext.screen?.source, "temporary_capture");
  console.log("OK: empty accessibility reads fall back to temporary capture previews");
}

async function testImageOnlyTemporaryCaptureReportsAttachment() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Take a screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_capture_screen", arguments: {} },
    ]),
    androidEvents: [imageOnlyTemporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_call_executed");
  assert.equal(result.diagnostics.executedToolName, "android_capture_screen");
  assert.equal(result.androidExecutions[0]?.ok, true);
  assert.match(result.canonicalResponse, /Temporary screen capture attached/i);
  assert.doesNotMatch(result.canonicalResponse, /could not capture anything useful/i);
  assert.equal(result.workingContext.screen?.capture?.id, "capture-image-only-1");
  console.log("OK: image-only temporary captures are reported as attached");
}

async function testExpandedScreenContextFollowUpUsesWorkingContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const followUp = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What is on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot see your screen." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(followUp.diagnostics.outcome, "screen_capture_context_summary");
  assert.match(followUp.canonicalResponse, /OCR fallback sees YouTube search results/);
  assert.doesNotMatch(followUp.canonicalResponse, /cannot see/i);

  for (const transcript of [
    "What's in this screenshot?",
    "Read this screen shot",
    "What's in this screen capture?",
    "Read this screen capture",
  ]) {
    const captureFollowUp = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "final", text: "I cannot inspect that image." },
      ]),
      workingContext: first.workingContext,
      now: new Date("2026-07-04T12:01:30.000Z"),
    });

    assert.equal(captureFollowUp.diagnostics.outcome, "screen_capture_context_summary", transcript);
    assert.match(captureFollowUp.canonicalResponse, /OCR fallback sees YouTube search results/, transcript);
  }

  const captureFollowUpWithFreshScreen = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's in this screenshot?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot inspect that image." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:40.000Z"),
  });

  assert.equal(captureFollowUpWithFreshScreen.diagnostics.outcome, "screen_capture_context_summary");
  assert.match(captureFollowUpWithFreshScreen.canonicalResponse, /OCR fallback sees YouTube search results/);
  assert.doesNotMatch(captureFollowUpWithFreshScreen.canonicalResponse, /Fresh inbox screen is visible/);

  for (const transcript of ["What does it show?", "Describe it"]) {
    const gemma = new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot inspect that." },
    ]);
    const pronounFollowUp = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma,
      workingContext: first.workingContext,
      now: new Date("2026-07-04T12:01:45.000Z"),
    });

    assert.equal(pronounFollowUp.diagnostics.outcome, "screen_capture_context_summary", transcript);
    assert.match(pronounFollowUp.canonicalResponse, /OCR fallback sees YouTube search results/, transcript);
    assert.match(gemma.prompts[0]?.contextPacket ?? "", /Recent screen: YouTube - Temporary capture/, transcript);
  }

  const negatedGemma = new ScriptedFakeLocalGemmaProvider([
    { type: "final", text: "I won't describe it." },
  ]);
  const negatedPronoun = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't describe it",
    gemma: negatedGemma,
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(negatedPronoun.diagnostics.outcome, "final");
  assert.equal(negatedPronoun.canonicalResponse, "I won't describe it.");
  assert.doesNotMatch(negatedGemma.prompts[0]?.contextPacket ?? "", /Recent screen|Temporary capture/i);

  const currentPronoun = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What does it show now?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot inspect that." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:02:15.000Z"),
  });

  assert.equal(currentPronoun.diagnostics.outcome, "tool_executed_after_final_screen_refresh");
  assert.equal(currentPronoun.diagnostics.executedToolName, "android_read_screen_context");
  assert.match(currentPronoun.canonicalResponse, /Fresh inbox screen is visible/);
  assert.doesNotMatch(currentPronoun.canonicalResponse, /OCR fallback sees YouTube/i);
  assert.equal(currentPronoun.workingContext.screen?.activeApp, "Gmail");

  for (const transcript of ["Tell me about my screen", "Tell me about this display"]) {
    const directDescription = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "final", text: "I cannot inspect that." },
      ]),
      androidEvents: [freshAccessibilityScreenEvent],
      now: new Date("2026-07-04T12:02:20.000Z"),
    });

    assert.equal(directDescription.diagnostics.outcome, "tool_executed_after_final_screen_refresh", transcript);
    assert.equal(directDescription.diagnostics.executedToolName, "android_read_screen_context", transcript);
    assert.match(directDescription.canonicalResponse, /Fresh inbox screen is visible/, transcript);
  }

  for (const transcript of ["Tell me about this song", "Describe that issue"]) {
    const unrelatedFollowUp = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "final", text: "This is unrelated to the screen." },
      ]),
      workingContext: first.workingContext,
      now: new Date("2026-07-04T12:02:30.000Z"),
    });

    assert.equal(unrelatedFollowUp.diagnostics.outcome, "final", transcript);
    assert.equal(unrelatedFollowUp.canonicalResponse, "This is unrelated to the screen.", transcript);
    assert.doesNotMatch(unrelatedFollowUp.canonicalResponse, /OCR fallback sees YouTube|Temporary screen capture/i, transcript);
  }

  console.log("OK: expanded 'what is on my screen' follow-ups use active screen context");
}

async function testBareTheScreenReadUsesFreshScreenContext() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read the screen",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot read the screen." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_final_screen_refresh");
  assert.equal(result.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(result.androidExecutions.map((execution) => execution.toolName), ["android_read_screen_context"]);
  assert.match(result.canonicalResponse, /Fresh inbox screen is visible/);
  console.log("OK: bare 'the screen' read requests use fresh screen context");
}

async function testExplicitScreenToolCallsRefreshStaleWorkingContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [accessibilityScreenEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const refreshed = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen now?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(refreshed.diagnostics.outcome, "tool_call_executed");
  assert.equal(refreshed.diagnostics.executedToolName, "android_read_screen_context");
  assert.equal(refreshed.androidExecutions[0]?.toolName, "android_read_screen_context");
  assert.match(refreshed.canonicalResponse, /Fresh inbox screen is visible/);
  assert.doesNotMatch(refreshed.canonicalResponse, /Search results are visible/);
  assert.equal(refreshed.workingContext.screen?.activeApp, "Gmail");
  console.log("OK: explicit screen tool calls refresh stale working context");
}

async function testScreenToolCallsUseCachedWorkingContextWithoutFreshScreenEvents() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const followUp = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(followUp.diagnostics.outcome, "screen_capture_context_summary");
  assert.equal(followUp.androidExecutions.length, 0);
  assert.match(followUp.canonicalResponse, /OCR fallback sees YouTube search results/);
  console.log("OK: screen tool calls use cached working context without fresh screen events");
}

async function testFinalScreenAnswersUseFreshEventsOverStaleContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [accessibilityScreenEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const refreshed = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot see your current screen." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(refreshed.diagnostics.outcome, "tool_executed_after_final_screen_refresh");
  assert.equal(refreshed.diagnostics.executedToolName, "android_read_screen_context");
  assert.match(refreshed.canonicalResponse, /Fresh inbox screen is visible/);
  assert.doesNotMatch(refreshed.canonicalResponse, /Search results are visible/);
  assert.equal(refreshed.workingContext.screen?.activeApp, "Gmail");
  console.log("OK: final screen answers use fresh events over stale context");
}

async function testScreenReadsIgnoreNegatedSaveDeleteAsides() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen but don't save the screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot see your current screen." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_final_screen_refresh");
  assert.equal(result.diagnostics.executedToolName, "android_read_screen_context");
  assert.match(result.canonicalResponse, /Fresh inbox screen is visible/);

  const negatedRead = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't read my screen",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I will not read it." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    now: new Date("2026-07-04T12:01:30.000Z"),
  });

  assert.equal(negatedRead.diagnostics.outcome, "tool_recovery_blocked");

  const directNegatedRead = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't read my screen",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    now: new Date("2026-07-04T12:01:45.000Z"),
  });

  assert.equal(directNegatedRead.diagnostics.outcome, "tool_call_executed");
  assert.equal(directNegatedRead.diagnostics.executedToolName, "android_read_screen_context");
  assert.equal(directNegatedRead.androidExecutions.length, 0);
  assert.doesNotMatch(directNegatedRead.canonicalResponse, /Fresh inbox screen is visible/);

  const directNegatedReadWithLaterApp = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't read my screen, then open the app",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    now: new Date("2026-07-04T12:01:50.000Z"),
  });

  assert.equal(directNegatedReadWithLaterApp.diagnostics.outcome, "tool_call_executed");
  assert.equal(directNegatedReadWithLaterApp.androidExecutions.length, 0);
  assert.doesNotMatch(directNegatedReadWithLaterApp.canonicalResponse, /Fresh inbox screen is visible/);

  const negatedCaptureOnly = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't take a screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I will not capture it." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(negatedCaptureOnly.diagnostics.outcome, "tool_recovery_blocked");
  assert.equal(negatedCaptureOnly.androidExecutions.length, 0);

  const directNegatedCaptureRead = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't take a screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [freshAccessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:02:15.000Z"),
  });

  assert.equal(directNegatedCaptureRead.diagnostics.outcome, "tool_call_executed");
  assert.equal(directNegatedCaptureRead.diagnostics.executedToolName, "android_read_screen_context");
  assert.equal(directNegatedCaptureRead.androidExecutions.length, 0);
  assert.doesNotMatch(directNegatedCaptureRead.canonicalResponse, /Fresh inbox screen is visible/);

  const directNegatedCaptureOnly = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't capture my screen",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_capture_screen", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:02:30.000Z"),
  });

  assert.equal(directNegatedCaptureOnly.diagnostics.outcome, "tool_call_executed");
  assert.equal(directNegatedCaptureOnly.diagnostics.executedToolName, "android_read_screen_context");
  assert.equal(directNegatedCaptureOnly.androidExecutions.length, 0);
  assert.doesNotMatch(directNegatedCaptureOnly.canonicalResponse, /Temporary screen capture/i);
  console.log("OK: screen reads ignore negated save/delete asides");
}

async function testScreenReadsWithCaptureContextIgnoreNegatedSaveDeleteAsides() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const followUp = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my screen, but don't save the screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot see your screen." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(followUp.diagnostics.outcome, "screen_capture_context_summary");
  assert.match(followUp.canonicalResponse, /OCR fallback sees YouTube search results/);
  assert.doesNotMatch(followUp.canonicalResponse, /I have not completed/);
  console.log("OK: screen reads with capture context ignore negated save/delete asides");
}

async function testScreenReadsRespectNegatedScreenshotCaptureRequests() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen, but don't take a screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot see your current screen." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_final_screen_refresh");
  assert.equal(result.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(result.androidExecutions.map((execution) => execution.toolName), ["android_read_screen_context"]);
  assert.match(result.canonicalResponse, /Fresh inbox screen is visible/);
  assert.equal(result.workingContext.screen?.source, "accessibility");

  const captureDeniedReadAllowed = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't take a screenshot, just read my screen",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I cannot read the screen." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:01:15.000Z"),
  });

  assert.equal(captureDeniedReadAllowed.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(captureDeniedReadAllowed.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(captureDeniedReadAllowed.androidExecutions.map((execution) => execution.toolName), ["android_read_screen_context"]);
  assert.match(captureDeniedReadAllowed.canonicalResponse, /Fresh inbox screen is visible/);
  assert.doesNotMatch(captureDeniedReadAllowed.canonicalResponse, /Temporary screen capture/i);

  const bareCaptureDeniedReadAllowed = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't screenshot, what's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I cannot read the screen." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:01:20.000Z"),
  });

  assert.equal(bareCaptureDeniedReadAllowed.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(bareCaptureDeniedReadAllowed.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(bareCaptureDeniedReadAllowed.androidExecutions.map((execution) => execution.toolName), ["android_read_screen_context"]);
  assert.match(bareCaptureDeniedReadAllowed.canonicalResponse, /Fresh inbox screen is visible/);
  assert.doesNotMatch(bareCaptureDeniedReadAllowed.canonicalResponse, /Temporary screen capture/i);

  const noAccessibility = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen, but don't take a screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:01:30.000Z"),
  });

  assert.equal(noAccessibility.diagnostics.outcome, "tool_call_executed");
  assert.equal(noAccessibility.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(noAccessibility.androidExecutions.map((execution) => execution.toolName), ["android_read_screen_context"]);
  assert.doesNotMatch(noAccessibility.canonicalResponse, /Temporary screen capture/i);

  const directCapture = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen, but don't take a screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_capture_screen", arguments: {} },
    ]),
    androidEvents: [freshAccessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:01:45.000Z"),
  });

  assert.equal(directCapture.diagnostics.outcome, "tool_call_executed");
  assert.equal(directCapture.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(directCapture.androidExecutions.map((execution) => execution.toolName), ["android_read_screen_context"]);
  assert.match(directCapture.canonicalResponse, /Fresh inbox screen is visible/);
  assert.doesNotMatch(directCapture.canonicalResponse, /Temporary screen capture/i);

  const pronounCaptureNegation = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my screen, but don't capture it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot read the screen." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:01:50.000Z"),
  });

  assert.equal(pronounCaptureNegation.diagnostics.outcome, "tool_executed_after_final_screen_refresh");
  assert.equal(pronounCaptureNegation.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(pronounCaptureNegation.androidExecutions.map((execution) => execution.toolName), ["android_read_screen_context"]);
  assert.match(pronounCaptureNegation.canonicalResponse, /Fresh inbox screen is visible/);
  assert.doesNotMatch(pronounCaptureNegation.canonicalResponse, /Temporary screen capture/i);

  const pronounCaptureNegationWithoutAccessibility = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my screen, but don't capture it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:01:55.000Z"),
  });

  assert.equal(pronounCaptureNegationWithoutAccessibility.diagnostics.outcome, "tool_call_executed");
  assert.equal(pronounCaptureNegationWithoutAccessibility.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(
    pronounCaptureNegationWithoutAccessibility.androidExecutions.map((execution) => execution.toolName),
    ["android_read_screen_context"],
  );
  assert.doesNotMatch(pronounCaptureNegationWithoutAccessibility.canonicalResponse, /Temporary screen capture/i);
  console.log("OK: screen reads respect negated screenshot capture requests");
}

async function testScreenCaptureRequestsRespectLatestIntent() {
  const cancelled = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Take a screenshot, but don't take a screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(cancelled.diagnostics.outcome, "tool_call_executed");
  assert.equal(cancelled.diagnostics.executedToolName, "android_read_screen_context");
  assert.equal(cancelled.androidExecutions.length, 0);
  assert.doesNotMatch(cancelled.canonicalResponse, /Temporary screen capture/i);

  const pronounCancelled = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Take a screenshot, but don't take it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I cannot take screenshots." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:02:15.000Z"),
  });

  assert.equal(pronounCancelled.diagnostics.outcome, "tool_recovery_blocked");
  assert.equal(pronounCancelled.androidExecutions.length, 0);
  assert.doesNotMatch(pronounCancelled.canonicalResponse, /Fresh inbox screen|Temporary screen capture/i);

  const reRequested = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't take a screenshot, actually take a screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:02:30.000Z"),
  });

  assert.equal(reRequested.diagnostics.outcome, "tool_call_executed");
  assert.equal(reRequested.diagnostics.executedToolName, "android_capture_screen");
  assert.deepEqual(reRequested.androidExecutions.map((execution) => execution.toolName), ["android_capture_screen"]);
  assert.match(reRequested.canonicalResponse, /Temporary screen capture/i);
  console.log("OK: screen capture requests respect the latest capture intent");
}

async function testExplicitScreenshotRequestsCreateTemporaryCaptureWhenAccessibilityWorks() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Take a screen shot of my phone",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I cannot take screenshots." },
    ]),
    androidEvents: [accessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_capture_screen");
  assert.deepEqual(result.androidExecutions.map((execution) => execution.toolName), ["android_capture_screen"]);
  assert.match(result.canonicalResponse, /Temporary screen capture/i);
  assert.equal(result.workingContext.screen?.source, "temporary_capture");
  assert.equal(result.workingContext.screen?.capture?.id, "capture-yt-1");

  const mixedReadAndCapture = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What is on my screen and take a screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I cannot take screenshots." },
    ]),
    androidEvents: [accessibilityScreenEvent, temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:15.000Z"),
  });

  assert.equal(mixedReadAndCapture.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(mixedReadAndCapture.diagnostics.executedToolName, "android_capture_screen");
  assert.deepEqual(mixedReadAndCapture.androidExecutions.map((execution) => execution.toolName), ["android_capture_screen"]);
  assert.match(mixedReadAndCapture.canonicalResponse, /Temporary screen capture/i);
  assert.equal(mixedReadAndCapture.workingContext.screen?.source, "temporary_capture");

  for (const transcript of ["Screenshot this", "Send a screenshot", "Screenshot please", "Can you screenshot?"]) {
    const imperative = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "tool_call", name: "android_capture_screen", arguments: {} },
      ]),
      androidEvents: [accessibilityScreenEvent, temporaryCaptureEvent],
      now: new Date("2026-07-04T12:00:30.000Z"),
    });

    assert.equal(imperative.diagnostics.outcome, "tool_call_executed", transcript);
    assert.equal(imperative.diagnostics.executedToolName, "android_capture_screen", transcript);
    assert.deepEqual(imperative.androidExecutions.map((execution) => execution.toolName), ["android_capture_screen"], transcript);
    assert.match(imperative.canonicalResponse, /Temporary screen capture/i, transcript);
    assert.equal(imperative.workingContext.screen?.source, "temporary_capture", transcript);
    assert.equal(imperative.workingContext.screen?.capture?.id, "capture-yt-1", transcript);
  }

  const captureWithoutReadback = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Take a screenshot, but don't read my screen",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_capture_screen", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:45.000Z"),
  });

  assert.equal(captureWithoutReadback.diagnostics.outcome, "tool_call_executed");
  assert.equal(captureWithoutReadback.diagnostics.executedToolName, "android_capture_screen");
  assert.deepEqual(captureWithoutReadback.androidExecutions.map((execution) => execution.toolName), ["android_capture_screen"]);
  assert.match(captureWithoutReadback.canonicalResponse, /Temporary screen capture attached/i);
  assert.doesNotMatch(captureWithoutReadback.canonicalResponse, /Here is what is on your screen|OCR fallback sees YouTube/i);
  assert.equal(captureWithoutReadback.workingContext.screen?.capture?.id, "capture-yt-1");
  assert.equal(captureWithoutReadback.workingContext.screen?.text, undefined);
  assert.deepEqual(captureWithoutReadback.workingContext.screen?.elements, []);

  console.log("OK: explicit screenshot requests create temporary captures even when accessibility works");
}

async function testScreenFalseDenialsUseCachedWorkingContextWithoutFreshScreenEvents() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const followUp = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What is on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I can't see your screen." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(followUp.diagnostics.outcome, "screen_capture_context_summary");
  assert.equal(followUp.androidExecutions.length, 0);
  assert.match(followUp.canonicalResponse, /OCR fallback sees YouTube search results/);
  console.log("OK: screen false denials use cached working context without fresh screen events");
}

async function testCurrentScreenRequestsForceFreshReadOverCachedContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const followUp = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen now?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot see your current screen." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(followUp.diagnostics.outcome, "tool_executed_after_final_screen_refresh");
  assert.equal(followUp.diagnostics.executedToolName, "android_read_screen_context");
  assert.deepEqual(followUp.androidExecutions.map((execution) => execution.toolName), [
    "android_read_screen_context",
    "android_capture_screen",
  ]);
  assert.match(followUp.canonicalResponse, /No screen context available/);
  assert.doesNotMatch(followUp.canonicalResponse, /OCR fallback sees YouTube search results/);
  assert.equal(followUp.workingContext.screen, undefined);
  console.log("OK: current screen requests force fresh reads instead of cached context");
}

async function testScreenFalseDenialsUseFreshCaptureFallbackOverStaleContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [accessibilityScreenEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const followUp = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What is on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I can't see your screen." },
    ]),
    androidEvents: [temporaryCaptureEvent],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(followUp.diagnostics.outcome, "tool_executed_after_false_denial_capture_fallback");
  assert.deepEqual(followUp.androidExecutions.map((execution) => execution.toolName), [
    "android_read_screen_context",
    "android_capture_screen",
  ]);
  assert.match(followUp.canonicalResponse, /Temporary screen capture/i);
  assert.doesNotMatch(followUp.canonicalResponse, /Search results are visible/);
  assert.equal(followUp.workingContext.screen?.source, "temporary_capture");
  console.log("OK: screen false denials use fresh capture fallback over stale context");
}

async function testTemporaryCaptureFollowUpsCanDeclineSaveCopyAndDelete() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const saveAttempt = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Save that screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot save screenshots." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(saveAttempt.diagnostics.outcome, "screen_capture_save_unavailable");
  assert.match(saveAttempt.canonicalResponse, /can't save temporary screen captures to Gallery yet/i);
  assert.equal(saveAttempt.workingContext.screen?.capture?.savedToGallery, false);
  assert.equal(saveAttempt.androidExecutions.length, 0);

  const copied = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Copy details for that screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot copy details." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:30.000Z"),
  });

  assert.equal(copied.diagnostics.outcome, "screen_capture_details_copied");
  assert.match(copied.canonicalResponse, /copied the screen capture details/i);
  assert.equal(copied.diagnostics.copiedDetails?.capture?.path, "/tmp/jarvis-captures/capture-yt-1.png");
  assert.equal("imageBase64" in (copied.diagnostics.copiedDetails?.capture ?? {}), false);

  const deleted = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Delete that screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot delete screenshots." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(deleted.diagnostics.outcome, "screen_capture_deleted");
  assert.match(deleted.canonicalResponse, /deleted that temporary screen capture/i);
  assert.equal(deleted.workingContext.screen, undefined);
  console.log("OK: temporary capture follow-ups decline save, copy details, and delete without raw image bytes");
}

async function testPronounTemporaryCaptureFollowUpsUseActiveCapture() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const saveAttempt = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Save it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot save that." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(saveAttempt.diagnostics.outcome, "screen_capture_save_unavailable");
  assert.equal(saveAttempt.workingContext.screen?.capture?.savedToGallery, false);

  const copied = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Copy details for it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot copy that." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:30.000Z"),
  });

  assert.equal(copied.diagnostics.outcome, "screen_capture_details_copied");
  assert.equal(copied.diagnostics.copiedDetails?.capture?.id, "capture-yt-1");

  const deleted = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Delete that",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot delete that." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(deleted.diagnostics.outcome, "screen_capture_deleted");
  assert.equal(deleted.workingContext.screen, undefined);
  console.log("OK: pronoun temporary capture follow-ups use the active capture");
}

async function testDestinationQualifiedTemporaryCaptureFollowUpsUseActiveCapture() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const saveAttempt = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Save it to Gallery",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I saved it." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(saveAttempt.diagnostics.outcome, "screen_capture_save_unavailable");
  assert.equal(saveAttempt.androidExecutions.length, 0);
  assert.match(saveAttempt.canonicalResponse, /can't save temporary screen captures to Gallery yet/i);

  const copied = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Copy details to clipboard",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I copied it." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:30.000Z"),
  });

  assert.equal(copied.diagnostics.outcome, "screen_capture_details_copied");
  assert.equal(copied.diagnostics.copiedDetails?.capture?.id, "capture-yt-1");

  const copiedWithUnrelatedNegation = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Copy details for that screenshot but don't delete it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I could not copy it." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:45.000Z"),
  });

  assert.equal(copiedWithUnrelatedNegation.diagnostics.outcome, "screen_capture_details_copied");
  assert.equal(copiedWithUnrelatedNegation.workingContext.screen?.capture?.id, "capture-yt-1");

  const deleted = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Delete it from chat",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I deleted it." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(deleted.diagnostics.outcome, "screen_capture_deleted");
  assert.equal(deleted.workingContext.screen, undefined);
  console.log("OK: destination-qualified temporary capture follow-ups use the active capture");
}

async function testCapturePreviewActionsWinOverFreshScreenRefresh() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const deleted = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Delete that screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(deleted.diagnostics.outcome, "screen_capture_deleted");
  assert.equal(deleted.androidExecutions.length, 0);
  assert.equal(deleted.workingContext.screen, undefined);
  console.log("OK: capture preview actions win over fresh screen refresh");
}

async function testTargetlessTemporaryCapturePreviewActionsUseActiveCapture() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const saveAttempt = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Save",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot save that." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(saveAttempt.diagnostics.outcome, "screen_capture_save_unavailable");
  assert.equal(saveAttempt.workingContext.screen?.capture?.savedToGallery, false);

  for (const transcript of [
    "Save time by answering quickly",
    "Save that YouTube video",
    "Delete that file",
    "Copy that YouTube video",
    "Copy details for the invoice",
  ]) {
    const unrelated = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "final", text: "I'll keep it brief." },
      ]),
      workingContext: first.workingContext,
      now: new Date("2026-07-04T12:01:30.000Z"),
    });

    assert.equal(unrelated.diagnostics.outcome, "final");
    assert.equal(unrelated.canonicalResponse, "I'll keep it brief.");
  }

  const deleted = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Delete",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot delete that." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(deleted.diagnostics.outcome, "screen_capture_deleted");
  assert.equal(deleted.workingContext.screen, undefined);
  console.log("OK: targetless temporary capture preview actions use the active capture");
}

async function testTemporaryCaptureSaveIsUnavailableWithoutGalleryTool() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const saveAttempt = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Save that screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I saved it." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(saveAttempt.diagnostics.outcome, "screen_capture_save_unavailable");
  assert.equal(saveAttempt.androidExecutions.length, 0);
  assert.equal(saveAttempt.workingContext.screen?.capture?.savedToGallery, false);
  assert.match(saveAttempt.canonicalResponse, /can't save temporary screen captures to Gallery yet/i);
  console.log("OK: temporary capture save is unavailable until a real Gallery-save tool exists");
}

async function testNegatedTemporaryCaptureFollowUpsAreBlocked() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const cases = [
    {
      transcript: "Don't save that screenshot",
      modelText: "I saved it.",
    },
    {
      transcript: "Do not copy details for that screenshot",
      modelText: "I copied the details.",
    },
    {
      transcript: "Please don't delete that screenshot",
      modelText: "I deleted it.",
    },
    {
      transcript: "Copy details for that screenshot but don't copy it",
      modelText: "I copied the details.",
    },
  ];

  for (const testCase of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: testCase.transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "final", text: testCase.modelText },
      ]),
      workingContext: first.workingContext,
      now: new Date("2026-07-04T12:01:00.000Z"),
    });

    assert.equal(result.diagnostics.outcome, "screen_capture_action_blocked", testCase.transcript);
    assert.equal(result.workingContext.screen?.capture?.savedToGallery, false, testCase.transcript);
    assert.equal(result.workingContext.screen?.capture?.path, "/tmp/jarvis-captures/capture-yt-1.png", testCase.transcript);
    assert.equal(result.diagnostics.copiedDetails, undefined, testCase.transcript);
    assert.match(result.canonicalResponse, /not completed/i, testCase.transcript);
  }

  const unrelatedOpen = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't delete that screenshot, open YouTube",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_open_app_by_name", arguments: { appName: "YouTube" } },
    ]),
    androidEvents: [{ type: "app_control", appName: "YouTube", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:30.000Z"),
  });

  assert.equal(unrelatedOpen.diagnostics.outcome, "tool_call_executed");
  assert.equal(unrelatedOpen.diagnostics.executedToolName, "android_open_app_by_name");
  assert.deepEqual(unrelatedOpen.androidExecutions.map((execution) => execution.toolName), ["android_open_app_by_name"]);
  assert.match(unrelatedOpen.canonicalResponse, /Opened YouTube/i);
  assert.equal(unrelatedOpen.workingContext.screen?.capture?.path, "/tmp/jarvis-captures/capture-yt-1.png");

  const unrelatedClipboard = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't delete that screenshot, copy hello to clipboard",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_copy_to_clipboard", arguments: { text: "hello" } },
    ]),
    androidEvents: [{ type: "clipboard", text: "hello" }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:45.000Z"),
  });

  assert.equal(unrelatedClipboard.diagnostics.outcome, "tool_call_executed");
  assert.equal(unrelatedClipboard.diagnostics.executedToolName, "android_copy_to_clipboard");
  assert.deepEqual(unrelatedClipboard.androidExecutions.map((execution) => execution.toolName), ["android_copy_to_clipboard"]);
  assert.match(unrelatedClipboard.canonicalResponse, /clipboard/i);
  assert.equal(unrelatedClipboard.workingContext.screen?.capture?.path, "/tmp/jarvis-captures/capture-yt-1.png");

  const pendingClipboardTool = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't delete that screenshot, copy hello",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_copy_to_clipboard", arguments: { text: "hello" } },
    ]),
    androidEvents: [{ type: "clipboard", text: "hello" }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:50.000Z"),
  });

  assert.equal(pendingClipboardTool.diagnostics.outcome, "tool_call_executed");
  assert.equal(pendingClipboardTool.diagnostics.executedToolName, "android_copy_to_clipboard");
  assert.deepEqual(pendingClipboardTool.androidExecutions.map((execution) => execution.toolName), ["android_copy_to_clipboard"]);
  assert.match(pendingClipboardTool.canonicalResponse, /clipboard/i);
  assert.equal(pendingClipboardTool.workingContext.screen?.capture?.path, "/tmp/jarvis-captures/capture-yt-1.png");

  console.log("OK: negated temporary capture follow-ups do not save, copy, or delete");
}

async function testNegatedScreenReadsDoNotUseCachedWorkingContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const gemma = new ScriptedFakeLocalGemmaProvider([
    { type: "final", text: "Okay, I won't read it." },
  ]);

  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't read my screen",
    gemma,
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "final");
  assert.equal(result.canonicalResponse, "Okay, I won't read it.");
  assert.doesNotMatch(result.canonicalResponse, /Temporary screen capture/i);
  assert.doesNotMatch(result.canonicalResponse, /OCR fallback sees YouTube/i);
  assert.doesNotMatch(gemma.prompts[0]?.contextPacket ?? "", /Recent screen|OCR fallback sees YouTube|Temporary capture/i);

  const directBlockedRead = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't read my screen",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:30.000Z"),
  });

  assert.equal(directBlockedRead.diagnostics.outcome, "tool_call_executed");
  assert.equal(directBlockedRead.androidExecutions.length, 0);
  assert.equal(directBlockedRead.workingContext.screen?.capture?.id, "capture-yt-1");
  assert.doesNotMatch(directBlockedRead.canonicalResponse, /OCR fallback sees YouTube/i);

  const readDeniedBeforeSaveAsideGemma = new ScriptedFakeLocalGemmaProvider([
    { type: "final", text: "I won't read it." },
  ]);
  const readDeniedBeforeSaveAside = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't read my screen and don't save the screenshot",
    gemma: readDeniedBeforeSaveAsideGemma,
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:45.000Z"),
  });

  assert.equal(readDeniedBeforeSaveAside.diagnostics.outcome, "screen_capture_action_blocked");
  assert.equal(readDeniedBeforeSaveAside.canonicalResponse, "I have not completed that phone action yet.");
  assert.doesNotMatch(readDeniedBeforeSaveAside.canonicalResponse, /OCR fallback sees YouTube/i);
  assert.doesNotMatch(readDeniedBeforeSaveAsideGemma.prompts[0]?.contextPacket ?? "", /Recent screen|Temporary capture/i);
  console.log("OK: negated screen reads do not use cached working context");
}

async function testNegatedAppUiScreenRequestsDoNotReadScreen() {
  const falseDenial = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't show what is the title in the app",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "screen", text: "I won't read that." },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(falseDenial.diagnostics.outcome, "tool_recovery_blocked");
  assert.equal(falseDenial.androidExecutions.length, 0);
  assert.doesNotMatch(falseDenial.canonicalResponse, /Fresh inbox screen is visible/);

  const directRead = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't show what is the title in the UI",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [freshAccessibilityScreenEvent],
    now: new Date("2026-07-04T12:01:30.000Z"),
  });

  assert.equal(directRead.diagnostics.outcome, "tool_call_executed");
  assert.equal(directRead.androidExecutions.length, 0);
  assert.doesNotMatch(directRead.canonicalResponse, /Fresh inbox screen is visible/);

  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const gemma = new ScriptedFakeLocalGemmaProvider([
    { type: "final", text: "I won't inspect the app." },
  ]);

  const cached = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't show what is the title in the app",
    gemma,
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:45.000Z"),
  });

  assert.equal(cached.diagnostics.outcome, "final");
  assert.equal(cached.canonicalResponse, "I won't inspect the app.");
  assert.doesNotMatch(cached.canonicalResponse, /OCR fallback sees YouTube/i);
  assert.doesNotMatch(gemma.prompts[0]?.contextPacket ?? "", /Recent screen|OCR fallback sees YouTube|Temporary capture/i);
  console.log("OK: negated app/UI screen requests do not read fresh or cached screen context");
}

async function testNegatedBareCaptureReadsDoNotUseCachedWorkingContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const gemma = new ScriptedFakeLocalGemmaProvider([
    { type: "final", text: "I won't describe it." },
  ]);

  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't describe this capture",
    gemma,
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(result.diagnostics.outcome, "final");
  assert.equal(result.canonicalResponse, "I won't describe it.");
  assert.doesNotMatch(result.canonicalResponse, /OCR fallback sees YouTube search results/);
  assert.doesNotMatch(gemma.prompts[0]?.contextPacket ?? "", /Recent screen|OCR fallback sees YouTube|Temporary capture/i);
  console.log("OK: negated bare capture reads do not use cached working context");
}

async function testTemporaryCaptureExpiresAfterWorkingContextTtl() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const expired = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Save that screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I do not have a current screenshot to save." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:10:00.000Z"),
  });

  assert.equal(expired.diagnostics.outcome, "final");
  assert.equal(expired.workingContext.screen, undefined);
  assert.match(expired.canonicalResponse, /do not have a current screenshot/i);
  console.log("OK: temporary captures expire from working context after the short TTL");
}

async function testSaveUnavailableTemporaryCaptureDoesNotBypassWorkingContextTtl() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const saveAttempt = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Save that screenshot",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot save screenshots." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  const stale = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I need a fresh screen read." },
    ]),
    workingContext: saveAttempt.workingContext,
    now: new Date("2026-07-04T12:10:00.000Z"),
  });

  assert.equal(stale.diagnostics.outcome, "final");
  assert.equal(stale.workingContext.screen, undefined);
  assert.equal(stale.canonicalResponse, "I need a fresh screen read.");
  console.log("OK: save-unavailable temporary captures do not keep stale screen context alive past the TTL");
}

async function testScreenshotMetaQuestionsDoNotUseScreenWorkingContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  for (const transcript of [
    "What is a screenshot?",
    "Tell me about screen capture",
    "How do I read my screen with TalkBack?",
    "Describe screen readers",
    "Where is Paris?",
    "What is the title of Hamlet?",
    "What's in it for me?",
  ]) {
    const meta = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "final", text: "This is a model answer, not screen context." },
      ]),
      workingContext: first.workingContext,
      now: new Date("2026-07-04T12:01:00.000Z"),
    });

    assert.equal(meta.diagnostics.outcome, "final", transcript);
    assert.equal(meta.canonicalResponse, "This is a model answer, not screen context.", transcript);
    assert.doesNotMatch(meta.canonicalResponse, /OCR fallback|Temporary screen capture/i, transcript);
  }

  for (const transcript of ["How do I take a screenshot?", "Can you show me how to take a screenshot?"]) {
    const howTo = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "final", text: "Use your phone's screenshot shortcut." },
      ]),
      androidEvents: [temporaryCaptureEvent],
      workingContext: first.workingContext,
      now: new Date("2026-07-04T12:01:30.000Z"),
    });

    assert.equal(howTo.diagnostics.outcome, "final", transcript);
    assert.equal(howTo.canonicalResponse, "Use your phone's screenshot shortcut.", transcript);
    assert.equal(howTo.androidExecutions.length, 0, transcript);
    assert.doesNotMatch(howTo.canonicalResponse, /Temporary screen capture|OCR fallback/i, transcript);
  }

  console.log("OK: screenshot meta questions do not leak active screen working context");
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

async function testSingleNotificationPronounReferencesUseWorkingContext() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: [{
      type: "notification",
      notifications: [
        { app: "Calendar", title: "Team sync", text: "Starts in 5 minutes" },
      ],
    }],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const read = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot read that." },
    ]),
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(read.diagnostics.outcome, "notification_reference_read");
  assert.match(read.canonicalResponse, /Calendar: Team sync/);

  const screen = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_screen_context", arguments: {} },
    ]),
    androidEvents: [temporaryCaptureEvent],
    now: new Date("2026-07-04T12:01:30.000Z"),
  });

  const mixedRead = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot read that." },
    ]),
    workingContext: {
      ...first.workingContext,
      ...screen.workingContext,
    },
    now: new Date("2026-07-04T12:01:45.000Z"),
  });

  assert.equal(mixedRead.diagnostics.outcome, "notification_reference_read");
  assert.match(mixedRead.canonicalResponse, /Calendar: Team sync/);
  assert.doesNotMatch(mixedRead.canonicalResponse, /OCR fallback sees YouTube/i);

  const explicitScreenMixedTurn = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open the Calendar one and what's on my screen?",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot do both." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Calendar", action: "open", success: true }],
    workingContext: {
      ...first.workingContext,
      ...screen.workingContext,
    },
    now: new Date("2026-07-04T12:01:50.000Z"),
  });

  assert.equal(explicitScreenMixedTurn.diagnostics.outcome, "screen_capture_context_summary");
  assert.equal(explicitScreenMixedTurn.androidExecutions.length, 0);
  assert.match(explicitScreenMixedTurn.canonicalResponse, /OCR fallback sees YouTube/);
  assert.doesNotMatch(explicitScreenMixedTurn.canonicalResponse, /opened Calendar/i);

  const open = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open that",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot open that." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Calendar", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:02:00.000Z"),
  });

  assert.equal(open.diagnostics.outcome, "notification_reference_opened");
  assert.match(open.canonicalResponse, /opened Calendar/i);
  console.log("OK: single-notification pronoun references use stored working context");
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

async function testNotificationWorkingContextIsNotInjectedIntoMetaQuestions() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: notificationEvents,
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  for (const transcript of [
    "What are notifications?",
    "Summarize how Android notifications work",
    "What are my current notifications?",
    "Read all my notifications",
  ]) {
    const gemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "I can explain notifications generally." }]);
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma,
      workingContext: first.workingContext,
      now: new Date("2026-07-04T12:01:00.000Z"),
    });

    assert.equal(result.diagnostics.outcome, "final");
    assert.doesNotMatch(gemma.prompts[0].contextPacket, /Recent notifications/);
    assert.doesNotMatch(result.canonicalResponse, /Codex|Reddit|Life360/);
  }
  console.log("OK: notification working context is not injected into meta or current-state questions");
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

async function testMessagesAppOpenDoesNotUseNotificationMessageReference() {
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: [{
      type: "notification",
      notifications: [
        { app: "Gmail", title: "New messages", text: "Unread social messages are waiting" },
      ],
    }],
    now: new Date("2026-07-04T12:00:00.000Z"),
  });

  const open = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open Messages",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot open apps." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Messages", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:01:00.000Z"),
  });

  assert.equal(open.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(open.androidExecutions[0]?.label, "Opened Messages");
  assert.doesNotMatch(open.canonicalResponse, /Gmail/i);
  console.log("OK: Messages app opens do not use notification message references");
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
  const pronounTrapNotificationEvents: LocalVoiceAndroidEvent[] = [{
    type: "notification",
    notifications: [
      { app: "Reddit", title: "vivecoding thread is trending", text: "New replies in r/vivecoding" },
      { app: "Gmail", title: "Kit update", text: "It shipped this morning" },
    ],
  }];
  const first = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read my notifications",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_read_notifications", arguments: {} },
    ]),
    androidEvents: pronounTrapNotificationEvents,
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

  const readStillRuns = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Read the Reddit one, but don't open it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "final", text: "I cannot access your notifications." },
    ]),
    androidEvents: [{ type: "app_control", appName: "Reddit", action: "open", success: true }],
    workingContext: first.workingContext,
    now: new Date("2026-07-04T12:04:45.000Z"),
  });

  assert.equal(readStillRuns.diagnostics.outcome, "notification_reference_read");
  assert.equal(readStillRuns.androidExecutions.length, 0);
  assert.match(readStillRuns.canonicalResponse, /Reddit: vivecoding thread is trending/);
  assert.doesNotMatch(readStillRuns.canonicalResponse, /cannot access/i);
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

async function testYoutubeSearchExecutesDeterministically() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube and search for Alex Hormozi videos",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_youtube_search", arguments: { query: "Alex Hormozi videos" } },
    ]),
    androidEvents: [
      {
        type: "app_control",
        appName: "YouTube",
        action: "search",
        query: "Alex Hormozi videos",
        success: true,
        detail: "Search results are visible.",
      },
      { type: "screen", activeApp: "YouTube", title: "Alex Hormozi videos - YouTube", text: "Search results" },
    ],
  });

  assert.equal(result.diagnostics.outcome, "tool_call_executed");
  assert.equal(result.androidExecutions[0]?.toolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.ok, true);
  assert.match(result.canonicalResponse, /Searched YouTube for Alex Hormozi videos/);
  assert.match(result.canonicalResponse, /Search results are visible/);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: YouTube search voice requests execute through the deterministic phone runtime");
}

async function testYoutubeSearchAcceptsSnakeCaseSearchQueryArgument() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube and search for Alex Hormozi videos",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_youtube_search", arguments: { search_query: "Alex Hormozi videos" } },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "Alex Hormozi videos",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_call_executed");
  assert.equal(result.androidExecutions[0]?.toolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.ok, true);
  assert.match(result.canonicalResponse, /Searched YouTube for Alex Hormozi videos/);
  console.log("OK: YouTube search accepts the runtime search_query argument");
}

async function testYoutubeSearchFalseDenialRecoveryExecutes() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube and search for Alex Hormozi videos",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "Alex Hormozi videos",
      success: true,
      detail: "Search results are visible.",
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.ok, true);
  assert.match(result.canonicalResponse, /Searched YouTube for Alex Hormozi videos/);
  assert.doesNotMatch(result.canonicalResponse, /cannot/i);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: YouTube search false denials recover to the deterministic phone runtime");
}

async function testYoutubeSearchFalseDenialAcceptsYouTubeAliasesInFixtures() {
  const cases = [
    { transcript: "Search YT for cats", appName: "YT" },
    { transcript: "Search You Tube for cats", appName: "You Tube" },
  ];

  for (const { transcript, appName } of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
      ]),
      androidEvents: [{
        type: "app_control",
        appName,
        action: "search",
        query: "cats",
        success: true,
      }],
    });

    assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial", transcript);
    assert.equal(result.diagnostics.executedToolName, "android_youtube_search", transcript);
    assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats", transcript);
  }

  console.log("OK: YouTube search false-denial recovery accepts YouTube aliases in fixtures");
}

async function testYoutubeSearchRequiresMatchingQuery() {
  const missingArgs = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube and search for Alex Hormozi videos",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_youtube_search", arguments: {} },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "Alex Hormozi videos",
      success: true,
    }],
  });

  assert.equal(missingArgs.androidExecutions[0]?.ok, false);
  assert.match(missingArgs.canonicalResponse, /could not complete/i);

  const missingFixtureQuery = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube and search for Alex Hormozi videos",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_youtube_search", arguments: { query: "Alex Hormozi videos" } },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      success: true,
    }],
  });

  assert.equal(missingFixtureQuery.androidExecutions[0]?.ok, false);
  assert.match(missingFixtureQuery.canonicalResponse, /could not complete/i);
  console.log("OK: YouTube search confirmation requires the requested query on both sides");
}

async function testYoutubeSearchRejectsTruncatedTitleQueryMatch() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Search YouTube for Please Please Please",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "tool_call", name: "android_youtube_search", arguments: { query: "Please Please Please" } },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "Please Please",
      success: true,
    }],
  });

  assert.equal(result.androidExecutions[0]?.ok, false);
  assert.match(result.canonicalResponse, /could not complete/i);
  assert.doesNotMatch(result.canonicalResponse, /Searched YouTube for Please Please Please/i);
  console.log("OK: YouTube search confirmation rejects truncated title query matches");
}

async function testYoutubeSearchFalseDenialSkipsNegatedSearchClause() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't search YouTube for cats; open Chrome instead",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [
      { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
      { type: "app_control", appName: "Chrome", action: "open", success: true, detail: "Chrome is open." },
    ],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_open_app_by_name");
  assert.equal(result.androidExecutions[0]?.label, "Opened Chrome");
  assert.doesNotMatch(result.canonicalResponse, /Searched YouTube/i);
  console.log("OK: YouTube search false-denial recovery ignores negated search clauses");
}

async function testYoutubeSearchFalseDenialLaterAppCorrectionWins() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Search YouTube for cats but open Chrome instead",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [
      { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
      { type: "app_control", appName: "Chrome", action: "open", success: true, detail: "Chrome is open." },
    ],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_open_app_by_name");
  assert.equal(result.androidExecutions[0]?.label, "Opened Chrome");
  assert.doesNotMatch(result.canonicalResponse, /Searched YouTube/i);
  console.log("OK: YouTube search false-denial recovery lets later app corrections win");
}

async function testYoutubeSearchFalseDenialLaterSearchCorrectionWins() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open Chrome, but search YouTube for cats instead",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [
      { type: "app_control", appName: "Chrome", action: "open", success: true },
      { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
    ],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats");
  assert.match(result.canonicalResponse, /Searched YouTube for cats/i);
  console.log("OK: YouTube search false-denial recovery lets later search corrections win");
}

async function testYoutubeSearchFalseDenialLaterAndSearchCorrectionWins() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Don't search YouTube for cats and search YouTube for dogs",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [
      { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
      { type: "app_control", appName: "YouTube", action: "search", query: "dogs", success: true },
    ],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for dogs");
  assert.match(result.canonicalResponse, /Searched YouTube for dogs/i);
  assert.doesNotMatch(result.canonicalResponse, /cats/i);
  console.log("OK: YouTube search false-denial recovery lets later and-search corrections win");
}

async function testYoutubeSearchFalseDenialTargetlessCorrectionReusesPriorSearchContext() {
  const cases = [
    "Search YouTube for cats; search for dogs instead",
    "Search YouTube for cats and search for dogs instead",
  ];

  for (const transcript of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
      ]),
      androidEvents: [
        { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
        { type: "app_control", appName: "YouTube", action: "search", query: "dogs", success: true },
      ],
    });

    assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial", transcript);
    assert.equal(result.diagnostics.executedToolName, "android_youtube_search", transcript);
    assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for dogs", transcript);
    assert.match(result.canonicalResponse, /Searched YouTube for dogs/i, transcript);
    assert.doesNotMatch(result.canonicalResponse, /cats/i, transcript);
  }

  console.log("OK: YouTube search false-denial recovery reuses prior search context for targetless corrections");
}

async function testYoutubeSearchFalseDenialPreservesConjunctionsInQuery() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Search YouTube for Now and Then Beatles",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "Now and Then Beatles",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for Now and Then Beatles");
  assert.match(result.canonicalResponse, /Searched YouTube for Now and Then Beatles/i);
  console.log("OK: YouTube search false-denial recovery preserves conjunctions inside queries");
}

async function testYoutubeSearchFalseDenialPreservesPunctuationInQuery() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Search YouTube for Mr. Beast",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "Mr. Beast",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for Mr. Beast");
  assert.match(result.canonicalResponse, /Searched YouTube for Mr\. Beast/i);
  console.log("OK: YouTube search false-denial recovery preserves punctuation inside queries");
}

async function testYoutubeSearchFalseDenialAllowsInOnPhrasesInQuery() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Search YouTube for Linkin Park In The End",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "Linkin Park In The End",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for Linkin Park In The End");
  assert.match(result.canonicalResponse, /Searched YouTube for Linkin Park In The End/i);
  console.log("OK: YouTube search false-denial recovery allows in/on phrases inside queries");
}

async function testYoutubeSearchFalseDenialUsesPriorYouTubeContext() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube and then search for cats",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "cats",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats");
  assert.match(result.canonicalResponse, /Searched YouTube for cats/i);
  console.log("OK: YouTube search false-denial recovery uses prior YouTube context");
}

async function testYoutubeSearchFalseDenialHandlesPunctuatedSearchFollowUp() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube, and search for cats",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "cats",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats");
  assert.match(result.canonicalResponse, /Searched YouTube for cats/i);
  console.log("OK: YouTube search false-denial recovery handles punctuated search follow-ups");
}

async function testYoutubeSearchFalseDenialDoesNotReuseContextForDifferentTarget() {
  const cases = [
    "Open YouTube, then search Google for cats",
    "Open YouTube and search Google for cats",
    "Open YouTube and search in Chrome for cats",
    "Open YouTube and search for cats on Google",
    "Search YouTube for cats on Google",
  ];

  for (const transcript of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
      ]),
      androidEvents: [
        { type: "app_control", appName: "YouTube", action: "open", success: true },
        { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
      ],
    });

    assert.equal(result.diagnostics.outcome, "tool_recovery_blocked", transcript);
    assert.equal(result.androidExecutions.length, 0, transcript);
    assert.doesNotMatch(result.canonicalResponse, /Searched YouTube/i, transcript);
  }
  console.log("OK: YouTube search false-denial recovery does not reuse context for a different search target");
}

async function testAppControlFalseDenialBlocksPronounCancellations() {
  const cases = [
    {
      transcript: "Open YouTube and don't open it",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "open" as const, success: true },
      ],
    },
    {
      transcript: "Search YouTube for cats and don't search it",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "search" as const, query: "cats", success: true },
      ],
    },
  ];

  for (const { transcript, events } of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
      ]),
      androidEvents: events,
    });

    assert.equal(result.diagnostics.outcome, "tool_recovery_blocked", transcript);
    assert.equal(result.androidExecutions.length, 0, transcript);
    assert.match(result.canonicalResponse, /not completed/i, transcript);
  }

  console.log("OK: app-control false-denial recovery blocks pronoun cancellations");
}

async function testAppControlFalseDenialBlocksExplicitCancellations() {
  const cases = [
    {
      transcript: "Open YouTube, but don't open YouTube",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "open" as const, success: true },
      ],
    },
    {
      transcript: "Open YouTube, but could you not open YouTube?",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "open" as const, success: true },
      ],
    },
    {
      transcript: "Open YouTube, actually don't open YouTube",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "open" as const, success: true },
      ],
    },
    {
      transcript: "Search YouTube for cats but don't search YouTube for cats",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "search" as const, query: "cats", success: true },
      ],
    },
    {
      transcript: "Search YouTube for cats, but could you not search YouTube?",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "search" as const, query: "cats", success: true },
      ],
    },
    {
      transcript: "Search YouTube for cats but don't search YouTube",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "search" as const, query: "cats", success: true },
      ],
    },
    {
      transcript: "Search YouTube for cats and don't search for cats",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "search" as const, query: "cats", success: true },
      ],
    },
    {
      transcript: "Open YouTube and search for cats, but don't search for cats",
      events: [
        { type: "app_control" as const, appName: "YouTube", action: "search" as const, query: "cats", success: true },
      ],
    },
  ];

  for (const { transcript, events } of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
      ]),
      androidEvents: events,
    });

    assert.equal(result.diagnostics.outcome, "tool_recovery_blocked", transcript);
    assert.equal(result.androidExecutions.length, 0, transcript);
    assert.match(result.canonicalResponse, /not completed/i, transcript);
  }

  console.log("OK: app-control false-denial recovery blocks explicit cancellations");
}

async function testAppControlFalseDenialMatchesPronounCancellationAction() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube and don't search it",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [
      { type: "app_control", appName: "YouTube", action: "open", success: true, detail: "YouTube is open." },
      { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
    ],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_open_app_by_name");
  assert.equal(result.androidExecutions[0]?.label, "Opened YouTube");
  assert.doesNotMatch(result.canonicalResponse, /Searched YouTube/i);
  console.log("OK: app-control false-denial recovery matches pronoun cancellations to the same action");
}

async function testYoutubeSearchFalseDenialIgnoresNegatedUnrelatedFollowUp() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Search YouTube for cats but don't open Chrome",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [
      { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
      { type: "app_control", appName: "Chrome", action: "open", success: true },
    ],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats");
  assert.match(result.canonicalResponse, /Searched YouTube for cats/i);
  assert.doesNotMatch(result.canonicalResponse, /Chrome/i);
  console.log("OK: YouTube search false-denial recovery ignores negated unrelated follow-ups");
}

async function testYoutubeSearchFalseDenialIgnoresNegatedSearchFollowUps() {
  const cases = [
    "Search YouTube for cats and don't search Google for dogs",
    "Search YouTube for cats but don't search Google for dogs",
  ];

  for (const transcript of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
      ]),
      androidEvents: [
        { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
        { type: "app_control", appName: "Google", action: "search", query: "dogs", success: true },
      ],
    });

    assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial", transcript);
    assert.equal(result.diagnostics.executedToolName, "android_youtube_search", transcript);
    assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats", transcript);
    assert.doesNotMatch(result.canonicalResponse, /dogs/i, transcript);
  }

  console.log("OK: YouTube search false-denial recovery ignores negated search follow-ups");
}

async function testYoutubeSearchFalseDenialMatchesRequestedFixtureQuery() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Search YouTube for cats but don't search YouTube for dogs",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [
      { type: "app_control", appName: "YouTube", action: "search", query: "cats", success: true },
      { type: "app_control", appName: "YouTube", action: "search", query: "dogs", success: true },
    ],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats");
  assert.match(result.canonicalResponse, /Searched YouTube for cats/i);
  assert.doesNotMatch(result.canonicalResponse, /dogs/i);
  console.log("OK: YouTube search false-denial recovery matches the requested fixture query");
}

async function testYoutubeSearchFalseDenialSupportsLookForPhrasing() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Look for cats on YouTube",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "cats",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats");
  assert.match(result.canonicalResponse, /Searched YouTube for cats/i);
  console.log("OK: YouTube search false-denial recovery supports look-for phrasing");
}

async function testYoutubeSearchFalseDenialStripsIndirectObjectPronouns() {
  const cases = [
    "Find me cats on YouTube",
    "Open YouTube and find me cats",
  ];

  for (const transcript of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
      ]),
      androidEvents: [{
        type: "app_control",
        appName: "YouTube",
        action: "search",
        query: "cats",
        success: true,
      }],
    });

    assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial", transcript);
    assert.equal(result.diagnostics.executedToolName, "android_youtube_search", transcript);
    assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats", transcript);
  }

  console.log("OK: YouTube search false-denial recovery strips indirect-object pronouns");
}

async function testYoutubeSearchFalseDenialSupportsSearchOnYoutubePhrasing() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Search on YouTube for cats",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "cats",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats");
  assert.match(result.canonicalResponse, /Searched YouTube for cats/i);
  console.log("OK: YouTube search false-denial recovery supports search-on-YouTube phrasing");
}

async function testYoutubeSearchFalseDenialStripsPoliteQuerySuffixes() {
  const cases = [
    "Open YouTube and search for cats please",
    "Open YouTube and search for cats for me",
    "Search YouTube for cats, please",
  ];

  for (const transcript of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
      ]),
      androidEvents: [{
        type: "app_control",
        appName: "YouTube",
        action: "search",
        query: "cats",
        success: true,
      }],
    });

    assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial", transcript);
    assert.equal(result.diagnostics.executedToolName, "android_youtube_search", transcript);
    assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for cats", transcript);
  }

  console.log("OK: YouTube search false-denial recovery strips polite query suffixes");
}

async function testYoutubeSearchFalseDenialPreservesTitleLikePoliteWords() {
  const cases = [
    "Do It For Me",
    "Please Please Please",
  ];

  for (const query of cases) {
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: `Search YouTube for ${query}`,
      gemma: new ScriptedFakeLocalGemmaProvider([
        { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
      ]),
      androidEvents: [{
        type: "app_control",
        appName: "YouTube",
        action: "search",
        query,
        success: true,
      }],
    });

    assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial", query);
    assert.equal(result.diagnostics.executedToolName, "android_youtube_search", query);
    assert.equal(result.androidExecutions[0]?.label, `Searched YouTube for ${query}`, query);
  }

  console.log("OK: YouTube search false-denial recovery preserves title-like polite words");
}

async function testYoutubeSearchFalseDenialAllowsNegationWordsInQuery() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Search YouTube for Not Like Us",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_denial", capability: "app_control", text: "I cannot use phone tools." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "Not Like Us",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "tool_executed_after_false_denial");
  assert.equal(result.diagnostics.executedToolName, "android_youtube_search");
  assert.equal(result.androidExecutions[0]?.label, "Searched YouTube for Not Like Us");
  assert.match(result.canonicalResponse, /Searched YouTube for Not Like Us/i);
  console.log("OK: YouTube search false-denial recovery allows negation words inside queries");
}

async function testYoutubeSearchFalseCompletionIsBlocked() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Open YouTube and search for Alex Hormozi videos",
    gemma: new ScriptedFakeLocalGemmaProvider([
      { type: "false_completion", action: "android_youtube_search", text: "I searched YouTube." },
    ]),
    androidEvents: [{
      type: "app_control",
      appName: "YouTube",
      action: "search",
      query: "Alex Hormozi videos",
      success: true,
    }],
  });

  assert.equal(result.diagnostics.outcome, "false_completion_blocked");
  assert.equal(result.androidExecutions.length, 0);
  assert.match(result.canonicalResponse, /not completed/i);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: YouTube search completion claims require runtime confirmation");
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
    { type: "screen", source: "accessibility", activeApp: "YouTube", title: "Shorts", text: "Video details", elements: ["Search"] },
    { type: "screen", source: "temporary_capture", activeApp: "YouTube", title: "Shorts capture", text: "Captured video details", elements: ["Subscribe"] },
    { type: "app_control", appName: "YouTube", action: "open", success: true, detail: "Ready to search" },
    { type: "app_control", appName: "YouTube", action: "search", query: "Alex Hormozi", success: true, detail: "Search results are visible" },
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
  assert.match(runtime.execute("android_capture_screen").detail, /Captured video details/);
  assert.equal(runtime.execute("android_open_app_by_name", { appName: "YouTube" }).ok, true);
  assert.equal(runtime.execute("android_youtube_search", { query: "Alex Hormozi" }).ok, true);
  assert.match(runtime.execute("android_copy_to_clipboard").detail, /diagnostic details/);
  assert.equal(runtime.execute("runtime_request_approval").ok, false);
  assert.match(runtime.execute("runtime_scheduler_status").detail, /cloud research/);
  assert.equal(runtime.execute("runtime_service_status").ok, false);
  assert.equal(runtime.executions.length, 9);
  assert.equal(new FakeAndroidVoiceRuntime([
    { type: "screen", source: "accessibility", activeApp: "Settings", text: "Device control" },
  ]).execute("android_capture_screen").ok, false);
  assert.equal(normalizeLocalVoiceToolName("android_view_screenshot"), "android_capture_screen");
  assert.equal(normalizeLocalVoiceToolName("android_save_screenshot"), null);
  assert.equal(normalizeLocalVoiceToolName("youtube_search"), "android_youtube_search");
  assert.equal(normalizeLocalVoiceToolName("search_youtube"), null);
  assert.equal(normalizeLocalVoiceToolName("search youtube"), null);
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

async function testLocalVoiceOffersCloudBackgroundTaskAfterLocalFailure() {
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Research this competitor and write a report.",
    gemma: new ScriptedFakeLocalGemmaProvider([{ type: "blank_response" }]),
    cloudEscalation: {
      providers: [
        { id: "openai", label: "OpenAI", connected: true, authType: "oauth" },
        { id: "android-local-gemma", label: "Local", connected: true, authType: "local" },
      ],
    },
  });

  assert.equal(result.diagnostics.outcome, "blank_model_response");
  assert.equal(result.diagnostics.cloudEscalation?.kind, "confirm_single_provider");
  assert.equal(result.diagnostics.cloudEscalation?.liveModelSwitch, false);
  assert.match(result.canonicalResponse, /Should I use OpenAI/i);
  assert.deepEqual(result.modelCalls.map((call) => call.kind), ["local_gemma"]);
  assert.equal(result.responseCount, 1);
  console.log("OK: local voice can offer an explicit cloud background retry without using cloud live");
}

async function testLocalVoicePersonalMemoryQuestionInjectsGroundedEvidencePacket() {
  _setGroundedEvidencePacketDepsForTesting({
    now: () => new Date("2026-07-09T12:00:00.000Z"),
    loadProfileState: async (id) => ({
      userId: id,
      preferredName: "Justin",
      source: "profile_store",
    }),
    loadSoul: async () => ({ content: "", manualOverride: null, generatedAt: null, updatedAt: null }),
    retrieveMemoryContext: async (input) => ({
      userId: input.userId,
      query: input.query,
      caller: "runtime_memory_inspection",
      items: [{
        memory: {
          id: "voice-grounded-memory",
          content: "User prefers direct answers from grounded Jarvis state.",
          category: "communication_style",
          tier: "long_term",
          memoryType: "semantic",
          relevanceScore: 90,
          confidence: 95,
          accessCount: 1,
          score: 0.95,
        },
        provenance: [{ kind: "user_memory", id: "voice-grounded-memory", source: "canonical" }],
      }],
      sources: { memories: ["voice-grounded-memory"], brainChunks: [], hotState: [] },
      provenance: [{ kind: "user_memory", id: "voice-grounded-memory", source: "canonical" }],
      uncertainty: [],
    }),
    loadCommitments: async () => [],
  });
  _setRuntimeMemoryInspectionDepsForTesting({
    retrieveMemoryContext: async (input) => ({
      userId: input.userId,
      query: input.query,
      caller: "runtime_memory_inspection",
      items: [{
        memory: {
          id: "exact-doordash-memory",
          content: "User does not want DoorDash alerts treated as automatically important.",
          category: "preferences",
          tier: "long_term",
          memoryType: "semantic",
          relevanceScore: 92,
          confidence: 95,
          accessCount: 0,
          score: 0.94,
        },
        provenance: [{ kind: "user_memory", id: "exact-doordash-memory", source: "canonical" }],
      }],
      sources: { memories: ["exact-doordash-memory"], brainChunks: [], hotState: [] },
      provenance: [{ kind: "user_memory", id: "exact-doordash-memory", source: "canonical" }],
      uncertainty: [],
    }),
  });

  try {
    const gemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "You prefer direct answers." }]);
    const result = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: "Just wondering how was your day can you tell me what you know about me",
      gemma,
    });

    assert.equal(result.diagnostics.outcome, "final");
    assert.match(gemma.prompts[0]?.contextPacket ?? "", /Jarvis Grounded Evidence Packet/);
    assert.match(gemma.prompts[0]?.contextPacket ?? "", /Use only EVIDENCE/);
    assert.match(gemma.prompts[0]?.contextPacket ?? "", /Preferred name: Justin/);
    assert.match(gemma.prompts[0]?.contextPacket ?? "", /direct answers from grounded Jarvis state/);

    const temporalGemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "You chose native Android speech." }]);
    const temporalResult = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: "Do you remember what I decided about Android speech a while ago?",
      gemma: temporalGemma,
    });
    assert.equal(temporalResult.diagnostics.outcome, "final");
    assert.match(temporalGemma.prompts[0]?.contextPacket ?? "", /intent=temporal_recall/);
    assert.match(temporalGemma.prompts[0]?.contextPacket ?? "", /direct answers from grounded Jarvis state/);

    const personalFactGemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "Your favorite color is green." }]);
    const personalFactResult = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: "What's my favorite color?",
      gemma: personalFactGemma,
    });
    assert.equal(personalFactResult.diagnostics.outcome, "final");
    assert.match(personalFactGemma.prompts[0]?.contextPacket ?? "", /Jarvis Grounded Evidence Packet/);

    const technicalMemoryGemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "Here is how to inspect memory usage." }]);
    const technicalMemoryResult = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: "Search memory leaks in my Android app.",
      gemma: technicalMemoryGemma,
    });
    assert.equal(technicalMemoryResult.diagnostics.outcome, "final");
    assert.doesNotMatch(technicalMemoryGemma.prompts[0]?.contextPacket ?? "", /Jarvis Grounded Evidence Packet/);

    const exactInspectionGemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "Audit path owns this request." }]);
    const exactInspectionResult = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: "Show exact memories about DoorDash",
      gemma: exactInspectionGemma,
    });
    assert.equal(exactInspectionResult.diagnostics.outcome, "runtime_memory_inspection");
    assert.match(exactInspectionResult.canonicalResponse, /limited MemoryOS inspection for DoorDash/);
    assert.match(exactInspectionResult.canonicalResponse, /DoorDash alerts treated as automatically important/);
    assert.equal(exactInspectionResult.modelCalls.length, 0);
    assert.equal(exactInspectionGemma.prompts.length, 0);

    const memorySaveGemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "I will save that." }]);
    const memorySaveResult = await runLocalVoiceRuntimeHarnessTurn({
      userId: "user-local-voice",
      transcript: "Remember that my birthday is Jan 1",
      gemma: memorySaveGemma,
    });
    assert.equal(memorySaveResult.diagnostics.outcome, "final");
    assert.doesNotMatch(memorySaveGemma.prompts[0]?.contextPacket ?? "", /Jarvis Grounded Evidence Packet/);
    console.log("OK: local voice injects grounded evidence packets for personal memory questions");
  } finally {
    _setGroundedEvidencePacketDepsForTesting(null);
    _setRuntimeMemoryInspectionDepsForTesting(null);
  }
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
  await testNotificationFalseDenialIgnoresNegatedUnrelatedFollowUp();
  await testNotificationFalseDenialBlocksPronounCancellation();
  await testNotificationFalseDenialIgnoresDifferentPronounCapabilityCancellation();
  await testNotificationFalseDenialIgnoresPunctuatedNoRushAside();
  await testNotificationReadAllWinsOverSpecificReference();
  await testNotificationToolCallFollowUpUsesWorkingContext();
  await testVoiceScreenReadUsesAccessibilityBeforeTemporaryCapture();
  await testVoiceScreenReadFallsBackToTemporaryCapturePreview();
  await testVoiceScreenReadFallsBackWhenAccessibilityIsEmpty();
  await testImageOnlyTemporaryCaptureReportsAttachment();
  await testExpandedScreenContextFollowUpUsesWorkingContext();
  await testBareTheScreenReadUsesFreshScreenContext();
  await testExplicitScreenToolCallsRefreshStaleWorkingContext();
  await testScreenToolCallsUseCachedWorkingContextWithoutFreshScreenEvents();
  await testFinalScreenAnswersUseFreshEventsOverStaleContext();
  await testScreenReadsIgnoreNegatedSaveDeleteAsides();
  await testScreenReadsWithCaptureContextIgnoreNegatedSaveDeleteAsides();
  await testScreenReadsRespectNegatedScreenshotCaptureRequests();
  await testScreenCaptureRequestsRespectLatestIntent();
  await testExplicitScreenshotRequestsCreateTemporaryCaptureWhenAccessibilityWorks();
  await testScreenFalseDenialsUseCachedWorkingContextWithoutFreshScreenEvents();
  await testCurrentScreenRequestsForceFreshReadOverCachedContext();
  await testScreenFalseDenialsUseFreshCaptureFallbackOverStaleContext();
  await testTemporaryCaptureFollowUpsCanDeclineSaveCopyAndDelete();
  await testPronounTemporaryCaptureFollowUpsUseActiveCapture();
  await testDestinationQualifiedTemporaryCaptureFollowUpsUseActiveCapture();
  await testCapturePreviewActionsWinOverFreshScreenRefresh();
  await testTargetlessTemporaryCapturePreviewActionsUseActiveCapture();
  await testTemporaryCaptureSaveIsUnavailableWithoutGalleryTool();
  await testNegatedTemporaryCaptureFollowUpsAreBlocked();
  await testNegatedScreenReadsDoNotUseCachedWorkingContext();
  await testNegatedAppUiScreenRequestsDoNotReadScreen();
  await testNegatedBareCaptureReadsDoNotUseCachedWorkingContext();
  await testTemporaryCaptureExpiresAfterWorkingContextTtl();
  await testSaveUnavailableTemporaryCaptureDoesNotBypassWorkingContextTtl();
  await testScreenshotMetaQuestionsDoNotUseScreenWorkingContext();
  await testNotificationReferenceOpensMatchingApp();
  await testSingleNotificationPronounReferencesUseWorkingContext();
  await testNotificationReferenceUsesStoredAppNames();
  testOrdinalNotificationReferencesSelectWithinMatches();
  testShortAppNameNotificationReferencesResolve();
  testNotificationReferencePrefersAppNameTermsOverBodyMentions();
  testShortAppNameReferencesRequireWholeTokenMatches();
  await testNotificationWorkingContextIsNotInjectedIntoUnrelatedTurns();
  await testNotificationWorkingContextIsNotInjectedIntoMetaQuestions();
  await testGenericOneAppRequestDoesNotUseNotificationContext();
  await testPlainAppOpenDoesNotUseNotificationTitleReference();
  await testMessagesAppOpenDoesNotUseNotificationMessageReference();
  await testNegatedNotificationFollowUpsDoNotUseWorkingContext();
  await testLaterPositiveNotificationClauseAfterNegationRuns();
  await testEarlierPositiveNotificationClauseSurvivesLaterNegation();
  await testLaterPronounNegationCancelsNotificationAction();
  await testSpecificNotificationReadUsesWorkingContext();
  await testMissingAppControlFixtureFails();
  await testMismatchedAppControlFixtureFails();
  await testYoutubeSearchExecutesDeterministically();
  await testYoutubeSearchAcceptsSnakeCaseSearchQueryArgument();
  await testYoutubeSearchFalseDenialRecoveryExecutes();
  await testYoutubeSearchFalseDenialAcceptsYouTubeAliasesInFixtures();
  await testYoutubeSearchRequiresMatchingQuery();
  await testYoutubeSearchRejectsTruncatedTitleQueryMatch();
  await testYoutubeSearchFalseDenialSkipsNegatedSearchClause();
  await testYoutubeSearchFalseDenialLaterAppCorrectionWins();
  await testYoutubeSearchFalseDenialLaterSearchCorrectionWins();
  await testYoutubeSearchFalseDenialLaterAndSearchCorrectionWins();
  await testYoutubeSearchFalseDenialTargetlessCorrectionReusesPriorSearchContext();
  await testYoutubeSearchFalseDenialPreservesConjunctionsInQuery();
  await testYoutubeSearchFalseDenialPreservesPunctuationInQuery();
  await testYoutubeSearchFalseDenialAllowsInOnPhrasesInQuery();
  await testYoutubeSearchFalseDenialUsesPriorYouTubeContext();
  await testYoutubeSearchFalseDenialHandlesPunctuatedSearchFollowUp();
  await testYoutubeSearchFalseDenialDoesNotReuseContextForDifferentTarget();
  await testAppControlFalseDenialBlocksPronounCancellations();
  await testAppControlFalseDenialBlocksExplicitCancellations();
  await testAppControlFalseDenialMatchesPronounCancellationAction();
  await testYoutubeSearchFalseDenialIgnoresNegatedUnrelatedFollowUp();
  await testYoutubeSearchFalseDenialIgnoresNegatedSearchFollowUps();
  await testYoutubeSearchFalseDenialMatchesRequestedFixtureQuery();
  await testYoutubeSearchFalseDenialSupportsLookForPhrasing();
  await testYoutubeSearchFalseDenialStripsIndirectObjectPronouns();
  await testYoutubeSearchFalseDenialSupportsSearchOnYoutubePhrasing();
  await testYoutubeSearchFalseDenialStripsPoliteQuerySuffixes();
  await testYoutubeSearchFalseDenialPreservesTitleLikePoliteWords();
  await testYoutubeSearchFalseDenialAllowsNegationWordsInQuery();
  await testYoutubeSearchFalseCompletionIsBlocked();
  await testAppControlFalseDenialRecoveryKeepsRequestedApp();
  await testAppControlFalseDenialUsesActiveOpenRequest();
  await testAppControlFalseDenialUsesPunctuationFreeCorrection();
  await testAppControlFalseDenialBlocksNegatedOpenRequest();
  await testFalseDenialRecoveryBlocksNegatedNonAppCapabilities();
  await testScriptedFakeLocalGemmaVariants();
  testFakeAndroidRuntimeEventCoverage();
  await testLocalVoiceOffersCloudBackgroundTaskAfterLocalFailure();
  await testLocalVoicePersonalMemoryQuestionInjectsGroundedEvidencePacket();
  await testLocalVoiceBlocksCloudAndSecondaryModels();
  await testCanonicalFinalResponseContract();
  console.log("\nAll Local Voice Runtime harness assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
