import { Client, GatewayIntentBits, Events, Partials, Message, DMChannel, AttachmentBuilder, type GuildBasedChannel, type TextChannel, type MessageReaction, type PartialMessageReaction, type User as DiscordUser, type PartialUser, type SendableChannels } from "discord.js";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { channelLinks, users, discordPendingApprovals, discordAgents } from "@shared/schema";
import { getUserToken, saveUserToken, deleteUserToken } from "../userTokenStore";
import { runCoachAgent } from "../channels/coachAgent";
import { routeToNamedAgent, runNamedAgent, type NamedAgentResult } from "../agent/runNamedAgent";
import { getActiveAgentsForUser } from "../agent/agentManager";
import { matchMentionPattern } from "../agent/mentionMatcher";
import { setupWorkspace as _setupWorkspace, postToTopicChannel as _postToTopicChannel, classifyTopic, getTopicForChannel, WORKSPACE_TOPICS, type WorkspaceMeta } from "./workspace";
import { getUserTtsChannels, getUserTtsPrefs, speakToUser } from "../agent/tools/tts";
import { getSession as getCoachSession, setSession as setCoachSession } from "../channels/sessionStore";
import { attachmentToBuffer, collectMarkdownExtras, imageFilename } from "../channels/attachmentHelpers";
import { outboundMiddleware } from "../channels/outboundMiddleware";

// ── Types ──────────────────────────────────────────────────────────────────

interface PairingRecord {
  botOwnerId: string;
  discordUserId: string;
  discordDmChannelId: string;
  discordUsername: string;
  expiresAt: number;
}

export interface DiscordLinkMeta {
  discordUsername?: string;
  dmChannelId?: string;
  allowlistedGuilds?: AllowlistedGuild[];
  workspace?: import("./workspace").WorkspaceMeta;
  /** Per-channel specialist agent assignments: channelId → AgentJobType (or "general" for coach) */
  channelAgents?: Record<string, string>;
}

export interface AllowlistedGuild {
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  requireMention: boolean;
}

// ── In-memory state ────────────────────────────────────────────────────────

const botClients = new Map<string, Client>();
// code → pairing record (1-hour TTL)
const pairingCodes = new Map<string, PairingRecord>();

/** Key used to store the shared Jarvis Discord bot in botClients. */
const SHARED_BOT_KEY = '__shared__';

/**
 * Returns the per-user bot client if one is running, otherwise falls back to
 * the shared Jarvis bot.  Used by all outbound / utility functions so the
 * shared bot works transparently as a drop-in.
 */
function getClientForUser(userId: string): Client | undefined {
  return botClients.get(userId) ?? botClients.get(SHARED_BOT_KEY);
}

// message-id deduplication: messageId → seenAt timestamp (5-minute TTL)
// The in-memory map is the fast path (zero latency per message).
// DB is the persistence layer that survives server restarts.
const seenMessageIds = new Map<string, number>();
const SEEN_MESSAGE_TTL_MS = 5 * 60 * 1000;

// Per-user async processing lock: userId → Promise chain
// Ensures concurrent messages from the same user are queued, not raced.
const userProcessingLocks = new Map<string, Promise<void>>();

/**
 * Atomically claim a Discord message ID for processing.
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING RETURNING message_id as a single
 * atomic DB operation — whichever server process inserts the row first wins
 * ownership. Returns true when this process claimed the ID (safe to process),
 * false when another process already owns it (drop the message).
 *
 * The in-memory map is updated on a successful claim so subsequent events for
 * the same ID in the same process are caught instantly without another DB hit.
 *
 * Falls back to true (allow processing) only if the DB itself is unreachable,
 * so a DB outage degrades gracefully to the previous in-memory-only behaviour.
 */
async function claimMessageId(messageId: string): Promise<boolean> {
  const seenAt = Date.now();

  // Set the in-memory flag BEFORE the async DB call so any concurrent
  // in-process event for the same ID is caught by the fast-path check
  // at the top of the handler WITHOUT waiting for the DB round-trip.
  // If the DB subsequently reveals another process already owns the ID,
  // we clear the flag and return false so this process drops the message.
  seenMessageIds.set(messageId, seenAt);

  // Cap the DB call at 2 s so a hanging database never stalls message handling.
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
  try {
    const dbCall = db.execute(sql`
      INSERT INTO discord_seen_messages (message_id, seen_at)
      VALUES (${messageId}, ${seenAt})
      ON CONFLICT (message_id) DO NOTHING
      RETURNING message_id
    `);
    const result = await Promise.race([dbCall, timeout]);
    if (result === null) {
      // DB timed out — we already own the in-memory slot, allow processing.
      console.warn(`[DiscordManager] claimMessageId timed out (>2s) for id=${messageId} — allowing (in-memory claim)`);
      return true;
    }
    const rows = ((result as unknown as { rows?: unknown[] }).rows ??
      (Array.isArray(result) ? result as unknown[] : []));
    if (rows.length === 0) {
      // Another process already owns this ID — undo the in-memory claim
      // so future cross-restart dedup still relies on the DB correctly.
      seenMessageIds.delete(messageId);
      console.log(`[DiscordManager] claimMessageId lost DB race for id=${messageId} — dropping`);
      return false;
    }
    // DB claim confirmed — in-memory flag already set above.
    return true;
  } catch (err) {
    // DB error — keep the in-memory claim and allow processing.
    console.warn("[DiscordManager] claimMessageId DB error (allowing via in-memory):", err);
    return true;
  }
}

/**
 * Seed the in-memory dedup map from the DB on server startup.
 * Called once after bootAllBots so the first messages after a restart
 * are still recognised as already-processed if they were seen recently.
 */
export async function seedSeenMessageIds(): Promise<void> {
  try {
    const cutoff = Date.now() - SEEN_MESSAGE_TTL_MS;
    const rows = await db.execute(sql`
      SELECT message_id, seen_at FROM discord_seen_messages
      WHERE seen_at > ${cutoff}
    `);
    const items: { message_id: string; seen_at: string }[] =
      ((rows as unknown as { rows?: { message_id: string; seen_at: string }[] }).rows ??
        (Array.isArray(rows) ? rows as { message_id: string; seen_at: string }[] : []));
    let count = 0;
    for (const row of items) {
      seenMessageIds.set(row.message_id, Number(row.seen_at));
      count++;
    }
    if (count > 0) {
      console.log(`[DiscordManager] Seeded ${count} recent message ID(s) from DB`);
    }
  } catch (err) {
    // Non-fatal — in-memory map starts empty, worst case is a re-delivery
    console.warn("[DiscordManager] seedSeenMessageIds failed (non-fatal):", err);
  }
}

function generateCode(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Prune expired pairing codes and seen message IDs every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [code, rec] of pairingCodes) {
    if (rec.expiresAt < now) pairingCodes.delete(code);
  }
  const cutoff = now - SEEN_MESSAGE_TTL_MS;
  for (const [id, seenAt] of seenMessageIds) {
    if (seenAt < cutoff) seenMessageIds.delete(id);
  }
  // Also prune old rows from DB (fire-and-forget)
  db.execute(sql`
    DELETE FROM discord_seen_messages WHERE seen_at < ${cutoff}
  `).catch(() => {});
}, 5 * 60 * 1000);

// ── Helpers ────────────────────────────────────────────────────────────────

async function lookupLink(userId: string): Promise<{ address: string; meta: DiscordLinkMeta } | null> {
  try {
    const rows = await db
      .select()
      .from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { address: row.address, meta: (row.metadata as DiscordLinkMeta) || {} };
  } catch (err) {
    console.error("[DiscordManager] link lookup failed:", err);
    return null;
  }
}

