/**
 * Discord Slash Commands for Jarvis
 *
 * Handles:
 * 1. Registering /jarvis subcommands with the Discord REST API (idempotent).
 * 2. Verifying and dispatching incoming interaction POSTs.
 * 3. Subcommand handlers: chat, plan, status, help.
 * 4. Top-level task commands: /research, /plan, /write, /brief, /help.
 */

import * as crypto from "node:crypto";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { channelLinks } from "@shared/schema";
import { runCoachAgent } from "../channels/coachAgent";
import { routeSlashCommand, getHelpText, SLASH_COMMANDS } from "../channels/slashCommandRouter";
import { cancelAllForUser } from "../agent/jobClient";

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
      name: "audit",
      description: "Show the last self-repairs Jarvis made automatically",
      options: [
        {
          type: 4, // INTEGER
          name: "count",
          description: "Number of entries to show (1–10, default 5)",
          required: false,
          min_value: 1,
          max_value: 10,
        },
      ],
    },
    {
      type: 1,
      name: "reset_budget",
      description: "Reset the autonomous write counter (owner only)",
    },
    {
      type: 1,
      name: "assign_agent",
      description: "Assign a specialist agent to this channel (all messages route to it)",
      options: [
        {
          type: 3, // STRING
          name: "type",
          description: "Agent type: research, writing, planning, email, goal_decompose, or general (restore default)",
          required: true,
          choices: [
            { name: "🔬 Research", value: "research" },
            { name: "✍️ Writing", value: "writing" },
            { name: "📋 Planning", value: "planning" },
            { name: "📧 Email", value: "email" },
            { name: "🎯 Goal Decomposer", value: "goal_decompose" },
            { name: "🧠 General Coach (default)", value: "general" },
          ],
        },
      ],
    },
    {
      type: 1,
      name: "agent_status",
      description: "Show which specialist agent (if any) is assigned to this channel",
    },
    {
      type: 1,
      name: "agent",
      description: "Run one of your custom sub-agents by slug",
      options: [
        {
          type: 3,
          name: "slug",
          description: "Custom agent slug (from your Profile → Custom Agents list)",
          required: true,
        },
        {
          type: 3,
          name: "prompt",
          description: "What you want the agent to do",
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: "stop",
      description: "Cancel all active Jarvis jobs and pause workflows",
    },
    {
      type: 1,
      name: "help",
      description: "Show all available Jarvis slash commands",
    },
  ],
};

// ── /project command ─────────────────────────────────────────────────────────

const PROJECT_COMMAND = {
  name: "project",
  description: "Manage Jarvis autonomous build projects",
  options: [
    {
      type: 1, // SUB_COMMAND
      name: "new",
      description: "Start a new autonomous project",
      options: [
        {
          type: 3, name: "title", description: "Project title", required: true,
        },
        {
          type: 3, name: "goal", description: "What does done look like?", required: true,
        },
        {
          type: 5, name: "auto", description: "Run autonomously without approval between sessions?", required: false,
        },
      ],
    },
    {
      type: 1, // SUB_COMMAND
      name: "list",
      description: "List your active projects",
    },
    {
      type: 1,
      name: "status",
      description: "Get status of a specific project",
      options: [{ type: 3, name: "id", description: "Project ID", required: true }],
    },
    {
      type: 1,
      name: "pause",
      description: "Pause a project",
      options: [{ type: 3, name: "id", description: "Project ID", required: true }],
    },
    {
      type: 1,
      name: "resume",
      description: "Resume a paused project",
      options: [{ type: 3, name: "id", description: "Project ID", required: true }],
    },
    {
      type: 1,
      name: "answer",
      description: "Answer a pending question from a project",
      options: [
        { type: 3, name: "id", description: "Project ID", required: true },
        { type: 3, name: "answer", description: "Your answer", required: true },
      ],
    },
    {
      type: 1,
      name: "auto",
      description: "Enable or disable autonomous mode for a project",
      options: [
        { type: 3, name: "id", description: "Project ID", required: true },
        {
          type: 3,
          name: "mode",
          description: "on or off",
          required: true,
          choices: [
            { name: "on", value: "on" },
            { name: "off", value: "off" },
          ],
        },
      ],
    },
  ],
};

// ── /voice command ───────────────────────────────────────────────────────────

const VOICE_COMMAND = {
  name: "voice",
  description: "Control Jarvis in voice channels",
  options: [
    {
      type: 1, // SUB_COMMAND
      name: "join",
      description: "Jarvis joins the voice channel you're currently in",
    },
    {
      type: 1,
      name: "leave",
      description: "Jarvis leaves the voice channel",
    },
    {
      type: 1,
      name: "status",
      description: "Show whether Jarvis is in a voice session in this server",
    },
  ],
};

