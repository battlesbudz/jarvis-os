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
  MODEL_CATEGORIES,
  MODEL_DEFAULTS,
  MODEL_OPTIONS,
  getModelsForCategory,
  isValidModelForCategory,
  type ModelCategory,
} from "@shared/modelProviderCatalog";
import { eq } from "drizzle-orm";

export type { ModelCategory } from "@shared/modelProviderCatalog";
export { CODEX_OAUTH_MODEL, MODEL_CATEGORIES, MODEL_DEFAULTS, MODEL_OPTIONS as AVAILABLE_MODELS, isValidModelForCategory };

export const ORCHESTRATOR_MODELS = getModelsForCategory("orchestrator");
export const GLOBAL_MODEL_PREFERENCE_KEY = "selectedModel";
const MODEL_CATEGORY_KEYS = MODEL_CATEGORIES.map((category) => category.key);

export type AvailableModel = (typeof MODEL_OPTIONS)[number]["value"];
export type OrchestratorModel = (typeof ORCHESTRATOR_MODELS)[number]["value"];

/** True for any catalog model Jarvis can select globally. */
export function isValidModel(value: unknown): value is AvailableModel {
  return typeof value === "string" && MODEL_OPTIONS.some((model) => model.value === value);
}

/** True only for catalog models usable by the orchestrator. */
export function isValidOrchestratorModel(value: unknown): value is OrchestratorModel {
  return isValidModelForCategory(value, "orchestrator");
}

export function buildGlobalModelPreferences(model: string): Record<string, string> {
  return {
    [GLOBAL_MODEL_PREFERENCE_KEY]: model,
    ...Object.fromEntries(MODEL_CATEGORY_KEYS.map((category) => [category, model])),
  };
}

export function resolveGlobalModelPreference(
  modelPrefs: Record<string, unknown> | undefined | null,
): string | null {
  if (!modelPrefs) return null;

  const explicit = modelPrefs[GLOBAL_MODEL_PREFERENCE_KEY];
  if (isValidModel(explicit)) return explicit;

  for (const category of MODEL_CATEGORY_KEYS) {
    const candidate = modelPrefs[category];
    if (isValidModel(candidate) && candidate !== MODEL_DEFAULTS[category]) return candidate;
  }

  for (const category of MODEL_CATEGORY_KEYS) {
    const candidate = modelPrefs[category];
    if (isValidModel(candidate)) return candidate;
  }

  return null;
}

async function readUserModelPreferences(userId: string): Promise<Record<string, unknown> | null> {
  if (!userId) return null;
  const { db } = await import("../db");
  const rows = await db
    .select({ data: userPreferences.data })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  const prefs = rows[0]?.data as Record<string, unknown> | undefined;
  const modelPrefs = prefs?.modelPreferences;
  return modelPrefs && typeof modelPrefs === "object" ? modelPrefs as Record<string, unknown> : null;
}

export async function getSelectedModelPreference(userId: string): Promise<string | null> {
  try {
    return resolveGlobalModelPreference(await readUserModelPreferences(userId));
  } catch {
    return null;
  }
}

export async function saveSelectedModelPreference(userId: string, model: string): Promise<Record<string, string>> {
  if (!userId) throw new Error("userId is required");
  if (!isValidModel(model)) throw new Error("Invalid model");

  const { db } = await import("../db");
  const rows = await db
    .select({ data: userPreferences.data })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  const existing = (rows[0]?.data ?? {}) as Record<string, unknown>;
  const existingModelPrefs = (existing.modelPreferences ?? {}) as Record<string, string>;
  const nextModelPrefs = { ...existingModelPrefs, ...buildGlobalModelPreferences(model) };
  const updated = {
    ...existing,
    modelPreferences: nextModelPrefs,
  };

  await db
    .insert(userPreferences)
    .values({ userId, data: updated })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { data: updated } });

  return nextModelPrefs;
}

/**
 * Return the model string for a given user + category.
 * A selected model is global: chat, planning, memory, research, orchestrator,
 * scheduled jobs, and agent turns must not silently diverge by category.
 */
export async function getModel(userId: string, category: ModelCategory): Promise<string> {
  if (!userId) return MODEL_DEFAULTS[category];
  try {
    const modelPrefs = await readUserModelPreferences(userId);
    const selected = resolveGlobalModelPreference(modelPrefs);
    if (selected) return selected;
    const pref = modelPrefs?.[category];
    if (isValidModelForCategory(pref, category)) return pref as string;
  } catch {
    // silently fall through
  }
  return MODEL_DEFAULTS[category];
}
