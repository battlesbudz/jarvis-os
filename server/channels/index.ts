import { registerChannel } from "./registry";
import { telegramChannel } from "./telegramChannel";
import { daemonChannel } from "./daemonChannel";
import { inAppChannel } from "./inAppChannel";
import { webchatChannel } from "./webchatChannel";

export function initChannels(): void {
  registerChannel(telegramChannel);
  registerChannel(daemonChannel);
  registerChannel(inAppChannel);
  registerChannel(webchatChannel);
  console.log("[channels] registered: telegram, daemon, in_app, webchat");
  console.log("[channels] WhatsApp, Slack, and Discord adapters are intentionally not registered; connect them through OneCLI/OAuth.");
}

export { notifyUser, getActiveChannelsFor, getAllPreferences, setPreference, getChannel, listChannels } from "./registry";
export { runCoachAgent } from "./coachAgent";
export type { Channel, ChannelAttachment, ChannelSendOpts, ChannelSendResult, ChannelName, NotificationType } from "./types";
