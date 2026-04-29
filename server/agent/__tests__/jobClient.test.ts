/**
 * Unit tests for the deduplication guard inside submitAgentJob.
 *
 * Verifies three behavioural contracts:
 *   1. Duplicate found → existing id is returned; insertJob is never called.
 *   2. No duplicate   → insertJob is called; returned id comes from the insert.
 *   3. Guard throws   → error is swallowed; insertJob is still called (non-fatal).
 *
 * Both findDuplicate and insertJob are injected via deps, so no real DB is needed.
 *
 * Run with: tsx server/agent/__tests__/jobClient.test.ts
 */

import { submitAgentJob, type SubmitJobInput, type SubmitJobDeps } from "../jobClient";
import type { findDuplicateJob } from "../tools/jobDuplicateGuard";

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

/** Minimal valid job input. */
function makeInput(overrides: Partial<SubmitJobInput> = {}): SubmitJobInput {
  return {
    userId: "user-abc",
    agentType: "research",
    title: "Summarise recent AI news",
    prompt: "Please summarise recent AI news for me.",
    ...overrides,
  };
}

/** A findDuplicate stub that always reports no existing job. */
const noDuplicate: typeof findDuplicateJob = async () => null;

/** A findDuplicate stub that always reports an existing job. */
function duplicateExists(id = "job-existing"): typeof findDuplicateJob {
  return async () => ({ id, title: "Summarise recent AI news" });
}

/** An insertJob stub that records calls and returns the given id. */
function makeInsertStub(returnId = "job-new-001"): {
  fn: NonNullable<SubmitJobDeps["insertJob"]>;
  calls: number;
  lastValues: Parameters<NonNullable<SubmitJobDeps["insertJob"]>>[0] | null;
} {
  const stub = {
    calls: 0,
    lastValues: null as Parameters<NonNullable<SubmitJobDeps["insertJob"]>>[0] | null,
    fn: null as unknown as NonNullable<SubmitJobDeps["insertJob"]>,
  };
  stub.fn = async (values) => {
    stub.calls++;
    stub.lastValues = values;
    return returnId;
  };
  return stub;
}

// ── Test suites ───────────────────────────────────────────────────────────────

