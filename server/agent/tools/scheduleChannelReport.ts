/**
 * Discord OS Phase 1 — Agent tools for scheduled channel reports
 *
 * Tools:
 *   schedule_channel_report  — create a recurring automated report
 *   list_channel_schedules   — list all active schedules
 *   delete_channel_schedule  — cancel a schedule by label or id
 */

import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import {
  createSchedule,
  listSchedules,
  deleteSchedule,
  SCHEDULE_TEMPLATES,
  detectTemplate,
} from "../../discord/schedules";
import { getGuildsForUser, getChannelsForGuild, createDiscordChannel } from "../../discord/manager";

// ── Time parser ───────────────────────────────────────────────────────────────

/**
 * Parse a natural language time string into { hour, minute }.
 * Handles: "7am", "7:30am", "8pm", "noon", "every morning at 9", "daily at 8:00".
 */
function parseScheduleTime(raw: string): { hour: number; minute: number } | null {
  const s = raw.toLowerCase().trim();

  if (s.includes("noon")) return { hour: 12, minute: 0 };
  if (s.includes("midnight")) return { hour: 0, minute: 0 };

  const match = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3];

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function formatTime(hour: number, minute: number): string {
  const m = minute.toString().padStart(2, "0");
  const suffix = hour >= 12 ? "pm" : "am";
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h}:${m}${suffix}`;
}

// ── schedule_channel_report ───────────────────────────────────────────────────

export const scheduleChannelReportTool: AgentTool = {
  name: "schedule_channel_report",
  description:
    "Create a recurring automated research report that Jarvis runs at a scheduled time and posts to a specific Discord channel. " +
    "Use this when the user asks to set up a daily/recurring automated report in Discord — for example " +
    "'set up a daily stock research report at 7am' or 'every morning at 8am, post YouTube competitor research to #competitor-research'. " +
    "Jarvis will create the channel if it doesn't exist, then schedule the recurring report. " +
    "Built-in templates are available: say 'stock research' to use the AI stock template, or 'competitor YouTube' to use the YouTube research template. " +
    "IMPORTANT: Only use this for creating scheduled DISCORD channel reports. For general reminders, use schedule_jarvis_task instead.",
  parameters: {
    type: "object",
    properties: {
      channelName: {
        type: "string",
        description:
          "The Discord channel name to post to (e.g. 'stock-research', 'competitor-research'). " +
          "Use lowercase with hyphens. The channel will be created if it doesn't exist. " +
          "If omitted and a template is matched, the template's default channel name will be used.",
      },
      label: {
        type: "string",
        description:
          "A short human-readable label for this schedule (e.g. 'AI Stock Research', 'Competitor YouTube Report'). " +
          "If omitted and a template is matched, the template's default label will be used.",
      },
      scheduleTime: {
        type: "string",
        description:
          "When to run the report, in natural language (e.g. '7am', '8:30am', 'every morning at 9'). " +
          "If omitted and a template is matched, the template's default time will be used.",
      },
      prompt: {
        type: "string",
        description:
          "The research instructions Jarvis will execute when the schedule fires. Be specific. " +
          "If omitted, Jarvis will try to detect a built-in template from the label or channel name. " +
          "Example: 'Research the top 8 AI infrastructure stocks. For each: ticker, thesis, latest news.'",
      },
      daysOfWeek: {
        type: "string",
        description:
          "Optional. Comma-separated day numbers (0=Sunday … 6=Saturday) for days to run. " +
          "Default is '0,1,2,3,4,5,6' (every day). Use '1,2,3,4,5' for weekdays only.",
      },
      categoryName: {
        type: "string",
        description:
          "Optional. Name of an existing Discord category to create the channel inside. " +
          "If omitted, the channel is created at the top level.",
      },
      guildId: {
        type: "string",
        description:
          "Optional. The Discord server (guild) ID to post to. " +
          "If omitted, defaults to the first (or only) Discord server the bot is in.",
      },
      topic: {
        type: "string",
        description:
          "Optional. For competitor/niche YouTube research, the topic keywords to search for " +
          "(e.g. 'ADHD productivity', 'AI tools for developers'). " +
          "Replaces the [TOPIC] placeholder in the YouTube research template prompt.",
      },
    },
    required: [],
  },

  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const { userId } = ctx;

    // Try template auto-detection from label or channelName
    const rawLabel = args.label ? String(args.label).trim() : "";
    const rawChannel = args.channelName ? String(args.channelName).trim() : "";
    const rawPrompt = args.prompt ? String(args.prompt).trim() : "";
    const templateLookup = rawLabel || rawPrompt || rawChannel;
    const matchedTemplate = templateLookup ? detectTemplate(templateLookup) : null;

    // Handle [TOPIC] substitution for YouTube research template
    const rawTopic = args.topic ? String(args.topic).trim() : "";

    // Merge template defaults with explicit args
    const channelName = (rawChannel || matchedTemplate?.channelName || "")
      .toLowerCase()
      .replace(/\s+/g, "-");
    const label = rawLabel || matchedTemplate?.label || "";
    let prompt = rawPrompt || matchedTemplate?.prompt || "";

    // Substitute [TOPIC] placeholder if a topic was provided
    if (rawTopic && prompt.includes("[TOPIC]")) {
      prompt = prompt.replace(/\[TOPIC\]/g, rawTopic);
    } else if (prompt.includes("[TOPIC]") && !rawTopic) {
      // Prompt user to provide the topic
      return {
        ok: false,
        content:
          "The YouTube competitor research template needs a topic to search for. " +
          "For example: 'Set up competitor YouTube research for ADHD productivity'. " +
          "What topic or niche should I search YouTube for?",
        label: "Missing topic for YouTube template",
      };
    }

    const daysOfWeek =
      args.daysOfWeek
        ? String(args.daysOfWeek).trim()
        : matchedTemplate?.daysOfWeek ?? "0,1,2,3,4,5,6";
    const categoryName = args.categoryName ? String(args.categoryName).trim() : undefined;
    const requestedGuildId = args.guildId ? String(args.guildId).trim() : null;

    // Validate resolved fields
    if (!channelName) {
      return { ok: false, content: "Please provide a channelName for the report (e.g. 'stock-research').", label: "Missing channelName" };
    }
    if (!label) {
      return { ok: false, content: "Please provide a label for this schedule (e.g. 'AI Stock Research').", label: "Missing label" };
    }
    if (!prompt) {
      return {
        ok: false,
        content:
          "Please provide the research prompt for this schedule, or say something like 'stock research' or 'competitor YouTube' to use a built-in template.",
        label: "Missing prompt",
      };
    }

    // Parse schedule time
    const scheduleTimeRaw = args.scheduleTime
      ? String(args.scheduleTime).trim()
      : matchedTemplate
        ? `${matchedTemplate.cronHour}:${String(matchedTemplate.cronMinute).padStart(2, "0")}`
        : "";

    const parsed = scheduleTimeRaw ? parseScheduleTime(scheduleTimeRaw) : null;
    if (!parsed) {
      return {
        ok: false,
        content: `Couldn't determine a schedule time${scheduleTimeRaw ? ` from "${scheduleTimeRaw}"` : ""}. Try something like "7am", "8:30am", or "9pm".`,
        label: "Invalid schedule time",
      };
    }
    const { hour, minute } = parsed;

    // Get guild — use requested guildId if provided, else first guild
    const guilds = getGuildsForUser(userId);
    if (guilds.length === 0) {
      return {
        ok: false,
        content:
          "The Discord bot isn't running or isn't in any server yet. " +
          "Make sure the bot is set up and joined to your server.",
        label: "No guild found",
      };
    }
    const guild = requestedGuildId
      ? (guilds.find((g) => g.id === requestedGuildId) ?? guilds[0])
      : guilds[0];

    // Find or create the channel
    const existingChannels = await getChannelsForGuild(userId, guild.id);
    const targetChannel = existingChannels.find(
      (ch) => ch.name.toLowerCase() === channelName.toLowerCase(),
    );

    let channelId: string;
    let channelCreated = false;

    if (targetChannel) {
      channelId = targetChannel.id;
    } else {
      const created = await createDiscordChannel(userId, {
        channelName,
        topic: `Automated ${label} — posted by Jarvis`,
        categoryName,
        guildId: guild.id,
      });
      if (!created.ok || !created.channelId) {
        return {
          ok: false,
          content: `Couldn't create the #${channelName} channel: ${created.error}`,
          label: "Channel creation failed",
        };
      }
      channelId = created.channelId;
      channelCreated = true;
    }

    // Create the schedule
    try {
      const schedule = await createSchedule(userId, {
        guildId: guild.id,
        channelId,
        channelName,
        label,
        cronHour: hour,
        cronMinute: minute,
        daysOfWeek,
        prompt,
      });

      const timeStr = formatTime(hour, minute);
      const daysLabel =
        daysOfWeek === "0,1,2,3,4,5,6" ? "every day"
        : daysOfWeek === "1,2,3,4,5" ? "weekdays"
        : `days ${daysOfWeek}`;

      const templateNote = matchedTemplate ? " (using built-in template)" : "";

      return {
        ok: true,
        content:
          `✅ Scheduled "${label}"${templateNote} — runs ${daysLabel} at ${timeStr} and posts to #${channelName} in **${guild.name}**.\n` +
          (channelCreated ? `Created the #${channelName} channel.\n` : "") +
          `Schedule ID: \`${schedule.id}\`\n` +
          `To cancel: say "delete my ${label} schedule" or "cancel ${channelName} report".`,
        label: `Schedule created: ${label}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[schedule_channel_report] failed:", msg);
      return { ok: false, content: `Failed to save schedule: ${msg}`, label: "Schedule save failed" };
    }
  },
};

// ── list_channel_schedules ────────────────────────────────────────────────────

export const listChannelSchedulesTool: AgentTool = {
  name: "list_channel_schedules",
  description:
    "List all active Discord channel report schedules for the user. " +
    "Use when the user asks 'what automations do I have?', 'what schedules are running?', or 'show my Discord reports'.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },

  async execute(_args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const { userId } = ctx;
    try {
      const schedules = await listSchedules(userId);

      if (schedules.length === 0) {
        return {
          ok: true,
          content:
            "No Discord channel schedules set up yet. " +
            "Ask me to set up a stock research report or any other recurring automation.\n\n" +
            "**Available templates:**\n" +
            "• **AI Stock Research** — daily at 7am, posts to #stock-research\n" +
            "• **Competitor YouTube Research** — daily at 8am, posts to #competitor-research",
          label: "No schedules",
        };
      }

      const lines = schedules.map((s) => {
        const timeStr = formatTime(s.cronHour, s.cronMinute);
        const days =
          s.daysOfWeek === "0,1,2,3,4,5,6" ? "daily"
          : s.daysOfWeek === "1,2,3,4,5" ? "weekdays"
          : `days ${s.daysOfWeek}`;
        const status = s.enabled ? "✅" : "⏸️";
        const lastRun = s.lastRun
          ? `last ran ${new Date(s.lastRun).toLocaleDateString()}`
          : "never run yet";
        return `${status} **${s.label}** — #${s.channelName} at ${timeStr} ${days} (${lastRun}) | ID: \`${s.id}\``;
      });

      return {
        ok: true,
        content: `**Active Discord Schedules (${schedules.length}):**\n\n${lines.join("\n")}`,
        label: `${schedules.length} schedule(s)`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Failed to list schedules: ${msg}`, label: "List failed" };
    }
  },
};

// ── delete_channel_schedule ───────────────────────────────────────────────────

export const deleteChannelScheduleTool: AgentTool = {
  name: "delete_channel_schedule",
  description:
    "Cancel and delete a Discord channel report schedule. " +
    "Use when the user says 'cancel my stock report', 'stop the YouTube research', 'delete schedule X', or any request to remove an automated Discord report. " +
    "You can match by label (partial, case-insensitive) or by the exact schedule ID.",
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description:
          "The label (or partial label) of the schedule to delete. Case-insensitive match. " +
          "Example: 'stock research' will match 'AI Stock Research'.",
      },
      scheduleId: {
        type: "string",
        description: "The exact schedule ID (UUID) to delete. Use when the user specifies it directly.",
      },
    },
    required: [],
  },

  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const { userId } = ctx;
    const labelQuery = args.label ? String(args.label).toLowerCase().trim() : null;
    const scheduleId = args.scheduleId ? String(args.scheduleId).trim() : null;

    if (!labelQuery && !scheduleId) {
      return {
        ok: false,
        content: "Please provide either a label or a schedule ID to delete.",
        label: "Missing identifier",
      };
    }

    try {
      const all = await listSchedules(userId);

      let target = null;
      if (scheduleId) {
        target = all.find((s) => s.id === scheduleId) ?? null;
      } else if (labelQuery) {
        target = all.find((s) => s.label.toLowerCase().includes(labelQuery)) ?? null;
      }

      if (!target) {
        const names = all.map((s) => `"${s.label}"`).join(", ");
        return {
          ok: false,
          content:
            `No schedule found matching "${labelQuery ?? scheduleId}". ` +
            (all.length > 0 ? `Your schedules: ${names}` : "You have no schedules set up."),
          label: "Schedule not found",
        };
      }

      await deleteSchedule(userId, target.id);

      return {
        ok: true,
        content: `Cancelled "${target.label}" — it will no longer post to #${target.channelName}.`,
        label: `Deleted: ${target.label}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Failed to delete schedule: ${msg}`, label: "Delete failed" };
    }
  },
};
