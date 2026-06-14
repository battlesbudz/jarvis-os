import type { Express, Request, Response } from "express";

import * as schema from "@shared/schema";

type AdminSecretGuard = (req: Request, res: Response) => boolean;

export function registerAdminSkillsRoutes(app: Express, requireAdminSecret: AdminSecretGuard): void {
  app.post("/api/admin/skills/publish", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { publishSkillPack } = await import("../intelligence/behaviorStore");
      const body = req.body as {
        packId?: string;
        name?: string;
        instructions?: string;
        changeNote?: string;
        description?: string;
        isStoreVisible?: boolean;
        heartbeatRules?: schema.PackHeartbeatRules;
        toolGroups?: schema.PackToolGroups;
      };
      const { packId, name, instructions, changeNote, description, isStoreVisible, heartbeatRules, toolGroups } = body;
      if (!name || !instructions || !changeNote) {
        return res.status(400).json({ error: "name, instructions, and changeNote are required" });
      }
      const pack = await publishSkillPack({
        packId,
        name,
        instructions,
        changeNote,
        description,
        isStoreVisible,
        heartbeatRules,
        toolGroups,
      });
      console.log(`[Admin/Skills] published pack "${pack.name}" v${pack.version}`);
      res.json({ ok: true, pack });
    } catch (err) {
      console.error("[Admin/Skills] publish failed:", err);
      res.status(500).json({ error: "Failed to publish skill pack" });
    }
  });

  app.get("/api/admin/skills", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { getAdminPackViews } = await import("../intelligence/behaviorStore");
      const packs = await getAdminPackViews();
      res.json({ packs });
    } catch (err) {
      console.error("[Admin/Skills] list failed:", err);
      res.status(500).json({ error: "Failed to list skill packs" });
    }
  });
}
