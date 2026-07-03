import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

async function main() {
  const runtimeSource = fs.readFileSync(path.resolve("server/agent/tools/androidAppRuntime.ts"), "utf8");
  assert.match(runtimeSource, /checkAndIncrementScreenshotBudget/);
  assert.match(runtimeSource, /runAndroidCaptureScreen\(args,\s*ctx\.userId,\s*ctx\)/);
  assert.match(runtimeSource, /normalizedQuery\.length > 2 && normalizedCandidate\.includes\(normalizedQuery\)/);

  const {
    ANDROID_PHONE_RUNTIME_TOOL_NAMES,
    androidPhoneRuntimeTools,
    buildAndroidYoutubeSearchUrl,
    _setAndroidAppRuntimeDepsForTesting,
    explainUnsupportedPhoneRuntimeAction,
    runAndroidOpenAppByName,
    runAndroidReadNotifications,
    resolveAndroidAppName,
    summarizeAndroidNotificationDetail,
  } = await import("../tools/androidAppRuntime");
  const { _setRuntimeCapabilityDepsForTesting } = await import("../../state/runtimeCapability");

  assert.deepEqual(
    androidPhoneRuntimeTools.map((tool) => tool.name),
    [...ANDROID_PHONE_RUNTIME_TOOL_NAMES],
  );
  assert.equal(new Set(ANDROID_PHONE_RUNTIME_TOOL_NAMES).size, ANDROID_PHONE_RUNTIME_TOOL_NAMES.length);
  assert.ok(ANDROID_PHONE_RUNTIME_TOOL_NAMES.includes("android_capture_screen"));
  assert.ok(ANDROID_PHONE_RUNTIME_TOOL_NAMES.includes("android_open_phone_url"));

  const youtube = await resolveAndroidAppName("user-phone", "YouTube", { includeLiveInventory: false });
  assert.equal(youtube.app?.packageName, "com.google.android.youtube");
  assert.equal(youtube.app?.source, "static_catalog");

  const linkedIn = await resolveAndroidAppName("user-phone", "linked in", { includeLiveInventory: false });
  assert.equal(linkedIn.app?.packageName, "com.linkedin.android");

  const facebook = await resolveAndroidAppName("user-phone", "FB", { includeLiveInventory: false });
  assert.equal(facebook.app?.packageName, "com.facebook.katana");

  const camera = await resolveAndroidAppName("user-phone", "Camera", { includeLiveInventory: false });
  assert.equal(camera.app?.packageName, "com.android.camera2");
  assert.equal(camera.app?.source, "static_catalog");

  const samsungCamera = await resolveAndroidAppName("user-phone", "Samsung camera", { includeLiveInventory: false });
  assert.equal(samsungCamera.app?.packageName, "com.sec.android.app.camera");

  const phoneSettings = await resolveAndroidAppName("user-phone", "phone settings", { includeLiveInventory: false });
  assert.equal(phoneSettings.app?.packageName, "com.android.settings");

  const settingsOnPhone = await resolveAndroidAppName("user-phone", "settings on phone", { includeLiveInventory: false });
  assert.equal(settingsOnPhone.app?.packageName, "com.android.settings");

  const xApp = await resolveAndroidAppName("user-phone", "X", { includeLiveInventory: false });
  assert.equal(xApp.app?.packageName, "com.twitter.android");

  const excel = await resolveAndroidAppName("user-phone", "Excel", { includeLiveInventory: false });
  assert.equal(excel.app, null);

  assert.equal(
    buildAndroidYoutubeSearchUrl("local Gemma on Android videos"),
    "vnd.youtube://results?search_query=local%20Gemma%20on%20Android%20videos",
  );

  const inventedScreenshotTool = explainUnsupportedPhoneRuntimeAction("android_view_screenshot", "tool");
  assert.equal(inventedScreenshotTool?.ok, false);
  assert.equal(inventedScreenshotTool?.label, "Unsupported phone action");
  assert.equal(inventedScreenshotTool?.detail.attemptedAction, "android_view_screenshot");
  assert.deepEqual(
    (inventedScreenshotTool?.detail.availablePhoneRuntimeTools as string[]).filter((toolName) => (
      toolName === "android_capture_screen" || toolName === "android_youtube_search"
    )),
    ["android_youtube_search", "android_capture_screen"],
  );
  assert.equal(explainUnsupportedPhoneRuntimeAction("identify_user", "tool"), null);

  _setRuntimeCapabilityDepsForTesting({
    now: () => new Date("2026-06-25T12:00:00.000Z"),
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => ({
      desktop: { connected: false, hostname: null, lastSeenAt: null, permissions: [] },
      android: {
        connected: false,
        hostname: "Galaxy Fold6",
        lastSeenAt: "2026-06-25T11:50:00.000Z",
        activeDevice: null,
        permissions: {
          openApp: {
            status: "offline",
            reason: "Android Device Control is not connected.",
            lastCheckedAt: "2026-06-25T12:00:00.000Z",
          },
          browse: { status: "offline", reason: "Android Device Control is not connected.", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          screenCapture: { status: "offline", reason: "Android Device Control is not connected.", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          readScreen: { status: "offline", reason: "Android Device Control is not connected.", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          tapType: { status: "offline", reason: "Android Device Control is not connected.", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          accessibility: { status: "offline", reason: "Android Device Control is not connected.", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          notificationAccess: { status: "offline", reason: "Android Device Control is not connected.", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          microphone: { status: "offline", reason: "Android Device Control is not connected.", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
        },
      },
    }),
  });
  try {
    const openWhenDisconnected = await runAndroidOpenAppByName({ appName: "YouTube" }, "user-phone");
    assert.equal(openWhenDisconnected.ok, false);
    assert.equal(openWhenDisconnected.detail.source, "runtime_capability_state");
    assert.equal(openWhenDisconnected.detail.status, "offline");
    assert.match(String(openWhenDisconnected.detail.error), /Android Device Control is not connected/);
    const explanation = openWhenDisconnected.detail.runtimeExplanation as {
      title?: string;
      deterministic?: boolean;
      sources?: { attempted?: Array<{ label: string }> };
      actions?: Array<{ id: string }>;
    } | undefined;
    assert.equal(explanation?.title, "Capability unavailable");
    assert.equal(explanation?.deterministic, true);
    assert.deepEqual(explanation?.sources?.attempted?.map((source) => source.label), ["Diagnostics", "Tool"]);
    assert.equal(explanation?.actions?.[0]?.id, "check_setup");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
  }
  console.log("OK: Android app actions use runtime capability preflight before daemon work");

  _setRuntimeCapabilityDepsForTesting({
    now: () => new Date("2026-06-25T12:00:00.000Z"),
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => ({
      desktop: { connected: false, hostname: null, lastSeenAt: null, permissions: [] },
      android: {
        connected: true,
        hostname: "Galaxy Fold6",
        lastSeenAt: "2026-06-25T11:59:00.000Z",
        activeDevice: null,
        permissions: {
          openApp: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          browse: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          screenCapture: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          readScreen: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          tapType: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          accessibility: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          notificationAccess: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
          microphone: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
        },
      },
    }),
  });
  try {
    const listenerOps: string[] = [];
    const listenerObservations: Array<{ kind?: string; summary?: string; detail?: string | null }> = [];
    _setAndroidAppRuntimeDepsForTesting({
      isAndroidDaemonActive: () => true,
      isAndroidDaemonActionAllowed: async () => true,
      recordLocalRuntimeObservation: async (input) => {
        listenerObservations.push(input);
        return {} as never;
      },
      sendDaemonOp: async (_userId, op) => {
        listenerOps.push(op.type);
        assert.equal(op.type, "android_notifications_list");
        return {
          ok: true,
          data: {
            listenerEnabled: true,
            notifications: [
              {
                app: "Gmail",
                title: "Budget alert",
                text: "Railway spend is nearing the limit",
                ts: Date.parse("2026-06-25T11:55:00.000Z"),
              },
            ],
          },
        };
      },
    });
    const listenerResult = await runAndroidReadNotifications({}, "user-phone");
    assert.equal(listenerResult.ok, true);
    assert.deepEqual(listenerOps, ["android_notifications_list"]);
    assert.match(summarizeAndroidNotificationDetail(listenerResult.detail), /Gmail/);
    assert.match(summarizeAndroidNotificationDetail(listenerResult.detail), /Budget alert/);
    assert.equal(listenerObservations.length, 1);
    assert.equal(listenerObservations[0]?.kind, "notifications");
    assert.match(listenerObservations[0]?.summary ?? "", /Gmail/);

    const accessibilityOps: string[] = [];
    const accessibilityObservations: Array<{ kind?: string; summary?: string; detail?: string | null }> = [];
    _setAndroidAppRuntimeDepsForTesting({
      isAndroidDaemonActive: () => true,
      isAndroidDaemonActionAllowed: async () => true,
      recordLocalRuntimeObservation: async (input) => {
        accessibilityObservations.push(input);
        return {} as never;
      },
      sendDaemonOp: async (_userId, op) => {
        accessibilityOps.push(op.type);
        if (op.type === "android_notifications_list") {
          return { ok: true, data: { listenerEnabled: false, notifications: [] } };
        }
        if (op.type === "android_swipe") return { ok: true, data: { swiped: true } };
        if (op.type === "android_read_screen") {
          return {
            ok: true,
            data: {
              visibleText: [
                "Notifications",
                "Life360 - Justin arrived Home",
                "Codex - PR review finished",
              ],
            },
          };
        }
        if (op.type === "android_press_key") return { ok: true, data: { pressed: "back" } };
        return { ok: false, error: `unexpected op ${op.type}` };
      },
    });
    const accessibilityResult = await runAndroidReadNotifications({}, "user-phone");
    assert.equal(accessibilityResult.ok, true);
    assert.equal(accessibilityResult.detail.source, "notification_shade_accessibility_tree");
    assert.deepEqual(accessibilityOps.slice(0, 4), [
      "android_notifications_list",
      "android_swipe",
      "android_read_screen",
      "android_press_key",
    ]);
    const accessibilitySummary = summarizeAndroidNotificationDetail(accessibilityResult.detail);
    assert.match(accessibilitySummary, /notification shade/i);
    assert.match(accessibilitySummary, /Life360/);
    assert.match(accessibilitySummary, /Codex/);
    assert.equal(accessibilityObservations.length, 1);
    assert.equal(accessibilityObservations[0]?.kind, "notifications");
    assert.match(accessibilityObservations[0]?.detail ?? "", /Codex/);
  } finally {
    _setAndroidAppRuntimeDepsForTesting(null);
    _setRuntimeCapabilityDepsForTesting(null);
  }
  console.log("OK: Android notification reads use listener first and accessibility fallback deterministically");

  console.log("All Android app runtime assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
