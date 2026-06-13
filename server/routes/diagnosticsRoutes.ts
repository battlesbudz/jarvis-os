import type { Express, Request, Response } from "express";
import * as schema from "@shared/schema";
import type { DiagnosticSubsystem } from "@shared/schema";

export function registerDiagnosticsRoutes(app: Express): void {
  app.get("/api/diagnostics/health", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { runHealthCheck } = await import("../diagnostics/diagnosticsService");
      const report = await runHealthCheck(userId);
      res.json(report);
    } catch (err) {
      console.error("[Diagnostics] GET /api/diagnostics/health failed:", err);
      res.status(500).json({ error: "Failed to run health check" });
    }
  });

  app.post("/api/diagnostics/run", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { runAIDiagnosis } = await import("../diagnostics/diagnosticsService");
      const { diagnosis, report } = await runAIDiagnosis(userId);
      res.json({ diagnosis, report });
    } catch (err) {
      console.error("[Diagnostics] POST /api/diagnostics/run failed:", err);
      res.status(500).json({ error: "Failed to run diagnosis" });
    }
  });

  app.get("/api/diagnostics/memory-events", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { getRecentEvents } = await import("../diagnostics/diagnosticsService");
      const events = await getRecentEvents({
        userId,
        subsystem: "memory",
        limit: 20,
        sinceMinutes: 60,
        excludePatternDetected: true,
      });
      res.json(events);
    } catch (err) {
      console.error("[Diagnostics] GET /api/diagnostics/memory-events failed:", err);
      res.status(500).json({ error: "Failed to fetch memory events" });
    }
  });

  app.get("/api/diagnostics/events", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const subsystem = typeof req.query.subsystem === "string" ? req.query.subsystem : undefined;
    if (!subsystem) return res.status(400).json({ error: "subsystem query param required" });
    const validSubsystems: readonly string[] = schema.DIAGNOSTIC_SUBSYSTEMS;
    if (!validSubsystems.includes(subsystem)) {
      return res.status(400).json({ error: `Invalid subsystem. Must be one of: ${schema.DIAGNOSTIC_SUBSYSTEMS.join(", ")}` });
    }
    try {
      const { getRecentEvents } = await import("../diagnostics/diagnosticsService");
      const events = await getRecentEvents({
        userId,
        subsystem: subsystem as DiagnosticSubsystem,
        limit: 20,
        sinceMinutes: 60,
        excludePatternDetected: true,
      });
      res.json(events);
    } catch (err) {
      console.error("[Diagnostics] GET /api/diagnostics/events failed:", err);
      res.status(500).json({ error: "Failed to fetch subsystem events" });
    }
  });
}
