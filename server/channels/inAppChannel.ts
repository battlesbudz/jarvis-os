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
  dream_insight: "Jarvis dreamed about you",
  general: "Jarvis notification",
};

// Notification types that manage their own inbox insertions with rich
// metadata. Skipping the generic in_app insert prevents duplicate items.
const SELF_MANAGED_INBOX_TYPES = new Set(["nervous_system"]);

export const inAppChannel: Channel = {
  name: "in_app",
  // Rich in-app chat — full coaching + email/calendar + research + media.
  toolGroups: ["coaching", "calendar", "email", "memory", "documents", "research", "connections", "scheduling", "media", "system"],
  isConfigured: () => true,
  isLinkedFor: async (_userId) => true,
  async sendMessage(userId, text, opts: ChannelSendOpts = {}): Promise<ChannelSendResult> {
    try {
      const notifType = opts.notificationType ?? "general";
      if (SELF_MANAGED_INBOX_TYPES.has(notifType)) {
        return { ok: true };
      }
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
