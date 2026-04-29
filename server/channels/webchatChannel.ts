import type { Channel, ChannelSendOpts, ChannelSendResult } from "./types";
import { inAppChannel } from "./inAppChannel";

/**
 * Webchat channel — represents users active on the /chat web interface.
 *
 * For background job delivery, we route through in_app (inbox) since there
 * is no persistent SSE push connection between background jobs and the web
 * session. When the user is actively on the /chat page, messages arrive via
 * the synchronous SSE stream from /api/coach/chat; this channel handles the
 * asynchronous notification path (e.g. job completion while the tab is open
 * or after it has been closed).
 */
export const webchatChannel: Channel = {
  name: "webchat",
  toolGroups: ["coaching", "calendar", "email", "memory", "documents", "research", "connections", "scheduling", "media", "system", "self_edit", "browser", "mcp"],
  isConfigured: () => true,
  isLinkedFor: async (_userId) => true,
  async sendMessage(userId: string, text: string, opts: ChannelSendOpts = {}): Promise<ChannelSendResult> {
    return inAppChannel.sendMessage(userId, text, opts);
  },
};
