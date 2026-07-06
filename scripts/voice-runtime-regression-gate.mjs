import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function expectIncludes(relPath, needle, message) {
  assert.ok(
    read(relPath).includes(needle),
    `${message}\nMissing ${JSON.stringify(needle)} in ${relPath}`,
  );
}

function expectMatch(relPath, pattern, message) {
  assert.match(read(relPath), pattern, `${message}\nMissing ${pattern} in ${relPath}`);
}

const packageJson = JSON.parse(read("package.json"));
assert.equal(
  packageJson.scripts["jarvis:voice-runtime:regression-gate"],
  "node scripts/voice-runtime-regression-gate.mjs",
  "package.json should expose the APK voice runtime regression gate",
);
assert.equal(
  packageJson.scripts["jarvis:android-daemon:emulator-e2e"],
  "node scripts/android-daemon-emulator-e2e.mjs",
  "package.json should keep the Android daemon emulator smoke command runnable",
);

const requiredMockedTests = [
  "server/agent/__tests__/phoneRuntimeNotificationsE2E.assert.ts",
  "server/agent/__tests__/localVoiceRuntimeHarness.assert.ts",
  "server/agent/__tests__/voiceRuntimeResourceScheduler.assert.ts",
  "server/agent/__tests__/codexVoiceTurn.assert.ts",
  "server/agent/__tests__/localVoiceLoopTiming.assert.ts",
  "server/agent/__tests__/inAppLocalVoiceLoop.assert.ts",
  "server/agent/__tests__/voiceApprovalGates.assert.ts",
  "server/agent/__tests__/voiceApprovalServerGate.assert.ts",
  "app/(tabs)/__tests__/voiceApprovalGates.assert.ts",
  "server/state/__tests__/runtimeWorkingContextTruthAudit.assert.ts",
  "server/agent/__tests__/developerDiagnostics.assert.ts",
];

for (const testFile of requiredMockedTests) {
  expectIncludes(
    "scripts/run-agent-tests.mjs",
    `{ file: "${testFile}" }`,
    `${testFile} should stay in npm test for APK voice/runtime changes`,
  );
}

const localHarness = "server/agent/__tests__/localVoiceRuntimeHarness.assert.ts";
const localHarnessCoverage = [
  "testCompleteLocalVoiceNotificationTurn",
  "testNotificationFollowUpSummaryUsesWorkingContext",
  "testYoutubeSearchExecutesDeterministically",
  "testVoiceScreenReadUsesAccessibilityBeforeTemporaryCapture",
  "testVoiceScreenReadFallsBackToTemporaryCapturePreview",
  "testScriptedFakeLocalGemmaVariants",
  "testFakeAndroidRuntimeEventCoverage",
  "testLocalVoiceBlocksCloudAndSecondaryModels",
  "testCanonicalFinalResponseContract",
  "android_copy_to_clipboard",
  "runtime_scheduler_status",
  "runtime_service_status",
  "false_completion_blocked",
  "tool_executed_after_false_denial",
  "assert.equal(result.chatOutput, result.ttsOutput",
  "assert.equal(result.responseCount, 1",
];

for (const needle of localHarnessCoverage) {
  expectIncludes(localHarness, needle, "Local voice harness should cover the APK voice runtime contract");
}

expectIncludes(
  "server/agent/__tests__/phoneRuntimeNotificationsE2E.assert.ts",
  "resolveAndroidNotificationFollowUp",
  "Phone runtime tests should cover notification follow-up routing",
);
expectIncludes(
  "server/agent/__tests__/voiceRuntimeResourceScheduler.assert.ts",
  "testRuntimeStatusBypassesGemmaGuessing",
  "Voice resource tests should cover deterministic runtime status answers",
);
expectIncludes(
  "app/(tabs)/__tests__/voiceApprovalGates.assert.ts",
  "outside-app crash events should clear React Talk Mode state like an ended voice session",
  "App tests should cover outside-app voice crash recovery state",
);
expectIncludes(
  "server/agent/__tests__/developerDiagnostics.assert.ts",
  "copy",
  "Developer diagnostics tests should cover copy-details support",
);
expectIncludes(
  "server/state/__tests__/runtimeWorkingContextTruthAudit.assert.ts",
  "truth audit blocks false denials and unconfirmed completions",
  "Truth audit tests should block false denials and unconfirmed completions",
);
expectIncludes(
  "server/state/__tests__/runtimeWorkingContextTruthAudit.assert.ts",
  "blocked_false_completion",
  "Truth audit tests should fail unconfirmed action completions",
);
expectIncludes(
  "server/state/__tests__/runtimeWorkingContextTruthAudit.assert.ts",
  "blocked_false_denial",
  "Truth audit tests should fail Local Gemma denials of runtime-available tools",
);

