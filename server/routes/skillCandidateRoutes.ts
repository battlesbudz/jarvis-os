import type { Express, Request, Response } from "express";
import { db } from "../db";

const param = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerSkillCandidateRoutes(app: Express): void {
  const getHandler = async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { skillCandidates } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(skillCandidates)
        .where(and(eq(skillCandidates.userId, userId), eq(skillCandidates.status, "pending")))
        .orderBy(skillCandidates.createdAt);
      res.json({ candidates: rows });
    } catch (err) {
      console.error("[SkillCandidates] GET failed:", err);
      res.status(500).json({ error: "Failed to list skill candidates" });
    }
  };
  app.get("/api/skills/candidates", getHandler);
  app.get("/api/skill-candidates", getHandler);

  const reviewHandler = async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = param(req.params.id);
    const { action, name, instructionText } = req.body as {
      action?: string;
      name?: string;
      instructionText?: string;
    };
    if (!action || !["accept", "edit", "dismiss"].includes(action)) {
      return res.status(400).json({ error: "action must be accept, edit, or dismiss" });
    }
    try {
      const { skillCandidates, userSkills } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [candidate] = await db
        .select()
        .from(skillCandidates)
        .where(and(eq(skillCandidates.id, id), eq(skillCandidates.userId, userId)))
        .limit(1);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
      if (candidate.status !== "pending") {
        return res.status(409).json({ error: "Candidate has already been reviewed" });
      }

      const newStatus = action === "accept" ? "accepted" : action === "edit" ? "edited" : "dismissed";

      await db.transaction(async (tx) => {
        await tx
          .update(skillCandidates)
          .set({ status: newStatus })
          .where(eq(skillCandidates.id, id));

        if (action === "accept" || action === "edit") {
          const finalName = name?.trim() ? name.trim().slice(0, 80) : candidate.name;
          const finalInstructions = instructionText?.trim()
            ? instructionText.trim().slice(0, 3000)
            : candidate.instructionText;
          await tx.insert(userSkills).values({
            userId,
            name: finalName,
            emoji: "\u26a1",
            description: candidate.triggerDescription.slice(0, 200),
            instructions: finalInstructions,
            isBuiltIn: false,
            isActive: true,
          });
        }
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("[SkillCandidates] PATCH review failed:", err);
      res.status(500).json({ error: "Failed to review candidate" });
    }
  };
  app.patch("/api/skills/candidates/:id/review", reviewHandler);
  app.patch("/api/skill-candidates/:id/review", reviewHandler);
}
