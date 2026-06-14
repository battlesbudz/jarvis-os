import { getSelectedModelPreference } from "../lib/modelPrefs";

type SelectedModelResolver = (userId: string) => Promise<string | null>;

export async function getExplicitCoachRequestedModel(
  userId: string | null | undefined,
  resolveSelectedModel: SelectedModelResolver = getSelectedModelPreference,
): Promise<string | undefined> {
  if (!userId) return undefined;
  const selectedModel = await resolveSelectedModel(userId);
  const trimmed = typeof selectedModel === "string" ? selectedModel.trim() : "";
  return trimmed || undefined;
}
