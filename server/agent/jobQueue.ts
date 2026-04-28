import { db } from "../db";
import { eq, and, sql, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { SubAgentType } from "./subagents";
import { runSubAgent } from "./subagents";
import { runGoalDecomposition } from "./goalDecomposer";
import { runNamedAgent } from "./runNamedAgent";
import { runWeeklyPatternJob } from "../memory/weeklyJob";
import { getValidGoogleTokens } from "../userTokenStore";
import type { ToolContext } from "./types";
import { notifyUser } from "../channels/registry";
import { onWorkflowJobComplete, onWorkflowJobFail } from "./workflowEngine";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import { logSystemError } from "./errorLogger";
import { submitAgentJob as _submitAgentJob, getModelForJobType as _getModelForJobType, type SubmitJobInput, type AgentJobType as _AgentJobType } from "./jobClient";
import { runAgent } from "./harness";
import { readRecentErrorsTool, listSourceFilesTool, readSourceFileTool, proposeCodeChangeTool } from "./tools/selfEditTools";
import { researchHasSourceUrls } from "./researchUtils";

// Re-export from the shared client so existing callers don't break.
export type AgentJobType = _AgentJobType;
export type { SubmitJobInput };
export const submitAgentJob = _submitAgentJob;
export const getModelForJobType = _getModelForJobType;

async function notifyJobComplete(
  userId: string,
  agentType: AgentJobType,
  title: string,
  body: string,
): Promise<void> {
  try {
    // Sub-agent deliverables (decompositions, drafts, etc.) typically need a
    // human approval before they take effect — route through the user's
    // configured channel for "approval_request".
    await notifyUser(
      userId,
      "approval_request",
      `Jarvis (${agentType}): ${title}\n\n${body}`,
    );
  } catch (err) {
    console.error("[JobQueue] notify failed:", err);
  }
}

const TICK_MS = 15 * 1000;
const MAX_JOB_DURATION_MS = 5 * 60 * 1000;

let workerRunning = false;
let workerStarted = false;
let stopRequested = false;

async function claimNextJob(): Promise<typeof schema.agentJobs.$inferSelect | null> {
  // Pick the oldest queued job whose user has no currently-running job.
  // Use a single SQL CTE so the claim is atomic across worker restarts.
  // Important: raw SQL returns column names verbatim (snake_case), so we
  // claim the id here, then do a typed Drizzle select to get a properly
  // mapped camelCase row.
  const claimed = await db.execute<{ id: string }>(sql`
    WITH busy_users AS (
      SELECT DISTINCT user_id FROM agent_jobs WHERE status IN ('running', 'cancelling')
    ),
    candidate AS (
      SELECT id FROM agent_jobs
      WHERE status = 'queued'
        AND user_id NOT IN (SELECT user_id FROM busy_users)
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE agent_jobs SET status = 'running', started_at = NOW()
    WHERE id IN (SELECT id FROM candidate)
    RETURNING id
  `);
  const claimedId = claimed.rows?.[0]?.id;
  if (!claimedId) return null;

  const [row] = await db
    .select()
    .from(schema.agentJobs)
    .where(eq(schema.agentJobs.id, claimedId))
    .limit(1);
  return row || null;
}

async function failJob(jobId: string, message: string, userId?: string): Promise<void> {
  try {
    await db
      .update(schema.agentJobs)
      .set({ status: "failed", error: message.slice(0, 2000), completedAt: new Date() })
      .where(eq(schema.agentJobs.id, jobId));
  } catch (err) {
    console.error(`[JobQueue] failJob ${jobId} write failed:`, err);
  }
  diagEmit({
    userId,
    subsystem: "job_queue",
    severity: "error",
    message: `Job ${jobId} failed: ${message.slice(0, 200)}`,
    metadata: { jobId },
  }).catch(() => {});
}

async function completeJob(
  jobId: string,
  payload: { result: Record<string, unknown>; turns: number; toolCallsCount: number },
): Promise<void> {
  await db
    .update(schema.agentJobs)
    .set({
      status: "complete",
      result: payload.result,
      turns: payload.turns,
      toolCallsCount: payload.toolCallsCount,
      completedAt: new Date(),
    })
    .where(eq(schema.agentJobs.id, jobId));
}

async function processJob(job: typeof schema.agentJobs.$inferSelect): Promise<void> {
  console.log(`[JobQueue] running job ${job.id} type=${job.agentType} user=${job.userId}`);

  const watchdog = setTimeout(() => {
    console.warn(`[JobQueue] job ${job.id} exceeded ${MAX_JOB_DURATION_MS}ms (still running)`);
  }, MAX_JOB_DURATION_MS);

  try {
    // Helper: fire the workflow hook if this job belongs to a workflow step.
    const wfId    = (job.input as Record<string, unknown>)?.workflowId    as string | undefined;
    const wfStep  = (job.input as Record<string, unknown>)?.workflowStepIndex as number | undefined;
    const hasWorkflow = !!wfId && wfStep !== undefined;

    if (job.agentType === "weekly_pattern") {
      const result = await runWeeklyPatternJob(job.userId);
      await completeJob(job.id, {
        result: { weekOf: result.weekOf, patterns: result.patternCount, promoted: result.promotedMemories },
        turns: 1,
        toolCallsCount: 0,
      });
      diagEmit({
        userId: job.userId,
        subsystem: "job_queue",
        severity: "info",
        message: `Job ${job.id} (weekly_pattern) completed — ${result.patternCount} patterns`,
        metadata: { jobId: job.id, agentType: job.agentType, recovery: true },
      }).catch(() => {});
      console.log(`[JobQueue] complete weekly_pattern job ${job.id} → ${result.patternCount} patterns`);
      const weeklyMsg = result.driveLink
        ? `${result.patternCount} pattern(s) identified, ${result.promotedMemories} promoted to long-term memory.\n${result.summary}\n\n📁 Saved to Google Drive: ${result.driveLink}`
        : `${result.patternCount} pattern(s) identified, ${result.promotedMemories} promoted to long-term memory.\n${result.summary}`;
      await notifyJobComplete(
        job.userId,
        "weekly_pattern",
        `Weekly review (${result.weekOf})`,
        weeklyMsg,
      );
      if (hasWorkflow) {
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, result.summary || weeklyMsg).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    // ── Named-agent task (orchestrator-dispatched) ─────────────────────────
    if (job.agentType === "named_agent_task") {
      const input = (job.input as Record<string, unknown>) ?? {};
      const namedAgentId = String(input.namedAgentId ?? "");
      const agentName = String(input.agentName ?? "Agent");
      const iterationCount = typeof input.iterationCount === "number" ? input.iterationCount : 0;
      // Optional per-request model override from the orchestrator.
      const namedAgentModel = typeof input.model === "string" ? input.model : undefined;

      if (!namedAgentId) throw new Error("named_agent_task job missing namedAgentId");

      console.log(
        `[JobQueue] named_agent_task agent=${agentName}(${namedAgentId}) iteration=${iterationCount + 1}`,
      );

      const result = await runNamedAgent({
        agentId: namedAgentId,
        userId: job.userId,
        userMessage: job.prompt,
        platform: "orchestrator",
        initiatedBy: "jarvis",
        model: namedAgentModel,
      });

      await completeJob(job.id, {
        result: {
          output: result.reply,
          agentId: namedAgentId,
          agentName,
          iterationCount,
        },
        turns: result.turns,
        toolCallsCount: result.toolCalls?.length ?? 0,
      });

      console.log(
        `[JobQueue] named_agent_task complete: agent=${agentName} job=${job.id} ` +
          `turns=${result.turns} iteration=${iterationCount + 1}`,
      );

      const snippet = result.reply.slice(0, 280);
      await notifyJobComplete(
        job.userId,
        "named_agent_task",
        `${agentName} — ${job.title}`,
        `Iteration ${iterationCount + 1} complete. Review output and approve or request a revision.\n\n${snippet}${result.reply.length > 280 ? "…" : ""}`,
      );

      if (hasWorkflow) {
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, result.reply.slice(0, 1200)).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    if (job.agentType === "goal_decompose") {
      const result = await runGoalDecomposition(job);
      await completeJob(job.id, {
        result: { goalTreeId: result.goalTreeId, phases: result.phaseCount },
        turns: result.turns,
        toolCallsCount: result.toolCallsCount,
      });
      diagEmit({
        userId: job.userId,
        subsystem: "job_queue",
        severity: "info",
        message: `Job ${job.id} (goal_decompose) completed — ${result.phaseCount} phases`,
        metadata: { jobId: job.id, agentType: job.agentType, recovery: true },
      }).catch(() => {});
      console.log(`[JobQueue] complete goal_decompose job ${job.id} → tree ${result.goalTreeId}`);
      const goalMsg = `Goal broken into ${result.phaseCount} phase(s). Open the Goals tab to review.`;
      await notifyJobComplete(job.userId, "goal_decompose", job.title, goalMsg);
      if (hasWorkflow) {
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, goalMsg).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    // ── General-purpose diagnostic agent (e.g. auto-debug from IntegrationValidator) ─
    if (job.agentType === "general") {
      const generalCtx: ToolContext = {
        userId: job.userId,
        googleAccessToken: null,
        channel: `JobQueue/general`,
        state: { pendingAttachments: [] },
      };

      const debugTools = [
        readRecentErrorsTool,
        listSourceFilesTool,
        readSourceFileTool,
        proposeCodeChangeTool,
      ];

      const result = await runAgent({
        messages: [
          {
            role: "system",
            content: `You are Jarvis, an AI assistant running a background diagnostic task.
The user is NOT present in this conversation. Your job is to investigate an error, diagnose the root
cause, and either propose a code fix or send a plain-English diagnosis to the user's inbox.

Always conclude by either calling propose_code_change (if a targeted code fix is appropriate) or by
writing a clear inbox message explaining what is broken and what the user should do.`,
          },
          { role: "user", content: job.prompt },
        ],
        tools: debugTools,
        context: generalCtx,
        maxTurns: 8,
      });

      await completeJob(job.id, {
        result: { output: result.reply, agentType: "general" },
        turns: result.turns,
        toolCallsCount: result.toolCalls?.length ?? 0,
      });

      console.log(`[JobQueue] complete general job ${job.id} turns=${result.turns}`);

      const generalReply = result.reply?.trim()
        ? result.reply.slice(0, 3000)
        : "Auto-debug ran but produced no summary. Please check the Proposals tab or review recent error logs for details.";
      await notifyJobComplete(job.userId, "general", job.title, generalReply);

      if (hasWorkflow) {
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, generalReply).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    // Sub-agent run
    const tokens = await getValidGoogleTokens(job.userId).catch(() => []);
    const googleAccessToken = tokens?.[0] || null;
    const ctx: ToolContext = {
      userId: job.userId,
      googleAccessToken,
      channel: `JobQueue/${job.agentType}`,
      state: { pendingAttachments: [] },
    };

    // Per-type model routing is handled at orchestrator-controlled spawn points
    // (queue_background_job, spawn_subagent) via getModelForJobType(). The model
    // arrives here via job.input.model. Other callers that omit input.model
    // preserve the original resolution path inside runSubAgent.
    const jobInput = (job.input as Record<string, unknown>) ?? {};
    const subAgentModelOverride = typeof jobInput.model === "string" ? jobInput.model : undefined;

    const sub = await runSubAgent({
      agentType: job.agentType as SubAgentType,
      prompt: job.prompt,
      defaultTitle: job.title,
      context: ctx,
      model: subAgentModelOverride,
    });

    if (job.agentType === "research" && !researchHasSourceUrls(sub.body)) {
      sub.meta.noSourceUrls = true;
      const NO_SOURCES_BANNER =
        "> ⚠️ **No cited sources.** This result does not contain a ## Sources section with real URLs. " +
        "The research agent may not have performed a live web search. Verify any claims before acting on them.\n\n";
      sub.body = NO_SOURCES_BANNER + sub.body;
      sub.summary = "⚠️ No cited sources — " + sub.summary;
    }

    const inserted = await db
      .insert(schema.deliverables)
      .values({
        userId: job.userId,
        jobId: job.id,
        agentType: job.agentType,
        type: sub.type,
        title: sub.title,
        summary: sub.summary,
        body: sub.body,
        meta: sub.meta,
      })
      .returning({ id: schema.deliverables.id });

    const deliverableId = inserted[0]?.id || "";
    await completeJob(job.id, {
      result: { deliverableId, type: sub.type, title: sub.title },
      turns: sub.turns,
      toolCallsCount: sub.toolCallsCount,
    });
    diagEmit({
      userId: job.userId,
      subsystem: "job_queue",
      severity: "info",
      message: `Job ${job.id} (${job.agentType}) completed — deliverable ${deliverableId}`,
      metadata: { jobId: job.id, agentType: job.agentType, recovery: true },
    }).catch(() => {});
    console.log(`[JobQueue] complete ${job.agentType} job ${job.id} → deliverable ${deliverableId}`);
    const subNotifyMsg = `${sub.summary || "Ready for review"} — open Inbox to approve, edit, or discard.`;
    await notifyJobComplete(
      job.userId,
      job.agentType as AgentJobType,
      sub.title,
      subNotifyMsg,
    );
    if (hasWorkflow) {
      const wfOutput = `${sub.title}\n\n${sub.summary || ""}\n\n${sub.body?.slice(0, 1200) || ""}`.trim();
      await onWorkflowJobComplete(wfId!, wfStep!, job.id, wfOutput).catch((e) =>
        console.error("[JobQueue] workflow hook failed:", e),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JobQueue] job ${job.id} failed:`, err);

    const jobInput = (job.input as Record<string, unknown>) ?? {};
    const retryCount = typeof jobInput.retryCount === "number" ? jobInput.retryCount : 0;
    const MAX_RETRIES = 2;

    // Log persistent errors to system_error_log for Jarvis self-debugging
    logSystemError({
      source: `jobQueue/${job.agentType}`,
      message: msg,
      error: err,
      level: "error",
      context: { jobId: job.id, agentType: job.agentType, retryCount },
      userId: job.userId,
    }).catch(() => {});

    if (retryCount < MAX_RETRIES) {
      const nextRetry = retryCount + 1;
      console.log(`[JobQueue] re-queuing job ${job.id} (attempt ${nextRetry}/${MAX_RETRIES}) after error: ${msg}`);
      try {
        await db
          .update(schema.agentJobs)
          .set({
            status: "queued",
            startedAt: null,
            error: `Retry ${nextRetry}/${MAX_RETRIES}: ${msg}`.slice(0, 2000),
            input: { ...jobInput, retryCount: nextRetry },
          })
          .where(eq(schema.agentJobs.id, job.id));
      } catch (retryErr) {
        console.error(`[JobQueue] failed to re-queue job ${job.id}:`, retryErr);
        await failJob(job.id, msg, job.userId);
      }
    } else {
      console.log(`[JobQueue] permanently failing job ${job.id} after ${MAX_RETRIES + 1} total attempts`);
      await failJob(job.id, msg, job.userId);
      // Fail the workflow step if applicable.
      const wfId2   = jobInput.workflowId    as string | undefined;
      const wfStep2 = jobInput.workflowStepIndex as number | undefined;
      if (wfId2 && wfStep2 !== undefined) {
        await onWorkflowJobFail(wfId2, wfStep2, msg).catch((e) =>
          console.error("[JobQueue] workflow fail hook failed:", e),
        );
      }
    }
  } finally {
    clearTimeout(watchdog);
  }
}

async function tick(): Promise<void> {
  // Drain a few jobs per tick so multiple users don't starve each other.
  for (let i = 0; i < 5; i++) {
    const job = await claimNextJob();
    if (!job) return;
    // Run the job but don't block the tick — let it run in parallel for
    // different users (the SQL claim already enforces one-per-user).
    processJob(job).catch((err) => {
      console.error(`[JobQueue] processJob threw for ${job.id}:`, err);
    });
  }
}

/**
 * Recover any jobs that were running when the process died — return
 * them to the queue so the restarted worker picks them up.
 */
async function recoverStaleJobs(): Promise<void> {
  try {
    // Jobs stuck in 'running' when the process died — re-queue them.
    const requeued = await db
      .update(schema.agentJobs)
      .set({ status: "queued", startedAt: null })
      .where(eq(schema.agentJobs.status, "running"))
      .returning({ id: schema.agentJobs.id });
    if (requeued.length > 0) {
      console.log(`[JobQueue] recovered ${requeued.length} stale running job(s) from previous process`);
    }
    // Jobs in 'cancelling' when the process died — mark them cancelled since
    // the user already requested cancellation and the worker is gone.
    const cancelled = await db
      .update(schema.agentJobs)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(schema.agentJobs.status, "cancelling"))
      .returning({ id: schema.agentJobs.id });
    if (cancelled.length > 0) {
      console.log(`[JobQueue] cancelled ${cancelled.length} stale cancelling job(s) from previous process`);
    }
  } catch (err) {
    console.error("[JobQueue] recoverStaleJobs failed:", err);
  }
}

export function startJobQueueWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  stopRequested = false;

  recoverStaleJobs().catch((err) => console.error("[JobQueue] recover error:", err));

  const loop = async () => {
    if (stopRequested) return;
    if (workerRunning) {
      setTimeout(loop, TICK_MS);
      return;
    }
    workerRunning = true;
    try {
      await tick();
    } catch (err) {
      console.error("[JobQueue] tick error:", err);
    } finally {
      workerRunning = false;
      setTimeout(loop, TICK_MS);
    }
  };

  setTimeout(loop, 5000);
  console.log(`[JobQueue] worker started — polling every ${TICK_MS / 1000}s`);
}

export function stopJobQueueWorker(): void {
  stopRequested = true;
}
