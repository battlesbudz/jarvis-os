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

export const MODEL_DEFAULTS: Record<ModelCategory, string> = {
  chat: "gpt-4o-mini",
  planning: "gpt-4o-mini",
  memory: "gpt-4o-mini",
  research: "gpt-4.1-mini",
  orchestrator: "claude-opus-4-6",
};

export const AVAILABLE_MODELS = [
  { value: "gpt-5-mini", label: "Fast", description: "Quick responses, great for most tasks" },
  { value: "gpt-5.1", label: "Smart", description: "Better reasoning with balanced speed" },
  { value: "gpt-4.1-mini", label: "Capable", description: "Strong reasoning in a compact model" },
  { value: "gpt-4o", label: "Powerful", description: "Highest quality for complex tasks" },
  { value: "gpt-4o-mini", label: "Lightweight", description: "Efficient for high-volume tasks" },
] as const;

export const ORCHESTRATOR_MODELS = [
  { value: "claude-opus-4-6", label: "Claude Opus 4.6", description: "Primary mainframe AI - orchestrates every task" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7", description: "Newer flagship - alternative orchestrator" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet", description: "Balanced speed & quality" },
  { value: "claude-haiku-4-5", label: "Claude Haiku", description: "Fast, lightweight orchestration" },
] as const;

export type AvailableModel = (typeof AVAILABLE_MODELS)[number]["value"];
export type OrchestratorModel = (typeof ORCHESTRATOR_MODELS)[number]["value"];

const VALID_OPENAI_MODEL_VALUES = new Set(AVAILABLE_MODELS.map((m) => m.value));
const VALID_ORCHESTRATOR_MODEL_VALUES = new Set(ORCHESTRATOR_MODELS.map((m) => m.value));

/** True only for OpenAI models (used by chat/planning/memory/research categories). */
export function isValidModel(value: unknown): value is AvailableModel {
  return typeof value === "string" && VALID_OPENAI_MODEL_VALUES.has(value as AvailableModel);
}

/** True only for Anthropic/orchestrator models. */
export function isValidOrchestratorModel(value: unknown): value is OrchestratorModel {
  return typeof value === "string" && VALID_ORCHESTRATOR_MODEL_VALUES.has(value as OrchestratorModel);
}

/**
 * Validate a model value for a given category.
 * OpenAI categories only accept OpenAI models; orchestrator only accepts Claude models.
 */
export function isValidModelForCategory(value: unknown, category: ModelCategory): boolean {
  if (category === "orchestrator") return isValidOrchestratorModel(value);
  return isValidModel(value);
}

/**
 * Return the model string for a given user + category.
 * Uses category-aware validation: orchestrator-category preferences are validated against
 * the Anthropic model set; all other categories are validated against the OpenAI model set.
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
