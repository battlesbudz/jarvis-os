/**
 * Workflow agent tools — workflow_create, workflow_run, workflow_status,
 * workflow_pause, workflow_resume, workflow_list.
 */
import type { AgentTool } from "../types";
import { db } from "../../db";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { WorkflowStep } from "@shared/schema";
import { executeWorkflowStep } from "../workflowEngine";
import { SUB_AGENT_TYPES } from "../subagents";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepStatusIcon(s: WorkflowStep): string {
  switch (s.status) {
    case "complete": return "✅";
    case "running":  return "⏳";
    case "failed":   return "❌";
    default:         return "⬜";
  }
}

function workflowSummary(w: typeof schema.agentWorkflows.$inferSelect): string {
  const steps = w.steps as WorkflowStep[];
  const done  = steps.filter((s) => s.status === "complete").length;
  const lines = [
    `**${w.title}** [${w.status}] — Step ${w.currentStepIndex + 1}/${steps.length} (${done} complete)`,
  ];
  steps.forEach((s, i) => {
    const out = s.output ? ` → ${s.output.slice(0, 120)}…` : "";
    lines.push(`  ${stepStatusIcon(s)} Step ${i + 1}: ${s.title}${s.jobId ? ` (job ${s.jobId})` : ""}${out}`);
  });
  return lines.join("\n");
}

async function loadWorkflow(
  workflowId: string,
  userId: string,
): Promise<typeof schema.agentWorkflows.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(schema.agentWorkflows)
    .where(and(eq(schema.agentWorkflows.id, workflowId), eq(schema.agentWorkflows.userId, userId)))
    .limit(1);
  return row || null;
}

// ── workflow_create ───────────────────────────────────────────────────────────

export const workflowCreateTool: AgentTool = {
  name: "workflow_create",
  description:
    "Define a named multi-step workflow that Jarvis will execute sequentially. Each step runs as a background agent job and its output is automatically injected into the next step's context. Returns a workflow ID. Use workflow_run to start execution, workflow_status to inspect progress, workflow_pause/resume to control it.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short name for the workflow (e.g. 'Competitor research sprint')" },
      description: { type: "string", description: "Optional context injected into every step prompt so the agent understands the big picture." },
      steps: {
        type: "array",
        description: "Ordered list of steps. Each step becomes a background agent job.",
        items: {
          type: "object",
          properties: {
            title:      { type: "string", description: "Step name (shown in status)" },
            prompt:     { type: "string", description: "Full instruction for this step. Be specific — prior step outputs are automatically prepended as context." },
            agent_type: { type: "string", enum: SUB_AGENT_TYPES, description: "Agent type for this step (default: research)" },
          },
          required: ["title", "prompt"],
        },
      },
    },
    required: ["title", "steps"],
  },
  async execute(args, ctx) {
    const title = String(args.title || "").trim();
    const description = args.description ? String(args.description).trim() : null;
    const rawSteps = Array.isArray(args.steps) ? args.steps : [];

    if (!title) return { ok: false, content: "title is required.", label: "workflow_create: no title" };
    if (rawSteps.length === 0) return { ok: false, content: "At least one step is required.", label: "workflow_create: no steps" };
    if (rawSteps.length > 20) return { ok: false, content: "Max 20 steps per workflow.", label: "workflow_create: too many steps" };

    // Validate each step has a non-empty title and prompt.
    for (let i = 0; i < rawSteps.length; i++) {
      const s = rawSteps[i] as Record<string, unknown>;
      const stepTitle = String(s.title || "").trim();
      const stepPrompt = String(s.prompt || "").trim();
      if (!stepTitle) return { ok: false, content: `Step ${i + 1}: "title" is required and cannot be empty.`, label: "workflow_create: missing step title" };
      if (!stepPrompt) return { ok: false, content: `Step ${i + 1} ("${stepTitle}"): "prompt" is required and cannot be empty.`, label: "workflow_create: missing step prompt" };
    }

    const steps: WorkflowStep[] = rawSteps.map((s: Record<string, unknown>, i: number) => ({
      id: `step_${i + 1}`,
      title: String(s.title).trim(),
      prompt: String(s.prompt).trim(),
      agentType: SUB_AGENT_TYPES.includes(String(s.agent_type) as typeof SUB_AGENT_TYPES[number])
        ? String(s.agent_type)
        : "research",
      status: "pending",
    }));

    try {
      const [wf] = await db
        .insert(schema.agentWorkflows)
        .values({ userId: ctx.userId, title, description, steps, status: "active" })
        .returning();

      console.log(`[${ctx.channel || "Agent"}] workflow_create id=${wf.id} steps=${steps.length}`);
      return {
        ok: true,
        content:
          `Created workflow "${title}" with ${steps.length} step(s).\n` +
          `Workflow ID: ${wf.id}\n\n` +
          `Steps:\n${steps.map((s, i) => `  ${i + 1}. ${s.title}`).join("\n")}\n\n` +
          `Call workflow_run with this ID to start execution.`,
        label: `Workflow created: ${title}`,
        detail: wf.id,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `workflow_create failed: ${msg}`, label: "workflow_create: error" };
    }
  },
};