async function lookupUserByDiscordId(
  discordUserId: string,
): Promise<{ userId: string; meta: DiscordLinkMeta } | null> {
  try {
    const rows = await db
      .select()
      .from(channelLinks)
      .where(and(eq(channelLinks.channel, "discord"), eq(channelLinks.address, discordUserId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { userId: row.userId, meta: (row.metadata as DiscordLinkMeta) || {} };
  } catch (err) {
    console.error("[DiscordManager] reverse lookup failed:", err);
    return null;
  }
}

// ── Channel agent assignment helpers ──────────────────────────────────────

/** Valid agent types that can be assigned to a channel. */
export const ASSIGNABLE_AGENT_TYPES = ["research", "writing", "planning", "email", "goal_decompose"] as const;
export type AssignableAgentType = typeof ASSIGNABLE_AGENT_TYPES[number];

/**
 * Persist a per-channel specialist agent assignment into channel_links.metadata.
 * Pass null to clear the assignment (restore coach routing).
 */
export async function updateChannelAgentType(
  userId: string,
  channelId: string,
  agentType: string | null,
): Promise<void> {
  const rows = await db
    .select()
    .from(channelLinks)
    .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
    .limit(1);
  const existing = (rows[0]?.metadata as DiscordLinkMeta) ?? {};
  const channelAgents: Record<string, string> = { ...(existing.channelAgents ?? {}) };
  if (agentType === null) {
    delete channelAgents[channelId];
  } else {
    channelAgents[channelId] = agentType;
  }
  const updated: DiscordLinkMeta = { ...existing, channelAgents };
  await db
    .update(channelLinks)
    .set({ metadata: updated as unknown })
    .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")));
}

/**
 * Read the assigned agent type for a specific channel, or null if none set.
 * Used by slash command handlers.
 */
export async function getChannelAgentAssignment(userId: string, channelId: string): Promise<string | null> {
  const link = await lookupLink(userId);
  return link?.meta.channelAgents?.[channelId] ?? null;
}

/**
 * Format a human-readable label for an agent type.
 */
export function agentTypeLabel(agentType: string): string {
  const labels: Record<string, string> = {
    research: "🔬 Research",
    writing: "✍️ Writing",
    planning: "📋 Planning",
    email: "📧 Email",
    goal_decompose: "🎯 Goal Decomposer",
    general: "🧠 General Coach",
  };
  return labels[agentType] ?? agentType;
}

// ── Message handler factory ────────────────────────────────────────────────

function buildMessageHandler(botOwnerId: string, client: Client) {
  return async (message: Message) => {
    // Drop bots — including this bot's own messages.
    // With Partials.Message enabled, partial user objects may have bot=undefined
    // (not true), so we also compare the author ID against the bot's own user ID
    // to prevent the bot from responding to its own "_Thinking…_" placeholder.
    if (message.author.bot) return;
    if (client.user && message.author.id === client.user.id) return;

    // ── Deduplication fast path: in-memory map (zero latency) ────────────
    if (seenMessageIds.has(message.id)) {
      console.log(`[DiscordManager] duplicate message dropped (in-memory, id=${message.id})`);
      return;
    }

    // Extract basic info immediately — all available in the Discord.js message
    // object with no DB or network calls.
    const isDM = message.channel.isDMBased();
    const discordUserId = message.author.id;
    const discordUsername = message.author.tag || message.author.username;

    console.log(`[DiscordManager] message from ${discordUsername} (${discordUserId}) isDM=${isDM} contentLen=${message.content?.length ?? 0} mentionsBot=${message.mentions.users.has(client.user?.id ?? "")}`);

    // Detect audio attachments early — used below to skip the text placeholder.
    const _hasAudioAtt = [...message.attachments.values()].some(
      (a) => a.contentType?.startsWith("audio/") || a.contentType?.startsWith("video/"),
    );

    // Atomic DB claim: INSERT ... RETURNING — only the first process to
    // insert wins ownership; concurrent processes see zero rows and drop.
    const claimed = await claimMessageId(message.id);
    if (!claimed) {
      console.log(`[DiscordManager] duplicate message dropped (db atomic claim, id=${message.id})`);
      return;
    }

    // ── Determine if we should respond ──────────────────────────────────
    // Hoist the lookup result so the DM/pairing path below can reuse it
    // without a second DB round-trip.
    let hoistedPairedLookup: { userId: string; meta: DiscordLinkMeta } | null | undefined = undefined;

    if (!isDM) {
      if (botOwnerId === SHARED_BOT_KEY) {
        // Shared bot: look up the sender's paired Jarvis user to apply their
        // allowlist settings.  If not yet paired, fall through to pairing flow.
        const sharedPaired = await lookupUserByDiscordId(discordUserId);
        hoistedPairedLookup = sharedPaired;
        if (sharedPaired) {
          const allowed = sharedPaired.meta.allowlistedGuilds || [];
          const guildId = (message.guild?.id) ?? "";
          const channelId = message.channelId;
          const botId = client.user?.id;
          const mentioned = message.mentions.users.has(botId ?? "");
          if (allowed.length === 0) {
            console.log(`[DiscordManager] shared guild msg accepted — no allowlist, paired user`);
          } else {
            const guildEntry = allowed.find((g) => g.guildId === guildId && g.channelId === channelId);
            if (!guildEntry) {
              console.log(`[DiscordManager] shared guild msg ignored — channel ${channelId} not in allowlist`);
              return;
            }
            if (guildEntry.requireMention && !mentioned) {
              console.log(`[DiscordManager] shared guild msg ignored — requireMention=true but bot not @mentioned`);
              return;
            }
          }
        }
        // If !sharedPaired: fall through to pairing flow below.
      } else {
        // Per-user bot: allow pairing flow if the bot owner isn't linked yet;
        // otherwise only respond in allowlisted channels for the paired user.
        const link = await lookupLink(botOwnerId);
        if (link) {
          if (link.address !== discordUserId) {
            console.log(`[DiscordManager] guild msg ignored — sender ${discordUserId} != paired ${link.address}`);
            return;
          }
          const allowed = link.meta.allowlistedGuilds || [];
          const guildId = (message.guild?.id) ?? "";
          const channelId = message.channelId;
          const botId = client.user?.id;
          const mentioned = message.mentions.users.has(botId ?? "");
          if (allowed.length === 0) {
            console.log(`[DiscordManager] guild msg accepted — no allowlist, paired user, mention not required`);
          } else {
            const guildEntry = allowed.find((g) => g.guildId === guildId && g.channelId === channelId);
            if (!guildEntry) {
              console.log(`[DiscordManager] guild msg ignored — channel ${channelId} not in allowlist`);
              return;
            }
            if (guildEntry.requireMention && !mentioned) {
              console.log(`[DiscordManager] guild msg ignored — requireMention=true but bot not @mentioned`);
              return;
            }
          }
        }
        // If !link: bot owner isn't paired yet — fall through so the pairing
        // code gets sent to whoever messaged the bot in the guild.
      }
    }

    // ── DM / pairing path: check if user is paired to this bot ──────────
    // Reuse the result already fetched in the shared-bot guild path (if any)
    // to avoid a duplicate DB round-trip.
    const pairedUser = hoistedPairedLookup !== undefined
      ? hoistedPairedLookup
      : await lookupUserByDiscordId(discordUserId);
    console.log(`[DiscordManager] pairedUser lookup for ${discordUserId}: ${pairedUser ? `userId=${pairedUser.userId}` : "not found"}`);

    // For the shared bot any paired Discord user is valid; for per-user bots
    // the Discord user must be paired specifically to that bot's owner.
    if (!pairedUser || (botOwnerId !== SHARED_BOT_KEY && pairedUser.userId !== botOwnerId)) {
      // Unknown user — start pairing flow
      // One active code per discord user per bot
      let code: string | null = null;
      for (const [c, rec] of pairingCodes) {
        if (rec.botOwnerId === botOwnerId && rec.discordUserId === discordUserId && rec.expiresAt > Date.now()) {
          code = c;
          break;
        }
      }
      if (!code) {
        code = generateCode(6);
        pairingCodes.set(code, {
          botOwnerId,
          discordUserId,
          discordDmChannelId: message.channelId,
          discordUsername,
          expiresAt: Date.now() + 60 * 60 * 1000,
        });
      }
      await message
        .reply(
          `👋 Hey! I'm Jarvis, your AI productivity coach.\n\n` +
            `To link this Discord account:\n` +
            `1. Open the Jarvis app\n` +
            `2. Go to **Settings** → scroll to **Channels** → tap **Discord**\n` +
            `3. Enter this code:\n\n` +
            `\`\`\`${code}\`\`\`\n` +
            `*(Valid for 1 hour. Message me again if it expires.)*`,
        )
        .catch((err) => console.error("[DiscordManager] reply failed:", err));
      return;
    }

    const userId = pairedUser.userId;

    // ── Mention-triggered voice join ──────────────────────────────────────
    // When the bot is @mentioned in a guild text channel, the sender is the
    // integration owner, and they are currently in a voice channel with no
    // active session for this guild: auto-join so Jarvis responds in voice.
    // The join is fire-and-forget so normal text processing continues in parallel.
    if (!isDM && message.mentions.users.has(client.user?.id ?? "")) {
      const voiceGuildId = message.guild?.id ?? "";
      if (voiceGuildId) {
        (async () => {
          try {
            const { isIntegrationOwner } = await import("../integrationOwner");
            const ownerCheck = await isIntegrationOwner(userId);
            if (!ownerCheck) return;
            const { getVoiceSessionStatus, joinVoiceSession } = await import("./voiceBridge");
            if (getVoiceSessionStatus(voiceGuildId).active) return; // already joined
            const guild = message.guild!;
            const member = guild.members.cache.get(discordUserId)
              ?? await guild.members.fetch(discordUserId).catch(() => null);
            const voiceChannelId = member?.voice.channelId ?? null;
            if (!voiceChannelId) return; // sender not in a voice channel
            console.log(`[DiscordManager] mention-triggered voice join — guild=${voiceGuildId} vchannel=${voiceChannelId}`);
            const result = await joinVoiceSession(client, voiceGuildId, voiceChannelId, message.channelId, userId, discordUserId);
            if (result.ok) {
              if (message.channel.isSendable()) await message.channel
                .send(`🎙️ Joining <#${voiceChannelId}>! Speak and I'll respond in voice. Use \`/voice leave\` to disconnect.`)
                .catch(() => {});
            }
          } catch (voiceJoinErr) {
            console.error("[DiscordManager] mention-triggered voice join error (non-fatal):", voiceJoinErr);
          }
        })();
      }
    }

    // ── Project question reply-thread routing ─────────────────────────────
    // If this message is a Discord reply and the referenced message ID matches
    // a pending question stored in questionMeta, auto-route to answerProjectQuestion.
    const replyRefMsgId = message.reference?.messageId;
    const replyRefChannelId = message.reference?.channelId;
    if (replyRefMsgId && message.content?.trim()) {
      try {
        const { answerProjectQuestion } = await import("../agent/projectRunner");
        const { jarvisProjects } = await import("@shared/schema");
        const pendingProjects = await db
          .select()
          .from(jarvisProjects)
          .where(and(eq(jarvisProjects.userId, userId), eq(jarvisProjects.status, "waiting_for_input")));
        const matched = pendingProjects.find((p) => {
          const meta = p.questionMeta as Record<string, unknown> | null | undefined;
          return meta?.discordMessageId === replyRefMsgId && meta?.discordChannelId === replyRefChannelId;
        });
        if (matched) {
          await answerProjectQuestion(matched.id, message.content.trim());
          await message.reply(`✅ Got it! Resuming project **${matched.title ?? matched.id.slice(0, 8)}**...`).catch(() => {});
          return;
        }
      } catch (replyErr) {
        console.error("[DiscordManager] project reply routing error:", replyErr);
      }
    }

    // ── Send "Thinking…" placeholder ─────────────────────────────────────
    // Sent HERE — after claimMessageId won the atomic DB race AND after we
    // have confirmed the sender is a paired user.  This guarantees exactly
    // ONE placeholder per incoming message, even when both the shared bot
    // and a per-user bot are running simultaneously: the bot that loses the
    // claimMessageId race returns before reaching this line.
    // Audio messages skip this because they show their own transcription msg.
    let earlyPlaceholder: Message | null = null;
    if (!_hasAudioAtt) {
      try {
        if (message.channel.isSendable()) earlyPlaceholder = await message.channel.send("_Thinking…_");
      } catch {
        // Non-fatal — reply will still be delivered even if placeholder fails.
      }
    }

    // ── Per-user async lock ────────────────────────────────────────────
    // Queue messages from the same user so they are processed sequentially,
    // preventing two near-simultaneous messages from racing each other and
    // both editing the same placeholder at once.
    const prevLock = userProcessingLocks.get(userId) ?? Promise.resolve();
    let releaseLock!: () => void;
    const thisLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    // Chain this message onto the previous one so they run sequentially.
    const chainedLock = prevLock.then(() => thisLock).catch(() => thisLock);
    userProcessingLocks.set(userId, chainedLock);

    try {
      await prevLock;
    } catch {
      // previous message errored — still safe to proceed
    }

    try {
    // ── Update last_seen_at ─────────────────────────────────────────────
    db.update(channelLinks)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
      .catch(() => {});

    // ── Auto-save guild ID to channel_links metadata ──────────────────
    // When a paired user messages from a guild and workspace.guildId is
    // not yet stored, persist it so future tool calls (deleteDiscordChannel,
    // createDiscordChannel, etc.) can resolve the guild via the primary
    // linkMeta.workspace?.guildId path without needing a ctx fallback or
    // explicit workspace setup.
    // Awaited (not fire-and-forget) so any tool calls in THIS interaction
    // also see the updated metadata when they re-query channel_links.
    const incomingGuildId = message.guild?.id;
    if (!isDM && incomingGuildId && !pairedUser.meta.workspace?.guildId) {
      const updatedMeta: DiscordLinkMeta = {
        ...pairedUser.meta,
        workspace: {
          guildId: incomingGuildId,
          guildName: message.guild?.name ?? "",
          // Preserve any existing categoryId/channels from a prior partial
          // or full workspace setup; use empty defaults if absent.
          categoryId: pairedUser.meta.workspace?.categoryId ?? "",
          channels: pairedUser.meta.workspace?.channels ?? {},
        },
      };
      await db.update(channelLinks)
        .set({ metadata: updatedMeta as unknown })
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
        .then(async () => {
          console.log(`[DiscordManager] auto-saved guildId=${incomingGuildId} for user ${userId}`);
          // Send a one-time DM to let the user know which server was linked.
          const dmChannelId = pairedUser.meta.dmChannelId;
          if (dmChannelId) {
            try {
              const dmChannel = await client.channels.fetch(dmChannelId);
              if (dmChannel instanceof DMChannel) {
                const guildName = updatedMeta.workspace?.guildName || incomingGuildId;
                await dmChannel.send(
                  `✅ I've linked to your **${guildName}** server — you can now ask me to create or delete channels there.`,
                );
              }
            } catch (dmErr) {
              console.warn("[DiscordManager] auto-link DM failed (non-fatal):", dmErr);
            }
          }
        })
        .catch((err) => console.error("[DiscordManager] auto-save guild ID failed:", err));
    }

    // ── Audio attachment transcription ─────────────────────────────────
    let userText = message.content?.trim() || "";
    const audioAtt = [...message.attachments.values()].find(
      (a) => a.contentType?.startsWith("audio/") || a.contentType?.startsWith("video/"),
    );

    // typingMsg is kept in outer scope so we can reuse it as the agent
    // placeholder instead of sending a second "Thinking…" message.
    let typingMsg: Message | null = null;

    if (audioAtt && !userText) {
      try {
        if (message.channel.isSendable()) typingMsg = await message.channel.send("🎤 Transcribing voice message…");
        const resp = await fetch(audioAtt.url);
        const arrBuf = await resp.arrayBuffer();
        const buf = Buffer.from(arrBuf);
        const { speechToText, detectAudioFormat } = await import(
          "../replit_integrations/audio/client"
        );
        const format = detectAudioFormat(buf);
        const transcript = await speechToText(buf, format);
        if (!transcript?.trim()) {
          if (typingMsg) await typingMsg.edit("Sorry, I couldn't make out that voice message — could you type it out?");
          else await message.reply("Sorry, I couldn't make out that voice message — could you type it out?").catch(() => {});
          return;
        }
        userText = transcript.trim();
        const preview = userText.length > 100 ? userText.slice(0, 100) + "…" : userText;
        // Show transcript briefly, then transition to thinking state in the
        // same message so the user only ever sees ONE bot message per voice
        // input (not a separate "Thinking…" message on top of the transcript).
        if (typingMsg) await typingMsg.edit(`🎤 *"${preview}"* — _Thinking…_`);
        else await message.reply(`🎤 *"${preview}"* — _Thinking…_`).catch(() => {});
      } catch (err) {
        console.error("[DiscordManager] voice transcription failed:", err);
        if (typingMsg) await typingMsg.edit("Sorry, transcription failed — please type your message.").catch(() => {});
        else await message.reply("Sorry, transcription failed — please type your message.").catch(() => {});
        return;
      }
    }

    if (!userText) {
      console.log(`[DiscordManager] msg dropped — empty content (MessageContent intent may not be enabled in Discord Developer Portal for guild messages)`);
      if (earlyPlaceholder) earlyPlaceholder.delete().catch(() => {});
      return;
    }

    console.log(`[DiscordManager] processing message: "${userText.slice(0, 80)}…"`);

    // ── Text command: !assign-agent / !agent-status ──────────────────────
    // Handled before any agent routing so these control commands always work.
    const trimmedCmd = userText.trim();
    const assignMatch = trimmedCmd.match(/^[!/]assign-agent\s+(\S+)$/i);
    const statusMatch = /^[!/]agent-status$/i.test(trimmedCmd);

    if (!isDM && (assignMatch || statusMatch)) {
      if (earlyPlaceholder) await earlyPlaceholder.delete().catch(() => {});

      if (assignMatch) {
        const requestedType = assignMatch[1].toLowerCase();
        if (requestedType === "reset" || requestedType === "general") {
          // Clear the assignment
          await updateChannelAgentType(userId, message.channelId, null);
          await message.reply(
            "✅ Channel agent assignment cleared — this channel now routes to the **General Coach** (default).",
          ).catch(() => {});
        } else if ((ASSIGNABLE_AGENT_TYPES as readonly string[]).includes(requestedType)) {
          await updateChannelAgentType(userId, message.channelId, requestedType);
          await message.reply(
            `✅ This channel is now assigned to the **${agentTypeLabel(requestedType)}** agent. ` +
            `Every message here will be routed directly to that specialist.\n` +
            `Use \`!assign-agent reset\` or \`!assign-agent general\` to restore default coach routing.`,
          ).catch(() => {});
        } else {
          const valid = [...ASSIGNABLE_AGENT_TYPES, "general", "reset"].join(", ");
          await message.reply(
            `❌ Unknown agent type: \`${requestedType}\`\nValid options: \`${valid}\``,
          ).catch(() => {});
        }
      } else if (statusMatch) {
        // Fetch current metadata for this user
        const linkMeta = (await lookupLink(userId))?.meta ?? {};
        const assigned = linkMeta.channelAgents?.[message.channelId];
        if (assigned) {
          await message.reply(
            `🤖 This channel is assigned to the **${agentTypeLabel(assigned)}** agent.\n` +
            `Use \`!assign-agent reset\` to restore default coach routing.`,
          ).catch(() => {});
        } else {
          await message.reply(
            "🧠 This channel uses **default coach routing** (no specialist agent assigned).\n" +
            `Use \`!assign-agent <type>\` to assign one. Valid types: ${ASSIGNABLE_AGENT_TYPES.join(", ")}`,
          ).catch(() => {});
        }
      }
      return;
    }

    // ── Resolve placeholder ─────────────────────────────────────────────
    // Priority: voice transcription placeholder (typingMsg) → early text
    // placeholder sent before DB lookups (earlyPlaceholder) → null.
    // No new send needed here — both cases are already covered above.
    let placeholder: Message | null = typingMsg ?? earlyPlaceholder;

    // ── Detect workspace topic channel + legacy persona (parallel) ────────
    // Fire both independent DB lookups concurrently to save one round-trip:
    //   • lookupLink  — workspace/topic channel metadata
    //   • getNamedAgentForChannel — legacy persona prefix (pre-new-agent-system rows)
    // Use the resolved per-user userId (not botOwnerId which may be '__shared__')
    // so workspace metadata is always fetched from the correct channel_links row.
    const [link2, namedAgent] = await Promise.all([
      lookupLink(userId),
      isDM ? Promise.resolve(null) : getNamedAgentForChannel(userId, message.channelId),
    ]);
    const workspace = link2?.meta.workspace;
    const topicForChannel = getTopicForChannel(workspace, message.channelId);
    const channelLabel = topicForChannel
      ? `Discord #${topicForChannel.emoji}${topicForChannel.name}`
      : "Discord";
    // Note: topicContext string previously appended to userText was removed —
    // the workspace topic is now provided by the context registry (topicContext provider)
    // which injects it into the system prompt inside runCoachAgent.

    // ── Phase 5.5: Mention-pattern routing ─────────────────────────────
    // Check if the message body matches any active agent's mention patterns.
    // Applies to guild messages only (DMs are never affected).
    // First match wins; if matched, Phase 6 channel-assignment check is skipped.
    let mentionMatchedAgent: import("@shared/schema").DiscordAgent | null = null;
    if (!isDM) {
      try {
        const allAgents = await getActiveAgentsForUser(userId);
        mentionMatchedAgent = matchMentionPattern(userText, allAgents);
        if (mentionMatchedAgent) {
          console.log(`[DiscordManager] mention-pattern matched agent "${mentionMatchedAgent.name}" (${mentionMatchedAgent.id}) for text="${userText.slice(0, 60)}…"`);
        }
      } catch (mpErr) {
        console.warn("[DiscordManager] mention-pattern check failed (non-fatal):", mpErr);
      }
    }

    // ── Phase 6: Named agent routing ───────────────────────────────────
    // Check if this channel is assigned to a named agent (new agent system).
    // If so, route directly to runNamedAgent. If not (or if it throws), fall
    // through to the standard runCoachAgent pipeline with optional persona-prefix.
    let namedAgentResult: NamedAgentResult | null = null;
    let namedAgentFailed = false;
    if (!isDM) {
      try {
        if (mentionMatchedAgent) {
          namedAgentResult = await runNamedAgent({
            agentId: mentionMatchedAgent.id,
            userId,
            userMessage: userText,
            platform: "discord",
            channelId: message.channelId,
            conversationHistory: undefined,
          });
        } else {
          namedAgentResult = await routeToNamedAgent(userId, "discord", message.channelId, userText);
        }
      } catch (agentErr) {
        console.error("[DiscordManager] routeToNamedAgent failed — falling back to coach:", agentErr);
        namedAgentFailed = true;
        namedAgentResult = null;
      }
    }

    if (namedAgentResult !== null) {
      // Named agent handled the message — send the reply and skip coach pipeline.
      const namedAtts = namedAgentResult.attachments ?? [];

      // Merge any markdown attachments into the text reply.
      const namedMarkdownExtra = collectMarkdownExtras(namedAtts);
      let namedReply = namedAgentResult.reply || "Sorry, the agent couldn't generate a response right now.";
      if (namedMarkdownExtra) {
        namedReply = namedReply ? `${namedReply}\n\n${namedMarkdownExtra}` : namedMarkdownExtra;
      }

      // Agent-name prefix is delegated to the priority-300 outbound middleware handler.
      // Pass agentName only for mention-pattern matches (channel-assigned agents
      // don't need a prefix because the channel is already dedicated to that agent).
      const namedFinalText = await outboundMiddleware.run({
        text: namedReply,
        platform: "discord",
        userId,
        channelId: message.channelId,
        agentId: namedAgentResult.agentId,
        agentName: mentionMatchedAgent?.name,
      });
      if (namedFinalText !== null) {
        if (placeholder) {
          await editOrSendLong(placeholder, namedFinalText);
        } else {
          await sendLong(message.channel as { send(t: string): Promise<unknown> }, namedFinalText);
        }
      }

      // Deliver binary attachments (images, files, documents) produced by agent tool calls.
      if (namedAtts.length > 0) {
        const sendBinaryToNamedChannel = async (buf: Buffer, filename: string, caption?: string) => {
          const fileAtt = new AttachmentBuilder(buf, { name: filename, description: caption?.slice(0, 1024) });
          await (message.channel as { send(opts: unknown): Promise<unknown> }).send({ files: [fileAtt] });
        };

        for (const att of namedAtts) {
          if (att.kind === "document") {
            try {
              const fileContent = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
              await sendBinaryToNamedChannel(fileContent, att.filename, att.caption);
            } catch (attErr) {
              console.warn(`[DiscordManager] named-agent document attachment send failed: ${att.filename}`, attErr);
            }
          } else if (att.kind === "image") {
            try {
              const buf = await attachmentToBuffer(att);
              if (buf) {
                await sendBinaryToNamedChannel(buf, imageFilename(att.mimeType), att.caption);
              } else {
                console.warn("[DiscordManager] named-agent image attachment had no usable source — skipping");
              }
            } catch (attErr) {
              console.warn("[DiscordManager] named-agent image attachment send failed (non-blocking):", attErr);
            }
          } else if (att.kind === "file") {
            try {
              const buf = await attachmentToBuffer(att);
              if (buf) {
                await sendBinaryToNamedChannel(buf, att.filename, att.caption);
              } else {
                console.warn(`[DiscordManager] named-agent file attachment ${att.filename} had no usable source — skipping`);
              }
            } catch (attErr) {
              console.warn(`[DiscordManager] named-agent file attachment send failed: ${att.filename}`, attErr);
            }
          }
          // markdown kind already merged into the text reply above
        }
      }

      return;
    }

    // If the named agent threw, let the user know something went wrong then
    // continue with the standard coach pipeline so they still get a response.
    if (namedAgentFailed && placeholder) {
      await placeholder.edit("_Agent encountered an issue — routing to Jarvis instead…_").catch(() => {});
    }

    // ── Phase 6c: Per-channel specialist agent routing ─────────────────
    // If this channel has a specialist agent assigned (via !assign-agent or
    // /jarvis assign_agent), bypass the coach and submit a background job
    // directly to that agent type. Only applies to guild channels (not DMs).
    if (!isDM && !namedAgentFailed) {
      const channelMeta = link2?.meta ?? {};
      const assignedAgentType = channelMeta.channelAgents?.[message.channelId];
      const isKnownType = assignedAgentType
        ? (ASSIGNABLE_AGENT_TYPES as readonly string[]).includes(assignedAgentType)
        : false;
      if (assignedAgentType && assignedAgentType !== "general" && isKnownType) {
        try {
          const { submitAgentJob } = await import("../agent/jobClient");
          const { id: jobId } = await submitAgentJob({
            userId,
            agentType: assignedAgentType as import("../agent/jobClient").AgentJobType,
            title: userText.slice(0, 80),
            prompt: userText,
            // Pass origin context so the job completion notification is routed
            // back to this Discord channel rather than falling back to DM/in-app.
            input: {
              originChannel: channelLabel,
              originDiscordChannelId: message.channelId,
            },
          });
          const label = agentTypeLabel(assignedAgentType);
          const confirmMsg =
            `⚡ **${label} agent** is on it (job \`${jobId.slice(0, 8)}\`).\n` +
            `_I'll send the result here when it's ready._`;
          if (placeholder) {
            await placeholder.edit(confirmMsg).catch(() => {});
          } else {
            await message.reply(confirmMsg).catch(() => {});
          }
          console.log(`[DiscordManager] channel ${message.channelId} routed to specialist "${assignedAgentType}" (job=${jobId}) for user ${userId}`);
          return;
        } catch (jobErr) {
          console.error("[DiscordManager] specialist channel job submission failed — falling back to coach:", jobErr);
          if (placeholder) {
            await placeholder.edit("_Couldn't reach the specialist agent — routing to Jarvis instead…_").catch(() => {});
          }
        }
      } else if (assignedAgentType && !isKnownType) {
        console.warn(`[DiscordManager] channel ${message.channelId} has unknown agent type "${assignedAgentType}" — falling back to coach`);
      }
    }

    // ── Phase 6b: Legacy persona injection (pre-new-agent-system rows) ────
    // namedAgent was already fetched above in parallel with lookupLink.
    const personaPrefix = namedAgent
      ? `[You are ${namedAgent.name}. ${namedAgent.persona}]\n\n`
      : "";

    // ── Route through coach pipeline with streaming edits ──────────────
    // placeholder was already sent above (before routeToNamedAgent) so it
    // is always set by this point — no second send needed here.

    // Streaming: accumulate chunks and edit the placeholder at most once
    // per ~400 ms — fast enough to feel live while staying within Discord's
    // edit rate limits.
    let streamBuf = "";
    let lastEditAt = 0;
    const STREAM_INTERVAL = 400;
    const onToken = (chunk: string) => {
      streamBuf += chunk;
      const now = Date.now();
      if (placeholder && now - lastEditAt >= STREAM_INTERVAL && streamBuf.length > 0) {
        placeholder.edit(streamBuf + " ▌").catch(() => {});
        lastEditAt = now;
      }
    };

    // Note: workspace topic context is now injected by the contextRegistry
    // (via server/agent/providers/topicContext.ts) into the system prompt inside
    // runCoachAgent — no longer appended to the user message here.
    const fullUserText = personaPrefix + userText;

    try {
      // First attempt: streaming (onToken drives live placeholder edits).
      // Fall back to a non-streaming run only when streaming produced ZERO
      // characters — if streamBuf is non-empty the placeholder was already
      // edited and we must NOT run a second full agent call.
      const discordGuildId = message.guild?.id || undefined;
      let result: Awaited<ReturnType<typeof runCoachAgent>> | null = null;
      let streamingFailed = false;
      const discordChannelId = message.channelId;
      const storedSessionId = await getCoachSession(userId, "Discord");
      try {
        result = await runCoachAgent({
          userId,
          userText: fullUserText,
          channelName: namedAgent ? `Discord #${namedAgent.name.toLowerCase()}` : channelLabel,
          onToken,
          discordGuildId,
          discordChannelId,
          sdkSessionId: storedSessionId,
        });
        // Only retry when streaming produced NO visible content at all.
        // If streamBuf has content the placeholder was already edited; a
        // second agent call would produce a duplicate response.
        if (!result.rawReply && streamBuf.length === 0) {
          console.warn("[DiscordManager] streaming reply was empty and no streamed tokens — retrying without streaming");
          streamingFailed = true;
        } else if (!result.rawReply && streamBuf.length > 0) {
          console.warn("[DiscordManager] rawReply empty but streaming produced content — skipping fallback to avoid double response");
        }
      } catch (streamErr) {
        if (streamBuf.length > 0) {
          // Streaming produced visible output before throwing — finalise with
          // what we have rather than running a second agent call.
          console.warn("[DiscordManager] streaming runCoachAgent threw after producing content — finalising with streamed buffer");
        } else {
          console.warn("[DiscordManager] streaming runCoachAgent threw — retrying without streaming:", streamErr);
          streamingFailed = true;
        }
      }

      if (streamingFailed) {
        result = await runCoachAgent({
          userId,
          userText: fullUserText,
          channelName: namedAgent ? `Discord #${namedAgent.name.toLowerCase()}` : channelLabel,
          discordGuildId,
          discordChannelId,
          sdkSessionId: storedSessionId,
          // no onToken → forces non-streaming path
        });
      }

      if (result?.sdkSessionId) {
        setCoachSession(userId, "Discord", result.sdkSessionId);
      }

      // Use streamed buffer as final reply when result is unavailable but
      // streaming produced visible content (avoids second agent call).
      let reply = result?.reply || (streamBuf.length > 0 ? streamBuf : "Sorry, I couldn't generate a response right now.");

      // Append markdown attachments inline so they appear as formatted text
      // in the Discord message rather than as a separate file upload.
      const allAtts = result?.attachments || [];
      const markdownExtra = collectMarkdownExtras(allAtts);
      if (markdownExtra) {
        reply = reply ? `${reply}\n\n${markdownExtra}` : markdownExtra;
      }

      const coachFinalText = await outboundMiddleware.run({
        text: reply,
        platform: "discord",
        userId,
        channelId: message.channelId,
      });
      if (coachFinalText !== null) {
        if (placeholder) {
          await editOrSendLong(placeholder, coachFinalText);
        } else {
          await sendLong(message.channel as { send(t: string): Promise<unknown> }, coachFinalText);
        }
      }

      // Deliver binary attachments produced by agent tools (documents, images, files).
      // Send directly to message.channel so guild-channel replies stay in-channel and DM
      // replies stay in the DM — avoids routing mismatches from sendFileToDiscordUser.
      const sendBinaryToChannel = async (buf: Buffer, filename: string, caption?: string) => {
        const fileAtt = new AttachmentBuilder(buf, { name: filename, description: caption?.slice(0, 1024) });
        await (message.channel as { send(opts: unknown): Promise<unknown> }).send({ files: [fileAtt] });
      };

      if (allAtts.length > 0) {
        for (const att of allAtts) {
          if (att.kind === "document") {
            try {
              const fileContent = Buffer.isBuffer(att.content)
                ? att.content
                : Buffer.from(att.content);
              await sendBinaryToChannel(fileContent, att.filename, att.caption);
            } catch (attErr) {
              console.warn(`[DiscordManager] document attachment send failed: ${att.filename}`, attErr);
            }
          } else if (att.kind === "image") {
            try {
              const buf = await attachmentToBuffer(att);
              if (buf) {
                await sendBinaryToChannel(buf, imageFilename(att.mimeType), att.caption);
              } else {
                console.warn("[DiscordManager] image attachment had no usable source — skipping");
              }
            } catch (attErr) {
              console.warn("[DiscordManager] image attachment send failed (non-blocking):", attErr);
            }
          } else if (att.kind === "file") {
            try {
              const buf = await attachmentToBuffer(att);
              if (buf) {
                await sendBinaryToChannel(buf, att.filename, att.caption);
              } else {
                console.warn(`[DiscordManager] file attachment ${att.filename} had no usable source — skipping`);
              }
            } catch (attErr) {
              console.warn(`[DiscordManager] file attachment send failed: ${att.filename}`, attErr);
            }
          }
          // markdown kind already merged into the text reply above
        }
      }

      // Auto-voice mode: if "discord" is enabled in user's ttsChannels, also
      // send every reply as an OGG audio attachment (additive — text still sent).
      try {
        const channels = await getUserTtsChannels(userId);
        if (channels.includes("discord")) {
          const prefs = await getUserTtsPrefs(userId);
          await speakToUser(userId, reply, prefs.voice, { channel: "discord", discordChannelId });
        }
      } catch (ttsErr) {
        console.warn("[DiscordManager] auto-voice TTS failed (text reply already sent):", ttsErr);
      }
    } catch (err) {
      console.error("[DiscordManager] runCoachAgent failed:", err);
      if (placeholder) {
        await placeholder.edit("Sorry, something went wrong — please try again.").catch(() => {});
      }
    }
    } finally {
      releaseLock();
      // Remove the map entry when no newer chain is attached to prevent
      // the map from growing unboundedly over the lifetime of the process.
      if (userProcessingLocks.get(userId) === chainedLock) {
        userProcessingLocks.delete(userId);
      }
    }
  };
}

/**
 * Send an OGG/Opus audio buffer as a file attachment to a Discord text channel.
 * Used by the `speak` TTS tool when the conversation originates from Discord.
 * Returns true on success, false on any failure (logs internally).
 */
export async function sendDiscordAudio(userId: string, channelId: string, ogg: Buffer): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client) {
    console.warn(`[DiscordManager] sendDiscordAudio: no bot client for user ${userId}`);
    return false;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("send" in channel)) {
      console.warn(`[DiscordManager] sendDiscordAudio: channel ${channelId} not found or not sendable`);
      return false;
    }
    const ch = channel as SendableChannels;
    await ch.send({ files: [{ attachment: ogg, name: "voice-note.ogg" }] });
    return true;
  } catch (err) {
    console.error("[DiscordManager] sendDiscordAudio failed:", err);
    return false;
  }
}

