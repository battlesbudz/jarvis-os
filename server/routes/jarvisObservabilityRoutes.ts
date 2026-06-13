import type { Express, Request, Response } from "express";
import { getModelRouteChain, type ModelExecutionTier } from "../agent/modelRouter";
import { getModelUsageSummary } from "../agent/modelUsage";

export function registerJarvisObservabilityRoutes(app: Express): void {
  app.get("/api/jarvis/model-usage", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const rawDays = Number(req.query.days ?? 7);
      const days = Number.isFinite(rawDays) ? Math.floor(rawDays) : 7;
      const usage = await getModelUsageSummary(userId, days);
      res.json(usage);
    } catch (err) {
      console.error("Error fetching model usage:", err);
      res.status(500).json({ error: "Failed to fetch model usage" });
    }
  });

  app.get("/api/jarvis/provider-health", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { runProviderHealthChecks } = await import("../agent/providers/healthCheck");
      const report = await runProviderHealthChecks();
      const tiers: ModelExecutionTier[] = ["cheap", "balanced", "smart"];
      const routeChains = Object.fromEntries(
        tiers.map((tier) => [
          tier,
          getModelRouteChain(tier).map((entry) => ({
            provider: entry.providerName,
            model: entry.model,
          })),
        ]),
      );

      res.status(report.allOk ? 200 : 207).json({
        ...report,
        routeChains,
        codexGateway: {
          enabled: process.env.JARVIS_CODEX_OAUTH_ENABLED === "true" || !!process.env.JARVIS_CODEX_GATEWAY_URL,
          gatewayUrlConfigured: !!process.env.JARVIS_CODEX_GATEWAY_URL,
          gatewayTokenConfigured: !!process.env.JARVIS_CODEX_GATEWAY_TOKEN,
          localCommandConfigured: !!(process.env.JARVIS_CODEX_COMMAND || process.env.CODEX_COMMAND),
        },
      });
    } catch (err) {
      console.error("Error fetching provider health:", err);
      res.status(500).json({ error: "Failed to fetch provider health" });
    }
  });
}
