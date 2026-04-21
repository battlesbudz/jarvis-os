import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { channelLinks, channelLinkCodes } from "@shared/schema";
import express from "express";
import { runCoachAgent } from "./coachAgent";
import { sendWhatsAppMessage, isTwilioConfigured } from "./whatsappChannel";

async function findUserByPhone(phone: string): Promise<string | null> {
  try {
    const rows = await db.select({ userId: channelLinks.userId })
      .from(channelLinks)
      .where(and(eq(channelLinks.channel, "whatsapp"), eq(channelLinks.address, phone)))
      .limit(1);
    return rows[0]?.userId ?? null;
  } catch (err) {
    console.error("[whatsapp] user lookup failed:", err);
    return null;
  }
}

async function tryConsumeLinkCode(code: string, phone: string): Promise<string | null> {
  try {
    const rows = await db.select().from(channelLinkCodes)
      .where(and(eq(channelLinkCodes.code, code), eq(channelLinkCodes.channel, "whatsapp")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await db.delete(channelLinkCodes).where(eq(channelLinkCodes.code, code));
      return null;
    }
    await db.insert(channelLinks).values({
      userId: row.userId, channel: "whatsapp", address: phone, metadata: {},
    }).onConflictDoUpdate({
      target: [channelLinks.channel, channelLinks.address],
      set: { userId: row.userId, lastSeenAt: new Date() },
    });
    await db.delete(channelLinkCodes).where(eq(channelLinkCodes.code, code));
    return row.userId;
  } catch (err) {
    console.error("[whatsapp] link code consume failed:", err);
    return null;
  }
}

export function registerWhatsAppWebhook(app: Express): void {
  // Twilio sends application/x-www-form-urlencoded
  app.post("/api/channels/whatsapp/webhook", express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
    if (!isTwilioConfigured()) {
      return res.status(503).type("text/xml").send("<Response/>");
    }
    const from = String(req.body?.From || ""); // e.g. "whatsapp:+1234567890"
    const text = String(req.body?.Body || "").trim();
    res.type("text/xml").status(200).send("<Response/>"); // ack immediately

    if (!from) return;

    let userId = await findUserByPhone(from);

    if (!userId) {
      // Treat short alphanumeric strings as link codes
      const codeMatch = text.match(/^[A-Z0-9]{6,8}$/i);
      if (codeMatch) {
        const linked = await tryConsumeLinkCode(text.toUpperCase(), from);
        if (linked) {
          await sendWhatsAppMessage(from, "✅ You're connected to GamePlan! Jarvis can now reach you here. Send a message any time.");
          return;
        }
        await sendWhatsAppMessage(from, "That code didn't work or has expired. Open the GamePlan app → Profile → Connected Channels → WhatsApp to generate a fresh one.");
        return;
      }
      await sendWhatsAppMessage(from, "Welcome to GamePlan Coach! To connect, open the app → Profile → Connected Channels → WhatsApp, generate a link code, and send it here.");
      return;
    }

    if (!text) {
      await sendWhatsAppMessage(from, "I got that but couldn't read any text. Try again?");
      return;
    }

    try {
      const { reply } = await runCoachAgent({ userId, userText: text, channelName: "WhatsApp" });
      if (reply && reply.trim()) {
        await sendWhatsAppMessage(from, reply);
      }
    } catch (err) {
      console.error("[whatsapp] coach error:", err);
      await sendWhatsAppMessage(from, "Sorry, I hit an error processing that. Please try again.");
    }
  });

  // Periodic cleanup
  const cleanup = setInterval(() => {
    db.delete(channelLinkCodes)
      .where(and(eq(channelLinkCodes.channel, "whatsapp"), sql`${channelLinkCodes.expiresAt} < NOW()`))
      .catch((err) => console.error("[whatsapp] code cleanup failed:", err));
  }, 5 * 60 * 1000) as unknown as NodeJS.Timeout;
  cleanup.unref();
}