/**
 * Send an image buffer as a photo attachment to a Discord text channel.
 * Used by the `image_generate` tool when the conversation originates from Discord.
 * Returns true on success, false on any failure (logs internally).
 */
export async function sendDiscordImage(
  userId: string,
  channelId: string,
  imageBuffer: Buffer,
  filename = "image.png",
  caption?: string,
): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client) {
    console.warn(`[DiscordManager] sendDiscordImage: no bot client for user ${userId}`);
    return false;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("send" in channel)) {
      console.warn(`[DiscordManager] sendDiscordImage: channel ${channelId} not found or not sendable`);
      return false;
    }
    const ch = channel as SendableChannels;
    await ch.send({
      content: caption || undefined,
      files: [{ attachment: imageBuffer, name: filename }],
    });
    return true;
  } catch (err) {
    console.error("[DiscordManager] sendDiscordImage failed:", err);
    return false;
  }
}

/**
 * Send a plain text message to a Discord channel.
 * Returns the sent message ID on success, or null on failure.
 */
export async function sendDiscordMessage(
  userId: string,
  channelId: string,
  content: string,
): Promise<string | null> {
  const client = getClientForUser(userId);
  if (!client) {
    console.warn(`[DiscordManager] sendDiscordMessage: no bot client for user ${userId}`);
    return null;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("send" in channel)) {
      console.warn(`[DiscordManager] sendDiscordMessage: channel ${channelId} not found or not sendable`);
      return null;
    }
    const ch = channel as SendableChannels;
    const msg = await ch.send(content);
    return msg.id;
  } catch (err) {
    console.error("[DiscordManager] sendDiscordMessage failed:", err);
    return null;
  }
}

