import assert from "node:assert/strict";

import type { RuntimeCapabilityStateDeps } from "../runtimeCapability";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

const fixedNow = new Date("2026-06-25T12:00:00.000Z");

const deps: RuntimeCapabilityStateDeps = {
  now: () => fixedNow,
  loadConnectedAccounts: async () => [
    {
      id: "google",
      label: "Google",
      connected: true,
      ready: true,
      readiness: "runnable",
      status: "healthy",
      blockedReason: null,
      lastCheckedAt: "2026-06-25T11:59:00.000Z",
    },
    {
      id: "slack",
      label: "Slack",
      connected: false,
      ready: false,
      readiness: "not_linked",
      status: "unconfigured",
      blockedReason: "Account is not linked",
      lastCheckedAt: "2026-06-25T11:59:00.000Z",
    },
  ],
  loadDeviceControlState: async () => ({
    desktop: {
      connected: false,
      hostname: null,
      lastSeenAt: null,
      permissions: [],
    },
    android: {
      connected: true,
      hostname: "Galaxy Fold6",
      lastSeenAt: "2026-06-25T11:58:00.000Z",
      activeDevice: "Galaxy Fold6",
      permissions: {
        openApp: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
        browse: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
        screenCapture: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
        readScreen: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
        tapType: {
          status: "disabled",
          reason: "android_tap_type permission is disabled.",
          lastCheckedAt: "2026-06-25T12:00:00.000Z",
        },
        accessibility: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
        notificationAccess: {
          status: "disabled",
          reason: "Android notification listener is disabled.",
          lastCheckedAt: "2026-06-25T12:00:00.000Z",
        },
        microphone: {
          status: "unknown",
          reason: "Microphone permission is not reported by this daemon build.",
          lastCheckedAt: "2026-06-25T12:00:00.000Z",
        },
      },
    },
  }),
};

function userMessage(content: string) {
  return [{ role: "user" as const, content }];
}

async function testCapabilityIntentClassification() {
  const { classifyRuntimeCapabilityIntent } = await import("../runtimeCapability");
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("What accounts are connected?")), "accounts");
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("What tools do you have access to?")), "tools");
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("What tools can you use to search the web?")), "tools");
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Can you send email?")), "tools");
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Is device control connected?")), "device_control");
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Can you control my phone?")), "device_control");
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Can you take screenshots?")), "device_control");
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Can you search the web for local Gemma videos?")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Can you send email to Sam?")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Do you have access to Gmail? Send an email to Sam.")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Do you have access to Gmail? Can you send an email to Sam?")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Do you have access to GitHub? merge my PR.")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Do you have access to GitHub and can you merge my PR?")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Can you use device control to open YouTube?")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Can you control my phone and open YouTube?")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Can you use device control to take a screenshot?")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("What can you do to help me prepare for my interview?")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Open YouTube")), null);
  assert.equal(classifyRuntimeCapabilityIntent(userMessage("Send an email to Sam")), null);
  console.log("OK: runtime capability intent classifier only catches status questions");
}

