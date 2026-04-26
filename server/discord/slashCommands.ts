/**
 * Discord Slash Commands for Jarvis
 *
 * Handles:
 * 1. Registering /jarvis subcommands with the Discord REST API (idempotent).
 * 2. Verifying and dispatching incoming interaction POSTs.
 * 3. Subcommand handlers: chat, plan, status, help.
 */

import * as crypto from "node:crypto";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { channelLinks } from "@shared/schema";
import { runCoachAgent } from "../channels/coachAgent";

import { generateSlashCommandPairingCode } from "./manager";

// ── Constants ────────────────────────────────────────────────────────────────

const DISCORD_API = "https://discord.com/api/v10";

/** Ephemeral flag — only the invoking user sees the reply. */
const EPHEMERAL = 64;

/** Interaction response types */
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

const InteractionCallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

// ── Slash command definition ─────────────────────────────────────────────────

const JARVIS_COMMAND = {
  name: "jarvis",
  description: "Talk to Jarvis, your AI productivity coach",
  options: [
    {
      type: 1, // SUB_COMMAND
      name: "chat",
      description: "Send a message to Jarvis from any channel",
      options: [
        {
          type: 3, // STRING
          name: "message",
          description: "What do you want to tell Jarvis?",
          required: true,
        },
        {
          type: 5, // BOOLEAN
          name: "public",
          description: "Post the reply visibly to the channel (default: only you see it)",
          required: false,
        },
      ],
    },
    {
      type: 1,
      name: "plan",
      description: "Build your daily plan with Jarvis",
    },
    {
      type: 1,
      name: "status",
      description: "Check the status of active Jarvis background jobs",
    },
    {
      type: 1,
      name: "help",
      description: "Show all available Jarvis slash commands",
    },
  ],
};

// ── Signature verification ───────────────────────────────────────────────────

/**
 * Verify a Discord interaction request using Ed25519.
 * Returns true when the signature is valid.
 */
