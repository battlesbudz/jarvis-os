import type { AgentTool, ToolArgs } from "../types";
import { postToDiscordChannel } from "../../discord/manager";

export const discordSendToChannelTool: AgentTool = {
  name: "discord_send_to_channel",
  description:
    "Send a message to any channel in the user's Discord server by name. " +
    "Use this after discord_create_channel to post content into the newly created channel, " +
    "or any time the user asks you to post a message to a specific channel by name. " +
    "channelName should match the channel name exactly (lowercase, hyphens, e.g. 'test-research'). " +
    "Only post content sourced from real tool results — never post hallucinated content.",
  parameters: {
    type: "object",
    properties: {
      channelName: {
        type: "string",
        description:
          "The name of the target channel (lowercase, hyphens instead of spaces). " +
          "Must match an existing channel in the user's Discord server.",
      },
      message: {
        type: "string",
        description:
          "The message to post. Markdown is supported. Long messages are split into " +
          "multiple Discord messages automatically.",
      },
    },
    required: ["channelName", "message"],
  },
  async execute(args: ToolArgs, ctx) {
    const { channelName, message } = args as { channelName: string; message: string };
    const { userId } = ctx;
    const ok = await postToDiscordChannel(userId, channelName, null, message);

    if (!ok) {
      return {
        ok: false,
        content:
          `Could not post to #${channelName}. ` +
          "Check that the channel exists, the bot has access to it, and the Discord integration is running.",
        label: `Discord post to #${channelName} failed`,
      };
    }

    return {
      ok: true,
      content: `Posted to #${args.channelName}.`,
      label: `Discord → #${args.channelName}`,
    };
  },
};
