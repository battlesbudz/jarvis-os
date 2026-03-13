import { db } from './db';
import { eq, and } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { buildPlanForUser } from './routes';

let schedulerRunning = false;

export function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  setInterval(async () => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();

    if (h === 7 && m === 0) {
      console.log('[Scheduler] Running morning plan build...');
      await runMorningPlanBuild();
    }
  }, 60 * 1000);

  console.log('[Scheduler] Started — will run morning plan build at 7:00 AM daily');
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

    } catch (err) {
      console.error(`[Scheduler] Auto-plan build failed for user ${user.id}:`, err);
    }
  }

  console.log('[Scheduler] Morning plan build complete');
}
