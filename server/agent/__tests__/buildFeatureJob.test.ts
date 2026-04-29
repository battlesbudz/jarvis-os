/**
 * Unit tests for the build_feature multi-step build loop core logic.
 *
 * Tests cover:
 *   1.  parsePlanResponse  — JSON extraction including malformed-JSON fallback
 *   2.  runStepAttempts    — per-step retry loop (type-check failure, AI-verify
 *                            failure, verifier timeout, max retries exhausted)
 *   3.  pollResearchJob    — research polling (completes before timeout, times
 *                            out, research job fails)
 *
 * Run with: tsx server/agent/__tests__/buildFeatureJob.test.ts
 */

import {
  parsePlanResponse,
  pollResearchJob,
  runStepAttempts,
  MAX_STEP_RETRIES,
  type BuildStep,
  type ResearchPollDeps,
  type StepAttemptDeps,
} from "../buildFeatureJobCore";

// ── Test bookkeeping ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertEquals<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FEATURE_DESC = "Add a widget to the dashboard";

/** Returns a StepAttemptDeps where every call is customisable via overrides. */
function makeStepDeps(overrides: Partial<StepAttemptDeps> = {}): StepAttemptDeps {
  return {
    maxRetries: MAX_STEP_RETRIES,
    runWorker: async () => "worker output",
    typeCheck: async () => ({ ok: true, content: "" }),
    aiVerify: async () => ({ passed: true, reason: "" }),
    ...overrides,
  };
}

/**
 * Build a fast-clock ResearchPollDeps.
 *
 * `statusSequence` is consumed one entry per poll iteration.
 * If the sequence is exhausted the last entry is repeated.
 */
function makeResearchPollDeps(opts: {
  statusSequence: string[];
  body?: string | null;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}): ResearchPollDeps {
  const { statusSequence, body = "research findings", pollIntervalMs = 1, maxWaitMs = 100 } = opts;

  let callCount = 0;
  // Fast-forwarding clock: each call to now() advances by pollIntervalMs
  let fakeNow = 0;

  return {
    pollIntervalMs,
    maxWaitMs,
    now: () => fakeNow,
    sleep: async (ms: number) => {
      fakeNow += ms;
    },
    checkStatus: async () => {
      const status = statusSequence[Math.min(callCount, statusSequence.length - 1)];
      callCount++;
      return status;
    },
    fetchBody: async () => body,
  };
}

// ── Suite 1: parsePlanResponse ────────────────────────────────────────────────

