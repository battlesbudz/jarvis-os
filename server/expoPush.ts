import { db } from "./db";
import { userPreferences } from "@shared/schema";
import { eq } from "drizzle-orm";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(token: string): boolean {
  return (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["))
  );
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
      console.error(`[expoPush] Expo push API error ${res.status}: ${text}`);
    }
  } catch (err) {
    console.error("[expoPush] Failed to send push notification:", err);
  }
}
