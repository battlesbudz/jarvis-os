import type { AgentTool, ToolArgs } from "../types";
import { setConfirmToken, type DiscordConfirmAction } from "../discordConfirmStore";

export const discordRequestConfirmTool: AgentTool = {
  name: "discord_request_confirm",
  description:
    "Register a server-side pending-confirmation token and return the exact confirmation question to show the user. " +
    "Call this tool INSTEAD OF asking the user directly when you need confirmation before creating a Discord channel or posting to Discord. " +
    "The token expires in 5 minutes — if the user takes too long to reply you will need to call this tool again. " +
    "After calling this tool, relay the returned question to the user verbatim and wait for their explicit reply " +
    "('yes', 'confirm', 'go ahead', 'create it', or equivalent) before calling discord_create_channel or discord_post. " +
    "Do NOT call discord_create_channel or discord_post in the same turn as this tool.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create_channel", "post"],
        description: "The Discord action requiring confirmation: 'create_channel' or 'post'.",
      },
      question: {
        type: "string",
        description:
          "The confirmation question to show the user, e.g. \"Should I create the channel #daily-tasks?\" or \"Should I post this summary to your Discord workspace?\"",
      },
    },
    required: ["action", "question"],
  },
  async execute(args: ToolArgs, ctx) {
    const { action, question } = args as { action: DiscordConfirmAction; question: string };
    const { userId } = ctx;
    await setConfirmToken(userId, action);
    return {
      ok: true,
      content: question,
      label: `Discord: awaiting confirmation for ${action}`,
    };
  },
};
