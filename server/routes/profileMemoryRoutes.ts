import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { and, desc, eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { morningVoiceNotes, userMemories, userPreferences } from "@shared/schema";
import { db } from "../db";
import { getOpenAIClientConfig } from "../agent/providers/env";
import { extractAndStore } from "../memory/extractor";
import { getSoul, regenerateSoul, setManualOverride, setSoulContent } from "../memory/soul";
import { markSoulStale } from "../memory/soul";
import { deletePerson, listPeople } from "../memory/people";
import { processLivingContextUpdate } from "../workspace/livingContextRouter";

const openai = new OpenAI(getOpenAIClientConfig());
const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;
const morningNoteSummaryCache = new Map<string, { summary: string; date: string }>();

async function applyLivingContextReviewToFile(relPath: string | null | undefined, oldBlock: string | null | undefined, newBlock?: string | null): Promise<void> {
  if (!relPath || !oldBlock) return;
  if (path.isAbsolute(relPath) || relPath.includes("..")) return;
  const rootDir = process.cwd();
  const abs = path.resolve(rootDir, relPath);
  const allowedRoot = path.resolve(rootDir, "workspaces", "battles");
  if (!(abs === allowedRoot || abs.startsWith(allowedRoot + path.sep))) return;
  if (path.extname(abs).toLowerCase() !== ".md") return;

  try {
    let content = await fs.promises.readFile(abs, "utf-8");
    const replacement = newBlock ? ${newBlock}\n : "";
    if (content.includes(oldBlock)) {
      content = content.replace(oldBlock, replacement).replace(/\n{4,}/g, "\n\n\n");
      await fs.promises.writeFile(abs, content, "utf-8");
    } else if (newBlock && !content.includes(newBlock)) {
      await fs.promises.appendFile(abs, \n\n, "utf-8");
    }
  } catch {
    // The database row is the durable source of truth; runtime file sync is best effort.
  }
}

async function getUserLocalDate(userId: string): Promise<string> {
  try {
    const prefs = await db.select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const tz = (prefs[0]?.data as Record<string, string>)?.timezone || 'America/New_York';
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function registerProfileMemoryRoutes(app: Express): void {
  app.get("/api/memories", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select()
        .from(userMemories)
        .where(eq(userMemories.userId, userId))
        .orderBy(desc(userMemories.extractedAt));
      res.json({ memories: rows });
    } catch (error) {
      console.error("Error fetching memories:", error);
      res.status(500).json({ error: "Failed to fetch memories" });
    }
  });

  app.get("/api/memory/pending-review", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.execute<{
        id: string; content: string; category: string; memory_type: string;
        tier: string; confidence: number; extracted_at: string;
      }>(sql`
        SELECT id, content, category, memory_type, tier, confidence, extracted_at
        FROM user_memories
        WHERE user_id = ${userId}
          AND pending_review = TRUE
          AND review_status = 'pending'
        ORDER BY extracted_at DESC
        LIMIT 50
      `);
      res.json({ memories: rows.rows ?? [] });
    } catch (error) {
      console.error("Error fetching pending-review memories:", error);
      res.status(500).json({ error: "Failed to fetch pending memories" });
    }
  });

  app.patch("/api/memory/:id/review", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const { action, updatedContent } = req.body as { action: "keep" | "edit" | "discard"; updatedContent?: string };
      if (!["keep", "edit", "discard"].includes(action)) {
        return res.status(400).json({ error: "action must be keep, edit, or discard" });
      }
      if (action === "discard") {
        // Soft-delete: mark as discarded so the audit trail is preserved.
        // pending_review stays TRUE for the discard case to indicate this was reviewed but rejected.
        const result = await db.execute(sql`
          UPDATE user_memories
          SET review_status = 'discarded'
          WHERE id = ${id} AND user_id = ${userId} AND pending_review = TRUE AND review_status = 'pending'
          RETURNING id
        `);
        if ((result.rows ?? []).length === 0) return res.status(404).json({ error: "Memory not found" });
        return res.json({ ok: true });
      }
      if (action === "edit") {
        if (!updatedContent || typeof updatedContent !== "string" || !updatedContent.trim()) {
          return res.status(400).json({ error: "updatedContent is required for edit action" });
        }
        const result = await db.execute(sql`
          UPDATE user_memories
          SET content = ${updatedContent.trim()}, pending_review = FALSE, review_status = 'edited'
          WHERE id = ${id} AND user_id = ${userId} AND pending_review = TRUE
          RETURNING id
        `);
        if ((result.rows ?? []).length === 0) return res.status(404).json({ error: "Memory not found" });
        markSoulStale(userId).catch(() => {});
        return res.json({ ok: true });
      }
      // action === "keep"
      const result = await db.execute(sql`
        UPDATE user_memories
        SET pending_review = FALSE, review_status = 'kept'
        WHERE id = ${id} AND user_id = ${userId} AND pending_review = TRUE
        RETURNING id
      `);
      if ((result.rows ?? []).length === 0) return res.status(404).json({ error: "Memory not found" });
      markSoulStale(userId).catch(() => {});
      return res.json({ ok: true });
    } catch (error) {
      console.error("Error reviewing memory:", error);
      res.status(500).json({ error: "Failed to review memory" });
    }
  });

  app.patch("/api/memories/pending/approve-all", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const result = await db.execute(sql`
        UPDATE user_memories
        SET pending_review = FALSE, review_status = 'kept'
        WHERE user_id = ${userId}
          AND pending_review = TRUE
          AND review_status = 'pending'
        RETURNING id
      `);
      const count = (result.rows ?? []).length;
      if (count > 0) {
        markSoulStale(userId).catch(() => {});
      }
      res.json({ ok: true, approved: count });
    } catch (error) {
      console.error("Error bulk-approving pending memories:", error);
      res.status(500).json({ error: "Failed to approve pending memories" });
    }
  });

  app.get("/api/living-context/pending-review", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.execute<{
        id: string;
        target: string;
        path: string;
        topic: string;
        learned: string;
        source_type: string;
        source_ref: string | null;
        confidence: number;
        status: string;
        fills_question: string | null;
        approval_sensitive: boolean;
        created_at: string;
      }>(sql`
        SELECT id, target, path, topic, learned, source_type, source_ref, confidence,
               status, fills_question, approval_sensitive, created_at
        FROM living_context_updates
        WHERE user_id = ${userId}
          AND status = 'needs_review'
        ORDER BY created_at DESC
        LIMIT 50
      `);
      res.json({ updates: rows.rows ?? [] });
    } catch (error) {
      console.error("Error fetching pending living-context updates:", error);
      res.status(500).json({ error: "Failed to fetch living-context updates" });
    }
  });

  app.patch("/api/living-context/:id/review", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const { action, updatedLearned } = req.body as { action: "keep" | "edit" | "discard"; updatedLearned?: string };
      if (!["keep", "edit", "discard"].includes(action)) {
        return res.status(400).json({ error: "action must be keep, edit, or discard" });
      }

      if (action === "discard") {
        const result = await db.execute<{ id: string; path: string; block: string }>(sql`
          UPDATE living_context_updates
          SET status = 'discarded'
          WHERE id = ${id} AND user_id = ${userId} AND status = 'needs_review'
          RETURNING id, path, block
        `);
        const row = (result.rows ?? [])[0];
        if (!row) return res.status(404).json({ error: "Living context update not found" });
        applyLivingContextReviewToFile(row.path, row.block, null).catch(() => {});
        return res.json({ ok: true });
      }

      if (action === "edit") {
        const learned = typeof updatedLearned === "string" ? updatedLearned.trim() : "";
        if (!learned) return res.status(400).json({ error: "updatedLearned is required for edit action" });
        const existing = await db.execute<{
          topic: string;
          source_type: string;
          source_ref: string | null;
          confidence: number;
          fills_question: string | null;
          approval_sensitive: boolean;
          notes: string | null;
          created_at: string;
          path: string;
          block: string;
        }>(sql`
          SELECT topic, source_type, source_ref, confidence, fills_question, approval_sensitive, notes, created_at, path, block
          FROM living_context_updates
          WHERE id = ${id} AND user_id = ${userId} AND status = 'needs_review'
          LIMIT 1
        `);
        const row = (existing.rows ?? [])[0];
        if (!row) return res.status(404).json({ error: "Living context update not found" });
        const created = new Date(row.created_at);
        const date = Number.isNaN(created.getTime()) ? new Date().toISOString().slice(0, 10) : created.toISOString().slice(0, 10);
        const sourceRef = row.source_ref ? ` (${row.source_ref})` : "";
        const blockLines = [
          `### ${date} - ${row.topic || "Context update"}`,
          `- Source: ${row.source_type || "conversation"}${sourceRef}`,
          `- Confidence: ${row.confidence ?? 70}`,
          "- Status: edited",
          `- Learned: ${learned}`,
        ];
        if (row.fills_question) blockLines.push(`- Fills: ${row.fills_question}`);
        if (row.approval_sensitive) {
          blockLines.push("- Approval boundary: This may inform planning, but official compliance, licensing, financial, or external actions still require explicit approval from Battles.");
        }
        if (row.notes) blockLines.push(`- Notes: ${row.notes}`);
        const block = blockLines.join("\n");
        const normalized = createHash("sha256").update(learned.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
        const result = await db.execute(sql`
          UPDATE living_context_updates
          SET learned = ${learned},
              normalized_learned = ${normalized},
              block = ${block},
              status = 'edited'
          WHERE id = ${id} AND user_id = ${userId} AND status = 'needs_review'
          RETURNING id
        `);
        if ((result.rows ?? []).length === 0) return res.status(404).json({ error: "Living context update not found" });
        applyLivingContextReviewToFile(row.path, row.block, block).catch(() => {});
        return res.json({ ok: true });
      }

      const result = await db.execute(sql`
        UPDATE living_context_updates
        SET status = 'kept'
        WHERE id = ${id} AND user_id = ${userId} AND status = 'needs_review'
        RETURNING id
      `);
      if ((result.rows ?? []).length === 0) return res.status(404).json({ error: "Living context update not found" });
      return res.json({ ok: true });
    } catch (error) {
      console.error("Error reviewing living-context update:", error);
      res.status(500).json({ error: "Failed to review living-context update" });
    }
  });

  app.get("/api/memories/fading", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await db.select()
        .from(userMemories)
        .where(
          sql`${userMemories.userId} = ${userId}
            AND ${userMemories.tier} = 'long_term'
            AND ${userMemories.relevanceScore} <= 30
            AND COALESCE(${userMemories.lastReferencedAt}, ${userMemories.extractedAt}) < ${thirtyDaysAgo}`
        )
        .orderBy(userMemories.relevanceScore);
      res.json({ memories: rows });
    } catch (error) {
      console.error("Error fetching fading memories:", error);
      res.status(500).json({ error: "Failed to fetch fading memories" });
    }
  });

  app.post("/api/memories/:id/keep", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const result = await db.execute(sql`
        UPDATE user_memories
        SET relevance_score = 50,
            last_referenced_at = NOW()
        WHERE id = ${id}
          AND user_id = ${userId}
        RETURNING id
      `);
      if ((result.rows ?? []).length === 0) {
        return res.status(404).json({ error: "Memory not found" });
      }
      res.json({ ok: true });
    } catch (error) {
      console.error("Error keeping memory:", error);
      res.status(500).json({ error: "Failed to keep memory" });
    }
  });

  app.delete("/api/memories/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      await db.delete(userMemories)
        .where(sql`${userMemories.id} = ${id} AND ${userMemories.userId} = ${userId}`);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting memory:", error);
      res.status(500).json({ error: "Failed to delete memory" });
    }
  });

  app.post("/api/memories/extract", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { messages } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.json({ added: 0 });
      }

      const conversationText = messages
        .map((m: any) => `${m.role}: ${m.content}`)
        .join('\n');

      const stored = await extractAndStore({
        userId,
        source: conversationText,
        sourceType: "chat",
      });
      const lastUserMessage = [...messages].reverse().find((m: any) => m.role === "user" && typeof m.content === "string");
      if (lastUserMessage?.content) {
        await processLivingContextUpdate({
          userId,
          text: lastUserMessage.content,
          sourceType: "conversation",
          sourceRef: "manual memory extraction",
        }).catch((err) => console.error("[LivingContext/manual_extract] update failed:", err));
      }
      res.json({ added: stored.length });
    } catch (error) {
      console.error("Error extracting memories:", error);
      res.json({ added: 0 });
    }
  });

  app.get("/api/soul", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const soul = await getSoul(userId);
      res.json(soul);
    } catch (error) {
      console.error("Error fetching SOUL:", error);
      res.status(500).json({ error: "Failed to fetch SOUL" });
    }
  });

  app.post("/api/soul/regenerate", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const soul = await regenerateSoul(userId);
      res.json(soul);
    } catch (error) {
      console.error("Error regenerating SOUL:", error);
      res.status(500).json({ error: "Failed to regenerate SOUL" });
    }
  });

  app.put("/api/soul/override", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const body = req.body as { override?: unknown };
      const override = typeof body.override === "string" ? body.override : null;
      await setManualOverride(userId, override);
      const soul = await getSoul(userId);
      res.json(soul);
    } catch (error) {
      console.error("Error setting SOUL override:", error);
      res.status(500).json({ error: "Failed to set override" });
    }
  });

  // Edit the canonical SOUL document (JARVIS_SOUL.md content) directly.
  // Distinct from /override — this rewrites the source of truth.
  app.put("/api/soul/content", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const body = req.body as { content?: unknown };
      const content = typeof body.content === "string" ? body.content : "";
      await setSoulContent(userId, content);
      const soul = await getSoul(userId);
      res.json(soul);
    } catch (error) {
      console.error("Error saving SOUL content:", error);
      res.status(500).json({ error: "Failed to save SOUL content" });
    }
  });

  // ── Workspace file API ────────────────────────────────────────────────────
  // GET  /api/workspace/:file   — read a workspace file (owner only)
  // POST /api/workspace/:file   — write a workspace file (owner only)
  //
  // IMPORTANT: specific literal routes (e.g. /synthesise) MUST be registered
  // BEFORE the /:file wildcard so Express resolves them correctly.

  const WORKSPACE_VALID_KEYS = ["soul", "agents", "memory", "errors", "corrections", "feature_requests"] as const;
  type WFKey = typeof WORKSPACE_VALID_KEYS[number];
  function isWFKey(k: string): k is WFKey {
    return (WORKSPACE_VALID_KEYS as readonly string[]).includes(k);
  }

  // ── Workspace synthesis endpoint — registered BEFORE /:file wildcard ──────
  // POST /api/workspace/synthesise — owner-only, triggers LLM learning review
  app.post("/api/workspace/synthesise", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { isIntegrationOwner } = await import("../integrationOwner");
      if (!await isIntegrationOwner(userId)) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const body = req.body as { dryRun?: boolean; archiveAfter?: boolean };
      const applyToMemory = body.dryRun !== true;
      const archiveAfter = applyToMemory && body.archiveAfter === true;

      const { synthesiseLearnings } = await import("../intelligence/learningSynthesiser");
      const result = await synthesiseLearnings(applyToMemory, archiveAfter);

      // Structured audit entry — written to the server's persistent audit trail.
      console.log(
        `[Audit] workspace_synthesise user=${userId} triggered=manual bullets=${result.bullets.length} ` +
        `skipped=${result.skipped} applied=${result.appendedToMemory} archived=${result.archived} ` +
        `correctionLines=${result.correctionLines} errorLines=${result.errorLines}`,
      );

      res.json({ ok: true, ...result });
    } catch (error) {
      console.error("[Workspace] synthesise error:", error);
      res.status(500).json({ error: "Failed to synthesise learnings" });
    }
  });

  // GET /api/workspace/synthesise-history — last 5 synthesis runs (owner only)
  app.get("/api/workspace/synthesise-history", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { isIntegrationOwner } = await import("../integrationOwner");
      if (!await isIntegrationOwner(userId)) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const rows = await db
        .select()
        .from(schema.learningSynthesisLog)
        .orderBy(desc(schema.learningSynthesisLog.createdAt))
        .limit(5);

      res.json({ runs: rows });
    } catch (error) {
      console.error("[Workspace] synthesise-history error:", error);
      res.status(500).json({ error: "Failed to fetch synthesis history" });
    }
  });

  app.get("/api/workspace/:file", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { isIntegrationOwner } = await import("../integrationOwner");
      if (!await isIntegrationOwner(userId)) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const fileParam = paramValue(req.params.file);
      if (!isWFKey(fileParam)) {
        return res.status(400).json({ error: `Invalid file key: ${fileParam}` });
      }

      const { readWorkspaceFile } = await import("../workspace/loader");
      const content = await readWorkspaceFile(fileParam);
      res.json({ file: fileParam, content });
    } catch (error) {
      console.error("[Workspace] GET error:", error);
      res.status(500).json({ error: "Failed to read workspace file" });
    }
  });

  app.post("/api/workspace/:file", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { isIntegrationOwner } = await import("../integrationOwner");
      if (!await isIntegrationOwner(userId)) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const fileParam = paramValue(req.params.file);
      if (!isWFKey(fileParam)) {
        return res.status(400).json({ error: `Invalid file key: ${fileParam}` });
      }

      const body = req.body as { content?: unknown; mode?: unknown };
      const content = typeof body.content === "string" ? body.content : "";
      const mode = body.mode === "append" ? "append" : "overwrite";

      const { writeWorkspaceFile } = await import("../workspace/loader");
      await writeWorkspaceFile(fileParam, content, mode);

      res.json({ ok: true, file: fileParam, mode });
    } catch (error) {
      console.error("[Workspace] POST error:", error);
      res.status(500).json({ error: "Failed to write workspace file" });
    }
  });

  app.get("/api/people", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const people = await listPeople(userId);
      res.json({ people });
    } catch (error) {
      console.error("Error fetching people:", error);
      res.status(500).json({ error: "Failed to fetch people" });
    }
  });

  app.delete("/api/people/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await deletePerson(userId, paramValue(req.params.id));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting person:", error);
      res.status(500).json({ error: "Failed to delete person" });
    }
  });

  // Phase 4 — surface the most recent weekly pattern review in the
  // Insights tab. We return the latest row per user; the frontend
  // renders the patterns and summary in plain English.
  app.get("/api/weekly-insights", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db
        .select()
        .from(schema.weeklyInsights)
        .where(eq(schema.weeklyInsights.userId, userId))
        .orderBy(desc(schema.weeklyInsights.createdAt))
        .limit(4);
      return res.json({ insights: rows });
    } catch (error) {
      console.error("Error getting weekly insights:", error);
      return res.status(500).json({ error: "Failed to get weekly insights" });
    }
  });

  // Dream Cycle — return history of all dream insights for the user,
  // newest first. Grouped by dream_date for display in the app.
  app.get("/api/dream-insights", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db
        .select()
        .from(schema.dreamInsights)
        .where(eq(schema.dreamInsights.userId, userId))
        .orderBy(desc(schema.dreamInsights.createdAt))
        .limit(50);
      return res.json({ insights: rows });
    } catch (error) {
      console.error("Error getting dream insights:", error);
      return res.status(500).json({ error: "Failed to get dream insights" });
    }
  });

  // Trigger a manual dream cycle run for the current user (useful for testing).
  // Only runs if the user has at least 2 weeks of memory data.
  app.post("/api/dream-insights/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const dreamDate = new Date().toISOString().slice(0, 10);
      const manualKey = `dream_manual:${dreamDate}`;
      const existing = await db
        .select({ id: schema.proactiveScheduleLog.id })
        .from(schema.proactiveScheduleLog)
        .where(
          and(
            eq(schema.proactiveScheduleLog.userId, userId),
            eq(schema.proactiveScheduleLog.messageType, manualKey),
            eq(schema.proactiveScheduleLog.sentDate, dreamDate),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        return res.status(429).json({ error: "Dream cycle already run today. Try again tomorrow." });
      }
      const { runDreamForUser } = await import("../memory/dream");
      const dreamResult = await runDreamForUser(userId, dreamDate);
      await db.insert(schema.proactiveScheduleLog).values({
        userId, messageType: manualKey, sentDate: dreamDate,
      }).catch(() => {});
      return res.json({
        count: dreamResult.insightsStored,
        dreamDate,
        consolidation: dreamResult.consolidation,
        semanticExtraction: dreamResult.semanticExtraction,
        decay: dreamResult.decay,
        reinforcement: dreamResult.reinforcement,
      });
    } catch (error) {
      console.error("Error running dream cycle:", error);
      return res.status(500).json({ error: "Failed to run dream cycle" });
    }
  });

  // Fetch the actual memory records that contributed to a dream insight's synthesis.
  // Returns up to 10 representative memories from sourceMemoryIds.
  app.get("/api/dream-insights/:insightId/memories", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const insightId = paramValue(req.params.insightId);
      const insightRows = await db
        .select({ sourceMemoryIds: schema.dreamInsights.sourceMemoryIds })
        .from(schema.dreamInsights)
        .where(
          and(
            eq(schema.dreamInsights.id, insightId),
            eq(schema.dreamInsights.userId, userId),
          ),
        )
        .limit(1);
      if (insightRows.length === 0) return res.status(404).json({ error: "Not found" });
      const ids = (insightRows[0].sourceMemoryIds as string[] | null) || [];
      if (ids.length === 0) return res.json({ memories: [] });
      const { inArray } = await import("drizzle-orm");
      const memories = await db
        .select({
          id: schema.userMemories.id,
          content: schema.userMemories.content,
          category: schema.userMemories.category,
          confidence: schema.userMemories.confidence,
          extractedAt: schema.userMemories.extractedAt,
        })
        .from(schema.userMemories)
        .where(
          and(
            eq(schema.userMemories.userId, userId),
            inArray(schema.userMemories.id, ids.slice(0, 50)),
          ),
        )
        .limit(10);
      return res.json({ memories });
    } catch (error) {
      console.error("Error getting dream source memories:", error);
      return res.status(500).json({ error: "Failed to get source memories" });
    }
  });

}