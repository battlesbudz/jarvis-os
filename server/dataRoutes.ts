import type { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";

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

export function registerDataRoutes(app: Express): void {
  app.get("/api/data/plans/:date", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { date } = req.params;
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
      const { date } = req.params;
      const { data } = req.body;
      await db
        .insert(schema.plans)
        .values({ userId, date, data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.plans.userId, schema.plans.date],
          set: { data, updatedAt: new Date() },
        });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving plan:", e);
      res.status(500).json({ error: "Failed to save plan" });
    }
  });

  registerSimpleJsonCrud(app, "goals", schema.goals);
  registerSimpleJsonCrud(app, "stats", schema.stats);
  registerSimpleJsonCrud(app, "brain-dump-inbox", schema.brainDumpInbox);
  registerSimpleJsonCrud(app, "chat-history", schema.chatHistory);
  registerSimpleJsonCrud(app, "life-context", schema.lifeContext);
  registerSimpleJsonCrud(app, "timer-settings", schema.timerSettings);
  registerSimpleJsonCrud(app, "user-preferences", schema.userPreferences);
  registerSimpleJsonCrud(app, "completion-history", schema.completionHistory);
  registerSimpleJsonCrud(app, "blocked-tasks", schema.blockedTasks);
  registerSimpleJsonCrud(app, "plan-snapshots", schema.planSnapshots);

  app.get("/api/data/energy-checkins/:date", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { date } = req.params;
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
      const { date } = req.params;
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
      const { date } = req.params;
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
      const { date } = req.params;
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
}
