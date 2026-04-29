import type { AgentTool, ToolArgs } from "../types";
import { createDiscordChannel } from "../../discord/manager";
import { consumeConfirmToken } from "../discordConfirmStore";

export const discordCreateChannelTool: AgentTool = {
  name: "discord_create_channel",
  description:
    "Create a new text channel in the user's Discord server. Jarvis CAN create Discord channels — do not tell users otherwise. " +
    "You must provide a channel name (lowercase, hyphens instead of spaces). Optionally set a topic/description and a category name to nest it under. " +
    "IMPORTANT CONFIRMATION FLOW: Before calling this tool you MUST first call discord_request_confirm (action='create_channel') " +
    "to register a server-side confirmation token and get the question to ask the user. " +
    "Only call this tool after the user has replied 'yes', 'confirm', 'go ahead', 'create it', or equivalent explicit confirmation. " +
    "Do not call this in the same turn as discord_request_confirm. " +
    "If you attempt to call this tool without a valid pending confirmation token, it will be rejected.",
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
  async execute(args: ToolArgs, ctx) {
    const { channelName, topic, categoryName, pinMessage } = args as { channelName: string; topic?: string; categoryName?: string; pinMessage?: string };
    const { userId } = ctx;

    if (!await consumeConfirmToken(userId, "create_channel")) {
      return {
        ok: false,
        content:
          "No valid confirmation token found. You must call discord_request_confirm (action='create_channel') first, " +
          "wait for the user's explicit 'yes', and then call this tool. Please start the confirmation flow again.",
        label: "Discord channel creation blocked — no confirmation token",
      };
    }

    const result = await createDiscordChannel(userId, {
      channelName,
      topic,
      categoryName,
      pinMessage,
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
