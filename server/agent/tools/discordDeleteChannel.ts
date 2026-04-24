import type { AgentTool } from "../types";
import { deleteDiscordChannel } from "../../discord/manager";

export const discordDeleteChannelTool: AgentTool = {
  name: "discord_delete_channel",
  description:
    "Delete a text channel from the user's Discord server by name or ID. " +
    "IMPORTANT: You MUST first tell the user the exact channel name and server you will delete, " +
    "then wait for them to explicitly say yes/confirm before calling this tool with confirmed=true. " +
    "Only call with confirmed=true after the user has given explicit approval in this conversation. " +
    "If channelId is not known, pass channelName first — if there are duplicates, the tool will " +
    "return all matching channel IDs so you can ask the user which copy to remove. " +
    "Only text channels can be deleted; categories and voice channels are not supported.",
  parameters: {
    type: "object",
    properties: {
      confirmed: {
        type: "boolean",
        description:
          "REQUIRED. Must be true. Only pass true after the user has explicitly confirmed " +
          "the deletion (channel name + server) in this conversation. Never pass true speculatively.",
      },
      channelName: {
        type: "string",
        description:
          "The channel name to delete (e.g. 'thinking', '🧠thinking'). " +
          "Omit if channelId is provided. If multiple channels share this name the tool " +
          "will return a disambiguation list instead of deleting.",
      },
      channelId: {
        type: "string",
        description:
          "The exact Discord channel ID to delete. Preferred over channelName when " +
          "targeting one specific channel among duplicates.",
      },
      guildId: {
        type: "string",
        description:
          "Optional Discord server (guild) ID. Must match the user's linked Jarvis server — " +
          "deletion in any other server is refused.",
      },
    },
    required: ["confirmed"],
  },

  async execute(
    args: { confirmed?: boolean; channelName?: string; channelId?: string; guildId?: string },
    ctx,
  ) {
    const { userId } = ctx;

    // Hard confirmation gate — must be explicitly true
    if (!args.confirmed) {
      return {
        ok: false,
        content:
          "I need you to confirm the deletion first. Please tell me the channel name and server " +
          "you'd like to delete, and I'll ask for your approval before proceeding.",
        label: "discord_delete_channel: confirmation required",
      };
    }

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
      ctxGuildId: ctx.discordGuildId,
    });

    // Disambiguation: multiple channels share the same name
    if (result.ambiguous && result.matches) {
      const list = result.matches
        .map((m, i) => `${i + 1}. #${m.name} (ID: \`${m.id}\`)`)
        .join("\n");
      return {
        ok: false,
        content:
          `There are ${result.matches.length} channels named **#${args.channelName}**:\n${list}\n\n` +
          `Which one should I delete? Please confirm the channel ID and I'll remove it.`,
        label: `discord_delete_channel: ambiguous — ${result.matches.length} matches for "${args.channelName}"`,
      };
    }

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