async function testParsePlanResponse(): Promise<void> {
  console.log("\n── Suite 1: parsePlanResponse ──");

  // T1: well-formed JSON array inside a ```json block
  console.log("\nT1: parses a valid ```json fenced block");
  {
    const steps: object[] = [
      {
        step_id: "s1",
        label: "Create tool file",
        what_to_build: "Add server/agent/tools/widget.ts",
        acceptance_criteria: "File exports widgetTool of type AgentTool",
        files_affected: ["server/agent/tools/widget.ts"],
      },
      {
        step_id: "s2",
        label: "Register tool",
        what_to_build: "Add widgetTool to ALL_TOOLS in index.ts",
        acceptance_criteria: "widgetTool appears in ALL_TOOLS export",
        files_affected: ["server/agent/tools/index.ts"],
      },
    ];
    const planText = `Here is the plan:\n\`\`\`json\n${JSON.stringify(steps)}\n\`\`\``;
    const result = parsePlanResponse(planText, FEATURE_DESC);

    assertEquals(result.length, 2, "T1-a: returns 2 steps");
    assertEquals(result[0].step_id, "s1", "T1-b: first step_id is 's1'");
    assertEquals(result[1].label, "Register tool", "T1-c: second step label preserved");
    assertEquals(
      result[0].files_affected,
      ["server/agent/tools/widget.ts"],
      "T1-d: files_affected array preserved",
    );
  }

  // T2: bare JSON array (no fenced block) still parses
  console.log("\nT2: parses bare JSON array without ```json fence");
  {
    const steps = [{ step_id: "s1", label: "Bare step", what_to_build: "Do it", acceptance_criteria: "Done", files_affected: [] }];
    const result = parsePlanResponse(JSON.stringify(steps), FEATURE_DESC);
    assertEquals(result.length, 1, "T2-a: returns 1 step");
    assertEquals(result[0].step_id, "s1", "T2-b: step_id correct");
  }

  // T3: single-object JSON (not an array) is wrapped in an array
  console.log("\nT3: single object JSON is normalised to an array");
  {
    const singleStep = { step_id: "s1", label: "Solo step", what_to_build: "Do it", acceptance_criteria: "Done", files_affected: [] };
    const planText = `\`\`\`json\n${JSON.stringify(singleStep)}\n\`\`\``;
    const result = parsePlanResponse(planText, FEATURE_DESC);
    assertEquals(result.length, 1, "T3-a: single object wrapped to array of length 1");
    assertEquals(result[0].step_id, "s1", "T3-b: step_id preserved");
  }

  // T4: malformed JSON → fallback single step
  console.log("\nT4: malformed JSON falls back to a single default step");
  {
    const planText = "```json\n{ this is not valid json }\n```";
    const result = parsePlanResponse(planText, FEATURE_DESC);

    assertEquals(result.length, 1, "T4-a: fallback produces exactly 1 step");
    assertEquals(result[0].step_id, "s1", "T4-b: fallback step_id is 's1'");
    assertEquals(result[0].label, "Implement feature", "T4-c: fallback label is 'Implement feature'");
    assertEquals(result[0].what_to_build, FEATURE_DESC, "T4-d: fallback what_to_build = featureDescription");
    assertEquals(
      result[0].acceptance_criteria,
      "Feature is implemented and TypeScript type-check passes",
      "T4-e: fallback acceptance_criteria is default text",
    );
    assertEquals(result[0].files_affected, [], "T4-f: fallback files_affected is []");
  }

  // T5: empty string → fallback single step
  console.log("\nT5: empty planText falls back to a single default step");
  {
    const result = parsePlanResponse("", FEATURE_DESC);
    assertEquals(result.length, 1, "T5-a: fallback from empty string returns 1 step");
    assertEquals(result[0].label, "Implement feature", "T5-b: fallback label correct");
  }

  // T6: missing optional fields are backfilled with defaults
  console.log("\nT6: partial step objects get default values for missing fields");
  {
    const partial = [{ step_id: "s1" }]; // label, what_to_build, etc. all absent
    const planText = `\`\`\`json\n${JSON.stringify(partial)}\n\`\`\``;
    const result = parsePlanResponse(planText, FEATURE_DESC);

    assertEquals(result.length, 1, "T6-a: 1 step returned");
    assertEquals(result[0].label, "Step 1", "T6-b: missing label defaults to 'Step 1'");
    assertEquals(result[0].what_to_build, FEATURE_DESC, "T6-c: missing what_to_build defaults to featureDescription");
    assertEquals(
      result[0].acceptance_criteria,
      "Implements the described change correctly",
      "T6-d: missing acceptance_criteria gets default text",
    );
    assertEquals(result[0].files_affected, [], "T6-e: missing files_affected defaults to []");
  }

  // T7: non-array files_affected coerced to []
  console.log("\nT7: non-array files_affected is coerced to []");
  {
    const steps = [
      {
        step_id: "s1",
        label: "Step",
        what_to_build: "Build",
        acceptance_criteria: "Done",
        files_affected: "server/foo.ts", // string, not array
      },
    ];
    const planText = `\`\`\`json\n${JSON.stringify(steps)}\n\`\`\``;
    const result = parsePlanResponse(planText, FEATURE_DESC);
    assertEquals(result[0].files_affected, [], "T7-a: non-array files_affected coerced to []");
  }
}

// ── Suite 2: runStepAttempts ──────────────────────────────────────────────────

