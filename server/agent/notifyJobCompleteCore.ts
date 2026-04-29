/**
 * Channel-routing logic for job-completion notifications.
 *
 * Extracted into its own module so unit tests can import it directly
 * without pulling in the heavy `jobQueue.ts` dependency chain.
 */

import type { Channel, ChannelSendResult } from "../channels/types";
import {
  SIMPLE_ORIGIN_CHANNELS,
  type ChannelName,
  type NotificationType,
  type SimpleOriginChannel,
} from "@shared/schema";
import type { AgentJobType } from "./jobClient";

export type { AgentJobType };

export interface NotifyJobCompleteDeps {
  getChannel(name: ChannelName): Channel | undefined;
  postToDiscordChannelById(userId: string, channelId: string, text: string): Promise<boolean>;
  sendToDiscordUser(userId: string, text: string): Promise<boolean>;
  notifyUser(
    userId: string,
    notificationType: NotificationType,
    text: string,
  ): Promise<{ channel: ChannelName; result: ChannelSendResult }[]>;
}

/** Type guard: returns true when `s` is one of the canonical simple origins. */
function isSimpleOrigin(s: string): s is SimpleOriginChannel {
  return (SIMPLE_ORIGIN_CHANNELS as readonly string[]).includes(s);
}

/**
 * Core channel-routing logic for job-completion notifications.
 *
 * Routes the notification back to the channel that originated the job:
 *   - "discord*"  → postToDiscordChannelById (+ DM fallback) + in_app
 *   - "telegram"  → telegram + in_app
 *   - "app" / "coach" / "appchat" / "voice" → in_app only
 *   - undefined / unrecognised → notifyUser (user's configured preferences)
 *
 * All four external dependencies are injected so tests can mock them without
 * needing Jest module mocking — just pass mock implementations directly.
 *
 * Exhaustiveness guarantee
 * ────────────────────────
 * The switch below covers every value in SimpleOriginChannel.  Its default
 * branch contains a `never` assertion so TypeScript raises a compile-time error
 * if a new value is added to SIMPLE_ORIGIN_CHANNELS without a matching case.
 */
export async function _notifyJobCompleteCore(
  userId: string,
  agentType: AgentJobType,
  title: string,
  body: string,
  originChannel: string | undefined,
  originDiscordChannelId: string | undefined,
  deps: NotifyJobCompleteDeps,
): Promise<void> {
  const {
    getChannel,
    postToDiscordChannelById,
    sendToDiscordUser,
    notifyUser,
  } = deps;

  const text = `Jarvis (${agentType}): ${title}\n\n${body}`;
  const origin = (originChannel ?? "").toLowerCase();

  try {
    // Discord is handled via prefix match because callers pass strings like
    // "Discord #general" — it cannot be part of the simple-origin union.
    if (origin.startsWith("discord")) {
      const notified: string[] = [];
      if (originDiscordChannelId) {
        const sent = await postToDiscordChannelById(userId, originDiscordChannelId, text);
        if (sent) {
          notified.push(`discord:channel:${originDiscordChannelId}`);
        } else {
          const dmSent = await sendToDiscordUser(userId, text);
          if (dmSent) notified.push("discord:dm");
        }
      } else {
        const dmSent = await sendToDiscordUser(userId, text);
        if (dmSent) notified.push("discord:dm");
      }
      const inAppCh = getChannel("in_app");
      if (inAppCh) {
        await inAppCh.sendMessage(userId, text, { notificationType: "approval_request" }).catch(() => {});
        notified.push("in_app");
      }
      console.log(`[JobQueue] notifyJobComplete originChannel=${originChannel} → [${notified.join(", ") || "none"}]`);
      return;
    }

    // All remaining recognised origins are in SIMPLE_ORIGIN_CHANNELS.
    // The switch is exhaustive over SimpleOriginChannel: TypeScript will
    // error on the `never` assertion below if a new value is added to
    // SIMPLE_ORIGIN_CHANNELS without a corresponding case here.
    if (isSimpleOrigin(origin)) {
      switch (origin) {
        case "telegram": {
          const notified: string[] = [];
          const telegramCh = getChannel("telegram");
          if (telegramCh) {
            const r = await telegramCh.sendMessage(userId, text, { notificationType: "approval_request" }).catch(() => ({ ok: false as const }));
            if (r.ok) notified.push("telegram");
          }
          const inAppCh = getChannel("in_app");
          if (inAppCh) {
            await inAppCh.sendMessage(userId, text, { notificationType: "approval_request" }).catch(() => {});
            notified.push("in_app");
          }
          console.log(`[JobQueue] notifyJobComplete originChannel=${originChannel} → [${notified.join(", ") || "none"}]`);
          return;
        }

        case "app":
        case "coach":
        case "appchat":
        case "voice":
        case "webchat": {
          const inAppCh = getChannel("in_app");
          if (inAppCh) {
            await inAppCh.sendMessage(userId, text, { notificationType: "approval_request" }).catch(() => {});
          }
          console.log(`[JobQueue] notifyJobComplete originChannel=${originChannel} → [in_app]`);
          return;
        }

        default: {
          // Exhaustiveness check — this line must never be reachable at runtime.
          // If TypeScript reports an error here, a new SimpleOriginChannel value
          // was added to SIMPLE_ORIGIN_CHANNELS in shared/schema.ts without a
          // matching case in this switch.  Add the case above to fix it.
          const _exhaustive: never = origin;
          console.warn(`[JobQueue] unhandled simple origin: ${_exhaustive}`);
        }
      }
    }

    // origin is undefined, empty, or an unrecognised string — fall back to the
    // user's configured notification preferences.
    const results = await notifyUser(userId, "approval_request", text);
    const delivered = results.filter((r) => r.result.ok).map((r) => r.channel).join(", ");
    console.log(`[JobQueue] notifyJobComplete originChannel=${originChannel || "none"} → [${delivered || "none"}]`);
  } catch (err) {
    console.error("[JobQueue] notify failed:", err);
  }
}
