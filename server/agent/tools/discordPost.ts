import type { AgentTool } from "../types";
import { postToDiscordWorkspace, classifyTopic, WORKSPACE_TOPICS } from "../../discord/manager";
import { consumeConfirmToken } from "../discordConfirmStore";

const topicList = WORKSPACE_TOPICS.map((t) => `\`${t.key}\` (${t.emoji} ${t.name})`).join(", ");

export const discordPostTool: AgentTool = {
  name: "discord_post",
  description:
    `Post a message or insight to a specific topic channel in the user's Jarvis Discord Workspace. ` +
    `Use this to log useful thoughts, plans, or progress notes that belong in a particular life area — ` +
    `so the user has an organised record in Discord. ` +
    `Available topics: ${topicList}. ` +
    `If unsure which topic fits, omit the topic and it will be auto-classified. ` +
    `Only post content that has been generated from real tool results (research_topic, web_search, etc). Never post hallucinated content. Never post to #general or announcement channels without explicit user instruction. ` +
    `IMPORTANT CONFIRMATION FLOW: Before calling this tool you MUST first call discord_request_confirm (action='post') ` +
    `to register a server-side confirmation token and get the question to ask the user. ` +
    `Only call this tool after the user has replied with explicit confirmation. ` +
    `Do not call this in the same turn as discord_request_confirm. ` +
    `If you attempt to call this tool without a valid pending confirmation token, it will be rejected.`,
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "The message to post. Can include markdown formatting. Keep it concise and useful — this is a log entry, not a conversation reply.",
      },
      topic: {
        type: "string",
        enum: WORKSPACE_TOPICS.map((t) => t.key),
        description:
          "The workspace channel to post to. If omitted, the topic is inferred from the message content.",
      },
    },
    required: ["message"],
  },
  async execute(args: { message: string; topic?: string }, ctx) {
    const { userId } = ctx;

    if (!consumeConfirmToken(userId, "post")) {
      return {
        ok: false,
        content:
          "No valid confirmation token found. You must call discord_request_confirm (action='post') first, " +
          "wait for the user's explicit confirmation, and then call this tool. Please start the confirmation flow again.",
        label: "Discord post blocked — no confirmation token",
      };
    }

    const topicKey = args.topic ?? classifyTopic(args.message);
    const topicMeta = WORKSPACE_TOPICS.find((t) => t.key === topicKey);

    const posted = await postToDiscordWorkspace(userId, topicKey, args.message);

    if (!posted) {
      return {
        ok: false,
        content:
          "Couldn't post to Discord — the workspace may not be set up yet, or the bot isn't running. " +
          "Ask the user to go to Profile → Connected Channels → Discord → Setup Workspace.",
        label: "Discord post failed",
      };
    }

    return {
      ok: true,
      content: `Posted to ${topicMeta ? `${topicMeta.emoji} #${topicMeta.name}` : `#${topicKey}`} in your Discord workspace.`,
      label: `Discord → #${topicKey}`,
    };
  },
};
