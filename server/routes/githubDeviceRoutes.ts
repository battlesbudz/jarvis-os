import type { Express, Request, Response } from "express";
import { authMiddleware } from "../auth";

export function registerGitHubDeviceRoutes(app: Express): void {
  app.get("/api/github/oauth-available", async (_req: Request, res: Response) => {
    res.json({ available: !!process.env.GITHUB_CLIENT_ID });
  });

  app.post("/api/github/device/start", authMiddleware, async (_req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: "GitHub OAuth not configured on this server" });
    }
    try {
      const response = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, scope: "repo read:user" }).toString(),
      });
      if (!response.ok) {
        return res.status(502).json({ error: "GitHub API returned an error" });
      }
      const data = (await response.json()) as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
      };
      res.json(data);
    } catch (err) {
      console.error("[GitHub Device Flow] start error:", err);
      res.status(500).json({ error: "Failed to initiate device flow" });
    }
  });

  app.post("/api/github/device/poll", authMiddleware, async (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: "GitHub OAuth not configured on this server" });
    }
    const userId = (req as any).userId as string;
    const { device_code } = req.body as { device_code?: string };
    if (!device_code) {
      return res.status(400).json({ error: "device_code is required" });
    }
    try {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString(),
      });
      const data = (await response.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };
      if (data.access_token) {
        const { saveGitHubSettings, getGitHubUser } = await import("../integrations/github");
        const username = await getGitHubUser(data.access_token);
        await saveGitHubSettings(userId, { pat: data.access_token, tokenType: "oauth", username });
        return res.json({ status: "authorized" });
      }
      if (data.error === "authorization_pending" || data.error === "slow_down") {
        return res.json({ status: "pending", error: data.error });
      }
      return res.json({ status: "error", error: data.error, message: data.error_description });
    } catch (err) {
      console.error("[GitHub Device Flow] poll error:", err);
      res.status(500).json({ error: "Failed to poll device flow" });
    }
  });
}
