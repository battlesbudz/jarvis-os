import { eq } from "drizzle-orm";
import { userPreferences } from "@shared/schema";
import { db } from "../db";

type ScreenshotEntry = {
  data: Buffer;
  expires: number;
};

const screenshotStore = new Map<string, ScreenshotEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of screenshotStore) {
    if (entry.expires < now) screenshotStore.delete(id);
  }
}, 5 * 60 * 1000);

export function getDaemonScreenshot(id: string): ScreenshotEntry | undefined {
  return screenshotStore.get(id);
}

export function storeDaemonScreenshot(id: string, data: Buffer, ttlMs = 30 * 60 * 1000): void {
  screenshotStore.set(id, { data, expires: Date.now() + ttlMs });
}

export async function savePendingCoachResponse(userId: string, text: string, screenshotUrl?: string): Promise<void> {
  const id = `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, userId));
  const prefs = (rows[0]?.data as any) || {};
  const payload: any = { id, text, createdAt: Date.now() };
  if (screenshotUrl) payload.screenshotUrl = screenshotUrl;
  await db.insert(userPreferences).values({ userId, data: { ...prefs, pendingResponse: payload } })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { data: { ...prefs, pendingResponse: payload } } });
}

export async function consumePendingCoachResponse(userId: string): Promise<{
  id?: string;
  text: string | null;
  screenshotUrl?: string | null;
}> {
  const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, userId));
  const prefs = (rows[0]?.data as any) || {};
  const pending = prefs.pendingResponse;
  const oneHour = 60 * 60 * 1000;
  if (pending && pending.createdAt && (Date.now() - pending.createdAt) < oneHour && pending.text) {
    const updated = { ...prefs, pendingResponse: null };
    await db.update(userPreferences).set({ data: updated }).where(eq(userPreferences.userId, userId));
    return { id: pending.id, text: pending.text, screenshotUrl: pending.screenshotUrl || null };
  }
  return { text: null };
}
