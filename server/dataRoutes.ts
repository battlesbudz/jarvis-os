import type { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import { savePlanForUser } from "./dailyCommand/planPersistence";
import type { DailyPlanData } from "./dailyCommand/planOps";

function requireUserId(req: Request, res: Response): string | null {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return userId;
}

interface SimpleJsonTable {
  userId: PgColumn;
  data: PgColumn;
  updatedAt: PgColumn;
}

function registerSimpleJsonCrud(
  app: Express,
  path: string,
  table: PgTable & SimpleJsonTable
): void {
  app.get(`/api/data/${path}`, async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const result = await db
        .select({ data: table.data })
        .from(table)
        .where(eq(table.userId, userId));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error(`Error fetching ${path}:`, e);
      res.status(500).json({ error: `Failed to fetch ${path}` });
    }
  });

  app.put(`/api/data/${path}`, async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { data } = req.body;
      await db
        .insert(table)
        .values({ userId, data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [table.userId],
          set: { data, updatedAt: new Date() },
        });
      res.json({ ok: true });
    } catch (e) {
      console.error(`Error saving ${path}:`, e);
      res.status(500).json({ error: `Failed to save ${path}` });
    }
  });

  app.delete(`/api/data/${path}`, async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await db
        .delete(table)
        .where(eq(table.userId, userId));
      res.json({ ok: true });
    } catch (e) {
      console.error(`Error deleting ${path}:`, e);
      res.status(500).json({ error: `Failed to delete ${path}` });
    }
  });
}

const _p = (v: string | string[]): string => Array.isArray(v) ? (v[0] ?? "") : v;

