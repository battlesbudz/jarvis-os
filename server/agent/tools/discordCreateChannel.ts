import type { AgentTool } from "../types";
import { createDiscordChannel } from "../../discord/manager";

export const discordCreateChannelTool: AgentTool = {
  name: "discord_create_channel",
  description:
    "Create a new text channel in the user's Discord server. Use this when the user asks Jarvis to create a Discord channel. " +
    "You must provide a channel name (lowercase, hyphens instead of spaces). Optionally set a topic/description and a category name to nest it under. " +
    "IMPORTANT: Only call this after the user has replied 'yes', 'confirm', 'go ahead', 'create it', or equivalent explicit confirmation in response to your question 'Should I create the channel #<name>?'. Do not call this in the same turn as asking for confirmation.",
  parameters: {
    type: "object",
    properties: {
      channelName: {
        type: "string",
        description: "The channel name. Use lowercase letters, numbers, and hyphens only (e.g. 'welcome', 'daily-tasks', 'project-alpha').",
      },
      topic: {
        type: "string",
        description: "Optional channel topic/description shown at the top of the channel.",
      },
      categoryName: {
        type: "string",
        description: "Optional name of an existing category to put this channel in.",
      },
      pinMessage: {
        type: "string",
        description: "Optional message to send and pin in the new channel.",
      },
    },
    required: ["channelName"],
  },
  async execute(args: { channelName: string; topic?: string; categoryName?: string; pinMessage?: string }, ctx) {
    const { userId } = ctx;
    const result = await createDiscordChannel(userId, {
      channelName: args.channelName,
      topic: args.topic,
      categoryName: args.categoryName,
      pinMessage: args.pinMessage,
      ctxGuildId: ctx.discordGuildId,
    });

    if (!result.ok) {
      return {
        ok: false,
        content: `Couldn't create the channel: ${result.error}`,
        label: "Discord channel creation failed",
      };
    }

    return {
      ok: true,
      content: `Created #${args.channelName} in your Discord server.${args.pinMessage ? " Pinned the intro message." : ""}`,
      label: `Discord: created #${args.channelName}`,
    };
  },
};
