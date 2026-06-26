import assert from "node:assert/strict";

import type { PhoneGemmaDiagnosticDeps } from "../phoneGemmaDiagnostics";
import type { RuntimeCapabilityStateDeps } from "../runtimeCapability";

const fixedNow = new Date("2026-06-26T09:00:00.000Z");

function approvedResetTarget(requestId = "approved-phone-gemma-request") {
  return {
    requestId,
    scope: "tracked_phone_gemma_request" as const,
    capturedAt: fixedNow.toISOString(),
  };
}

function userMessage(content: string) {
  return [{ role: "user" as const, content }];
}

async function resetModule() {
  const mod = await import("../phoneGemmaDiagnostics");
  mod.clearPhoneGemmaDiagnosticsForTesting();
  mod._setPhoneGemmaDiagnosticDepsForTesting(null);
  return mod;
}

async function testLatestDiagnosticReplacesOlderResultAndExpires() {
  const {
    getLatestPhoneGemmaDiagnostic,
    recordPhoneGemmaDiagnosticResult,
  } = await resetModule();

  const key = {
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  };

  recordPhoneGemmaDiagnosticResult({
    ...key,
    status: "failed",
    checkedAt: "2026-06-26T08:00:00.000Z",
    checks: [
      {
        id: "ready_response",
        label: "READY response",
        status: "failed",
        detail: "Phone Gemma returned blank text.",
      },
    ],
  });
  recordPhoneGemmaDiagnosticResult({
    ...key,
    status: "passed",
    checkedAt: "2026-06-26T09:00:00.000Z",
    checks: [
      {
        id: "ready_response",
        label: "READY response",
        status: "passed",
        detail: "Returned READY.",
      },
    ],
  });

  const fresh = getLatestPhoneGemmaDiagnostic(key, { now: () => fixedNow });
  assert.equal(fresh.state, "fresh");
  assert.equal(fresh.result?.status, "passed");
  assert.equal(fresh.result?.checks[0]?.detail, "Returned READY.");

  const stale = getLatestPhoneGemmaDiagnostic(key, {
    now: () => new Date("2026-07-04T09:00:00.000Z"),
  });
  assert.equal(stale.state, "stale");
  assert.equal(stale.result?.status, "passed");
  assert.equal(stale.expiresAt, "2026-07-03T09:00:00.000Z");
  console.log("OK: Phone Gemma diagnostics keep only the latest per device/model/profile and expire after a week");
}