export function registerDataRoutes(app: Express): void {
  app.get("/api/data/plans/:date", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const date = _p(req.params.date);
      const result = await db
        .select()
        .from(schema.plans)
        .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, date)));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching plan:", e);
      res.status(500).json({ error: "Failed to fetch plan" });
    }
  });

  app.get("/api/data/plans", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const result = await db
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.userId, userId));
      const plansMap: Record<string, unknown> = {};
      for (const row of result) {
        plansMap[row.date] = row.data;
      }
      res.json({ data: plansMap });
    } catch (e) {
      console.error("Error fetching plans:", e);
      res.status(500).json({ error: "Failed to fetch plans" });
    }
  });

  app.put("/api/data/plans/:date", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const date = _p(req.params.date);
      const { data } = req.body;

      // Save through the daily-command helper so legacy and patch-based
      // plan edits share goal-tree completion propagation.
      await savePlanForUser({ userId, date, data: data as DailyPlanData });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving plan:", e);
      res.status(500).json({ error: "Failed to save plan" });
    }
  });

  // Goals: fully custom route set so we can hook into PUT and
  // auto-enqueue a decomposition job whenever a brand-new goal id
  // appears. We don't call registerSimpleJsonCrud here to avoid double
  // registration of PUT.
  app.get("/api/data/goals", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const result = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching goals:", e);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });

  app.delete("/api/data/goals", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await db.delete(schema.goals).where(eq(schema.goals.userId, userId));
      res.json({ ok: true });
    } catch (e) {
      console.error("Error deleting goals:", e);
      res.status(500).json({ error: "Failed to delete goals" });
    }
  });

  app.put("/api/data/goals", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { data } = req.body;
      const incoming = (Array.isArray(data) ? data : []) as Array<{ id: string; title: string }>;

      const [prev] = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId))
        .limit(1);
      type GoalShape = {
        id: string;
        title: string;
        description?: string;
        targetDate?: string;
        target?: string;
        why?: string;
      };
      const prevList = ((prev?.data as GoalShape[] | undefined) || []);
      const prevById = new Map(prevList.map((g) => [g.id, g]));
      const incomingTyped = incoming as GoalShape[];
      const incomingIds = new Set(incomingTyped.map((g) => g.id));

      const goalsToDecompose: GoalShape[] = [];
      for (const g of incomingTyped) {
        if (!g || !g.id || !g.title) continue;
        const prevGoal = prevById.get(g.id);
        if (!prevGoal) {
          // Net-new goal
          goalsToDecompose.push(g);
          continue;
        }
        // Existing goal: re-decompose if any meaningful field changed.
        const changed =
          (prevGoal.title || "") !== (g.title || "") ||
          (prevGoal.description || "") !== (g.description || "") ||
          (prevGoal.targetDate || "") !== (g.targetDate || "") ||
          (prevGoal.target || "") !== (g.target || "") ||
          (prevGoal.why || "") !== (g.why || "");
        if (changed) goalsToDecompose.push(g);
      }

      // Goals removed since the last save: tear down their goal trees so
      // the daily-plan walker stops injecting tasks from deleted goals.
      const removedIds = prevList
        .map((g) => g.id)
        .filter((id) => id && !incomingIds.has(id));

      await db
        .insert(schema.goals)
        .values({ userId, data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.goals.userId],
          set: { data, updatedAt: new Date() },
        });

      // Reconcile goal_trees: drop trees whose goal was removed so the
      // scheduler can no longer inject tasks from deleted goals.
      if (removedIds.length > 0) {
        try {
          for (const removedId of removedIds) {
            await db
              .delete(schema.goalTrees)
              .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.goalId, removedId)));
          }
          console.log(`[Goals] removed ${removedIds.length} stale goal tree(s) user=${userId}`);
        } catch (e) {
          console.error("[Goals] stale-tree cleanup failed:", e);
        }
      }

      // Fire-and-forget: enqueue a decomposition for each new OR
      // materially-changed goal. The worker is throttled per-user, so a
      // burst queues sequentially without overwhelming the LLM.
      if (goalsToDecompose.length > 0) {
        try {
          const { enqueueGoalDecomposition } = await import("./agent/goalDecomposer");
          for (const g of goalsToDecompose) {
            await enqueueGoalDecomposition(userId, { id: g.id, title: g.title });
          }
          console.log(`[Goals] auto-queued decomposition for ${goalsToDecompose.length} new/changed goal(s) user=${userId}`);
        } catch (e) {
          console.error("[Goals] auto-decompose enqueue failed:", e);
        }
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving goals:", e);
      res.status(500).json({ error: "Failed to save goals" });
    }
  });
  registerSimpleJsonCrud(app, "stats", schema.stats);
  registerSimpleJsonCrud(app, "brain-dump-inbox", schema.brainDumpInbox);
  registerSimpleJsonCrud(app, "chat-history", schema.chatHistory);
  registerSimpleJsonCrud(app, "life-context", schema.lifeContext);
  registerSimpleJsonCrud(app, "timer-settings", schema.timerSettings);
  registerSimpleJsonCrud(app, "user-preferences", schema.userPreferences);

  app.get("/api/data/coach-session-id", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const result = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId));
      const prefs = (result[0]?.data as any) || {};
      res.json({ sdkSessionId: prefs._coachSessionId || null });
    } catch (e) {
      console.error("Error fetching coach-session-id:", e);
      res.status(500).json({ error: "Failed to fetch coach-session-id" });
    }
  });

  app.put("/api/data/coach-session-id", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { sdkSessionId } = req.body;
      if (sdkSessionId !== null && sdkSessionId !== undefined && typeof sdkSessionId !== 'string') {
        return res.status(400).json({ error: "sdkSessionId must be a string or null" });
      }
      const result = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId));
      const prefs = (result[0]?.data as any) || {};
      prefs._coachSessionId = sdkSessionId || null;
      await db
        .insert(schema.userPreferences)
        .values({ userId, data: prefs, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.userPreferences.userId],
          set: { data: prefs, updatedAt: new Date() },
        });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving coach-session-id:", e);
      res.status(500).json({ error: "Failed to save coach-session-id" });
    }
  });

  app.post("/api/data/auto-built-plan/dismiss", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const result = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId));
      const currentPrefs = (result[0]?.data as any) || {};
      if (currentPrefs.autoBuiltPlan) {
        currentPrefs.autoBuiltPlan.dismissed = true;
      }
      await db
        .insert(schema.userPreferences)
        .values({ userId, data: currentPrefs, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.userPreferences.userId],
          set: { data: currentPrefs, updatedAt: new Date() },
        });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error dismissing auto-built plan:", e);
      res.status(500).json({ error: "Failed to dismiss auto-built plan" });
    }
  });
  registerSimpleJsonCrud(app, "completion-history", schema.completionHistory);
  registerSimpleJsonCrud(app, "blocked-tasks", schema.blockedTasks);
  registerSimpleJsonCrud(app, "plan-snapshots", schema.planSnapshots);

  app.get("/api/data/energy-checkins/:date", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const date = _p(req.params.date);
      const result = await db
        .select()
        .from(schema.energyCheckins)
        .where(and(eq(schema.energyCheckins.userId, userId), eq(schema.energyCheckins.date, date)));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching energy checkin:", e);
      res.status(500).json({ error: "Failed to fetch energy checkin" });
    }
  });

  app.put("/api/data/energy-checkins/:date", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const date = _p(req.params.date);
      const { data } = req.body;
      await db
        .insert(schema.energyCheckins)
        .values({ userId, date, data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.energyCheckins.userId, schema.energyCheckins.date],
          set: { data, updatedAt: new Date() },
        });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving energy checkin:", e);
      res.status(500).json({ error: "Failed to save energy checkin" });
    }
  });

  app.get("/api/data/completed-calendar-ids/:date", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const date = _p(req.params.date);
      const result = await db
        .select()
        .from(schema.completedCalendarIds)
        .where(and(eq(schema.completedCalendarIds.userId, userId), eq(schema.completedCalendarIds.date, date)));
      if (result.length === 0) return res.json({ data: [] });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching completed calendar ids:", e);
      res.status(500).json({ error: "Failed to fetch completed calendar ids" });
    }
  });

  app.put("/api/data/completed-calendar-ids/:date", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const date = _p(req.params.date);
      const { data } = req.body;
      await db
        .insert(schema.completedCalendarIds)
        .values({ userId, date, data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.completedCalendarIds.userId, schema.completedCalendarIds.date],
          set: { data, updatedAt: new Date() },
        });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving completed calendar ids:", e);
      res.status(500).json({ error: "Failed to save completed calendar ids" });
    }
  });

  app.get("/api/data/export", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const [goalsRow] = await db.select({ data: schema.goals.data }).from(schema.goals).where(eq(schema.goals.userId, userId));
      const [statsRow] = await db.select({ data: schema.stats.data }).from(schema.stats).where(eq(schema.stats.userId, userId));
      const [lifeContextRow] = await db.select({ data: schema.lifeContext.data }).from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId));
      const [userPrefsRow] = await db.select({ data: schema.userPreferences.data }).from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId));
      const [chatHistoryRow] = await db.select({ data: schema.chatHistory.data }).from(schema.chatHistory).where(eq(schema.chatHistory.userId, userId));
      const [timerSettingsRow] = await db.select({ data: schema.timerSettings.data }).from(schema.timerSettings).where(eq(schema.timerSettings.userId, userId));
      const [brainDumpRow] = await db.select({ data: schema.brainDumpInbox.data }).from(schema.brainDumpInbox).where(eq(schema.brainDumpInbox.userId, userId));
      const [completionHistoryRow] = await db.select({ data: schema.completionHistory.data }).from(schema.completionHistory).where(eq(schema.completionHistory.userId, userId));
      const [blockedTasksRow] = await db.select({ data: schema.blockedTasks.data }).from(schema.blockedTasks).where(eq(schema.blockedTasks.userId, userId));
      const [planSnapshotsRow] = await db.select({ data: schema.planSnapshots.data }).from(schema.planSnapshots).where(eq(schema.planSnapshots.userId, userId));

      const plansRows = await db.select().from(schema.plans).where(eq(schema.plans.userId, userId));
      const plans: Record<string, unknown> = {};
      for (const row of plansRows) {
        plans[row.date] = row.data;
      }

      const energyRows = await db.select().from(schema.energyCheckins).where(eq(schema.energyCheckins.userId, userId));
      const energyCheckins: Record<string, unknown> = {};
      for (const row of energyRows) {
        energyCheckins[row.date] = row.data;
      }

      const calendarIdRows = await db.select().from(schema.completedCalendarIds).where(eq(schema.completedCalendarIds.userId, userId));
      const completedCalendarIds: Record<string, unknown> = {};
      for (const row of calendarIdRows) {
        completedCalendarIds[row.date] = row.data;
      }

      res.json({
        data: {
          goals: goalsRow?.data ?? null,
          stats: statsRow?.data ?? null,
          lifeContext: lifeContextRow?.data ?? null,
          userPreferences: userPrefsRow?.data ?? null,
          chatHistory: chatHistoryRow?.data ?? null,
          timerSettings: timerSettingsRow?.data ?? null,
          brainDumpInbox: brainDumpRow?.data ?? null,
          completionHistory: completionHistoryRow?.data ?? null,
          blockedTasks: blockedTasksRow?.data ?? null,
          planSnapshots: planSnapshotsRow?.data ?? null,
          plans,
          energyCheckins,
          completedCalendarIds,
        },
      });
    } catch (e) {
      console.error("Error exporting data:", e);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  app.post("/api/data/import", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { data } = req.body;
      if (!data || typeof data !== "object") {
        return res.status(400).json({ error: "Missing data object in request body" });
      }

      const now = new Date();

      await db.transaction(async (tx) => {
        const replaceSimple = async (table: PgTable & SimpleJsonTable, value: unknown) => {
          if (value === null || value === undefined) {
            await tx.delete(table).where(eq(table.userId, userId));
            return;
          }
          await tx.insert(table).values({ userId, data: value, updatedAt: now })
            .onConflictDoUpdate({ target: [table.userId], set: { data: value, updatedAt: now } });
        };

        await replaceSimple(schema.goals, data.goals);
        await replaceSimple(schema.stats, data.stats);
        await replaceSimple(schema.lifeContext, data.lifeContext);
        await replaceSimple(schema.chatHistory, data.chatHistory);
        await replaceSimple(schema.timerSettings, data.timerSettings);
        await replaceSimple(schema.brainDumpInbox, data.brainDumpInbox);
        await replaceSimple(schema.completionHistory, data.completionHistory);
        await replaceSimple(schema.blockedTasks, data.blockedTasks);
        await replaceSimple(schema.planSnapshots, data.planSnapshots);
        await replaceSimple(schema.userPreferences, data.userPreferences);

        if (data.plans && typeof data.plans === "object") {
          await tx.delete(schema.plans).where(eq(schema.plans.userId, userId));
          for (const [date, planData] of Object.entries(data.plans)) {
            await tx.insert(schema.plans).values({ userId, date, data: planData, updatedAt: now });
          }
        }

        if (data.energyCheckins && typeof data.energyCheckins === "object") {
          await tx.delete(schema.energyCheckins).where(eq(schema.energyCheckins.userId, userId));
          for (const [date, checkinData] of Object.entries(data.energyCheckins)) {
            await tx.insert(schema.energyCheckins).values({ userId, date, data: checkinData, updatedAt: now });
          }
        }

        if (data.completedCalendarIds && typeof data.completedCalendarIds === "object") {
          await tx.delete(schema.completedCalendarIds).where(eq(schema.completedCalendarIds.userId, userId));
          for (const [date, idsData] of Object.entries(data.completedCalendarIds)) {
            await tx.insert(schema.completedCalendarIds).values({ userId, date, data: idsData, updatedAt: now });
          }
        }
      });

      res.json({ ok: true });
    } catch (e) {
      console.error("Error importing data:", e);
      res.status(500).json({ error: "Failed to import data" });
    }
  });
}
