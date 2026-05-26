import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";

import { db } from "../db";

type AdminSecretGuard = (req: Request, res: Response) => boolean;

export function registerAdminSearchRegistryRoutes(app: Express, requireAdminSecret: AdminSecretGuard): void {
  app.get("/api/admin/search-bar-registry", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { learnedResourceIds } = await import("../agent/tools/daemonShellTool");
      const minConfidence = Math.max(1, parseInt((req.query.minConfidence as string) ?? "1", 10) || 1);

      const rows = await db.execute(sql`
        SELECT
          app_package,
          discovered_resource_id,
          COUNT(DISTINCT user_id)::int AS user_count,
          MAX(updated_at)             AS last_seen
        FROM search_bar_locations
        WHERE discovered_resource_id IS NOT NULL
        GROUP BY app_package, discovered_resource_id
        HAVING COUNT(DISTINCT user_id) >= ${minConfidence}
        ORDER BY user_count DESC, last_seen DESC
      `);

      type RegistryRow = {
        app_package: string;
        discovered_resource_id: string;
        user_count: number;
        last_seen: string;
      };

      const entries = (rows.rows as RegistryRow[]).map((r) => ({
        appPackage: r.app_package,
        discoveredResourceId: r.discovered_resource_id,
        userCount: r.user_count,
        lastSeen: r.last_seen,
        inMemory: learnedResourceIds.get(r.app_package) === r.discovered_resource_id,
        promotionHint: `APP_SEARCH_HINTS["${r.app_package}"] = { resourceIds: ["${r.discovered_resource_id}"], extraKeywords: [] }`,
      }));

      res.json({
        total: entries.length,
        minConfidence,
        entries,
      });
    } catch (err) {
      console.error("[Admin/SearchBarRegistry] query failed:", err);
      res.status(500).json({ error: "Failed to fetch search-bar registry" });
    }
  });
}