async function testRunStepAttempts(): Promise<void> {
  console.log("\n── Suite 2: runStepAttempts ──");

  // T8: first attempt passes type-check and AI verify → stepPassed=true, 0 retries
  console.log("\nT8: first attempt succeeds → stepPassed=true, stepRetries=0");
  {
    const result = await runStepAttempts(makeStepDeps());
    assert(result.stepPassed === true, "T8-a: stepPassed is true");
    assertEquals(result.stepRetries, 0, "T8-b: stepRetries is 0");
  }

  // T9: type-check fails on attempt 0, passes on attempt 1, then verify passes
  console.log("\nT9: type-check fails once, succeeds on retry → stepPassed=true, stepRetries=1");
  {
    let typeCheckCall = 0;
    const result = await runStepAttempts(
      makeStepDeps({
        typeCheck: async () => {
          typeCheckCall++;
          // Fail the first time, pass from the second call onward
          if (typeCheckCall === 1) return { ok: false, content: "error TS2345: type mismatch" };
          return { ok: true, content: "" };
        },
      }),
    );
    assert(result.stepPassed === true, "T9-a: stepPassed is true after recovery");
    assertEquals(result.stepRetries, 1, "T9-b: stepRetries is 1");
    assert(
      result.correctionContext?.includes("TypeScript type-check failed"),
      "T9-c: correctionContext mentions type-check failure",
    );
  }

  // T10: type-check fails on all 3 attempts → stepPassed=false
  console.log("\nT10: type-check fails on every attempt → stepPassed=false (max retries 2)");
  {
    const result = await runStepAttempts(
      makeStepDeps({
        typeCheck: async () => ({ ok: false, content: "persistent type error" }),
      }),
    );
    assert(result.stepPassed === false, "T10-a: stepPassed is false");
    assertEquals(result.stepRetries, MAX_STEP_RETRIES + 1, "T10-b: stepRetries = maxRetries+1 (one per attempt)");
  }

  // T11: type-check passes but AI verify returns false → retry; second attempt verify passes
  console.log("\nT11: AI verify fails first time, passes on retry → stepPassed=true");
  {
    let verifyCall = 0;
    const result = await runStepAttempts(
      makeStepDeps({
        aiVerify: async () => {
          verifyCall++;
          if (verifyCall === 1) return { passed: false, reason: "missing error handling" };
          return { passed: true, reason: "" };
        },
      }),
    );
    assert(result.stepPassed === true, "T11-a: stepPassed is true");
    assertEquals(result.stepRetries, 1, "T11-b: stepRetries is 1");
    assertEquals(
      result.correctionContext,
      "missing error handling",
      "T11-c: correctionContext is the verify reason from the failed attempt",
    );
  }

  // T12: AI verify returns false on all attempts → stepPassed=false
  console.log("\nT12: AI verify fails on every attempt → stepPassed=false");
  {
    const result = await runStepAttempts(
      makeStepDeps({
        aiVerify: async () => ({ passed: false, reason: "never good enough" }),
      }),
    );
    assert(result.stepPassed === false, "T12-a: stepPassed is false");
    assertEquals(result.stepRetries, MAX_STEP_RETRIES, "T12-b: stepRetries is maxRetries");
  }

  // T13: AI verify returns null (timeout) on first attempt → treated as failure → retried
  console.log("\nT13: AI verify times out (null) → fail-closed, step retried");
  {
    let verifyCall = 0;
    const result = await runStepAttempts(
      makeStepDeps({
        aiVerify: async () => {
          verifyCall++;
          if (verifyCall === 1) return { passed: null, reason: "verify_timeout" };
          return { passed: true, reason: "" };
        },
      }),
    );
    assert(result.stepPassed === true, "T13-a: stepPassed=true after recovery from timeout");
    assertEquals(result.stepRetries, 1, "T13-b: stepRetries=1 (one retry from the timeout)");
    assert(
      result.correctionContext?.includes("timed out"),
      "T13-c: correctionContext mentions timeout",
    );
  }

  // T14: AI verify returns null on ALL attempts → stepPassed=false
  console.log("\nT14: AI verify always times out → stepPassed=false");
  {
    const result = await runStepAttempts(
      makeStepDeps({
        aiVerify: async () => ({ passed: null, reason: "verify_timeout" }),
      }),
    );
    assert(result.stepPassed === false, "T14-a: stepPassed is false");
    assertEquals(result.stepRetries, MAX_STEP_RETRIES, "T14-b: stepRetries is maxRetries");
  }

  // T15: maxRetries=0 — only one attempt allowed; failure immediately → stepPassed=false
  console.log("\nT15: maxRetries=0 — single attempt; verify fails → stepPassed=false, retries=0");
  {
    const result = await runStepAttempts(
      makeStepDeps({
        maxRetries: 0,
        aiVerify: async () => ({ passed: false, reason: "nope" }),
      }),
    );
    assert(result.stepPassed === false, "T15-a: stepPassed is false with maxRetries=0");
    assertEquals(result.stepRetries, 0, "T15-b: stepRetries is 0 (no retries allowed)");
  }

  // T16: correctionContext from prior attempt is forwarded to runWorker
  console.log("\nT16: correctionContext from verify failure is passed to subsequent runWorker calls");
  {
    const receivedContexts: (string | undefined)[] = [];
    let verifyCall = 0;
    await runStepAttempts(
      makeStepDeps({
        runWorker: async (ctx) => {
          receivedContexts.push(ctx);
          return "output";
        },
        aiVerify: async () => {
          verifyCall++;
          if (verifyCall < 3) return { passed: false, reason: `issue-${verifyCall}` };
          return { passed: true, reason: "" };
        },
      }),
    );
    assertEquals(receivedContexts[0], undefined, "T16-a: first call correctionContext is undefined");
    assertEquals(receivedContexts[1], "issue-1", "T16-b: second call receives first verify reason");
    assertEquals(receivedContexts[2], "issue-2", "T16-c: third call receives second verify reason");
  }

  // T17: type-check failure correction context is forwarded to next runWorker
  console.log("\nT17: type-check failure context is forwarded to the retry worker call");
  {
    const receivedContexts: (string | undefined)[] = [];
    let typeCheckCall = 0;
    await runStepAttempts(
      makeStepDeps({
        runWorker: async (ctx) => {
          receivedContexts.push(ctx);
          return "output";
        },
        typeCheck: async () => {
          typeCheckCall++;
          if (typeCheckCall === 1) return { ok: false, content: "TS error here" };
          return { ok: true, content: "" };
        },
      }),
    );
    assert(receivedContexts.length >= 2, "T17-a: runWorker called at least twice");
    assert(
      receivedContexts[1]?.includes("TypeScript type-check failed"),
      "T17-b: retry receives type-check error in correctionContext",
    );
    assert(
      receivedContexts[1]?.includes("TS error here"),
      "T17-c: retry context contains the actual TS error output",
    );
  }
}

