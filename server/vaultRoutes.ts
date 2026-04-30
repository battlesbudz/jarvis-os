import type { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { authMiddleware } from "./auth";
import { generateVaultPages, isVaultStale } from "./memory/vaultWriter";

export function registerVaultRoutes(app: Express): void {
  app.get("/api/vault/pages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const pages = await db
        .select({
          id: schema.knowledgeVaultPages.id,
          slug: schema.knowledgeVaultPages.slug,
          title: schema.knowledgeVaultPages.title,
          content: schema.knowledgeVaultPages.content,
          generatedAt: schema.knowledgeVaultPages.generatedAt,
          updatedAt: schema.knowledgeVaultPages.updatedAt,
        })
        .from(schema.knowledgeVaultPages)
        .where(eq(schema.knowledgeVaultPages.userId, userId))
        .orderBy(asc(schema.knowledgeVaultPages.slug));
      res.json(pages);
    } catch (err) {
      console.error("[Vault] GET /api/vault/pages failed:", err);
      res.status(500).json({ error: "Failed to fetch vault pages" });
    }
  });

  app.get("/api/vault/pages/:slug", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { slug } = req.params;
      const rows = await db
        .select()
        .from(schema.knowledgeVaultPages)
        .where(
          and(
            eq(schema.knowledgeVaultPages.userId, userId),
            eq(schema.knowledgeVaultPages.slug, slug),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        return res.status(404).json({ error: "Page not found" });
      }
      res.json(rows[0]);
    } catch (err) {
      console.error("[Vault] GET /api/vault/pages/:slug failed:", err);
      res.status(500).json({ error: "Failed to fetch vault page" });
    }
  });

  app.post("/api/vault/regenerate", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      generateVaultPages(userId).catch((err) =>
        console.error("[Vault] Background regeneration failed:", err),
      );
      res.json({ status: "regenerating" });
    } catch (err) {
      console.error("[Vault] POST /api/vault/regenerate failed:", err);
      res.status(500).json({ error: "Failed to trigger regeneration" });
    }
  });

  app.get("/api/vault/stale", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const stale = await isVaultStale(userId);
      res.json({ stale });
    } catch (err) {
      console.error("[Vault] GET /api/vault/stale failed:", err);
      res.status(500).json({ error: "Failed to check staleness" });
    }
  });
}
