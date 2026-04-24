/**
 * Jarvis Discord Workspace
 *
 * Sets up an organised category + topic channels inside a Discord guild so
 * Jarvis can think, plan, and coach across different life areas.
 *
 * Topic channels:
 *   📋 tasks      — daily plans, task lists, morning briefings
 *   💰 finance     — money, budgets, financial goals
 *   💡 ideas       — app ideas, product thoughts, creative sparks
 *   💼 business    — work, clients, business goals
 *   🌱 personal    — health, relationships, personal growth
 *   🧠 thinking    — Jarvis reasoning, reflections, long-form planning
 */

import {
  Client,
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type TextChannel,
  type CategoryChannel,
} from "discord.js";
import { db } from "../db";
import { channelLinks } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { DiscordLinkMeta, AllowlistedGuild } from "./manager";

// ── Daily Digest channel ──────────────────────────────────────────────────────

/** Key used in WorkspaceMeta.channels for the daily digest channel. */
export const DIGEST_CHANNEL_KEY = "daily-digest";

export const DIGEST_CHANNEL = {
  key: DIGEST_CHANNEL_KEY,
  name: "daily-digest",
  emoji: "📰",
  description: "Jarvis daily summary: completed automations, pending approvals, agent activity, and tomorrow's schedule.",
};

// ── Topic definitions ────────────────────────────────────────────────────────

export interface WorkspaceTopic {
  key: string;
  emoji: string;
  name: string;
  description: string;
  keywords: string[];
}

export const WORKSPACE_TOPICS: WorkspaceTopic[] = [
  {
    key: "tasks",
    emoji: "📋",
    name: "tasks",
    description: "Daily plans, tasks, morning briefings, and to-do tracking.",
    keywords: ["task", "todo", "plan", "morning", "schedule", "reminder", "deadline", "priority", "checklist", "habit"],
  },
  {
    key: "finance",
    emoji: "💰",
    name: "finance",
    description: "Money, budgets, expenses, investments, and financial goals.",
    keywords: ["money", "finance", "budget", "expense", "income", "invest", "savings", "cost", "revenue", "profit", "debt", "credit", "bank", "tax", "salary", "payment"],
  },
  {
    key: "ideas",
    emoji: "💡",
    name: "ideas",
    description: "App ideas, product concepts, creative sparks, and feature brainstorms.",
    keywords: ["idea", "app", "product", "feature", "build", "startup", "prototype", "design", "concept", "innovation", "saas", "tool", "software"],
  },
  {
    key: "business",
    emoji: "💼",
    name: "business",
    description: "Work, clients, business strategy, goals, and professional growth.",
    keywords: ["business", "client", "work", "project", "meeting", "strategy", "goal", "company", "sales", "marketing", "partnership", "pitch", "contract", "team"],
  },
  {
    key: "personal",
    emoji: "🌱",
    name: "personal",
    description: "Health, relationships, personal growth, and life balance.",
    keywords: ["health", "sleep", "exercise", "workout", "relationship", "family", "friend", "personal", "mindset", "stress", "energy", "mental", "wellness", "habit", "life"],
  },
  {
    key: "thinking",
    emoji: "🧠",
    name: "thinking",
    description: "Jarvis reflections, long-form planning, and strategic thinking logs.",
    keywords: ["reflect", "think", "insight", "analysis", "review", "retrospective", "learn", "pattern", "observation"],
  },
];

export interface WorkspaceMeta {
  guildId: string;
  guildName: string;
  categoryId: string;
  channels: Record<string, string>; // topicKey → channel ID
}

// ── Topic classifier ─────────────────────────────────────────────────────────

/**
 * Returns the topic key that best matches the given text,
 * or "thinking" as a fallback.
 */
export function classifyTopic(text: string): string {
  const lower = text.toLowerCase();
  let best = { key: "thinking", score: 0 };

  for (const topic of WORKSPACE_TOPICS) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > best.score) {
      best = { key: topic.key, score };
    }
  }

  return best.key;
}

// ── Workspace setup ──────────────────────────────────────────────────────────

// Per-guild in-flight lock — prevents concurrent setup races that create duplicate channels
const setupInProgress = new Set<string>();

