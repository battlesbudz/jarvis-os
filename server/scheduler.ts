import { db } from './db';
import { eq, and, lt, lte, or, sql, isNull } from 'drizzle-orm';
import * as schema from '@shared/schema';

import { notifyUser } from './channels/registry';
import { logInteraction } from './interactionLog';
import { isActionSuppressed } from './intelligence/actionLog';
import { buildPlanForUser } from './routes';
import { getInjectableGoalTasks, markTasksInjected, type InjectableGoalTask } from './goalScheduler';
import { enqueueWeeklyPatternJobs } from './memory/weeklyJob';
import { matchesCron, runSchedule } from './discord/schedules';
import { buildDailyDigest } from './discord/digest';
import { postToDiscordChannel } from './discord/manager';
import { DIGEST_CHANNEL_KEY } from './discord/workspace';
import { getUserDriveSettings } from './driveRoutes';
import { createDriveTextFile } from './integrations/googleDrive';
import { runBackfillEmbeddings } from './jobs/backfillEmbeddings';

// ---------------------------------------------------------------------------
// Retention windows — edit these constants to tune how long high-growth logs
// are kept. Both tables are only queried for recent windows (24 h–7 days) so
// rows older than the retention period have no operational value.
// ---------------------------------------------------------------------------
const INTERACTION_LOG_RETENTION_DAYS = 90;
const ACTION_LOG_RETENTION_DAYS = 90;

let schedulerRunning = false;
let lastWeeklyRunKey = '';
let lastSynthesisRunKey = '';

