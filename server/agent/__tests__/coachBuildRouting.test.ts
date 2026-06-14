/**
 * Integration-level tests for the build-intent routing path.
 *
 * These tests verify the behavioural contracts of routeBuildIntent after the
 * deduplication logic moved into submitAgentJob.  routeBuildIntent now always
 * calls submit() and branches on the returned `isDuplicate` flag instead of
 * running its own pre-check.
 *
 * Critical contracts:
 *   1. Fresh job  → BUILD_ACK_MARKER is in the reply, result.jobId is set.
 *   2. Duplicate  → submit() is still called once, result.duplicateJobId is set,
 *                   and BUILD_ACK_MARKER is still in the reply.
 *   3. discordChannelId is forwarded into the job input.
 *   4. Two rapid identical requests → each calls submit() once; the one that
 *      gets isDuplicate:true surfaces the duplicate ack.
 *   5. coachAgent dispatch simulation — outbound reply always includes
 *      BUILD_ACK_MARKER regardless of fresh/duplicate branch.
 *
 * All external dependencies are stubbed — no database or HTTP stack required.
 *
 * Run with: tsx server/agent/__tests__/coachBuildRouting.test.ts
 */

import { routeBuildIntent, type BuildRouteDeps, type BuildRouteInput } from "../buildIntentRouter";
import { BUILD_ACK_MARKER } from "../queryClassifier";
import type { SubmitJobResult } from "../jobClient";

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

/**
 * Creates a submit stub that records calls and returns the given id with
 * isDuplicate:false (simulating a freshly-enqueued job).
 */
function makeSubmitStub(returnId = "job-001"): {
  fn: BuildRouteDeps["submit"];
  calls: number;
} {
  const stub = { calls: 0 } as { calls: number; fn: BuildRouteDeps["submit"] };
  stub.fn = async (_input) => {
    stub.calls++;
    return { id: returnId, isDuplicate: false };
  };
  return stub;
}

/**
 * Creates a submit stub that returns isDuplicate:true (simulating the
 * deduplication guard inside submitAgentJob detecting an existing job).
 */
