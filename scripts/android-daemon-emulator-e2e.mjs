import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WebSocketServer } from "ws";

const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME || "com.gameplan";
const ACCESSIBILITY_SERVICE =
  process.env.ANDROID_ACCESSIBILITY_SERVICE ||
  "com.gameplan/com.gameplan.daemon.JarvisAccessibilityService";
const ACCESSIBILITY_SERVICE_SHORT =
  process.env.ANDROID_ACCESSIBILITY_SERVICE_SHORT ||
  `${PACKAGE_NAME}/.daemon.JarvisAccessibilityService`;
const BOOTSTRAP_TOKEN = process.env.ANDROID_DAEMON_BOOTSTRAP_TOKEN || "e2e-bootstrap-token";
const APK_PATH = process.env.ANDROID_APK_PATH || "android/app/build/outputs/apk/debug/app-debug.apk";

function sdkTool(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return name;
  const suffix = process.platform === "win32" ? ".exe" : "";
  return path.join(sdk, "platform-tools", `${name}${suffix}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}${detail ? `\n${detail}` : ""}`);
  }
  return result.stdout || "";
}

function adb(args, options = {}) {
  return run(sdkTool("adb"), args, options);
}

function adbShell(command, options = {}) {
  return adb(["shell", command], options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevice() {
  for (let i = 0; i < 60; i++) {
    const devices = adb(["devices"], { capture: true });
    if (devices.split(/\r?\n/).some((line) => /\tdevice$/.test(line))) return;
    await sleep(1000);
  }
  throw new Error("No adb device reached the ready state.");
}

async function waitForBoot() {
  for (let i = 0; i < 90; i++) {
    const booted = adbShell("getprop sys.boot_completed", { capture: true }).trim();
    if (booted === "1") return;
    await sleep(1000);
  }
  throw new Error("Android device did not finish booting.");
}

async function waitForAccessibilityService() {
  let lastValue = "";
  for (let i = 0; i < 30; i++) {
    lastValue = adbShell("settings get secure enabled_accessibility_services", { capture: true }).trim();
    if (lastValue.includes(ACCESSIBILITY_SERVICE) || lastValue.includes(ACCESSIBILITY_SERVICE_SHORT)) return;
    await sleep(1000);
  }
  throw new Error(
    `Accessibility service was not enabled: ${ACCESSIBILITY_SERVICE}; enabled_accessibility_services=${lastValue}`,
  );
}

function enableAccessibilityService() {
  adbShell(`settings put secure accessibility_enabled 1`);
  adbShell(`settings put secure enabled_accessibility_services ${ACCESSIBILITY_SERVICE}`);
  adbShell(`cmd accessibility enable-service ${ACCESSIBILITY_SERVICE} || true`);
  adbShell(`cmd accessibility enable-service ${ACCESSIBILITY_SERVICE_SHORT} || true`);
  adbShell("settings put secure touch_exploration_enabled 0 || true");
}

function collectLogcat() {
  try {
    return adb(["logcat", "-d", "-t", "600"], { capture: true });
  } catch (err) {
    return `Unable to collect logcat: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function findUsefulElement(snapshot) {
  const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
  return elements.find((element) => {
    const traits = Array.isArray(element.traits) ? element.traits : [];
    return traits.includes("ENABLED") && !element.sensitive && element.bounds;
  });
}

async function startBridge(port) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: "/api/daemon/ws" });
  const pending = new Map();
  const events = [];
  let activeSocket = null;
  let opCounter = 0;

  function waitForEvent(type, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const existing = events.find((event) => event.type === type);
      if (existing) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
      pending.set(`event:${type}`, { resolve, reject, timer });
    });
  }

  function recordEvent(event) {
    events.push(event);
    const waiter = pending.get(`event:${event.type}`);
    if (waiter) {
      clearTimeout(waiter.timer);
      pending.delete(`event:${event.type}`);
      waiter.resolve(event);
    }
  }

  function sendOp(op, timeoutMs = 30000) {
    if (!activeSocket || activeSocket.readyState !== 1) {
      throw new Error("Daemon socket is not connected.");
    }
    const id = `e2e_${++opCounter}`;
    const payload = { type: "op", id, op };
    activeSocket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for op result: ${op.type}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, op });
    });
  }

  wss.on("connection", (ws) => {
    activeSocket = ws;
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "android_app_bootstrap") {
        if (msg.bootstrapToken !== BOOTSTRAP_TOKEN) {
          ws.send(JSON.stringify({ type: "hello", ok: false, error: "bad bootstrap token" }));
          return;
        }
        recordEvent({ type: "bootstrap", msg });
        ws.send(JSON.stringify({
          type: "hello",
          ok: true,
          userId: "emulator-e2e-user",
          daemonId: "emulator-e2e-daemon",
          reconnectSecret: "emulator-e2e-secret",
        }));
        return;
      }
      if (msg.type === "result") {
        const waiter = pending.get(msg.id);
        if (waiter) {
          clearTimeout(waiter.timer);
          pending.delete(msg.id);
          waiter.resolve(msg);
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { server, sendOp, waitForEvent };
}

async function main() {
  await waitForDevice();
  await waitForBoot();
  adb(["logcat", "-c"]);
  adbShell("wm dismiss-keyguard || true");
  adbShell("input keyevent 82 || true");

  const apk = path.resolve(APK_PATH);
  if (!fs.existsSync(apk)) throw new Error(`APK not found: ${apk}`);
  adb(["install", "-r", apk]);
  adbShell(`pm grant ${PACKAGE_NAME} android.permission.POST_NOTIFICATIONS || true`);
  adbShell(`monkey -p ${PACKAGE_NAME} -c android.intent.category.LAUNCHER 1`);
  await sleep(3000);
  enableAccessibilityService();
  await waitForAccessibilityService();

  const port = Number(process.env.ANDROID_DAEMON_E2E_PORT || 18789);
  const bridge = await startBridge(port);
  adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
  adbShell(
    [
      "am broadcast",
      `-n ${PACKAGE_NAME}/.daemon.DaemonE2eReceiver`,
      "-a com.gameplan.daemon.E2E_BOOTSTRAP",
      `--es server_url http://127.0.0.1:${port}`,
      `--es bootstrap_token ${BOOTSTRAP_TOKEN}`,
    ].join(" "),
  );

  const bootstrap = await bridge.waitForEvent("bootstrap");
  if (bootstrap.msg.clientKind !== "unified_android_app") {
    throw new Error(`Expected unified_android_app clientKind, got ${bootstrap.msg.clientKind}`);
  }
  if (bootstrap.msg.appPackage !== PACKAGE_NAME) {
    throw new Error(`Expected appPackage ${PACKAGE_NAME}, got ${bootstrap.msg.appPackage}`);
  }

  const ping = await bridge.sendOp({ type: "ping" }, 30000);
  if (!ping.ok || ping.data?.accessibilityEnabled !== true) {
    throw new Error(`Ping did not confirm accessibility service: ${JSON.stringify(ping)}`);
  }

  const openSettings = await bridge.sendOp({
    type: "android_operator_action",
    action: { type: "open_app", packageName: "com.android.settings" },
  }, 30000);
  if (!openSettings.ok || openSettings.data?.result?.ok !== true) {
    throw new Error(`android_operator_action open_app failed: ${JSON.stringify(openSettings)}`);
  }

  const screenContext = await bridge.sendOp({ type: "android_screen_context" }, 30000);
  const elements = Array.isArray(screenContext.data?.elements) ? screenContext.data.elements : [];
  if (!screenContext.ok || elements.length === 0) {
    throw new Error(`android_screen_context did not return accessibility elements: ${JSON.stringify(screenContext)}`);
  }
  if (screenContext.data?.foregroundPackage !== "com.android.settings") {
    throw new Error(`Expected Settings foreground package, got ${screenContext.data?.foregroundPackage}`);
  }

  const usefulElement = findUsefulElement(screenContext.data);
  if (!usefulElement) {
    throw new Error(`No enabled non-sensitive element found in screen context: ${JSON.stringify(screenContext.data)}`);
  }

  const tapElement = await bridge.sendOp({
    type: "android_operator_action",
    action: { type: "tap_element", elementId: usefulElement.id },
  }, 30000);
  if (!tapElement.ok || tapElement.data?.result?.ok !== true) {
    throw new Error(`android_operator_action tap_element failed: ${JSON.stringify(tapElement)}`);
  }

  const readScreen = await bridge.sendOp({ type: "android_read_screen" }, 30000);
  const readText = Array.isArray(readScreen.data?.text) ? readScreen.data.text : [];
  if (!readScreen.ok || readScreen.data?.package !== "com.android.settings" || readText.length === 0) {
    throw new Error(`android_read_screen did not return Settings accessibility text: ${JSON.stringify(readScreen)}`);
  }

  const uiDump = adb(["exec-out", "uiautomator", "dump", "/dev/tty"], { capture: true });
  if (!uiDump.includes("com.android.settings")) {
    throw new Error("uiautomator dump did not confirm Settings UI package.");
  }

  console.log(JSON.stringify({
    ok: true,
    bootstrapClientKind: bootstrap.msg.clientKind,
    foregroundPackage: screenContext.data.foregroundPackage,
    screenContextElementCount: elements.length,
    tappedElementId: usefulElement.id,
    readScreenTextCount: readText.length,
  }, null, 2));

  bridge.server.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  console.error("--- logcat tail ---");
  console.error(collectLogcat());
  process.exit(1);
});
