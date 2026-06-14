import type { Express, Request, Response } from "express";

type AdminSecretGuard = (req: Request, res: Response) => boolean;

export function registerAdminHealthRoutes(app: Express, requireAdminSecret: AdminSecretGuard): void {
  app.get("/api/admin/provider-health", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { runProviderHealthChecks } = await import("../agent/providers/healthCheck");
      const report = await runProviderHealthChecks();
      res.status(report.allOk ? 200 : 503).json(report);
    } catch (err) {
      console.error("[Admin/ProviderHealth] check threw:", err);
      res.status(500).json({ error: "Failed to run provider health checks" });
    }
  });

  app.get("/api/admin/audio-transcription-stats", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { getAudioTranscriptTelemetry } = await import("../lib/transcriptCache");
      res.json(getAudioTranscriptTelemetry());
    } catch (err) {
      console.error("[Admin/AudioStats] failed:", err);
      res.status(500).json({ error: "Failed to retrieve audio transcription telemetry" });
    }
  });
}
