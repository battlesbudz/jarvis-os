/**
 * Thin DB client for queuing agent jobs.
 * Extracted from jobQueue.ts so workflowEngine.ts can import it
 * without creating a circular dependency.
 */
import { db } from "../db";
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { SubAgentType } from "./subagents";
import { findDuplicateJob } from "./tools/jobDuplicateGuard";
import { buildInitialWorkerRuntime } from "./workerRuntime";

export type AgentJobType = SubAgentType | "goal_decompose" | "weekly_pattern" | "named_agent_task" | "ephemeral_agent_task" | "general" | "morning_brief" | "custom_agent" | "project_session" | "build_feature" | "deep_research" | "app_project";

export interface SubmitJobInput {
  userId: string;
  agentType: AgentJobType;
  title: string;
  prompt: string;
  input?: Record<string, unknown>;
}

/** Injectable dependencies for submitAgentJob — used by tests to avoid a real DB. */
export interface SubmitJobDeps {
  /** Duplicate-check function. Defaults to the real findDuplicateJob. */
  findDuplicate?: typeof findDuplicateJob;
  /**
   * DB insert function. Defaults to the real drizzle insert.
   * Tests can stub this to verify insertion behaviour without a database.
   * Must return the new job's id.
   */
  insertJob?: (values: {
    userId: string;
    agentType: string;
    title: string;
    prompt: string;
    input: Record<string, unknown>;
    status: string;
  }) => Promise<string>;
}

/**
 * Per-sub-agent-type model routing table.
 *
 * Maps sub-agent types to the appropriate OpenAI GPT mini model for that workload:
 *   - research / planning  → gpt-4.1-mini — stronger reasoning for complex tasks
 *   - writing / email      → gpt-4o-mini  — fast, efficient for prose + drafts
 *
 * Codex OAuth is reserved as the top-level orchestrator brain.
 * All sub-agents (background jobs, named agents, workflow steps) use GPT minis.
 *
 * `submitAgentJob` automatically injects the routed model into `input.model`
 * for every job whose type appears in this table, unless the caller has
 * already supplied an explicit `input.model` override. This means ALL call
 * sites (workflow engine, goal decomposer, tools, routes, etc.) benefit
 * without any per-call changes.
 *
 * To change which model a task type uses, edit this table — nowhere else.
 */
export const SUB_AGENT_MODEL_ROUTING: Partial<Record<AgentJobType, string>> = {
  research: "gpt-4.1-mini",
  planning: "gpt-4.1-mini",
  writing: "gpt-4o-mini",
  email: "gpt-4o-mini",
  morning_brief: "gpt-4o-mini",
  build_feature: "gpt-4.1-mini",
};

/**
 * Return the preferred model string for a given sub-agent job type, or
 * undefined for job types that handle their own model resolution
 * (e.g. weekly_pattern, goal_decompose, named_agent_task).
 */
export function getModelForJobType(agentType: AgentJobType): string | undefined {
  return SUB_AGENT_MODEL_ROUTING[agentType];
}

/** Real DB insert used when no stub is provided via deps.insertJob. */
async function realInsertJob(values: {
  userId: string;
  agentType: string;
  title: string;
  prompt: string;
  input: Record<string, unknown>;
  status: string;
}): Promise<string> {
  const inserted = await db
    .insert(schema.agentJobs)
    .values({
      userId: values.userId,
      agentType: values.agentType,
      title: values.title,
      prompt: values.prompt,
      input: values.input,
      status: "queued",
    })
    .returning({ id: schema.agentJobs.id });
  return inserted[0]?.id ?? "";
}

/** Result returned by {@link submitAgentJob}. */
export interface SubmitJobResult {
  /** The job id — either newly created or the id of an already-running duplicate. */
  id: string;
  /**
   * `true` when an existing queued/running job was found and reused;
   * `false` when a brand-new job row was inserted.
   *
   * Callers can use this to give users different feedback, e.g.:
   *   - `isDuplicate: false` → "Starting…"
   *   - `isDuplicate: true`  → "Already on it!"
   */
  isDuplicate: boolean;
}

