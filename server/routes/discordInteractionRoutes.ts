import type { Express, Request, Response } from "express";

export function registerDiscordInteractionRoutes(app: Express) {
  app.post("/api/discord/interactions", async (req: Request, res: Response) => {
    try {
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (!publicKey) {
        console.warn("[DiscordInteractions] DISCORD_PUBLIC_KEY not set — rejecting request");
        return res.status(401).json({ error: "Interactions endpoint not configured" });
      }

      const signature = req.headers["x-signature-ed25519"] as string | undefined;
      const timestamp = req.headers["x-signature-timestamp"] as string | undefined;

      if (!signature || !timestamp) {
        return res.status(401).json({ error: "Missing Discord signature headers" });
      }

      const rawBody: Buffer = (req as any).rawBody;
      if (!rawBody) {
        return res.status(400).json({ error: "Missing raw body" });
      }

      const tsSeconds = parseInt(timestamp, 10);
      if (isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
        return res.status(401).json({ error: "Request timestamp out of range" });
      }

      const { verifyDiscordSignature, handleInteraction } = await import("../discord/slashCommands");
      const valid = verifyDiscordSignature(publicKey, signature, timestamp, rawBody);
      if (!valid) {
        return res.status(401).json({ error: "Invalid request signature" });
      }

      const interaction = req.body;
      const response = await handleInteraction(interaction);
      return res.json(response);
    } catch (err) {
      console.error("[DiscordInteractions] Unhandled error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}
