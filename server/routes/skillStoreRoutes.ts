import type { Express, Request, Response } from "express";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerSkillStoreRoutes(app: Express): void {
  app.get("/api/skills", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { listUserSkills, getUserSkillSignals } = await import("../intelligence/skillWriter");
      const [skills, signals] = await Promise.all([
        listUserSkills(userId),
        Promise.resolve(getUserSkillSignals(userId)),
      ]);
      res.json({ skills, signals });
    } catch (err) {
      console.error("[Skills] GET /api/skills failed:", err);
      res.status(500).json({ error: "Failed to list skills" });
    }
  });

  app.get("/api/skill-packs", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { listStorePacksForUser } = await import("../intelligence/behaviorStore");
      const packs = await listStorePacksForUser(userId);
      res.json({ packs });
    } catch (err) {
      console.error("[SkillStore] list failed:", err);
      res.status(500).json({ error: "Failed to list skill packs" });
    }
  });

  app.get("/api/skill-packs/:packId", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const packId = paramValue(req.params.packId);
    try {
      const { getStorePackById } = await import("../intelligence/behaviorStore");
      const pack = await getStorePackById(packId, userId);
      if (!pack) return res.status(404).json({ error: "Pack not found" });
      res.json(pack);
    } catch (err) {
      console.error("[Routes] GET /api/skill-packs/:packId error:", err);
      res.status(500).json({ error: "Failed to fetch skill pack" });
    }
  });

  app.post("/api/skill-packs/:packId/activate", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const packId = paramValue(req.params.packId);
    try {
      const { setUserPackActive } = await import("../intelligence/behaviorStore");
      await setUserPackActive(userId, packId, true);
      res.json({ ok: true });
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found")) return res.status(404).json({ error: msg });
      if (msg.includes("not a store-visible")) return res.status(400).json({ error: msg });
      console.error("[SkillStore] activate failed:", err);
      res.status(500).json({ error: "Failed to activate pack" });
    }
  });

  app.delete("/api/skill-packs/:packId/activate", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const packId = paramValue(req.params.packId);
    try {
      const { setUserPackActive } = await import("../intelligence/behaviorStore");
      await setUserPackActive(userId, packId, false);
      res.json({ ok: true });
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found")) return res.status(404).json({ error: msg });
      if (msg.includes("not a store-visible")) return res.status(400).json({ error: msg });
      console.error("[SkillStore] deactivate failed:", err);
      res.status(500).json({ error: "Failed to deactivate pack" });
    }
  });

  app.delete("/api/skills/:skillId", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const skillId = paramValue(req.params.skillId);
    try {
      const { deleteSkill } = await import("../intelligence/skillWriter");
      const deleted = await deleteSkill(userId, skillId);
      if (!deleted) return res.status(404).json({ error: "Skill not found" });
      res.json({ ok: true });
    } catch (err) {
      console.error("[Skills] DELETE /api/skills/:skillId failed:", err);
      res.status(500).json({ error: "Failed to delete skill" });
    }
  });
}
