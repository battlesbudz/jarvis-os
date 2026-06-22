import type { Express, Request, Response } from "express";

import { registerSubscriber, removeSubscriberIfCurrent } from "../webchatSSE";

export function registerWebchatEventsRoutes(app: Express): void {
  app.get("/api/webchat/events", (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(": connected\n\n");

    const token = registerSubscriber(userId, res);

    req.on("close", () => {
      removeSubscriberIfCurrent(userId, token);
    });
  });
}
