/**
 * Slash Command Router
 *
 * Central definition + dispatcher for the /research, /plan, /write, /brief, /help
 * slash commands. Works across Discord (top-level commands) and Telegram (command menu).
 *
 * Each command bypasses the coach loop entirely and dispatches directly to
 * the appropriate sub-agent via submitAgentJob so the user gets an immediate
 * acknowledgement instead of waiting for the LLM coach to interpret intent.
 */

import { submitAgentJob, cancelAllForUser, type AgentJobType } from "../agent/jobClient";
import { getCapabilityGapsTool } from "../agent/tools/getCapabilityGaps";

export interface SlashCommandDef {
  name: string;
  description: string;
  agentType: AgentJobType | null;
  argName?: string;
  argDescription?: string;
  argRequired?: boolean;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: "research",
    description: "Research a topic and get a brief delivered to your inbox",
    agentType: "research",
    argName: "topic",
    argDescription: "What to research",
    argRequired: true,
  },
  {
    name: "plan",
    description: "Build a goal or project action plan",
    agentType: "goal_decompose",
    argName: "goal",
    argDescription: "Goal or project to plan (e.g. 'my week', 'launch feature X')",
    argRequired: false,
  },
  {
    name: "write",
    description: "Draft a document and deliver it to your inbox",
    agentType: "writing",
    argName: "topic",
    argDescription: "Document type and topic (e.g. 'report Q1 results', 'blog post on AI trends')",
    argRequired: true,
  },
  {
    name: "brief",
    description: "Get your morning briefing on demand",
    // Note: uses "morning_brief" rather than "general" — "general" maps to the
    // diagnostic auto-debug path in the job queue, which is not appropriate here.
    // "morning_brief" is a dedicated agent type with calendar access and a
    // briefing-specific system prompt.
    agentType: "morning_brief",
    argRequired: false,
  },
  {
    name: "build",
    description: "Queue a build-feature job to implement something new",
    agentType: "build_feature",
    argName: "description",
    argDescription: "What to build (e.g. 'add a weather tool')",
    argRequired: true,
  },
  {
    name: "pr",
    description: "Check open GitHub pull requests and CI status",
    agentType: null,
  },
  {
    name: "help",
    description: "Show all available slash commands",
    agentType: null,
  },
  {
    name: "stop",
    description: "Stop all Jarvis activity",
    agentType: null,
  },
  {
    name: "gaps",
    description: "Show what Jarvis couldn't do this week",
    agentType: null,
  },
];

function ackText(agentType: AgentJobType, args: string): string {
  const snippet = args.trim().slice(0, 60);
  switch (agentType) {
    case "research":
      return `Got it — research queued${snippet ? ` for "${snippet}"` : ""}. I'll post the result here when done.`;
    case "goal_decompose":
      return `Got it — planning job queued${snippet ? ` for "${snippet}"` : ""}. I'll post the plan here when done.`;
    case "writing":
      return `Got it — writing job queued${snippet ? ` for "${snippet}"` : ""}. I'll post the draft here when done.`;
    case "morning_brief":
      return "Got it — generating your morning briefing. I'll post it here when done.";
    case "build_feature":
      return `Got it — build job queued${snippet ? ` for "${snippet}"` : ""}. I'll post the result here when done.`;
    default:
      return "Got it — job queued. I'll post the result here when done.";
  }
}

export function getHelpText(platform: "discord" | "telegram" | string = "generic"): string {
  const lines: string[] = ["**Jarvis Slash Commands**", ""];
  for (const cmd of SLASH_COMMANDS) {
    const argHint = cmd.argName ? ` [${cmd.argName}]` : "";
    lines.push(`\`/${cmd.name}${argHint}\` — ${cmd.description}`);
  }
  if (platform === "discord") {
    lines.push("");
    lines.push("_Use `/jarvis help` for system commands (status, audit, etc.)._");
  }
  lines.push("");
  lines.push("Jobs queue instantly — you'll get a notification when the result is ready.");
  return lines.join("\n");
}

export interface RouteSlashCommandOpts {
  /** Command name without the leading slash (e.g. "research") */
  command: string;
  /** Everything typed after the command name */
  args: string;
  /** Jarvis user ID to attribute the job to */
  userId: string;
  /** Source channel name for logging ("discord" | "telegram") */
  channel?: string;
  /**
   * Discord channel ID where the command was invoked.
   * When provided, the job completion notification will post back to
   * this channel rather than only landing in the in-app inbox.
   */
  discordChannelId?: string;
}

/**
 * Route a parsed slash command to the correct sub-agent job.
 * Returns the immediate acknowledgement text to send back to the user.
 */
