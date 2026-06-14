import type { Express, Request, Response } from "express";
import { authMiddleware } from "../auth";

export function registerGitHubSettingsRoutes(app: Express): void {
  app.get("/api/github/settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { getGitHubSettings, getGitHubUser, saveGitHubSettings } = await import("../integrations/github");
      const settings = await getGitHubSettings(userId);
      let username = settings.username ?? null;
      if (settings.pat && !username) {
        username = await getGitHubUser(settings.pat);
        if (username) {
          await saveGitHubSettings(userId, { username });
        }
      }
      res.json({ connected: !!settings.pat, repos: settings.repos, tokenType: settings.tokenType ?? null, username });
    } catch (err) {
      console.error("[GitHub] GET settings error:", err);
      res.status(500).json({ error: "Failed to load GitHub settings" });
    }
  });

  app.patch("/api/github/settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { pat, repos } = req.body as { pat?: string; repos?: string[] };
      const { saveGitHubSettings, getGitHubUser } = await import("../integrations/github");
      const patch: Parameters<typeof saveGitHubSettings>[1] = {
        ...(pat !== undefined ? { pat: pat || null } : {}),
        ...(repos !== undefined ? { repos } : {}),
      };
      if (pat) {
        const username = await getGitHubUser(pat);
        patch.username = username;
      } else if (pat !== undefined && !pat) {
        patch.username = null;
      }
      await saveGitHubSettings(userId, patch);
      res.json({ ok: true });
    } catch (err) {
      console.error("[GitHub] PATCH settings error:", err);
      res.status(500).json({ error: "Failed to save GitHub settings" });
    }
  });

  app.delete("/api/github/pat", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { saveGitHubSettings } = await import("../integrations/github");
      await saveGitHubSettings(userId, { pat: null, username: null });
      res.json({ ok: true });
    } catch (err) {
      console.error("[GitHub] DELETE pat error:", err);
      res.status(500).json({ error: "Failed to remove GitHub PAT" });
    }
  });
}