function makeDuplicateSubmitStub(existingId = "job-existing"): {
  fn: BuildRouteDeps["submit"];
  calls: number;
} {
  const stub = { calls: 0 } as { calls: number; fn: BuildRouteDeps["submit"] };
  stub.fn = async (_input) => {
    stub.calls++;
    return { id: existingId, isDuplicate: true };
  };
  return stub;
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
  // Suite 1: BUILD_ACK_MARKER in the ack reply — fresh job
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 1 — BUILD_ACK_MARKER is embedded in the ack reply (fresh job)\n");

  {
    const submitStub = makeSubmitStub("job-111");
    const deps: BuildRouteDeps = { submit: submitStub.fn };

    const result = await routeBuildIntent(makeInput(), deps);

    assert(result.handled === true, "BA-1: result.handled is true for a fresh build request");
    assertEquals(submitStub.calls, 1, "BA-2: submit is called exactly once");
    assert(typeof result.reply === "string", "BA-3: result.reply is a string");
    assert(
      !!result.reply && result.reply.includes(BUILD_ACK_MARKER),
      `BA-4: reply contains BUILD_ACK_MARKER ("${BUILD_ACK_MARKER}")`,
    );
    assertEquals(result.jobId, "job-111", "BA-5: result.jobId matches the value returned by submit");
    assert(result.duplicateJobId === undefined, "BA-6: result.duplicateJobId is absent for a fresh job");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 2: Deduplication — submit returns isDuplicate:true
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 2 — submit returns isDuplicate:true → duplicate ack is returned\n");

  {
    const submitStub = makeDuplicateSubmitStub("job-existing");
    const deps: BuildRouteDeps = { submit: submitStub.fn };

    const result = await routeBuildIntent(makeInput(), deps);

    assert(result.handled === true, "DD-1: result.handled is true even for a duplicate (ack is returned)");
    assertEquals(submitStub.calls, 1, "DD-2: submit is called exactly once (deduplication is inside submitAgentJob)");
    assert(result.jobId === undefined, "DD-3: result.jobId is absent (no new job created)");
    assertEquals(result.duplicateJobId, "job-existing", "DD-4: result.duplicateJobId matches the existing job id");
    assert(typeof result.reply === "string" && result.reply.length > 0, "DD-5: a non-empty ack reply is still returned");
    assert(
      !!result.reply && result.reply.includes(BUILD_ACK_MARKER),
      "DD-6: duplicate ack also contains BUILD_ACK_MARKER so the follow-up classifier stays active",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 3: discordChannelId is forwarded into the job input
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 3 — Optional discordChannelId is forwarded to the job\n");


  {
    const capturedInputs: Array<Record<string, unknown>> = [];
    const capturingSubmit: BuildRouteDeps["submit"] = async (jobInput) => {
      capturedInputs.push(jobInput.input as Record<string, unknown>);
      return { id: "job-333", isDuplicate: false };
    };
    const deps: BuildRouteDeps = { submit: capturingSubmit };

    await routeBuildIntent(makeInput({ originChannelId: "telegram-chat-1", discordChannelId: "ch-discord-99" }), deps);

    assert(capturedInputs.length === 1, "DC-1: submit was called exactly once");
    assertEquals(
      capturedInputs[0]?.originChannelId as string,
      "telegram-chat-1",
      "DC-2: originChannelId is forwarded to the job input",
    );
    assertEquals(
      capturedInputs[0]?.originDiscordChannelId as string,
      "ch-discord-99",
      "DC-3: originDiscordChannelId is forwarded to the job input",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 4: Two rapid identical requests — isDuplicate:true on second call
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 4 — Two rapid identical requests: second gets isDuplicate:true\n");

  {
    let callCount = 0;
    const sequentialSubmit: BuildRouteDeps["submit"] = async (): Promise<SubmitJobResult> => {
      callCount++;
      if (callCount === 1) return { id: "job-A", isDuplicate: false };
      return { id: "job-A", isDuplicate: true };
    };

    const deps: BuildRouteDeps = { submit: sequentialSubmit };
    const input = makeInput();

    const [result1, result2] = await Promise.all([
      routeBuildIntent(input, deps),
      routeBuildIntent(input, deps),
    ]);

    assert(result1.handled && result2.handled, "RR-1: both requests report handled=true");
    assertEquals(callCount, 2, "RR-2: submit is invoked twice (once per request; dedup is internal to submitAgentJob)");

    const freshResult = result1.jobId !== undefined ? result1 : result2;
    const dupResult = result1.duplicateJobId !== undefined ? result1 : result2;

    assertEquals(freshResult.jobId, "job-A", "RR-3: the fresh result carries the correct jobId");
    assertEquals(dupResult.duplicateJobId, "job-A", "RR-4: the duplicate result references the same job");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 5: coachAgent dispatch simulation — outbound reply always includes
  //          BUILD_ACK_MARKER regardless of fresh/duplicate branch.
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 5 — coachAgent dispatch: outbound reply always includes BUILD_ACK_MARKER\n");

  {
    async function simulateCoachDispatch(
      userText: string,
      deps: BuildRouteDeps,
    ): Promise<string | undefined> {
      const { classifyBuildIntent } = await import("../queryClassifier");
      if (!userText || !classifyBuildIntent(userText)) return undefined;
      const result = await routeBuildIntent({ userId: "u1", userText, channelName: "Telegram", chatMessages: [] }, deps);
      if (result.handled && result.reply) return result.reply;
      return undefined;
    }

    // Fresh job path
    const freshDeps: BuildRouteDeps = { submit: makeSubmitStub("job-F").fn };
    const freshReply = await simulateCoachDispatch("build a slack notification tool", freshDeps);
    assert(typeof freshReply === "string", "CA-1: fresh build dispatch produces a reply string");
    assert(
      !!freshReply && freshReply.includes(BUILD_ACK_MARKER),
      "CA-2: fresh build outbound reply includes BUILD_ACK_MARKER",
    );

    // Duplicate job path
    const dupDeps: BuildRouteDeps = { submit: makeDuplicateSubmitStub("job-D").fn };
    const dupReply = await simulateCoachDispatch("build a slack notification tool", dupDeps);
    assert(typeof dupReply === "string", "CA-3: duplicate build dispatch still produces a reply string");
    assert(
      !!dupReply && dupReply.includes(BUILD_ACK_MARKER),
      "CA-4: duplicate build outbound reply also includes BUILD_ACK_MARKER",
    );

    // Non-build request — classifyBuildIntent gates it out
    const noBuildDeps: BuildRouteDeps = { submit: makeSubmitStub().fn };
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