async function testDiagnosticAnswersUseRuntimeState() {
  const {
    answerPhoneGemmaDiagnosticQuestion,
    classifyPhoneGemmaDiagnosticIntent,
    recordPhoneGemmaDiagnosticResult,
  } = await resetModule();

  const key = {
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  };

  recordPhoneGemmaDiagnosticResult({
    ...key,
    status: "failed",
    checkedAt: "2026-06-26T08:50:00.000Z",
    checks: [
      {
        id: "identity",
        label: "Runtime identity",
        status: "passed",
        detail: "Jarvis identity came from runtime state.",
      },
      {
        id: "simple_math",
        label: "Simple math",
        status: "failed",
        detail: "7 + 5 response was blank.",
      },
    ],
  });

  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Is Jarvis working correctly?")), null);
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Does the local model support tool calls?")), null);
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Is local model selected?")), null);
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Does Phone Gemma support tool calls?")), null);
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Stop using the local model.")), null);
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Test Phone Gemma")), "run_diagnostic");
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Can you test the local model?")), "run_diagnostic");
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Does Phone Gemma test pass?")), "status");
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Is Phone Gemma working correctly?")), "status");
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("What is Phone Gemma diagnostic status?")), "status");
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Reset the local model runtime.")), "fix");
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("Cancel the local model generation.")), "fix");
  assert.equal(classifyPhoneGemmaDiagnosticIntent(userMessage("The Phone Gemma request is stuck, cancel it.")), "fix");

  const answer = await answerPhoneGemmaDiagnosticQuestion({
    messages: userMessage("Is Phone Gemma working correctly?"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    deviceId: "galaxy-fold6",
    profileId: "gpu-standard-512",
  }, { now: () => fixedNow });

  assert.ok(answer);
  assert.equal(answer.providerName, "jarvis-runtime");
  assert.equal(answer.model, "gemma-4-e4b-it");
  assert.match(answer.textContent, /Phone Gemma is not passing diagnostics/);
  assert.match(answer.textContent, /Simple math: failed/);
  assert.match(answer.textContent, /Sources: Diagnostics\./);
  assert.deepEqual(answer.runtimeExplanation?.sources.used.map((source) => source.label), ["Diagnostics"]);

  const routeScopedAnswer = await answerPhoneGemmaDiagnosticQuestion({
    messages: userMessage("Is Phone Gemma working?"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
  }, { now: () => fixedNow });
  assert.ok(routeScopedAnswer);
  assert.match(routeScopedAnswer.textContent, /Simple math: failed/);

  const prefixedRouteAnswer = await answerPhoneGemmaDiagnosticQuestion({
    messages: userMessage("Is Phone Gemma working?"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "android-local-gemma/gemma-4-e4b-it" },
  }, { now: () => fixedNow });
  assert.ok(prefixedRouteAnswer);
  assert.match(prefixedRouteAnswer.textContent, /Simple math: failed/);

  const missing = await answerPhoneGemmaDiagnosticQuestion({
    messages: userMessage("Is Phone Gemma working?"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    deviceId: "new-phone",
    profileId: "gpu-standard-512",
  }, { now: () => fixedNow });
  assert.ok(missing);
  assert.match(missing.textContent, /I don't have a recent Phone Gemma diagnostic/);
  assert.match(missing.textContent, /Attempted: Diagnostics\./);
  console.log("OK: Phone Gemma diagnostic answers are deterministic runtime state answers");
}

async function testQuickDiagnosticCoversCoreChecksAndDoesNotWriteMemory() {
  const {
    getLatestPhoneGemmaDiagnostic,
    runPhoneGemmaQuickDiagnostic,
  } = await resetModule();

  let memoryWrites = 0;
  const deps: PhoneGemmaDiagnosticDeps = {
    now: () => fixedNow,
    runIdentityCheck: async () => ({ status: "passed", detail: "Jarvis identity came from runtime state." }),
    runReadyResponseCheck: async () => ({ status: "passed", detail: "Returned READY." }),
    runSimpleMathCheck: async () => ({ status: "passed", detail: "7 + 5 matched." }),
    runMemoryLookupCheck: async () => ({ status: "skipped", detail: "No test-safe memory fixture available." }),
    runOpenYoutubeCheck: async () => ({ status: "passed", detail: "Open YouTube preflight passed." }),
    runCancelSanityCheck: async () => ({ status: "passed", detail: "Cancel request acknowledged." }),
    writeMemory: async () => {
      memoryWrites += 1;
    },
  };

  const result = await runPhoneGemmaQuickDiagnostic({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  }, deps);

  assert.equal(result.status, "passed");
  assert.deepEqual(result.checks.map((check) => check.id), [
    "identity",
    "ready_response",
    "simple_math",
    "memory_lookup",
    "open_youtube",
    "cancel_sanity",
  ]);
  assert.equal(memoryWrites, 0);

  const latest = getLatestPhoneGemmaDiagnostic({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  }, deps);
  assert.equal(latest.result?.checkedAt, "2026-06-26T09:00:00.000Z");
  assert.equal(latest.result?.status, "passed");
  console.log("OK: Phone Gemma quick diagnostics cover core checks without writing MemoryOS memories");
}

async function testOpenYoutubeDiagnosticUsesPreflightOnly() {
  const {
    runPhoneGemmaQuickDiagnostic,
  } = await resetModule();
  const { _setRuntimeCapabilityDepsForTesting } = await import("../runtimeCapability");

  const capabilityDeps: RuntimeCapabilityStateDeps = {
    now: () => fixedNow,
    loadConnectedAccounts: async () => [],
    loadDeviceControlState: async () => ({
      desktop: { connected: false, hostname: null, lastSeenAt: null, permissions: [] },
      android: {
        connected: true,
        hostname: "Galaxy Fold6",
        lastSeenAt: "2026-06-26T08:59:00.000Z",
        activeDevice: "Galaxy Fold6",
        permissions: {
          openApp: { status: "ready", lastCheckedAt: "2026-06-26T09:00:00.000Z" },
          browse: { status: "ready", lastCheckedAt: "2026-06-26T09:00:00.000Z" },
          screenCapture: { status: "ready", lastCheckedAt: "2026-06-26T09:00:00.000Z" },
          readScreen: { status: "ready", lastCheckedAt: "2026-06-26T09:00:00.000Z" },
          tapType: { status: "ready", lastCheckedAt: "2026-06-26T09:00:00.000Z" },
          accessibility: { status: "ready", lastCheckedAt: "2026-06-26T09:00:00.000Z" },
          notificationAccess: { status: "ready", lastCheckedAt: "2026-06-26T09:00:00.000Z" },
          microphone: { status: "unknown", reason: "Not reported.", lastCheckedAt: "2026-06-26T09:00:00.000Z" },
        },
      },
    }),
  };

  try {
    _setRuntimeCapabilityDepsForTesting(capabilityDeps);
    const result = await runPhoneGemmaQuickDiagnostic({
      userId: "user-123",
      deviceId: "galaxy-fold6",
      model: "gemma-4-e4b-it",
      profileId: "gpu-standard-512",
    }, {
      now: () => fixedNow,
      runIdentityCheck: async () => ({ status: "passed", detail: "Jarvis identity came from runtime state." }),
      runReadyResponseCheck: async () => ({ status: "passed", detail: "Returned READY." }),
      runSimpleMathCheck: async () => ({ status: "passed", detail: "7 + 5 matched." }),
      runMemoryLookupCheck: async () => ({ status: "skipped", detail: "No test-safe memory fixture available." }),
      runCancelSanityCheck: async () => ({ status: "passed", detail: "Cancel request acknowledged." }),
    });

    const youtube = result.checks.find((check) => check.id === "open_youtube");
    assert.equal(youtube?.status, "passed");
    assert.match(youtube?.detail ?? "", /com\.google\.android\.youtube/);
    assert.match(youtube?.detail ?? "", /preflight is ready/);
    console.log("OK: Phone Gemma YouTube diagnostic verifies deterministic preflight without opening the app");
  } finally {
    _setRuntimeCapabilityDepsForTesting(null);
  }
}

async function testQuickDiagnosticDoesNotSendUnscopedCancelWhileNativeWorkIsActive() {
  const {
    runPhoneGemmaQuickDiagnostic,
  } = await resetModule();

  const ops: Array<Record<string, unknown>> = [];
  const result = await runPhoneGemmaQuickDiagnostic({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  }, {
    now: () => fixedNow,
    runIdentityCheck: async () => ({ status: "passed", detail: "Jarvis identity came from runtime state." }),
    runReadyResponseCheck: async () => ({ status: "passed", detail: "Returned READY." }),
    runSimpleMathCheck: async () => ({ status: "passed", detail: "7 + 5 matched." }),
    runMemoryLookupCheck: async () => ({ status: "skipped", detail: "No test-safe memory fixture available." }),
    runOpenYoutubeCheck: async () => ({ status: "passed", detail: "Open YouTube preflight passed." }),
    sendAndroidDaemonOp: async (_userId, op) => {
      ops.push(op);
      if (op.type === "android_local_model_status") {
        return {
          ok: true,
          data: {
            inference: {
              activeRequests: 1,
            },
          },
        };
      }
      return {
        ok: false,
        error: `Unexpected op: ${String(op.type)}`,
      };
    },
  });

  const cancelSanity = result.checks.find((check) => check.id === "cancel_sanity");
  assert.equal(cancelSanity?.status, "skipped");
  assert.match(cancelSanity?.detail ?? "", /already running 1 active request/);
  assert.deepEqual(ops.map((op) => op.type), ["android_local_model_status"]);
  console.log("OK: Phone Gemma quick diagnostics skip unscoped cancel while native work is active");
}

async function testTimedOutDiagnosticGenerationSendsScopedCancel() {
  const {
    runPhoneGemmaQuickDiagnostic,
  } = await resetModule();

  const ops: Array<Record<string, unknown>> = [];
  const result = await runPhoneGemmaQuickDiagnostic({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  }, {
    now: () => fixedNow,
    runIdentityCheck: async () => ({ status: "passed", detail: "Jarvis identity came from runtime state." }),
    runSimpleMathCheck: async () => ({ status: "passed", detail: "7 + 5 matched." }),
    runMemoryLookupCheck: async () => ({ status: "skipped", detail: "No test-safe memory fixture available." }),
    runOpenYoutubeCheck: async () => ({ status: "passed", detail: "Open YouTube preflight passed." }),
    runCancelSanityCheck: async () => ({ status: "passed", detail: "Cancel sanity skipped by fixture." }),
    sendAndroidDaemonOp: async (_userId, op) => {
      ops.push(op);
      if (op.type === "android_local_model_generate") {
        assert.match(String(op.requestId ?? ""), /^phone-gemma-diagnostic-/);
        return {
          ok: false,
          error: "Timed out waiting for Phone Gemma.",
        };
      }
      if (op.type === "android_local_model_cancel") {
        assert.match(String(op.requestId ?? ""), /^phone-gemma-diagnostic-/);
        return {
          ok: true,
          data: {
            cancelled: true,
          },
        };
      }
      return {
        ok: false,
        error: `Unexpected op: ${String(op.type)}`,
      };
    },
  });

  const ready = result.checks.find((check) => check.id === "ready_response");
  assert.equal(ready?.status, "failed");
  assert.deepEqual(ops.map((op) => op.type), ["android_local_model_generate", "android_local_model_cancel"]);
  assert.equal(ops[0]?.requestId, ops[1]?.requestId);
  console.log("OK: timed-out Phone Gemma diagnostic generations send scoped cancellation");
}

async function testDiagnosticGenerationUsesRuntimeSettingsWhenNoProfileSelected() {
  const {
    runPhoneGemmaQuickDiagnostic,
  } = await resetModule();

  const previousContextTokens = process.env.ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS;
  const previousAllowCpuFallback = process.env.ANDROID_LOCAL_GEMMA_ALLOW_CPU_FALLBACK;
  process.env.ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS = "1024";
  process.env.ANDROID_LOCAL_GEMMA_ALLOW_CPU_FALLBACK = "true";

  try {
    const ops: Array<Record<string, unknown>> = [];
    const result = await runPhoneGemmaQuickDiagnostic({
      userId: "user-123",
      deviceId: "galaxy-fold6",
      model: "gemma-4-e4b-it",
    }, {
      now: () => fixedNow,
      runIdentityCheck: async () => ({ status: "passed", detail: "Jarvis identity came from runtime state." }),
      runSimpleMathCheck: async () => ({ status: "passed", detail: "7 + 5 matched." }),
      runMemoryLookupCheck: async () => ({ status: "skipped", detail: "No test-safe memory fixture available." }),
      runOpenYoutubeCheck: async () => ({ status: "passed", detail: "Open YouTube preflight passed." }),
      runCancelSanityCheck: async () => ({ status: "passed", detail: "Cancel sanity skipped by fixture." }),
      sendAndroidDaemonOp: async (_userId, op) => {
        ops.push(op);
        assert.equal(op.type, "android_local_model_generate");
        return {
          ok: true,
          data: {
            text: "READY",
          },
        };
      },
    });

    assert.equal(result.checks.find((check) => check.id === "ready_response")?.status, "passed");
    assert.equal(ops[0]?.contextTokens, 1024);
    assert.equal(ops[0]?.allowCpuFallback, true);
    console.log("OK: Phone Gemma diagnostics use runtime generation settings when no profile is selected");
  } finally {
    if (previousContextTokens === undefined) {
      delete process.env.ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS;
    } else {
      process.env.ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS = previousContextTokens;
    }
    if (previousAllowCpuFallback === undefined) {
      delete process.env.ANDROID_LOCAL_GEMMA_ALLOW_CPU_FALLBACK;
    } else {
      process.env.ANDROID_LOCAL_GEMMA_ALLOW_CPU_FALLBACK = previousAllowCpuFallback;
    }
  }
}

async function testDiagnosticGenerationCancelsOnAbortSignal() {
  const {
    runPhoneGemmaQuickDiagnostic,
  } = await resetModule();

  const controller = new AbortController();
  const ops: Array<Record<string, unknown>> = [];
  const neverResolves = new Promise<{ ok: boolean }>(() => undefined);
  const diagnostic = runPhoneGemmaQuickDiagnostic({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  }, {
    now: () => fixedNow,
    signal: controller.signal,
    runIdentityCheck: async () => ({ status: "passed", detail: "Jarvis identity came from runtime state." }),
    runSimpleMathCheck: async () => {
      assert.fail("Abort should stop diagnostics before the simple math check");
    },
    runMemoryLookupCheck: async () => {
      assert.fail("Abort should stop diagnostics before the memory check");
    },
    runOpenYoutubeCheck: async () => {
      assert.fail("Abort should stop diagnostics before the YouTube check");
    },
    runCancelSanityCheck: async () => {
      assert.fail("Abort should stop diagnostics before cancel sanity");
    },
    sendAndroidDaemonOp: async (_userId, op) => {
      ops.push(op);
      if (op.type === "android_local_model_generate") {
        queueMicrotask(() => controller.abort());
        return neverResolves;
      }
      if (op.type === "android_local_model_cancel") {
        assert.match(String(op.requestId ?? ""), /^phone-gemma-diagnostic-/);
        return {
          ok: true,
          data: {
            cancelled: true,
          },
        };
      }
      return {
        ok: false,
        error: `Unexpected op: ${String(op.type)}`,
      };
    },
  });

  await assert.rejects(diagnostic, (error) => error instanceof Error && error.name === "AbortError");
  assert.deepEqual(ops.map((op) => op.type), ["android_local_model_generate", "android_local_model_cancel"]);
  assert.equal(ops[0]?.requestId, ops[1]?.requestId);
  console.log("OK: Phone Gemma diagnostics cancel scoped generation when the chat abort signal fires");
}

async function testReadyDiagnosticRequiresExactReadyResponse() {
  const {
    runPhoneGemmaQuickDiagnostic,
  } = await resetModule();

  const commonDeps: Omit<PhoneGemmaDiagnosticDeps, "sendAndroidDaemonOp"> = {
    now: () => fixedNow,
    runIdentityCheck: async () => ({ status: "passed", detail: "Jarvis identity came from runtime state." }),
    runSimpleMathCheck: async () => ({ status: "passed", detail: "7 + 5 matched." }),
    runMemoryLookupCheck: async () => ({ status: "skipped", detail: "No test-safe memory fixture available." }),
    runOpenYoutubeCheck: async () => ({ status: "passed", detail: "Open YouTube preflight passed." }),
    runCancelSanityCheck: async () => ({ status: "passed", detail: "Cancel sanity skipped by fixture." }),
  };

  const failed = await runPhoneGemmaQuickDiagnostic({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  }, {
    ...commonDeps,
    sendAndroidDaemonOp: async (_userId, op) => {
      assert.equal(op.type, "android_local_model_generate");
      return {
        ok: true,
        data: {
          text: "not READY",
        },
      };
    },
  });
  assert.equal(failed.checks.find((check) => check.id === "ready_response")?.status, "failed");

  const passed = await runPhoneGemmaQuickDiagnostic({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  }, {
    ...commonDeps,
    sendAndroidDaemonOp: async (_userId, op) => {
      assert.equal(op.type, "android_local_model_generate");
      return {
        ok: true,
        data: {
          text: "READY",
        },
      };
    },
  });
  assert.equal(passed.checks.find((check) => check.id === "ready_response")?.status, "passed");
  console.log("OK: Phone Gemma READY diagnostics require the exact READY response");
}

async function testFixLocalModelRecoveryCancelsAndPreservesData() {
  const {
    answerPhoneGemmaDiagnosticQuestion,
    clearPhoneGemmaStaleRequestState,
    fixPhoneGemmaLocalModel,
    markPhoneGemmaGenerationFinished,
    markPhoneGemmaGenerationStarted,
  } = await resetModule();

  const actions: string[] = [];
  const resetTarget = approvedResetTarget();
  const deps: PhoneGemmaDiagnosticDeps = {
    now: () => fixedNow,
    requestResetApproval: async () => ({ approved: true, gateId: "gate-phone-gemma-reset", resetTarget }),
    cancelActiveGeneration: async () => {
      actions.push("cancel");
      return { status: "passed", detail: "Android confirmed cancellation." };
    },
    waitForNativeIdle: async () => {
      actions.push("idle");
      return { status: "passed", detail: "Android reported Phone Gemma idle." };
    },
    clearStaleRequestState: async () => {
      actions.push("clear");
      return { status: "passed", detail: "Cleared server stale request state." };
    },
  };

  const result = await fixPhoneGemmaLocalModel({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
    resetTarget,
  }, deps);

  assert.equal(result.status, "recovered");
  assert.deepEqual(actions, ["cancel", "idle", "clear"]);
  assert.equal(result.preservedModelFiles, true);
  assert.equal(result.preservedMemories, true);

  const answer = await answerPhoneGemmaDiagnosticQuestion({
    messages: userMessage("Fix Phone Gemma"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    deviceId: "galaxy-fold6",
    profileId: "gpu-standard-512",
  }, deps);
  assert.ok(answer);
  assert.match(answer.textContent, /I reset Phone Gemma Runtime/);
  assert.match(answer.textContent, /Model files and memories were preserved/);
  assert.match(answer.textContent, /Sources: Diagnostics\./);

  markPhoneGemmaGenerationStarted({
    userId: "user-123",
    requestId: "phone-gemma-test-request",
    model: "gemma-4-e4b-it",
    startedAt: "2026-06-26T08:59:00.000Z",
  });
  assert.equal(clearPhoneGemmaStaleRequestState("user-123"), true);
  markPhoneGemmaGenerationStarted({
    userId: "user-123",
    requestId: "phone-gemma-finished-request",
    model: "gemma-4-e4b-it",
    startedAt: "2026-06-26T08:59:00.000Z",
  });
  markPhoneGemmaGenerationFinished({
    userId: "user-123",
    requestId: "phone-gemma-finished-request",
  });
  assert.equal(clearPhoneGemmaStaleRequestState("user-123"), false);
  console.log("OK: Phone Gemma recovery cancels stale work and preserves model files and memories");
}

async function testFixLocalModelRequiresApprovalBeforeRecovery() {
  const { answerPhoneGemmaDiagnosticQuestion } = await resetModule();

  let recoveryCalls = 0;
  const answer = await answerPhoneGemmaDiagnosticQuestion({
    messages: userMessage("Fix Phone Gemma"),
    userId: "user-123",
    route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    deviceId: "galaxy-fold6",
    profileId: "gpu-standard-512",
  }, {
    now: () => fixedNow,
    requestResetApproval: async () => ({
      approved: false,
      gateId: "gate-phone-gemma-reset",
      reason: "Approval is required before resetting Phone Gemma Runtime.",
    }),
    cancelActiveGeneration: async () => {
      recoveryCalls += 1;
      return { status: "passed", detail: "Android confirmed cancellation." };
    },
    waitForNativeIdle: async () => {
      recoveryCalls += 1;
      return { status: "passed", detail: "Android reported idle." };
    },
    clearStaleRequestState: async () => {
      recoveryCalls += 1;
      return { status: "passed", detail: "Cleared stale state." };
    },
  });

  assert.ok(answer);
  assert.equal(recoveryCalls, 0);
  assert.match(answer.textContent, /Approval is required before resetting Phone Gemma Runtime/);
  assert.match(answer.textContent, /Gate ID: gate-phone-gemma-reset/);
  assert.match(answer.textContent, /Attempted: Diagnostics\./);
  console.log("OK: Phone Gemma reset requests approval before any recovery action runs");
}

async function testFixLocalModelUsesApprovedResetTarget() {
  const {
    clearPhoneGemmaStaleRequestState,
    fixPhoneGemmaLocalModel,
    markPhoneGemmaGenerationStarted,
  } = await resetModule();

  markPhoneGemmaGenerationStarted({
    userId: "user-123",
    requestId: "approved-request",
    model: "gemma-4-e4b-it",
    startedAt: "2026-06-26T08:59:00.000Z",
  });
  const resetTarget = {
    requestId: "approved-request",
    scope: "tracked_phone_gemma_request" as const,
    capturedAt: "2026-06-26T09:00:00.000Z",
  };
  markPhoneGemmaGenerationStarted({
    userId: "user-123",
    requestId: "newer-request",
    model: "gemma-4-e4b-it",
    startedAt: "2026-06-26T09:01:00.000Z",
  });

  const ops: Array<Record<string, unknown>> = [];
  const result = await fixPhoneGemmaLocalModel({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
    resetTarget,
  }, {
    now: () => fixedNow,
    sendAndroidDaemonOp: async (_userId, op) => {
      ops.push(op);
      if (op.type === "android_local_model_status") {
        return {
          ok: true,
          data: {
            inference: {
              activeRequests: 0,
            },
          },
        };
      }
      return { ok: true, data: { cancelled: true } };
    },
  });

  const cancelOp = ops.find((op) => op.type === "android_local_model_cancel");
  assert.equal(cancelOp?.requestId, "approved-request");
  assert.equal(result.status, "recovered");
  assert.equal(result.steps.find((step) => step.id === "clear_stale_state")?.status, "skipped");
  assert.match(
    result.steps.find((step) => step.id === "clear_stale_state")?.detail ?? "",
    /current request tracking was left untouched/,
  );
  assert.equal(clearPhoneGemmaStaleRequestState("user-123", "newer-request"), true);
  console.log("OK: Phone Gemma reset uses the approved request target and preserves newer request tracking");
}

async function testFixLocalModelRequiresApprovedResetTarget() {
  const { fixPhoneGemmaLocalModel } = await resetModule();

  let cancelCalls = 0;
  let idleCalls = 0;
  let clearCalls = 0;
  const result = await fixPhoneGemmaLocalModel({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
  }, {
    now: () => fixedNow,
    cancelActiveGeneration: async () => {
      cancelCalls += 1;
      return { status: "passed", detail: "Should not cancel without an approved target." };
    },
    waitForNativeIdle: async () => {
      idleCalls += 1;
      return { status: "passed", detail: "Should not check native idle without an approved target." };
    },
    clearStaleRequestState: async () => {
      clearCalls += 1;
      return { status: "passed", detail: "Should not clear without an approved target." };
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.steps.find((step) => step.id === "cancel")?.status, "failed");
  assert.match(result.steps.find((step) => step.id === "cancel")?.detail ?? "", /approval-captured reset target/);
  assert.equal(cancelCalls, 0);
  assert.equal(idleCalls, 0);
  assert.equal(clearCalls, 0);
  console.log("OK: Phone Gemma recovery refuses to cancel without an approval-captured reset target");
}

async function testFixLocalModelRecoveryRequiresAndroidNativeIdleConfirmation() {
  const { fixPhoneGemmaLocalModel } = await resetModule();

  let activeStatusReads = 0;
  let activeClearCalls = 0;
  const active = await fixPhoneGemmaLocalModel({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
    resetTarget: approvedResetTarget("active-request"),
  }, {
    now: () => fixedNow,
    nativeIdlePollTimeoutMs: 20,
    nativeIdlePollIntervalMs: 1,
    cancelActiveGeneration: async () => ({ status: "passed", detail: "Android confirmed cancellation." }),
    clearStaleRequestState: async () => {
      activeClearCalls += 1;
      return { status: "passed", detail: "Cleared stale state." };
    },
    sendAndroidDaemonOp: async (_userId, op) => {
      assert.equal(op.type, "android_local_model_status");
      activeStatusReads += 1;
      return {
        ok: true,
        data: {
          inference: {
            activeRequests: 2,
          },
        },
      };
    },
  });

  assert.equal(active.status, "partial");
  assert.ok(activeStatusReads > 1);
  const nativeIdle = active.steps.find((step) => step.id === "native_idle");
  assert.equal(nativeIdle?.status, "failed");
  assert.match(nativeIdle?.detail ?? "", /after waiting/);
  assert.equal(activeClearCalls, 0);
  const activeClear = active.steps.find((step) => step.id === "clear_stale_state");
  assert.equal(activeClear?.status, "skipped");
  assert.match(activeClear?.detail ?? "", /later reset can retry the tracked request/);

  let settlingStatusReads = 0;
  const settled = await fixPhoneGemmaLocalModel({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
    resetTarget: approvedResetTarget("settling-request"),
  }, {
    now: () => fixedNow,
    nativeIdlePollTimeoutMs: 50,
    nativeIdlePollIntervalMs: 1,
    cancelActiveGeneration: async () => ({ status: "passed", detail: "Android confirmed cancellation." }),
    clearStaleRequestState: async () => ({ status: "passed", detail: "Cleared stale state." }),
    sendAndroidDaemonOp: async (_userId, op) => {
      assert.equal(op.type, "android_local_model_status");
      settlingStatusReads += 1;
      return {
        ok: true,
        data: {
          inference: {
            activeRequests: settlingStatusReads === 1 ? 1 : 0,
          },
        },
      };
    },
  });

  assert.equal(settled.status, "recovered");
  assert.equal(settlingStatusReads, 2);
  assert.match(settled.steps.find((step) => step.id === "native_idle")?.detail ?? "", /no active native requests/);

  const idle = await fixPhoneGemmaLocalModel({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
    resetTarget: approvedResetTarget("idle-request"),
  }, {
    now: () => fixedNow,
    cancelActiveGeneration: async () => ({ status: "passed", detail: "Android confirmed cancellation." }),
    clearStaleRequestState: async () => ({ status: "passed", detail: "Cleared stale state." }),
    sendAndroidDaemonOp: async (_userId, op) => {
      assert.equal(op.type, "android_local_model_status");
      return {
        ok: true,
        data: {
          inference: {
            activeRequests: 0,
          },
        },
      };
    },
  });

  assert.equal(idle.status, "recovered");
  assert.match(idle.steps.find((step) => step.id === "native_idle")?.detail ?? "", /no active native requests/);
  console.log("OK: Phone Gemma recovery requires Android to confirm native idle before reporting recovered");
}

async function testFixLocalModelRecoveryPartialAndFailedOutcomes() {
  const { fixPhoneGemmaLocalModel } = await resetModule();

  const partial = await fixPhoneGemmaLocalModel({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
    resetTarget: approvedResetTarget("partial-request"),
  }, {
    now: () => fixedNow,
    cancelActiveGeneration: async () => ({ status: "passed", detail: "Android confirmed cancellation." }),
    waitForNativeIdle: async () => ({ status: "failed", detail: "Android status did not respond." }),
    clearStaleRequestState: async () => ({ status: "passed", detail: "Cleared stale state." }),
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.steps.find((step) => step.id === "clear_stale_state")?.status, "skipped");

  const recoveredWithoutNativeConfirmation = await fixPhoneGemmaLocalModel({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
    resetTarget: approvedResetTarget("native-unavailable-request"),
  }, {
    now: () => fixedNow,
    cancelActiveGeneration: async () => ({ status: "passed", detail: "Android confirmed cancellation." }),
    waitForNativeIdle: async () => ({ status: "skipped", detail: "Native idle confirmation is unavailable." }),
    clearStaleRequestState: async () => ({ status: "passed", detail: "Cleared stale state." }),
  });
  assert.equal(recoveredWithoutNativeConfirmation.status, "recovered");

  const failed = await fixPhoneGemmaLocalModel({
    userId: "user-123",
    deviceId: "galaxy-fold6",
    model: "gemma-4-e4b-it",
    profileId: "gpu-standard-512",
    resetTarget: approvedResetTarget("failed-request"),
  }, {
    now: () => fixedNow,
    cancelActiveGeneration: async () => ({ status: "failed", detail: "Cancel failed." }),
    waitForNativeIdle: async () => ({ status: "failed", detail: "Native status failed." }),
    clearStaleRequestState: async () => ({ status: "failed", detail: "Clear failed." }),
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.steps.find((step) => step.id === "clear_stale_state")?.status, "skipped");
  assert.equal(failed.preservedModelFiles, true);
  assert.equal(failed.preservedMemories, true);
  console.log("OK: Phone Gemma recovery reports partial, unavailable-native, and failed outcomes");
}

async function main() {
  await testLatestDiagnosticReplacesOlderResultAndExpires();
  await testDiagnosticAnswersUseRuntimeState();
  await testQuickDiagnosticCoversCoreChecksAndDoesNotWriteMemory();
  await testOpenYoutubeDiagnosticUsesPreflightOnly();
  await testQuickDiagnosticDoesNotSendUnscopedCancelWhileNativeWorkIsActive();
  await testTimedOutDiagnosticGenerationSendsScopedCancel();
  await testDiagnosticGenerationUsesRuntimeSettingsWhenNoProfileSelected();
  await testDiagnosticGenerationCancelsOnAbortSignal();
  await testReadyDiagnosticRequiresExactReadyResponse();
  await testFixLocalModelRecoveryCancelsAndPreservesData();
  await testFixLocalModelRequiresApprovalBeforeRecovery();
  await testFixLocalModelUsesApprovedResetTarget();
  await testFixLocalModelRequiresApprovedResetTarget();
  await testFixLocalModelRecoveryRequiresAndroidNativeIdleConfirmation();
  await testFixLocalModelRecoveryPartialAndFailedOutcomes();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