async function testRuntimeCapabilityAnswersUseConnectedAccountState() {
  const { answerRuntimeCapabilityQuestion } = await import("../runtimeCapability");
  const answer = await answerRuntimeCapabilityQuestion({
    messages: userMessage("What accounts are connected?"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    routeToolNames: ["memory_search", "android_open_app_by_name", "send_email"],
  }, deps);

  assert.ok(answer);
  assert.equal(answer.providerName, "jarvis-runtime");
  assert.equal(answer.model, "gemma-4-e4b-it");
  assert.match(answer.textContent, /Google: connected and ready/);
  assert.match(answer.textContent, /Slack: not connected/);
  assert.doesNotMatch(answer.textContent, /I think|probably|maybe/i);
  console.log("OK: runtime capability account answers come from capability state");
}

async function testRuntimeCapabilityAnswersExposeDeviceControlState() {
  const { answerRuntimeCapabilityQuestion } = await import("../runtimeCapability");
  const answer = await answerRuntimeCapabilityQuestion({
    messages: userMessage("Is Android device control connected?"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    routeToolNames: ["android_open_app_by_name", "android_capture_screen"],
  }, deps);

  assert.ok(answer);
  assert.match(answer.textContent, /Android Device Control: connected/);
  assert.match(answer.textContent, /active device: Galaxy Fold6/);
  assert.match(answer.textContent, /Accessibility: ready/);
  assert.match(answer.textContent, /Screen capture: ready/);
  assert.match(answer.textContent, /Notification access: disabled/);
  assert.match(answer.textContent, /Microphone: unknown/);
  console.log("OK: runtime capability device answers expose Android preflight state");
}

async function testDeviceControlAnswersUseEffectiveAndroidPreflightState() {
  const { answerRuntimeCapabilityQuestion } = await import("../runtimeCapability");
  const answer = await answerRuntimeCapabilityQuestion({
    messages: userMessage("Can you take screenshots?"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    routeToolNames: ["android_capture_screen", "android_read_screen_context", "android_tap_screen"],
  }, {
    ...deps,
    loadDeviceControlState: async () => {
      const base = await deps.loadDeviceControlState!("user-123", "2026-06-25T12:00:00.000Z");
      return {
        ...base,
        android: {
          ...base.android,
          permissions: {
            ...base.android.permissions,
            screenCapture: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            readScreen: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            tapType: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            accessibility: {
              status: "disabled",
              reason: "Android accessibility service is disabled.",
              lastCheckedAt: "2026-06-25T12:00:00.000Z",
            },
          },
        },
      };
    },
  });

  assert.ok(answer);
  assert.match(answer.textContent, /Accessibility: disabled/);
  assert.match(answer.textContent, /Screen capture: disabled \(Android accessibility service is disabled\./);
  assert.match(answer.textContent, /Read screen: disabled \(Android accessibility service is disabled\./);
  assert.match(answer.textContent, /Tap\/type: disabled \(Android accessibility service is disabled\./);
  console.log("OK: device-control status answers use effective Android preflight readiness");
}

async function testRuntimeCapabilityToolAnswersUseRouteTools() {
  const { answerRuntimeCapabilityQuestion } = await import("../runtimeCapability");
  const answer = await answerRuntimeCapabilityQuestion({
    messages: userMessage("What tools can you use?"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    routeToolNames: ["memory_search", "android_open_app_by_name", "send_email"],
  }, deps);

  assert.ok(answer);
  assert.match(answer.textContent, /Memory: memory_search/);
  assert.match(answer.textContent, /Runtime: android_open_app_by_name/);
  assert.match(answer.textContent, /Email ready via Google: send_email/);
  assert.match(answer.textContent, /Device Control: Android connected/);
  console.log("OK: runtime capability tool answers summarize current route tools");
}

async function testRuntimeCapabilityToolAnswersExposeAccountReadiness() {
  const { answerRuntimeCapabilityQuestion } = await import("../runtimeCapability");
  const answer = await answerRuntimeCapabilityQuestion({
    messages: userMessage("Can you send email?"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    routeToolNames: ["send_email", "fetch_emails"],
  }, {
    ...deps,
    loadConnectedAccounts: async () => [
      {
        id: "google",
        label: "Google",
        connected: false,
        ready: false,
        readiness: "not_linked",
        status: "unconfigured",
        blockedReason: "Account is not linked",
        lastCheckedAt: "2026-06-25T11:59:00.000Z",
      },
      {
        id: "outlook",
        label: "Outlook",
        connected: true,
        ready: true,
        readiness: "runnable",
        status: "healthy",
        blockedReason: null,
        lastCheckedAt: "2026-06-25T11:59:00.000Z",
      },
    ],
  });

  assert.ok(answer);
  assert.match(answer.textContent, /Email ready via Outlook: send_email, fetch_emails/);
  assert.match(answer.textContent, /Device Control: Android connected/);
  console.log("OK: runtime capability tool answers include connector readiness");
}

async function testAndroidActionPreflightReturnsDeterministicReason() {
  const {
    buildRuntimeCapabilityState,
    preflightRuntimeCapabilityAction,
  } = await import("../runtimeCapability");
  const state = await buildRuntimeCapabilityState({
    userId: "user-123",
    routeToolNames: ["android_tap_screen"],
  }, deps);

  const result = preflightRuntimeCapabilityAction(state, "android_tap_type");
  assert.equal(result.ok, false);
  assert.equal(result.source, "runtime_capability_state");
  assert.equal(result.status, "disabled");
  assert.match(result.reason, /android_tap_type permission is disabled/);
  assert.equal(result.lastCheckedAt, "2026-06-25T12:00:00.000Z");
  console.log("OK: runtime capability preflight returns deterministic unavailable-action reasons");
}

async function testNotificationPreflightAllowsAccessibilityFallback() {
  const {
    buildRuntimeCapabilityState,
    preflightRuntimeCapabilityAction,
  } = await import("../runtimeCapability");
  const state = await buildRuntimeCapabilityState({
    userId: "user-123",
    routeToolNames: ["android_read_notifications"],
  }, {
    ...deps,
    loadDeviceControlState: async () => {
      const base = await deps.loadDeviceControlState!("user-123", "2026-06-25T12:00:00.000Z");
      return {
        ...base,
        android: {
          ...base.android,
          permissions: {
            ...base.android.permissions,
            tapType: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            notificationAccess: {
              status: "disabled",
              reason: "Android notification listener is disabled.",
              lastCheckedAt: "2026-06-25T12:00:00.000Z",
            },
          },
        },
      };
    },
  });

  const result = preflightRuntimeCapabilityAction(state, "android_read_notifications");
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.match(result.reason, /accessibility fallback/i);
  console.log("OK: notification preflight allows the accessibility fallback when listener access is disabled");
}

async function testAccessibilityBackedActionsRespectLiveAccessibilityFallbacks() {
  const {
    buildRuntimeCapabilityState,
    preflightRuntimeCapabilityAction,
  } = await import("../runtimeCapability");
  const state = await buildRuntimeCapabilityState({
    userId: "user-123",
    routeToolNames: ["android_open_app_by_name", "android_open_url", "android_capture_screen", "android_read_screen_context", "android_tap_screen"],
  }, {
    ...deps,
    loadDeviceControlState: async () => {
      const base = await deps.loadDeviceControlState!("user-123", "2026-06-25T12:00:00.000Z");
      return {
        ...base,
        android: {
          ...base.android,
          permissions: {
            ...base.android.permissions,
            openApp: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            browse: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            screenCapture: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            readScreen: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            tapType: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            accessibility: {
              status: "disabled",
              reason: "Android accessibility service is disabled.",
              lastCheckedAt: "2026-06-25T12:00:00.000Z",
            },
          },
        },
      };
    },
  });

  const openResult = preflightRuntimeCapabilityAction(state, "android_open_app");
  assert.equal(openResult.ok, true);
  assert.equal(openResult.status, "ready");
  assert.match(openResult.reason, /notification fallback/i);

  const browseResult = preflightRuntimeCapabilityAction(state, "android_browse");
  assert.equal(browseResult.ok, true);
  assert.equal(browseResult.status, "ready");
  assert.match(browseResult.reason, /notification fallback/i);

  const captureResult = preflightRuntimeCapabilityAction(state, "android_capture_screen");
  assert.equal(captureResult.ok, false);
  assert.equal(captureResult.status, "disabled");
  assert.match(captureResult.reason, /accessibility service is disabled/i);

  const readResult = preflightRuntimeCapabilityAction(state, "android_read_screen");
  assert.equal(readResult.ok, false);
  assert.equal(readResult.status, "disabled");
  assert.match(readResult.reason, /accessibility service is disabled/i);

  const notificationResult = preflightRuntimeCapabilityAction(state, "android_read_notifications");
  assert.equal(notificationResult.ok, false);
  assert.equal(notificationResult.status, "disabled");
  assert.match(notificationResult.reason, /accessibility service is disabled/i);
  console.log("OK: Android preflights preserve open/browse fallback while gating accessibility-only actions");
}

async function testAccessibilityBackedActionsAllowUnknownLiveAccessibility() {
  const {
    buildRuntimeCapabilityState,
    preflightRuntimeCapabilityAction,
  } = await import("../runtimeCapability");
  const state = await buildRuntimeCapabilityState({
    userId: "user-123",
    routeToolNames: ["android_capture_screen", "android_read_screen_context", "android_tap_screen"],
  }, {
    ...deps,
    loadDeviceControlState: async () => {
      const base = await deps.loadDeviceControlState!("user-123", "2026-06-25T12:00:00.000Z");
      return {
        ...base,
        android: {
          ...base.android,
          permissions: {
            ...base.android.permissions,
            screenCapture: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            readScreen: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            tapType: { status: "ready", lastCheckedAt: "2026-06-25T12:00:00.000Z" },
            accessibility: {
              status: "unknown",
              reason: "Accessibility status is not reported by this daemon build.",
              lastCheckedAt: "2026-06-25T12:00:00.000Z",
            },
          },
        },
      };
    },
  });

  const captureResult = preflightRuntimeCapabilityAction(state, "android_capture_screen");
  assert.equal(captureResult.ok, true);
  assert.equal(captureResult.status, "ready");

  const readResult = preflightRuntimeCapabilityAction(state, "android_read_screen");
  assert.equal(readResult.ok, true);
  assert.equal(readResult.status, "ready");

  const tapResult = preflightRuntimeCapabilityAction(state, "android_tap_type");
  assert.equal(tapResult.ok, true);
  assert.equal(tapResult.status, "ready");
  console.log("OK: Android preflights allow capture/read/tap when live accessibility is unknown");
}

async function main() {
  await testCapabilityIntentClassification();
  await testRuntimeCapabilityAnswersUseConnectedAccountState();
  await testRuntimeCapabilityAnswersExposeDeviceControlState();
  await testDeviceControlAnswersUseEffectiveAndroidPreflightState();
  await testRuntimeCapabilityToolAnswersUseRouteTools();
  await testRuntimeCapabilityToolAnswersExposeAccountReadiness();
  await testAndroidActionPreflightReturnsDeterministicReason();
  await testNotificationPreflightAllowsAccessibilityFallback();
  await testAccessibilityBackedActionsRespectLiveAccessibilityFallbacks();
  await testAccessibilityBackedActionsAllowUnknownLiveAccessibility();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
