import assert from "node:assert/strict";
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
  assert.match(result.canonicalResponse, /Codex: Review finished/);
  assert.match(result.canonicalResponse, /Life360: Justin arrived Home/);
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
  assert.match(result.canonicalResponse, /do not have visible notifications/i);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: empty notification shade is a successful local voice read");
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
