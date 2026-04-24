import { db } from "../db";
import { inboxItems } from "@shared/schema";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";

const NOTIFICATION_SUBJECTS: Record<string, string> = {
  morning_briefing: "Your morning briefing",
  meeting_brief: "Meeting briefing",
  email_alert: "Email alert",
  evening_wrap: "Evening wrap-up",
  commitment_check: "Commitment check",
  weekly_planning: "Weekly planning",
  approval_request: "Approval request",
  general: "Jarvis notification",
};

export const inAppChannel: Channel = {
  name: "in_app",
  isConfigured: () => true,
  isLinkedFor: async (_userId) => true,
  async sendMessage(userId, text, opts: ChannelSendOpts = {}): Promise<ChannelSendResult> {
    try {
      const notifType = opts.notificationType ?? "general";
      const sourceId = `in_app:${notifType}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      const subject = NOTIFICATION_SUBJECTS[notifType] ?? "Jarvis notification";
      await db.insert(inboxItems).values({
        userId,
        sourceType: "other",
        sourceId,
        subject,
        snippet: text.slice(0, 600),
        jarvisReason: `Notification (${notifType})`,
        suggestedActions: [{ label: "Dismiss", actionType: "dismiss" }],
        status: "pending",
      }).onConflictDoNothing();
      return { ok: true, messageId: sourceId };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};
