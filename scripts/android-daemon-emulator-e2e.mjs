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
    const traits = Array.isArray(element.traits)
      ? element.traits.map((trait) => String(trait).toLowerCase())
      : [];
    const hasAccessibleIdentity = Boolean(
      element.text || element.contentDescription || element.viewId ||
      (element.label && element.label !== "FrameLayout"),
    );
    return traits.includes("enabled") && !element.sensitive && element.bounds && hasAccessibleIdentity;
  });
}

function elementText(element) {
  return [element?.label, element?.text, element?.contentDescription].filter(Boolean).join(" ");
}

function findBlockingSystemDialog(snapshot, options = {}) {
  const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
  const title = elements.find((element) => /isn't responding|is not responding|keeps stopping|has stopped/i.test(
    elementText(element),
  ));
  if (!title) return null;

  const nonDestructiveAction = elements.find((element) => element.viewId === "android:id/aerr_wait") ||
    elements.find((element) => /^wait$/i.test(elementText(element))) ||
    elements.find((element) => /^ok$/i.test(elementText(element)));
  const closeAction = elements.find((element) => element.viewId === "android:id/aerr_close") ||
    elements.find((element) => /^close app$/i.test(elementText(element)));

  const ownAppDialog = /gameplan|jarvis|com\.gameplan/i.test(elementText(title));
  const action = !ownAppDialog && closeAction && (options.allowClose || !nonDestructiveAction)
    ? closeAction
    : nonDestructiveAction;
  return { title, action };
}

function tapElementCenter(element) {
  const bounds = element?.bounds;
  const x = Number.isFinite(bounds?.centerX)
    ? bounds.centerX
    : Number.isFinite(bounds?.left) && Number.isFinite(bounds?.right)
      ? (bounds.left + bounds.right) / 2
      : null;
  const y = Number.isFinite(bounds?.centerY)
    ? bounds.centerY
    : Number.isFinite(bounds?.top) && Number.isFinite(bounds?.bottom)
      ? (bounds.top + bounds.bottom) / 2
      : null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  adbShell(`input tap ${Math.round(x)} ${Math.round(y)}`);
  return true;
}

async function reopenSettingsAfterSystemDialog(bridge, snapshot, options = {}) {
  const dialog = findBlockingSystemDialog(snapshot, options);
  if (!dialog?.action || !tapElementCenter(dialog.action)) return false;

  console.warn(`Dismissed blocking Android system dialog: ${elementText(dialog.title)}`);
  await sleep(1500);
  try {
    const openSettings = await bridge.sendOp({
      type: "android_operator_action",
      action: { type: "open_app", packageName: "com.android.settings" },
    }, 30000);
    if (!openSettings.ok || openSettings.data?.result?.ok !== true) {
      console.warn(`Retry open Settings returned non-ok result: ${JSON.stringify(openSettings)}`);
      adbShell("am start -a android.settings.SETTINGS || true");
    }
  } catch (err) {
    console.warn(`Retry open Settings via daemon failed: ${err instanceof Error ? err.message : String(err)}`);
    adbShell("am start -a android.settings.SETTINGS || true");
  }
  await sleep(1500);
  return true;
}

function readScreenHasBlockingSystemDialog(readScreen) {
  const text = Array.isArray(readScreen?.data?.text) ? readScreen.data.text.join(" ") : "";
  return /isn't responding|is not responding|keeps stopping|has stopped/i.test(text);
}

async function waitForSettingsScreenContext(bridge) {
  let lastContext = null;
  for (let i = 0; i < 15; i++) {
    const screenContext = await bridge.sendOp({ type: "android_screen_context" }, 30000);
    const elements = Array.isArray(screenContext.data?.elements) ? screenContext.data.elements : [];
    const usefulElement = findUsefulElement(screenContext.data);
    lastContext = screenContext;
    if (
      screenContext.ok &&
      screenContext.data?.foregroundPackage === "com.android.settings" &&
      elements.length > 1 &&
      usefulElement
    ) {
      return { screenContext, elements, usefulElement };
    }
    if (screenContext.ok && await reopenSettingsAfterSystemDialog(bridge, screenContext.data)) {
      continue;
    }
    await sleep(1000);
  }
  throw new Error(`Settings accessibility tree did not expose actionable elements: ${JSON.stringify(lastContext)}`);
}

async function waitForSettingsReadScreenText(bridge) {
  let lastReadScreen = null;
  for (let i = 0; i < 15; i++) {
    const readScreen = await bridge.sendOp({ type: "android_read_screen" }, 30000);
    const readText = Array.isArray(readScreen.data?.text) ? readScreen.data.text : [];
    lastReadScreen = readScreen;
    if (readScreen.ok && readScreen.data?.package === "com.android.settings" && readText.length > 0) {
      return { readScreen, readText };
    }
    if (readScreen.ok && readScreenHasBlockingSystemDialog(readScreen)) {
      const screenContext = await bridge.sendOp({ type: "android_screen_context" }, 30000);
      if (screenContext.ok && await reopenSettingsAfterSystemDialog(bridge, screenContext.data, { allowClose: true })) {
        continue;
      }
    }
    await sleep(1000);
  }
  throw new Error(`android_read_screen did not return Settings accessibility text: ${JSON.stringify(lastReadScreen)}`);
}

async function waitForDaemonAccessibilityPing(bridge) {
  let lastPing = null;
  for (let i = 0; i < 20; i++) {
    lastPing = await bridge.sendOp({ type: "ping" }, 30000);
    if (lastPing.ok && lastPing.data?.accessibilityEnabled === true) {
      return lastPing;
    }
    await sleep(1000);
  }
  throw new Error(`Ping did not confirm accessibility service: ${JSON.stringify(lastPing)}`);
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
  async function close() {
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    pending.clear();
    for (const client of wss.clients) client.close();
    await new Promise((resolve) => {
      wss.close(() => server.close(() => resolve()));
      setTimeout(resolve, 1000);
    });
  }

  return { sendOp, waitForEvent, close };
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

  await waitForDaemonAccessibilityPing(bridge);

  const openSettings = await bridge.sendOp({
    type: "android_operator_action",
    action: { type: "open_app", packageName: "com.android.settings" },
  }, 30000);
  if (!openSettings.ok || openSettings.data?.result?.ok !== true) {
    throw new Error(`android_operator_action open_app failed: ${JSON.stringify(openSettings)}`);
  }

  const { screenContext, elements, usefulElement } = await waitForSettingsScreenContext(bridge);

  const tapElement = await bridge.sendOp({
    type: "android_operator_action",
    action: { type: "tap_element", elementId: usefulElement.id },
  }, 30000);
  if (!tapElement.ok || tapElement.data?.result?.ok !== true) {
    throw new Error(`android_operator_action tap_element failed: ${JSON.stringify(tapElement)}`);
  }

  const { readText } = await waitForSettingsReadScreenText(bridge);

  const uiDump = adb(["exec-out", "uiautomator", "dump", "/dev/tty"], { capture: true });
  if (!uiDump.includes("com.android.settings")) {
    console.warn("uiautomator dump did not confirm Settings UI package; Jarvis accessibility and read_screen checks already confirmed Settings.");
  }

  console.log(JSON.stringify({
    ok: true,
    bootstrapClientKind: bootstrap.msg.clientKind,
    foregroundPackage: screenContext.data.foregroundPackage,
    screenContextElementCount: elements.length,
    tappedElementId: usefulElement.id,
    readScreenTextCount: readText.length,
  }, null, 2));

  await bridge.close();
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  console.error("--- logcat tail ---");
  console.error(collectLogcat());
  process.exit(1);
});
