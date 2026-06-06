/**
 * Extracted, dependency-injected logic from the build_feature job handler.
 *
 * Keeping this in a separate module lets unit tests import and exercise the
 * key algorithms (plan parsing, research polling, per-step retry loop) without
 * pulling in the heavy jobQueue.ts dependency chain.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BuildStep {
  step_id: string;
  label: string;
  what_to_build: string;
  acceptance_criteria: string;
  files_affected: string[];
}

export interface StepResult {
  stepPassed: boolean;
  stepRetries: number;
  correctionContext: string | undefined;
}

export type BuildFeatureProgressPhase =
  | "research"
  | "planning"
  | "step_started"
  | "type_check"
  | "verifying"
  | "step_completed"
  | "final_check"
  | "smoke_tests"
  | "synthesis";

export interface BuildFeatureProgressInput {
  phase: BuildFeatureProgressPhase;
  stepIndex?: number;
  stepCount?: number;
  stepLabel?: string;
  attempt?: number;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(99, Math.round(value)));
}

function stepBase(input: BuildFeatureProgressInput): number {
  const count = Math.max(1, input.stepCount ?? 1);
  const index = Math.max(0, Math.min(count - 1, input.stepIndex ?? 0));
  return 35 + (index / count) * 45;
}

export function buildFeatureProgressPercent(input: BuildFeatureProgressInput): number {
  switch (input.phase) {
    case "research":
      return 12;
    case "planning":
      return 25;
    case "step_started":
      return clampPercent(stepBase(input));
    case "type_check":
      return clampPercent(stepBase(input) + 7);
    case "verifying":
      return clampPercent(stepBase(input) + 12);
    case "step_completed": {
      const count = Math.max(1, input.stepCount ?? 1);
      const completed = Math.max(1, Math.min(count, (input.stepIndex ?? 0) + 1));
      return clampPercent(35 + (completed / count) * 45);
    }
    case "final_check":
      return 85;
    case "smoke_tests":
      return 90;
    case "synthesis":
      return 95;
  }
}

export function buildFeatureProgressLabel(input: BuildFeatureProgressInput): string {
  const stepNumber = typeof input.stepIndex === "number" ? input.stepIndex + 1 : 1;
  const stepCount = Math.max(1, input.stepCount ?? 1);
  const label = input.stepLabel ? `: ${input.stepLabel}` : "";
  const attempt = typeof input.attempt === "number" ? ` attempt ${input.attempt + 1}` : "";

  switch (input.phase) {
    case "research":
      return "Gathering build research";
    case "planning":
      return "Planning build steps";
    case "step_started":
      return `Building step ${stepNumber}/${stepCount}${label}${attempt}`;
    case "type_check":
      return `Type-checking step ${stepNumber}/${stepCount}${label}`;
    case "verifying":
      return `Verifying step ${stepNumber}/${stepCount}${label}`;
    case "step_completed":
      return `Completed step ${stepNumber}/${stepCount}${label}`;
    case "final_check":
      return "Running final type-check";
    case "smoke_tests":
      return "Running smoke tests";
    case "synthesis":
      return "Summarizing build result";
  }
}

// ── Plan parsing ──────────────────────────────────────────────────────────────

/**
 * Parse the LLM plan response text into an array of BuildSteps.
 *
 * The LLM is expected to return a ```json ... ``` fenced block containing a
 * JSON array of step objects.  When parsing fails for any reason the function
 * falls back to a single-step plan derived from featureDescription rather than
 * throwing.
 */
export function parsePlanResponse(
  planText: string,
  featureDescription: string,
): BuildStep[] {
  const jsonMatch = planText.match(/```json\s*([\s\S]*?)\s*```/);
  const raw = jsonMatch ? jsonMatch[1] : planText.trim();

  try {
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed) ? parsed : [parsed]).map(
      (item: Record<string, unknown>, i: number): BuildStep => ({
        step_id: String(item.step_id ?? `s${i + 1}`),
        label: String(item.label ?? `Step ${i + 1}`),
        what_to_build: String(item.what_to_build ?? featureDescription),
        acceptance_criteria: String(
          item.acceptance_criteria ?? "Implements the described change correctly",
        ),
        files_affected: Array.isArray(item.files_affected)
          ? (item.files_affected as unknown[]).map(String)
          : [],
      }),
    );
  } catch {
    return [
      {
        step_id: "s1",
        label: "Implement feature",
        what_to_build: featureDescription,
        acceptance_criteria:
          "Feature is implemented and TypeScript type-check passes",
        files_affected: [],
      },
    ];
  }
}

// ── Research polling ──────────────────────────────────────────────────────────

