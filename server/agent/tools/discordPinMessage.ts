import type { AgentTool } from "../types";
import { pinDiscordMessage } from "../../discord/manager";

export const discordPinMessageTool: AgentTool = {
  name: "discord_pin_message",
  description:
    "Pin a message in a Discord channel so it appears at the top for easy reference. " +
    "Use this when the user says 'pin that', when Jarvis creates a formal deliverable " +
    "(architecture document, research report, project plan), or when posting something " +
    "that should be permanently accessible in the channel.",
  parameters: {
    type: "object",
    properties: {
      channelId: {
        type: "string",
        description: "The Discord channel ID where the message was posted.",
      },
      messageId: {
        type: "string",
        description: "The Discord message ID to pin.",
      },
    },
    required: ["channelId", "messageId"],
  },
  async execute(args: { channelId: string; messageId: string }, ctx) {
    const { userId } = ctx;
    const pinned = await pinDiscordMessage(userId, args.channelId, args.messageId);

    if (!pinned) {
      return {
        ok: false,
        content: "Couldn't pin the message — the bot may not have the Manage Messages permission, or the message wasn't found.",
        label: "Pin failed",
      };
    }

    return {
      ok: true,
      content: `Message ${args.messageId} has been pinned in the channel.`,
      label: "Message pinned",
    };
  },
};
