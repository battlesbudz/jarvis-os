import type { AgentTool } from "../types";
import { getChannelsForGuild } from "../../discord/manager";
import { db } from "../../db";
import { channelLinks } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { DiscordLinkMeta } from "../../discord/manager";

export const discordListChannelsTool: AgentTool = {
  name: "discord_list_channels",
  description:
    "List all text channels in the user's linked Discord server and identify any duplicate channel names. " +
    "Use this FIRST whenever the user asks to scan for duplicates, clean up channels, or wants to know what channels exist. " +
    "Returns the full channel list plus a clearly-marked list of duplicate names so you can ask the user which ones to delete. " +
    "Do NOT use web search or background jobs for this — it reads directly from the Discord server.",
  parameters: {
    type: "object",
    properties: {
      guildId: {
        type: "string",
        description:
          "Optional Discord server ID to scan. If omitted, the user's linked Jarvis workspace server is used automatically.",
      },
    },
    required: [],
  },

  async execute(args: { guildId?: string }, ctx) {
    const { userId } = ctx;

    // Resolve guild ID: explicit arg > workspace metadata > ctx guild
    let resolvedGuildId = args.guildId;
    if (!resolvedGuildId) {
      const linkRow = await db
        .select()
        .from(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
        .limit(1);
      const linkMeta = (linkRow[0]?.metadata as DiscordLinkMeta) ?? {};
      resolvedGuildId = linkMeta.workspace?.guildId;
    }
    if (!resolvedGuildId && ctx.discordGuildId) {
      resolvedGuildId = ctx.discordGuildId;
    }

    if (!resolvedGuildId) {
      return {
        ok: false,
        content:
          "No linked Discord server found. Message Jarvis from inside your Discord server first so it can identify which server to scan.",
        label: "discord_list_channels: no guild",
      };
    }

    const channels = await getChannelsForGuild(userId, resolvedGuildId);

    if (channels.length === 0) {
      return {
        ok: false,
        content:
          "Could not fetch channels — the bot may not be in that server, or it may be offline. Check that the bot is running and has been added to the server.",
        label: "discord_list_channels: fetch failed",
      };
    }

    // Normalise a channel name to a plain ASCII slug for duplicate comparison
    // so "thinking", "#thinking", and "🧠thinking" all map to the same key.
    function slugify(name: string): string {
      return name
        .toLowerCase()
        .replace(/[^\w\s-]/g, "") // strip emoji and punctuation
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .trim();
    }

    // Group channels by slug to find duplicates
    const bySlug = new Map<string, typeof channels>();
    for (const ch of channels) {
      const slug = slugify(ch.name);
      const existing = bySlug.get(slug) ?? [];
      existing.push(ch);
      bySlug.set(slug, existing);
    }

    const duplicateGroups = [...bySlug.values()].filter((group) => group.length > 1);

    const totalCount = channels.length;
    const duplicateCount = duplicateGroups.reduce((s, g) => s + g.length, 0);

    // Build readable output
    const allLines = channels.map((ch) => `#${ch.name} (ID: ${ch.id})`).join("\n");

    let duplicateSection = "";
    if (duplicateGroups.length === 0) {
      duplicateSection = "No duplicate channel names found.";
    } else {
      duplicateSection = duplicateGroups
        .map((group) => {
          const header = `Duplicate: "${group[0].name}" — ${group.length} copies`;
          const entries = group.map((ch) => `  • #${ch.name} (ID: \`${ch.id}\`)`).join("\n");
          return `${header}\n${entries}`;
        })
        .join("\n\n");
    }

    return {
      ok: true,
      content: `Found ${totalCount} text channel(s) in the server.\n\n` +
        `--- DUPLICATES (${duplicateCount} channels across ${duplicateGroups.length} duplicate name(s)) ---\n` +
        `${duplicateSection}\n\n` +
        `--- ALL CHANNELS ---\n${allLines}`,
      label: `discord_list_channels: ${totalCount} channels, ${duplicateGroups.length} duplicate name(s)`,
    };
  },
};
