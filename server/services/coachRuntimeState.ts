import { eq } from "drizzle-orm";
import { userPreferences } from "@shared/schema";
import { db } from "../db";
import type { VoiceRuntimeIncidentBundle } from "../agent/voiceRuntimeResourceCore";

type ScreenshotEntry = {
  data: Buffer;
  expires: number;
};

type PendingCoachResponseExecutedAction = {
  tool: string;
  result: "success" | "error";
  label: string;
  detail?: string;
};

type PendingCoachResponseOptions = {
  clearPendingConfirmationToken?: string;
  executedAction?: PendingCoachResponseExecutedAction;
  voiceRestore?: {
    incidentId: string;
    prompt: string;
    recap: string;
    createdAt?: number;
  };
};

const screenshotStore = new Map<string, ScreenshotEntry>();

const screenshotCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of screenshotStore) {
    if (entry.expires < now) screenshotStore.delete(id);
  }
}, 5 * 60 * 1000);
(screenshotCleanupInterval as unknown as { unref?: () => void }).unref?.();

export function getDaemonScreenshot(id: string): ScreenshotEntry | undefined {
  return screenshotStore.get(id);
}

export function storeDaemonScreenshot(id: string, data: Buffer, ttlMs = 30 * 60 * 1000): void {
  screenshotStore.set(id, { data, expires: Date.now() + ttlMs });
}

export async function savePendingCoachResponse(
  userId: string,
  text: string,
  screenshotUrl?: string,
  options: PendingCoachResponseOptions = {},
): Promise<void> {
  const id = `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, userId));
  const prefs = (rows[0]?.data as any) || {};
  const payload: any = { id, text, createdAt: Date.now() };
  if (screenshotUrl) payload.screenshotUrl = screenshotUrl;
  if (options.clearPendingConfirmationToken) payload.clearPendingConfirmationToken = options.clearPendingConfirmationToken;
  if (options.executedAction) payload.executedAction = options.executedAction;
  if (options.voiceRestore) payload.voiceRestore = options.voiceRestore;
  await db.insert(userPreferences).values({ userId, data: { ...prefs, pendingResponse: payload } })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { data: { ...prefs, pendingResponse: payload } } });
}

export async function consumePendingCoachResponse(userId: string): Promise<{
  id?: string;
  text: string | null;
  screenshotUrl?: string | null;
  clearPendingConfirmationToken?: string | null;
  executedAction?: PendingCoachResponseExecutedAction | null;
  voiceRestore?: {
    incidentId: string;
    prompt: string;
    recap: string;
    createdAt?: number;
  } | null;
}> {
  const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, userId));
  const prefs = (rows[0]?.data as any) || {};
  const pending = prefs.pendingResponse;
  const oneHour = 60 * 60 * 1000;
  if (pending && pending.createdAt && (Date.now() - pending.createdAt) < oneHour && pending.text) {
    const updated = { ...prefs, pendingResponse: null };
    await db.update(userPreferences).set({ data: updated }).where(eq(userPreferences.userId, userId));
    return {
      id: pending.id,
      text: pending.text,
      screenshotUrl: pending.screenshotUrl || null,
      clearPendingConfirmationToken: pending.clearPendingConfirmationToken || null,
      executedAction: pending.executedAction || null,
      voiceRestore: pending.voiceRestore || null,
    };
  }
  return { text: null };
}

export function buildPendingVoiceRestorePayload(input: {
  incident: VoiceRuntimeIncidentBundle;
  prompt: string;
  recap: string;
  createdAt?: number;
}): NonNullable<PendingCoachResponseOptions["voiceRestore"]> {
  return {
    incidentId: input.incident.id,
    prompt: input.prompt,
    recap: input.recap,
    createdAt: input.createdAt ?? Date.now(),
  };
}