/**
 * Edit an existing Discord message by ID.
 * Returns true on success, false on failure.
 */
export async function editDiscordMessage(
  userId: string,
  channelId: string,
  messageId: string,
  content: string,
): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client) {
    console.warn(`[DiscordManager] editDiscordMessage: no bot client for user ${userId}`);
    return false;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("messages" in channel)) {
      console.warn(`[DiscordManager] editDiscordMessage: channel ${channelId} not found or not text-based`);
      return false;
    }
    const ch = channel as SendableChannels;
    const msg = await ch.messages.fetch(messageId);
    await msg.edit(content);
    return true;
  } catch (err) {
    console.error("[DiscordManager] editDiscordMessage failed:", err);
    return false;
  }
}

export async function sendDiscordVideo(
  userId: string,
  channelId: string,
  videoBuffer: Buffer,
  filename = "video.mp4",
  caption?: string,
): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client) {
    console.warn(`[DiscordManager] sendDiscordVideo: no bot client for user ${userId}`);
    return false;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("send" in channel)) {
      console.warn(`[DiscordManager] sendDiscordVideo: channel ${channelId} not found or not sendable`);
      return false;
    }
    const ch = channel as SendableChannels;
    await ch.send({
      content: caption || undefined,
      files: [{ attachment: videoBuffer, name: filename }],
    });
    return true;
  } catch (err) {
    console.error("[DiscordManager] sendDiscordVideo failed:", err);
    return false;
  }
}

