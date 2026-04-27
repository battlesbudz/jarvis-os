/**
 * review_agent_task — the orchestrator reviews a named agent's completed task
 * and either approves it (marks delivered) or sends it back with feedback
 * (creates a revision job so the agent tries again with corrective context).
 *
 * This implements the feedback loop:
 *   Orchestrator assigns task → Agent runs → Orchestrator reviews →
 *   [approved] done | [revision_needed] agent retries with feedback
 */
import type { AgentTool } from "../types";
import { db } from "../../db";
import { agentJobs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { submitAgentJob } from "../jobQueue";

interface ReviewAgentTaskArgs {
  job_id: string;
  verdict: "approved" | "revision_needed";
  feedback?: string;
}

export const reviewAgentTaskTool: AgentTool = {
  name: "review_agent_task",
  description:
    "Review a named agent's completed task output. Either approve it (marking it done) or request a revision " +
    "by providing specific feedback — the agent will retry with the original task, its previous output, " +
    "and your corrective instructions. Use this after assign_agent_task completes. " +
    "Check the Inbox for the agent's output before calling this.",
  parameters: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The job ID returned by assign_agent_task (or the previous review_agent_task revision).",
      },
      verdict: {
        type: "string",
        enum: ["approved", "revision_needed"],
        description: "approved = mark the task done. revision_needed = send it back to the agent with feedback.",
      },
      feedback: {
        type: "string",
        description:
          "Required when verdict=revision_needed. Specific, actionable instructions for what the agent should fix or improve. " +
          "Be precise — vague feedback produces vague revisions.",
      },
    },
    required: ["job_id", "verdict"],
  },
  async execute(args, ctx) {
    const a = args as ReviewAgentTaskArgs;
    const jobId = String(a.job_id ?? "").trim();
    const verdict = String(a.verdict ?? "").trim();

    if (!jobId) return { ok: false, content: "job_id is required.", label: "Missing job_id" };
    if (!["approved", "revision_needed"].includes(verdict)) {
      return { ok: false, content: "verdict must be 'approved' or 'revision_needed'.", label: "Invalid verdict" };
    }
    if (verdict === "revision_needed" && !String(a.feedback ?? "").trim()) {
      return { ok: false, content: "feedback is required when verdict is revision_needed.", label: "Missing feedback" };
    }

    // Load the job
    const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, jobId)).limit(1);
    if (!job) return { ok: false, content: `Job ${jobId} not found.`, label: "Job not found" };
    if (job.userId !== ctx.userId) return { ok: false, content: "Job does not belong to you.", label: "Permission denied" };
    if (!["complete", "delivered"].includes(job.status)) {
      return {
        ok: false,
        content: `Job is still ${job.status} — wait for it to complete before reviewing.`,
        label: "Job not ready",
      };
    }

    const input = (job.input as Record<string, unknown>) ?? {};
    const namedAgentId = String(input.namedAgentId ?? "");
    const agentName = String(input.agentName ?? "Agent");
    const iterationCount = typeof input.iterationCount === "number" ? input.iterationCount : 0;
    const previousOutput = String((job.result as Record<string, unknown>)?.output ?? "");
    // Preserve the original model override so revision iterations use the same
    // model as the initial run rather than falling back to defaults.
    const modelOverride = typeof input.model === "string" ? input.model : undefined;

    if (verdict === "approved") {
      // Mark as delivered
      await db.update(agentJobs).set({ status: "delivered" }).where(eq(agentJobs.id, jobId));

      return {
        ok: true,
        content: `Task approved. **${agentName}** completed the job in ${iterationCount + 1} iteration(s). Marked as delivered.`,
        label: `Approved: ${agentName}`,
        detail: jobId,
      };
    }

    // revision_needed — spawn a new job with feedback injected
    const feedback = String(a.feedback ?? "").trim();
    const revisionPrompt =
      `## Original Task\n${job.prompt}\n\n` +
      `## Your Previous Output (Iteration ${iterationCount + 1})\n${previousOutput || "(no output recorded)"}\n\n` +
      `## Orchestrator Feedback\n${feedback}\n\n` +
      `## Instructions\n` +
      `Revise your output to fully address the feedback above. ` +
      `Produce the complete updated output — do not reference or summarize the previous version, just deliver the corrected result.`;

    const newTitle = `[Rev ${iterationCount + 2}] ${job.title.replace(/^\[Rev \d+\] /, "")}`;

    const newJobId = await submitAgentJob({
      userId: ctx.userId,
      agentType: "named_agent_task",
      title: newTitle,
      prompt: revisionPrompt,
      input: {
        namedAgentId,
        agentName,
        iterationCount: iterationCount + 1,
        previousJobId: jobId,
        feedback,
        ...(modelOverride ? { model: modelOverride } : {}),
      },
    });

    console.log(
      `[review_agent_task] revision requested for agent=${agentName}(${namedAgentId}) ` +
        `old_job=${jobId} new_job=${newJobId} iteration=${iterationCount + 2}`,
    );

    return {
      ok: true,
      content:
        `Revision requested. **${agentName}** will retry (iteration ${iterationCount + 2}) with your feedback. ` +
        `New job ID: \`${newJobId}\`. You'll get an Inbox notification when it's done.`,
      label: `Revision → ${agentName} (iter ${iterationCount + 2})`,
      detail: newJobId,
    };
  },
};