function sundayKey(d: Date): string {
  // Identify the Sunday-of-week so we only run weekly_pattern once per week
  // even if the process restarts inside the trigger minute.
  const start = new Date(d);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  return `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
}

/** Run any enabled Discord channel schedules whose cron expression matches right now. */
async function runDiscordSchedules(now: Date): Promise<void> {
  try {
    const schedules = await db
      .select()
      .from(schema.discordChannelSchedules)
      .where(eq(schema.discordChannelSchedules.enabled, true));

    for (const schedule of schedules) {
      if (matchesCron(schedule.cronExpression, now)) {
        console.log(`[Scheduler] Firing Discord schedule "${schedule.label}" (${schedule.id})`);
        runSchedule(schedule.id).catch((err) => {
          console.error(`[Scheduler] Discord schedule ${schedule.id} failed:`, err);
        });
      }
    }
  } catch (err) {
    console.error('[Scheduler] runDiscordSchedules failed:', err);
  }
}

/** Run autonomous agent loops for named agents that are due. */
async function runAgentLoops(now: Date): Promise<void> {
  try {
    const agents = await db
      .select()
      .from(schema.discordAgents)
      .where(and(
        eq(schema.discordAgents.isActive, 1),
        eq(schema.discordAgents.loopEnabled, 1),
      ));

    for (const agent of agents) {
      const intervalMs = (agent.loopIntervalMinutes ?? 60) * 60 * 1000;
      const lastRun = agent.lastLoopRun?.getTime() ?? 0;
      if (now.getTime() - lastRun >= intervalMs) {
        console.log(`[Scheduler] Firing agent loop for ${agent.name} (${agent.id})`);
        runAgentLoop(agent).catch((err) => {
          console.error(`[Scheduler] Agent loop ${agent.id} failed:`, err);
        });
      }
    }
  } catch (err) {
    console.error('[Scheduler] runAgentLoops failed:', err);
  }
}

async function runAgentLoop(agent: typeof schema.discordAgents.$inferSelect): Promise<void> {
  const { runCoachAgent } = await import('./channels/coachAgent');
  const { postToDiscordChannel } = await import('./discord/manager');

  const prompt = agent.loopPrompt ||
    `You are ${agent.name}, an autonomous ${agent.role} agent. Check the user's current goals and tasks. ` +
    `Pick the next highest-priority task aligned with your ${agent.role} role. Do meaningful work on it. ` +
    `Post a progress update to your channel: "🔨 Working on: [task]. Here's what I did: [summary]. Blockers: [any or none]."`;

  let result = '';
  try {
    const agentResult = await runCoachAgent({
      userId: agent.userId,
      userText: `[You are ${agent.name}. ${agent.persona || ''}]\n\n${prompt}`,
      channelName: `Discord #${(agent.channelName || agent.name).toLowerCase()}`,
    });
    result = agentResult.reply || '';
  } catch (err) {
    result = `⚠️ Agent loop error: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (result && agent.channelName) {
    await postToDiscordChannel(agent.userId, agent.channelName, agent.channelId, result);
  }

  await db.update(schema.discordAgents)
    .set({ lastLoopRun: new Date() })
    .where(eq(schema.discordAgents.id, agent.id));
}

/** Post daily digest to each active Discord-linked user's #daily-digest channel. */
async function runDailyDigests(): Promise<void> {
  try {
    // Find all users with an active Discord channel link
    const links = await db
      .select()
      .from(schema.channelLinks)
      .where(eq(schema.channelLinks.channel, 'discord'));

    for (const link of links) {
      try {
        const meta = link.metadata as { workspace?: { channels?: Record<string, string> } } | null;
        const channelId = meta?.workspace?.channels?.[DIGEST_CHANNEL_KEY];
        if (!channelId) continue;

        const digest = await buildDailyDigest(link.userId);
        await postToDiscordChannel(link.userId, 'daily-digest', channelId, digest);
        console.log(`[Scheduler] Daily digest posted for user ${link.userId}`);
      } catch (err) {
        console.error(`[Scheduler] Daily digest failed for user ${link.userId}:`, err);
      }
    }
  } catch (err) {
    console.error('[Scheduler] runDailyDigests failed:', err);
  }
}

/** Hard-delete user_memories rows whose expires_at has passed (working/short_term TTL). */
async function cleanUpExpiredMemories(): Promise<void> {
  try {
    const result = await db.execute(sql`
      DELETE FROM user_memories
      WHERE expires_at IS NOT NULL AND expires_at < NOW()
      RETURNING id
    `);
    const count = (result.rows ?? []).length;
    console.log(`[Scheduler] Expired memory cleanup: ${count} row(s) deleted`);
  } catch (err) {
    console.error('[Scheduler] cleanUpExpiredMemories failed:', err);
  }
}

/** Delete agent_chat_sessions rows that have passed their expires_at timestamp. */
async function cleanUpExpiredAgentChatSessions(): Promise<void> {
  const startedAt = new Date();
  try {
    const deleted = await db
      .delete(schema.agentChatSessions)
      .where(lt(schema.agentChatSessions.expiresAt, startedAt))
      .returning({ id: schema.agentChatSessions.sdkSessionId });
    console.log(`[Scheduler] Expired agent chat session cleanup complete at ${startedAt.toISOString()}: ${deleted.length} row(s) deleted`);
  } catch (err) {
    console.error('[Scheduler] cleanUpExpiredAgentChatSessions failed:', err);
  }
}

/** Hard-delete interaction_log rows older than INTERACTION_LOG_RETENTION_DAYS. */
async function cleanUpOldInteractionLogs(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - INTERACTION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await db.execute(sql`
      DELETE FROM interaction_log WHERE created_at < ${cutoff}
    `);
    const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    console.log(`[Scheduler] Interaction log cleanup: ${count} row(s) older than ${INTERACTION_LOG_RETENTION_DAYS} days deleted`);
  } catch (err) {
    console.error('[Scheduler] cleanUpOldInteractionLogs failed:', err);
  }
}

/** Hard-delete jarvis_action_log rows older than ACTION_LOG_RETENTION_DAYS. */
async function cleanUpOldActionLogs(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - ACTION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await db.execute(sql`
      DELETE FROM jarvis_action_log WHERE created_at < ${cutoff}
    `);
    const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    console.log(`[Scheduler] Action log cleanup: ${count} row(s) older than ${ACTION_LOG_RETENTION_DAYS} days deleted`);
  } catch (err) {
    console.error('[Scheduler] cleanUpOldActionLogs failed:', err);
  }
}

// ─── Cron + daemon_shell integration ─────────────────────────────────────────
// Computes the next scheduled time for a recurring job based on the recurrence
// string stored in jarvis_scheduled_tasks.recurrence. Handles all recurrence
// formats produced by parseRecurringExpr in cronTools.ts.

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function extractTimeFromRecurrence(s: string): { hours: number; minutes: number } | null {
  const m = s.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = (m[3] || '').toLowerCase();
  if (mer === 'pm' && h !== 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return { hours: h, minutes: min };
}

function applyTime(d: Date, t: { hours: number; minutes: number } | null, defaultHour = 9): Date {
  if (t) d.setHours(t.hours, t.minutes, 0, 0);
  else d.setHours(defaultHour, 0, 0, 0);
  return d;
}

function computeNextRun(recurrence: string, from: Date): Date | null {
  const lower = recurrence.trim().toLowerCase();

  // "every N minutes/hours/days"
  const intervalM = lower.match(/^every\s+(\d+)\s+(minute|hour|day)s?$/);
  if (intervalM) {
    const n = parseInt(intervalM[1], 10);
    const unit = intervalM[2];
    const d = new Date(from);
    if (unit === 'minute') d.setMinutes(d.getMinutes() + n);
    else if (unit === 'hour') d.setTime(d.getTime() + n * 3_600_000);
    else d.setDate(d.getDate() + n);
    return d;
  }

  // "daily" or "daily at X"
  if (lower === 'daily' || lower.startsWith('daily at ')) {
    const t = extractTimeFromRecurrence(lower);
    const d = new Date(from);
    d.setDate(d.getDate() + 1);
    return applyTime(d, t);
  }

  // "weekly" or "weekly at X"
  if (lower === 'weekly' || lower.startsWith('weekly at ')) {
    const t = extractTimeFromRecurrence(lower);
    const d = new Date(from);
    d.setDate(d.getDate() + 7);
    return applyTime(d, t);
  }

  // "monthly" or "monthly at X"
  if (lower === 'monthly' || lower.startsWith('monthly at ')) {
    const t = extractTimeFromRecurrence(lower);
    const d = new Date(from);
    d.setMonth(d.getMonth() + 1);
    return applyTime(d, t);
  }

  // "weekdays" or "weekdays at X"
  if (lower === 'weekdays' || lower.startsWith('weekdays at ')) {
    const t = extractTimeFromRecurrence(lower);
    const d = new Date(from);
    do { d.setDate(d.getDate() + 1); } while ([0, 6].includes(d.getDay()));
    return applyTime(d, t);
  }

  // "weekends" or "weekends at X"
  if (lower === 'weekends' || lower.startsWith('weekends at ')) {
    const t = extractTimeFromRecurrence(lower);
    const d = new Date(from);
    do { d.setDate(d.getDate() + 1); } while (![0, 6].includes(d.getDay()));
    return applyTime(d, t, 10);
  }

  // "every Monday [at X]"
  const namedM = lower.match(/^every\s+(\w+)(?:\s+at\s+(.+))?$/);
  if (namedM) {
    const dayIndex = WEEKDAY_MAP[namedM[1]];
    if (dayIndex !== undefined) {
      const d = new Date(from);
      const currentDay = d.getDay();
      let daysUntil = (dayIndex - currentDay + 7) % 7;
      if (daysUntil === 0) daysUntil = 7;
      d.setDate(d.getDate() + daysUntil);
      const t = namedM[2] ? extractTimeFromRecurrence(`at ${namedM[2]}`) : null;
      return applyTime(d, t);
    }
  }

  return null;
}

/** Execute a shell command via the desktop daemon for a scheduled task. */
async function executeScheduledShellCommand(
  userId: string,
  command: string,
): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number; error?: string }> {
  const { sendDaemonOp, isDesktopDaemonActive, isDaemonActionAllowed } = await import('./daemon/bridge');

  if (!isDesktopDaemonActive(userId)) {
    return { ok: false, exitCode: -1, stdout: '', stderr: '', durationMs: 0, error: 'Desktop daemon is not connected.' };
  }

  const shellAllowed = await isDaemonActionAllowed(userId, 'shell');
  if (!shellAllowed) {
    return { ok: false, exitCode: -1, stdout: '', stderr: '', durationMs: 0, error: 'Shell execution is not permitted on this daemon.' };
  }

  const allowOutsideRoot = await isDaemonActionAllowed(userId, 'allow_outside_root');
  const timeoutMs = 120_000;
  const startedAt = Date.now();

  try {
    const result = await sendDaemonOp(
      userId,
      { type: 'shell', cmd: command, timeoutMs, allowOutsideRoot },
      timeoutMs + 5_000,
    );

    const durationMs = Date.now() - startedAt;
    const data = (result.data || {}) as Record<string, unknown>;
    const stdout = typeof data.stdout === 'string' ? data.stdout : '';
    const stderr = typeof data.stderr === 'string' ? data.stderr : '';
    const exitCode = typeof data.code === 'number' ? data.code : (result.ok ? 0 : 1);

    return { ok: result.ok, exitCode, stdout, stderr, durationMs };
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Tasks stuck for >5 minutes (server crash mid-execution) are eligible for re-claim.
const TASK_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** Check and fire any jarvis_scheduled_tasks that are due right now.
 *
 * Uses an atomic UPDATE ... RETURNING to claim tasks before executing them,
 * so concurrent scheduler ticks (or long-running commands that span multiple
 * ticks) cannot double-execute the same job.
 */
async function runDueScheduledTasks(now: Date): Promise<void> {
  const staleThreshold = new Date(now.getTime() - TASK_STALE_THRESHOLD_MS);
  let claimed: (typeof schema.jarvisScheduledTasks.$inferSelect)[] = [];
  try {
    // Atomically mark matching tasks as in-progress.
    // Eligible tasks: due now, not yet completed, and either not claimed yet OR
    // claimed so long ago that the server must have crashed (stale claim).
    claimed = await db
      .update(schema.jarvisScheduledTasks)
      .set({ inProgressAt: now })
      .where(
        and(
          lte(schema.jarvisScheduledTasks.scheduledAt, now),
          isNull(schema.jarvisScheduledTasks.completedAt),
          eq(schema.jarvisScheduledTasks.active, true),
          or(
            isNull(schema.jarvisScheduledTasks.inProgressAt),
            lt(schema.jarvisScheduledTasks.inProgressAt, staleThreshold),
          ),
        ),
      )
      .returning();
  } catch (err) {
    console.error('[Scheduler] runDueScheduledTasks claim failed:', err);
    return;
  }

  for (const task of claimed) {
    handleDueTask(task, now).catch((err) => {
      console.error(`[Scheduler] handleDueTask id=${task.id} failed:`, err);
      // Release the claim so the task can be retried on the next tick.
      db.update(schema.jarvisScheduledTasks)
        .set({ inProgressAt: null })
        .where(eq(schema.jarvisScheduledTasks.id, task.id))
        .catch(() => {});
    });
  }
}

async function handleDueTask(
  task: typeof schema.jarvisScheduledTasks.$inferSelect,
  firedAt: Date,
): Promise<void> {
  console.log(`[Scheduler] Firing scheduled task id=${task.id} title="${task.title}" shell=${!!task.shellCommand}`);

  const isRecurring = !!task.recurrence;

  if (task.shellCommand) {
    // ── Shell-command path ────────────────────────────────────────────────────
    const result = await executeScheduledShellCommand(task.userId, task.shellCommand);
    const ranAt = new Date().toISOString();

    const shellResult = {
      exitCode: result.exitCode,
      stdout: result.stdout.slice(0, 8000),
      stderr: result.stderr.slice(0, 2000),
      durationMs: result.durationMs,
      ranAt,
    };

    // Advance or complete the task — always clear inProgressAt so the task
    // is no longer held and the stale-claim check stays accurate.
    if (isRecurring) {
      const nextRun = computeNextRun(task.recurrence!, firedAt);
      if (nextRun) {
        await db.update(schema.jarvisScheduledTasks)
          .set({ scheduledAt: nextRun, lastShellResult: shellResult, inProgressAt: null })
          .where(eq(schema.jarvisScheduledTasks.id, task.id));
      } else {
        await db.update(schema.jarvisScheduledTasks)
          .set({ completedAt: firedAt, lastShellResult: shellResult, inProgressAt: null })
          .where(eq(schema.jarvisScheduledTasks.id, task.id));
      }
    } else {
      await db.update(schema.jarvisScheduledTasks)
        .set({ completedAt: firedAt, lastShellResult: shellResult, inProgressAt: null })
        .where(eq(schema.jarvisScheduledTasks.id, task.id));
    }

    // Deliver result to user's preferred channel
    let notifText: string;
    if (!result.ok && result.error) {
      notifText = `⚠️ Scheduled task **${task.title}** could not run.\nReason: ${result.error}`;
    } else {
      const status = result.exitCode === 0 ? '✅' : '❌';
      const parts: string[] = [`${status} **${task.title}** — exit code ${result.exitCode} (${result.durationMs}ms)`];
      if (result.stdout.trim()) parts.push(`\`\`\`\n${result.stdout.trim().slice(0, 1500)}\n\`\`\``);
      if (result.stderr.trim()) parts.push(`stderr:\n\`\`\`\n${result.stderr.trim().slice(0, 500)}\n\`\`\``);
      if (isRecurring && task.recurrence) {
        const next = computeNextRun(task.recurrence, firedAt);
        if (next) parts.push(`Next run: ${next.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
      }
      notifText = parts.join('\n');
    }

    try {
      await notifyUser(task.userId, 'scheduled_task_result', notifText);
    } catch (err) {
      console.error(`[Scheduler] notifyUser failed for task ${task.id}:`, err);
    }

    console.log(`[Scheduler] Shell task id=${task.id} exit=${result.exitCode} dur=${result.durationMs}ms`);
  } else {
    // ── Agent-prompt path ─────────────────────────────────────────────────────
    // Re-run the agent with the task's description as a prompt
    const { runCoachAgent } = await import('./channels/coachAgent');

    const prompt = task.description || `You have a scheduled task: "${task.title}". Please complete this action now and summarise what you did.`;
    let agentReply = '';
    try {
      const agentResult = await runCoachAgent({
        userId: task.userId,
        userText: `[Scheduled task: ${task.title}]\n\n${prompt}`,
        channelName: 'Scheduled Task',
      });
      agentReply = agentResult.reply || '';
    } catch (err) {
      agentReply = `⚠️ Scheduled task "${task.title}" encountered an error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Advance or complete the task — always clear inProgressAt.
    if (isRecurring) {
      const nextRun = computeNextRun(task.recurrence!, firedAt);
      if (nextRun) {
        await db.update(schema.jarvisScheduledTasks)
          .set({ scheduledAt: nextRun, inProgressAt: null })
          .where(eq(schema.jarvisScheduledTasks.id, task.id));
      } else {
        await db.update(schema.jarvisScheduledTasks)
          .set({ completedAt: firedAt, inProgressAt: null })
          .where(eq(schema.jarvisScheduledTasks.id, task.id));
      }
    } else {
      await db.update(schema.jarvisScheduledTasks)
        .set({ completedAt: firedAt, inProgressAt: null })
        .where(eq(schema.jarvisScheduledTasks.id, task.id));
    }

    if (agentReply) {
      try {
        await notifyUser(task.userId, 'scheduled_task_result', agentReply);
      } catch (err) {
        console.error(`[Scheduler] notifyUser (agent) failed for task ${task.id}:`, err);
      }
    }

    console.log(`[Scheduler] Agent task id=${task.id} replied=${agentReply.length} chars`);
  }
}

export function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  setInterval(async () => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const dow = now.getDay();

    if (h === 7 && m === 0) {
      console.log('[Scheduler] Running morning plan build...');
      await runMorningPlanBuild();
    }

    // Nightly 03:00 local per user — run Dream Cycle synthesis.
    // Per-user timezone gating inside each function; fires every tick so it
    // catches every user at their local 3am (synthesis) and 7-10am (delivery).
    runDreamCycleForAllUsers(now).catch((err) =>
      console.error('[Scheduler] Dream cycle failed:', err),
    );
    runDreamDeliveryForAllUsers(now).catch((err) =>
      console.error('[Scheduler] Dream delivery failed:', err),
    );

    // Nightly 02:00 (server local time) — recalibrate the gut anomaly detector
    // for all users. Reads all gutSignals feedback rows, computes per-user
    // per-signal-type confirmation rates, and persists the derived gate
    // adjustments to the gutCalibration table so detectors stay smart across
    // process restarts. Note: h/m are in server-local time, not UTC.
    if (h === 2 && m === 0) {
      import('./intelligence/gut').then(({ calibrateGutForAllUsers }) => {
        console.log('[Scheduler] Running nightly gut calibration...');
        calibrateGutForAllUsers().catch((err) =>
          console.error('[Scheduler] Gut calibration failed:', err),
        );
      }).catch((err) => console.error('[Scheduler] Gut calibration import failed:', err));
    }

    // Sunday 03:00 local — enqueue weekly pattern recognition jobs for
    // every active user. Workers (jobQueue) pick them up over the next
    // few minutes, regenerate each user's SOUL, and deliver a Telegram
    // summary. Idempotent across restarts via lastWeeklyRunKey.
    if (dow === 0 && h === 3 && m === 0) {
      const key = sundayKey(now);
      if (key !== lastWeeklyRunKey) {
        lastWeeklyRunKey = key;
        try {
          const count = await enqueueWeeklyPatternJobs();
          console.log(`[Scheduler] Sunday weekly pattern jobs enqueued: ${count}`);
        } catch (err) {
          console.error('[Scheduler] enqueueWeeklyPatternJobs failed:', err);
        }
      }
    }

    // Sunday 04:30 — synthesise learnings from CORRECTIONS.md & ERRORS.md.
    // Operates on the owner's global workspace files (a single shared file set,
    // not per-user). Runs after the weekly pattern job pass (03:00). Deduped
    // per week via lastSynthesisRunKey so restarts within the same minute are safe.
    if (dow === 0 && h === 4 && m === 30) {
      const key = sundayKey(now);
      if (key !== lastSynthesisRunKey) {
        lastSynthesisRunKey = key;
        import('./intelligence/learningSynthesiser').then(({ synthesiseLearnings }) => {
          console.log('[Scheduler] Running weekly learning synthesis...');
          synthesiseLearnings(true, 'scheduler').then((result) => {
            if (result.skipped) {
              console.log(`[Scheduler] Weekly synthesis skipped: ${result.skipReason}`);
              console.log(`[Audit] workspace_synthesise triggered=weekly skipped=true reason="${result.skipReason}"`);
            } else {
              console.log(`[Scheduler] Weekly synthesis complete — ${result.bullets.length} bullet(s) appended to MEMORY.md`);
              console.log(
                `[Audit] workspace_synthesise triggered=weekly bullets=${result.bullets.length} ` +
                `applied=${result.appendedToMemory} correctionLines=${result.correctionLines} errorLines=${result.errorLines}`,
              );
            }
          }).catch((err) => {
            console.error('[Scheduler] Weekly learning synthesis failed:', err);
          });
        }).catch((err) => console.error('[Scheduler] learningSynthesiser import failed:', err));
      }
    }

    // Sunday 18:00 UTC — run Ego weekly self-report for all users.
    if (dow === 0 && h === 18 && m === 0) {
      // weekOf is anchored to Monday-start so longitudinal history is consistent.
      import('./intelligence/ego').then(({ runEgoForAllUsers, getISOWeekMonday }) => {
        const weekOf = getISOWeekMonday(now);
        console.log(`[Scheduler] Running Ego weekly reports (${weekOf})...`);
        runEgoForAllUsers(now, weekOf).catch((err) =>
          console.error('[Scheduler] Ego reports failed:', err),
        );
      }).catch((err) => console.error('[Scheduler] Ego import failed:', err));
    }

    // Daily digest — 9pm every day
    if (h === 21 && m === 0) {
      console.log('[Scheduler] Running daily digests...');
      runDailyDigests().catch((err) => console.error('[Scheduler] runDailyDigests error:', err));
    }

    // Daily 04:00 — delete expired agent chat sessions to keep the table tidy
    if (h === 4 && m === 0) {
      cleanUpExpiredAgentChatSessions();
    }

    // Daily 04:05 — prune expired Discord confirmation tokens
    if (h === 4 && m === 5) {
      import('./agent/discordConfirmStore').then(({ cleanUpExpiredDiscordConfirmTokens }) => {
        cleanUpExpiredDiscordConfirmTokens().catch((err) =>
          console.error('[Scheduler] Discord confirm token cleanup failed:', err),
        );
      }).catch((err) => console.error('[Scheduler] Discord confirm store import failed:', err));
    }

    // Daily 04:30 — hard-delete memories whose expires_at has passed (working/short_term TTL).
    if (h === 4 && m === 30) {
      cleanUpExpiredMemories();
    }

    // Daily 05:00 — purge interaction_log rows older than INTERACTION_LOG_RETENTION_DAYS.
    if (h === 5 && m === 0) {
      cleanUpOldInteractionLogs();
    }

    // Daily 05:15 — purge jarvis_action_log rows older than ACTION_LOG_RETENTION_DAYS.
    if (h === 5 && m === 15) {
      cleanUpOldActionLogs();
    }

    // Daily 06:00 — backfill embedding vectors for any user_memories rows that
    // still have embedding IS NULL.  The job is incremental (batched) and
    // aborts early if the embeddings endpoint is unavailable, so it is safe to
    // run every day without risk of overwhelming the API.
    if (h === 6 && m === 0) {
      console.log('[Scheduler] Running nightly embedding backfill...');
      runBackfillEmbeddings().catch((err) =>
        console.error('[Scheduler] Embedding backfill failed:', err),
      );
    }

    // Discord channel schedules — check every minute
    await runDiscordSchedules(now);

    // Named agent autonomous loops — check every minute
    await runAgentLoops(now);

    // Autonomous project sessions — kick off due sessions every minute
    runDueAutonomousProjectSessions().catch((err) =>
      console.error('[Scheduler] runDueAutonomousProjectSessions failed:', err),
    );

    // User-scheduled tasks (cron_create) — check every minute; shell-command
    // tasks run via the desktop daemon; prompt-based tasks re-invoke the agent
    runDueScheduledTasks(now).catch((err) =>
      console.error('[Scheduler] runDueScheduledTasks failed:', err),
    );

  }, 60 * 1000);

  console.log('[Scheduler] Started — morning plan 7:00 AM daily, weekly patterns Sunday 3:00 AM, learning synthesis Sunday 4:30 AM, session cleanup 4:00 AM daily, Discord confirm token cleanup 4:05 AM daily, memory TTL cleanup 4:30 AM daily, interaction log cleanup 5:00 AM daily, action log cleanup 5:15 AM daily, embedding backfill 6:00 AM daily, Discord schedules every minute, autonomous project sessions every minute');
}

