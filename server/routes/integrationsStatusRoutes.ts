import type { Express, Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { integrationStatus } from "@shared/schema";
import { db } from "../db";

const KNOWN_INTEGRATIONS = [
  "google",
  "outlook",
  "telegram",
  "discord",
  "slack",
  "whatsapp",
] as const;

const HEALTHY_STATUSES = new Set(["healthy", "expiring_soon", "degraded"]);

function hasServerCredential(integration: string, linkedIntegrations: Set<string>): boolean {
  switch (integration) {
    case "google":
      return Boolean((process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID) && process.env.GOOGLE_CLIENT_SECRET);
    case "outlook":
      return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
    case "telegram":
      return Boolean(process.env.TELEGRAM_BOT_TOKEN);
    case "discord":
      return Boolean(process.env.DISCORD_BOT_TOKEN);
    case "slack":
      return Boolean(process.env.SLACK_BOT_TOKEN) || linkedIntegrations.has("slack");
    case "whatsapp":
      return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    default:
      return false;
  }
}

export function registerIntegrationsStatusRoutes(app: Express): void {
  app.get("/api/integrations/status", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const rows = await db
        .select()
        .from(integrationStatus)
        .where(eq(integrationStatus.userId, userId));
      const linkedRaw = await db.execute(sql`
        SELECT DISTINCT integration FROM (
          SELECT 'telegram' AS integration FROM telegram_links WHERE user_id = ${userId}
          UNION ALL
          SELECT channel AS integration FROM channel_links WHERE user_id = ${userId}
            AND channel IN ('discord', 'slack', 'whatsapp')
          UNION ALL
          SELECT CASE WHEN provider = 'microsoft' THEN 'outlook' ELSE provider END AS integration
          FROM user_oauth_tokens
          WHERE user_id = ${userId}
            AND provider IN ('google', 'microsoft', 'slack')
        ) linked
      `);
      const linkedRows = ((linkedRaw as any).rows ?? (Array.isArray(linkedRaw) ? linkedRaw : [])) as Array<{ integration: string }>;
      const linkedIntegrations = new Set(linkedRows.map((row) => row.integration));

      const now = new Date().toISOString();
      const decorateStatus = (integration: string, base: {
        status: string;
        errorMessage: string | null;
        expiresAt: string | null;
        lastCheckedAt: string;
      }) => {
        const accountLinked = linkedIntegrations.has(integration) || base.status !== "unconfigured";
        const serverConfigured = hasServerCredential(integration, linkedIntegrations);
        const capabilityRunnable = HEALTHY_STATUSES.has(base.status);
        const blockedReason = capabilityRunnable
          ? null
          : base.errorMessage
            ?? (!accountLinked ? "Account is not linked" : null)
            ?? (!serverConfigured ? "Server credential is missing" : "Capability is not runnable");
        return {
          ...base,
          accountLinked,
          serverConfigured,
          capabilityRunnable,
          blockedReason,
          readiness: capabilityRunnable ? "runnable" : accountLinked ? "linked_blocked" : "not_linked",
        };
      };
      const result: Record<string, {
        status: string;
        errorMessage: string | null;
        expiresAt: string | null;
        lastCheckedAt: string;
        accountLinked: boolean;
        serverConfigured: boolean;
        capabilityRunnable: boolean;
        blockedReason: string | null;
        readiness: string;
      }> = {};
      for (const key of KNOWN_INTEGRATIONS) {
        result[key] = decorateStatus(key, { status: "unconfigured", errorMessage: null, expiresAt: null, lastCheckedAt: now });
      }
      for (const row of rows) {
        result[row.integration] = decorateStatus(row.integration, {
          status: row.status,
          errorMessage: row.errorMessage ?? null,
          expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
          lastCheckedAt: row.lastCheckedAt.toISOString(),
        });
      }
      res.json(result);
    } catch (err) {
      console.error("[Integrations] GET /api/integrations/status failed:", err);
      res.status(500).json({ error: "Failed to fetch integration statuses" });
    }
  });

  app.post("/api/integrations/refresh", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { validateUserIntegrations } = await import("../intelligence/integrationValidator");
      await validateUserIntegrations(userId);
      res.json({ ok: true });
    } catch (err) {
      console.error("[Integrations] POST /api/integrations/refresh failed:", err);
      res.status(500).json({ error: "Failed to refresh integration statuses" });
    }
  });
}
