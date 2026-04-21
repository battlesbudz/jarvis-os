import { MEMORY_CATEGORIES, type MemoryCategory } from "@shared/schema";

export { MEMORY_CATEGORIES };
export type { MemoryCategory };

const LEGACY_TO_CANONICAL: Record<string, MemoryCategory> = {
  personality: "communication_style",
  work_style: "work_patterns",
  pattern: "work_patterns",
  accomplishment: "accomplishments",
  achievement: "accomplishments",
  goal: "goals_history",
  goal_discovered: "goals_history",
  relationship: "relationships",
  preference: "preferences",
};

export function normalizeCategory(raw: string | null | undefined): MemoryCategory {
  if (!raw) return "fact";
  const lower = raw.trim().toLowerCase();
  if ((MEMORY_CATEGORIES as readonly string[]).includes(lower)) {
    return lower as MemoryCategory;
  }
  return LEGACY_TO_CANONICAL[lower] || "fact";
}

export const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  work_patterns: "Work Patterns",
  communication_style: "Communication Style",
  energy_rhythms: "Energy & Rhythms",
  goals_history: "Goals (history)",
  relationships: "Key People",
  values: "Values & Motivations",
  blockers: "Blockers & Frictions",
  accomplishments: "Wins & Accomplishments",
  preferences: "Preferences",
  fact: "Other Facts",
};
