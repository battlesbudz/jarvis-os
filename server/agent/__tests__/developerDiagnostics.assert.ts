import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildTurnDiagnosticBundle,
  formatDiagnosticBundleForClipboard,
  getActionableDiagnosticRecords,
  isDiagnosticCopyRequest,
  resolveDiagnosticTarget,
  resolveDiagnosticTargetFromText,
  shouldClarifyVoiceDiagnosticTarget,
  type DiagnosticTurnRecord,
} from "@shared/turnDiagnostics";

function makeRecord(input: {
  turnId: string;
  messageId: number;
  createdAt: string;
  result?: "success" | "error";
  runtimeIntent?: string;
}): DiagnosticTurnRecord {
  const bundle = buildTurnDiagnosticBundle({
    turnId: input.turnId,
    source: "telegram",
    channel: "telegram",
    channelTurnId: input.messageId,
    requestText: "Open YouTube",
    responseText: input.result === "error" ? "I could not open YouTube." : "Opened YouTube.",
    selected: { mode: "telegram", model: "server-selected", profile: "server-selected" },
    runtimeIntent: input.runtimeIntent,
    contextPacket: { messages: [{ role: "user", content: "Open YouTube" }] },
    normalizedToolCalls: [{ tool: "android_open_app_by_name", appName: "YouTube" }],
    toolResults: [{ tool: "android_open_app_by_name", result: input.result ?? "success", label: "Open YouTube" }],
    timing: { startedAt: input.createdAt, finishedAt: input.createdAt, durationMs: 12 },
    recentTurnHistory: [{ role: "user", content: "Open YouTube" }],
  });
  return {
    turnId: input.turnId,
    source: "telegram",
    channel: "telegram",
    channelTurnId: input.messageId,
    createdAt: input.createdAt,
    bundle,
  };
}

function testFailedActionCopyBundle() {
  const bundle = buildTurnDiagnosticBundle({
    turnId: "turn_failed",
    source: "in_app",
    channel: "appchat",
    requestText: "Read my notifications",
    responseText: "I could not read your notifications.",
    selected: { mode: "sharp", model: "Phone Gemma", profile: "gpu-standard-512" },
    runtimeIntent: "android_notifications",
    contextPacket: {
      stateCard: "Assistant: JARVIS",
      messages: [{ role: "user", content: "Read my notifications" }],
    },
    offeredTools: ["android_read_notifications"],
    rawToolCalls: [{ name: "android_read_notifications", arguments: "{}" }],
    normalizedToolCalls: [{ tool: "android_read_notifications" }],
    toolResults: [{ tool: "android_read_notifications", result: "error", detail: "permission missing" }],
    modelErrors: [{ message: "tool failed" }],
    timing: { startedAt: "2026-07-04T00:00:00.000Z", finishedAt: "2026-07-04T00:00:00.100Z", durationMs: 100 },
    androidState: { connected: true, accessibility: false },
    recentTurnHistory: [{ role: "user", content: "Read my notifications" }],
  });

  const copied = formatDiagnosticBundleForClipboard(bundle);
  assert.match(copied, /android_read_notifications/);
  assert.match(copied, /permission missing/);
  assert.match(copied, /stateCard/);
  assert.equal(bundle.contextEstimate.approximateTokens > 0, true);
  console.log("OK: failed action copy includes context, tools, errors, and Android state");
}

function testSuccessfulTurnCopyBundle() {
  const bundle = buildTurnDiagnosticBundle({
    turnId: "turn_success",
    source: "in_app",
    channel: "appchat",
    requestText: "Say ready",
    responseText: "READY.",
    selected: { mode: "sharp", model: "Phone Gemma", profile: "gpu-standard-512" },
    contextPacket: { messages: [{ role: "user", content: "Say ready" }] },
    timing: { startedAt: "2026-07-04T00:00:00.000Z", durationMs: 20 },
    recentTurnHistory: [{ role: "assistant", content: "READY." }],
  });

  const copied = formatDiagnosticBundleForClipboard(bundle);
  assert.match(copied, /READY/);
  assert.match(copied, /Phone Gemma/);
  assert.equal(bundle.toolResults.length, 0);
  console.log("OK: successful turn copy includes model selection and context estimate");
}

