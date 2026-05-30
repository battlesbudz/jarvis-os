import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { authMiddleware, generateToken } from "../auth";
import { db } from "../db";
import { isIntegrationOwner } from "../integrationOwner";
import { getPublicBaseUrl } from "../publicUrl";

export function registerPlatformRoutes(app: Express): void {
  // Dev-only: return a valid JWT for the first user, used by automated e2e tests.
  if (process.env.NODE_ENV !== "production") {
    app.get("/api/dev-token", async (_req: Request, res: Response) => {
      const [firstUser] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
      if (!firstUser) return res.status(404).json({ error: "No users in DB" });
      const token = generateToken(firstUser.id);
      res.json({ token, userId: firstUser.id });
    });
  }

  // Dev-only: force a project to "complete" status, used by e2e tests.
  if (process.env.NODE_ENV !== "production") {
    app.patch("/api/dev/projects/:id/complete", async (req: Request, res: Response) => {
      try {
        const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!projectId) return res.status(400).json({ error: "Missing project id" });
        await db
          .update(schema.jarvisProjects)
          .set({ status: "complete" })
          .where(eq(schema.jarvisProjects.id, projectId));
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
  }

  // Health-check used by the UI after a self-applied code-proposal restart.
  app.get("/api/ping", (_req: Request, res: Response) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Owner-only: trigger a graceful backend restart when auto-restart is unavailable.
  app.post("/api/admin/restart-backend", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const ok = await isIntegrationOwner(userId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });
    res.json({ ok: true, message: "Backend is restarting…" });
    setTimeout(() => {
      console.log("[Admin] Graceful restart triggered by owner.");
      process.exit(0);
    }, 300);
  });

}

export function registerVoiceRedirectRoute(app: Express): void {
  app.get("/go/voice-call", (req: Request, res: Response) => {
    const baseUrl = getPublicBaseUrl(req);
    const webVoiceUrl = `${baseUrl}/voice-realtime`;
    const appVoiceUrl = "jarvis://voice-realtime";
    const androidIntentUrl =
      `intent://voice-realtime#Intent;scheme=jarvis;package=com.gameplan;` +
      `S.browser_fallback_url=${encodeURIComponent(webVoiceUrl)};end`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening Jarvis Voice Call…</title>
  <style>
    body { margin: 0; display: flex; flex-direction: column; align-items: center;
           justify-content: center; min-height: 100vh; font-family: system-ui, sans-serif;
           background: #0F0F0F; color: #e5e5e5; text-align: center; padding: 1rem; }
    .actions { display: grid; gap: 0.75rem; width: min(100%, 320px); margin-top: 1rem; }
    a { color: inherit; }
    .button { display: block; padding: 0.85rem 1rem; border-radius: 10px; text-decoration: none;
              background: #6366F1; color: white; font-weight: 700; }
    .secondary { background: #1f2937; }
    .note { color: #a3a3a3; font-size: 0.92rem; max-width: 380px; line-height: 1.4; }
  </style>
</head>
<body>
  <h1>Jarvis voice call</h1>
  <p class="note">Open the Jarvis app for the best voice session, or continue in the browser.</p>
  <div class="actions">
    <a id="open-app" class="button" href="${appVoiceUrl}">Open Jarvis app</a>
    <a class="button secondary" href="${webVoiceUrl}">Continue in browser</a>
  </div>
  <script>
    const appLink = document.getElementById('open-app');
    const androidIntentUrl = ${JSON.stringify(androidIntentUrl)};
    if (/Android/i.test(navigator.userAgent)) {
      appLink.setAttribute('href', androidIntentUrl);
    }
  </script>
</body>
</html>`);
  });
}