export async function routeSlashCommand(opts: RouteSlashCommandOpts): Promise<string>;
/** Legacy overload — positional signature kept for Telegram caller. */
export async function routeSlashCommand(
  command: string,
  args: string,
  userId: string,
  channel?: string,
): Promise<string>;
export async function routeSlashCommand(
  commandOrOpts: string | RouteSlashCommandOpts,
  argsArg?: string,
  userIdArg?: string,
  channelArg?: string,
): Promise<string> {
  let command: string;
  let args: string;
  let userId: string;
  let channel: string;
  let discordChannelId: string | undefined;

  if (typeof commandOrOpts === "string") {
    command = commandOrOpts;
    args = argsArg ?? "";
    userId = userIdArg ?? "";
    channel = channelArg ?? "unknown";
  } else {
    command = commandOrOpts.command;
    args = commandOrOpts.args;
    userId = commandOrOpts.userId;
    channel = commandOrOpts.channel ?? "unknown";
    discordChannelId = commandOrOpts.discordChannelId;
  }

  const def = SLASH_COMMANDS.find((c) => c.name === command.toLowerCase());

  if (!def) {
    return `Unknown command /${command}. Send \`/help\` to see available commands.`;
  }

  if (def.agentType === null) {
    if (command === "stop") {
      try {
        const { jobsCancelled, jobsCancelling, workflowsPaused } = await cancelAllForUser(userId);
        const total = jobsCancelled + jobsCancelling;
        if (total === 0 && workflowsPaused === 0) {
          return "✅ Nothing was running — Jarvis was already idle.";
        }
        const parts: string[] = [];
        if (jobsCancelled > 0)
          parts.push(`${jobsCancelled} queued job${jobsCancelled === 1 ? "" : "s"} cancelled`);
        if (jobsCancelling > 0)
          parts.push(`${jobsCancelling} running job${jobsCancelling === 1 ? "" : "s"} signalled to stop`);
        if (workflowsPaused > 0)
          parts.push(`${workflowsPaused} workflow${workflowsPaused === 1 ? "" : "s"} paused`);
        return `🛑 Stopped: ${parts.join(", ")}.`;
      } catch (err) {
        console.error("[SlashCommandRouter] /stop error:", err);
        return "Sorry, I couldn't cancel all jobs right now — please try again.";
      }
    }
    if (command === "gaps") {
      try {
        const result = await getCapabilityGapsTool.execute({}, { userId, channel, state: {} });
        return result.content;
      } catch (err) {
        console.error("[SlashCommandRouter] /gaps error:", err);
        return "Sorry, I couldn't fetch capability gaps right now — please try again.";
      }
    }
    return getHelpText(channel);
  }

  const trimmedArgs = args.trim();

  if (def.argRequired && !trimmedArgs) {
    const hint = def.argName ? ` — usage: \`/${def.name} [${def.argName}]\`` : "";
    return `Please include a ${def.argName || "topic"}${hint}.`;
  }

  let prompt: string;
  let title: string;

  switch (def.agentType) {
    case "research":
      prompt = `Research the following topic and produce a concise brief:\n\n${trimmedArgs}`;
      title = `Research: ${trimmedArgs.slice(0, 60)}${trimmedArgs.length > 60 ? "…" : ""}`;
      break;
    case "goal_decompose":
      prompt = trimmedArgs
        ? `Decompose the following goal or project into a concrete, sequenced action plan:\n\n${trimmedArgs}`
        : "Decompose the user's current goals into a concrete, sequenced action plan for the week ahead. Review their goals and produce a prioritized, phased plan.";
      title = trimmedArgs
        ? `Plan: ${trimmedArgs.slice(0, 60)}${trimmedArgs.length > 60 ? "…" : ""}`
        : "Weekly Goal Plan";
      break;
    case "writing":
      prompt = `Draft the following document:\n\n${trimmedArgs}`;
      title = `Draft: ${trimmedArgs.slice(0, 60)}${trimmedArgs.length > 60 ? "…" : ""}`;
      break;
    case "morning_brief":
      prompt =
        "Generate the user's morning briefing: summarize today's goals, any upcoming calendar events, and recent inbox items. Keep it concise and actionable.";
      title = "Morning Briefing";
      break;
    case "build_feature":
      prompt = `Build the following feature or improvement:\n\n${trimmedArgs}`;
      title = `Build: ${trimmedArgs.slice(0, 60)}${trimmedArgs.length > 60 ? "…" : ""}`;
      break;
    default:
      prompt = trimmedArgs || `Run the ${def.name} command.`;
      title = `${def.name}: ${trimmedArgs.slice(0, 60)}`;
  }

  // Build the job input. Include discordChannelId when present so job completion
  // notifications can route the result back to the invoking channel.
  const jobInput: Record<string, unknown> = { originChannel: channel };
  if (discordChannelId) jobInput.originDiscordChannelId = discordChannelId;

  try {
    const { id: jobId } = await submitAgentJob({
      userId,
      agentType: def.agentType,
      title,
      prompt,
      input: jobInput,
    });
    console.log(
      `[SlashCommandRouter] /${command} queued agentType=${def.agentType} job=${jobId} user=${userId} channel=${channel}${discordChannelId ? ` discordChannelId=${discordChannelId}` : ""}`,
    );
    return ackText(def.agentType, trimmedArgs);
  } catch (err) {
    console.error(`[SlashCommandRouter] /${command} queue failed:`, err);
    return "Sorry, I couldn't queue that job right now — please try again.";
  }
}

/**
 * Register Telegram bot commands so they appear in the autocomplete tray.
 * Reads the token directly so it uses the correct dev/prod token logic.
 * Safe to call multiple times — idempotent on Telegram's side.
 */
export async function registerTelegramBotCommands(): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const token =
    !isProduction && process.env.TELEGRAM_BOT_TOKEN_DEV
      ? process.env.TELEGRAM_BOT_TOKEN_DEV
      : process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log("[SlashCommandRouter] No Telegram bot token — skipping setMyCommands");
    return;
  }

  // Include all shared commands plus the Telegram-only /call command.
  const commands = [
    ...SLASH_COMMANDS.map((c) => ({ command: c.name, description: c.description })),
    { command: "call", description: "Start a voice call with Jarvis" },
  ];

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (json.ok) {
      console.log(
        `[SlashCommandRouter] Telegram setMyCommands OK — registered ${commands.length} commands: ${commands.map((c) => `/${c.command}`).join(", ")}`,
      );
    } else {
      console.warn(`[SlashCommandRouter] Telegram setMyCommands failed: ${json.description}`);
    }
  } catch (err) {
    console.error("[SlashCommandRouter] registerTelegramBotCommands error:", err);
  }
}