// ── Top-level task commands ──────────────────────────────────────────────────
// These are registered as top-level Discord slash commands (not subcommands of /jarvis)
// so they appear as /research, /plan, /write, /brief, /help in the autocomplete menu.
// They bypass the coach loop and queue directly to the appropriate sub-agent.

const TASK_COMMANDS = SLASH_COMMANDS.map((cmd) => {
  const def: Record<string, unknown> = {
    name: cmd.name,
    description: cmd.description,
  };
  if (cmd.argName) {
    def.options = [
      {
        type: 3, // STRING
        name: cmd.argName,
        description: cmd.argDescription || cmd.argName,
        required: cmd.argRequired ?? false,
      },
    ];
  }
  return def;
});

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
 * Register slash commands with the Discord API.
 *
 * When DISCORD_DEV_GUILD_ID is set the commands are registered to that guild
 * only — Discord propagates guild commands instantly, which is ideal for
 * development iteration.
 *
 * When DISCORD_DEV_GUILD_ID is absent the commands are registered globally
 * (production path). Global commands can take up to 1 hour to propagate.
 *
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

  const devGuildId = process.env.DISCORD_DEV_GUILD_ID?.trim() || "";

  const isGuildMode = devGuildId.length > 0;
  const scope = isGuildMode ? `guild ${devGuildId} (dev mode — instant update)` : "global (production — up to 1 hour to propagate)";
  const url = isGuildMode
    ? `${DISCORD_API}/applications/${appId}/guilds/${devGuildId}/commands`
    : `${DISCORD_API}/applications/${appId}/commands`;

  console.log(`[SlashCommands] Registering commands — scope: ${scope}`);

  try {
    // Fetch existing commands for the chosen scope
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

    // Check if the /jarvis definition and all task commands are present and unchanged.
    // We compare name, description, and serialized options for each task command.
    //
    // Stale-command detection: any existing command that is not in the "known namespace"
    // (system commands + current task commands) is unexpected and triggers a re-registration
    // so it gets removed. This catches removed task commands without relying on a count heuristic.
    // If a new system-level command is registered outside this router, add its name to
    // SYSTEM_COMMAND_NAMES below so it is not mistaken for a stale task command.
    const currentTaskNames = new Set(TASK_COMMANDS.map((tc) => tc.name as string));
    const SYSTEM_COMMAND_NAMES = new Set(["jarvis", "agents", "agent", "ask", "voice"]);
    const knownCommandNamespace = new Set([...SYSTEM_COMMAND_NAMES, ...currentTaskNames]);
    const existingByName = new Map(existing.map((ec) => [ec.name, ec]));
    const hasUnknownOrStaleCommand = existing.some((ec) => !knownCommandNamespace.has(ec.name));
    const allTaskCommandsUnchanged = !hasUnknownOrStaleCommand && TASK_COMMANDS.every((tc) => {
      const found = existingByName.get(tc.name as string);
      if (!found) return false;
      const wantedDesc = (tc.description as string) ?? "";
      const wantedOpts = JSON.stringify((tc.options as unknown[]) ?? []);
      return found.description === wantedDesc && JSON.stringify(found.options ?? []) === wantedOpts;
    });

    if (existingJarvis) {
      const existingOptions = JSON.stringify(existingJarvis.options ?? []);
      const wantedOptions = JSON.stringify(JARVIS_COMMAND.options);
      const existingDesc = existingJarvis.description ?? "";
      if (
        existingDesc === JARVIS_COMMAND.description &&
        existingOptions === wantedOptions &&
        allTaskCommandsUnchanged
      ) {
        console.log(`[SlashCommands] all commands unchanged — skipping registration update (${scope})`);
        return;
      }
    }

    // Build the merged command list: only include commands that are explicitly managed
    // by this router. Unknown or stale commands (outside the known namespace) are
    // intentionally omitted from the PUT payload so Discord removes them automatically.
    // Filter out both "agent" (old) and "agents" (new) so we cleanly replace either.
    const { AGENT_COMMAND, ASK_COMMAND } = await import("./agentCommands");
    const mergedCommands = [JARVIS_COMMAND, AGENT_COMMAND, ASK_COMMAND, PROJECT_COMMAND, VOICE_COMMAND, ...TASK_COMMANDS];

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
    const registeredTaskNames = TASK_COMMANDS.map((tc) => `/${tc.name as string}`);
    const action = existingJarvis ? "updated" : "registered";
    console.log(
      `[SlashCommands] /jarvis command ${action} (id=${jarvisEntry?.id}), total commands in scope: ${registered.length} — ${scope}`,
    );
    console.log(
      `[SlashCommands] task commands registered: ${registeredTaskNames.join(", ")} (${scope})`,
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
      originChannelId: interaction.channel_id as string | undefined,
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

async function handleStop(
  appId: string,
  interaction: any,
  userId: string,
): Promise<void> {
  try {
    const { jobsCancelled, jobsCancelling, workflowsPaused } = await cancelAllForUser(userId);
    const total = jobsCancelled + jobsCancelling;
    let summary: string;
    if (total === 0 && workflowsPaused === 0) {
      summary = "✅ Nothing was running — Jarvis was already idle.";
    } else {
      const parts: string[] = [];
      if (jobsCancelled > 0)
        parts.push(`${jobsCancelled} queued job${jobsCancelled === 1 ? "" : "s"} cancelled`);
      if (jobsCancelling > 0)
        parts.push(`${jobsCancelling} running job${jobsCancelling === 1 ? "" : "s"} signalled to stop`);
      if (workflowsPaused > 0)
        parts.push(`${workflowsPaused} workflow${workflowsPaused === 1 ? "" : "s"} paused`);
      summary = `🛑 Stopped: ${parts.join(", ")}.`;
    }
    await editInteractionReply(appId, interaction.token, summary, EPHEMERAL);
  } catch (err) {
    console.error("[SlashCommands] stop handler error:", err);
    await editInteractionReply(
      appId,
      interaction.token,
      "Sorry, I couldn't cancel all jobs right now — please try again.",
      EPHEMERAL,
    );
  }
}

async function handleAudit(
  appId: string,
  interaction: any,
  userId: string,
): Promise<void> {
  const opts: any[] = interaction.data?.options?.[0]?.options ?? [];
  const count = Math.min(Math.max(Number(opts.find((o: any) => o.name === "count")?.value ?? 5), 1), 10);

  try {
    const { isIntegrationOwner } = await import("../integrationOwner");
    if (!(await isIntegrationOwner(userId))) {
      await editInteractionReply(
        appId,
        interaction.token,
        "⛔ Self-repair audit is only visible to the Jarvis owner.",
        EPHEMERAL,
      );
      return;
    }
    const { readAuditEntries, countAuditEntries } = await import("../agent/selfHealAudit");
    const [entries, total] = await Promise.all([readAuditEntries(count), countAuditEntries()]);

    if (entries.length === 0) {
      await editInteractionReply(
        appId,
        interaction.token,
        "🔧 No self-repairs recorded yet. Jarvis will log changes here whenever it autonomously fixes code.",
        EPHEMERAL,
      );
      return;
    }

    const lines: string[] = [`**Self-Repair History** (${entries.length} of ${total} shown)`, ""];
    for (const entry of entries) {
      const ts = new Date(entry.timestamp).toLocaleString();
      const changes = entry.changesSummary ? ` · ${entry.changesSummary}` : "";
      const v = (entry.verified ?? "pending").toLowerCase();
      const verifyIcon = v.startsWith("passed") ? "✅" : v.startsWith("failed") || v.startsWith("error") ? "❌" : "⏳";
      const verifyLabel = v.startsWith("passed") ? "passed" : v.startsWith("failed") || v.startsWith("error") ? "failed" : "pending";
      lines.push(`🔧 **${entry.file}** ${verifyIcon} ${verifyLabel}`);
      lines.push(`  _${entry.reason}_`);
      lines.push(`  \`${ts}${changes}\``);
      lines.push("");
    }

    await editInteractionReply(appId, interaction.token, lines.join("\n").slice(0, 2000), EPHEMERAL);
  } catch (err) {
    console.error("[SlashCommands] audit handler error:", err);
    await editInteractionReply(
      appId,
      interaction.token,
      "Sorry, I couldn't fetch the audit log right now.",
      EPHEMERAL,
    );
  }
}

async function handleResetBudget(
  appId: string,
  interaction: any,
  userId: string,
): Promise<void> {
  try {
    const { isIntegrationOwner } = await import("../integrationOwner");
    if (!(await isIntegrationOwner(userId))) {
      await editInteractionReply(
        appId,
        interaction.token,
        "⛔ This command is only available to the Jarvis owner.",
        EPHEMERAL,
      );
      return;
    }
    const { resetCircuitBreaker, writeBudgetSummary } = await import("../agent/safeWritePolicy");
    await resetCircuitBreaker();
    const summary = await writeBudgetSummary();
    await editInteractionReply(
      appId,
      interaction.token,
      `✅ Write counter reset. Current status: ${summary}`,
      EPHEMERAL,
    );
  } catch (err) {
    console.error("[SlashCommands] reset_budget handler error:", err);
    await editInteractionReply(
      appId,
      interaction.token,
      "Sorry, I couldn't reset the write counter right now.",
      EPHEMERAL,
    );
  }
}

async function handleAssignAgent(
  appId: string,
  interaction: any,
  userId: string,
): Promise<void> {
  const { updateChannelAgentType, agentTypeLabel, ASSIGNABLE_AGENT_TYPES } = await import("./manager");
  const opts: any[] = interaction.data?.options?.[0]?.options ?? [];
  const requestedType: string = opts.find((o: any) => o.name === "type")?.value ?? "";
  const channelId: string = interaction.channel_id ?? "";

  if (!channelId) {
    await editInteractionReply(appId, interaction.token, "❌ Could not determine the channel ID.", EPHEMERAL);
    return;
  }

  if (!requestedType) {
    await editInteractionReply(appId, interaction.token, "❌ Please specify an agent type.", EPHEMERAL);
    return;
  }

  if (requestedType === "general") {
    await updateChannelAgentType(userId, channelId, null);
    await editInteractionReply(
      appId,
      interaction.token,
      "✅ Channel agent assignment cleared — this channel now routes to the **General Coach** (default).",
      EPHEMERAL,
    );
    return;
  }

  if ((ASSIGNABLE_AGENT_TYPES as readonly string[]).includes(requestedType)) {
    await updateChannelAgentType(userId, channelId, requestedType);
    const label = agentTypeLabel(requestedType);
    await editInteractionReply(
      appId,
      interaction.token,
      `✅ This channel is now assigned to the **${label}** agent.\n` +
      `Every message here will be routed directly to that specialist.\n` +
      `Use \`/jarvis assign_agent general\` to restore default coach routing.`,
      EPHEMERAL,
    );
    return;
  }

  const valid = [...ASSIGNABLE_AGENT_TYPES, "general"].join(", ");
  await editInteractionReply(
    appId,
    interaction.token,
    `❌ Unknown agent type: \`${requestedType}\`\nValid options: \`${valid}\``,
    EPHEMERAL,
  );
}

async function handleAgentStatus(
  appId: string,
  interaction: any,
  userId: string,
): Promise<void> {
  const { getChannelAgentAssignment, agentTypeLabel, ASSIGNABLE_AGENT_TYPES } = await import("./manager");
  const channelId: string = interaction.channel_id ?? "";

  if (!channelId) {
    await editInteractionReply(appId, interaction.token, "❌ Could not determine the channel ID.", EPHEMERAL);
    return;
  }

  const assigned = await getChannelAgentAssignment(userId, channelId);
  if (assigned && assigned !== "general") {
    await editInteractionReply(
      appId,
      interaction.token,
      `🤖 This channel is assigned to the **${agentTypeLabel(assigned)}** agent.\n` +
      `Every message is routed directly to that specialist.\n` +
      `Use \`/jarvis assign_agent general\` to restore default coach routing.`,
      EPHEMERAL,
    );
  } else {
    const types = (ASSIGNABLE_AGENT_TYPES as readonly string[]).join(", ");
    await editInteractionReply(
      appId,
      interaction.token,
      `🧠 This channel uses **default coach routing** (no specialist agent assigned).\n` +
      `Use \`/jarvis assign_agent <type>\` to assign one. Available types: ${types}`,
      EPHEMERAL,
    );
  }
}

async function handleCustomAgent(
  appId: string,
  interaction: any,
  userId: string,
): Promise<void> {
  const opts: any[] = interaction.data?.options?.[0]?.options ?? [];
  const slug = (opts.find((o: any) => o.name === "slug")?.value ?? "").trim();
  const prompt = (opts.find((o: any) => o.name === "prompt")?.value ?? "").trim();

  if (!slug || !prompt) {
    await editInteractionReply(appId, interaction.token, "❌ Please provide both a slug and a prompt.", EPHEMERAL);
    return;
  }

  try {
    const { db: _db } = await import("../db");
    const { customAgents: _customAgents } = await import("@shared/schema");
    const { eq: _eq, and: _and } = await import("drizzle-orm");

    const [agent] = await _db
      .select()
      .from(_customAgents)
      .where(_and(_eq(_customAgents.userId, userId), _eq(_customAgents.slug, slug)))
      .limit(1);

    if (!agent) {
      // Try by name as fallback
      const allAgents = await _db
        .select()
        .from(_customAgents)
        .where(_eq(_customAgents.userId, userId));
      const byName = allAgents.find((a) => a.name.toLowerCase() === slug.toLowerCase());
      if (byName) {
        const { submitAgentJob } = await import("../agent/jobClient");
        const { id: jobId } = await submitAgentJob({
          userId,
          agentType: "custom_agent",
          title: `${byName.name}: ${prompt.slice(0, 80)}`,
          prompt,
          input: {
            customAgentId: byName.id,
            customAgentSlug: byName.slug,
            customAgentName: byName.name,
            originChannel: "Discord",
            originDiscordChannelId: interaction.channel_id ?? "",
          },
        });
        await editInteractionReply(
          appId, interaction.token,
          `🤖 Queued **${byName.name}** — I'll notify you here when it's done. (Job ID: \`${jobId.slice(0, 8)}\`)`,
          EPHEMERAL,
        );
        return;
      }

      const agentList = allAgents.map((a) => `• \`${a.slug}\` — ${a.name}`).join("\n");
      await editInteractionReply(
        appId, interaction.token,
        `❌ No custom agent found with slug \`${slug}\`.\n\nYour agents:\n${agentList || "_None yet — create one in Profile → Custom Agents_"}`,
        EPHEMERAL,
      );
      return;
    }

    const { submitAgentJob } = await import("../agent/jobClient");
    const { id: jobId } = await submitAgentJob({
      userId,
      agentType: "custom_agent",
      title: `${agent.name}: ${prompt.slice(0, 80)}`,
      prompt,
      input: {
        customAgentId: agent.id,
        customAgentSlug: agent.slug,
        customAgentName: agent.name,
        originChannel: "Discord",
        originDiscordChannelId: interaction.channel_id ?? "",
      },
    });

    await editInteractionReply(
      appId, interaction.token,
      `🤖 Queued **${agent.name}** (${agent.baseType}) — I'll notify you here when it's done.\nJob ID: \`${jobId.slice(0, 8)}\``,
      EPHEMERAL,
    );
  } catch (err) {
    console.error("[SlashCommands] custom agent error:", err);
    await editInteractionReply(appId, interaction.token, "❌ Failed to queue the custom agent job.", EPHEMERAL);
  }
}

async function handleProjectCommand(appId: string, interaction: any, userId: string): Promise<void> {
  const subcommand: string = interaction.data?.options?.[0]?.name ?? "";
  const opts: Record<string, unknown>[] = interaction.data?.options?.[0]?.options ?? [];
  const getOpt = (name: string): string => String(opts.find((o) => o.name === name)?.value ?? "");

  const {
    startProject,
    pauseProject,
    resumeProject,
    answerProjectQuestion,
    getProjectStatus,
    getUserProjects,
    setAutonomousMode,
  } = await import("../agent/projectRunner");

  // Resolve a project by id-prefix OR title substring (case-insensitive), scoped to userId.
  // Parity with Telegram handler's lookup semantics.
  const resolveProject = async (query: string) => {
    if (!query) return null;
    const all = await getUserProjects(userId);
    const lower = query.toLowerCase();
    const match = all.find(
      (p) =>
        p.id.startsWith(query) ||
        (p.title ?? "").toLowerCase().includes(lower),
    );
    return match ?? null;
  };

  try {
    if (subcommand === "new") {
      const title = getOpt("title");
      const goal = getOpt("goal");
      const autoMode = opts.find((o) => o.name === "auto")?.value === true;
      if (!title || !goal) {
        await editInteractionReply(appId, interaction.token, "❌ `title` and `goal` are required.", EPHEMERAL);
        return;
      }
      const projectId = await startProject(userId, title, "", goal, "discord");
      if (autoMode) await setAutonomousMode(projectId, true);
      await editInteractionReply(
        appId, interaction.token,
        `📋 **Project created!**\nTitle: ${title}\nID: \`${projectId.slice(0, 8)}...\`\n\nI'm planning the steps now and will notify you here when ready.${autoMode ? "\n⚡ Autonomous mode enabled." : ""}`,
        EPHEMERAL,
      );
    } else if (subcommand === "list") {
      const projects = await getUserProjects(userId);
      if (!projects.length) {
        await editInteractionReply(appId, interaction.token, "You have no projects yet. Use `/project new` to create one.", EPHEMERAL);
        return;
      }
      const lines = projects.slice(0, 10).map((p) => {
        const emoji = p.status === "complete" ? "✅" : p.status === "building" ? "🔨" : p.status === "paused" ? "⏸️" : p.status === "waiting_for_input" ? "❓" : "📋";
        return `${emoji} **${p.title ?? "Untitled"}** — \`${p.id.slice(0, 8)}\` (${p.status})`;
      });
      await editInteractionReply(appId, interaction.token, `**Your Projects:**\n\n${lines.join("\n")}`, EPHEMERAL);
    } else if (subcommand === "status") {
      const query = getOpt("id");
      const project = await resolveProject(query);
      if (!project) {
        await editInteractionReply(appId, interaction.token, "❌ Project not found. Use `/project list` to see your projects.", EPHEMERAL);
        return;
      }
      const status = await getProjectStatus(project.id);
      if (!status) {
        await editInteractionReply(appId, interaction.token, "❌ Project not found.", EPHEMERAL);
        return;
      }
      const { completedCount, totalCount, nextStep } = status;
      const msg = [
        `📋 **${project.title}** (${project.status})`,
        totalCount > 0 ? `Progress: ${completedCount}/${totalCount} steps` : "",
        nextStep ? `Next: ${nextStep.label}` : "",
        project.questionPending ? `❓ Waiting for your answer: ${project.questionPending}` : "",
      ].filter(Boolean).join("\n");
      await editInteractionReply(appId, interaction.token, msg, EPHEMERAL);
    } else if (subcommand === "pause") {
      const project = await resolveProject(getOpt("id"));
      if (!project) {
        await editInteractionReply(appId, interaction.token, "❌ Project not found. Use `/project list` to see your projects.", EPHEMERAL);
        return;
      }
      await pauseProject(project.id);
      await editInteractionReply(appId, interaction.token, `⏸️ Project **${project.title ?? project.id.slice(0, 8)}** paused.`, EPHEMERAL);
    } else if (subcommand === "resume") {
      const project = await resolveProject(getOpt("id"));
      if (!project) {
        await editInteractionReply(appId, interaction.token, "❌ Project not found. Use `/project list` to see your projects.", EPHEMERAL);
        return;
      }
      await resumeProject(project.id);
      await editInteractionReply(appId, interaction.token, `▶️ Project **${project.title ?? project.id.slice(0, 8)}** resumed — next session queued.`, EPHEMERAL);
    } else if (subcommand === "answer") {
      const answer = getOpt("answer");
      const project = await resolveProject(getOpt("id"));
      if (!project) {
        await editInteractionReply(appId, interaction.token, "❌ Project not found. Use `/project list` to see your projects.", EPHEMERAL);
        return;
      }
      await answerProjectQuestion(project.id, answer);
      await editInteractionReply(appId, interaction.token, `✅ Answer received — resuming project **${project.title ?? project.id.slice(0, 8)}**.`, EPHEMERAL);
    } else if (subcommand === "auto") {
      const mode = getOpt("mode");
      const project = await resolveProject(getOpt("id"));
      if (!project) {
        await editInteractionReply(appId, interaction.token, "❌ Project not found. Use `/project list` to see your projects.", EPHEMERAL);
        return;
      }
      const enabled = mode === "on";
      await setAutonomousMode(project.id, enabled);
      await editInteractionReply(
        appId,
        interaction.token,
        enabled
          ? `⚡ Autonomous mode **enabled** for **${project.title ?? project.id.slice(0, 8)}**. Jarvis will resume automatically every 30 min.`
          : `⏸️ Autonomous mode **disabled** for **${project.title ?? project.id.slice(0, 8)}**. Use \`/project resume\` to run the next session manually.`,
        EPHEMERAL,
      );
    } else {
      await editInteractionReply(appId, interaction.token, "Unknown /project subcommand. Try `/project new`, `/project list`, `/project status`, `/project pause`, `/project resume`, `/project answer`, or `/project auto`.", EPHEMERAL);
    }
  } catch (err) {
    console.error("[SlashCommands] /project error:", err);
    await editInteractionReply(appId, interaction.token, `❌ Error: ${err instanceof Error ? err.message : "Unknown error"}`, EPHEMERAL);
  }
}

async function handleVoiceCommand(
  appId: string,
  interaction: any,
  userId: string,
  guildId: string,
  discordUserId: string,
): Promise<void> {
  const { isIntegrationOwner } = await import("../integrationOwner");
  if (!(await isIntegrationOwner(userId))) {
    await editInteractionReply(
      appId, interaction.token,
      "⛔ Voice commands are only available to the Jarvis integration owner.",
      EPHEMERAL,
    );
    return;
  }

  const subcommand: string = interaction.data?.options?.[0]?.name ?? "";
  const textChannelId: string = interaction.channel_id ?? "";

  const { joinVoiceSession, leaveVoiceSession, getVoiceSessionStatus } = await import("./voiceBridge");
  const { getDiscordClientForUser } = await import("./manager");

  if (subcommand === "status") {
    const status = getVoiceSessionStatus(guildId);
    if (status.active) {
      await editInteractionReply(
        appId, interaction.token,
        `🎙️ Jarvis is active in <#${status.voiceChannelId}>. Use \`/voice leave\` to disconnect.`,
        EPHEMERAL,
      );
    } else {
      await editInteractionReply(
        appId, interaction.token,
        "Jarvis is not in a voice session in this server. Join a voice channel and use `/voice join` to start.",
        EPHEMERAL,
      );
    }
    return;
  }

  if (subcommand === "leave") {
    const left = leaveVoiceSession(guildId);
    if (left) {
      await editInteractionReply(appId, interaction.token, "👋 Jarvis has left the voice channel.", EPHEMERAL);
    } else {
      await editInteractionReply(appId, interaction.token, "Jarvis isn't in a voice session in this server.", EPHEMERAL);
    }
    return;
  }

  if (subcommand === "join") {
    const client = getDiscordClientForUser(userId);
    if (!client || !client.isReady()) {
      await editInteractionReply(appId, interaction.token, "❌ Discord bot is not running for your account.", EPHEMERAL);
      return;
    }

    let voiceChannelId: string | null = null;
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(discordUserId);
      voiceChannelId = member.voice.channelId ?? null;
    } catch (err) {
      console.error("[SlashCommands] /voice join — member voice state lookup failed:", err);
    }

    if (!voiceChannelId) {
      await editInteractionReply(
        appId, interaction.token,
        "You're not in a voice channel. Join one first, then run `/voice join`.",
        EPHEMERAL,
      );
      return;
    }

    const result = await joinVoiceSession(client, guildId, voiceChannelId, textChannelId, userId, discordUserId);
    if (result.ok) {
      await editInteractionReply(
        appId, interaction.token,
        `🎙️ Jarvis has joined <#${voiceChannelId}>!\n\nSpeak and I'll transcribe, respond in text here, and reply in voice. Use \`/voice leave\` to disconnect.`,
        EPHEMERAL,
      );
    } else {
      await editInteractionReply(appId, interaction.token, `❌ ${result.error}`, EPHEMERAL);
    }
    return;
  }

  await editInteractionReply(
    appId, interaction.token,
    "Unknown subcommand. Use `/voice join`, `/voice leave`, or `/voice status`.",
    EPHEMERAL,
  );
}

async function handleHelp(appId: string, interaction: any): Promise<void> {
  const help = [
    "**Jarvis Slash Commands**",
    "",
    "**Task commands** (queue a job — result appears in your inbox):",
    "`/research <topic>` — Research a topic and get a brief.",
    "`/plan [goal]` — Build a goal or project action plan.",
    "`/write <topic>` — Draft a document.",
    "`/brief` — Get your morning briefing on demand.",
    "`/help` — Show this message.",
    "",
    "**System commands** (`/jarvis` subcommands):",
    "`/jarvis chat <message>` — Chat with Jarvis from any channel. Add `public:True` to share the reply.",
    "`/jarvis plan` — Generate your personalized daily plan (inline).",
    "`/jarvis status` — Check the status of active background jobs.",
    "`/jarvis assign_agent <type>` — Assign a specialist agent to this channel.",
    "`/jarvis agent_status` — Show which agent is assigned to this channel.",
    "`/jarvis agent <slug> <prompt>` — Run one of your custom sub-agents.",
    "`/jarvis audit` — Show recent autonomous self-repairs Jarvis made.",
    "`/jarvis reset_budget` — Reset the autonomous write counter (owner only).",
    "",
    "💡 Replies are private by default (only you see them).",
    "Manage custom agents in the app under **Profile → Custom Agents**.",
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
    // ── /agents command (also handles legacy /agent name during guild transition) ─
    if (interaction.data?.name === "agents" || interaction.data?.name === "agent") {
      const memberUser = interaction.member?.user ?? interaction.user ?? {};
      const discordUserId: string = memberUser.id ?? "";
      const paired = await lookupUserByDiscordId(discordUserId);
      if (!paired) {
        const discordUsername: string = memberUser.username ?? memberUser.global_name ?? discordUserId;
        return immediateEphemeral(buildPairingPrompt(discordUserId, discordUsername));
      }
      // Defer while we process (agents can take a few seconds)
      setImmediate(async () => {
        try {
          const { handleAgentCommand } = await import("./agentCommands");
          const result = await handleAgentCommand(interaction, paired.userId);
          await editInteractionReply(appId, interaction.token, result.content, result.flags);
        } catch (err) {
          console.error("[SlashCommands] /agent error:", err);
          await editInteractionReply(appId, interaction.token, "❌ Agent command failed.", EPHEMERAL);
        }
      });
      return deferredEphemeral();
    }

    // ── /ask command ──────────────────────────────────────────────────────────
    if (interaction.data?.name === "ask") {
      const memberUser = interaction.member?.user ?? interaction.user ?? {};
      const discordUserId: string = memberUser.id ?? "";
      const paired = await lookupUserByDiscordId(discordUserId);
      if (!paired) {
        const discordUsername: string = memberUser.username ?? memberUser.global_name ?? discordUserId;
        return immediateEphemeral(buildPairingPrompt(discordUserId, discordUsername));
      }
      setImmediate(async () => {
        try {
          const { handleAskCommand } = await import("./agentCommands");
          const result = await handleAskCommand(interaction, paired.userId);
          await editInteractionReply(appId, interaction.token, result.content, result.flags);
        } catch (err) {
          console.error("[SlashCommands] /ask error:", err);
          await editInteractionReply(appId, interaction.token, "❌ Ask command failed.", EPHEMERAL);
        }
      });
      return deferredEphemeral();
    }

    // ── Top-level task commands: /research, /plan, /write, /brief, /help ────
    const TASK_COMMAND_NAMES = new Set(TASK_COMMANDS.map((c) => c.name as string));
    if (TASK_COMMAND_NAMES.has(interaction.data?.name)) {
      const cmdName = interaction.data.name as string;
      const memberUser2 = interaction.member?.user ?? interaction.user ?? {};
      const discordUserId2: string = memberUser2.id ?? "";
      const discordUsername2: string = memberUser2.username ?? memberUser2.global_name ?? discordUserId2;

      if (cmdName === "help") {
        return immediateEphemeral(getHelpText("discord"));
      }

      const paired2 = await lookupUserByDiscordId(discordUserId2);
      if (!paired2) {
        return immediateEphemeral(buildPairingPrompt(discordUserId2, discordUsername2));
      }

      const appId2 = process.env.DISCORD_APP_ID || process.env.DISCORD_CLIENT_ID || "";
      const userId2 = paired2.userId;
      const discordChannelId2: string | undefined =
        typeof interaction.channel_id === "string" ? interaction.channel_id : undefined;
      setImmediate(async () => {
        try {
          const opts2: any[] = interaction.data?.options ?? [];
          const args = String(opts2[0]?.value ?? "");
          const ack = await routeSlashCommand({
            command: cmdName,
            args,
            userId: userId2,
            channel: "discord",
            discordChannelId: discordChannelId2,
          });
          await editInteractionReply(appId2, interaction.token, ack, EPHEMERAL);
        } catch (err) {
          console.error(`[SlashCommands] /${cmdName} error:`, err);
          await editInteractionReply(
            appId2,
            interaction.token,
            "Sorry, something went wrong — please try again.",
            EPHEMERAL,
          );
        }
      });
      return deferredEphemeral();
    }

    // ── /project command ─────────────────────────────────────────────────────
    if (interaction.data?.name === "project") {
      const memberUser3 = interaction.member?.user ?? interaction.user ?? {};
      const discordUserId3: string = memberUser3.id ?? "";
      const discordUsername3: string = memberUser3.username ?? memberUser3.global_name ?? discordUserId3;
      const paired3 = await lookupUserByDiscordId(discordUserId3);
      if (!paired3) {
        return immediateEphemeral(buildPairingPrompt(discordUserId3, discordUsername3));
      }
      const appId3 = process.env.DISCORD_APP_ID || process.env.DISCORD_CLIENT_ID || "";
      setImmediate(() => {
        handleProjectCommand(appId3, interaction, paired3.userId).catch((err) =>
          console.error("[SlashCommands] handleProjectCommand background error:", err),
        );
      });
      return deferredEphemeral();
    }

    // ── /voice command ────────────────────────────────────────────────────────
    if (interaction.data?.name === "voice") {
      const voiceMemberUser = interaction.member?.user ?? interaction.user ?? {};
      const voiceDiscordUserId: string = voiceMemberUser.id ?? "";
      const voiceDiscordUsername: string = voiceMemberUser.username ?? voiceMemberUser.global_name ?? voiceDiscordUserId;
      const voiceGuildId: string = interaction.guild_id ?? "";

      if (!voiceGuildId) {
        return immediateEphemeral("Voice commands only work in a server, not in DMs.");
      }

      const voicePaired = await lookupUserByDiscordId(voiceDiscordUserId);
      if (!voicePaired) {
        return immediateEphemeral(buildPairingPrompt(voiceDiscordUserId, voiceDiscordUsername));
      }

      setImmediate(() => {
        handleVoiceCommand(appId, interaction, voicePaired.userId, voiceGuildId, voiceDiscordUserId).catch((err) =>
          console.error("[SlashCommands] handleVoiceCommand background error:", err),
        );
      });
      return deferredEphemeral();
    }

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

      if (subcommand === "audit") {
        setImmediate(() => {
          handleAudit(appId, interaction, userId).catch((err) =>
            console.error("[SlashCommands] handleAudit background error:", err),
          );
        });
        return deferredEphemeral();
      }

      if (subcommand === "reset_budget") {
        setImmediate(() => {
          handleResetBudget(appId, interaction, userId).catch((err) =>
            console.error("[SlashCommands] handleResetBudget background error:", err),
          );
        });
        return deferredEphemeral();
      }

      if (subcommand === "assign_agent") {
        setImmediate(() => {
          handleAssignAgent(appId, interaction, userId).catch((err) =>
            console.error("[SlashCommands] handleAssignAgent background error:", err),
          );
        });
        return deferredEphemeral();
      }

      if (subcommand === "agent_status") {
        setImmediate(() => {
          handleAgentStatus(appId, interaction, userId).catch((err) =>
            console.error("[SlashCommands] handleAgentStatus background error:", err),
          );
        });
        return deferredEphemeral();
      }

      if (subcommand === "stop") {
        setImmediate(() => {
          handleStop(appId, interaction, userId).catch((err) =>
            console.error("[SlashCommands] handleStop background error:", err),
          );
        });
        return deferredEphemeral();
      }

      if (subcommand === "agent") {
        setImmediate(() => {
          handleCustomAgent(appId, interaction, userId).catch((err) =>
            console.error("[SlashCommands] handleCustomAgent background error:", err),
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