const emulatorScript = "scripts/android-daemon-emulator-e2e.mjs";
expectIncludes(
  emulatorScript,
  "JARVIS_ANDROID_E2E_FAKE_LOCAL_GEMMA",
  "Emulator smoke should run with fake Local Gemma by default",
);
expectIncludes(
  emulatorScript,
  "runOutsideAppVoiceFakeLocalGemmaSmoke",
  "Emulator smoke should validate outside-app voice UI and foreground service behavior",
);
expectIncludes(
  emulatorScript,
  "runClipboardSmoke",
  "Emulator smoke should validate clipboard daemon routing",
);
expectIncludes(
  emulatorScript,
  "runCrashRestartSmoke",
  "Emulator smoke should validate voice crash/restart behavior",
);
expectIncludes(
  emulatorScript,
  "android_copy_text_to_clipboard",
  "Emulator smoke should exercise the Android clipboard tool",
);
expectIncludes(
  emulatorScript,
  "result.data?.copied === true",
  "Emulator clipboard smoke should accept the daemon's top-level copy result shape",
);
expectIncludes(
  emulatorScript,
  'voiceE2eBroadcast("crash"',
  "Emulator smoke should exercise the debug crash command",
);

expectIncludes(
  "android/app/src/debug/java/com/gameplan/daemon/DaemonE2eReceiver.kt",
  "e2eCrashCommand=dispatched",
  "Debug receiver should expose a deterministic crash command marker for emulator-only restart testing",
);
expectIncludes(
  "android/app/src/main/java/com/gameplan/daemon/OutsideAppVoiceSessionService.kt",
  "ACTION_E2E_SIMULATE_CRASH",
  "Outside-app voice service should support a debug-triggered simulated crash path",
);
expectIncludes(
  "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/OutsideAppVoiceSessionService.kt",
  "ACTION_E2E_SIMULATE_CRASH",
  "Native daemon plugin copy should stay aligned with the app service simulated crash path",
);

expectIncludes(
  ".github/workflows/android-daemon-emulator-e2e.yml",
  "JARVIS_ANDROID_E2E_FAKE_LOCAL_GEMMA: \"1\"",
  "Android emulator workflow should pin fake Local Gemma mode",
);
expectIncludes(
  ".github/workflows/android-daemon-emulator-e2e.yml",
  "npm run jarvis:android-daemon:emulator-e2e",
  "Android emulator workflow should run the documented emulator smoke command",
);
expectIncludes(
  ".github/workflows/ci.yml",
  "npm run jarvis:voice-runtime:regression-gate",
  "CI should run the voice runtime regression gate",
);

expectIncludes(
  "docs/apk-voice-runtime-regression-gate.md",
  "npm run jarvis:voice-runtime:regression-gate",
  "APK voice runtime gate docs should include the mocked regression command",
);
expectIncludes(
  "docs/apk-voice-runtime-regression-gate.md",
  "npm run jarvis:android-daemon:emulator-e2e",
  "APK voice runtime gate docs should include the emulator command",
);
expectIncludes(
  "docs/apk-voice-runtime-regression-gate.md",
  "Real Local Gemma performance is a physical-device manual validation step",
  "APK voice runtime gate docs should keep real Gemma performance out of the emulator gate",
);
expectIncludes(
  "CONTRIBUTING.md",
  "APK voice/runtime, Local Gemma phone control, outside-app voice, or Android tool routing",
  "Contributor focused test map should include APK voice/runtime validation",
);
expectIncludes(
  ".github/PULL_REQUEST_TEMPLATE.md",
  "APK voice/runtime or Local Gemma phone control",
  "PR template should prompt APK voice/runtime validation evidence",
);

expectMatch(
  "scripts/android-daemon-emulator-e2e.mjs",
  /fakeLocalGemma:\s*FAKE_LOCAL_GEMMA_E2E/,
  "Emulator summary should report fake Local Gemma mode",
);

console.log("OK: APK voice runtime regression gate is wired");
