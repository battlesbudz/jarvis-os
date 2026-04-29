import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";
import { inAppChannel } from "./inAppChannel";
import { hasSubscriber, pushToSubscriber } from "../webchatSSE";

/**
 * Webchat channel — represents users active on the /chat web interface.
 *
 * When the user has the /chat tab open an SSE connection is maintained at
 * GET /api/webchat/events. sendMessage() pushes there first so background
 * job results, morning briefings, and other async notifications appear
 * instantly in the active chat window. If no SSE subscriber is registered
 * (tab closed / not open) the message falls back to the in_app inbox so
 * it is never lost.
 */
export const webchatChannel: Channel = {
  name: "webchat",
  toolGroups: ["coaching", "calendar", "email", "memory", "documents", "research", "connections", "scheduling", "media", "system", "self_edit", "browser", "mcp"],
  isConfigured: () => true,
  isLinkedFor: async (_userId) => true,
  async sendMessage(userId: string, text: string, opts: ChannelSendOpts = {}): Promise<ChannelSendResult> {
    if (hasSubscriber(userId)) {
      const delivered = pushToSubscriber(userId, text);
      if (delivered) {
        console.log(`[WebchatSSE] Pushed message to active SSE subscriber for user ${userId}`);
        return { ok: true };
      }
    }
    return inAppChannel.sendMessage(userId, text, opts);
  },
};