export interface ResearchPollDeps {
  /** Returns the current status string for the research job. */
  checkStatus: () => Promise<string>;
  /** Fetches the research body once the job has completed. */
  fetchBody: () => Promise<string | null>;
  /** Milliseconds between each poll. */
  pollIntervalMs: number;
  /** Maximum total wait in milliseconds before giving up. */
  maxWaitMs: number;
  /**
   * Injected clock.  Defaults to Date.now — override in tests for fast, deterministic runs.
   */
  now?: () => number;
  /**
   * Injected sleep function.  Defaults to a real Promise-based delay — override in tests.
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface ResearchPollOutcome {
  /** True when the poll loop timed out without a terminal status. */
  timedOut: boolean;
  /** Research findings when the job completed successfully; empty string otherwise. */
  researchBody: string;
}

/**
 * Poll for a research job to reach a terminal state ("complete" | "failed").
 *
 * Returns { timedOut: false, researchBody: "<text>" } on success.
 * Returns { timedOut: true,  researchBody: "" }        when maxWaitMs is exceeded.
 * Returns { timedOut: false, researchBody: "" }        when the job failed (terminal but not complete).
 */
export async function pollResearchJob(
  deps: ResearchPollDeps,
): Promise<ResearchPollOutcome> {
  const { checkStatus, fetchBody, pollIntervalMs, maxWaitMs } = deps;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const start = now();
  let researchStatus = "";

  while (now() - start < maxWaitMs) {
    researchStatus = await checkStatus();
    if (researchStatus === "complete" || researchStatus === "failed") break;
    await sleep(pollIntervalMs);
  }

  // Timed out (loop exited because elapsed >= maxWaitMs without a terminal status)
  if (researchStatus !== "complete" && researchStatus !== "failed") {
    return { timedOut: true, researchBody: "" };
  }

  if (researchStatus === "complete") {
    const body = await fetchBody();
    return { timedOut: false, researchBody: body ? body.slice(0, 4000) : "" };
  }

  // status === "failed"
  return { timedOut: false, researchBody: "" };
}

// ── Per-step retry loop ───────────────────────────────────────────────────────

/**
 * Maximum number of retries allowed per build step.
 * Each step gets MAX_STEP_RETRIES + 1 total attempts (one initial + N retries).
 *
 * Exported so tests and the jobQueue handler can share the same value,
 * preventing silent drift if the limit is ever changed.
 */
export const MAX_STEP_RETRIES = 2;

export interface StepAttemptDeps {
  /** Maximum number of retries (each step gets maxRetries + 1 total attempts). */
  maxRetries: number;
  /**
   * Execute the worker agent for this attempt.
   * @param correctionContext Feedback from the previous failed attempt, if any.
   */
  runWorker: (correctionContext: string | undefined) => Promise<string>;
  /** Run a TypeScript type-check.  Returns ok=true when the check passes. */
  typeCheck: () => Promise<{ ok: boolean; content: string }>;
  /**
   * AI verification of whether the worker output meets acceptance criteria.
   * Returns passed=true (pass), passed=false (fail), or passed=null (timeout).
   */
  aiVerify: (
    workerOutput: string,
  ) => Promise<{ passed: boolean | null; reason: string }>;
}

/**
 * Run one build step through the full attempt loop:
 *   worker → type_check → ai_verify → [retry on failure]
 *
 * Mirrors the logic from the build_feature handler in jobQueue.ts.
 *
 * Rules:
 * - If type-check fails:  retry (if attempts remain); otherwise stepPassed=false.
 * - If AI verify returns null (timeout): treat as failure; retry if attempts remain.
 * - If AI verify returns false:  retry if attempts remain; otherwise stepPassed=false.
 * - If AI verify returns true:   stepPassed=true, stop immediately.
 */
export async function runStepAttempts(
  deps: StepAttemptDeps,
): Promise<StepResult> {
  const { maxRetries, runWorker, typeCheck, aiVerify } = deps;

  let stepPassed = false;
  let stepRetries = 0;
  let correctionContext: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const workerOutput = await runWorker(correctionContext);

    // Mechanical gate: type-check must pass before AI review
    const typeCheckResult = await typeCheck();

    if (!typeCheckResult.ok) {
      correctionContext = `TypeScript type-check failed:\n${typeCheckResult.content.slice(0, 800)}`;
      stepRetries++;
      if (attempt < maxRetries) {
        continue; // retry — do NOT proceed to AI verify
      }
      break; // stepPassed remains false
    }

    // AI verification
    const verification = await aiVerify(workerOutput);

    if (verification.passed === true) {
      stepPassed = true;
      break;
    }

    if (verification.passed === null) {
      // Verifier timed out — fail-closed for build_feature
      if (attempt < maxRetries) {
        correctionContext = "AI verifier timed out — retrying step from scratch";
        stepRetries++;
        continue;
      }
      break; // stepPassed remains false
    }

    // passed === false
    if (attempt < maxRetries) {
      correctionContext = verification.reason;
      stepRetries++;
    }
  }

  return { stepPassed, stepRetries, correctionContext };
}
