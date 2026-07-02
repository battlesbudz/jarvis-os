import assert from "node:assert/strict";
import {
  FakeAndroidVoiceRuntime,
  LocalVoiceRuntimeHarnessError,
  ScriptedFakeLocalGemmaProvider,
  normalizeLocalVoiceToolName,
  runLocalVoiceRuntimeHarnessTurn,
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
