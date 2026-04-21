import { Client, GatewayIntentBits, Events, Partials, Message, DMChannel } from "discord.js";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks, users } from "@shared/schema";
import { getUserToken, saveUserToken, deleteUserToken } from "../userTokenStore";
import { runCoachAgent } from "../channels/coachAgent";

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

function generateCode(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Prune expired pairing codes every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [code, rec] of pairingCodes) {
    if (rec.expiresAt < now) pairingCodes.delete(code);
  }
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

// ── Message handler factory ────────────────────────────────────────────────

function buildMessageHandler(botOwnerId: string, client: Client) {
  return async (message: Message) => {
    if (message.author.bot) return;

    const isDM = message.channel.isDMBased();
    const discordUserId = message.author.id;
    const discordUsername = message.author.tag || message.author.username;

    // ── Determine if we should respond ──────────────────────────────────
    if (!isDM) {
      // Guild channel — only respond if allowlisted
      const link = await lookupLink(botOwnerId);
      if (!link) return;
      if (link.address !== discordUserId) return; // only the paired user
      const allowed = link.meta.allowlistedGuilds || [];
      const guildId = (message.guild?.id) ?? "";
      const channelId = message.channelId;
      const guildEntry = allowed.find((g) => g.guildId === guildId && g.channelId === channelId);
      if (!guildEntry) return;
      if (guildEntry.requireMention) {
        const botId = client.user?.id;
        const mentioned = message.mentions.users.has(botId ?? "");
        if (!mentioned) return;
      }
    }

    // ── DM path: check if user is paired to this bot ───────────────────
    const pairedUser = await lookupUserByDiscordId(discordUserId);

    if (!pairedUser || pairedUser.userId !== botOwnerId) {
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
            `To link this Discord account, use **either** of these:\n\n` +
            `**Option A — in the app:** Profile → Connected Channels → Discord → enter code\n` +
            `**Option B — via Telegram:** Send \`approve ${code}\` to your Jarvis Telegram bot\n\n` +
            `Your pairing code: \`\`\`${code}\`\`\`\nValid for 1 hour. Message me again once linked!`,
        )
        .catch((err) => console.error("[DiscordManager] reply failed:", err));
      return;
    }

    const userId = pairedUser.userId;

    // ── Update last_seen_at ─────────────────────────────────────────────
    db.update(channelLinks)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")))
      .catch(() => {});

    // ── Audio attachment transcription ─────────────────────────────────
    let userText = message.content?.trim() || "";
    const audioAtt = [...message.attachments.values()].find(
      (a) => a.contentType?.startsWith("audio/") || a.contentType?.startsWith("video/"),
    );

    if (audioAtt && !userText) {
      let typingMsg: Message | null = null;
      try {
        typingMsg = await message.channel.send("🎤 Transcribing voice message…");
        const resp = await fetch(audioAtt.url);
        const arrBuf = await resp.arrayBuffer();
        const buf = Buffer.from(arrBuf);
        const { speechToText, detectAudioFormat } = await import(
          "../replit_integrations/audio/client"
        );
        const format = detectAudioFormat(buf);
        const transcript = await speechToText(buf, format);
        if (!transcript?.trim()) {
          await typingMsg.edit("Sorry, I couldn't make out that voice message — could you type it out?");
          return;
        }
        userText = transcript.trim();
        const preview = userText.length > 100 ? userText.slice(0, 100) + "…" : userText;
        await typingMsg.edit(`🎤 *"${preview}"*`);
      } catch (err) {
        console.error("[DiscordManager] voice transcription failed:", err);
        if (typingMsg) await typingMsg.edit("Sorry, transcription failed — please type your message.").catch(() => {});
        return;
      }
    }

    if (!userText) return;

    // ── Route through coach pipeline with streaming edits ──────────────
    let placeholder: Message | null = null;
    try {
      placeholder = await message.channel.send("_Thinking…_");
    } catch {
      // ignore send failure for placeholder
    }

    // Streaming: accumulate chunks and edit the placeholder at most once
    // per ~900 ms to stay well within Discord's edit rate limits.
    let streamBuf = "";
    let lastEditAt = 0;
    const STREAM_INTERVAL = 900;
    const onToken = (chunk: string) => {
      streamBuf += chunk;
      const now = Date.now();
      if (placeholder && now - lastEditAt >= STREAM_INTERVAL && streamBuf.length > 0) {
        placeholder.edit(streamBuf + " ▌").catch(() => {});
        lastEditAt = now;
      }
    };

    try {
      const result = await runCoachAgent({
        userId,
        userText,
        channelName: "Discord",
        onToken,
      });

      const reply = result.reply || "Sorry, I couldn't generate a response right now.";

      if (placeholder) {
        await editOrSendLong(placeholder, reply);
      } else {
        await sendLong(message.channel as any, reply);
      }
    } catch (err) {
      console.error("[DiscordManager] runCoachAgent failed:", err);
      if (placeholder) {
        await placeholder.edit("Sorry, something went wrong — please try again.").catch(() => {});
      }
    }
  };
}

