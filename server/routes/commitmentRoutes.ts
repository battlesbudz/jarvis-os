import type { Express, Request, Response } from "express";
import type OpenAI from "openai";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import {
  CommitmentDedupeConflictError,
  createOrMergeCommitmentInDb,
  listPendingCommitmentsForReview,
  listPendingPersonalCommitments,
  personalCommitmentCondition,
  updateCommitmentInDb,
} from "../commitments/dbCommitmentRepository";
import {
  parseCommitmentKind,
  parseCommitmentSignalLevel,
} from "../commitments/commitmentStore";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

function parseCommitmentStatus(value: unknown): "done" | "skipped" | "pending" | null {
  if (value === "done" || value === "skipped" || value === "pending") return value;
  return null;
}

export function registerCommitmentRoutes(app: Express, openai: OpenAI): void {
  app.get("/api/commitments", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = String(req.query.scope ?? "") === "all"
        ? await listPendingCommitmentsForReview(userId)
        : await listPendingPersonalCommitments(userId);
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
      const status = parseCommitmentStatus(req.body?.status);
      const commitmentKind = parseCommitmentKind(req.body?.commitmentKind);
      const signalLevel = parseCommitmentSignalLevel(req.body?.signalLevel);
      const classificationRequested = req.body?.commitmentKind !== undefined || req.body?.signalLevel !== undefined;
      if (req.body?.status !== undefined && !status) {
        return res.status(400).json({ error: "status must be 'done', 'skipped', or 'pending'" });
      }
      if (classificationRequested && (!commitmentKind || !signalLevel)) {
        return res.status(400).json({
          error: "commitmentKind and signalLevel must both be valid when reclassifying",
        });
      }
      if (!status && !classificationRequested) {
        return res.status(400).json({ error: "status or commitment classification is required" });
      }
      const includeNonPersonal = String(req.query.scope ?? "") === "all";
      const updated = await updateCommitmentInDb({
        userId,
        id,
        status: status ?? undefined,
        commitmentKind: commitmentKind ?? undefined,
        signalLevel: signalLevel ?? undefined,
        includeNonPersonal,
      });
      if (!updated) return res.status(404).json({ error: "Commitment not found" });
      res.json({ ok: true, commitment: updated });
    } catch (error) {
      if (error instanceof CommitmentDedupeConflictError) {
        return res.status(409).json({
          error: error.message,
          conflictingCommitmentId: error.conflictingCommitmentId,
        });
      }
      console.error("Error updating commitment:", error);
      res.status(500).json({ error: "Failed to update commitment" });
    }
  });

  app.delete("/api/commitments/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const includeNonPersonal = String(req.query.scope ?? "") === "all";
      const deleted = await db
        .delete(schema.commitments)
        .where(and(
          eq(schema.commitments.id, id),
          includeNonPersonal ? eq(schema.commitments.userId, userId) : personalCommitmentCondition(userId),
        ))
        .returning({ id: schema.commitments.id });
      if (deleted.length === 0) return res.status(404).json({ error: "Commitment not found" });
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

Return ONLY JSON: { "hasCommitment": boolean, "commitment": "the thing they committed to" or null, "dueDate": "YYYY-MM-DD" or null, "dedupeKey": "a short stable topic key that would stay the same if this commitment is reworded" or null }`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 200,
      });

      const content = response.choices[0]?.message?.content || '{"hasCommitment":false}';
      const parsed = JSON.parse(content);

      if (parsed.hasCommitment && parsed.commitment) {
        const result = await createOrMergeCommitmentInDb({
          userId,
          content: String(parsed.commitment),
          dueDate: parsed.dueDate || null,
          dedupeKey: typeof parsed.dedupeKey === "string" ? parsed.dedupeKey : null,
          commitmentKind: "user_commitment",
          signalLevel: "normal",
          sourceType: "message_extract",
          sourceMessage: message,
        });
        res.json({
          hasCommitment: true,
          commitment: result.commitment.content,
          dueDate: result.commitment.dueDate,
          action: result.action,
        });
      } else {
        res.json({ hasCommitment: false });
      }
    } catch (error) {
      console.error("Error extracting commitment:", error);
      res.json({ hasCommitment: false });
    }
  });
}
