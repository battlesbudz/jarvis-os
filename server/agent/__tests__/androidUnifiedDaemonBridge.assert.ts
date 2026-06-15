import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const bridgeSource = fs.readFileSync(path.join(projectRoot, "server/daemon/bridge.ts"), "utf8");
const appUpdateSource = fs.readFileSync(path.join(projectRoot, "server/routes/appUpdateRoutes.ts"), "utf8");

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
  appUpdateSource,
  /platform:\s*"android-daemon"[\s\S]*legacy:\s*true[\s\S]*migrationTarget:\s*"\/api\/app-update\/android"/,
  "Android daemon update manifest should explicitly mark legacy clients and their migration target.",
);

console.log("OK: Android unified daemon bridge metadata and legacy update contracts are guarded");
