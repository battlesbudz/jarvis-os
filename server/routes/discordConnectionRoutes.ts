import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { channelLinks } from "@shared/schema";
import { db } from "../db";

export function registerDiscordConnectionRoutes(app: Express) {
  app.get("/api/discord/status", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const links = await db.select().from(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")));
      const link = links[0];
      const meta = link?.metadata as { discordUsername?: string } | undefined;
      res.json({
        connected: links.length > 0,
        discordUsername: meta?.discordUsername ?? null,
      });
    } catch (error) {
      console.error("Error getting Discord status:", error);
      res.status(500).json({ error: "Failed to get Discord status" });
    }
  });

  app.post("/api/discord/link", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { code } = req.body as { code?: string };
      if (!code || code.trim().length === 0) {
        return res.status(400).json({ error: "Pairing code is required." });
      }
      const { completePairing } = await import("../discord/manager");
      const result = await completePairing(userId, code.trim().toUpperCase());
      if (!result.ok) {
        return res.status(400).json({ error: result.error ?? "Pairing failed." });
      }
      res.json({ ok: true, discordUsername: result.discordUsername });
    } catch (error) {
      console.error("Error completing Discord pairing:", error);
      res.status(500).json({ error: "Failed to complete Discord pairing." });
    }
  });
}
