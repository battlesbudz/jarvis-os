/**
 * REST API for code proposals — Jarvis self-inspection approval gate.
 *
 * Route ordering (literal before wildcard):
 *   GET  /api/code-proposals            list all
 *   GET  /api/code-proposals/:id        detail with full diff
 *   POST /api/code-proposals/:id/approve  write file + mark applied
 *   POST /api/code-proposals/:id/reject   archive with optional note
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { codeProposals } from "@shared/schema";
import type { DebugContext } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { isIntegrationOwner } from "../integrationOwner";

const PROJECT_ROOT = process.cwd();

// Re-declare allow-list here so the approve endpoint independently validates paths.
const ALLOWED_SOURCE_DIRS = [
  "server",
  "shared",
  "app",
  "components",
  "hooks",
  "constants",
  "lib",
];

// Files that must NEVER be overwritten via the approval endpoint, regardless of
// allow-list membership. This prevents Jarvis from modifying its own approval
// gate, auth system, or deployment pipeline through the self-edit tool.
const PROTECTED_FILES = new Set([
  "server/agent/codeProposalsRoutes.ts",
  "server/db.ts",
  "server/auth.ts",
  "server/routes.ts",
  "server/agent/harness.ts",
  "server/integrationOwner.ts",
  "server/index.ts",
  "shared/schema.ts",
]);

function isPathAllowed(filePath: string): boolean {
  const normalised = path.normalize(filePath);
  if (path.isAbsolute(normalised)) return false;
  if (normalised.startsWith("..")) return false;
  if (PROTECTED_FILES.has(normalised)) return false;
  const firstSegment = normalised.split(path.sep)[0];
  return ALLOWED_SOURCE_DIRS.includes(firstSegment);
}

/**
 * Schedules a post-fix verification job after a debug-originated proposal is approved.
 * Waits 8 seconds (let the server restart begin) then enqueues a general agent job
 * that re-checks the relevant capability and sends the result to the user's inbox.
 */
async function schedulePostFixVerification(
  userId: string,
  proposalId: string,
  filePath: string,
  debugCtx: DebugContext,
): Promise<void> {
  // Brief delay to allow the file write to settle before the verification job runs.
  await new Promise<void>((resolve) => setTimeout(resolve, 8000));

  try {
    const { submitAgentJob } = await import("./jobQueue");
    const brief = [
      `A code fix has just been applied (proposal ID: ${proposalId}, file: ${filePath}).`,
      ``,
      `This fix originated from a debug session. The original error was:`,
      `"${debugCtx.errorMessage}"`,
      ``,
      `Root cause identified at the time: ${debugCtx.rootCauseSummary}`,
      ``,
      `Please verify whether the fix resolved the issue:`,
      `1. Call read_recent_errors to check if the same error has recurred since the fix was applied.`,
      `2. If no new errors appear, notify the user that the fix appears to be working.`,
      `3. If errors persist, read_recent_errors again, then notify the user of the ongoing issue with a concise explanation.`,
      ``,
      `Send a brief inbox message with the verification result — do NOT create another code proposal unless you identify a new, distinct issue.`,
    ].join("\n");

    await submitAgentJob({
      userId,
      agentType: "general",
      title: `Verifying fix for: ${debugCtx.errorMessage.slice(0, 80)}`,
      prompt: brief,
      input: {
        postFixVerification: true,
        proposalId,
        filePath,
      },
    });

    console.log(`[CodeProposals] queued post-fix verification for proposal ${proposalId}`);
  } catch (err) {
    console.error("[CodeProposals] schedulePostFixVerification failed:", err);
  }
}

