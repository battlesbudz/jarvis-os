/**
 * Agent REST API routes — mounted under /api/agents by registerAgentRoutes().
 *
 * All routes require authMiddleware (mounted upstream in routes.ts).
 *
 * IMPORTANT: Specific literal paths (import, council, approvals) are registered
 * BEFORE the /:id wildcard to prevent express from capturing them as IDs.
 *
 * Route ordering:
 *   1. POST /api/agents/import        (before /:id)
 *   2. POST /api/agents/council       (before /:id)
 *   3. GET  /api/agents/approvals     (before /:id)
 *   4. POST /api/agents/approvals/:gateId/approve  (before /:id)
 *   5. POST /api/agents/approvals/:gateId/reject   (before /:id)
 *   6. GET  /api/agents               list
 *   7. POST /api/agents               create
 *   8. GET  /api/agents/:id
 *   9. PUT  /api/agents/:id
 *  10. DELETE /api/agents/:id
 *  11. POST /api/agents/:id/enable
 *  12. POST /api/agents/:id/disable
 *  13. POST /api/agents/:id/channel
 *  14. DELETE /api/agents/:id/channel
 *  15. POST /api/agents/:id/run
 *  15b. POST /api/agents/:id/chat      (SSE streaming; heartbeat + abort support)
 *  15c. POST /api/agents/:id/abort     (cancel an in-flight SSE run by runId)
 *  16. GET  /api/agents/:id/memories
 *  17. DELETE /api/agents/:id/memories
 *  18. GET  /api/agents/:id/messages
 *  19. GET  /api/agents/:id/export
 */
import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
  disableAgent,
  enableAgent,
  assignChannel,
  removeChannel,
} from "./agentManager";
import { readAgentMemories, clearAgentMemory, getAgentMemoryCount } from "./agentMemory";
import { db } from "../db";
import { agentMemories, agentJobs } from "@shared/schema";
import { eq, sql, desc, and, or, inArray } from "drizzle-orm";
import { getAgentMessages, getMessageStats } from "./agentBus";
import { runNamedAgent } from "./runNamedAgent";
import { runCouncil } from "./council";
import {
  listPendingGates,
  listAllGates,
  approveGate,
  rejectGate,
  getGate,
} from "./agentApproval";
import {
  validateAgentConfig,
  exportAgentConfig,
  importConfigToCreateArgs,
} from "./agentConfigSchema";
import type { AgentConfigFile } from "./agentConfigSchema";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

async function ownerCheck(agentId: string, userId: string): Promise<boolean> {
  const agent = await getAgent(agentId);
  return agent?.userId === userId;
}

