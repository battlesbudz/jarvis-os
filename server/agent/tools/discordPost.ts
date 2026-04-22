import type { AgentTool } from "../types";
import { postToDiscordWorkspace, classifyTopic, WORKSPACE_TOPICS } from "../../discord/manager";

const topicList = WORKSPACE_TOPICS.map((t) => `\`${t.key}\` (${t.emoji} ${t.name})`).join(", ");

export const discordPostTool: AgentTool = {
  name: "discord_post",
  description:
    `Post a message or insight to a specific topic channel in the user's Jarvis Discord Workspace. ` +
    `Use this to log useful thoughts, plans, or progress notes that belong in a particular life area — ` +
    `so the user has an organised record in Discord. ` +
    `Available topics: ${topicList}. ` +
    `If unsure which topic fits, omit the topic and it will be auto-classified.`,
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
