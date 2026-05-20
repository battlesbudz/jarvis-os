/**
 * Model Preferences
 *
 * Central helper for resolving which AI model to use per task category.
 * Reads from userPreferences.data.modelPreferences with hard-coded defaults.
 * Falls back silently on any DB error so callers never crash.
 */
import { userPreferences } from "@shared/schema";
import { eq } from "drizzle-orm";

export type ModelCategory = "chat" | "planning" | "memory" | "research" | "orchestrator";

export const CODEX_OAUTH_MODEL = "chatgpt-codex-oauth/auto";

export const MODEL_DEFAULTS: Record<ModelCategory, string> = {
  chat: CODEX_OAUTH_MODEL,
  planning: CODEX_OAUTH_MODEL,
  memory: CODEX_OAUTH_MODEL,
  research: CODEX_OAUTH_MODEL,
  orchestrator: CODEX_OAUTH_MODEL,
};

export const AVAILABLE_MODELS = [
  { value: CODEX_OAUTH_MODEL, label: "Codex OAuth", description: "Jarvis primary model through the local ChatGPT/Codex OAuth login" },
] as const;

export const ORCHESTRATOR_MODELS = [
  { value: CODEX_OAUTH_MODEL, label: "Codex OAuth", description: "Primary Jarvis orchestrator through the ChatGPT/Codex OAuth login" },
] as const;

export type AvailableModel = (typeof AVAILABLE_MODELS)[number]["value"];
export type OrchestratorModel = (typeof ORCHESTRATOR_MODELS)[number]["value"];

const VALID_OPENAI_MODEL_VALUES = new Set(AVAILABLE_MODELS.map((m) => m.value));
const VALID_ORCHESTRATOR_MODEL_VALUES = new Set(ORCHESTRATOR_MODELS.map((m) => m.value));

/** True only for the Codex OAuth model used by chat/planning/memory/research categories. */
export function isValidModel(value: unknown): value is AvailableModel {
  return typeof value === "string" && VALID_OPENAI_MODEL_VALUES.has(value as AvailableModel);
}

/** True only for Codex OAuth orchestrator models. */
export function isValidOrchestratorModel(value: unknown): value is OrchestratorModel {
  return typeof value === "string" && VALID_ORCHESTRATOR_MODEL_VALUES.has(value as OrchestratorModel);
}

/**
 * Validate a model value for a given category.
 * All Jarvis categories currently accept only the Codex OAuth model.
 */
export function isValidModelForCategory(value: unknown, category: ModelCategory): boolean {
  if (category === "orchestrator") return isValidOrchestratorModel(value);
  return isValidModel(value);
}

/**
 * Return the model string for a given user + category.
 * Uses category-aware validation and falls back to Codex OAuth when a legacy
 * stored preference names a direct provider.
 * Falls back to MODEL_DEFAULTS[category] if the preference is missing or the DB call fails.
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
