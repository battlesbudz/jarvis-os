import { db } from "./db";
import { userPreferences } from "@shared/schema";
import { eq } from "drizzle-orm";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data: ExpoPushTicket[];
}

function isExpoPushToken(token: string): boolean {
  return (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["))
  );
}

async function clearExpoPushToken(userId: string): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    const current = rows[0]?.data as Record<string, unknown> | undefined;
    if (!current) return;

    const { expoPushToken: _removed, ...rest } = current;
    await db
      .update(userPreferences)
      .set({ data: rest, updatedAt: new Date() })
      .where(eq(userPreferences.userId, userId));

    console.log(`[expoPush] Cleared stale push token for user ${userId}`);
  } catch (err) {
    console.error("[expoPush] Failed to clear stale push token:", err);
  }
}

export async function sendExpoPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    const prefs = rows[0]?.data as Record<string, unknown> | undefined;
    const token = prefs?.expoPushToken as string | undefined;

    if (!token || !isExpoPushToken(token)) {
      return;
    }

    const payload = {
      to: token,
      title,
      body,
      data: data ?? {},
      sound: "default",
    };

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[expoPush] Expo push API HTTP error ${res.status}: ${text}`);
      return;
    }

    const json = await res.json().catch(() => null) as ExpoPushResponse | null;
    const ticket = json?.data?.[0];

    if (ticket?.status === "error") {
      const errCode = ticket.details?.error;
      console.error(
        `[expoPush] Expo push ticket error for user ${userId}: ${ticket.message ?? errCode}`
      );
      if (errCode === "DeviceNotRegistered") {
        await clearExpoPushToken(userId);
      }
    }
  } catch (err) {
    console.error("[expoPush] Failed to send push notification:", err);
  }
}
