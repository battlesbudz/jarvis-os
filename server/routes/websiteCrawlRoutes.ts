import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

export function registerWebsiteCrawlRoutes(app: Express): void {
  app.post("/api/website-crawl", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { url } = req.body;
      if (!url || typeof url !== "string") return res.status(400).json({ error: "url is required" });
      let normalized = url.trim();
      if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
        normalized = "https://" + normalized;
      }
      const { startWebsiteCrawl } = await import("../websiteCrawler");
      const crawledAt = new Date();
      await db
        .insert(schema.websiteCrawls)
        .values({ userId, url: normalized, status: "crawling", pageCount: 0, summary: null, crawledAt })
        .onConflictDoUpdate({
          target: schema.websiteCrawls.userId,
          set: { url: normalized, status: "crawling", pageCount: 0, summary: null, crawledAt },
        });
      startWebsiteCrawl(userId, normalized).catch((err) => console.error("[website-crawl] background error:", err));
      res.json({ status: "crawling", url: normalized, pageCount: 0, summary: null, crawledAt });
    } catch (error) {
      console.error("Error starting website crawl:", error);
      res.status(500).json({ error: "Failed to start crawl" });
    }
  });

  app.get("/api/website-crawl", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(schema.websiteCrawls).where(eq(schema.websiteCrawls.userId, userId)).limit(1);
      if (rows.length === 0) return res.json({ status: "idle" });
      const row = rows[0];
      res.json({
        status: row.status,
        url: row.url,
        pageCount: row.pageCount,
        summary: row.summary,
        crawledAt: row.crawledAt,
      });
    } catch (error) {
      console.error("Error fetching website crawl:", error);
      res.status(500).json({ error: "Failed to fetch crawl status" });
    }
  });

  app.delete("/api/website-crawl", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await db.delete(schema.websiteCrawls).where(eq(schema.websiteCrawls.userId, userId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting website crawl:", error);
      res.status(500).json({ error: "Failed to delete crawl" });
    }
  });
}