function handleError(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("not found") || msg.includes("Not found")) {
    res.status(404).json({ error: msg });
  } else if (
    msg.includes("already exists") ||
    msg.includes("permission") ||
    msg.includes("disabled")
  ) {
    res.status(400).json({ error: msg });
  } else {
    console.error("[AgentRoutes] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Active run abort map ────────────────────────────────────────────────────────
// Keyed by runId (UUID generated per SSE chat request).
// Each entry stores the AbortController alongside the owning agentId + userId
// so the abort endpoint can verify the caller owns the run before cancelling.
interface ActiveRun {
  controller: AbortController;
  agentId: string;
  userId: string;
}
const activeRuns = new Map<string, ActiveRun>();

// ── Route registration ─────────────────────────────────────────────────────────

export function registerAgentRoutes(app: Express): void {

  // ── 0. GET /api/agents/roster — enriched living roster (BEFORE /:id) ────────
  // Returns all named agents enriched with memoryCount, status, jobs, etc.
  // Also returns recent agent jobs (last 24h) for dynamic task cards.
  app.get("/api/agents/roster", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      // Seed core bots for new users (lazy seeding as fallback)
      const { seedCoreAgentsForUser, CORE_AGENT_NAMES } = await import("./coreAgentSeed");
      await seedCoreAgentsForUser(userId).catch(() => {});

      const agents = await listAgents(userId, true /* includeDisabled */);

      // Memory counts in one query
      const memoryCounts = await db
        .select({
          agentId: agentMemories.agentId,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(agentMemories)
        .where(eq(agentMemories.userId, userId))
        .groupBy(agentMemories.agentId);

      const memoryCountMap = new Map<string, number>();
      for (const row of memoryCounts) {
        memoryCountMap.set(row.agentId, Number(row.count));
      }

      // Recent named-agent jobs (last 48h or running)
      const recentJobs = await db
        .select()
        .from(agentJobs)
        .where(
          and(
            eq(agentJobs.userId, userId),
            eq(agentJobs.agentType, "named_agent_task"),
          ),
        )
        .orderBy(desc(agentJobs.createdAt))
        .limit(50);

      const now = Date.now();

      const enriched = agents.map((agent) => {
        const lastRun = agent.lastLoopRun?.getTime() ?? 0;
        const msSinceRun = lastRun > 0 ? now - lastRun : Infinity;
        const isCoreAgent = CORE_AGENT_NAMES.has(agent.name.toLowerCase());

        let status: "online" | "idle" | "dormant" | "stuck";
        if (agent.heartbeatFailCount > 0) {
          status = "stuck";
        } else if (msSinceRun < 30 * 60 * 1000) {
          status = "online";
        } else if (msSinceRun < 24 * 60 * 60 * 1000) {
          status = "idle";
        } else if (isCoreAgent && !agent.loopEnabled) {
          // Core platform bots don't loop but are always listening — show as idle
          status = "idle";
        } else {
          status = "dormant";
        }

        // Human-readable last action
        let lastAction: string | null = null;
        if (agent.lastLoopRun) {
          lastAction = `Loop ran ${formatRelative(agent.lastLoopRun)}`;
        } else if (agent.loopEnabled) {
          lastAction = "Waiting for first loop";
        } else if (isCoreAgent) {
          lastAction = "Always listening";
        } else {
          lastAction = "Standing by";
        }

        // Find the most recent job for this agent
        const agentJobs2 = recentJobs.filter(
          (j) => (j.input as Record<string, unknown>)?.namedAgentId === agent.id,
        );
        const currentJob = agentJobs2.find((j) => ["queued", "running"].includes(j.status)) ?? null;

        return {
          ...agent,
          memoryCount: memoryCountMap.get(agent.id) ?? 0,
          status,
          lastAction,
          lastActivityAt: agent.lastLoopRun?.toISOString() ?? null,
          isCoreAgent,
          currentJob: currentJob
            ? {
                id: currentJob.id,
                title: currentJob.title,
                status: currentJob.status,
                createdAt: currentJob.createdAt.toISOString(),
                iterationCount: (currentJob.input as Record<string, unknown>)?.iterationCount ?? 0,
              }
            : null,
        };
      });

      // Shape recent jobs for the "ACTIVE TASKS" section
      const activeTasks = recentJobs.map((j) => {
        const inp = (j.input as Record<string, unknown>) ?? {};
        return {
          id: j.id,
          title: j.title,
          status: j.status,
          agentId: String(inp.namedAgentId ?? ""),
          agentName: String(inp.agentName ?? "Agent"),
          iterationCount: Number(inp.iterationCount ?? 0),
          createdAt: j.createdAt.toISOString(),
          startedAt: j.startedAt?.toISOString() ?? null,
          completedAt: j.completedAt?.toISOString() ?? null,
          error: j.error ?? null,
          output: j.status === "complete" || j.status === "delivered"
            ? String((j.result as Record<string, unknown>)?.output ?? "").slice(0, 400)
            : null,
        };
      });

      res.json({ agents: enriched, activeTasks });
    } catch (err) { handleError(res, err); }
  });

  // ── 1. POST /api/agents/import (BEFORE /:id) ──────────────────────────────
  app.post("/api/agents/import", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const body = req.body as Record<string, unknown>;

      const validation = validateAgentConfig(body);
      if (!validation.ok) {
        res.status(400).json({ error: "Invalid config", details: validation.errors });
        return;
      }

      const args = importConfigToCreateArgs(body as unknown as AgentConfigFile);
      const agentId = await createAgent(userId, args);
      const agent = await getAgent(agentId);
      res.status(201).json({ agent, warnings: validation.warnings });
    } catch (err) { handleError(res, err); }
  });

  // ── 2. POST /api/agents/council (BEFORE /:id) ─────────────────────────────
  app.post("/api/agents/council", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { question, agentIds } = req.body as { question: string; agentIds?: string[] };
      if (!question) {
        res.status(400).json({ error: "question is required" });
        return;
      }
      const result = await runCouncil(userId, question, agentIds);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // ── POST /api/council — short-form alias for /api/agents/council ───────────
  app.post("/api/council", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { question, agentIds } = req.body as { question: string; agentIds?: string[] };
      if (!question) {
        res.status(400).json({ error: "question is required" });
        return;
      }
      const result = await runCouncil(userId, question, agentIds);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // ── 3. GET /api/agents/approvals (BEFORE /:id) ────────────────────────────
  app.get("/api/agents/approvals", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const all = req.query.all === "true";
      const gates = await (all ? listAllGates(userId) : listPendingGates(userId));
      res.json({ gates });
    } catch (err) { handleError(res, err); }
  });

  // ── 4 & 5. Approval gate resolution (BEFORE /:id) ─────────────────────────
  app.post("/api/agents/approvals/:gateId/approve", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const gate = await getGate(req.params.gateId);
      if (!gate) {
        res.status(404).json({ error: "Gate not found" });
        return;
      }
      if (gate.userId !== userId) {
        res.status(403).json({ error: "Forbidden: this approval gate belongs to another user" });
        return;
      }
      if (gate.status !== "pending") {
        res.status(400).json({ error: "Gate already resolved" });
        return;
      }
      const approved = await approveGate(req.params.gateId, userId);
      if (!approved) {
        res.status(500).json({ error: "Failed to persist gate approval — DB write may have failed" });
        return;
      }
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/agents/approvals/:gateId/reject", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const gate = await getGate(req.params.gateId);
      if (!gate) {
        res.status(404).json({ error: "Gate not found" });
        return;
      }
      if (gate.userId !== userId) {
        res.status(403).json({ error: "Forbidden: this approval gate belongs to another user" });
        return;
      }
      if (gate.status !== "pending") {
        res.status(400).json({ error: "Gate already resolved" });
        return;
      }
      const rejected = await rejectGate(req.params.gateId, userId);
      if (!rejected) {
        res.status(500).json({ error: "Failed to persist gate rejection — DB write may have failed" });
        return;
      }
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  // ── 6. GET /api/agents — list all agents (active + disabled) ──────────────
  app.get("/api/agents", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      // Return all agents by default so the UI can show disabled agents for re-enable.
      // Pass activeOnly=true to filter to only active agents.
      const activeOnly = req.query.activeOnly === "true";
      const agents = await listAgents(userId, !activeOnly);
      res.json({ agents });
    } catch (err) { handleError(res, err); }
  });

  // ── 7. POST /api/agents — create ──────────────────────────────────────────
  app.post("/api/agents", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const body = req.body as Record<string, unknown>;

      if (!body.name) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const agentId = await createAgent(userId, {
        name: String(body.name),
        role: body.role ? String(body.role) : "custom",
        persona: body.persona ? String(body.persona) : undefined,
        platforms: Array.isArray(body.platforms) ? body.platforms as string[] : ["discord"],
        permissions: body.permissions as Record<string, boolean> | undefined,
        memoryScope: (body.memoryScope as string) as "agent_private" | "shared" | "global" | undefined,
        accessGlobalMemory: Boolean(body.accessGlobalMemory),
        privateMode: Boolean(body.privateMode),
        channelId: body.channelId ? String(body.channelId) : undefined,
        channelName: body.channelName ? String(body.channelName) : undefined,
        loopEnabled: Boolean(body.loopEnabled),
        loopIntervalMinutes: body.loopIntervalMinutes ? Number(body.loopIntervalMinutes) : 60,
        loopPrompt: body.loopPrompt ? String(body.loopPrompt) : undefined,
        platformChannels: body.platformChannels as Record<string, string[]> | undefined,
      });

      const agent = await getAgent(agentId);
      res.status(201).json({ agent });
    } catch (err) { handleError(res, err); }
  });

  // ── 8. GET /api/agents/:id ────────────────────────────────────────────────
  app.get("/api/agents/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const agent = await getAgent(req.params.id);
      if (!agent || agent.userId !== userId) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      res.json({ agent });
    } catch (err) { handleError(res, err); }
  });

  // ── 9. PUT /api/agents/:id — update (also accepts PATCH) ─────────────────
  const _handleAgentUpdate = async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      await updateAgent(req.params.id, req.body);
      const agent = await getAgent(req.params.id);
      res.json({ agent });
    } catch (err) { handleError(res, err); }
  };
  app.put("/api/agents/:id", _handleAgentUpdate);
  app.patch("/api/agents/:id", _handleAgentUpdate);

  // ── 10. DELETE /api/agents/:id ────────────────────────────────────────────
  app.delete("/api/agents/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      await deleteAgent(req.params.id);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  // ── 11. POST /api/agents/:id/enable ──────────────────────────────────────
  app.post("/api/agents/:id/enable", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      await enableAgent(req.params.id);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  // ── 12. POST /api/agents/:id/disable ─────────────────────────────────────
  app.post("/api/agents/:id/disable", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      await disableAgent(req.params.id);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  // ── 13. POST /api/agents/:id/channel — assign ─────────────────────────────
  app.post("/api/agents/:id/channel", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const { platform, channelId } = req.body as { platform: string; channelId: string };
      if (!platform || !channelId) {
        res.status(400).json({ error: "platform and channelId are required" });
        return;
      }
      await assignChannel(req.params.id, platform, channelId);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  // ── 14. DELETE /api/agents/:id/channel — remove ───────────────────────────
  app.delete("/api/agents/:id/channel", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const { platform, channelId } = req.query as { platform: string; channelId: string };
      if (!platform || !channelId) {
        res.status(400).json({ error: "platform and channelId are required" });
        return;
      }
      await removeChannel(req.params.id, platform, channelId);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  // ── 15. POST /api/agents/:id/run — test invocation ────────────────────────
  app.post("/api/agents/:id/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const { message, platform = "api" } = req.body as { message: string; platform?: string };
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }
      const result = await runNamedAgent({
        agentId: req.params.id,
        userId,
        userMessage: message,
        platform,
      });
      res.json({ reply: result.reply, turns: result.turns, toolCalls: result.toolCalls.length });
    } catch (err) { handleError(res, err); }
  });

  // ── 15b. POST /api/agents/:id/chat — in-app streaming chat ───────────────
  // Dedicated in-app chat endpoint for the mobile Agents tab. Provides
  // streaming SSE output (text/event-stream) so the UI can display tokens
  // progressively. Falls back to JSON when Accept header is not SSE.
  //
  // SSE extras:
  //  • X-Run-Id response header carries a UUID the client can pass to the
  //    abort endpoint to cancel the in-flight run.
  //  • `: heartbeat` SSE comment sent every 15 s keeps the connection alive
  //    on mobile networks that silently drop idle connections.
  app.post("/api/agents/:id/chat", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const { message } = req.body as { message: string };
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      const wantsStream = req.headers.accept?.includes("text/event-stream") ?? false;

      if (wantsStream) {
        // Generate a run ID so the client can abort this specific run.
        const runId = randomUUID();
        const abortController = new AbortController();
        activeRuns.set(runId, { controller: abortController, agentId: req.params.id, userId });

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("X-Run-Id", runId);
        res.flushHeaders();

        // Heartbeat: SSE comment every 15 s prevents mobile network idle-drops.
        const heartbeat = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) {
            try { res.write(": heartbeat\n\n"); } catch { /* ignore */ }
          }
        }, 15_000);

        // Cleanup helper — called on normal completion and on client disconnect.
        const cleanup = () => {
          clearInterval(heartbeat);
          activeRuns.delete(runId);
        };

        // If the client closes the connection mid-stream, abort the agent loop.
        req.on("close", () => {
          abortController.abort();
          cleanup();
        });

        try {
          let fullReply = "";
          const result = await runNamedAgent({
            agentId: req.params.id,
            userId,
            userMessage: message,
            platform: "in_app",
            signal: abortController.signal,
            onToken: (chunk: string) => {
              fullReply += chunk;
              if (!res.writableEnded) {
                res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
              }
            },
            onIntegrationError: (integrationKey: string, errorMessage: string) => {
              if (!res.writableEnded) {
                console.warn(`[AgentRoutes/SSE] integration_error: integration=${integrationKey}`);
                const integrationLabels: Record<string, string> = {
                  google: 'Google', outlook: 'Outlook', slack: 'Slack',
                  telegram: 'Telegram', discord: 'Discord', whatsapp: 'WhatsApp',
                };
                const label = integrationLabels[integrationKey] ?? integrationKey;
                const safeMessage = `Your ${label} connection has expired and needs to be reconnected.`;
                console.debug(`[AgentRoutes/SSE] integration_error detail: ${errorMessage.slice(0, 300)}`);
                res.write(
                  `data: ${JSON.stringify({ type: "integration_error", integration: integrationKey, message: safeMessage })}\n\n`,
                );
              }
            },
          });

          if (!res.writableEnded) {
            // Ensure final reply is flushed (handles non-streaming fallback inside runNamedAgent)
            if (!fullReply && result.reply) {
              res.write(`data: ${JSON.stringify({ content: result.reply })}\n\n`);
            }
            res.write(`data: [DONE]\n\n`);
            res.end();
          }
        } catch (err) {
          const isAbort = err instanceof Error && err.name === "AbortError";
          if (!res.writableEnded) {
            if (isAbort) {
              res.write(`data: ${JSON.stringify({ type: "aborted" })}\n\n`);
            } else {
              const msg = err instanceof Error ? err.message : String(err);
              res.write(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`);
            }
            res.end();
          }
        } finally {
          cleanup();
        }
      } else {
        const result = await runNamedAgent({
          agentId: req.params.id,
          userId,
          userMessage: message,
          platform: "in_app",
        });
        res.json({ reply: result.reply, turns: result.turns, toolCalls: result.toolCalls.length });
      }
    } catch (err) { handleError(res, err); }
  });

  // ── 15c. POST /api/agents/:id/abort — cancel an in-flight SSE run ─────────
  // The client passes the runId it received in the X-Run-Id header.
  // The server finds the corresponding AbortController and signals abort.
  app.post("/api/agents/:id/abort", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const { runId } = req.body as { runId?: string };
      if (!runId) {
        res.status(400).json({ error: "runId is required" });
        return;
      }
      const run = activeRuns.get(runId);
      if (!run) {
        // Already finished or unknown — not an error from the client's perspective.
        res.json({ ok: true, aborted: false, reason: "run not found or already completed" });
        return;
      }
      // Verify the run belongs to the requesting user AND the stated agent.
      if (run.agentId !== req.params.id || run.userId !== userId) {
        res.status(403).json({ error: "Forbidden: this run belongs to a different agent or user" });
        return;
      }
      run.controller.abort();
      activeRuns.delete(runId);
      res.json({ ok: true, aborted: true });
    } catch (err) { handleError(res, err); }
  });

  // ── 16. GET /api/agents/:id/memories ─────────────────────────────────────
  app.get("/api/agents/:id/memories", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const query = String(req.query.q ?? "");
      const limit = Math.min(Number(req.query.limit ?? 20), 50);
      const [memories, count] = await Promise.all([
        readAgentMemories(req.params.id, userId, query, limit),
        getAgentMemoryCount(req.params.id, userId),
      ]);
      res.json({ memories, count });
    } catch (err) { handleError(res, err); }
  });

  // ── 17. DELETE /api/agents/:id/memories ──────────────────────────────────
  app.delete("/api/agents/:id/memories", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const deleted = await clearAgentMemory(req.params.id, userId);
      res.json({ ok: true, deleted });
    } catch (err) { handleError(res, err); }
  });

  // ── 18. GET /api/agents/:id/messages ─────────────────────────────────────
  app.get("/api/agents/:id/messages", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      if (!(await ownerCheck(req.params.id, userId))) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const limit = Math.min(Number(req.query.limit ?? 20), 50);
      const [messages, stats] = await Promise.all([
        getAgentMessages(req.params.id, userId, limit),
        getMessageStats(req.params.id, userId),
      ]);
      res.json({ messages, stats });
    } catch (err) { handleError(res, err); }
  });

  // ── 19. GET /api/agents/:id/export ───────────────────────────────────────
  app.get("/api/agents/:id/export", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const agent = await getAgent(req.params.id);
      if (!agent || agent.userId !== userId) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const config = exportAgentConfig(agent);
      res.setHeader("Content-Disposition", `attachment; filename="${agent.name}-config.json"`);
      res.json(config);
    } catch (err) { handleError(res, err); }
  });
}
