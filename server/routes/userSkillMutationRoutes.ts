import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { userSkills } from "@shared/schema";
import { db } from "../db";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerUserSkillMutationRoutes(app: Express): void {
  app.patch("/api/user-skills/:id", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = paramValue(req.params.id);
    const { name, description, instructions, emoji } = req.body as {
      name?: string; description?: string; instructions?: string; emoji?: string;
    };
    try {
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Skill not found" });
      if (existing.isBuiltIn) return res.status(400).json({ error: "Built-in skills cannot be modified" });
      const updates: Partial<typeof existing> = {};
      if (name?.trim()) updates.name = name.trim().slice(0, 80);
      if (description !== undefined) updates.description = description.trim().slice(0, 200);
      if (instructions?.trim()) updates.instructions = instructions.trim().slice(0, 3000);
      if (emoji?.trim()) updates.emoji = emoji.trim().slice(0, 8);
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No fields to update" });
      const [updated] = await db
        .update(userSkills)
        .set(updates)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      res.json({ skill: updated });
    } catch (err) {
      console.error("[UserSkills] PATCH update failed:", err);
      res.status(500).json({ error: "Failed to update skill" });
    }
  });

  app.delete("/api/user-skills/:id", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = paramValue(req.params.id);
    try {
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Skill not found" });
      if (existing.isBuiltIn) return res.status(400).json({ error: "Built-in skills cannot be deleted" });
      await db
        .delete(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[UserSkills] DELETE failed:", err);
      res.status(500).json({ error: "Failed to delete skill" });
    }
  });
}