function testTelegramTargetResolution() {
  const records = [
    makeRecord({ turnId: "older", messageId: 101, createdAt: "2026-07-04T00:00:00.000Z" }),
    makeRecord({ turnId: "newer", messageId: 102, createdAt: "2026-07-04T00:01:00.000Z", result: "error" }),
  ];

  const replied = resolveDiagnosticTarget(records, { kind: "reply", channelTurnId: 101 });
  assert.equal(replied.ok, true);
  if (replied.ok) assert.equal(replied.record.turnId, "older");

  const last = resolveDiagnosticTarget(records, { kind: "last" });
  assert.equal(last.ok, true);
  if (last.ok) assert.equal(last.record.turnId, "newer");

  const missing = resolveDiagnosticTarget(records, { kind: "reply", channelTurnId: 999 });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "not_found");

  assert.equal(isDiagnosticCopyRequest("copy details"), true);
  assert.equal(isDiagnosticCopyRequest("copy last failed details"), true);
  const failedFromText = resolveDiagnosticTargetFromText(records, "copy last failed details");
  assert.equal(failedFromText.ok, true);
  if (failedFromText.ok) assert.equal(failedFromText.record.turnId, "newer");

  const withClarification = [
    makeRecord({
      turnId: "clarification",
      messageId: 103,
      createdAt: "2026-07-04T00:02:00.000Z",
      runtimeIntent: "diagnostic_copy",
    }),
    ...records,
  ];
  const actionable = getActionableDiagnosticRecords(withClarification);
  assert.equal(actionable.some((record) => record.turnId === "clarification"), false);
  const lastAfterClarification = resolveDiagnosticTargetFromText(withClarification, "copy last turn details");
  assert.equal(lastAfterClarification.ok, true);
  if (lastAfterClarification.ok) assert.equal(lastAfterClarification.record.turnId, "newer");
  console.log("OK: Telegram diagnostics resolve reply targets and plain last-turn targets");
}

function testVoiceClarificationAndNoAudioBytes() {
  const records = [
    makeRecord({ turnId: "voice-failed", messageId: 201, createdAt: "2026-07-04T00:02:00.000Z", result: "error" }),
    makeRecord({ turnId: "voice-success", messageId: 202, createdAt: "2026-07-04T00:03:00.000Z" }),
  ];
  assert.equal(shouldClarifyVoiceDiagnosticTarget("copy details", records), true);
  assert.equal(shouldClarifyVoiceDiagnosticTarget("copy last turn details", records), false);

  const bundle = buildTurnDiagnosticBundle({
    turnId: "voice-turn",
    source: "voice",
    channel: "voice",
    requestText: "copy details",
    responseText: "The last failed action?",
    selected: { mode: "voice", model: "Phone Gemma", profile: "gpu-standard-512" },
    contextPacket: { transcript: "copy details" },
    timing: { startedAt: "2026-07-04T00:00:00.000Z" },
    recentTurnHistory: [],
    voiceTrace: {
      finalTranscript: "copy details",
      stateTransitions: [{ state: "transcription_complete", at: "2026-07-04T00:00:00.000Z" }],
    },
  });
  const copied = formatDiagnosticBundleForClipboard(bundle);
  assert.match(copied, /finalTranscript/);
  assert.doesNotMatch(copied, /audioBase64|audioBytes|recordingUri/);
  console.log("OK: voice copy details clarifies ambiguous targets and excludes audio bytes");
}

function testAndroidPlainTextClipboardContract() {
  const projectRoot = process.cwd();
  const bridge = fs.readFileSync(path.join(projectRoot, "server/daemon/bridge.ts"), "utf8");
  const androidHandler = fs.readFileSync(path.join(projectRoot, "android/app/src/main/java/com/gameplan/daemon/OpHandler.kt"), "utf8");
  const pluginHandler = fs.readFileSync(path.join(projectRoot, "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/OpHandler.kt"), "utf8");

  for (const source of [bridge, androidHandler, pluginHandler]) {
    assert.match(source, /android_copy_text_to_clipboard/);
  }
  assert.match(androidHandler, /ClipData\.newPlainText/);
  assert.match(pluginHandler, /ClipData\.newPlainText/);
  console.log("OK: Android plain-text clipboard op is registered in bridge and daemon handlers");
}

testFailedActionCopyBundle();
testSuccessfulTurnCopyBundle();
testTelegramTargetResolution();
testVoiceClarificationAndNoAudioBytes();
testAndroidPlainTextClipboardContract();
