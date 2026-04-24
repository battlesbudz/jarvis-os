/**
 * Workflow Engine — persistence layer and auto-advance logic.
 *
 * Imports from jobClient.ts (not jobQueue.ts) to avoid circular deps:
 *   jobQueue.ts → workflowEngine.ts → jobClient.ts ✓
 */
import { db } from "../db";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { WorkflowStep } from "@shared/schema";
import { notifyUser } from "../channels/registry";
import { submitAgentJob } from "./jobClient";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_AGENT_TYPE = "research";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build an enriched prompt for a step that includes prior step outputs. */
export function buildStepPrompt(
  workflow: typeof schema.agentWorkflows.$inferSelect,
  stepIdx: number,
): string {
  const steps = workflow.steps as WorkflowStep[];
  const step = steps[stepIdx];
  const completedBefore = steps.slice(0, stepIdx).filter((s) => s.status === "complete");

  const lines: string[] = [];
  lines.push(`=== WORKFLOW: "${workflow.title}" ===`);
  if (workflow.description) lines.push(`Context: ${workflow.description}`);
  lines.push(`You are executing Step ${stepIdx + 1} of ${steps.length}: "${step.title}"`);
  lines.push("");

  if (completedBefore.length > 0) {
    lines.push("Prior completed steps (use as context):");
    for (const s of completedBefore) {
      const out = s.output ? `\n${s.output.slice(0, 1500)}` : " (no output captured)";
      lines.push(`— "${s.title}":${out}`);
    }
    lines.push("");
  }

  lines.push("=== YOUR TASK ===");
  lines.push(step.prompt);
  return lines.join("\n");
}


// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute the step at `stepIdx` of a workflow:
 * - Builds enriched prompt from prior step outputs
 * - Queues an agent job
 * - Updates the step and workflow status in the DB
 * Returns the queued jobId.
 */
export async function executeWorkflowStep(
  workflow: typeof schema.agentWorkflows.$inferSelect,
  stepIdx: number,
): Promise<string> {
  const steps = (workflow.steps as WorkflowStep[]).map((s, i) =>
    i === stepIdx ? { ...s, status: "running" as const, startedAt: new Date().toISOString() } : s,
  );

  const enrichedPrompt = buildStepPrompt({ ...workflow, steps }, stepIdx);
  const step = steps[stepIdx];
  const jobId = await submitAgentJob({
    userId: workflow.userId,
    agentType: (step.agentType || DEFAULT_AGENT_TYPE) as Parameters<typeof submitAgentJob>[0]["agentType"],
    title: step.title,
    prompt: enrichedPrompt,
    input: { workflowId: workflow.id, workflowStepIndex: stepIdx },
  });

  steps[stepIdx] = { ...steps[stepIdx], jobId };

  await db
    .update(schema.agentWorkflows)
    .set({
      steps,
      currentStepIndex: stepIdx,
      status: "paused_waiting",
      updatedAt: new Date(),
    })
    .where(eq(schema.agentWorkflows.id, workflow.id));

  console.log(
    `[Workflow] queued step ${stepIdx + 1}/${workflow.steps.length} ` +
      `workflow="${workflow.title}" job=${jobId}`,
  );
  return jobId;
}

/**
 * Called from jobQueue.ts processJob after a job completes.
 * Updates the step output and auto-advances to the next step (or marks complete).
 */
export async function onWorkflowJobComplete(
  workflowId: string,
  stepIndex: number,
  _jobId: string,
  output: string,
): Promise<void> {
  const [workflow] = await db
    .select()
    .from(schema.agentWorkflows)
    .where(eq(schema.agentWorkflows.id, workflowId))
    .limit(1);

  if (!workflow) {
    console.warn(`[Workflow] onJobComplete: workflow ${workflowId} not found`);
    return;
  }

  const steps = (workflow.steps as WorkflowStep[]).map((s, i) =>
    i === stepIndex
      ? { ...s, status: "complete" as const, output, completedAt: new Date().toISOString() }
      : s,
  );

  const nextPendingIdx = steps.findIndex((s) => s.status === "pending");

  if (workflow.status !== "paused_waiting") {
    // Paused by user — just record the output, don't auto-advance.
    await db
      .update(schema.agentWorkflows)
      .set({ steps, updatedAt: new Date() })
      .where(eq(schema.agentWorkflows.id, workflowId));
    console.log(
      `[Workflow] step ${stepIndex + 1} complete (workflow paused — not advancing)`,
    );
    return;
  }

  if (nextPendingIdx === -1) {
    // All steps done.
    await db
      .update(schema.agentWorkflows)
      .set({ steps, status: "complete", updatedAt: new Date() })
      .where(eq(schema.agentWorkflows.id, workflowId));
    console.log(`[Workflow] "${workflow.title}" complete — all steps done`);
    await notifyUser(
      workflow.userId,
      "approval_request",
      `✅ Workflow complete: "${workflow.title}"\nAll ${steps.length} step(s) finished.`,
    ).catch(() => {});
    return;
  }

  // Auto-advance to next step.
  const updatedWorkflow = { ...workflow, steps };
  await db
    .update(schema.agentWorkflows)
    .set({ steps, updatedAt: new Date() })
    .where(eq(schema.agentWorkflows.id, workflowId));

  const nextJobId = await executeWorkflowStep(updatedWorkflow, nextPendingIdx);
  console.log(
    `[Workflow] "${workflow.title}" auto-advanced → step ${nextPendingIdx + 1} job=${nextJobId}`,
  );
}

/**
 * Called from jobQueue.ts when a workflow step job fails.
 */
export async function onWorkflowJobFail(
  workflowId: string,
  stepIndex: number,
  error: string,
): Promise<void> {
  const [workflow] = await db
    .select()
    .from(schema.agentWorkflows)
    .where(eq(schema.agentWorkflows.id, workflowId))
    .limit(1);

  if (!workflow) return;

  const steps = (workflow.steps as WorkflowStep[]).map((s, i) =>
    i === stepIndex
      ? { ...s, status: "failed" as const, output: `Error: ${error}`, completedAt: new Date().toISOString() }
      : s,
  );

  await db
    .update(schema.agentWorkflows)
    .set({ steps, status: "failed", updatedAt: new Date() })
    .where(eq(schema.agentWorkflows.id, workflowId));

  await notifyUser(
    workflow.userId,
    "approval_request",
    `❌ Workflow failed: "${workflow.title}" — Step ${stepIndex + 1} error: ${error.slice(0, 300)}`,
  ).catch(() => {});
}
