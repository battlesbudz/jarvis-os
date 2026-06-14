import type { Express, Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

export function registerSettingsRoutes(app: Express): void {
  app.get("/api/settings/models", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const {
        AVAILABLE_MODELS,
        GLOBAL_MODEL_PREFERENCE_KEY,
        MODEL_DEFAULTS,
        buildGlobalModelPreferences,
        resolveGlobalModelPreference,
      } = await import("../lib/modelPrefs");
      const rows = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const prefs = rows[0]?.data as Record<string, unknown> | undefined;
      const stored = (prefs?.modelPreferences ?? {}) as Record<string, unknown>;
      const selectedModel = resolveGlobalModelPreference(stored) ?? MODEL_DEFAULTS.chat;
      res.json({
        modelPreferences: buildGlobalModelPreferences(selectedModel),
        selectedModel,
        globalModelPreferenceKey: GLOBAL_MODEL_PREFERENCE_KEY,
        availableModels: AVAILABLE_MODELS,
      });
    } catch (err) {
      console.error("[ModelPrefs] GET failed:", err);
      res.status(500).json({ error: "Failed to fetch model preferences" });
    }
  });

  app.patch("/api/settings/models", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { MODEL_DEFAULTS, buildGlobalModelPreferences, isValidModel } = await import("../lib/modelPrefs");
      const { category, model } = req.body as { category?: string; model?: string };
      const categories = Object.keys(MODEL_DEFAULTS);
      if (!category || !categories.includes(category)) {
        return res.status(400).json({ error: "Invalid category" });
      }
      if (!isValidModel(model)) {
        return res.status(400).json({ error: "Invalid model" });
      }
      const rows = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const existing = (rows[0]?.data ?? {}) as Record<string, unknown>;
      const existingModelPrefs = (existing.modelPreferences ?? {}) as Record<string, string>;
      const nextModelPrefs = { ...existingModelPrefs, ...buildGlobalModelPreferences(model) };
      const updated = {
        ...existing,
        modelPreferences: nextModelPrefs,
      };
      await db
        .insert(schema.userPreferences)
        .values({ userId, data: updated })
        .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { data: updated } });
      res.json({ ok: true, selectedModel: model, modelPreferences: nextModelPrefs });
    } catch (err) {
      console.error("[ModelPrefs] PATCH failed:", err);
      res.status(500).json({ error: "Failed to save model preference" });
    }
  });

  app.get("/api/settings/orchestrator", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { ORCHESTRATOR_MODELS, MODEL_DEFAULTS, resolveGlobalModelPreference } = await import("../lib/modelPrefs");
      const rows = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const prefs = rows[0]?.data as Record<string, unknown> | undefined;
      const stored = (prefs?.modelPreferences ?? {}) as Record<string, unknown>;
      const orchestratorModel = resolveGlobalModelPreference(stored) ?? MODEL_DEFAULTS.orchestrator;
      res.json({ orchestratorModel, selectedModel: orchestratorModel, availableOrchestratorModels: ORCHESTRATOR_MODELS });
    } catch (err) {
      console.error("[Orchestrator] GET failed:", err);
      res.status(500).json({ error: "Failed to fetch orchestrator settings" });
    }
  });

  app.patch("/api/settings/orchestrator", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { model } = req.body as { model?: string };
      const { buildGlobalModelPreferences, isValidModel } = await import("../lib/modelPrefs");
      const rows = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const existing = (rows[0]?.data ?? {}) as Record<string, unknown>;
      const existingModelPrefs = (existing.modelPreferences ?? {}) as Record<string, string>;
      const update: Record<string, unknown> = { ...existing };
      if (model) {
        if (!isValidModel(model)) {
          return res.status(400).json({ error: "Invalid model" });
        }
        update.modelPreferences = { ...existingModelPrefs, ...buildGlobalModelPreferences(model) };
      }
      await db
        .insert(schema.userPreferences)
        .values({ userId, data: update })
        .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { data: update } });
      res.json({ ok: true, selectedModel: model, modelPreferences: update.modelPreferences });
    } catch (err) {
      console.error("[Orchestrator] PATCH failed:", err);
      res.status(500).json({ error: "Failed to save orchestrator settings" });
    }
  });

  app.get("/api/settings/tts", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { getUserTtsPrefs, getUserTtsChannels } = await import("../agent/tools/tts");
      const [prefs, channels] = await Promise.all([
        getUserTtsPrefs(userId),
        getUserTtsChannels(userId),
      ]);
      return res.json({ voice: prefs.voice, latencyTier: prefs.latencyTier, ttsChannels: channels });
    } catch (err) {
      console.error("[TTS] GET settings failed:", err);
      return res.status(500).json({ error: "Failed to fetch TTS settings" });
    }
  });

  app.patch("/api/settings/tts", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { setUserTtsPref, setTtsChannels } = await import("../agent/tools/tts");
      const { voice, ttsChannels, latencyTier } = req.body as {
        voice?: string;
        ttsChannels?: string[];
        latencyTier?: number;
      };

      const updates: Partial<{ voice: string; latencyTier: 0 | 1 | 2 | 3 | 4 }> = {};
      if (voice !== undefined) updates.voice = voice;
      if (latencyTier !== undefined && [0, 1, 2, 3, 4].includes(latencyTier)) {
        updates.latencyTier = latencyTier as 0 | 1 | 2 | 3 | 4;
      }
      if (Object.keys(updates).length > 0) await setUserTtsPref(userId, updates);
      if (Array.isArray(ttsChannels)) await setTtsChannels(userId, ttsChannels);

      return res.json({ ok: true });
    } catch (err) {
      console.error("[TTS] PATCH settings failed:", err);
      return res.status(500).json({ error: "Failed to save TTS settings" });
    }
  });

  app.get("/api/tts/temp/:token", (req: Request, res: Response) => {
    const { token } = req.params as { token: string };
    import("../agent/tools/tts").then(({ consumeTempAudio }) => {
      const entry = consumeTempAudio(token);
      if (!entry) {
        return res.status(404).json({ error: "Audio file not found or expired" });
      }
      res.setHeader("Content-Type", entry.mimeType);
      res.setHeader("Content-Length", entry.buffer.length);
      res.setHeader("Cache-Control", "no-store");
      return res.send(entry.buffer);
    }).catch(() => res.status(500).json({ error: "Internal error" }));
  });

  app.get("/api/orchestration-traces", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const traces = await db
        .select()
        .from(schema.orchestrationTraces)
        .where(eq(schema.orchestrationTraces.userId, userId))
        .orderBy(desc(schema.orchestrationTraces.createdAt))
        .limit(20);
      res.json({ traces });
    } catch (err) {
      console.error("[Orchestrator] traces GET failed:", err);
      res.status(500).json({ error: "Failed to fetch traces" });
    }
  });
}