// ── workflow_run ──────────────────────────────────────────────────────────────

export const workflowRunTool: AgentTool = {
  name: "workflow_run",
  description:
    "Start or resume a workflow from its current pending step. Queues a background job for that step and auto-advances through remaining steps as each finishes. Use workflow_status to check progress. Returns immediately with the queued job ID.",
  parameters: {
    type: "object",
    properties: {
      workflow_id: { type: "string", description: "Workflow ID from workflow_create or workflow_list" },
    },
    required: ["workflow_id"],
  },
  async execute(args, ctx) {
    const workflowId = String(args.workflow_id || "").trim();
    if (!workflowId) return { ok: false, content: "workflow_id is required.", label: "workflow_run: no ID" };

    const wf = await loadWorkflow(workflowId, ctx.userId);
    if (!wf) return { ok: false, content: `Workflow "${workflowId}" not found.`, label: "workflow_run: not found" };

    if (wf.status === "complete") return { ok: false, content: "Workflow is already complete.", label: "workflow_run: done" };
    if (wf.status === "failed") return { ok: false, content: "Workflow failed. Create a new one.", label: "workflow_run: failed" };
    if (wf.status === "paused_waiting") {
      return {
        ok: false,
        content: `Workflow is already running step ${wf.currentStepIndex + 1}. Use workflow_status to check progress.`,
        label: "workflow_run: already running",
      };
    }

    const steps = wf.steps as WorkflowStep[];
    const nextIdx = steps.findIndex((s) => s.status === "pending");
    if (nextIdx === -1) {
      // All marked complete but status not updated — fix it
      await db
        .update(schema.agentWorkflows)
        .set({ status: "complete", updatedAt: new Date() })
        .where(eq(schema.agentWorkflows.id, wf.id));
      return { ok: true, content: "All steps were already complete. Workflow marked done.", label: "workflow_run: already done" };
    }

    try {
      const jobId = await executeWorkflowStep(wf, nextIdx);
      console.log(`[${ctx.channel || "Agent"}] workflow_run wf=${workflowId} step=${nextIdx + 1} job=${jobId}`);
      return {
        ok: true,
        content:
          `Started step ${nextIdx + 1}/${steps.length}: "${steps[nextIdx].title}"\n` +
          `Background job queued: ${jobId}\n` +
          `The workflow will auto-advance through remaining steps as each finishes.\n` +
          `Use workflow_status to check progress.`,
        label: `Workflow running: step ${nextIdx + 1}`,
        detail: jobId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `workflow_run failed: ${msg}`, label: "workflow_run: error" };
    }
  },
};

// ── workflow_status ───────────────────────────────────────────────────────────

export const workflowStatusTool: AgentTool = {
  name: "workflow_status",
  description:
    "Inspect the full state of a workflow: which step is running, which are complete, and the output of each completed step. Use this to monitor progress or to retrieve outputs before starting the next step.",
  parameters: {
    type: "object",
    properties: {
      workflow_id: { type: "string", description: "Workflow ID" },
    },
    required: ["workflow_id"],
  },
  async execute(args, ctx) {
    const workflowId = String(args.workflow_id || "").trim();
    if (!workflowId) return { ok: false, content: "workflow_id is required.", label: "workflow_status: no ID" };

    const wf = await loadWorkflow(workflowId, ctx.userId);
    if (!wf) return { ok: false, content: `Workflow "${workflowId}" not found.`, label: "workflow_status: not found" };

    const summary = workflowSummary(wf);
    const steps = wf.steps as WorkflowStep[];

    // Include full outputs for completed steps
    const outputLines: string[] = [];
    steps.forEach((s, i) => {
      if (s.status === "complete" && s.output) {
        outputLines.push(`\n--- Step ${i + 1} Output: "${s.title}" ---\n${s.output.slice(0, 2000)}`);
      }
    });

    const content = summary + (outputLines.length > 0 ? "\n\n" + outputLines.join("\n") : "");
    return {
      ok: true,
      content,
      label: `Workflow status: ${wf.title}`,
      detail: `status=${wf.status} step=${wf.currentStepIndex + 1}/${steps.length}`,
    };
  },
};

// ── workflow_pause ────────────────────────────────────────────────────────────

