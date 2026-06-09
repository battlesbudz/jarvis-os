/**
 * Model Preferences
 *
 * Central helper for resolving which AI model to use per task category.
 * Reads from userPreferences.data.modelPreferences with catalog-backed defaults.
 * Falls back silently on any DB error so callers never crash.
 */
import { userPreferences } from "@shared/schema";
import {
  CODEX_OAUTH_MODEL,
  MODEL_DEFAULTS,
  MODEL_OPTIONS,
  getModelsForCategory,
  isValidModelForCategory,
  type ModelCategory,
} from "@shared/modelProviderCatalog";
import { eq } from "drizzle-orm";

export type { ModelCategory } from "@shared/modelProviderCatalog";
export { CODEX_OAUTH_MODEL, MODEL_DEFAULTS, MODEL_OPTIONS as AVAILABLE_MODELS, isValidModelForCategory };

export const ORCHESTRATOR_MODELS = getModelsForCategory("orchestrator");

export type AvailableModel = (typeof MODEL_OPTIONS)[number]["value"];
export type OrchestratorModel = (typeof ORCHESTRATOR_MODELS)[number]["value"];

/** True for any catalog model usable by chat/planning/memory/research categories. */
export function isValidModel(value: unknown): value is AvailableModel {
  return typeof value === "string" && MODEL_OPTIONS.some((model) =>
    model.value === value && model.categories.some((category) => category !== "orchestrator")
  );
}

/** True only for catalog models usable by the orchestrator. */
export function isValidOrchestratorModel(value: unknown): value is OrchestratorModel {
  return isValidModelForCategory(value, "orchestrator");
}

/**
 * Return the model string for a given user + category.
 * Uses category-aware validation and falls back to Codex OAuth when a legacy
 * stored preference names an unsupported model.
 */
export async function getModel(userId: string, category: ModelCategory): Promise<string> {
  if (!userId) return MODEL_DEFAULTS[category];
  try {
    const { db } = await import("../db");
    const rows = await db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const prefs = rows[0]?.data as Record<string, unknown> | undefined;
    const modelPrefs = prefs?.modelPreferences as Record<string, string> | undefined;
    const pref = modelPrefs?.[category];
    if (isValidModelForCategory(pref, category)) return pref as string;
  } catch {
    // silently fall through
  }
  return MODEL_DEFAULTS[category];
}
