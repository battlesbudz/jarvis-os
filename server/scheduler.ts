import { db } from './db';
import { eq, and } from 'drizzle-orm';
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

    // Nightly 03:00 local per user — run Dream Cycle synthesis.
    // Per-user timezone gating inside each function; fires every tick so it
    // catches every user at their local 3am (synthesis) and 7-10am (delivery).
    runDreamCycleForAllUsers(now).catch((err) =>
      console.error('[Scheduler] Dream cycle failed:', err),
    );
    runDreamDeliveryForAllUsers(now).catch((err) =>
      console.error('[Scheduler] Dream delivery failed:', err),
    );

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

    // Discord channel schedules — check every minute
    await runDiscordSchedules(now);

    // Named agent autonomous loops — check every minute
    await runAgentLoops(now);

  }, 60 * 1000);

  console.log('[Scheduler] Started — morning plan 7:00 AM daily, weekly patterns Sunday 3:00 AM, Discord schedules every minute');
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
      const updatedPrefs = {
        ...currentPrefs,
        autoBuiltPlan: {
          date: today,
          topTask: topTask?.title,
          reasoning: planReasoning || undefined,
          taskCount: newTasks.length,
          predictionText: predictionText || null,
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
          // Also send as a channel notification for Telegram/Discord users
          const gutMsg = `👁 Jarvis noticed:\n${flagLines}`;
          const { notifyUser: notifyGut } = await import('./channels/registry');
          await notifyGut(user.id, 'morning_briefing', gutMsg);
          console.log(`[Scheduler] ${gutFlags.length} gut flag(s) embedded in morning brief for ${user.id}`);
        }
      } catch (gutErr) {
        console.error(`[Scheduler] gut morning brief failed for ${user.id}:`, gutErr);
      }

      // Send the morning briefing notification via the user's preferred channel.
      try {
        const taskListLines = newTasks.slice(0, 5).map((t, i) => `${i + 1}. ${t.title}`).join('\n');
        const morningMsg = `☀️ Good morning! Your plan for today:\n\n${taskListLines}${newTasks.length > 5 ? `\n…and ${newTasks.length - 5} more` : ''}\n\n📌 Focus first: ${topTask.title}${predictionText ? `\n${predictionText}` : ''}`;
        await notifyUser(user.id, 'morning_briefing', morningMsg);
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
      const count = await runDreamForUser(user.id, localDate);
      totalInsights += count;
      if (count > 0) {
        console.log(`[Dream] ${count} insight(s) synthesised for user ${user.id} (${localDate})`);
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
