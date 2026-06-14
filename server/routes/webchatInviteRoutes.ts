import type { Express, Request, Response } from "express";
import type { RequestHandler } from "express";
import { eq, and, gte } from "drizzle-orm";

import { generateWebchatToken } from "../auth";
import { db } from "../db";
import { webchatInviteTokens } from "@shared/schema";

function inviteUrl(req: Request, token: string): string {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const protocol = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  return `${protocol}://${host}/chat?invite=${token}`;
}

export function registerWebchatInviteRoutes(app: Express, authMiddleware: RequestHandler): void {
  app.get("/api/webchat/invite/active", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const [row] = await db
        .select()
        .from(webchatInviteTokens)
        .where(and(eq(webchatInviteTokens.userId, userId), gte(webchatInviteTokens.expiresAt, new Date())))
        .limit(1);

      if (!row) return res.json({ active: false });

      return res.json({ active: true, token: row.token, url: inviteUrl(req, row.token), expiresAt: row.expiresAt });
    } catch (error) {
      console.error("Error fetching active webchat invite token:", error);
      return res.status(500).json({ error: "Failed to fetch active invite token" });
    }
  });

  app.post("/api/webchat/invite", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      const [existing] = await db
        .select()
        .from(webchatInviteTokens)
        .where(and(eq(webchatInviteTokens.userId, userId), gte(webchatInviteTokens.expiresAt, new Date())))
        .limit(1);

      if (existing) {
        return res.json({ token: existing.token, url: inviteUrl(req, existing.token), expiresAt: existing.expiresAt });
      }

      const { randomBytes } = await import("crypto");
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.insert(webchatInviteTokens).values({ token, userId, expiresAt });

      return res.json({ token, url: inviteUrl(req, token), expiresAt });
    } catch (error) {
      console.error("Error creating webchat invite token:", error);
      return res.status(500).json({ error: "Failed to create invite token" });
    }
  });

  app.delete("/api/webchat/invite/:token", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const token = String(req.params.token ?? "");

      const [row] = await db
        .select()
        .from(webchatInviteTokens)
        .where(eq(webchatInviteTokens.token, token))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Token not found" });
      if (row.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      await db.delete(webchatInviteTokens).where(eq(webchatInviteTokens.token, token));

      return res.json({ ok: true });
    } catch (error) {
      console.error("Error revoking webchat invite token:", error);
      return res.status(500).json({ error: "Failed to revoke invite token" });
    }
  });
}

export function registerPublicWebchatInviteRoutes(app: Express): void {
  // GET /api/webchat/invite/redeem - no auth required; guest redeems invite token
  app.get("/api/webchat/invite/redeem", async (req: Request, res: Response) => {
    try {
      const { token } = req.query as { token?: string };
      if (!token) return res.status(400).json({ error: "token is required" });

      const [row] = await db
        .select()
        .from(webchatInviteTokens)
        .where(eq(webchatInviteTokens.token, token))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Invite link not found" });
      if (row.expiresAt < new Date()) {
        return res.status(410).json({ error: "This invite link has expired" });
      }

      const jwtToken = generateWebchatToken(row.userId);
      return res.json({ token: jwtToken, userId: row.userId });
    } catch (error) {
      console.error("Error redeeming webchat invite token:", error);
      return res.status(500).json({ error: "Failed to redeem invite token" });
    }
  });
}
