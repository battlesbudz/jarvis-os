import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { userDocuments } from "@shared/schema";
import { db } from "../db";
import { MAX_DOCS_PER_USER, processDocument, SUPPORTED_EXTENSIONS, SUPPORTED_MIME_TYPES } from "../documentProcessor";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerDocumentRoutes(app: Express): void {
  app.get("/api/documents", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const docs = await db
        .select({
          id: userDocuments.id,
          name: userDocuments.name,
          mimeType: userDocuments.mimeType,
          sizeBytes: userDocuments.sizeBytes,
          status: userDocuments.status,
          summary: userDocuments.summary,
          uploadedAt: userDocuments.uploadedAt,
        })
        .from(userDocuments)
        .where(eq(userDocuments.userId, userId))
        .orderBy(desc(userDocuments.uploadedAt))
        .limit(MAX_DOCS_PER_USER);
      res.json({ documents: docs });
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/documents", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { name, mimeType, data } = req.body;
      if (!name || !mimeType || !data) {
        return res.status(400).json({ error: "name, mimeType, and data are required" });
      }

      if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ error: `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}` });
      }

      const existing = await db
        .select({ id: userDocuments.id })
        .from(userDocuments)
        .where(eq(userDocuments.userId, userId));
      if (existing.length >= MAX_DOCS_PER_USER) {
        return res.status(400).json({ error: `Maximum ${MAX_DOCS_PER_USER} documents allowed. Delete some to upload more.` });
      }

      const buffer = Buffer.from(data, "base64");
      const sizeBytes = buffer.length;

      if (sizeBytes > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "File too large. Maximum size is 20MB." });
      }

      const [inserted] = await db
        .insert(userDocuments)
        .values({ userId, name, mimeType, sizeBytes, status: "processing" })
        .returning();

      res.json({ document: inserted });

      processDocument(userId, inserted.id, name, mimeType, buffer).catch((err) => {
        console.error("[Docs] Background processing error:", err);
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });

  app.delete("/api/documents/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      await db
        .delete(userDocuments)
        .where(and(eq(userDocuments.id, id), eq(userDocuments.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

}