export const workflowPauseTool: AgentTool = {
  name: "workflow_pause",
  description:
    "Pause a workflow. The currently-running step job will finish, but Jarvis will not auto-advance to the next step. Use workflow_resume to continue.",
  parameters: {
    type: "object",
    properties: {
      workflow_id: { type: "string", description: "Workflow ID to pause" },
    },
    required: ["workflow_id"],
  },
  async execute(args, ctx) {
    const workflowId = String(args.workflow_id || "").trim();
    if (!workflowId) return { ok: false, content: "workflow_id is required.", label: "workflow_pause: no ID" };

    const wf = await loadWorkflow(workflowId, ctx.userId);
    if (!wf) return { ok: false, content: `Workflow "${workflowId}" not found.`, label: "workflow_pause: not found" };

    if (wf.status === "complete" || wf.status === "failed") {
      return { ok: false, content: `Workflow is already ${wf.status}.`, label: "workflow_pause: terminal" };
    }
    if (wf.status === "paused") {
      return { ok: true, content: "Workflow is already paused.", label: "workflow_pause: already paused" };
    }

    await db
      .update(schema.agentWorkflows)
      .set({ status: "paused", updatedAt: new Date() })
      .where(and(eq(schema.agentWorkflows.id, workflowId), eq(schema.agentWorkflows.userId, ctx.userId)));

    console.log(`[${ctx.channel || "Agent"}] workflow_pause wf=${workflowId}`);
    return {
      ok: true,
      content: `Workflow "${wf.title}" paused. Use workflow_resume to continue.`,
      label: `Workflow paused: ${wf.title}`,
    };
  },
};

// ── workflow_resume ───────────────────────────────────────────────────────────

export const workflowResumeTool: AgentTool = {
  name: "workflow_resume",
  description:
    "Resume a paused workflow from the next pending step. Triggers immediate execution of that step.",
  parameters: {
    type: "object",
    properties: {
      workflow_id: { type: "string", description: "Workflow ID to resume" },
    },
    required: ["workflow_id"],
  },
  async execute(args, ctx) {
    const workflowId = String(args.workflow_id || "").trim();
    if (!workflowId) return { ok: false, content: "workflow_id is required.", label: "workflow_resume: no ID" };

    const wf = await loadWorkflow(workflowId, ctx.userId);
    if (!wf) return { ok: false, content: `Workflow "${workflowId}" not found.`, label: "workflow_resume: not found" };

    if (wf.status !== "paused") {
      return {
        ok: false,
        content: `Workflow is "${wf.status}" — only paused workflows can be resumed. ${
          wf.status === "paused_waiting" ? "A step is already running." : ""
        }`,
        label: "workflow_resume: not paused",
      };
    }

    const steps = wf.steps as WorkflowStep[];
    const nextIdx = steps.findIndex((s) => s.status === "pending");
    if (nextIdx === -1) {
      await db
        .update(schema.agentWorkflows)
        .set({ status: "complete", updatedAt: new Date() })
        .where(eq(schema.agentWorkflows.id, wf.id));
      return { ok: true, content: "All steps were already complete. Workflow marked done.", label: "workflow_resume: done" };
    }

    // Set active first so executeWorkflowStep correctly sets paused_waiting
    await db
      .update(schema.agentWorkflows)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(schema.agentWorkflows.id, wf.id));

    try {
      const jobId = await executeWorkflowStep({ ...wf, status: "active" }, nextIdx);
      console.log(`[${ctx.channel || "Agent"}] workflow_resume wf=${workflowId} step=${nextIdx + 1} job=${jobId}`);
      return {
        ok: true,
        content:
          `Resumed workflow "${wf.title}" — starting step ${nextIdx + 1}/${steps.length}: "${steps[nextIdx].title}"\n` +
          `Background job queued: ${jobId}`,
        label: `Workflow resumed: ${wf.title}`,
        detail: jobId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `workflow_resume failed: ${msg}`, label: "workflow_resume: error" };
    }
  },
};

// ── workflow_list ─────────────────────────────────────────────────────────────

export const workflowListTool: AgentTool = {
  name: "workflow_list",
  description:
    "List all workflows for this user — active, paused, and recently completed. Returns IDs, titles, and current status so you can call workflow_status, workflow_run, or workflow_pause on them.",
  parameters: {
    type: "object",
    properties: {
      include_complete: { type: "boolean", description: "Include completed/failed workflows (default: false)" },
    },
    required: [],
  },
  async execute(args, ctx) {
    const includeComplete = args.include_complete === true;

    const rows = await db
      .select()
      .from(schema.agentWorkflows)
      .where(eq(schema.agentWorkflows.userId, ctx.userId))
      .orderBy(desc(schema.agentWorkflows.updatedAt))
      .limit(20);

    const filtered = includeComplete
      ? rows
      : rows.filter((w) => !["complete", "failed"].includes(w.status));

    if (filtered.length === 0) {
      return {
        ok: true,
        content: includeComplete ? "No workflows found." : "No active workflows. Use workflow_create to define one.",
        label: "workflow_list: empty",
      };
    }

    const lines = filtered.map((w) => {
      const steps = w.steps as WorkflowStep[];
      const done  = steps.filter((s) => s.status === "complete").length;
      return `• [${w.id}] "${w.title}" — ${w.status} (${done}/${steps.length} steps done)`;
    });

    return {
      ok: true,
      content: `${filtered.length} workflow(s):\n\n${lines.join("\n")}`,
      label: `Workflows (${filtered.length})`,
    };
  },
};
