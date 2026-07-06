import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const bridgeSource = fs.readFileSync(path.join(projectRoot, "server/daemon/bridge.ts"), "utf8");
const channelRoutesSource = fs.readFileSync(path.join(projectRoot, "server/channels/routes.ts"), "utf8");
const appUpdateSource = fs.readFileSync(path.join(projectRoot, "server/routes/appUpdateRoutes.ts"), "utf8");
const downloadRoutesSource = fs.readFileSync(path.join(projectRoot, "server/downloadRoutes.ts"), "utf8");

assert.match(
  bridgeSource,
  /req\.url\.startsWith\("\/api\/daemon\/ws"\)/,
  "Daemon bridge should keep the existing WebSocket path.",
);

assert.match(
  bridgeSource,
  /const isAndroidOp = op\.type\.startsWith\("android_"\) \|\| op\.type\.startsWith\("voice_"\)/,
  "sendDaemonOp() should continue treating android_* and voice_* ops as Android-only.",
);

assert.match(
  bridgeSource,
  /sock = userSockets\.get\(socketKey\(userId, "android"\)\)/,
  "sendDaemonOp() should route Android-only ops to the Android socket.",
);

assert.match(
  bridgeSource,
  /export async function pingAndroidDaemon[\s\S]*sendDaemonOp\(userId, \{ type: "ping" \}, timeoutMs, "android"\)/,
  "Android live capability checks should target the Android socket instead of the desktop-first neutral ping path.",
);

assert.match(
  bridgeSource,
  /android_screen_context:\s*"android_read_screen"/,
  "Android permissions should map android_screen_context to android_read_screen.",
);

assert.match(
  bridgeSource,
  /op\.type === "android_operator_action"\s*\?\s*operatorActionPermKey\(op\.action\)/,
  "android_operator_action should derive its permission from operatorActionPermKey().",
);

assert.match(
  bridgeSource,
  /type DaemonClientKind = "unified_android_app" \| "standalone_android_daemon" \| "desktop_daemon"/,
  "Bridge should define the accepted clientKind metadata values.",
);

assert.match(
  bridgeSource,
  /type AndroidDaemonClientKind = "unified_android_app" \| "standalone_android_daemon"/,
  "Android client metadata should only allow Android client kinds.",
);

assert.match(
  bridgeSource,
  /clientKind\?: DaemonClientKind/,
  "Pair/reconnect messages should accept clientKind metadata.",
);

assert.match(
  bridgeSource,
  /appPackage\?: string/,
  "Pair/reconnect messages should accept appPackage metadata.",
);

assert.match(
  bridgeSource,
  /appVersion\?: string/,
  "Pair/reconnect messages should accept appVersion metadata.",
);