// Discord messages are capped at 2000 chars — split long replies
async function editOrSendLong(msg: Message, text: string): Promise<void> {
  const chunks = splitIntoChunks(text, 1900);
  await msg.edit(chunks[0]).catch(() => {});
  for (let i = 1; i < chunks.length; i++) {
    if (msg.channel.isSendable()) await msg.channel.send(chunks[i]).catch(() => {});
  }
}

async function sendLong(channel: { send(t: string): Promise<unknown> }, text: string): Promise<void> {
  const chunks = splitIntoChunks(text, 1900);
  for (const chunk of chunks) {
    await (channel as SendableChannels).send(chunk).catch(() => {});
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

// ── Client lifecycle ────────────────────────────────────────────────────────

export async function startUserBot(userId: string, botToken: string): Promise<void> {
  stopUserBot(userId); // clean up any existing client

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[DiscordManager] Bot ready for user ${userId}: ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, buildMessageHandler(userId, client));
  client.on(Events.MessageReactionAdd, buildReactionHandler(userId));

  client.on(Events.Error, (err) => {
    console.error(`[DiscordManager] Client error for user ${userId}:`, err.message);
  });

  botClients.set(userId, client);

  try {
    await client.login(botToken);
  } catch (err) {
    console.error(`[DiscordManager] Login failed for user ${userId}:`, err);
    botClients.delete(userId);
    throw err;
  }
}

export function stopUserBot(userId: string): void {
  const client = botClients.get(userId);
  if (client) {
    client.destroy();
    botClients.delete(userId);
    console.log(`[DiscordManager] Bot stopped for user ${userId}`);
  }
}

export function getBotStatus(userId: string): "running" | "stopped" {
  const client = getClientForUser(userId);
  if (!client) return "stopped";
  return client.isReady() ? "running" : "stopped";
}

/**
 * Returns the discord.js Client for a given Jarvis userId (or the shared bot as
 * fallback).  Used by the voice bridge to look up a user's current voice channel
 * and to pass to @discordjs/voice's joinVoiceChannel.
 */
export function getDiscordClientForUser(userId: string): Client | undefined {
  return getClientForUser(userId);
}

export async function bootAllBots(): Promise<void> {
  try {
    // Seed dedup state FIRST — before any bot logs in — so that Discord
    // cannot re-deliver a recent message between login and seed completion.
    await seedSeenMessageIds();

    const { db: _db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const rows = await _db.execute(
      sql`SELECT user_id, access_token FROM user_oauth_tokens WHERE provider = 'discord_bot'`,
    );
    const items: { user_id: string; access_token: string }[] =
      ((rows as unknown as { rows?: { user_id: string; access_token: string }[] }).rows ??
        (Array.isArray(rows) ? (rows as { user_id: string; access_token: string }[]) : []));
    let started = 0;
    for (const row of items) {
      try {
        await startUserBot(row.user_id, row.access_token);
        started++;
      } catch {
        // already logged in startUserBot
      }
    }
    console.log(`[DiscordManager] Booted ${started}/${items.length} Discord bot(s)`);
  } catch (err) {
    console.error("[DiscordManager] bootAllBots failed:", err);
  }
}

// ── Pairing API ─────────────────────────────────────────────────────────────

/**
 * Generate (or retrieve an existing) pairing code for a Discord user interacting
 * via a slash command.  Used by the slash command handler so unpaired users get a
 * real code they can enter in the app right away.
 */
export function generateSlashCommandPairingCode(discordUserId: string, discordUsername: string): string {
  // Re-use any existing non-expired code for this user
  for (const [code, rec] of pairingCodes) {
    if (
      rec.botOwnerId === SHARED_BOT_KEY &&
      rec.discordUserId === discordUserId &&
      rec.expiresAt > Date.now()
    ) {
      return code;
    }
  }
  const code = generateCode(6);
  pairingCodes.set(code, {
    botOwnerId: SHARED_BOT_KEY,
    discordUserId,
    discordDmChannelId: "",   // no DM channel available in slash command context
    discordUsername,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  return code;
}

export function getPairingCodeFor(botOwnerId: string, discordUserId: string): string | null {
  for (const [code, rec] of pairingCodes) {
    if (rec.botOwnerId === botOwnerId && rec.discordUserId === discordUserId && rec.expiresAt > Date.now()) {
      return code;
    }
  }
  return null;
}

export async function completePairing(userId: string, code: string): Promise<{ ok: boolean; discordUsername?: string; error?: string }> {
  const rec = pairingCodes.get(code.toUpperCase());
  if (!rec) return { ok: false, error: "Invalid or expired pairing code." };
  if (rec.expiresAt < Date.now()) {
    pairingCodes.delete(code.toUpperCase());
    return { ok: false, error: "Pairing code has expired." };
  }
  // For the shared bot, any Jarvis user can claim the code (the 6-char OTP is
  // the sole security gate).  For per-user bots keep the strict owner check.
  if (rec.botOwnerId !== SHARED_BOT_KEY && rec.botOwnerId !== userId) {
    return { ok: false, error: "This pairing code belongs to a different account." };
  }

  // Replace any existing Discord link for this user (prevents stale rows that
  // could cause outbound messages to reach a prior Discord identity).
  try {
    const meta: DiscordLinkMeta = {
      discordUsername: rec.discordUsername,
      dmChannelId: rec.discordDmChannelId,
      allowlistedGuilds: [],
    };
    // Delete old link for this user (any address) then insert fresh row.
    // Also delete any link where another user had the same Discord ID (re-linking).
    await db.delete(channelLinks).where(
      and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord"))
    );
    await db.delete(channelLinks).where(
      and(eq(channelLinks.channel, "discord"), eq(channelLinks.address, rec.discordUserId))
    );
    await db.insert(channelLinks).values({
      userId,
      channel: "discord",
      address: rec.discordUserId,
      metadata: meta as unknown,
      linkedAt: new Date(),
    });
  } catch (err) {
    console.error("[DiscordManager] completePairing DB write failed:", err);
    return { ok: false, error: "Database error — please try again." };
  }

  // Remove used code
  pairingCodes.delete(code.toUpperCase());

  // Notify the Discord user (use shared bot as fallback)
  const client = getClientForUser(userId);
  if (client) {
    try {
      const dmChannel = await client.channels.fetch(rec.discordDmChannelId);
      if (dmChannel && (dmChannel as DMChannel).send) {
        await (dmChannel as DMChannel).send(
          "✅ Your Discord account is now linked to Jarvis! You can chat with me directly here anytime.",
        );
      }
    } catch {
      // non-fatal
    }
  }

  return { ok: true, discordUsername: rec.discordUsername };
}

// ── Outbound send ────────────────────────────────────────────────────────────

export async function sendToDiscordUser(userId: string, text: string): Promise<boolean> {
  const result = await sendToDiscordUserGetId(userId, text);
  return result.sent;
}

/**
 * Send a DM to a Discord user and return the sent message ID and channel ID.
 * Useful for reply-thread routing (e.g. storing in questionMeta).
 */
export async function sendToDiscordUserGetId(
  userId: string,
  text: string,
): Promise<{ sent: boolean; messageId?: string; channelId?: string }> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return { sent: false };

  const link = await lookupLink(userId);
  if (!link) return { sent: false };

  let dmChannelId = link.meta.dmChannelId;
  const discordUserId = link.address;

  try {
    if (!dmChannelId) {
      const discordUser = await client.users.fetch(discordUserId);
      const dm = await discordUser.createDM();
      dmChannelId = dm.id;
      // Cache it
      await db
        .update(channelLinks)
        .set({ metadata: { ...link.meta, dmChannelId } })
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")));
    }

    const channel = await client.channels.fetch(dmChannelId) as DMChannel | null;
    if (!channel) return { sent: false };

    const chunks = splitIntoChunks(text, 1900);
    let lastMsgId: string | undefined;
    let lastChannelId: string | undefined;
    for (const chunk of chunks) {
      const sent = await (channel as SendableChannels).send(chunk);
      lastMsgId = sent.id;
      lastChannelId = sent.channelId;
    }
    return { sent: true, messageId: lastMsgId, channelId: lastChannelId };
  } catch (err) {
    console.error(`[DiscordManager] sendToDiscordUserGetId failed for ${userId}:`, err);
    return { sent: false };
  }
}

/**
 * Send a file attachment to a Discord user via their DM channel.
 * Returns true when the message was sent successfully.
 */
export async function sendFileToDiscordUser(
  userId: string,
  filename: string,
  content: Buffer,
  description?: string,
): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return false;

  const link = await lookupLink(userId);
  if (!link) return false;

  let dmChannelId = link.meta.dmChannelId;
  const discordUserId = link.address;

  try {
    if (!dmChannelId) {
      const discordUser = await client.users.fetch(discordUserId);
      const dm = await discordUser.createDM();
      dmChannelId = dm.id;
      await db
        .update(channelLinks)
        .set({ metadata: { ...link.meta, dmChannelId } })
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")));
    }

    const channel = await client.channels.fetch(dmChannelId) as DMChannel | null;
    if (!channel) return false;

    const attachment = new AttachmentBuilder(content, { name: filename, description });
    await (channel as SendableChannels).send({ files: [attachment] });
    return true;
  } catch (err) {
    console.error(`[DiscordManager] sendFileToDiscordUser failed for ${userId}:`, err);
    return false;
  }
}

// ── Guild info ────────────────────────────────────────────────────────────────

export function getGuildsForUser(userId: string): { id: string; name: string; icon: string | null }[] {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return [];
  return client.guilds.cache.map((g) => ({ id: g.id, name: g.name, icon: g.iconURL() }));
}

export async function getChannelsForGuild(
  userId: string,
  guildId: string,
): Promise<{ id: string; name: string; type: string }[]> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return [];
  try {
    const guild = await client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    return channels
      .filter((ch): ch is NonNullable<typeof ch> => !!ch && ch.isTextBased && ch.isTextBased())
      .map((ch) => ({ id: ch.id, name: (ch as GuildBasedChannel).name, type: ch.type.toString() }));
  } catch {
    return [];
  }
}

// ── Workspace ────────────────────────────────────────────────────────────────

export { WORKSPACE_TOPICS, classifyTopic, type WorkspaceMeta } from "./workspace";

// ── Discord channel creation ────────────────────────────────────────────────

/**
 * Create a new text channel in the user's Discord server.
 *
 * Guild resolution order:
 *   1. `linkMeta.workspace.guildId` — stored workspace metadata (primary)
 *   2. `opts.ctxGuildId`            — guild ID from the incoming Discord message context
 *                                     (fallback when workspace setup hasn't been run)
 * Creation is refused when neither source yields a guild ID.
 */
export async function createDiscordChannel(
  userId: string,
  opts: { channelName: string; topic?: string; categoryName?: string; pinMessage?: string; guildId?: string; ctxGuildId?: string },
): Promise<{ ok: boolean; error?: string; channelId?: string }> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) {
    return { ok: false, error: "Discord bot is not running." };
  }

  // Resolve linked guild from the user's channel_links row
  const linkRow = await db
    .select()
    .from(channelLinks)
    .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
    .limit(1);
  const linkMeta = (linkRow[0]?.metadata as DiscordLinkMeta) ?? {};
  const linkedGuildId = linkMeta.workspace?.guildId;

  // Fall back to the guild ID surfaced from the incoming Discord message context
  // (set when the user sends the request from within a Discord guild channel).
  const resolvedGuildId = linkedGuildId ?? opts.ctxGuildId;

  if (!resolvedGuildId) {
    return { ok: false, error: "No linked Discord server found. Please message Jarvis from within your Discord server so it can identify which server to act on." };
  }

  // If an explicit guildId was provided by the agent, it must match the resolved guild
  if (opts.guildId && opts.guildId !== resolvedGuildId) {
    return {
      ok: false,
      error: `The requested server (${opts.guildId}) does not match your linked Jarvis server (${resolvedGuildId}). Channel creation is only allowed in your linked server.`,
    };
  }

  const guildsCache = client.guilds.cache;
  if (guildsCache.size === 0) {
    return { ok: false, error: "Bot is not in any Discord server." };
  }

  const rawGuild = guildsCache.get(resolvedGuildId);
  if (!rawGuild) {
    return { ok: false, error: "Bot is not in the linked Discord server." };
  }
  const guild = await rawGuild.fetch();
  // Populate channel cache so category lookups and duplicate checks work
  await guild.channels.fetch();

  const { ChannelType } = await import("discord.js");

  let parentId: string | undefined;
  if (opts.categoryName) {
    const cat = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === opts.categoryName!.toLowerCase(),
    );
    if (cat) parentId = cat.id;
  }

  const slug = opts.channelName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  // Avoid creating a duplicate channel with the same name in the same parent
  const duplicate = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name === slug && (parentId ? (ch as import("discord.js").TextChannel).parentId === parentId : true),
  );
  if (duplicate) {
    return { ok: true, channelId: duplicate.id };
  }

  try {
    const created = await guild.channels.create({
      name: slug,
      type: ChannelType.GuildText,
      topic: opts.topic,
      parent: parentId,
    }) as import("discord.js").TextChannel;

    if (opts.pinMessage) {
      const msg = await created.send(opts.pinMessage).catch(() => null);
      if (msg && msg.pin) await msg.pin().catch(() => {});
    }

    return { ok: true, channelId: created.id };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Failed to create channel." };
  }
}

