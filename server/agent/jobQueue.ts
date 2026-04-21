/**
 * Background job queue — DB-backed, survives restarts.
 *
 * Inspired by OpenClaw's background-task pattern (MIT, © 2025 Peter
 * Steinberger). One Node process, single polling tick. Picks the
 * oldest queued job per user (one-at-a-time per user to keep tool-call
 * concurrency sane), runs the matching sub-agent, persists the
 * deliverable, and marks the job complete.
 */
import { db } from "../db";
import { eq, and, sql, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { SubAgentType } from "./subagents";
import { runSubAgent } from "./subagents";
import { runGoalDecomposition } from "./goalDecomposer";
import { getValidGoogleTokens } from "../userTokenStore";
import type { ToolContext } from "./types";
import { sendMessage, isTelegramConfigured } from "../integrations/telegram";

async function notifyJobComplete(
  userId: string,
  agentType: AgentJobType,
  title: string,
  body: string,
): Promise<void> {
  if (!isTelegramConfigured()) return;
  try {
    const [link] = await db
      .select({ chatId: schema.telegramLinks.chatId })
      .from(schema.telegramLinks)
      .where(eq(schema.telegramLinks.userId, userId))
      .limit(1);
    if (!link?.chatId) return;
    await sendMessage(link.chatId, `Jarvis (${agentType}): ${title}\n\n${body}`.slice(0, 3500));
  } catch (err) {
    console.error("[JobQueue] notify failed:", err);
  }
}

const TICK_MS = 15 * 1000;
const MAX_JOB_DURATION_MS = 5 * 60 * 1000;

let workerRunning = false;
let workerStarted = false;
let stopRequested = false;

export type AgentJobType = SubAgentType | "goal_decompose";

export interface SubmitJobInput {
  userId: string;
  agentType: AgentJobType;
  title: string;
  prompt: string;
  input?: Record<string, unknown>;
}

export async function submitAgentJob(input: SubmitJobInput): Promise<string> {
  const inserted = await db
    .insert(schema.agentJobs)
    .values({
      userId: input.userId,
      agentType: input.agentType,
      title: input.title.slice(0, 200),
      prompt: input.prompt,
      input: input.input || {},
      status: "queued",
    })
    .returning({ id: schema.agentJobs.id });
  const id = inserted[0]?.id || "";
  console.log(`[JobQueue] queued job ${id} type=${input.agentType} user=${input.userId} title="${input.title.slice(0, 60)}"`);
  return id;
}

async function claimNextJob(): Promise<typeof schema.agentJobs.$inferSelect | null> {
  // Pick the oldest queued job whose user has no currently-running job.
  // Use a single SQL CTE so the claim is atomic across worker restarts.
  const claimed = await db.execute<typeof schema.agentJobs.$inferSelect>(sql`
    WITH busy_users AS (
      SELECT DISTINCT user_id FROM agent_jobs WHERE status = 'running'
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
    RETURNING *
  `);
  const row = (claimed.rows && claimed.rows[0]) as typeof schema.agentJobs.$inferSelect | undefined;
  return row || null;
}

async function failJob(jobId: string, message: string): Promise<void> {
  try {
    await db
      .update(schema.agentJobs)
      .set({ status: "failed", error: message.slice(0, 2000), completedAt: new Date() })
      .where(eq(schema.agentJobs.id, jobId));
  } catch (err) {
    console.error(`[JobQueue] failJob ${jobId} write failed:`, err);
  }
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
    if (job.agentType === "goal_decompose") {
      const result = await runGoalDecomposition(job);
      await completeJob(job.id, {
        result: { goalTreeId: result.goalTreeId, phases: result.phaseCount },
        turns: result.turns,
        toolCallsCount: result.toolCallsCount,
      });
      console.log(`[JobQueue] complete goal_decompose job ${job.id} → tree ${result.goalTreeId}`);
      await notifyJobComplete(
        job.userId,
        "goal_decompose",
        job.title,
        `Goal broken into ${result.phaseCount} phase(s). Open the Goals tab to review.`,
      );
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

    const sub = await runSubAgent({
      agentType: job.agentType as SubAgentType,
      prompt: job.prompt,
      defaultTitle: job.title,
      context: ctx,
    });

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
    console.log(`[JobQueue] complete ${job.agentType} job ${job.id} → deliverable ${deliverableId}`);
    await notifyJobComplete(
      job.userId,
      job.agentType as AgentJobType,
      sub.title,
      `${sub.summary || "Ready for review"} — open Inbox to approve, edit, or discard.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JobQueue] job ${job.id} failed:`, err);
    await failJob(job.id, msg);
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
    const result = await db
      .update(schema.agentJobs)
      .set({ status: "queued", startedAt: null })
      .where(eq(schema.agentJobs.status, "running"))
      .returning({ id: schema.agentJobs.id });
    if (result.length > 0) {
      console.log(`[JobQueue] recovered ${result.length} stale running job(s) from previous process`);
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
