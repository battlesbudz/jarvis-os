import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildDiagnosticConversationMessages,
  buildTurnDiagnosticBundle,
  diagnosticRecordHasFailure,
  formatDiagnosticBundleForClipboard,
  getActionableDiagnosticRecords,
  getDiagnosticRecordsForUser,
  isDiagnosticCopyRequest,
  normalizeServerContextTrace,
  resolveDiagnosticCopyRequestTarget,
  resolveDiagnosticTarget,
  resolveDiagnosticTargetFromText,
  resolveVoiceDiagnosticFollowupTarget,
  shouldClarifyVoiceDiagnosticTarget,
  type DiagnosticTurnRecord,
} from "@shared/turnDiagnostics";

function makeRecord(input: {
  turnId: string;
  messageId?: number | null;
  createdAt: string;
  result?: "success" | "error";
  runtimeIntent?: string;
  userId?: string;
}): DiagnosticTurnRecord {
  const bundle = buildTurnDiagnosticBundle({
    turnId: input.turnId,
    source: "telegram",
    userId: input.userId ?? "user_current",
    channel: "telegram",
    channelTurnId: input.messageId ?? null,
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
    channelTurnId: input.messageId ?? null,
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
  assert.equal(bundle.schemaVersion, 2);
  console.log("OK: failed action copy includes context, tools, errors, and Android state");
}

function testOperationLevelDiagnostics() {
  const bundle = buildTurnDiagnosticBundle({
    turnId: "turn_operation",
    source: "in_app",
    channel: "appchat",
    requestText: "Open the YouTube notification",
    contextPacket: {},
    normalizedToolCalls: [{
      tool: "daemon_action",
      operation: "android_notification_open",
      operationArgs: { notificationKey: "<sha256:123456789abc>", query: "<redacted:20 chars>" },
      toolCallId: "call-1",
      durationMs: 812,
      verification: true,
    }],
    toolResults: [{ tool: "daemon_action", operation: "android_notification_open", result: "success", verification: true }],
    timing: { startedAt: "2026-08-16T20:00:00.000Z", durationMs: 812 },
  });
  const copied = formatDiagnosticBundleForClipboard(bundle);
  assert.match(copied, /android_notification_open/);
  assert.match(copied, /toolCallId/);
  assert.match(copied, /durationMs/);
  assert.match(copied, /verification/);
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

function testTruthfulAppContextDiagnostics() {
  const submitted = buildDiagnosticConversationMessages([
    { id: "user-1", role: "user", content: "What did I say?" },
    { id: "tool-protocol", role: "assistant", content: null },
    { id: "assistant-1", role: "assistant", content: "You asked about context." },
  ]);
  assert.deepEqual(submitted.map((message) => message.id), ["user-1", "assistant-1"]);
  assert.equal(submitted.some((message) => message.content.trim().length === 0), false);

  const trace = normalizeServerContextTrace({
    type: "context_trace",
    clientMessageCount: 2,
    recoveredSessionMessageCount: 18,
    providerMessageCount: 20,
    summarizedMessageCount: 4,
    omittedMessageCount: 0,
    offeredToolNames: ["memory_search", "memory_search", "web_search"],
  });
  assert.ok(trace);
  assert.deepEqual(trace.offeredToolNames, ["memory_search", "web_search"]);

  for (const source of ["in_app", "voice"] as const) {
    const bundle = buildTurnDiagnosticBundle({
      turnId: `${source}-truthful-context`,
      source,
      channel: source === "voice" ? "voice" : "appchat",
      contextPacket: { appSubmittedMessages: submitted, serverContextTrace: trace },
      offeredTools: trace.offeredToolNames,
      selectedTools: ["memory_search"],
      executedTools: ["memory_search"],
      normalizedToolCalls: [{ tool: "memory_search", result: "success" }],
      toolResults: [{ tool: "memory_search", result: "success" }],
      timing: { startedAt: "2026-08-16T00:00:00.000Z" },
      recentTurnHistory: submitted,
      voiceTrace: source === "voice" ? { finalTranscript: "What did I say?", stateTransitions: [] } : undefined,
    });
    assert.deepEqual(bundle.offeredTools, ["memory_search", "web_search"]);
    assert.deepEqual(bundle.selectedTools, ["memory_search"]);
    assert.deepEqual(bundle.executedTools, ["memory_search"]);
    assert.match(formatDiagnosticBundleForClipboard(bundle), /appSubmittedMessages/);
  }

  assert.equal(normalizeServerContextTrace(undefined), null);
  const legacyServerBundle = buildTurnDiagnosticBundle({
    turnId: "no-context-trace",
    source: "in_app",
    contextPacket: { appSubmittedMessages: submitted, serverContextTrace: null },
    timing: { startedAt: "2026-08-16T00:00:00.000Z" },
  });
  assert.deepEqual(legacyServerBundle.offeredTools, []);
  assert.deepEqual(legacyServerBundle.selectedTools, []);
  assert.deepEqual(legacyServerBundle.executedTools, []);
  console.log("OK: app and voice diagnostics distinguish submitted/provider context and tool stages");
}

function testAppContextTraceWiringContract() {
  const insights = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/insights.tsx"), "utf8");
  assert.match(insights, /buildDiagnosticConversationMessages\(contextMessages\)\.reverse\(\)/);
  assert.match(insights, /parsed\.type === 'context_trace'/);
  assert.match(insights, /serverContextTrace = normalizeServerContextTrace\(parsed\)/);
  assert.match(insights, /appSubmittedMessages: apiMessages/);
  assert.match(insights, /offeredTools: serverContextTrace\?\.offeredToolNames \?\? \[\]/);
  assert.match(insights, /originChannel: origin\.source === 'voice' \? 'voice' : 'appchat'/);
  assert.match(insights, /originPlatform: Platform\.OS/);
  assert.match(
    insights,
    /if \(reply\.intent === 'restore'\)[\s\S]*?acceptedVoiceRestore = voiceRestore;[\s\S]*?const normalizedVoiceText/,
    "accepted voice restore continues into the session-hydrated coach request",
  );
  assert.match(
    insights,
    /const retainAcceptedVoiceRestoreForRetry[\s\S]*?pendingVoiceRestore: message\.id === retryTargetId \? restore : undefined/,
    "failed or aborted coach turns keep voice restoration retryable",
  );
  assert.match(
    insights,
    /if \(gotConfirmRequired\)[\s\S]*?clearAcceptedVoiceRestore\(\)/,
    "approval requests clear accepted voice restore markers",
  );
  assert.match(
    insights,
    /if \(streamErrorMessage\)[\s\S]*?retainAcceptedVoiceRestoreForRetry\(\)/,
    "failed coach turns keep accepted voice restore markers retryable",
  );
  assert.doesNotMatch(
    insights,
    /reply\.intent === 'restore'[\s\S]{0,300}I restored the interrupted voice context/,
    "accepted voice restore is not replaced with a local daemon-state recap",
  );
  console.log("OK: in-app and voice requests share stable-ID context trace diagnostics wiring");
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
  assert.equal(isDiagnosticCopyRequest("diagnostic details"), true);
  assert.equal(isDiagnosticCopyRequest("send details"), false);
  assert.equal(isDiagnosticCopyRequest("show details"), false);
  assert.equal(isDiagnosticCopyRequest("get details"), false);
  const failedFromText = resolveDiagnosticTargetFromText(records, "copy last failed details");
  assert.equal(failedFromText.ok, true);
  if (failedFromText.ok) assert.equal(failedFromText.record.turnId, "newer");
  assert.equal(resolveDiagnosticCopyRequestTarget("copy last failed details"), "last failed action");

  const successfulAfterFailure = [
    makeRecord({ turnId: "success-after-failure", messageId: 106, createdAt: "2026-07-04T00:05:00.000Z" }),
    makeRecord({ turnId: "older-failure", messageId: 107, createdAt: "2026-07-04T00:04:00.000Z", result: "error" }),
  ];
  const explicitFailed = resolveDiagnosticTargetFromText(successfulAfterFailure, "copy last failed details");
  assert.equal(explicitFailed.ok, true);
  if (explicitFailed.ok) assert.equal(explicitFailed.record.turnId, "older-failure");

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

  const userScoped = getDiagnosticRecordsForUser([
    makeRecord({ turnId: "other-user", messageId: 104, createdAt: "2026-07-04T00:03:00.000Z", userId: "user_other" }),
    makeRecord({ turnId: "current-user", messageId: 105, createdAt: "2026-07-04T00:04:00.000Z", userId: "user_current" }),
  ], "user_current");
  assert.deepEqual(userScoped.map((record) => record.turnId), ["current-user"]);

  const modelErrorOnlyBundle = buildTurnDiagnosticBundle({
    turnId: "model-error-only",
    source: "telegram",
    userId: "user_current",
    channel: "telegram",
    channelTurnId: 109,
    requestText: "Do the thing",
    responseText: "Sorry, I encountered an error. Please try again.",
    selected: { mode: "telegram", model: "server-selected", profile: "server-selected" },
    contextPacket: { userText: "Do the thing" },
    toolResults: [],
    modelErrors: [{ message: "provider timeout" }],
    timing: { startedAt: "2026-07-04T00:07:00.000Z" },
    recentTurnHistory: [],
  });
  const modelErrorOnlyRecord: DiagnosticTurnRecord = {
    turnId: modelErrorOnlyBundle.turnId,
    source: "telegram",
    channel: "telegram",
    channelTurnId: 109,
    createdAt: modelErrorOnlyBundle.createdAt,
    bundle: modelErrorOnlyBundle,
  };
  assert.equal(diagnosticRecordHasFailure(modelErrorOnlyRecord), true);
  const modelErrorFailed = resolveDiagnosticTargetFromText([modelErrorOnlyRecord], "copy last failed details");
  assert.equal(modelErrorFailed.ok, true);
  if (modelErrorFailed.ok) assert.equal(modelErrorFailed.record.turnId, "model-error-only");

  const missingChannelIdRecords = [
    makeRecord({ turnId: "voice-without-message-id", messageId: null, createdAt: "2026-07-04T00:06:00.000Z" }),
    makeRecord({ turnId: "older-with-message-id", messageId: 108, createdAt: "2026-07-04T00:05:00.000Z" }),
  ];
  const replyWithoutFallback = resolveDiagnosticTarget(missingChannelIdRecords, { kind: "reply", channelTurnId: 999 });
  assert.equal(replyWithoutFallback.ok, false);
  const replyWithFallback = resolveDiagnosticTarget(
    missingChannelIdRecords,
    { kind: "reply", channelTurnId: 999 },
    { fallbackReplyToLastWhenChannelIdMissing: true },
  );
  assert.equal(replyWithFallback.ok, true);
  if (replyWithFallback.ok) assert.equal(replyWithFallback.record.turnId, "voice-without-message-id");
  console.log("OK: Telegram diagnostics resolve reply targets and plain last-turn targets");
}

function testVoiceClarificationAndNoAudioBytes() {
  const records = [
    makeRecord({ turnId: "voice-failed", messageId: 201, createdAt: "2026-07-04T00:02:00.000Z", result: "error" }),
    makeRecord({ turnId: "voice-success", messageId: 202, createdAt: "2026-07-04T00:03:00.000Z" }),
  ];
  assert.equal(shouldClarifyVoiceDiagnosticTarget("copy details", records), true);
  assert.equal(shouldClarifyVoiceDiagnosticTarget("copy last turn details", records), false);
  assert.equal(resolveVoiceDiagnosticFollowupTarget("last failed action"), "last failed action");
  assert.equal(resolveVoiceDiagnosticFollowupTarget("No, just the last turn."), "last turn");
  assert.equal(resolveVoiceDiagnosticFollowupTarget("read my last notification"), null);

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

function testTelegramDiagnosticCacheBoundsContract() {
  const projectRoot = process.cwd();
  const telegramRoutes = fs.readFileSync(path.join(projectRoot, "server/telegramRoutes.ts"), "utf8");

  assert.match(telegramRoutes, /MAX_TELEGRAM_DIAGNOSTIC_TURNS\s*=\s*20/);
  assert.match(telegramRoutes, /MAX_TELEGRAM_DIAGNOSTIC_CHATS\s*=\s*100/);
  assert.match(telegramRoutes, /TELEGRAM_DIAGNOSTIC_TTL_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(telegramRoutes, /pruneTelegramDiagnosticCache/);
  assert.match(telegramRoutes, /getTelegramDiagnosticTurnsForChat/);
  console.log("OK: Telegram diagnostic cache is bounded by per-chat, total-chat, and TTL limits");
}

function testTelegramVoiceDiagnosticsCaptureMessageIdContract() {
  const projectRoot = process.cwd();
  const telegramRoutes = fs.readFileSync(path.join(projectRoot, "server/telegramRoutes.ts"), "utf8");
  const telegramIntegration = fs.readFileSync(path.join(projectRoot, "server/integrations/telegram.ts"), "utf8");
  const tts = fs.readFileSync(path.join(projectRoot, "server/agent/tools/tts.ts"), "utf8");

  assert.match(telegramIntegration, /result\?:\s*\{\s*message_id:\s*number\s*\}/);
  assert.match(telegramIntegration, /messageId:\s*data\.result\?\.message_id/);
  assert.match(tts, /export type SpeakResult = \{ ok: boolean; error\?: string; messageId\?: number \}/);
  assert.match(tts, /return \{ ok: true, messageId: sent\.messageId \}/);
  assert.match(telegramRoutes, /deliveredTextMessageId = voiceResult\.messageId \?\? null/);
  console.log("OK: Telegram voice diagnostics capture reply-targetable message IDs");
}

testFailedActionCopyBundle();
testOperationLevelDiagnostics();
testSuccessfulTurnCopyBundle();
testTruthfulAppContextDiagnostics();
testAppContextTraceWiringContract();
testTelegramTargetResolution();
testVoiceClarificationAndNoAudioBytes();
testAndroidPlainTextClipboardContract();
testTelegramDiagnosticCacheBoundsContract();
testTelegramVoiceDiagnosticsCaptureMessageIdContract();
