import { db } from './db';
import { eq, and } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { buildPlanForUser } from './routes';
import { getInjectableGoalTasks, markTasksInjected, type InjectableGoalTask } from './goalScheduler';
import { enqueueWeeklyPatternJobs } from './memory/weeklyJob';
import { matchesCron, runSchedule } from './discord/schedules';
import { buildDailyDigest } from './discord/digest';
import { postToDiscordChannel } from './discord/manager';
import { DIGEST_CHANNEL_KEY } from './discord/workspace';
import { getUserDriveSettings } from './driveRoutes';
import { createDriveTextFile } from './integrations/googleDrive';

let schedulerRunning = false;
let lastWeeklyRunKey = '';

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

    // Daily digest — 9pm every day
    if (h === 21 && m === 0) {
      console.log('[Scheduler] Running daily digests...');
      runDailyDigests().catch((err) => console.error('[Scheduler] runDailyDigests error:', err));
    }

    // Discord channel schedules — check every minute
    await runDiscordSchedules(now);

    // Named agent autonomous loops — check every minute
    await runAgentLoops(now);

  }, 60 * 1000);

  console.log('[Scheduler] Started — morning plan 7:00 AM daily, weekly patterns Sunday 3:00 AM, Discord schedules every minute');
}

export async function runMorningPlanBuild() {
  const today = new Date().toISOString().slice(0, 10);

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

      const result = await buildPlanForUser(user.id);
      if (!result || result.tasks.length === 0) {
        console.log(`[Scheduler] No tasks generated for user ${user.id}, skipping`);
        continue;
      }

      const newTasks = result.tasks.map(t => ({
        id: `jarvis_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        title: t.title,
        category: t.category,
        priority: t.priority,
        duration: t.duration,
        time: t.time,
        description: t.description,
        completed: false,
        createdAt: Date.now(),
        fromJarvis: true,
      }));

      // Inject next-ready tasks from active goal trees on top of the
      // base plan. Pacing is enforced inside getInjectableGoalTasks.
      let injected: InjectableGoalTask[] = [];
      try {
        injected = await getInjectableGoalTasks(user.id, today);
      } catch (e) {
        console.error(`[Scheduler] goal injection lookup failed for ${user.id}:`, e);
      }
      for (const pick of injected) {
        const minutes = Math.max(15, Math.round((pick.estimateHours || 1) * 60));
        const goalTask: typeof newTasks[number] & { goalTreeId: string; goalTaskId: string } = {
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
        };
        newTasks.push(goalTask);
      }
      if (injected.length > 0) {
        try {
          await markTasksInjected(user.id, injected, today);
          console.log(`[Scheduler] injected ${injected.length} goal task(s) for user ${user.id}`);
        } catch (e) {
          console.error(`[Scheduler] markTasksInjected failed for ${user.id}:`, e);
        }
      }

      await db.insert(schema.plans).values({
        userId: user.id,
        date: today,
        data: { date: today, tasks: newTasks },
      }).onConflictDoUpdate({
        target: [schema.plans.userId, schema.plans.date],
        set: { data: { date: today, tasks: newTasks }, updatedAt: new Date() },
      });

      const topTask = result.tasks[0];
      const existingPrefs = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, user.id));

      const currentPrefs = (existingPrefs[0]?.data as any) || {};
      const updatedPrefs = {
        ...currentPrefs,
        autoBuiltPlan: {
          date: today,
          topTask: topTask.title,
          reasoning: result.reasoning,
          taskCount: result.tasks.length,
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

      console.log(`[Scheduler] Auto-built ${newTasks.length} tasks for user ${user.id} (top: "${topTask.title}")`);

      // Auto-save daily plan to Google Drive if the user has it enabled.
      try {
        const drive = await getUserDriveSettings(user.id);
        if (drive.enabled && drive.autoSavePlans && drive.accessToken) {
          const planText = buildPlanMarkdown(today, newTasks, result.reasoning);
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
