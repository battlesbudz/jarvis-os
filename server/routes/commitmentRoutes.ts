import type { Express, Request, Response } from "express";
import type OpenAI from "openai";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerCommitmentRoutes(app: Express, openai: OpenAI): void {
  app.get("/api/commitments", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db
        .select()
        .from(schema.commitments)
        .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, "pending")))
        .orderBy(desc(schema.commitments.extractedAt));
      res.json({ commitments: rows });
    } catch (error) {
      console.error("Error fetching commitments:", error);
      res.status(500).json({ error: "Failed to fetch commitments" });
    }
  });

  app.put("/api/commitments/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const { status } = req.body;
      if (!status || !["done", "skipped", "pending"].includes(status)) {
        return res.status(400).json({ error: "status must be 'done', 'skipped', or 'pending'" });
      }
      await db
        .update(schema.commitments)
        .set({ status, resolvedAt: status !== "pending" ? new Date() : null })
        .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error updating commitment:", error);
      res.status(500).json({ error: "Failed to update commitment" });
    }
  });

  app.delete("/api/commitments/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      await db
        .delete(schema.commitments)
        .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting commitment:", error);
      res.status(500).json({ error: "Failed to delete commitment" });
    }
  });

  app.post("/api/commitments/extract", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.json({ hasCommitment: false });
      }

      const prompt = `Did this message from the user contain any explicit commitment ('I will', 'I'll', 'by tomorrow', 'I need to', 'I'm going to', 'I promise', 'I plan to', 'I'm committing to')? If yes, extract the commitment. Today's date is ${new Date().toISOString().split("T")[0]}.

User message: "${message}"

Return ONLY JSON: { "hasCommitment": boolean, "commitment": "the thing they committed to" or null, "dueDate": "YYYY-MM-DD" or null }`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 200,
      });

      const content = response.choices[0]?.message?.content || '{"hasCommitment":false}';
      const parsed = JSON.parse(content);

      if (parsed.hasCommitment && parsed.commitment) {
        await db.insert(schema.commitments).values({
          userId,
          content: parsed.commitment,
          dueDate: parsed.dueDate || null,
          sourceMessage: message,
        });
        res.json({ hasCommitment: true, commitment: parsed.commitment, dueDate: parsed.dueDate || null });
      } else {
        res.json({ hasCommitment: false });
      }
    } catch (error) {
      console.error("Error extracting commitment:", error);
      res.json({ hasCommitment: false });
    }
  });
}
