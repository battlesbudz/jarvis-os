import type { AgentTool } from "../types";
import { setupDiscordWorkspace, getGuildsForUser } from "../../discord/manager";
import { WORKSPACE_TOPICS, DIGEST_CHANNEL } from "../../discord/workspace";
import { db } from "../../db";
import { channelLinks } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { DiscordLinkMeta } from "../../discord/manager";

const ALL_CHANNELS = [
  ...WORKSPACE_TOPICS.map((t) => `${t.emoji}${t.name}`),
  `${DIGEST_CHANNEL.emoji}${DIGEST_CHANNEL.name}`,
];

const channelList = ALL_CHANNELS.map((ch) => `• #${ch}`).join("\n");

export const setupDiscordWorkspaceTool: AgentTool = {
  name: "setup_discord_workspace",
  description:
    "Create the Jarvis Workspace in the user's Discord server. " +
    "This sets up a '🧠 Jarvis Workspace' category containing 7 organised topic channels: " +
    "📋tasks, 💰finance, 💡ideas, 💼business, 🌱personal, 🧠thinking, and 📰daily-digest. " +
    "Use this when the user asks to 'set up my workspace', 'create the Jarvis channels', " +
    "'set up Discord', 'create my workspace', or anything similar. " +
    "If the workspace already exists it is detected gracefully and the user is told so.",
  parameters: {
    type: "object",
    properties: {
      guildId: {
        type: "string",
        description:
          "Optional Discord server (guild) ID. If omitted, the bot's first connected server is used.",
      },
    },
    required: [],
  },

  async execute(args: { guildId?: string }, ctx) {
    const { userId } = ctx;

    // Resolve guild: use provided ID or fall back to first available guild
    let guildId = args.guildId ?? "";
    if (!guildId) {
      const guilds = getGuildsForUser(userId);
      if (guilds.length === 0) {
        return {
          ok: false,
          content:
            "Your Discord bot isn't running or isn't in any server yet. " +
            "Make sure you've added the bot to your server and that your bot token is saved.",
          label: "Discord workspace setup failed — bot not in any server",
        };
      }
      guildId = guilds[0].id;
    }

    // Check if a workspace is already configured for this guild
    const rows = await db
      .select()
      .from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
      .limit(1);

    const existingMeta = (rows[0]?.metadata as DiscordLinkMeta) ?? {};
    const existingWorkspace = existingMeta.workspace;

    if (existingWorkspace && existingWorkspace.guildId === guildId) {
      const count = Object.keys(existingWorkspace.channels).length;
      return {
        ok: true,
        content: [
          `ℹ️ Your Jarvis Workspace is already set up in **${existingWorkspace.guildName}**!`,
          ``,
          `**Category:** 🧠 Jarvis Workspace`,
          `**Channels (${count}):**`,
          channelList,
          ``,
          `Everything is ready — you can ask me to post to any of these channels anytime.`,
        ].join("\n"),
        label: `Discord workspace already exists in ${existingWorkspace.guildName}`,
        detail: JSON.stringify({
          alreadyExisted: true,
          guildId: existingWorkspace.guildId,
          categoryId: existingWorkspace.categoryId,
        }),
      };
    }

    // Workspace doesn't exist yet — create it
    const result = await setupDiscordWorkspace(userId, guildId);

    if (!result.ok) {
      // Race condition: another setup call is already in progress — treat as success
      if (result.error?.includes("already in progress")) {
        return {
          ok: true,
          content: "Workspace setup is already in progress — give it a moment and it will be ready!",
          label: "Discord workspace setup already in progress",
        };
      }
      return {
        ok: false,
        content: `Couldn't set up the workspace: ${result.error}`,
        label: "Discord workspace setup failed",
      };
    }

    const workspace = result.workspace!;
    const createdCount = Object.keys(workspace.channels).length;

    return {
      ok: true,
      content: [
        `✅ Your Jarvis Workspace has been created in **${workspace.guildName}**!`,
        ``,
        `**Category:** 🧠 Jarvis Workspace`,
        `**Channels created (${createdCount}):**`,
        channelList,
        ``,
        `Each channel has a welcome message and is ready to use. ` +
          `You can now ask me to post notes, plans, or updates to any of these channels.`,
      ].join("\n"),
      label: `Discord workspace created in ${workspace.guildName}`,
      detail: JSON.stringify({
        alreadyExisted: false,
        guildId: workspace.guildId,
        categoryId: workspace.categoryId,
      }),
    };
  },
};
