import { registerChannel } from "./registry";
import { telegramChannel } from "./telegramChannel";
import { whatsappChannel } from "./whatsappChannel";
import { slackChannel } from "./slackChannel";
import { daemonChannel } from "./daemonChannel";

export function initChannels(): void {
  registerChannel(telegramChannel);
  registerChannel(whatsappChannel);
  registerChannel(slackChannel);
  registerChannel(daemonChannel);
  console.log("[channels] registered: telegram, whatsapp, slack, daemon");
}

export { notifyUser, getActiveChannelsFor, getAllPreferences, setPreference, getChannel, listChannels } from "./registry";
export { runCoachAgent } from "./coachAgent";
export type { Channel, ChannelAttachment, ChannelSendOpts, ChannelSendResult, ChannelName, NotificationType } from "./types";
