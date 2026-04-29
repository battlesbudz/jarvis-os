/**
 * Integration-level tests for the build-intent routing path.
 *
 * These tests verify two critical behavioural contracts:
 *   1. A duplicate request does NOT enqueue a second job when a matching
 *      build_feature job is already queued or running for the same user.
 *   2. The reply returned by routeBuildIntent contains BUILD_ACK_MARKER so
 *      that classifyBuildFollowUp can detect an active build session on the
 *      next conversation turn.
 *
 * All external dependencies (job queue, duplicate guard) are stubbed — no
 * database or HTTP stack is required.
 *
 * Run with: tsx server/agent/__tests__/coachBuildRouting.test.ts
 */

import { routeBuildIntent, type BuildRouteDeps, type BuildRouteInput } from "../buildIntentRouter";
import { BUILD_ACK_MARKER } from "../queryClassifier";

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

// ── Stub factories ────────────────────────────────────────────────────────────

/** Creates a stub submit function that records calls and returns the given id. */
function makeSubmitStub(returnId = "job-001"): {
  fn: BuildRouteDeps["submit"];
  calls: number;
} {
  const stub = { calls: 0 } as { calls: number; fn: BuildRouteDeps["submit"] };
  stub.fn = async (_input) => {
    stub.calls++;
    return returnId;
  };
  return stub;
}

/** A findDuplicate stub that always reports no existing job. */
const noDuplicate: BuildRouteDeps["findDuplicate"] = async () => null;

/** A findDuplicate stub that always reports an existing job with the given id. */
function duplicateExists(id = "job-existing"): BuildRouteDeps["findDuplicate"] {
  return async () => ({ id, title: `Build: some existing feature` });
}

