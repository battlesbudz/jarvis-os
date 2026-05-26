import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";

import { generateWebchatToken } from "../auth";
import { db } from "../db";
import { webchatInviteTokens } from "@shared/schema";

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
