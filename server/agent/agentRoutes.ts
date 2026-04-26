/**
 * Agent REST API routes — mounted under /api/agents by registerAgentRoutes().
 *
 * All routes require authMiddleware (mounted upstream in routes.ts).
 *
 * Endpoints:
 *   GET    /api/agents               list user's agents
 *   POST   /api/agents               create agent
 *   GET    /api/agents/:id           get single agent
 *   PUT    /api/agents/:id           update agent
 *   DELETE /api/agents/:id           delete agent
 *   POST   /api/agents/:id/enable    enable disabled agent
 *   POST   /api/agents/:id/disable   disable agent
 *   POST   /api/agents/:id/channel   assign channel
 *   DELETE /api/agents/:id/channel   remove channel
 *   POST   /api/agents/:id/run       invoke agent directly (test)
 *   GET    /api/agents/:id/memories  list memories
 *   DELETE /api/agents/:id/memories  clear memories
 *   GET    /api/agents/:id/messages  message history
 *   GET    /api/agents/:id/export    export config JSON
 *   POST   /api/agents/import        import config JSON
 *   POST   /api/agents/council       run council mode
 *   GET    /api/agents/approvals     list pending approval gates
 *   POST   /api/agents/approvals/:gateId/approve
 *   POST   /api/agents/approvals/:gateId/reject
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
} from "./agentApproval";
import {
  validateAgentConfig,
  exportAgentConfig,
  importConfigToCreateArgs,
} from "./agentConfigSchema";
import type { AgentConfigFile } from "./agentConfigSchema";

// ── Helper ─────────────────────────────────────────────────────────────────────

async function ownerCheck(agentId: string, userId: string): Promise<boolean> {
  const agent = await getAgent(agentId);
  return agent?.userId === userId;
}

function handleError(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("not found") || msg.includes("Not found")) {
    res.status(404).json({ error: msg });
  } else if (msg.includes("already exists") || msg.includes("permission") || msg.includes("disabled")) {
    res.status(400).json({ error: msg });
  } else {
    console.error("[AgentRoutes] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Route registration ─────────────────────────────────────────────────────────

export function registerAgentRoutes(app: Express): void {

  // ── List agents ─────────────────────────────────────────────────────────────
  app.get("/api/agents", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const includeDisabled = req.query.includeDisabled === "true";
      const agents = await listAgents(userId, includeDisabled);
      res.json({ agents });
    } catch (err) { handleError(res, err); }
  });

  // ── Create agent ────────────────────────────────────────────────────────────
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

  // ── Get agent ───────────────────────────────────────────────────────────────
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

  // ── Update agent ────────────────────────────────────────────────────────────
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

  // ── Delete agent ────────────────────────────────────────────────────────────
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

  // ── Enable / disable ────────────────────────────────────────────────────────
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

  // ── Channel assignment ──────────────────────────────────────────────────────
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

  // ── Run agent (test invocation) ─────────────────────────────────────────────
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

  // ── Memories ────────────────────────────────────────────────────────────────
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

  // ── Messages ────────────────────────────────────────────────────────────────
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

  // ── Export config ───────────────────────────────────────────────────────────
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

  // ── Import config ───────────────────────────────────────────────────────────
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

  // ── Council mode ────────────────────────────────────────────────────────────
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

  // ── Approval gates ──────────────────────────────────────────────────────────
  app.get("/api/agents/approvals", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const all = req.query.all === "true";
      const gates = all ? listAllGates(userId) : listPendingGates(userId);
      res.json({ gates });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/agents/approvals/:gateId/approve", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const ok = approveGate(req.params.gateId, userId);
      if (!ok) {
        res.status(404).json({ error: "Gate not found or already resolved" });
        return;
      }
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/agents/approvals/:gateId/reject", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const ok = rejectGate(req.params.gateId, userId);
      if (!ok) {
        res.status(404).json({ error: "Gate not found or already resolved" });
        return;
      }
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });
}
