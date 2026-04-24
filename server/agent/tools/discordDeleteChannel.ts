import type { AgentTool } from "../types";
import { deleteDiscordChannel } from "../../discord/manager";

export const discordDeleteChannelTool: AgentTool = {
  name: "discord_delete_channel",
  description:
    "Delete a text channel from the user's Discord server by name or ID. " +
    "Use this when the user asks Jarvis to delete a channel, remove a duplicate channel, or clean up accidentally created channels. " +
    "You MUST confirm the channel name (and server if there is any ambiguity) with the user before calling this tool — deletion is permanent. " +
    "Only text channels can be deleted; categories and voice channels are not supported. " +
    "You can resolve duplicates by asking the user which copy to keep (e.g. 'which #thinking should I delete?') and then passing the channelId of the unwanted one.",
  parameters: {
    type: "object",
    properties: {
      channelName: {
        type: "string",
        description:
          "The channel name to delete (e.g. 'thinking', '🧠thinking'). " +
          "Provide either channelName or channelId — channelId is preferred when the user is targeting one specific channel among duplicates.",
      },
      channelId: {
        type: "string",
        description:
          "The exact Discord channel ID to delete. Prefer this over channelName when there are duplicates so the correct channel is targeted.",
      },
      guildId: {
        type: "string",
        description:
          "Optional Discord server (guild) ID. If omitted, the bot's first connected server is used.",
      },
    },
    required: [],
  },

  async execute(args: { channelName?: string; channelId?: string; guildId?: string }, ctx) {
    const { userId } = ctx;

    if (!args.channelName && !args.channelId) {
      return {
        ok: false,
        content: "Please specify either a channel name or a channel ID to delete.",
        label: "discord_delete_channel: missing channel identifier",
      };
    }

    const result = await deleteDiscordChannel(userId, {
      channelName: args.channelName,
      channelId: args.channelId,
      guildId: args.guildId,
    });

    if (!result.ok) {
      return {
        ok: false,
        content: `Couldn't delete the channel: ${result.error}`,
        label: "Discord channel deletion failed",
      };
    }

    return {
      ok: true,
      content: `✅ Deleted #${result.channelName} from your Discord server.`,
      label: `Discord: deleted #${result.channelName}`,
    };
  },
};