export function registerCodeProposalsRoutes(app: Express): void {
  // ── Owner guard ────────────────────────────────────────────────────────────
  // Code proposals give write access to live source files.  Only the
  // integration owner (the single privileged account in the deployment) may
  // view, create, approve, or reject proposals.  Any other authenticated user
  // receives 403 Forbidden.
  async function requireOwner(userId: string, res: Response): Promise<boolean> {
    const ok = await isIntegrationOwner(userId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden: only the account owner may manage code proposals." });
      return false;
    }
    return true;
  }

  // GET /api/code-proposals — list all proposals for the authenticated user
  app.get("/api/code-proposals", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!await requireOwner(userId, res)) return;

    try {
      const rows = await db
        .select({
          id: codeProposals.id,
          title: codeProposals.title,
          reason: codeProposals.reason,
          filePath: codeProposals.filePath,
          status: codeProposals.status,
          rejectionNote: codeProposals.rejectionNote,
          debugContext: codeProposals.debugContext,
          createdAt: codeProposals.createdAt,
          appliedAt: codeProposals.appliedAt,
        })
        .from(codeProposals)
        .where(eq(codeProposals.userId, userId))
        .orderBy(desc(codeProposals.createdAt));

      return res.json(rows);
    } catch (err) {
      console.error("[CodeProposals] list error:", err);
      return res.status(500).json({ error: "Failed to fetch proposals" });
    }
  });

  // GET /api/code-proposals/:id — full detail including diff content
  app.get("/api/code-proposals/:id", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!await requireOwner(userId, res)) return;

    try {
      const [row] = await db
        .select()
        .from(codeProposals)
        .where(and(eq(codeProposals.id, req.params.id), eq(codeProposals.userId, userId)))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Proposal not found" });
      return res.json(row);
    } catch (err) {
      console.error("[CodeProposals] detail error:", err);
      return res.status(500).json({ error: "Failed to fetch proposal" });
    }
  });

  // POST /api/code-proposals/:id/approve — write file + mark approved
  app.post("/api/code-proposals/:id/approve", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!await requireOwner(userId, res)) return;

    try {
      const [row] = await db
        .select()
        .from(codeProposals)
        .where(and(eq(codeProposals.id, req.params.id), eq(codeProposals.userId, userId)))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Proposal not found" });
      if (row.status !== "pending") {
        return res.status(409).json({ error: `Proposal is already ${row.status}` });
      }

      // Re-validate allow-list on the server side — never trust stored data blindly.
      if (!isPathAllowed(row.filePath)) {
        return res.status(403).json({ error: "Stored file path is outside the allowed source directories. This proposal cannot be applied." });
      }

      const absPath = path.join(PROJECT_ROOT, row.filePath);

      // Verify directory exists
      await fs.mkdir(path.dirname(absPath), { recursive: true });

      // Write the proposed content
      await fs.writeFile(absPath, row.proposedContent, "utf-8");

      // Mark as approved
      await db
        .update(codeProposals)
        .set({ status: "approved", appliedAt: new Date() })
        .where(eq(codeProposals.id, row.id));

      console.log(`[CodeProposals] approved proposal ${row.id} → wrote ${row.filePath}`);

      // Post-fix verification: if this proposal originated from a debug session,
      // queue a follow-up job to re-run the relevant health check and notify the user.
      const debugCtx = row.debugContext as DebugContext | null;
      if (debugCtx) {
        schedulePostFixVerification(userId, row.id, row.filePath, debugCtx).catch((e) =>
          console.error("[CodeProposals] post-fix verification scheduling failed:", e),
        );
      }

      res.json({ ok: true, filePath: row.filePath, restarting: true });

      // Gracefully restart so the newly-written file is loaded immediately.
      // The Replit workflow manager will relaunch the process automatically.
      setTimeout(() => {
        console.log("[CodeProposals] Restarting backend to apply code change…");
        process.exit(0);
      }, 400);
    } catch (err) {
      console.error("[CodeProposals] approve error:", err);
      return res.status(500).json({ error: "Failed to apply proposal" });
    }
  });

  // POST /api/code-proposals/:id/reject — archive with optional note
  app.post("/api/code-proposals/:id/reject", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!await requireOwner(userId, res)) return;

    const note = typeof req.body?.note === "string" ? req.body.note.trim() : null;

    try {
      const [row] = await db
        .select({ id: codeProposals.id, status: codeProposals.status })
        .from(codeProposals)
        .where(and(eq(codeProposals.id, req.params.id), eq(codeProposals.userId, userId)))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Proposal not found" });
      if (row.status !== "pending") {
        return res.status(409).json({ error: `Proposal is already ${row.status}` });
      }

      await db
        .update(codeProposals)
        .set({ status: "rejected", rejectionNote: note })
        .where(eq(codeProposals.id, row.id));

      console.log(`[CodeProposals] rejected proposal ${row.id}${note ? ` (note: ${note})` : ""}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error("[CodeProposals] reject error:", err);
      return res.status(500).json({ error: "Failed to reject proposal" });
    }
  });
}