/**
 * Poll for autonomous projects whose next_run_at has passed and submit job sessions.
 * Runs every 60s from the scheduler loop. Uses a DB-level claim (clearing next_run_at)
 * to avoid double-queuing under concurrent ticks.
 */
async function runDueAutonomousProjectSessions(): Promise<void> {
  const now = new Date();

  // Claim projects atomically: clear next_run_at so concurrent ticks skip them.
  const due = await db
    .update(schema.jarvisProjects)
    .set({ nextRunAt: null })
    .where(
      and(
        eq(schema.jarvisProjects.autonomousMode, true),
        or(
          eq(schema.jarvisProjects.status, "building"),
          eq(schema.jarvisProjects.status, "waiting_for_input"),
        ),
        lte(schema.jarvisProjects.nextRunAt, now),
      ),
    )
    .returning({
      id: schema.jarvisProjects.id,
      userId: schema.jarvisProjects.userId,
      title: schema.jarvisProjects.title,
    });

  if (due.length === 0) return;

  const { submitAgentJob } = await import('./agent/jobClient');

  for (const project of due) {
    console.log(`[Scheduler] Autonomous project session due: ${project.id} (${project.title ?? "untitled"})`);
    await submitAgentJob({
      userId: project.userId,
      agentType: "project_session",
      title: `Build: ${project.title ?? "Project"} (autonomous session)`,
      prompt: `Continue building project ${project.id}`,
      input: { projectId: project.id },
    }).catch((err) => {
      console.error(`[Scheduler] Failed to enqueue project_session for ${project.id}:`, err);
    });
  }
}