/**
 * Delete a text channel from the user's Discord server by name or ID.
 * Only text channels are eligible; categories and voice channels are excluded.
 *
 * Guild resolution order:
 *   1. `linkMeta.workspace.guildId` — stored workspace metadata (primary)
 *   2. `opts.ctxGuildId`            — guild ID from the incoming Discord message context
 *                                     (fallback when workspace setup hasn't been run)
 * Deletion is refused when neither source yields a guild ID.
 *
 * Returns { ambiguous: true, matches } when multiple channels share the same name
 * so the caller can ask the user to specify a channelId.
 */
export async function deleteDiscordChannel(
  userId: string,
  opts: { channelName?: string; channelId?: string; guildId?: string; ctxGuildId?: string },
): Promise<{
  ok: boolean;
  error?: string;
  channelName?: string;
  ambiguous?: boolean;
  matches?: Array<{ id: string; name: string }>;
}> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) {
    return { ok: false, error: "Discord bot is not running." };
  }

  // Resolve linked guild from the user's channel_links row
  const linkRow = await db
    .select()
    .from(channelLinks)
    .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
    .limit(1);
  const linkMeta = (linkRow[0]?.metadata as DiscordLinkMeta) ?? {};
  const linkedGuildId = linkMeta.workspace?.guildId;

  // Fall back to the guild ID surfaced from the incoming Discord message context
  // (set when the user sends the request from within a Discord guild channel).
  const resolvedGuildId = linkedGuildId ?? opts.ctxGuildId;

  if (!resolvedGuildId) {
    return { ok: false, error: "No linked Discord server found. Please message Jarvis from within your Discord server so it can identify which server to act on." };
  }

  // If an explicit guildId was provided by the agent, it must match the resolved guild
  if (opts.guildId && opts.guildId !== resolvedGuildId) {
    return {
      ok: false,
      error: `The requested server (${opts.guildId}) does not match your linked Jarvis server (${resolvedGuildId}). Deletion is only allowed in your linked server.`,
    };
  }

  const rawGuild = client.guilds.cache.get(resolvedGuildId);
  if (!rawGuild) {
    return { ok: false, error: `Bot is not in the linked server (${resolvedGuildId}).` };
  }
  const guild = await rawGuild.fetch();
  await guild.channels.fetch();

  const { ChannelType } = await import("discord.js");

  // Resolve channel by ID first (unambiguous), then by name
  let target: TextChannel | undefined;
  if (opts.channelId) {
    const ch = guild.channels.cache.get(opts.channelId);
    if (!ch || ch.type !== ChannelType.GuildText) {
      return { ok: false, error: `Channel ID ${opts.channelId} not found or is not a text channel in ${guild.name}.` };
    }
    target = ch as TextChannel;
  } else if (opts.channelName) {
    // Normalize the user-supplied name to an ASCII slug (hyphens, lowercase, no punctuation)
    // so "thinking", "#thinking", and "🧠thinking" all resolve correctly.
    const inputLower = opts.channelName.toLowerCase().trim().replace(/^#/, "");
    const inputSlug = inputLower.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    const allMatches = guild.channels.cache
      .filter((ch) => {
        if (ch.type !== ChannelType.GuildText) return false;
        const chName = ch.name; // Discord channel names are already lowercase
        // Match exact, slug-normalized, or suffix (handles emoji-prefixed workspace channels
        // like "🧠thinking" — Discord stores emoji as the raw character in the channel name).
        const chSlug = chName.replace(/[^a-z0-9-]/g, "");
        return (
          chName === inputLower ||
          chName === inputSlug ||
          chSlug === inputSlug
        );
      })
      .map((ch) => ({ id: ch.id, name: ch.name }));

    if (allMatches.length === 0) {
      return { ok: false, error: `No text channel named "${opts.channelName}" found in ${guild.name}.` };
    }
    if (allMatches.length > 1) {
      // Multiple channels share the same name — caller must disambiguate with channelId
      return { ok: false, ambiguous: true, matches: allMatches };
    }
    target = guild.channels.cache.get(allMatches[0].id) as TextChannel;
  }

  if (!target) {
    return { ok: false, error: "Please provide either a channel name or channel ID." };
  }

  try {
    const deletedName = target.name;
    await target.delete("Deleted by Jarvis on user request");
    console.log(`[DiscordManager] deleted channel #${deletedName} (${target.id}) in guild ${guild.id}`);
    return { ok: true, channelName: deletedName };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete channel." };
  }
}