export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: Buffer,
): boolean {
  try {
    // Build the DER-encoded SPKI wrapper for a raw Ed25519 public key.
    // Ed25519 SPKI OID prefix (ASN.1): 30 2a 30 05 06 03 2b 65 70 03 21 00
    const derPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const keyBytes = Buffer.from(publicKeyHex, "hex");
    const derKey = Buffer.concat([derPrefix, keyBytes]);

    const publicKey = crypto.createPublicKey({
      key: derKey,
      format: "der",
      type: "spki",
    });

    const message = Buffer.concat([Buffer.from(timestamp, "utf-8"), rawBody]);
    const signature = Buffer.from(signatureHex, "hex");

    return crypto.verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}

// ── Command registration ─────────────────────────────────────────────────────

/**
 * Register slash commands globally with the Discord API.
 * Idempotent — checks the existing command list first; only updates when the
 * command definition has changed.
 */
export async function registerSlashCommands(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const appId = process.env.DISCORD_APP_ID || process.env.DISCORD_CLIENT_ID;

  if (!token || !appId) {
    console.log(
      "[SlashCommands] DISCORD_BOT_TOKEN or DISCORD_APP_ID not set — skipping command registration.",
    );
    return;
  }

  const url = `${DISCORD_API}/applications/${appId}/commands`;

  try {
    // Fetch existing global commands
    const listRes = await fetch(url, {
      headers: { Authorization: `Bot ${token}` },
    });

    if (!listRes.ok) {
      const body = await listRes.text();
      console.error(`[SlashCommands] Failed to fetch existing commands (${listRes.status}): ${body}`);
      return;
    }

    const existing: Array<{ name: string; id: string; description?: string; options?: unknown }> = await listRes.json();
    const existingJarvis = existing.find((c) => c.name === "jarvis");

    // Check if the /jarvis definition has changed before issuing a PUT.
    // We compare description and serialized options; if identical, skip the
    // network round-trip to avoid unnecessary Discord API calls on every boot.
    if (existingJarvis) {
      const existingOptions = JSON.stringify(existingJarvis.options ?? []);
      const wantedOptions = JSON.stringify(JARVIS_COMMAND.options);
      const existingDesc = existingJarvis.description ?? "";
      if (existingDesc === JARVIS_COMMAND.description && existingOptions === wantedOptions) {
        console.log(`[SlashCommands] /jarvis command unchanged — skipping registration update`);
        return;
      }
    }

    // Build the merged command list: keep all existing non-jarvis commands, then
    // add/replace the /jarvis command. This is non-destructive — other bot commands
    // (if any) are preserved rather than wiped by the PUT operation.
    const otherCommands = existing.filter((c) => c.name !== "jarvis");
    const mergedCommands = [...otherCommands, JARVIS_COMMAND];

    const putRes = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mergedCommands),
    });

    if (!putRes.ok) {
      const body = await putRes.text();
      console.error(`[SlashCommands] Command registration failed (${putRes.status}): ${body}`);
      return;
    }

    const registered: any[] = await putRes.json();
    const jarvisEntry = registered.find((c) => c.name === "jarvis");
    const action = existingJarvis ? "updated" : "registered";
    console.log(
      `[SlashCommands] /jarvis command ${action} (id=${jarvisEntry?.id}), total global commands: ${registered.length}`,
    );
  } catch (err) {
    console.error("[SlashCommands] registerSlashCommands error:", err);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function lookupUserByDiscordId(
  discordUserId: string,
): Promise<{ userId: string } | null> {
  try {
    const rows = await db
      .select({ userId: channelLinks.userId })
      .from(channelLinks)
      .where(
        and(
          eq(channelLinks.channel, "discord"),
          eq(channelLinks.address, discordUserId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Follow-up edit for a deferred interaction. */
async function editInteractionReply(
  appId: string,
  token: string,
  content: string,
  flags?: number,
): Promise<void> {
  const url = `${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`;
  const body: Record<string, unknown> = { content: content.slice(0, 2000) };
  if (flags !== undefined) body.flags = flags;

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[SlashCommands] editInteractionReply failed (${res.status}): ${text}`);
  }
}

/** PONG response — used for Discord's URL verification challenge. */
export function pongResponse() {
  return { type: InteractionCallbackType.PONG };
}

/** Immediate ephemeral text response. */
function immediateEphemeral(content: string) {
  return {
    type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: content.slice(0, 2000), flags: EPHEMERAL },
  };
}

/** Deferred response — Jarvis will follow up asynchronously. */
function deferredEphemeral() {
  return {
    type: InteractionCallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: EPHEMERAL },
  };
}

function deferredPublic() {
  return {
    type: InteractionCallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: {},
  };
}

// ── Subcommand handlers ──────────────────────────────────────────────────────

async function handleChat(
  appId: string,
  interaction: any,
  userId: string,
  isPublic: boolean,
): Promise<void> {
  const opts: any[] = interaction.data?.options?.[0]?.options ?? [];
  const message = opts.find((o: any) => o.name === "message")?.value ?? "";

  if (!message) {
    await editInteractionReply(
      appId,
      interaction.token,
      "Please include a message.",
      isPublic ? undefined : EPHEMERAL,
    );
    return;
  }

  const guildId = interaction.guild_id as string | undefined;

  try {
    const result = await runCoachAgent({
      userId,
      userText: message,
      channelName: "Discord",
      discordGuildId: guildId,
    });
    await editInteractionReply(
      appId,
      interaction.token,
      result.reply,
      isPublic ? undefined : EPHEMERAL,
    );
  } catch (err) {
    console.error("[SlashCommands] chat handler error:", err);
    await editInteractionReply(
      appId,
      interaction.token,
      "Sorry, something went wrong — please try again.",
      EPHEMERAL,
    );
  }
}

async function handlePlan(
  appId: string,
  interaction: any,
  userId: string,
): Promise<void> {
  try {
    // Use the same daily plan builder the morning scheduler uses so the output
    // is consistent with the "Build Plan" flow in the app.
    const { buildPlanForUser } = await import("../routes");
    const plan = await buildPlanForUser(userId);

    if (!plan || plan.tasks.length === 0) {
      await editInteractionReply(
        appId,
        interaction.token,
        "Couldn't build a plan right now — try adding some goals or checking in with your energy level in the app first.",
        EPHEMERAL,
      );
      return;
    }

    const lines: string[] = ["**Your daily plan**", ""];
    const priorityEmoji: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };
    for (const task of plan.tasks.slice(0, 8)) {
      const emoji = priorityEmoji[task.priority] ?? "⚪";
      const timeStr = task.time ? ` @ ${task.time}` : "";
      const durationStr = task.duration ? ` (${task.duration}m)` : "";
      lines.push(`${emoji} **${task.title}**${timeStr}${durationStr}`);
    }
    if (plan.reasoning) {
      lines.push("", `_${plan.reasoning.slice(0, 200)}_`);
    }

    await editInteractionReply(appId, interaction.token, lines.join("\n"), EPHEMERAL);
  } catch (err) {
    console.error("[SlashCommands] plan handler error:", err);
    await editInteractionReply(
      appId,
      interaction.token,
      "Sorry, I couldn't generate your plan right now — please try again.",
      EPHEMERAL,
    );
  }
}

async function handleStatus(
  appId: string,
  interaction: any,
  userId: string,
): Promise<void> {
  try {
    const jobs = await db
      .select({
        id: schema.agentJobs.id,
        title: schema.agentJobs.title,
        status: schema.agentJobs.status,
      })
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.userId, userId))
      .orderBy(desc(schema.agentJobs.createdAt))
      .limit(20);

    const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
    const lastDone = jobs.find((j) => j.status === "complete" || j.status === "failed");

    let summary: string;
    if (active.length === 0) {
      summary = lastDone
        ? `✅ No active jobs. Last completed: "${lastDone.title}".`
        : "✅ No active background jobs.";
    } else {
      const runningCount = active.filter((j) => j.status === "running").length;
      const queuedCount = active.filter((j) => j.status === "queued").length;
      const statusParts: string[] = [];
      if (runningCount > 0) statusParts.push(`${runningCount} running`);
      if (queuedCount > 0) statusParts.push(`${queuedCount} queued`);
      const firstTitle = active[0].title;
      summary = `⚙️ ${statusParts.join(", ")} — "${firstTitle}"${active.length > 1 ? ` (+${active.length - 1} more)` : ""}.`;
    }

    await editInteractionReply(appId, interaction.token, summary, EPHEMERAL);
  } catch (err) {
    console.error("[SlashCommands] status handler error:", err);
    await editInteractionReply(
      appId,
      interaction.token,
      "Sorry, I couldn't fetch your job status right now.",
      EPHEMERAL,
    );
  }
}

async function handleHelp(appId: string, interaction: any): Promise<void> {
  const help = [
    "**Jarvis Slash Commands**",
    "",
    "`/jarvis chat <message>` — Chat with Jarvis from any channel. Add `public:True` to share the reply.",
    "`/jarvis plan` — Generate your personalized daily plan.",
    "`/jarvis status` — Check the status of active background jobs.",
    "`/jarvis help` — Show this message.",
    "",
    "💡 Replies are private by default (only you see them).",
    "Connect Jarvis in the app under **Settings → Channels → Discord** to get started.",
  ].join("\n");

  await editInteractionReply(appId, interaction.token, help, EPHEMERAL);
}

// ── Main interaction dispatcher ──────────────────────────────────────────────

function buildPairingPrompt(discordUserId: string, discordUsername: string): string {
  const code = generateSlashCommandPairingCode(discordUserId, discordUsername);
  return (
    "👋 Your Discord account isn't linked to Jarvis yet.\n\n" +
    "**Your pairing code:** `" + code + "`\n\n" +
    "To link your account:\n" +
    "1. Open the **Jarvis** app\n" +
    "2. Go to **Settings → Channels → Discord**\n" +
    "3. Enter the code above\n\n" +
    "*(Code expires in 1 hour. Use `/jarvis help` again if it expires.)*"
  );
}

/**
 * Dispatch an incoming Discord interaction payload.
 * Returns the immediate HTTP response body.
 * Long-running work (chat, plan) is kicked off in the background.
 */
export async function handleInteraction(interaction: any): Promise<object> {
  const appId = process.env.DISCORD_APP_ID || process.env.DISCORD_CLIENT_ID || "";

  // ── Ping (used by Discord to verify the endpoint URL) ──────────────────
  if (interaction.type === InteractionType.PING) {
    return pongResponse();
  }

  // ── Slash command ───────────────────────────────────────────────────────
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    if (interaction.data?.name !== "jarvis") {
      return immediateEphemeral("Unknown command.");
    }

    const subcommand: string = interaction.data?.options?.[0]?.name ?? "";
    const memberUser = interaction.member?.user ?? interaction.user ?? {};
    const discordUserId: string = memberUser.id ?? "";
    const discordUsername: string = memberUser.username ?? memberUser.global_name ?? discordUserId;

    // All commands except help require the user to be paired
    if (subcommand !== "help") {
      const paired = await lookupUserByDiscordId(discordUserId);
      if (!paired) {
        return immediateEphemeral(buildPairingPrompt(discordUserId, discordUsername));
      }

      const userId = paired.userId;

      if (subcommand === "chat") {
        const opts: any[] = interaction.data?.options?.[0]?.options ?? [];
        const isPublic = opts.find((o: any) => o.name === "public")?.value === true;
        const deferred = isPublic ? deferredPublic() : deferredEphemeral();

        // Fire-and-forget the actual work after returning the deferred ACK
        setImmediate(() => {
          handleChat(appId, interaction, userId, isPublic).catch((err) =>
            console.error("[SlashCommands] handleChat background error:", err),
          );
        });
        return deferred;
      }

      if (subcommand === "plan") {
        setImmediate(() => {
          handlePlan(appId, interaction, userId).catch((err) =>
            console.error("[SlashCommands] handlePlan background error:", err),
          );
        });
        return deferredEphemeral();
      }

      if (subcommand === "status") {
        setImmediate(() => {
          handleStatus(appId, interaction, userId).catch((err) =>
            console.error("[SlashCommands] handleStatus background error:", err),
          );
        });
        return deferredEphemeral();
      }
    }

    if (subcommand === "help") {
      setImmediate(() => {
        handleHelp(appId, interaction).catch((err) =>
          console.error("[SlashCommands] handleHelp background error:", err),
        );
      });
      return deferredEphemeral();
    }

    return immediateEphemeral("Unknown subcommand.");
  }

  return { type: 1 };
}