/**
 * Run the Prediction Engine for every active user.
 * Called at 7am as part of the morning plan build — before plans are generated
 * so predictions can influence task ordering and are ready for delivery.
 */
export async function runPredictionEngineForAllUsers(startDate: string): Promise<void> {
  const allUsers = await db.select({ id: schema.users.id }).from(schema.users).catch(() => []);
  console.log(`[Predictor] Running for ${allUsers.length} user(s), 7-day horizon from ${startDate}`);

  // Build a 7-day date list starting from startDate.
  const datesToRun: string[] = [];
  const base = new Date(startDate + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    datesToRun.push(d.toISOString().slice(0, 10));
  }

  for (const user of allUsers) {
    try {
      const { analysePatterns } = await import("./intelligence/pattern-analyser");
      const { generateAndStorePredictions } = await import("./intelligence/predictor");

      // Single pattern analysis per user — reused across all 7 dates.
      const analysis = await analysePatterns(user.id, 60);
      let totalInserted = 0;
      for (const targetDate of datesToRun) {
        totalInserted += await generateAndStorePredictions(user.id, targetDate, analysis);
      }
      if (totalInserted > 0) {
        console.log(`[Predictor] ${totalInserted} new prediction(s) for user ${user.id}`);
      }
    } catch (err) {
      console.error(`[Predictor] failed for user ${user.id}:`, err);
    }
  }
}

