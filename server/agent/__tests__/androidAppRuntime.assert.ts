import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

async function main() {
  const runtimeSource = fs.readFileSync(path.resolve("server/agent/tools/androidAppRuntime.ts"), "utf8");
  const daemonToolSource = fs.readFileSync(path.resolve("server/agent/tools/daemon.ts"), "utf8");
  const daemonBridgeSource = fs.readFileSync(path.resolve("server/daemon/bridge.ts"), "utf8");
  for (const opHandlerPath of [
    "android/app/src/main/java/com/gameplan/daemon/OpHandler.kt",
    "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/OpHandler.kt",
    "android-daemon/app/src/main/java/com/jarvis/daemon/OpHandler.kt",
  ]) {
    const opHandlerSource = fs.readFileSync(path.resolve(opHandlerPath), "utf8");
    assert.doesNotMatch(opHandlerSource, /"com\.ubercab"\s+to\s+listOf\("com\.ubercab\.driver"\)/);
    assert.match(opHandlerSource, /svc\.launchApp\(packageName, requestedActivity\)/);
  }
  assert.match(runtimeSource, /checkAndIncrementScreenshotBudget/);
  assert.match(runtimeSource, /runAndroidCaptureScreen\(args,\s*ctx\.userId,\s*ctx\)/);
  assert.doesNotMatch(runtimeSource, /normalizedQuery\.includes\(normalizedCandidate\)/);
  assert.match(daemonToolSource, /clearVoiceNotificationObservation/);
  assert.match(daemonBridgeSource, /persistDaemonVoiceExchange/);
  assert.match(daemonBridgeSource, /persistFastCoachExchange/);
  assert.match(daemonBridgeSource, /if \(responseText\) \{\s*await persistDaemonVoiceExchange\(userId, utterance, responseText\);/);
  assert.doesNotMatch(
    daemonToolSource,
    /const count = rawNotifications\.length;\s*recordVoiceNotificationObservation\(ctx\.userId, rawNotifications\);/,
  );
  assert.match(
    daemonToolSource,
    /if \(listenerEnabled && count === 0\) \{\s*recordVoiceNotificationObservation\(ctx\.userId, \[\]\);/,
  );

  const {
    ANDROID_PHONE_RUNTIME_TOOL_NAMES,
    androidPhoneRuntimeTools,
    buildAndroidYoutubeSearchUrl,
    confirmInstalledAndroidAppName,
    _setAndroidAppRuntimeDepsForTesting,
    explainUnsupportedPhoneRuntimeAction,
    runAndroidOpenAppByName,
    runAndroidReadNotifications,
    runAndroidYoutubeSearch,
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

  const amazon = await resolveAndroidAppName("user-phone", "Amazon Shopping", { includeLiveInventory: false });
  assert.equal(amazon.app?.packageName, "com.amazon.mShop.android.shopping");
  assert.equal(amazon.app?.source, "static_catalog");

  const genericAmazon = await resolveAndroidAppName("user-phone", "Amazon", { includeLiveInventory: false });
  assert.equal(genericAmazon.app?.packageName, "com.amazon.mShop.android.shopping");
  for (const ambiguousBrandApp of [
    "Amazon Music",
    "Amazon Prime Video",
    "Facebook Dating",
    "my Amazon Music",
    "please open Facebook Dating",
    "anything but Facebook",
    "neither Amazon nor Facebook",
    "Amazon or Facebook",
  ]) {
    const ambiguous = await resolveAndroidAppName("user-phone", ambiguousBrandApp, { includeLiveInventory: false });
    assert.equal(ambiguous.app, null, `${ambiguousBrandApp} must not resolve by a shorter brand alias`);
  }

  _setAndroidAppRuntimeDepsForTesting({
    isAndroidDaemonActive: () => true,
    isAndroidDaemonActionAllowed: async () => true,
    sendDaemonOp: async () => ({
      ok: true,
      data: {
        apps: [
          { label: "Amazon Music", packageName: "com.amazon.mp3" },
          { label: "Amazon Shopping", packageName: "com.amazon.mShop.android.shopping" },
          { label: "Chrome Beta", packageName: "com.chrome.beta" },
          { label: "DoorDash", packageName: "com.doordash" },
          { label: "Facebook", packageName: "com.example.facebook" },
          { label: "Facebook", packageName: "com.facebook.katana" },
          { label: "FBReader", packageName: "org.geometerplus.zlibrary.ui.android" },
          { label: "Spotify Plus", packageName: "com.example.spotify.plus" },
          { label: "Pokémon GO", packageName: "com.nianticlabs.pokemongo" },
          { label: "微信", packageName: "com.tencent.mm" },
          { label: "Cash App", packageName: "com.squareup.cash" },
          { label: "Calendar", packageName: "com.google.android.calendar" },
          { label: "Teams", packageName: "com.microsoft.teams" },
          { label: "The Weather Channel", packageName: "com.weather.Weather" },
          { label: "Keep Notes", packageName: "com.google.android.keep" },
          { label: "Calendar Work", packageName: "com.google.android.calendar", activityName: "com.google.android.calendar.WorkActivity" },
          { label: "Acme", packageName: "com.example.acme.one" },
          { label: "Acme", packageName: "com.example.acme.two" },
        ],
      },
    }),
  });
  const amazonWithLiveInventory = await resolveAndroidAppName("user-phone", "Amazon");
  assert.equal(amazonWithLiveInventory.app?.packageName, "com.amazon.mShop.android.shopping");
  const chromeWithLiveInventory = await resolveAndroidAppName("user-phone", "Chrome");
  assert.equal(chromeWithLiveInventory.app?.packageName, "com.android.chrome");
  const doorWithLiveInventory = await resolveAndroidAppName("user-phone", "door");
  assert.equal(doorWithLiveInventory.app, null);
  const doorDashWithLiveInventory = await resolveAndroidAppName("user-phone", "DoorDash");
  assert.equal(doorDashWithLiveInventory.app?.packageName, "com.doordash");
  const facebookAliasWithLiveInventory = await resolveAndroidAppName("user-phone", "FB");
  assert.equal(facebookAliasWithLiveInventory.app?.packageName, "com.facebook.katana");
  const spotifyWithLivePrefix = await resolveAndroidAppName("user-phone", "Spotify");
  assert.equal(spotifyWithLivePrefix.app?.packageName, "com.spotify.music");
  const unicodeAppWithLiveInventory = await resolveAndroidAppName("user-phone", "Pokémon GO");
  assert.equal(unicodeAppWithLiveInventory.app?.packageName, "com.nianticlabs.pokemongo");
  const nonLatinAppWithLiveInventory = await resolveAndroidAppName("user-phone", "微信");
  assert.equal(nonLatinAppWithLiveInventory.app?.packageName, "com.tencent.mm");
  const cashAppWithLiveInventory = await resolveAndroidAppName("user-phone", "Cash App");
  assert.equal(cashAppWithLiveInventory.app?.packageName, "com.squareup.cash");
  const calendarWithLiveInventory = await resolveAndroidAppName("user-phone", "Calendar");
  assert.equal(calendarWithLiveInventory.app?.packageName, "com.google.android.calendar");
  const leadingArticleWithLiveInventory = await resolveAndroidAppName("user-phone", "Weather Channel");
  assert.equal(leadingArticleWithLiveInventory.app?.packageName, "com.weather.Weather");
  const notesWithLiveInventory = await resolveAndroidAppName("user-phone", "Notes");
  assert.equal(notesWithLiveInventory.app?.packageName, "com.google.android.keep");
  const secondaryLauncher = await resolveAndroidAppName("user-phone", "Calendar Work");
  assert.equal(secondaryLauncher.app?.activityName, "com.google.android.calendar.WorkActivity");
  const ambiguousLiveLabel = await resolveAndroidAppName("user-phone", "Acme");
  assert.equal(ambiguousLiveLabel.app, null);
  const missingTeamSpeak = await resolveAndroidAppName("user-phone", "TeamSpeak");
  assert.equal(missingTeamSpeak.app, null);
  _setAndroidAppRuntimeDepsForTesting(null);

  _setAndroidAppRuntimeDepsForTesting({
    isAndroidDaemonActive: () => true,
    isAndroidDaemonActionAllowed: async () => true,
    sendDaemonOp: async () => ({
      ok: true,
      data: {
        apps: [
          { label: "Keep Notes", packageName: "com.google.android.keep" },
          { label: "Meeting Notes", packageName: "com.example.meetingnotes" },
        ],
      },
    }),
  });
  const ambiguousNotes = await resolveAndroidAppName("user-phone", "Notes");
  assert.equal(ambiguousNotes.app, null);
  assert.equal(await confirmInstalledAndroidAppName("user-phone", "Notes"), null);
  _setAndroidAppRuntimeDepsForTesting(null);

  let deniedInventoryCalls = 0;
  _setAndroidAppRuntimeDepsForTesting({
    isAndroidDaemonActive: () => true,
    isAndroidDaemonActionAllowed: async () => false,
    sendDaemonOp: async () => {
      deniedInventoryCalls += 1;
      return { ok: true, data: { apps: [] } };
    },
  });
  assert.equal(await confirmInstalledAndroidAppName("user-phone", "Obsidian"), null);
  assert.equal(deniedInventoryCalls, 0);
  _setAndroidAppRuntimeDepsForTesting(null);

  _setAndroidAppRuntimeDepsForTesting({
    isAndroidDaemonActive: () => true,
    sendDaemonOp: async () => ({
      ok: true,
      data: { apps: [{ label: "Amazon Music", packageName: "com.amazon.mp3" }] },
    }),
  });
  const amazonWithoutShopping = await resolveAndroidAppName("user-phone", "Amazon");
  assert.equal(amazonWithoutShopping.app?.packageName, "com.amazon.mShop.android.shopping");
  _setAndroidAppRuntimeDepsForTesting(null);

  let explicitPackageInventoryCalls = 0;
  _setAndroidAppRuntimeDepsForTesting({
    isAndroidDaemonActive: () => true,
    sendDaemonOp: async () => {
      explicitPackageInventoryCalls += 1;
      return { ok: false, error: "android_list_apps unsupported" };
    },
  });
  const explicitPackage = await resolveAndroidAppName("user-phone", "de.blinkt.openvpn");
  assert.equal(explicitPackage.app?.packageName, "de.blinkt.openvpn");
  assert.equal(explicitPackage.app?.source, "explicit_package");
  assert.equal(explicitPackageInventoryCalls, 0);
  _setAndroidAppRuntimeDepsForTesting(null);

  const amazonPackage = await resolveAndroidAppName("user-phone", "com.amazon.mShop.android.shopping", { includeLiveInventory: false });
  assert.equal(amazonPackage.app?.packageName, "com.amazon.mShop.android.shopping");

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
    const listenerVoiceNotificationObservations: unknown[][] = [];
    _setAndroidAppRuntimeDepsForTesting({
      isAndroidDaemonActive: () => true,
      isAndroidDaemonActionAllowed: async () => true,
      recordLocalRuntimeObservation: async (input) => {
        listenerObservations.push(input);
        return {} as never;
      },
      recordVoiceNotificationObservation: (_userId, notifications) => {
        listenerVoiceNotificationObservations.push(notifications);
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
    assert.equal(listenerVoiceNotificationObservations.length, 1);
    assert.match(JSON.stringify(listenerVoiceNotificationObservations[0]), /Budget alert/);

    const emptyListenerVoiceNotificationObservations: unknown[][] = [];
    _setAndroidAppRuntimeDepsForTesting({
      isAndroidDaemonActive: () => true,
      isAndroidDaemonActionAllowed: async () => true,
      recordLocalRuntimeObservation: async () => ({} as never),
      recordVoiceNotificationObservation: (_userId, notifications) => {
        emptyListenerVoiceNotificationObservations.push(notifications);
      },
      sendDaemonOp: async (_userId, op) => {
        assert.equal(op.type, "android_notifications_list");
        return { ok: true, data: { listenerEnabled: true, notifications: [] } };
      },
    });
    const emptyListenerResult = await runAndroidReadNotifications({}, "user-phone");
    assert.equal(emptyListenerResult.ok, true);
    assert.equal(emptyListenerResult.label, "No notifications");
    assert.deepEqual(emptyListenerVoiceNotificationObservations, [[]]);

    const accessibilityOps: string[] = [];
    const accessibilityObservations: Array<{ kind?: string; summary?: string; detail?: string | null }> = [];
    const accessibilityVoiceNotificationObservations: unknown[][] = [];
    const accessibilityVoiceNotificationClears: string[] = [];
    _setAndroidAppRuntimeDepsForTesting({
      isAndroidDaemonActive: () => true,
      isAndroidDaemonActionAllowed: async () => true,
      recordLocalRuntimeObservation: async (input) => {
        accessibilityObservations.push(input);
        return {} as never;
      },
      recordVoiceNotificationObservation: (_userId, notifications) => {
        accessibilityVoiceNotificationObservations.push(notifications);
      },
      clearVoiceNotificationObservation: (userId) => {
        accessibilityVoiceNotificationClears.push(userId);
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
              clickable: Array.from({ length: 400 }, (_, index) => `debug node ${index}`),
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
    assert.match(accessibilitySummary, /Life360/);
    assert.match(accessibilitySummary, /Codex/);
    assert.doesNotMatch(accessibilitySummary, /visibleText|android_read_screen|\{/);
    assert.equal(accessibilityObservations.length, 1);
    assert.equal(accessibilityObservations[0]?.kind, "notifications");
    assert.match(accessibilityObservations[0]?.detail ?? "", /Codex/);
    assert.doesNotMatch(accessibilityObservations[0]?.detail ?? "", /visibleText/);
    assert.equal(accessibilityVoiceNotificationObservations.length, 1);
    assert.match(JSON.stringify(accessibilityVoiceNotificationObservations[0]), /Life360/);
    assert.match(JSON.stringify(accessibilityVoiceNotificationObservations[0]), /Codex/);
    assert.deepEqual(accessibilityVoiceNotificationClears, ["user-phone"]);

    const failedListenerOps: string[] = [];
    const failedListenerVoiceNotificationClears: string[] = [];
    const failedListenerVoiceNotificationObservations: unknown[][] = [];
    _setAndroidAppRuntimeDepsForTesting({
      isAndroidDaemonActive: () => true,
      isAndroidDaemonActionAllowed: async () => true,
      recordLocalRuntimeObservation: async () => ({} as never),
      recordVoiceNotificationObservation: (_userId, notifications) => {
        failedListenerVoiceNotificationObservations.push(notifications);
      },
      clearVoiceNotificationObservation: (userId) => {
        failedListenerVoiceNotificationClears.push(userId);
      },
      sendDaemonOp: async (_userId, op) => {
        failedListenerOps.push(op.type);
        if (op.type === "android_notifications_list") {
          return { ok: false, error: "listener unavailable" };
        }
        if (op.type === "android_swipe") return { ok: true, data: { swiped: true } };
        if (op.type === "android_read_screen") {
          return {
            ok: true,
            data: {
              visibleText: [
                "Notifications",
                "Bank - Card charge approved",
              ],
              clickable: Array.from({ length: 400 }, (_, index) => `debug node ${index}`),
            },
          };
        }
        if (op.type === "android_press_key") return { ok: true, data: { pressed: "back" } };
        return { ok: false, error: `unexpected op ${op.type}` };
      },
    });
    const failedListenerResult = await runAndroidReadNotifications({}, "user-phone");
    assert.equal(failedListenerResult.ok, true);
    assert.equal(failedListenerResult.detail.source, "notification_shade_accessibility_tree");
    assert.deepEqual(failedListenerVoiceNotificationClears, ["user-phone"]);
    assert.equal(failedListenerVoiceNotificationObservations.length, 1);
    assert.match(JSON.stringify(failedListenerVoiceNotificationObservations[0]), /Bank/);
    assert.match(summarizeAndroidNotificationDetail(failedListenerResult.detail), /Bank/);
    assert.deepEqual(failedListenerOps.slice(0, 4), [
      "android_notifications_list",
      "android_swipe",
      "android_read_screen",
      "android_press_key",
    ]);

    const unreadableShadeVoiceNotificationObservations: unknown[][] = [];
    const unreadableShadeVoiceNotificationClears: string[] = [];
    _setAndroidAppRuntimeDepsForTesting({
      isAndroidDaemonActive: () => true,
      isAndroidDaemonActionAllowed: async () => true,
      recordLocalRuntimeObservation: async () => ({} as never),
      recordVoiceNotificationObservation: (_userId, notifications) => {
        unreadableShadeVoiceNotificationObservations.push(notifications);
      },
      clearVoiceNotificationObservation: (userId) => {
        unreadableShadeVoiceNotificationClears.push(userId);
      },
      sendDaemonOp: async (_userId, op) => {
        if (op.type === "android_notifications_list") {
          return { ok: true, data: { listenerEnabled: false, notifications: [] } };
        }
        if (op.type === "android_swipe") return { ok: true, data: { swiped: true } };
        if (op.type === "android_read_screen") {
          return {
            ok: true,
            data: {
              visibleText: ["Notifications", "Expand"],
              clickable: Array.from({ length: 400 }, (_, index) => `debug node ${index}`),
            },
          };
        }
        if (op.type === "android_press_key") return { ok: true, data: { pressed: "back" } };
        return { ok: false, error: `unexpected op ${op.type}` };
      },
    });
    const unreadableShadeResult = await runAndroidReadNotifications({}, "user-phone");
    assert.equal(unreadableShadeResult.ok, true);
    assert.equal(Array.isArray(unreadableShadeResult.detail.notifications), false);
    assert.match(summarizeAndroidNotificationDetail(unreadableShadeResult.detail), /could not find readable notification entries/i);
    assert.doesNotMatch(summarizeAndroidNotificationDetail(unreadableShadeResult.detail), /no current notifications/i);
    assert.deepEqual(unreadableShadeVoiceNotificationObservations, []);
    assert.deepEqual(unreadableShadeVoiceNotificationClears, ["user-phone", "user-phone"]);

    const youtubeOps: string[] = [];
    const youtubeObservations: Array<{ kind?: string; summary?: string; detail?: string | null }> = [];
    _setAndroidAppRuntimeDepsForTesting({
      isAndroidDaemonActive: () => true,
      isAndroidDaemonActionAllowed: async () => true,
      recordLocalRuntimeObservation: async (input) => {
        youtubeObservations.push(input);
        return {} as never;
      },
      sendDaemonOp: async (_userId, op) => {
        youtubeOps.push(op.type);
        if (op.type === "android_list_apps") {
          return {
            ok: true,
            data: { apps: [{ label: "YouTube", packageName: "com.google.android.youtube" }] },
          };
        }
        if (op.type === "android_browse") {
          assert.match(op.url, /^vnd\.youtube:\/\/results\?search_query=/);
          return { ok: true, data: { opened: op.url } };
        }
        if (op.type === "android_read_screen") {
          return {
            ok: true,
            data: {
              visibleText: [
                "YouTube",
                "AI videos",
                "Alex Hormozi interview",
              ],
            },
          };
        }
        return { ok: false, error: `unexpected op ${op.type}` };
      },
    });
    const youtubeResult = await runAndroidYoutubeSearch({ query: "AI videos" }, "user-phone");
    assert.equal(youtubeResult.ok, true);
    assert.deepEqual(youtubeOps, ["android_list_apps", "android_browse", "android_read_screen"]);
    assert.equal(youtubeObservations.length, 1);
    assert.equal(youtubeObservations[0]?.kind, "search_result");
    assert.match(youtubeObservations[0]?.summary ?? "", /YouTube search: AI videos/);
    assert.match(youtubeObservations[0]?.detail ?? "", /Alex Hormozi/);
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
