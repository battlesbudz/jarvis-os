import { registerChannel } from "./registry";
import { telegramChannel } from "./telegramChannel";
import { whatsappChannel } from "./whatsappChannel";
import { slackChannel } from "./slackChannel";
import { daemonChannel } from "./daemonChannel";
import { discordChannel } from "./discordChannel";
import { inAppChannel } from "./inAppChannel";

export function initChannels(): void {
  registerChannel(telegramChannel);
  registerChannel(whatsappChannel);
  registerChannel(slackChannel);
  registerChannel(daemonChannel);
  registerChannel(discordChannel);
  registerChannel(inAppChannel);
  console.log("[channels] registered: telegram, whatsapp, slack, daemon, discord, in_app");
}

export { notifyUser, getActiveChannelsFor, getAllPreferences, setPreference, getChannel, listChannels } from "./registry";
export { runCoachAgent } from "./coachAgent";
export type { Channel, ChannelAttachment, ChannelSendOpts, ChannelSendResult, ChannelName, NotificationType } from "./types";