export async function setupWorkspace(
  client: Client,
  userId: string,
  guildId: string,
): Promise<{ ok: boolean; error?: string; workspace?: WorkspaceMeta }> {
  if (setupInProgress.has(guildId)) {
    console.log(`[Workspace] setup already in progress for guild ${guildId} — skipping concurrent call`);
    return { ok: false, error: "workspace setup already in progress for this server" };
  }
  setupInProgress.add(guildId);
  try {
    const guild = await client.guilds.fetch(guildId) as Guild;
    // Ensure channel cache is fully populated before any cache lookups
    await guild.channels.fetch();

    // Create (or find) the Jarvis category
    const existingCat = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildCategory && ch.name === "🧠 Jarvis Workspace",
    ) as CategoryChannel | undefined;

    let category: CategoryChannel;
    if (existingCat) {
      category = existingCat;
    } else {
      category = await guild.channels.create({
        name: "🧠 Jarvis Workspace",
        type: ChannelType.GuildCategory,
      }) as CategoryChannel;
    }

    // Create (or find) each topic channel under the category
    const channelIds: Record<string, string> = {};

    for (const topic of WORKSPACE_TOPICS) {
      const channelName = `${topic.emoji}${topic.name}`;
      const existing = guild.channels.cache.find(
        (ch) =>
          ch.type === ChannelType.GuildText &&
          (ch as TextChannel).parentId === category.id &&
          ch.name === `${topic.emoji}${topic.name}`,
      ) as TextChannel | undefined;

      if (existing) {
        channelIds[topic.key] = existing.id;
      } else {
        const created = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: topic.description,
        }) as TextChannel;
        channelIds[topic.key] = created.id;
        // Welcome message
        await created.send(
          `**${topic.emoji} ${topic.name.charAt(0).toUpperCase() + topic.name.slice(1)}**\n${topic.description}\n\n_Jarvis will post relevant updates here and you can ask me anything in this topic._`,
        ).catch(() => {});
      }
    }

    // Create (or find) the #daily-digest channel
    const digestChannelName = `${DIGEST_CHANNEL.emoji}${DIGEST_CHANNEL.name}`;
    const existingDigest = guild.channels.cache.find(
      (ch) =>
        ch.type === ChannelType.GuildText &&
        (ch as TextChannel).parentId === category.id &&
        ch.name === digestChannelName,
    ) as TextChannel | undefined;

    if (existingDigest) {
      channelIds[DIGEST_CHANNEL_KEY] = existingDigest.id;
    } else {
      const created = await guild.channels.create({
        name: digestChannelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: DIGEST_CHANNEL.description,
      }) as TextChannel;
      channelIds[DIGEST_CHANNEL_KEY] = created.id;
      await created.send(
        `**${DIGEST_CHANNEL.emoji} Daily Digest**\n${DIGEST_CHANNEL.description}\n\n_Jarvis will post your daily summary here every evening at 9pm._`,
      ).catch(() => {});
    }

    const workspace: WorkspaceMeta = {
      guildId,
      guildName: guild.name,
      categoryId: category.id,
      channels: channelIds,
    };

    // Persist workspace metadata into the channel_links row
    const rows = await db
      .select()
      .from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
      .limit(1);

    if (rows.length > 0) {
      const existing = (rows[0].metadata as DiscordLinkMeta) || {};

      // Build allowlist entries for every workspace channel (no @mention required)
      const existingAllowlist: AllowlistedGuild[] = existing.allowlistedGuilds || [];
      const workspaceEntries: AllowlistedGuild[] = WORKSPACE_TOPICS.map((topic) => ({
        guildId,
        guildName: guild.name,
        channelId: channelIds[topic.key],
        channelName: `${topic.emoji}${topic.name}`,
        requireMention: false,
      }));
      // Merge: keep non-workspace entries, replace all workspace channel entries
      const workspaceChannelIds = new Set(Object.values(channelIds));
      const keptExisting = existingAllowlist.filter(
        (g) => !(g.guildId === guildId && workspaceChannelIds.has(g.channelId)),
      );
      const mergedAllowlist: AllowlistedGuild[] = [...keptExisting, ...workspaceEntries];

      await db
        .update(channelLinks)
        .set({ metadata: { ...existing, workspace, allowlistedGuilds: mergedAllowlist } })
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")));
    }

    return { ok: true, workspace };
  } catch (err: unknown) {
    console.error("[Workspace] setup failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    setupInProgress.delete(guildId);
  }
}

// ── Topic-based posting ──────────────────────────────────────────────────────

/**
 * Posts a message to the topic channel that best matches the given topic key.
 * Falls back to the "thinking" channel if the specific channel isn't found.
 */
export async function postToTopicChannel(
  client: Client,
  workspace: WorkspaceMeta,
  topicKey: string,
  text: string,
): Promise<boolean> {
  const channelId = workspace.channels[topicKey] ?? workspace.channels["thinking"];
  if (!channelId) return false;

  try {
    const channel = await client.channels.fetch(channelId) as TextChannel | null;
    if (!channel || !channel.isTextBased()) return false;

    const chunks = splitIntoChunks(text, 1900);
    for (const chunk of chunks) {
      await (channel as TextChannel).send(chunk);
    }
    return true;
  } catch (err) {
    console.error("[Workspace] postToTopicChannel failed:", err);
    return false;
  }
}

function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  while (text.length > 0) {
    let cut = maxLen;
    if (text.length > maxLen) {
      const nl = text.lastIndexOf("\n", maxLen);
      if (nl > maxLen * 0.5) cut = nl + 1;
    }
    chunks.push(text.slice(0, cut));
    text = text.slice(cut);
  }
  return chunks;
}

// ── Channel → topic lookup ───────────────────────────────────────────────────

/** Returns the topic for a given Discord channel ID, or null if not a workspace channel. */
export function getTopicForChannel(
  workspace: WorkspaceMeta | undefined,
  channelId: string,
): WorkspaceTopic | null {
  if (!workspace) return null;
  for (const [key, id] of Object.entries(workspace.channels)) {
    if (id === channelId) {
      return WORKSPACE_TOPICS.find((t) => t.key === key) ?? null;
    }
  }
  return null;
}
