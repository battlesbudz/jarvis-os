/**
 * Custom Agent REST API — user-defined sub-agent presets.
 *
 * Routes:
 *   GET    /api/custom-agents              — list user's custom agents
 *   POST   /api/custom-agents              — create
 *   GET    /api/custom-agents/:id          — get one
 *   PUT    /api/custom-agents/:id          — update
 *   DELETE /api/custom-agents/:id          — delete
 *   POST   /api/custom-agents/:id/run      — queue a job using this custom agent
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { submitAgentJob } from "./jobClient";

// ── Slug helpers ──────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

// ── Error handler ─────────────────────────────────────────────────────────────

function handleError(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("not found") || msg.includes("Not found")) {
    res.status(404).json({ error: msg });
  } else if (msg.includes("already exists") || msg.includes("unique")) {
    res.status(409).json({ error: msg });
  } else {
    console.error("[CustomAgentRoutes] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerCustomAgentRoutes(app: Express): void {

  // GET /api/custom-agents
  app.get("/api/custom-agents", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const agents = await db
        .select()
        .from(schema.customAgents)
        .where(eq(schema.customAgents.userId, userId))
        .orderBy(schema.customAgents.createdAt);
      res.json({ agents });
    } catch (err) { handleError(res, err); }
  });

  // POST /api/custom-agents
  app.post("/api/custom-agents", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const body = req.body as Record<string, unknown>;

      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const baseType = (body.baseType as schema.CustomAgentBaseType) ?? "research";
      if (!schema.CUSTOM_AGENT_BASE_TYPES.includes(baseType)) {
        res.status(400).json({ error: `baseType must be one of: ${schema.CUSTOM_AGENT_BASE_TYPES.join(", ")}` });
        return;
      }

      const slug = typeof body.slug === "string" && body.slug.trim()
        ? toSlug(body.slug.trim())
        : toSlug(name);

      const existing = await db
        .select({ id: schema.customAgents.id })
        .from(schema.customAgents)
        .where(and(eq(schema.customAgents.userId, userId), eq(schema.customAgents.slug, slug)))
        .limit(1);

      if (existing.length > 0) {
        res.status(409).json({ error: `A custom agent with slug "${slug}" already exists` });
        return;
      }

      const inserted = await db
        .insert(schema.customAgents)
        .values({
          userId,
          name,
          slug,
          description: typeof body.description === "string" ? body.description.trim() || null : null,
          baseType,
          extraPrompt: typeof body.extraPrompt === "string" ? body.extraPrompt.trim() || null : null,
          allowedTools: Array.isArray(body.allowedTools) ? (body.allowedTools as string[]) : null,
          model: typeof body.model === "string" ? body.model.trim() || null : null,
        })
        .returning();

      res.status(201).json({ agent: inserted[0] });
    } catch (err) { handleError(res, err); }
  });

  // GET /api/custom-agents/:id
  app.get("/api/custom-agents/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const [agent] = await db
        .select()
        .from(schema.customAgents)
        .where(and(eq(schema.customAgents.id, req.params.id), eq(schema.customAgents.userId, userId)))
        .limit(1);
      if (!agent) {
        res.status(404).json({ error: "Custom agent not found" });
        return;
      }
      res.json({ agent });
    } catch (err) { handleError(res, err); }
  });

  // PUT /api/custom-agents/:id
  app.put("/api/custom-agents/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const body = req.body as Record<string, unknown>;

      const [existing] = await db
        .select()
        .from(schema.customAgents)
        .where(and(eq(schema.customAgents.id, req.params.id), eq(schema.customAgents.userId, userId)))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Custom agent not found" });
        return;
      }

      const patch: Partial<typeof schema.customAgents.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (typeof body.name === "string" && body.name.trim()) {
        patch.name = body.name.trim();
      }
      if (typeof body.slug === "string" && body.slug.trim()) {
        const newSlug = toSlug(body.slug.trim());
        // Check uniqueness only if slug changes
        if (newSlug !== existing.slug) {
          const conflict = await db
            .select({ id: schema.customAgents.id })
            .from(schema.customAgents)
            .where(and(eq(schema.customAgents.userId, userId), eq(schema.customAgents.slug, newSlug)))
            .limit(1);
          if (conflict.length > 0) {
            res.status(409).json({ error: `A custom agent with slug "${newSlug}" already exists` });
            return;
          }
        }
        patch.slug = newSlug;
      }
      if (body.description !== undefined) {
        patch.description = typeof body.description === "string" ? body.description.trim() || null : null;
      }
      if (typeof body.baseType === "string" && schema.CUSTOM_AGENT_BASE_TYPES.includes(body.baseType as schema.CustomAgentBaseType)) {
        patch.baseType = body.baseType as schema.CustomAgentBaseType;
      }
      if (body.extraPrompt !== undefined) {
        patch.extraPrompt = typeof body.extraPrompt === "string" ? body.extraPrompt.trim() || null : null;
      }
      if (body.allowedTools !== undefined) {
        patch.allowedTools = Array.isArray(body.allowedTools) ? (body.allowedTools as string[]) : null;
      }
      if (body.model !== undefined) {
        patch.model = typeof body.model === "string" ? body.model.trim() || null : null;
      }

      const [updated] = await db
        .update(schema.customAgents)
        .set(patch)
        .where(eq(schema.customAgents.id, req.params.id))
        .returning();

      res.json({ agent: updated });
    } catch (err) { handleError(res, err); }
  });

  // DELETE /api/custom-agents/:id
  app.delete("/api/custom-agents/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const [existing] = await db
        .select({ id: schema.customAgents.id })
        .from(schema.customAgents)
        .where(and(eq(schema.customAgents.id, req.params.id), eq(schema.customAgents.userId, userId)))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Custom agent not found" });
        return;
      }
      await db
        .delete(schema.customAgents)
        .where(eq(schema.customAgents.id, req.params.id));
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  // POST /api/custom-agents/:id/run — queue a background job for this custom agent
  app.post("/api/custom-agents/:id/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const body = req.body as Record<string, unknown>;

      const [agent] = await db
        .select()
        .from(schema.customAgents)
        .where(and(eq(schema.customAgents.id, req.params.id), eq(schema.customAgents.userId, userId)))
        .limit(1);
      if (!agent) {
        res.status(404).json({ error: "Custom agent not found" });
        return;
      }

      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      const jobId = await submitAgentJob({
        userId,
        agentType: "custom_agent",
        title: `${agent.name}: ${prompt.slice(0, 80)}`,
        prompt,
        input: {
          customAgentId: agent.id,
          customAgentSlug: agent.slug,
          customAgentName: agent.name,
          originChannel: typeof body.originChannel === "string" ? body.originChannel : "app",
        },
      });

      res.status(202).json({ jobId, agentName: agent.name });
    } catch (err) { handleError(res, err); }
  });

  // GET /api/custom-agents/by-slug/:slug — resolve a slug to agent (used by channel handlers)
  app.get("/api/custom-agents/by-slug/:slug", async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const [agent] = await db
        .select()
        .from(schema.customAgents)
        .where(and(eq(schema.customAgents.slug, req.params.slug), eq(schema.customAgents.userId, userId)))
        .limit(1);
      if (!agent) {
        res.status(404).json({ error: "Custom agent not found" });
        return;
      }
      res.json({ agent });
    } catch (err) { handleError(res, err); }
  });
}
