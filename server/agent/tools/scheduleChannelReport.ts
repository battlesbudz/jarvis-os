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
} from "../../discord/schedules";
import { getGuildsForUser, getChannelsForGuild, createDiscordChannel } from "../../discord/manager";

// ── Time parser ───────────────────────────────────────────────────────────────

/**
 * Parse a natural language time string into { hour, minute }.
 * Handles: "7am", "7:30am", "8pm", "noon", "every morning at 9", "daily at 8:00".
 */
function parseScheduleTime(raw: string): { hour: number; minute: number } | null {
  const s = raw.toLowerCase().trim();

  // noon / midnight
  if (s.includes("noon")) return { hour: 12, minute: 0 };
  if (s.includes("midnight")) return { hour: 0, minute: 0 };

  // Match patterns like "7am", "7:30am", "9:00 pm", "14:00"
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
    "IMPORTANT: Only use this for creating scheduled DISCORD channel reports. For general reminders, use schedule_jarvis_task instead.",
  parameters: {
    type: "object",
    properties: {
      channelName: {
        type: "string",
        description:
          "The Discord channel name to post to (e.g. 'stock-research', 'competitor-research'). " +
          "Use lowercase with hyphens. The channel will be created if it doesn't exist.",
      },
      label: {
        type: "string",
        description:
          "A short human-readable label for this schedule (e.g. 'AI Stock Research', 'Competitor YouTube Report'). " +
          "Shown when the user asks to list or cancel their automations.",
      },
      scheduleTime: {
        type: "string",
        description:
          "When to run the report, in natural language (e.g. '7am', '8:30am', 'every morning at 9'). " +
          "The schedule runs daily at this time. For less frequent schedules, use daysOfWeek.",
      },
      prompt: {
        type: "string",
        description:
          "The research instructions Jarvis will execute when the schedule fires. Be specific. " +
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
    },
    required: ["channelName", "label", "scheduleTime", "prompt"],
  },

  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const { userId } = ctx;
    const channelName = String(args.channelName || "").trim().toLowerCase().replace(/\s+/g, "-");
    const label = String(args.label || "").trim();
    const scheduleTimeRaw = String(args.scheduleTime || "").trim();
    const prompt = String(args.prompt || "").trim();
    const daysOfWeek = args.daysOfWeek ? String(args.daysOfWeek).trim() : "0,1,2,3,4,5,6";
    const categoryName = args.categoryName ? String(args.categoryName).trim() : undefined;

    if (!channelName) return { ok: false, content: "channelName is required.", label: "Missing channelName" };
    if (!label) return { ok: false, content: "label is required.", label: "Missing label" };
    if (!prompt) return { ok: false, content: "prompt is required.", label: "Missing prompt" };

    // Parse time
    const parsed = parseScheduleTime(scheduleTimeRaw);
    if (!parsed) {
      return {
        ok: false,
        content: `Couldn't parse schedule time "${scheduleTimeRaw}". Try something like "7am", "8:30am", or "9pm".`,
        label: "Invalid schedule time",
      };
    }
    const { hour, minute } = parsed;

    // Get guild
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
    const guild = guilds[0];

    // Find or create the channel
    const existingChannels = await getChannelsForGuild(userId, guild.id);
    let targetChannel = existingChannels.find(
      (ch) => ch.name.toLowerCase() === channelName.toLowerCase(),
    );

    let channelId: string;
    let channelCreated = false;

    if (targetChannel) {
      channelId = targetChannel.id;
    } else {
      // Create the channel
      const created = await createDiscordChannel(userId, {
        channelName,
        topic: `Automated ${label} — posted by Jarvis`,
        categoryName,
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

      return {
        ok: true,
        content:
          `✅ Scheduled "${label}" — runs ${daysLabel} at ${timeStr} and posts to #${channelName} in **${guild.name}**.\n` +
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
          content: "No Discord channel schedules set up yet. Ask me to set up a stock research report or any other recurring automation.",
          label: "No schedules",
        };
      }

      const lines = schedules.map((s) => {
        const timeStr = formatTime(s.cronHour, s.cronMinute);
        const days =
          s.daysOfWeek === "0,1,2,3,4,5,6" ? "daily"
          : s.daysOfWeek === "1,2,3,4,5" ? "weekdays"
          : `days ${s.daysOfWeek}`;
        const status = s.enabled === "true" ? "✅" : "⏸️";
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