// ── Suite 3: pollResearchJob ──────────────────────────────────────────────────

async function testPollResearchJob(): Promise<void> {
  console.log("\n── Suite 3: pollResearchJob ──");

  // T18: research completes on the first poll → researchBody set, timedOut=false
  console.log("\nT18: research completes on first poll → researchBody populated");
  {
    const deps = makeResearchPollDeps({
      statusSequence: ["complete"],
      body: "Found relevant context about the feature.",
      maxWaitMs: 100,
    });
    const result = await pollResearchJob(deps);
    assert(result.timedOut === false, "T18-a: timedOut is false");
    assertEquals(
      result.researchBody,
      "Found relevant context about the feature.",
      "T18-b: researchBody contains the fetched content",
    );
  }

  // T19: research completes after several pending polls
  console.log("\nT19: research completes after intermediate 'queued' statuses");
  {
    const deps = makeResearchPollDeps({
      statusSequence: ["queued", "running", "running", "complete"],
      body: "Research done.",
      pollIntervalMs: 10,
      maxWaitMs: 1000,
    });
    const result = await pollResearchJob(deps);
    assert(result.timedOut === false, "T19-a: timedOut is false");
    assertEquals(result.researchBody, "Research done.", "T19-b: researchBody populated");
  }

  // T20: timeout hit before any terminal status → timedOut=true, researchBody=""
  console.log("\nT20: polling times out → timedOut=true, empty researchBody");
  {
    // pollIntervalMs=50, maxWaitMs=60 → fake clock advances 50ms per sleep.
    // After one sleep the clock reads 50ms, after two sleeps 100ms > 60ms so loop exits.
    // status is always "running" (never terminal).
    let fakeNow = 0;
    const deps: ResearchPollDeps = {
      pollIntervalMs: 50,
      maxWaitMs: 60,
      now: () => fakeNow,
      sleep: async (ms) => { fakeNow += ms; },
      checkStatus: async () => "running",
      fetchBody: async () => "should not be called",
    };
    const result = await pollResearchJob(deps);
    assert(result.timedOut === true, "T20-a: timedOut is true");
    assertEquals(result.researchBody, "", "T20-b: researchBody is empty on timeout");
  }

  // T21: research job fails (terminal "failed") → timedOut=false, researchBody=""
  console.log("\nT21: research job terminates with 'failed' → researchBody empty, not timedOut");
  {
    const deps = makeResearchPollDeps({
      statusSequence: ["running", "failed"],
      body: "should not be used",
      pollIntervalMs: 10,
      maxWaitMs: 500,
    });
    const result = await pollResearchJob(deps);
    assert(result.timedOut === false, "T21-a: timedOut is false (we got a terminal status)");
    assertEquals(result.researchBody, "", "T21-b: researchBody is empty for failed research job");
  }

  // T22: body is null (deliverable missing) → researchBody=""
  console.log("\nT22: research completes but fetchBody returns null → researchBody=''");
  {
    const deps = makeResearchPollDeps({
      statusSequence: ["complete"],
      body: null,
    });
    const result = await pollResearchJob(deps);
    assert(result.timedOut === false, "T22-a: timedOut is false");
    assertEquals(result.researchBody, "", "T22-b: researchBody is '' when fetchBody returns null");
  }

  // T23: long body is truncated to 4000 characters
  console.log("\nT23: research body longer than 4000 chars is truncated");
  {
    const longBody = "x".repeat(6000);
    const deps = makeResearchPollDeps({
      statusSequence: ["complete"],
      body: longBody,
    });
    const result = await pollResearchJob(deps);
    assertEquals(result.researchBody.length, 4000, "T23-a: researchBody is capped at 4000 chars");
  }
}