assert.match(
  bridgeSource,
  /function buildAndroidDaemonClientMetadata\(platform: "desktop" \| "android"[\s\S]*if \(platform !== "android"\) return null;/,
  "Android client metadata should be gated to Android platform only.",
);

assert.match(
  bridgeSource,
  /if \(platform === "android" && prior\.android_client && !mergedMeta\.android_client\)/,
  "Desktop re-pairing should not preserve stale android_client metadata.",
);

assert.match(
  bridgeSource,
  /else if \(reconnPlatform !== "android"\) \{\s*delete storedMeta\.android_client;\s*\}/,
  "Desktop reconnect should remove stale android_client metadata.",
);

assert.match(
  bridgeSource,
  /const android_client = buildAndroidDaemonClientMetadata\(reconnPlatform, rm\);[\s\S]*storedMeta\.android_client = \{ \.\.\.priorClient, \.\.\.android_client \}/,
  "Reconnect should merge Android client metadata only after platform gating.",
);

assert.match(
  bridgeSource,
  /const android_client = buildAndroidDaemonClientMetadata\(pairPlatform, m\);[\s\S]*\{ android_client \}/,
  "Pair should record Android client metadata only after platform gating.",
);

assert.match(
  channelRoutesSource,
  /\/api\/channels\/android-daemon\/bootstrap/,
  "Channel routes should expose an authenticated Android in-app bootstrap endpoint.",
);

assert.match(
  channelRoutesSource,
  /createAndroidDaemonBootstrapToken/,
  "Android bootstrap route should use the daemon bridge token helper.",
);

assert.match(
  bridgeSource,
  /export async function createAndroidDaemonBootstrapToken/,
  "Daemon bridge should create short-lived Android app bootstrap tokens.",
);

assert.match(
  bridgeSource,
  /type:\s*"android_app_bootstrap"/,
  "Daemon bridge should accept Android app bootstrap WebSocket messages.",
);

assert.match(
  bridgeSource,
  /const userVoiceTurnGenerations = new Map<string, number>\(\)/,
  "Daemon voice bridge should track per-user voice turn generations.",
);

assert.match(
  bridgeSource,
  /if \(action === "pause" \|\| action === "paused" \|\| action === "end"\) \{\s*cancelDaemonVoiceTurns\(pairedUserId\);[\s\S]*?if \(action === "end"\) \{\s*await persistDaemonTalkModeEnabled\(pairedUserId, false\)/,
  "Outside-app voice Pause and End should cancel in-flight daemon voice turns, while only End persists Talk Mode off.",
);

assert.match(
  bridgeSource,
  /export function setDaemonVoiceApprovalHandler/,
  "Daemon bridge should expose a narrow server callback for outside-app voice approvals.",
);

assert.match(
  bridgeSource,
  /voice_set_outside_app_state/,
  "Daemon bridge should expose a voice op for resetting outside-app overlay state.",
);

assert.match(
  bridgeSource,
  /export function ackDaemonVoiceApproval/,
  "Daemon bridge should expose a React acknowledgement for foreground overlay approvals.",
);

assert.match(
  bridgeSource,
  /control\.reactActive === true && consumeDaemonVoiceApprovalAck\(pairedUserId, confirmationToken\)/,
  "Daemon approval fallback should skip tokens acknowledged by the foreground app.",
);

assert.match(
  bridgeSource,
  /setTimeout\(runApprovalFallback, VOICE_APPROVAL_REACT_FALLBACK_DELAY_MS\)/,
  "Outside-app approval controls should use an ack-gated server fallback when React reports active.",
);

assert.match(
  bridgeSource,
  /const voiceTurnGeneration = currentVoiceTurnGeneration\(userId\);[\s\S]*?isDaemonVoiceTurnCancelled\(userId, voiceTurnGeneration\)[\s\S]*?runCoachAgent[\s\S]*?isDaemonVoiceTurnCancelled\(userId, voiceTurnGeneration\)[\s\S]*?textToSpeech[\s\S]*?isDaemonVoiceTurnCancelled\(userId, voiceTurnGeneration\)[\s\S]*?voice_speak_audio/,
  "Daemon voice processing should abandon cancelled turns before continuing to session persistence or TTS playback.",
);

assert.match(
  bridgeSource,
  /bootstrapToken:\s*string/,
  "Android app bootstrap messages should carry a native-only bootstrap token.",
);

assert.match(
  bridgeSource,
  /consumeAndroidDaemonBootstrapToken/,
  "Daemon bridge should consume Android bootstrap tokens exactly once.",
);

assert.match(
  bridgeSource,
  /clientKind:\s*"unified_android_app"/,
  "Android bootstrap pairing should force unified Android app client metadata.",
);

assert.match(
  appUpdateSource,
  /platform:\s*"android-daemon"[\s\S]*legacy:\s*true[\s\S]*migrationTarget:\s*"\/api\/app-update\/android"/,
  "Android daemon update manifest should explicitly mark legacy clients and their migration target.",
);

assert.match(
  downloadRoutesSource,
  /app\.get\("\/api\/download\/android"/,
  "Download routes should expose a main Jarvis Android APK install path.",
);

assert.match(
  downloadRoutesSource,
  /jarvis-app\.apk/,
  "Main Android download route should serve the Jarvis app APK, not the legacy daemon APK.",
);

console.log("OK: Android unified daemon bridge metadata and legacy update contracts are guarded");