/** Set up the Jarvis Workspace category + topic channels in a guild. */
export async function setupDiscordWorkspace(
  userId: string,
  guildId: string,
): Promise<{ ok: boolean; error?: string; workspace?: WorkspaceMeta }> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) {
    return { ok: false, error: "Discord bot is not running. Make sure the bot is in the server." };
  }
  return _setupWorkspace(client, userId, guildId);
}

/**
 * Post a message to any Discord channel by its raw channel ID.
 * Used by scheduled reports to deliver to non-workspace channels.
 */
export async function postToDiscordChannelById(
  userId: string,
  channelId: string,
  text: string,
): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return false;

  try {
    const { TextChannel } = await import("discord.js");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return false;

    const chunks = splitIntoChunks(text, 1900);
    for (const chunk of chunks) {
      await (channel as SendableChannels).send(chunk);
    }
    return true;
  } catch (err) {
    console.error(`[DiscordManager] postToDiscordChannelById failed for channel ${channelId}:`, err);
    return false;
  }
}

/**
 * Send a file attachment to a specific Discord text channel by ID.
 * Used by the job-completion notifier so PDF attachments land in the originating channel,
 * not just in the user's DMs.
 */
export async function sendFileToDiscordChannel(
  userId: string,
  channelId: string,
  filename: string,
  content: Buffer,
  description?: string,
): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return false;
  try {
    const { TextChannel } = await import("discord.js");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return false;
    const attachment = new AttachmentBuilder(content, { name: filename, description });
    await (channel as SendableChannels).send({ files: [attachment] });
    return true;
  } catch (err) {
    console.error(`[DiscordManager] sendFileToDiscordChannel failed for channel ${channelId}:`, err);
    return false;
  }
}

/**
 * Post a single message to a channel by name or ID and return its Discord message ID.
 * Used by the multi-script pipeline runner so each script can have its own approval registered.
 * Returns null if the channel was not found or the send failed.
 */
export async function postMessageAndGetId(
  userId: string,
  channelName: string,
  channelId: string | null,
  text: string,
): Promise<string | null> {
  const info = await postMessageAndGetInfo(userId, channelName, channelId, text);
  return info?.messageId ?? null;
}

/**
 * Like postMessageAndGetId but also returns the real Discord channel ID.
 * Useful when the caller needs to perform a follow-up action (e.g. pin) on the channel.
 */
