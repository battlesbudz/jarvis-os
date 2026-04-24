/**
 * Discord OS REST API — Phases 1, 3, 6, 8
 * Exposes schedules, approvals, agents, and activity endpoints.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { discordChannelSchedules, discordPendingApprovals, discordAgents, interactionLog } from "@shared/schema";
import { authMiddleware } from "../auth";
import {
  createSchedule,
  listSchedules,
  deleteSchedule,
  toggleSchedule,
  runSchedule,
  nextRunTime,
} from "./schedules";
import { executeApprovalAction } from "./approvalActions";

export function registerDiscordScheduleRoutes(app: Express): void {

  // ── Schedules ──────────────────────────────────────────────────────────────

  app.get("/api/discord/schedules", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    try {
      const schedules = await listSchedules(userId);
      const withNext = schedules.map((s) => ({
        ...s,
        nextRun: nextRunTime(s.cronExpression),
      }));
      res.json({ schedules: withNext });
    } catch (err) {
      console.error("[DiscordSchedules] GET /api/discord/schedules failed:", err);
      res.status(500).json({ error: "Failed to load schedules" });
    }
  });

  app.post("/api/discord/schedules", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { channelName, label, cronExpression, prompt, guildId, channelId, pipelineNext } = req.body;
    if (!channelName || !label || !cronExpression || !prompt) {
      return res.status(400).json({ error: "channelName, label, cronExpression, prompt are required" });
    }
    try {
      const schedule = await createSchedule(userId, {
        channelName,
        label,
        cronExpression,
        prompt,
        guildId,
        channelId,
        pipelineNext,
      });
      res.json({ ok: true, schedule });
    } catch (err) {
      console.error("[DiscordSchedules] POST /api/discord/schedules failed:", err);
      res.status(500).json({ error: "Failed to create schedule" });
    }
  });

  app.delete("/api/discord/schedules/:id", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;
    try {
      await deleteSchedule(userId, id);
      res.json({ ok: true });
    } catch (err) {
      console.error("[DiscordSchedules] DELETE /api/discord/schedules/:id failed:", err);
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  });

  app.post("/api/discord/schedules/:id/toggle", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { enabled } = req.body;
    try {
      await toggleSchedule(userId, id, !!enabled);
      res.json({ ok: true });
    } catch (err) {
      console.error("[DiscordSchedules] toggle failed:", err);
      res.status(500).json({ error: "Failed to toggle schedule" });
    }
  });

  app.post("/api/discord/schedules/:id/run", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;
    try {
      // Verify ownership
      const rows = await db.select().from(discordChannelSchedules)
        .where(and(eq(discordChannelSchedules.id, id), eq(discordChannelSchedules.userId, userId)))
        .limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Schedule not found" });

      res.json({ ok: true, message: "Schedule run started" });
      // Run async
      runSchedule(id).catch((err) => console.error("[DiscordSchedules] manual run failed:", err));
    } catch (err) {
      console.error("[DiscordSchedules] manual run failed:", err);
      res.status(500).json({ error: "Failed to run schedule" });
    }
  });

  // ── Approvals ──────────────────────────────────────────────────────────────

  app.get("/api/discord/approvals", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    try {
      const approvals = await db
        .select()
        .from(discordPendingApprovals)
        .where(
          and(
            eq(discordPendingApprovals.userId, userId),
            eq(discordPendingApprovals.status, "pending"),
          ),
        );
      res.json({ approvals });
    } catch (err) {
      console.error("[DiscordSchedules] GET /api/discord/approvals failed:", err);
      res.status(500).json({ error: "Failed to load approvals" });
    }
  });

  app.post("/api/discord/approvals/:messageId/resolve", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { messageId } = req.params;
    const { action } = req.body; // "approve" or "reject"
    try {
      const rows = await db
        .select()
        .from(discordPendingApprovals)
        .where(
          and(
            eq(discordPendingApprovals.messageId, messageId),
            eq(discordPendingApprovals.userId, userId),
          ),
        )
        .limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Approval not found" });
      const approval = rows[0];
      if (approval.status !== "pending") {
        return res.status(400).json({ error: "Approval already resolved" });
      }

      await db
        .update(discordPendingApprovals)
        .set({
          status: action === "approve" ? "approved" : "rejected",
          resolvedAt: new Date(),
        })
        .where(eq(discordPendingApprovals.messageId, messageId));

      res.json({ ok: true });

      // Execute action asynchronously
      const actionData = action === "approve" ? approval.onApprove : approval.onReject;
      if (actionData) {
        executeApprovalAction(userId, actionData as any, approval.content, approval.channelId).catch((err) => {
          console.error("[DiscordSchedules] approval action failed:", err);
        });
      }
    } catch (err) {
      console.error("[DiscordSchedules] resolve approval failed:", err);
      res.status(500).json({ error: "Failed to resolve approval" });
    }
  });

  // ── Named Agents ──────────────────────────────────────────────────────────

  app.get("/api/discord/agents", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    try {
      const agents = await db
        .select()
        .from(discordAgents)
        .where(eq(discordAgents.userId, userId));
      res.json({ agents });
    } catch (err) {
      console.error("[DiscordSchedules] GET /api/discord/agents failed:", err);
      res.status(500).json({ error: "Failed to load agents" });
    }
  });

  app.post("/api/discord/agents/:id/toggle", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { loopEnabled } = req.body;
    try {
      const rows = await db.select().from(discordAgents)
        .where(and(eq(discordAgents.id, id), eq(discordAgents.userId, userId)))
        .limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Agent not found" });

      await db.update(discordAgents)
        .set({ loopEnabled: loopEnabled ? 1 : 0 })
        .where(eq(discordAgents.id, id));

      res.json({ ok: true });
    } catch (err) {
      console.error("[DiscordSchedules] toggle agent failed:", err);
      res.status(500).json({ error: "Failed to toggle agent" });
    }
  });

  // ── Activity Feed ──────────────────────────────────────────────────────────

  app.get("/api/discord/activity", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const logs = await db
        .select()
        .from(interactionLog)
        .where(
          and(
            eq(interactionLog.userId, userId),
            eq(interactionLog.channel, "discord"),
          ),
        )
        .orderBy(desc(interactionLog.createdAt))
        .limit(50);
      res.json({ activity: logs });
    } catch (err) {
      console.error("[DiscordSchedules] GET /api/discord/activity failed:", err);
      res.status(500).json({ error: "Failed to load activity" });
    }
  });
}