export async function runMorningPlanBuild() {
  const today = new Date().toISOString().slice(0, 10);
  await runPredictionEngineForAllUsers(today);

  const allUsers = await db.select({ id: schema.users.id }).from(schema.users);
  console.log(`[Scheduler] Processing ${allUsers.length} user(s) for auto-plan build`);

  for (const user of allUsers) {
    try {
      const existingPlan = await db
        .select({ data: schema.plans.data })
        .from(schema.plans)
        .where(and(eq(schema.plans.userId, user.id), eq(schema.plans.date, today)));

      const existingTasks = (existingPlan[0]?.data as any)?.tasks || [];
      if (existingTasks.length > 0) {
        console.log(`[Scheduler] User ${user.id} already has ${existingTasks.length} tasks, skipping`);
        continue;
      }

      // Self-correction suppression: if plan_built or task_suggested is suppressed,
      // skip buildPlanForUser (AI suggestions) but still run goal-tree injection
      // so the user always gets their goal tasks for the day.
      const [planSuppressedNow, taskSuppressedNow] = await Promise.all([
        isActionSuppressed(user.id, "plan_built"),
        isActionSuppressed(user.id, "task_suggested"),
      ]);
      const aiSuggestionsSuppressed = planSuppressedNow || taskSuppressedNow;
      if (aiSuggestionsSuppressed) {
        console.log(`[Scheduler] AI plan/task suggestions suppressed for user ${user.id} (self-correction) — using goal-tree injection only`);
      }

      const newTasks: Array<{
        id: string; title: string; category: string; priority: string;
        duration: number; time: string | undefined; description: string | undefined;
        completed: boolean; createdAt: number; fromJarvis: boolean;
      }> = [];

      let planReasoning = "";
      // aiGeneratedTaskIds tracks only tasks from buildPlanForUser for Ego logging,
      // so goal-injected tasks are not misattributed as AI suggestions.
      const aiGeneratedTaskIds: string[] = [];
      if (!aiSuggestionsSuppressed) {
        const result = await buildPlanForUser(user.id);
        if (result && result.tasks.length > 0) {
          planReasoning = result.reasoning ?? "";
          for (const t of result.tasks) {
            const taskId = `jarvis_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            aiGeneratedTaskIds.push(taskId);
            newTasks.push({
              id: taskId,
              title: t.title,
              category: t.category,
              priority: t.priority,
              duration: t.duration,
              time: t.time,
              description: t.description,
              completed: false,
              createdAt: Date.now(),
              fromJarvis: true,
            });
          }
        } else {
          console.log(`[Scheduler] No AI tasks generated for user ${user.id}`);
        }
      }

      // Always inject next-ready tasks from active goal trees regardless of suppression.
      // Pacing is enforced inside getInjectableGoalTasks.
      let injected: InjectableGoalTask[] = [];
      try {
        injected = await getInjectableGoalTasks(user.id, today);
      } catch (e) {
        console.error(`[Scheduler] goal injection lookup failed for ${user.id}:`, e);
      }
      for (const pick of injected) {
        const minutes = Math.max(15, Math.round((pick.estimateHours || 1) * 60));
        (newTasks as Array<typeof newTasks[number] & { goalTreeId?: string; goalTaskId?: string }>).push({
          id: `goal_${pick.taskId}_${today}`,
          title: pick.title,
          category: 'goal',
          priority: 'high',
          duration: minutes,
          time: undefined,
          description: pick.description
            ? `${pick.description} (from goal: ${pick.goalTitle})`
            : `From goal: ${pick.goalTitle}`,
          completed: false,
          createdAt: Date.now(),
          fromJarvis: true,
          goalTreeId: pick.goalTreeId,
          goalTaskId: pick.taskId,
        });
      }
      if (injected.length > 0) {
        try {
          await markTasksInjected(user.id, injected, today);
          console.log(`[Scheduler] injected ${injected.length} goal task(s) for user ${user.id}`);
        } catch (e) {
          console.error(`[Scheduler] markTasksInjected failed for ${user.id}:`, e);
        }
      }

      if (newTasks.length === 0) {
        console.log(`[Scheduler] No tasks at all for user ${user.id}, skipping plan write`);
        continue;
      }

      await db.insert(schema.plans).values({
        userId: user.id,
        date: today,
        data: { date: today, tasks: newTasks },
      }).onConflictDoUpdate({
        target: [schema.plans.userId, schema.plans.date],
        set: { data: { date: today, tasks: newTasks }, updatedAt: new Date() },
      });

      // Log Ego actions only when AI suggestions were generated (not suppressed).
      // Uses aiGeneratedTaskIds so goal-injected tasks are not counted as AI suggestions.
      if (!aiSuggestionsSuppressed && aiGeneratedTaskIds.length > 0) {
        const aiTasks = newTasks.filter((t) => aiGeneratedTaskIds.includes(t.id));
        import('./intelligence/actionLog').then(({ logAction }) => {
          logAction(user.id, "plan_built", { date: today, aiTaskCount: aiTasks.length, totalTaskCount: newTasks.length }).catch(() => {});
          if (aiTasks[0]) {
            logAction(user.id, "prediction_made", {
              prediction: `User will work on: "${aiTasks[0].title}"`,
              taskId: aiTasks[0].id,
              date: today,
            }).catch(() => {});
          }
          for (const t of aiTasks) {
            logAction(user.id, "task_suggested", { taskId: t.id, title: t.title, date: today, source: "ai" }).catch(() => {});
          }
        }).catch(() => {});
      }

      // Fetch today's predictions to inform the morning briefing
      let predictionText = "";
      try {
        const { getTodayPredictions, formatPredictionsForBriefing } = await import("./intelligence/predictor");
        const preds = await getTodayPredictions(user.id, today);
        predictionText = formatPredictionsForBriefing(preds);
      } catch (predErr) {
        console.error(`[Scheduler] prediction fetch failed for ${user.id}:`, predErr);
      }

      const topTask = newTasks[0];
      const existingPrefs = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, user.id));

      const currentPrefs = (existingPrefs[0]?.data as any) || {};
      const lastDreamCycle = currentPrefs.lastDreamCycle || null;
      const updatedPrefs = {
        ...currentPrefs,
        autoBuiltPlan: {
          date: today,
          topTask: topTask?.title,
          reasoning: planReasoning || undefined,
          taskCount: newTasks.length,
          predictionText: predictionText || null,
          dreamCycleMeta: lastDreamCycle && lastDreamCycle.date === today
            ? {
                insightsStored: lastDreamCycle.insightsStored,
                consolidation: lastDreamCycle.consolidation,
                semanticExtraction: lastDreamCycle.semanticExtraction,
                decay: lastDreamCycle.decay,
                reinforcement: lastDreamCycle.reinforcement,
              }
            : null,
        }
      };

      await db.insert(schema.userPreferences).values({
        userId: user.id,
        data: updatedPrefs,
      }).onConflictDoUpdate({
        target: [schema.userPreferences.userId],
        set: {
          data: updatedPrefs,
          updatedAt: new Date()
        }
      });

      console.log(`[Scheduler] Auto-built ${newTasks.length} tasks for user ${user.id}${topTask ? ` (top: "${topTask.title}")` : ""}`);

      // Gut signals — include high-confidence flags from the last 24 h as a
      // "Jarvis noticed" section appended to the morning brief.
      // Flags are embedded into the stored plan prefs so the app can render
      // them inside the morning brief card, and also sent as a channel
      // notification for users with Telegram/Discord configured.
      try {
        const { getAndMarkMorningBriefSignals } = await import('./intelligence/gut');
        const gutFlags = await getAndMarkMorningBriefSignals(user.id);
        if (gutFlags.length > 0) {
          const flagLines = gutFlags.map((g) => `• ${g.explanation}`).join('\n');
          // Embed into the stored brief prefs so the inbox card can render them
          const prefsWithGut = {
            ...updatedPrefs,
            autoBuiltPlan: {
              ...updatedPrefs.autoBuiltPlan,
              gutFlags: gutFlags.map((g) => ({
                id: g.id,
                signalType: g.signalType,
                confidenceScore: g.confidenceScore,
                explanation: g.explanation,
              })),
            },
          };
          await db.insert(schema.userPreferences).values({
            userId: user.id,
            data: prefsWithGut,
          }).onConflictDoUpdate({
            target: [schema.userPreferences.userId],
            set: { data: prefsWithGut, updatedAt: new Date() },
          });
          // Also send as a channel notification for Telegram/Discord users.
          // Insert the log row first (atomic claim); only send if newly inserted.
          const gutMsg = `👁 Jarvis noticed:\n${flagLines}`;
          const { notifyUser: notifyGut } = await import('./channels/registry');
          const gutLogInserted = await db
            .insert(schema.proactiveScheduleLog)
            .values({ userId: user.id, messageType: 'morning_gut_flags', sentDate: today })
            .onConflictDoNothing()
            .returning({ id: schema.proactiveScheduleLog.id })
            .then(rows => rows.length > 0)
            .catch(() => false);
          if (gutLogInserted) {
            await notifyGut(user.id, 'morning_briefing', gutMsg);
          }
          console.log(`[Scheduler] ${gutFlags.length} gut flag(s) embedded in morning brief for ${user.id}`);
        }
      } catch (gutErr) {
        console.error(`[Scheduler] gut morning brief failed for ${user.id}:`, gutErr);
      }

      // Send the morning briefing notification via the user's preferred channel.
      // Insert the log row first (atomic claim); only send if newly inserted.
      try {
        const briefingLogInserted = await db
          .insert(schema.proactiveScheduleLog)
          .values({ userId: user.id, messageType: 'morning_briefing', sentDate: today })
          .onConflictDoNothing()
          .returning({ id: schema.proactiveScheduleLog.id })
          .then(rows => rows.length > 0)
          .catch(() => false);
        if (briefingLogInserted) {
          const taskListLines = newTasks.slice(0, 5).map((t, i) => `${i + 1}. ${t.title}`).join('\n');
          const morningMsg = `☀️ Good morning! Your plan for today:\n\n${taskListLines}${newTasks.length > 5 ? `\n…and ${newTasks.length - 5} more` : ''}\n\n📌 Focus first: ${topTask.title}${predictionText ? `\n${predictionText}` : ''}`;
          await notifyUser(user.id, 'morning_briefing', morningMsg);
        }
      } catch (notifyErr) {
        console.error(`[Scheduler] Morning notification failed for ${user.id}:`, notifyErr);
      }

      // Auto-save daily plan to Google Drive if the user has it enabled.
      try {
        const drive = await getUserDriveSettings(user.id);
        if (drive.enabled && drive.autoSavePlans && drive.accessToken) {
          const planText = buildPlanMarkdown(today, newTasks, planReasoning);
          const driveFile = await createDriveTextFile(
            drive.accessToken,
            `Daily Plan — ${today}`,
            planText,
            { convertToDoc: true, folderId: drive.folderId || undefined }
          );
          console.log(`[Scheduler] Drive auto-save for user ${user.id}: ${driveFile.webViewLink}`);

          // Post Drive link alongside the plan via Telegram (if connected).
          try {
            const { sendMessage, isTelegramConfigured } = await import('./integrations/telegram');
            const { db: tdb } = await import('./db');
            const { telegramLinks } = await import('@shared/schema');
            const { eq: teq } = await import('drizzle-orm');
            if (isTelegramConfigured()) {
              const links = await tdb.select().from(telegramLinks).where(teq(telegramLinks.userId, user.id)).limit(1);
              if (links[0]?.chatId) {
                await sendMessage(
                  links[0].chatId,
                  `📁 Your daily plan for ${today} has been saved to Google Drive:\n${driveFile.webViewLink}`
                );
              }
            }
          } catch (tgErr) {
            console.error(`[Scheduler] Drive Telegram notification failed for ${user.id}:`, tgErr);
          }
        }
      } catch (driveErr) {
        console.error(`[Scheduler] Drive auto-save failed for user ${user.id}:`, driveErr);
      }

    } catch (err) {
      console.error(`[Scheduler] Auto-plan build failed for user ${user.id}:`, err);
    }
  }

  console.log('[Scheduler] Morning plan build complete');
}

/**
 * Return the current hour (0–23) in the given IANA timezone.
 */
function localHourForTz(now: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const h = parts.find((p) => p.type === "hour");
    return h ? parseInt(h.value, 10) : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

/**
 * Return the date string (YYYY-MM-DD) in the given IANA timezone.
 */
function localDateKeyForTz(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return parts;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Run the Dream Cycle synthesis for every active user.
 * Called every scheduler tick. Per-user timezone gating ensures each user's
 * synthesis only fires once per night at ~3am in their local timezone.
 * The proactiveScheduleLog provides idempotency across restarts.
 */
export async function runDreamCycleForAllUsers(now: Date): Promise<void> {
  const allUsers = await db.select({ id: schema.users.id }).from(schema.users).catch(() => []);
  const allPrefs = await db.select().from(schema.userPreferences).catch(() => []);
  const prefsMap: Record<string, Record<string, unknown>> = {};
  for (const p of allPrefs) prefsMap[p.userId] = (p.data as Record<string, unknown>) || {};

  let totalInsights = 0;
  for (const user of allUsers) {
    const prefs = prefsMap[user.id] || {};
    if (prefs.dreamEnabled === false) continue;

    const tz = typeof prefs.timezone === "string" ? prefs.timezone : "UTC";
    const localHour = localHourForTz(now, tz);
    if (localHour !== 3) continue;

    const localDate = localDateKeyForTz(now, tz);
    const messageType = `dream_cycle:${localDate}`;

    try {
      const existing = await db
        .select({ id: schema.proactiveScheduleLog.id })
        .from(schema.proactiveScheduleLog)
        .where(
          and(
            eq(schema.proactiveScheduleLog.userId, user.id),
            eq(schema.proactiveScheduleLog.messageType, messageType),
            eq(schema.proactiveScheduleLog.sentDate, localDate),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;
    } catch {
      continue;
    }

    try {
      const { runDreamForUser } = await import('./memory/dream');
      const dreamResult = await runDreamForUser(user.id, localDate);
      const count = dreamResult.insightsStored;
      totalInsights += count;
      if (count > 0 || dreamResult.consolidation.promoted > 0 || dreamResult.semanticExtraction.factsExtracted > 0) {
        console.log(
          `[Dream] user=${user.id} (${localDate}) insights=${count} promoted=${dreamResult.consolidation.promoted} discarded=${dreamResult.consolidation.discarded} factsExtracted=${dreamResult.semanticExtraction.factsExtracted} decayed=${dreamResult.decay.decayed} deleted=${dreamResult.decay.hardDeleted} boosted=${dreamResult.reinforcement.boosted}`,
        );
      }
      // Persist dream cycle metadata into user preferences so the morning
      // briefing builder can surface consolidation stats in its context.
      try {
        const existingPrefsRows = await db
          .select({ data: schema.userPreferences.data })
          .from(schema.userPreferences)
          .where(eq(schema.userPreferences.userId, user.id));
        const existingPrefs = (existingPrefsRows[0]?.data as Record<string, unknown>) || {};
        const updatedPrefsWithDream = {
          ...existingPrefs,
          lastDreamCycle: {
            date: localDate,
            insightsStored: dreamResult.insightsStored,
            consolidation: dreamResult.consolidation,
            semanticExtraction: dreamResult.semanticExtraction,
            decay: dreamResult.decay,
            reinforcement: dreamResult.reinforcement,
          },
        };
        await db.insert(schema.userPreferences).values({
          userId: user.id,
          data: updatedPrefsWithDream,
        }).onConflictDoUpdate({
          target: [schema.userPreferences.userId],
          set: { data: updatedPrefsWithDream, updatedAt: new Date() },
        });
      } catch (prefErr) {
        console.error(`[Dream] failed to persist dream metadata for ${user.id}:`, prefErr);
      }
      await db.insert(schema.proactiveScheduleLog).values({
        userId: user.id,
        messageType,
        sentDate: localDate,
      }).catch(() => {});
    } catch (err) {
      console.error(`[Dream] failed for user ${user.id}:`, err);
    }
  }

  if (totalInsights > 0) {
    console.log(`[Dream] Cycle batch complete — ${totalInsights} total insight(s)`);
  }
}

/**
 * Deliver pending dream insights to every user at 7–10am local time.
 * Runs every scheduler tick; per-user timezone gating and idempotency key
 * ensure each user receives at most one delivery batch per day.
 * Routes via the full channel registry (telegram, in_app, whatsapp, etc.)
 * based on each user's notification preferences — no Telegram requirement.
 */
export async function runDreamDeliveryForAllUsers(now: Date): Promise<void> {
  const allUsers = await db.select({ id: schema.users.id }).from(schema.users).catch(() => []);
  const allPrefs = await db.select().from(schema.userPreferences).catch(() => []);
  const prefsMap: Record<string, Record<string, unknown>> = {};
  for (const p of allPrefs) prefsMap[p.userId] = (p.data as Record<string, unknown>) || {};

  for (const user of allUsers) {
    const prefs = prefsMap[user.id] || {};
    if (prefs.dreamEnabled === false) continue;

    const tz = typeof prefs.timezone === "string" ? prefs.timezone : "UTC";
    const localHour = localHourForTz(now, tz);
    if (localHour < 7 || localHour >= 10) continue;

    const localDate = localDateKeyForTz(now, tz);
    const messageType = `dream_delivery:${localDate}`;

    try {
      const existing = await db
        .select({ id: schema.proactiveScheduleLog.id })
        .from(schema.proactiveScheduleLog)
        .where(
          and(
            eq(schema.proactiveScheduleLog.userId, user.id),
            eq(schema.proactiveScheduleLog.messageType, messageType),
            eq(schema.proactiveScheduleLog.sentDate, localDate),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;
    } catch {
      continue;
    }

    try {
      if (await isActionSuppressed(user.id, "dream_insight")) {
        console.log(`[Dream] skipping delivery for ${user.id} (self-correction: suppressed)`);
        continue;
      }
      const { getPendingDreamInsights, markDreamInsightsDelivered } = await import('./memory/dream');
      const pending = await getPendingDreamInsights(user.id);
      if (pending.length === 0) {
        await db.insert(schema.proactiveScheduleLog).values({
          userId: user.id, messageType, sentDate: localDate,
        }).catch(() => {});
        continue;
      }

      const insightLines = pending
        .map((ins, i) => `${i + 1}. ${ins.insightText}`)
        .join("\n\n");
      const msg = `🌙 Jarvis dreamed about you\n\n${insightLines}\n\n_(Synthesised from your last 90 days of memories)_`;

      await notifyUser(user.id, "dream_insight", msg);
      await markDreamInsightsDelivered(pending.map((i) => i.id));
      await db.insert(schema.proactiveScheduleLog).values({
        userId: user.id, messageType, sentDate: localDate,
      }).catch(() => {});
      logInteraction(user.id, "notification", "outbound", msg, "dream_delivery").catch(() => {});
      import('./intelligence/actionLog').then(({ logAction }) => {
        logAction(user.id, "dream_insight", { count: pending.length, date: localDate }).catch(() => {});
      }).catch(() => {});
      console.log(`[Dream] delivered ${pending.length} insight(s) to ${user.id} (${localDate})`);
    } catch (err) {
      console.error(`[Dream] delivery failed for user ${user.id}:`, err);
    }
  }
}

function buildPlanMarkdown(date: string, tasks: any[], reasoning?: string): string {
  const lines: string[] = [`# Daily Plan — ${date}`, ''];
  if (reasoning) {
    lines.push(`> ${reasoning}`, '');
  }
  lines.push('## Tasks', '');
  for (const task of tasks) {
    const durationStr = task.duration ? ` (${task.duration} min)` : '';
    const timeStr = task.time ? ` @ ${task.time}` : '';
    const status = task.completed ? '✅' : '⬜';
    lines.push(`${status} **${task.title}**${timeStr}${durationStr}`);
    if (task.description) lines.push(`   ${task.description}`);
  }
  return lines.join('\n');
}