export async function postMessageAndGetInfo(
  userId: string,
  channelName: string,
  channelId: string | null,
  text: string,
): Promise<{ messageId: string; channelId: string } | null> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return null;

  const { ChannelType } = await import("discord.js");

  try {
    let targetChannel: TextChannel | null = null;

    if (channelId) {
      try {
        const ch = await client.channels.fetch(channelId);
        if (ch && ch.isTextBased()) targetChannel = ch as TextChannel;
      } catch { /* fall through */ }
    }

    if (!targetChannel && channelName) {
      const slug = channelName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      for (const guild of client.guilds.cache.values()) {
        const fetchedGuild = await guild.fetch().catch(() => null);
        if (!fetchedGuild) continue;
        const channels = await fetchedGuild.channels.fetch().catch(() => null);
        if (!channels) continue;
        const match = channels.find(
          (ch) => ch && ch.type === ChannelType.GuildText && (ch as TextChannel).name === slug,
        ) as TextChannel | undefined;
        if (match) { targetChannel = match; break; }
      }
    }

    if (!targetChannel) return null;

    const chunks = splitIntoChunks(text, 1900);
    const firstMsg = await targetChannel.send(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await targetChannel.send(chunks[i]).catch(() => {});
    }
    return { messageId: firstMsg.id, channelId: targetChannel.id };
  } catch (err) {
    console.error("[DiscordManager] postMessageAndGetInfo failed:", err);
    return null;
  }
}

/** Post a message to a topic channel in the user's workspace. */
export async function postToDiscordWorkspace(
  userId: string,
  topicKey: string,
  text: string,
): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return false;

  const link = await lookupLink(userId);
  const workspace = link?.meta.workspace;
  if (!workspace) return false;

  return _postToTopicChannel(client, workspace, topicKey, text);
}

// ── Phase 1: Post to channel by name or ID ───────────────────────────────────

/**
 * Post a message to a Discord channel identified by ID or name.
 * First tries to find the channel by ID, then by name across all guilds.
 */
export async function postToDiscordChannel(
  userId: string,
  channelName: string,
  channelId: string | null,
  text: string,
): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return false;

  const { ChannelType } = await import("discord.js");

  try {
    let targetChannel: TextChannel | null = null;

    // Try by channel ID first
    if (channelId) {
      try {
        const ch = await client.channels.fetch(channelId);
        if (ch && ch.isTextBased()) targetChannel = ch as TextChannel;
      } catch {
        // fall through to name lookup
      }
    }

    // Fall back to name search across all guilds
    if (!targetChannel && channelName) {
      const slug = channelName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      for (const guild of client.guilds.cache.values()) {
        const fetchedGuild = await guild.fetch().catch(() => null);
        if (!fetchedGuild) continue;
        const channels = await fetchedGuild.channels.fetch().catch(() => null);
        if (!channels) continue;
        const match = channels.find(
          (ch) =>
            ch &&
            ch.type === ChannelType.GuildText &&
            (ch as TextChannel).name === slug,
        ) as TextChannel | undefined;
        if (match) { targetChannel = match; break; }
      }
    }

    if (!targetChannel) {
      console.warn(`[DiscordManager] postToDiscordChannel: channel not found (name=${channelName}, id=${channelId})`);
      return false;
    }

    const chunks = splitIntoChunks(text, 1900);
    for (const chunk of chunks) {
      await targetChannel.send(chunk);
    }
    return true;
  } catch (err) {
    console.error(`[DiscordManager] postToDiscordChannel failed:`, err);
    return false;
  }
}

// ── Phase 5: Pin message ─────────────────────────────────────────────────────

/**
 * Pin a message in a Discord channel.
 */
export async function pinDiscordMessage(
  userId: string,
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const client = getClientForUser(userId);
  if (!client || !client.isReady()) return false;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return false;
    const textChannel = channel as TextChannel;
    const msg = await textChannel.messages.fetch(messageId);
    if (!msg) return false;
    await msg.pin();
    return true;
  } catch (err) {
    console.error(`[DiscordManager] pinDiscordMessage failed:`, err);
    return false;
  }
}

// ── Phase 3: Reaction handler ─────────────────────────────────────────────────

function buildReactionHandler(botOwnerId: string) {
  return async (reaction: MessageReaction | PartialMessageReaction, user: DiscordUser | PartialUser) => {
    try {
      // Ignore bot reactions
      if (user.bot) return;

      // Fetch partial reaction/message if needed
      if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
      }
      if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch { return; }
      }

      const messageId = reaction.message.id;
      const emoji = reaction.emoji.name || "";

      // For the shared bot, resolve the actual Jarvis userId from the reactor's
      // Discord ID.  Per-user bots use botOwnerId directly.
      let effectiveUserId = botOwnerId;
      if (botOwnerId === SHARED_BOT_KEY) {
        const reactorPaired = await lookupUserByDiscordId(user.id as string);
        if (!reactorPaired) return; // unknown Discord user — nothing to process
        effectiveUserId = reactorPaired.userId;
      }

      // Look up pending approval
      const rows = await db
        .select()
        .from(discordPendingApprovals)
        .where(
          and(
            eq(discordPendingApprovals.messageId, messageId),
            eq(discordPendingApprovals.userId, effectiveUserId),
            eq(discordPendingApprovals.status, "pending"),
          ),
        )
        .limit(1);

      if (!rows[0]) return;
      const approval = rows[0];

      const isApprove = emoji === approval.approveEmoji;
      const isReject = emoji === approval.rejectEmoji;
      if (!isApprove && !isReject) return;

      const newStatus = isApprove ? "approved" : "rejected";
      await db
        .update(discordPendingApprovals)
        .set({ status: newStatus, resolvedAt: new Date() })
        .where(eq(discordPendingApprovals.messageId, messageId));

      console.log(`[DiscordManager] Approval ${messageId} ${newStatus} via reaction`);

      // Record preference signal for the feedback training loop
      const { recordApprovalSignal } = await import("./approvalLearning");
      recordApprovalSignal({
        userId: effectiveUserId,
        approved: isApprove,
        contentType: approval.type,
        content: approval.content,
        channelId: approval.channelId,
        messageId,
      }).catch(() => {});

      // Execute action
      const actionData = isApprove ? approval.onApprove : approval.onReject;
      if (actionData) {
        const { executeApprovalAction } = await import("./approvalActions");
        executeApprovalAction(
          effectiveUserId,
          actionData as any,
          approval.content,
          approval.channelId,
        ).catch((err) => console.error("[DiscordManager] approval action failed:", err));
      }

      // Add confirmation reaction
      try {
        await reaction.message.react(isApprove ? "✅" : "❌");
      } catch { }

    } catch (err) {
      console.error("[DiscordManager] buildReactionHandler error:", err);
    }
  };
}

// ── Phase 6: Named agent lookup ──────────────────────────────────────────────

async function getNamedAgentForChannel(userId: string, channelId: string): Promise<{ name: string; persona: string } | null> {
  try {
    const rows = await db
      .select()
      .from(discordAgents)
      .where(
        and(
          eq(discordAgents.userId, userId),
          eq(discordAgents.channelId, channelId),
          eq(discordAgents.isActive, 1),
        ),
      )
      .limit(1);
    const agent = rows[0];
    if (!agent || !agent.persona) return null;
    return { name: agent.name, persona: agent.persona };
  } catch {
    return null;
  }
}

// ── Phase 6: Register or update a named agent in DB ─────────────────────────

export async function registerNamedAgent(
  userId: string,
  params: {
    name: string;
    role: string;
    persona?: string;
    channelId?: string;
    channelName?: string;
    loopEnabled?: boolean;
    loopIntervalMinutes?: number;
    loopPrompt?: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(discordAgents)
    .values({
      userId,
      name: params.name,
      role: params.role,
      persona: params.persona,
      channelId: params.channelId,
      channelName: params.channelName,
      isActive: 1,
      loopEnabled: params.loopEnabled ? 1 : 0,
      loopIntervalMinutes: params.loopIntervalMinutes ?? 60,
      loopPrompt: params.loopPrompt,
    })
    .returning({ id: discordAgents.id });
  return row.id;
}

// ── Shared bot startup ───────────────────────────────────────────────────────

/**
 * Boot the shared Jarvis Discord bot from DISCORD_BOT_TOKEN.
 * The bot is keyed `'__shared__'` in botClients.  It handles messages from
 * every paired Discord user, routing them to the correct Jarvis account by
 * looking up the sender's discord_id in channel_links.
 *
 * Safe to call multiple times — if the bot is already running this is a no-op.
 */
export async function bootSharedBot(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log("[DiscordManager] DISCORD_BOT_TOKEN not set — shared bot disabled.");
    return;
  }

  // Don't re-boot if already running
  const existing = botClients.get(SHARED_BOT_KEY);
  if (existing && existing.isReady()) {
    console.log("[DiscordManager] Shared bot already running — skipping boot.");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[DiscordManager] Shared bot ready: ${c.user.tag}`);
    // Register /jarvis slash commands globally once the bot is ready.
    import("./slashCommands").then(({ registerSlashCommands }) => {
      registerSlashCommands().catch((err) =>
        console.error("[DiscordManager] slash command registration failed:", err),
      );
    }).catch(() => {});
  });

  client.on(Events.MessageCreate, buildMessageHandler(SHARED_BOT_KEY, client));
  client.on(Events.MessageReactionAdd, buildReactionHandler(SHARED_BOT_KEY));

  client.on(Events.Error, (err) => {
    console.error("[DiscordManager] Shared bot error:", err.message);
  });

  botClients.set(SHARED_BOT_KEY, client);

  try {
    await client.login(token);
  } catch (err) {
    console.error("[DiscordManager] Shared bot login failed:", err);
    botClients.delete(SHARED_BOT_KEY);
  }
}
