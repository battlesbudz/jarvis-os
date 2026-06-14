import { and, eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { userSkills } from "@shared/schema";
import { db } from "../db";
import { BUILT_IN_SKILLS } from "./userSkillsCatalog";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerUserSkillLibraryRoutes(app: Express): void {
  app.get("/api/user-skills", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const existing = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
      const existingBuiltInNames = new Set(
        existing.filter((skill) => skill.isBuiltIn).map((skill) => skill.name),
      );
      const toSeed = BUILT_IN_SKILLS.filter((skill) => !existingBuiltInNames.has(skill.name));

      if (toSeed.length > 0) {
        await db
          .insert(userSkills)
          .values(
            toSeed.map((skill) => ({
              userId,
              name: skill.name,
              emoji: skill.emoji,
              description: skill.description,
              instructions: skill.instructions,
              isBuiltIn: true,
              isActive: false,
            })),
          )
          .onConflictDoNothing();
        const fresh = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
        return res.json({ skills: fresh });
      }

      res.json({ skills: existing });
    } catch (err) {
      console.error("[UserSkills] GET failed:", err);
      res.status(500).json({ error: "Failed to list skills" });
    }
  });

  app.post("/api/user-skills", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { name, emoji, description, instructions } = req.body as {
      name?: string;
      emoji?: string;
      description?: string;
      instructions?: string;
    };
    if (!name || !instructions) {
      return res.status(400).json({ error: "name and instructions are required" });
    }
    try {
      const [skill] = await db
        .insert(userSkills)
        .values({
          userId,
          name: name.trim().slice(0, 80),
          emoji: (emoji ?? "\u26a1").slice(0, 8),
          description: (description ?? "").trim().slice(0, 200),
          instructions: instructions.trim().slice(0, 3000),
          isBuiltIn: false,
          isActive: true,
        })
        .returning();
      res.status(201).json({ skill });
    } catch (err) {
      console.error("[UserSkills] POST failed:", err);
      res.status(500).json({ error: "Failed to create skill" });
    }
  });

  app.patch("/api/user-skills/:id/toggle", async (req: Request, res: Response) => {
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
      const [updated] = await db
        .update(userSkills)
        .set({ isActive: !existing.isActive, updatedAt: new Date() })
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      res.json({ skill: updated });
    } catch (err) {
      console.error("[UserSkills] PATCH toggle failed:", err);
      res.status(500).json({ error: "Failed to toggle skill" });
    }
  });
}