/** Minimal valid routing input. */
function makeInput(overrides: Partial<BuildRouteInput> = {}): BuildRouteInput {
  return {
    userId: "user-abc",
    userText: "build a weather lookup tool",
    channelName: "Telegram",
    chatMessages: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────────
  // Suite 1: BUILD_ACK_MARKER in the ack reply
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 1 — BUILD_ACK_MARKER is embedded in the ack reply\n");

  {
    const submitStub = makeSubmitStub("job-111");
    const deps: BuildRouteDeps = { submit: submitStub.fn, findDuplicate: noDuplicate };

    const result = await routeBuildIntent(makeInput(), deps);

    assert(result.handled === true, "BA-1: result.handled is true for a fresh build request");
    assert(typeof result.reply === "string", "BA-2: result.reply is a string");
    assert(
      !!result.reply && result.reply.includes(BUILD_ACK_MARKER),
      `BA-3: reply contains BUILD_ACK_MARKER ("${BUILD_ACK_MARKER}")`,
    );
    assertEquals(result.jobId, "job-111", "BA-4: result.jobId matches the value returned by submit");
    assert(result.duplicateJobId === undefined, "BA-5: result.duplicateJobId is absent for a fresh job");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 2: Deduplication — no second job queued when one already exists
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 2 — Deduplication prevents a second job being enqueued\n");

  {
    const submitStub = makeSubmitStub("job-999");
    const deps: BuildRouteDeps = { submit: submitStub.fn, findDuplicate: duplicateExists("job-existing") };

    const result = await routeBuildIntent(makeInput(), deps);

    assert(result.handled === true, "DD-1: result.handled is true even for a duplicate (ack is returned)");
    assertEquals(submitStub.calls, 0, "DD-2: submit was NOT called — no second job enqueued");
    assert(result.jobId === undefined, "DD-3: result.jobId is absent (no new job created)");
    assertEquals(result.duplicateJobId, "job-existing", "DD-4: result.duplicateJobId matches the existing job");
    assert(typeof result.reply === "string" && result.reply.length > 0, "DD-5: a non-empty ack reply is still returned");
    assert(
      !!result.reply && result.reply.includes(BUILD_ACK_MARKER),
      "DD-6: duplicate ack also contains BUILD_ACK_MARKER so the follow-up classifier stays active",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 3: Deduplication does not block when the guard itself errors
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 3 — Guard errors are non-fatal; job is enqueued normally\n");

  {
    const submitStub = makeSubmitStub("job-222");
    const erroringGuard: BuildRouteDeps["findDuplicate"] = async () => {
      throw new Error("DB connection lost");
    };
    const deps: BuildRouteDeps = { submit: submitStub.fn, findDuplicate: erroringGuard };

    const result = await routeBuildIntent(makeInput(), deps);

    assert(result.handled === true, "GE-1: result.handled is true even when the guard throws");
    assertEquals(submitStub.calls, 1, "GE-2: submit was called once (guard error is non-fatal)");
    assertEquals(result.jobId, "job-222", "GE-3: jobId is present after guard error");
    assert(
      !!result.reply && result.reply.includes(BUILD_ACK_MARKER),
      "GE-4: ack reply still contains BUILD_ACK_MARKER after guard error",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 4: discordChannelId is forwarded into the job input
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 4 — Optional discordChannelId is forwarded to the job\n");

  {
    const capturedInputs: Array<Record<string, unknown>> = [];
    const capturingSubmit: BuildRouteDeps["submit"] = async (jobInput) => {
      capturedInputs.push(jobInput.input as Record<string, unknown>);
      return "job-333";
    };
    const deps: BuildRouteDeps = { submit: capturingSubmit, findDuplicate: noDuplicate };

    await routeBuildIntent(makeInput({ discordChannelId: "ch-discord-99" }), deps);

    assert(capturedInputs.length === 1, "DC-1: submit was called exactly once");
    assertEquals(
      capturedInputs[0]?.originDiscordChannelId as string,
      "ch-discord-99",
      "DC-2: originDiscordChannelId is forwarded to the job input",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 5: Two rapid identical requests — only one job is created
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 5 — Two rapid identical requests yield exactly one enqueued job\n");

  {
    let jobCounter = 0;
    const sequentialIds = ["job-A", "job-B"];

    const submitStub: BuildRouteDeps["submit"] = async () => {
      return sequentialIds[jobCounter++] ?? "job-extra";
    };

    // Simulate a guard that "knows" about the first job after it has been submitted.
    // First call → no duplicate; second call → duplicate exists (id = "job-A").
    let firstCallDone = false;
    const dynamicGuard: BuildRouteDeps["findDuplicate"] = async () => {
      if (!firstCallDone) {
        firstCallDone = true;
        return null;
      }
      return { id: "job-A", title: "Build: build a weather lookup tool" };
    };

    const deps: BuildRouteDeps = { submit: submitStub, findDuplicate: dynamicGuard };
    const input = makeInput();

    const [result1, result2] = await Promise.all([
      routeBuildIntent(input, deps),
      routeBuildIntent(input, deps),
    ]);

    assert(result1.handled && result2.handled, "RR-1: both requests report handled=true");
    assertEquals(jobCounter, 1, "RR-2: submit was invoked exactly once across two concurrent requests");

    const firstJobId = result1.jobId ?? result2.jobId;
    assert(firstJobId === "job-A", "RR-3: the enqueued job has the expected id");

    const duplicateResult = result1.duplicateJobId !== undefined ? result1 : result2;
    assert(duplicateResult.duplicateJobId === "job-A", "RR-4: the duplicate response references the first job");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 6: coachAgent dispatch simulation — the reply surfaced to the user
  //          contains BUILD_ACK_MARKER regardless of whether the request is
  //          fresh or a duplicate (mirrors what coachAgent does with the
  //          result of routeBuildIntent before returning to the caller).
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 6 — coachAgent dispatch: outbound reply always includes BUILD_ACK_MARKER\n");

  {
    // Simulate the coachAgent dispatch path:
    //   1. classifyBuildIntent fires → routeBuildIntent is called
    //   2. The returned reply is what the channel adapter returns to the user
    // We test both the fresh-job and duplicate-job branches.

    async function simulateCoachDispatch(
      userText: string,
      deps: BuildRouteDeps,
    ): Promise<string | undefined> {
      // Mirror the classifyBuildIntent guard in coachAgent.ts line 595
      const { classifyBuildIntent } = await import("../queryClassifier");
      if (!userText || !classifyBuildIntent(userText)) return undefined;
      const result = await routeBuildIntent({ userId: "u1", userText, channelName: "Telegram", chatMessages: [] }, deps);
      // Mirror `if (buildResult.handled && buildResult.reply)` in coachAgent.ts
      if (result.handled && result.reply) return result.reply;
      return undefined;
    }

    // Fresh job path
    const freshDeps: BuildRouteDeps = { submit: makeSubmitStub("job-F").fn, findDuplicate: noDuplicate };
    const freshReply = await simulateCoachDispatch("build a slack notification tool", freshDeps);
    assert(typeof freshReply === "string", "CA-1: fresh build dispatch produces a reply string");
    assert(
      !!freshReply && freshReply.includes(BUILD_ACK_MARKER),
      "CA-2: fresh build outbound reply includes BUILD_ACK_MARKER",
    );

    // Duplicate job path
    const dupDeps: BuildRouteDeps = { submit: makeSubmitStub().fn, findDuplicate: duplicateExists("job-D") };
    const dupReply = await simulateCoachDispatch("build a slack notification tool", dupDeps);
    assert(typeof dupReply === "string", "CA-3: duplicate build dispatch still produces a reply string");
    assert(
      !!dupReply && dupReply.includes(BUILD_ACK_MARKER),
      "CA-4: duplicate build outbound reply also includes BUILD_ACK_MARKER",
    );

    // Non-build request — classifyBuildIntent gates it out
    const noBuildDeps: BuildRouteDeps = { submit: makeSubmitStub().fn, findDuplicate: noDuplicate };
    const noReply = await simulateCoachDispatch("what is on my calendar today", noBuildDeps);
    assert(noReply === undefined, "CA-5: non-build request is not dispatched (classifyBuildIntent gate)");
  }
}

// ── Run and report ────────────────────────────────────────────────────────────

run()
  .then(() => {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
      console.log("All coachBuildRouting assertions passed ✓");
    } else {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Unexpected test runner error:", err);
    process.exit(1);
  });
