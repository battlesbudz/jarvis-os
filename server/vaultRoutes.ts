import type { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, asc, isNull } from "drizzle-orm";
import * as schema from "@shared/schema";
import { authMiddleware } from "./auth";
import { generateVaultPages, isVaultStale, lintWiki } from "./memory/vaultWriter";

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
          pageType: schema.knowledgeVaultPages.pageType,
          tags: schema.knowledgeVaultPages.tags,
          crossRefs: schema.knowledgeVaultPages.crossRefs,
          generatedAt: schema.knowledgeVaultPages.generatedAt,
          updatedAt: schema.knowledgeVaultPages.updatedAt,
        })
        .from(schema.knowledgeVaultPages)
        .where(
          and(
            eq(schema.knowledgeVaultPages.userId, userId),
            isNull(schema.knowledgeVaultPages.archivedAt),
          ),
        )
        .orderBy(asc(schema.knowledgeVaultPages.slug));
      res.json(pages);
    } catch (err) {
      console.error("[Vault] GET /api/vault/pages failed:", err);
      res.status(500).json({ error: "Failed to fetch vault pages" });
    }
  });

  app.get("/api/vault/page", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const slug = (req.query.slug as string) || "";
      const rows = await db
        .select()
        .from(schema.knowledgeVaultPages)
        .where(
          and(
            eq(schema.knowledgeVaultPages.userId, userId),
            eq(schema.knowledgeVaultPages.slug, slug),
            isNull(schema.knowledgeVaultPages.archivedAt),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        return res.status(404).json({ error: "Page not found" });
      }

      // Touch lastAccessedAt so the lint job can track real access activity
      db.update(schema.knowledgeVaultPages)
        .set({ lastAccessedAt: new Date() })
        .where(
          and(
            eq(schema.knowledgeVaultPages.userId, userId),
            eq(schema.knowledgeVaultPages.slug, slug),
          ),
        )
        .catch(() => {});

      // Compute backlinks (pages that cross-reference this slug)
      const allPages = await db
        .select({ slug: schema.knowledgeVaultPages.slug, crossRefs: schema.knowledgeVaultPages.crossRefs })
        .from(schema.knowledgeVaultPages)
        .where(
          and(
            eq(schema.knowledgeVaultPages.userId, userId),
            isNull(schema.knowledgeVaultPages.archivedAt),
          ),
        );

      const backlinks = allPages
        .filter((p) => {
          const refs = Array.isArray(p.crossRefs) ? (p.crossRefs as string[]) : [];
          return p.slug !== slug && refs.includes(slug);
        })
        .map((p) => p.slug);

      res.json({ ...rows[0], backlinks });
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

  app.post("/api/vault/lint", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      lintWiki(userId).catch((err) =>
        console.error("[Vault] Background lint failed:", err),
      );
      res.json({ status: "linting" });
    } catch (err) {
      console.error("[Vault] POST /api/vault/lint failed:", err);
      res.status(500).json({ error: "Failed to trigger lint" });
    }
  });
}