async function run(): Promise<void> {

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 1: Duplicate found — existing id returned, insert never called
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 1 — Duplicate found: existing id returned, insert skipped\n");

  {
    const insertStub = makeInsertStub("job-never");
    const deps: SubmitJobDeps = {
      findDuplicate: duplicateExists("job-old-001"),
      insertJob: insertStub.fn,
    };

    const returnedId = await submitAgentJob(makeInput(), deps);

    assertEquals(returnedId, "job-old-001", "DUP-1: returns the existing job id when a duplicate is found");
    assertEquals(insertStub.calls, 0, "DUP-2: insertJob is never called when a duplicate is found");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 2: No duplicate — insert is called and its id is returned
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 2 — No duplicate: insertJob called once, new id returned\n");

  {
    const insertStub = makeInsertStub("job-new-555");
    const deps: SubmitJobDeps = {
      findDuplicate: noDuplicate,
      insertJob: insertStub.fn,
    };

    const returnedId = await submitAgentJob(makeInput(), deps);

    assertEquals(returnedId, "job-new-555", "ND-1: returns the id provided by insertJob");
    assertEquals(insertStub.calls, 1, "ND-2: insertJob is called exactly once when no duplicate exists");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 3: Insert receives correct field values
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 3 — insertJob receives the correct field values\n");

  {
    const insertStub = makeInsertStub("job-check");
    const deps: SubmitJobDeps = {
      findDuplicate: noDuplicate,
      insertJob: insertStub.fn,
    };

    const input = makeInput({
      userId: "u-xyz",
      agentType: "planning",
      title: "Plan Q3 roadmap",
      prompt: "Draft a Q3 roadmap.",
    });

    await submitAgentJob(input, deps);

    const v = insertStub.lastValues!;
    assertEquals(v.userId, "u-xyz", "IV-1: userId is forwarded to insertJob");
    assertEquals(v.agentType, "planning", "IV-2: agentType is forwarded to insertJob");
    assertEquals(v.title, "Plan Q3 roadmap", "IV-3: title is forwarded to insertJob");
    assertEquals(v.prompt, "Draft a Q3 roadmap.", "IV-4: prompt is forwarded to insertJob");
    assertEquals(v.status, "queued", "IV-5: status is set to 'queued'");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 4: Model routing injects the correct model into the insert values
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 4 — Model routing: correct model injected into input\n");

  {
    const insertStub = makeInsertStub("job-model-check");
    const deps: SubmitJobDeps = {
      findDuplicate: noDuplicate,
      insertJob: insertStub.fn,
    };

    await submitAgentJob(makeInput({ agentType: "research" }), deps);

    assertEquals(
      (insertStub.lastValues!.input as Record<string, unknown>).model,
      "gpt-4.1-mini",
      "MR-1: research jobs get model=gpt-4.1-mini injected",
    );
  }

  {
    const insertStub = makeInsertStub("job-model-check-2");
    const deps: SubmitJobDeps = {
      findDuplicate: noDuplicate,
      insertJob: insertStub.fn,
    };

    await submitAgentJob(makeInput({ agentType: "writing" }), deps);

    assertEquals(
      (insertStub.lastValues!.input as Record<string, unknown>).model,
      "gpt-4o-mini",
      "MR-2: writing jobs get model=gpt-4o-mini injected",
    );
  }

  {
    const insertStub = makeInsertStub("job-model-override");
    const deps: SubmitJobDeps = {
      findDuplicate: noDuplicate,
      insertJob: insertStub.fn,
    };

    await submitAgentJob(makeInput({ agentType: "research", input: { model: "custom-model" } }), deps);

    assertEquals(
      (insertStub.lastValues!.input as Record<string, unknown>).model,
      "custom-model",
      "MR-3: caller-supplied model is not overridden by routing",
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 5: Guard errors are non-fatal — insert proceeds normally
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 5 — Guard error is swallowed; insertJob is still called\n");

  {
    const insertStub = makeInsertStub("job-after-guard-error");
    const erroringGuard: typeof findDuplicateJob = async () => {
      throw new Error("DB connection lost");
    };
    const deps: SubmitJobDeps = {
      findDuplicate: erroringGuard,
      insertJob: insertStub.fn,
    };

    const returnedId = await submitAgentJob(makeInput(), deps);

    assertEquals(insertStub.calls, 1, "GE-1: insertJob is called once after the guard error");
    assertEquals(returnedId, "job-after-guard-error", "GE-2: the new job id from insertJob is returned");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 6: Guard receives the correct arguments
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 6 — Guard receives correct userId, agentType, and title\n");

  {
    const calls: Array<{ userId: string; agentType: string; title: string }> = [];
    const capturingGuard: typeof findDuplicateJob = async (userId, agentType, title) => {
      calls.push({ userId, agentType, title });
      return null;
    };
    const deps: SubmitJobDeps = {
      findDuplicate: capturingGuard,
      insertJob: makeInsertStub("job-guard-args").fn,
    };

    await submitAgentJob(makeInput({ userId: "u-test", agentType: "planning", title: "Plan Q3 roadmap" }), deps);

    assertEquals(calls.length, 1, "GA-1: findDuplicate is called exactly once");
    assertEquals(calls[0]?.userId, "u-test", "GA-2: userId is forwarded correctly");
    assertEquals(calls[0]?.agentType, "planning", "GA-3: agentType is forwarded correctly");
    assertEquals(calls[0]?.title, "Plan Q3 roadmap", "GA-4: title is forwarded correctly");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 7: Two sequential submissions — second sees the first as duplicate
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\nSuite 7 — Sequential identical submissions: second returns existing id\n");

  {
    const insertStub = makeInsertStub("job-first");
    let firstDone = false;
    const sequentialGuard: typeof findDuplicateJob = async () => {
      if (!firstDone) {
        firstDone = true;
        return null;
      }
      return { id: "job-first", title: "Summarise recent AI news" };
    };
    const deps: SubmitJobDeps = {
      findDuplicate: sequentialGuard,
      insertJob: insertStub.fn,
    };

    const firstId = await submitAgentJob(makeInput(), deps);
    const secondId = await submitAgentJob(makeInput(), deps);

    assertEquals(firstId, "job-first", "RC-1: first submission returns the inserted job id");
    assertEquals(secondId, "job-first", "RC-2: second submission returns the same (existing) job id");
    assertEquals(insertStub.calls, 1, "RC-3: insertJob is called exactly once across both submissions");
  }
}

// ── Run and report ────────────────────────────────────────────────────────────

run()
  .then(() => {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
      console.log("All jobClient deduplication assertions passed ✓");
    } else {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Unexpected test runner error:", err);
    process.exit(1);
  });