// Discord messages are capped at 2000 chars — split long replies
async function editOrSendLong(msg: Message, text: string): Promise<void> {
  const chunks = splitIntoChunks(text, 1900);
  await msg.edit(chunks[0]).catch(() => {});
  for (let i = 1; i < chunks.length; i++) {
    await msg.channel.send(chunks[i]).catch(() => {});
  }
}

async function sendLong(channel: { send(t: string): Promise<unknown> }, text: string): Promise<void> {
  const chunks = splitIntoChunks(text, 1900);
  for (const chunk of chunks) {
    await channel.send(chunk).catch(() => {});
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
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[DiscordManager] Bot ready for user ${userId}: ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, buildMessageHandler(userId, client));

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
  const client = botClients.get(userId);
  if (!client) return "stopped";
  return client.isReady() ? "running" : "stopped";
}

export async function bootAllBots(): Promise<void> {
  try {
    const { db: _db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const rows = await _db.execute(
      sql`SELECT user_id, access_token FROM user_oauth_tokens WHERE provider = 'discord_bot'`,
    );
    const items: { user_id: string; access_token: string }[] =
      (rows as any).rows ?? (Array.isArray(rows) ? rows : []);
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
  if (rec.botOwnerId !== userId) {
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
      metadata: meta as any,
      linkedAt: new Date(),
    });
  } catch (err) {
    console.error("[DiscordManager] completePairing DB write failed:", err);
    return { ok: false, error: "Database error — please try again." };
  }

  // Remove used code
  pairingCodes.delete(code.toUpperCase());

  // Notify the Discord user
  const client = botClients.get(userId);
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
  const client = botClients.get(userId);
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
      // Cache it
      await db
        .update(channelLinks)
        .set({ metadata: { ...link.meta, dmChannelId } })
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "discord")));
    }

    const channel = await client.channels.fetch(dmChannelId) as DMChannel | null;
    if (!channel) return false;

    const chunks = splitIntoChunks(text, 1900);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
    return true;
  } catch (err) {
    console.error(`[DiscordManager] sendToDiscordUser failed for ${userId}:`, err);
    return false;
  }
}

// ── Guild info ────────────────────────────────────────────────────────────────

export function getGuildsForUser(userId: string): { id: string; name: string; icon: string | null }[] {
  const client = botClients.get(userId);
  if (!client || !client.isReady()) return [];
  return client.guilds.cache.map((g) => ({ id: g.id, name: g.name, icon: g.iconURL() }));
}

export async function getChannelsForGuild(
  userId: string,
  guildId: string,
): Promise<{ id: string; name: string; type: string }[]> {
  const client = botClients.get(userId);
  if (!client || !client.isReady()) return [];
  try {
    const guild = await client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    return channels
      .filter((ch): ch is NonNullable<typeof ch> => !!ch && ch.isTextBased && ch.isTextBased())
      .map((ch) => ({ id: ch.id, name: (ch as any).name ?? ch.id, type: ch.type.toString() }));
  } catch {
    return [];
  }
}
