import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks } from "@shared/schema";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER; // e.g. "whatsapp:+14155238886"

export function isTwilioConfigured(): boolean {
  return !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);
}

export async function sendWhatsAppMessage(toAddress: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  if (!isTwilioConfigured()) return { ok: false, error: "twilio not configured" };
  const to = toAddress.startsWith("whatsapp:") ? toAddress : `whatsapp:${toAddress}`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ From: TWILIO_FROM!, To: to, Body: body });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: `${data.message || "twilio error"} (code ${data.code || res.status})` };
    }
    return { ok: true, sid: data.sid };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function lookupAddress(userId: string): Promise<string | null> {
  try {
    const rows = await db.select({ address: channelLinks.address })
      .from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "whatsapp")))
      .limit(1);
    return rows[0]?.address ?? null;
  } catch (err) {
    console.error("[whatsappChannel] link lookup failed:", err);
    return null;
  }
}

export const whatsappChannel: Channel = {
  name: "whatsapp",
  isConfigured: () => isTwilioConfigured(),
  isLinkedFor: async (userId) => !!(await lookupAddress(userId)),
  async sendMessage(userId, text, opts: ChannelSendOpts = {}) {
    const address = await lookupAddress(userId);
    if (!address) return { ok: false, error: "no whatsapp link" };
    let body = text || "";
    if (opts.attachments && opts.attachments.length > 0) {
      body = body
        ? `${body}\n\n(${opts.attachments.length} attachment(s) generated — open the GamePlan app to download.)`
        : `(${opts.attachments.length} attachment(s) generated — open the GamePlan app to download.)`;
    }
    const result = await sendWhatsAppMessage(address, body);
    return { ok: result.ok, messageId: result.sid, error: result.error };
  },
};