/**
 * Enqueue a new agent job, with built-in deduplication.
 *
 * Before inserting a new row, `submitAgentJob` checks for an active (queued
 * or running) job belonging to the same user, with the same agentType and a
 * similar title created within the last 10 minutes.  If a duplicate is found
 * the existing job's id is returned immediately — no second row is inserted.
 *
 * This guard protects every enqueue path (tool calls, workflow engine, route
 * handlers, etc.) without requiring per-caller changes.
 *
 * Both the duplicate-check and the DB insert are injectable via `deps` so
 * that tests can exercise all branches without a real database.
 *
 * @returns `{ id, isDuplicate }` — `isDuplicate` is `true` when an existing
 *   job was reused, `false` when a fresh job was inserted.
 */
export async function submitAgentJob(input: SubmitJobInput, deps: SubmitJobDeps = {}): Promise<SubmitJobResult> {
  const guardFn = deps.findDuplicate ?? findDuplicateJob;
  const insertFn = deps.insertJob ?? realInsertJob;

  // ── Deduplication check ────────────────────────────────────────────────────
  try {
    const existing = await guardFn(input.userId, input.agentType, input.title);
    if (existing) {
      console.log(
        `[JobQueue] duplicate suppressed — returning existing job=${existing.id} type=${input.agentType} user=${input.userId} title="${input.title.slice(0, 60)}"`,
      );
      return { id: existing.id, isDuplicate: true };
    }
  } catch (dupErr) {
    // Non-fatal — log and proceed to insert normally so the system stays
    // available even if the duplicate-check query fails transiently.
    console.warn("[JobQueue] duplicate-check failed (proceeding with insert):", dupErr);
  }

  // Auto-inject the routed model when the caller has not provided one.
  const callerInput = (input.input || {}) as Record<string, unknown>;
  const routedModel = getModelForJobType(input.agentType);
  const mergedInput: Record<string, unknown> =
    callerInput.model !== undefined || routedModel === undefined
      ? callerInput
      : { ...callerInput, model: routedModel };
  const workerRuntime = buildInitialWorkerRuntime({
    agentType: input.agentType,
    title: input.title,
    input: mergedInput,
  });
  const runtimeInput: Record<string, unknown> = {
    ...mergedInput,
    workerType: workerRuntime.workerType,
    workerRuntime,
  };

  const id = await insertFn({
    userId: input.userId,
    agentType: input.agentType,
    title: input.title.slice(0, 200),
    prompt: input.prompt,
    input: runtimeInput,
    status: "queued",
  });

  const model = runtimeInput.model ?? "agent-default";
  console.log(
    `[JobQueue] queued job ${id} type=${input.agentType} model=${model} user=${input.userId} title="${input.title.slice(0, 60)}"`,
  );
  return { id, isDuplicate: false };
}

// ── Cancel-all helper ─────────────────────────────────────────────────────────

export interface CancelAllResult {
  jobsCancelled: number;
  jobsCancelling: number;
  workflowsPaused: number;
}

/**
 * Cancel every queued and running job for the given user, and pause any active
 * or paused_waiting workflows. Used by the /stop slash command.
 *
 * - `queued` jobs → `cancelled` immediately (no worker has picked them up yet)
 * - `running` jobs → `cancelling`  (the worker loop honours this flag and aborts)
 * - `active` / `paused_waiting` workflows → `paused`
 */
export async function cancelAllForUser(userId: string): Promise<CancelAllResult> {
  const cancelled = await db
    .update(schema.agentJobs)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(and(eq(schema.agentJobs.userId, userId), eq(schema.agentJobs.status, "queued")))
    .returning({ id: schema.agentJobs.id });

  const cancelling = await db
    .update(schema.agentJobs)
    .set({ status: "cancelling" })
    .where(and(eq(schema.agentJobs.userId, userId), eq(schema.agentJobs.status, "running")))
    .returning({ id: schema.agentJobs.id });

  const paused = await db
    .update(schema.agentWorkflows)
    .set({ status: "paused", updatedAt: new Date() })
    .where(
      and(
        eq(schema.agentWorkflows.userId, userId),
        inArray(schema.agentWorkflows.status, ["active", "paused_waiting"]),
      ),
    )
    .returning({ id: schema.agentWorkflows.id });

  console.log(
    `[JobQueue] cancelAllForUser userId=${userId} — cancelled=${cancelled.length} cancelling=${cancelling.length} workflowsPaused=${paused.length}`,
  );

  return {
    jobsCancelled: cancelled.length,
    jobsCancelling: cancelling.length,
    workflowsPaused: paused.length,
  };
}
