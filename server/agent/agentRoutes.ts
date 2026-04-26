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
 *  16. GET  /api/agents/:id/memories
 *  17. DELETE /api/agents/:id/memories
 *  18. GET  /api/agents/:id/messages
 *  19. GET  /api/agents/:id/export
 */
import type { Express, Request, Response } from "express";
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

// ── Route registration ─────────────────────────────────────────────────────────

export function registerAgentRoutes(app: Express): void {

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
      approveGate(req.params.gateId, userId);
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
      rejectGate(req.params.gateId, userId);
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

  // ── 9. PUT /api/agents/:id — update ──────────────────────────────────────
  app.put("/api/agents/:id", async (req: Request, res: Response) => {
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
  });

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
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.flushHeaders();

        let fullReply = "";
        const result = await runNamedAgent({
          agentId: req.params.id,
          userId,
          userMessage: message,
          platform: "in_app",
          onToken: (chunk: string) => {
            fullReply += chunk;
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          },
        });

        // Ensure final reply is flushed (handles non-streaming fallback inside runNamedAgent)
        if (!fullReply && result.reply) {
          res.write(`data: ${JSON.stringify({ content: result.reply })}\n\n`);
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
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
