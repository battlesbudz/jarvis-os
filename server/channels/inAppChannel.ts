import { db } from "../db";
import { inboxItems } from "@shared/schema";
import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";
import { outboundMiddleware } from "./outboundMiddleware";

const NOTIFICATION_SUBJECTS: Record<string, string> = {
  morning_briefing: "Your morning briefing",
  meeting_brief: "Meeting briefing",
  email_alert: "Email alert",
  evening_wrap: "Evening wrap-up",
  commitment_check: "Commitment check",
  weekly_planning: "Weekly planning",
  approval_request: "Notification",
  dream_insight: "Jarvis dreamed about you",
  general: "Jarvis notification",
};

// Notification types that manage their own inbox insertions with rich
// metadata. Skipping the generic in_app insert prevents duplicate items.
const SELF_MANAGED_INBOX_TYPES = new Set(["nervous_system"]);

export const inAppChannel: Channel = {
  name: "in_app",
  // Rich in-app chat — full coaching + email/calendar + research + media.
  toolGroups: ["coaching", "calendar", "email", "memory", "documents", "research", "connections", "scheduling", "media", "system", "self_edit", "browser", "mcp"],
  isConfigured: () => true,
  isLinkedFor: async (_userId) => true,
  async sendMessage(userId, text, opts: ChannelSendOpts = {}): Promise<ChannelSendResult> {
    try {
      const notifType = opts.notificationType ?? "general";
      if (SELF_MANAGED_INBOX_TYPES.has(notifType)) {
        return { ok: true };
      }
      // Run through outbound middleware (whitespace cleaner, length limiter, etc.)
      // before persisting to the inbox. Markdown normaliser passes through for in_app
      // since the mobile UI renders markdown natively.
      const processedText = await outboundMiddleware.run({ text, platform: "in_app", userId });
      if (processedText === null) {
        // A middleware handler cancelled delivery — skip insertion.
        return { ok: true };
      }
      const sourceId = `in_app:${notifType}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      const subject = NOTIFICATION_SUBJECTS[notifType] ?? "Jarvis notification";
      const suggestedActions: { label: string; actionType: string; payload?: Record<string, unknown> }[] =
        notifType === "approval_request" && opts.gateId
          ? [
              { label: "Review →", actionType: "review_approval", payload: { gateId: opts.gateId } },
              { label: "Dismiss", actionType: "dismiss" },
            ]
          : [{ label: "Dismiss", actionType: "dismiss" }];
      await db.insert(inboxItems).values({
        userId,
        sourceType: "other",
        sourceId,
        subject,
        snippet: processedText.slice(0, 600),
        jarvisReason: `Notification (${notifType})`,
        suggestedActions,
        status: "pending",
      }).onConflictDoNothing();
      return { ok: true, messageId: sourceId };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};
