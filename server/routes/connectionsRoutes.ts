import type { Express, Request, Response } from "express";
import {
  buildComposioConnectIntent,
  disconnectComposioAccount,
  getComposioCallbackUrl,
  getComposioStatus,
  handleComposioCallback,
  isComposioConnectionPlatform,
  testComposioConnection,
} from "../connectors/composio/connectionCenter";

export function registerConnectionsRoutes(app: Express): void {
  app.get("/api/connections/status", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    res.json(await getComposioStatus(userId));
  });

  app.post("/api/connections/connect-link", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const platform = String(req.body?.platform || req.body?.appId || req.body?.app || "").trim().toLowerCase();
    if (!isComposioConnectionPlatform(platform)) {
      return res.status(400).json({
        error: "unsupported_platform",
        message: "Choose Gmail, Google Calendar, Outlook, Slack, Google Drive, or Google Tasks.",
      });
    }

    try {
      const callbackUrl = getComposioCallbackUrl(req, { userId, toolkit: platform });
      const intent = await buildComposioConnectIntent(userId, platform, callbackUrl);
      res.json({
        ...intent,
        url: intent.redirectUrl,
        connectUrl: intent.redirectUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "composio_connect_link_failed", message });
    }
  });

  app.post("/api/connections/test", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const platform = String(req.body?.platform || req.body?.appId || req.body?.app || "gmail").trim().toLowerCase();
    if (!isComposioConnectionPlatform(platform)) {
      return res.status(400).json({ error: "unsupported_platform" });
    }
    res.json(await testComposioConnection(userId, platform));
  });

  app.post("/api/connections/disconnect", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const platform = String(req.body?.platform || req.body?.appId || req.body?.app || "").trim().toLowerCase();
    if (!isComposioConnectionPlatform(platform)) {
      return res.status(400).json({ error: "unsupported_platform" });
    }
    try {
      const result = await disconnectComposioAccount(userId, platform);
      res.status(result.ok ? 200 : 404).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "composio_disconnect_failed", message });
    }
  });
}

export function registerPublicConnectionsCallbackRoutes(app: Express): void {
  async function callback(req: Request, res: Response) {
    const payload = { ...req.query, ...(req.body && typeof req.body === "object" ? req.body : {}) };
    const result = await handleComposioCallback({
      state: payload.state,
      status: payload.status,
      connected_account_id: payload.connected_account_id,
      connectedAccountId: payload.connectedAccountId,
    });
    const ok = result.ok;
    const title = ok ? "Connected" : "Connection needs attention";
    const failed = ["FAILED", "ERROR", "DENIED", "CANCELED", "CANCELLED"].includes(String(result.status || "").toUpperCase());
    const detail = ok
      ? "That account is connected. You can return to Jarvis and refresh Connections."
      : failed
        ? "Composio reported that the account connection failed. Return to Jarvis and try again."
        : "The account was not connected. Return to Jarvis and try again.";
    if (req.method === "POST") {
      res.status(ok ? 200 : 400).json(result);
      return;
    }
    res.type("html").send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Jarvis Connections</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0f14; color: #f6f7f9; }
      main { width: min(92vw, 560px); padding: 32px; border: 1px solid #263241; border-radius: 8px; background: #111821; }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { line-height: 1.5; color: #c9d1db; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${detail}</p>
    </main>
  </body>
</html>`);
  }

  app.get("/api/connections/callback", callback);
  app.post("/api/connections/callback", callback);
}