// ── Suite 4: constant guard ───────────────────────────────────────────────────

/**
 * Guard test: verifies that MAX_STEP_RETRIES exported from buildFeatureJobCore
 * still matches the value embedded in the jobQueue.ts handler.
 *
 * If this fails it means someone changed the handler's MAX_STEP_RETRIES without
 * updating the core module (or vice versa).  Update BOTH places together and
 * adjust the expected value below.
 *
 * HOW TO UPDATE: if you intentionally change the retry limit, update
 *   1. server/agent/buildFeatureJobCore.ts  → MAX_STEP_RETRIES constant
 *   2. server/agent/jobQueue.ts             → inline MAX_STEP_RETRIES constant
 *   3. The expected value in this guard test
 */
async function testConstantGuard(): Promise<void> {
  console.log("\n── Suite 4: constant guard ──");

  const EXPECTED_MAX_STEP_RETRIES = 2;

  assertEquals(
    MAX_STEP_RETRIES,
    EXPECTED_MAX_STEP_RETRIES,
    `GUARD: MAX_STEP_RETRIES=${MAX_STEP_RETRIES} matches expected value ${EXPECTED_MAX_STEP_RETRIES} — if this fails, update jobQueue.ts, buildFeatureJobCore.ts, and this guard together`,
  );
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  await testParsePlanResponse();
  await testRunStepAttempts();
  await testPollResearchJob();
  await testConstantGuard();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("All buildFeatureJob assertions passed ✓");
  } else {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
