/**
 * Discord OS Phase 1 — Agent tools for scheduled channel reports
 *
 * Tools:
 *   schedule_channel_report  — create a recurring automated report
 *   list_channel_schedules   — list all active schedules
 *   delete_channel_schedule  — cancel a schedule by label or id
 */

import type { AgentTool } from "../types";
import {
  createSchedule,
  parseCronExpression,
  listSchedules,
  deleteSchedule,
  detectTemplate,
  SCHEDULE_TEMPLATES,
} from "../../discord/schedules";
import { createDiscordChannel } from "../../discord/manager";

// ── schedule_channel_report ───────────────────────────────────────────────────

export const scheduleChannelReportTool: AgentTool = {
  name: "schedule_channel_report",
  description:
    "Create a recurring automated research report that Jarvis runs at a scheduled time and posts to a specific Discord channel. " +
    "Use this when the user asks to set up a daily/recurring automated report in Discord — for example " +
    "'set up a daily stock research report at 7am' or 'every morning at 8am, post YouTube competitor research to #competitor-research'. " +
    "Jarvis will create the channel if it doesn't exist, then schedule the recurring report. " +
    "Built-in templates are available: say 'stock research' to use the AI stock template, or 'competitor YouTube' to use the YouTube research template. " +
    "The schedule parameter accepts natural language (e.g. 'every morning at 7am', 'every Monday at 9am'). " +
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
      schedule: {
        type: "string",
        description:
          "When to run the report, in natural language (e.g. 'every morning at 7am', 'daily at 8pm', 'every Monday at 9am'). " +
          "If omitted and a template is matched, the template's default schedule will be used.",
      },
      prompt: {
        type: "string",
        description:
          "The research instructions Jarvis will execute when the schedule fires. Be specific. " +
          "If omitted, Jarvis will try to detect a built-in template from the label or channel name. " +
          "Example: 'Research the top 8 AI infrastructure stocks. For each: ticker, thesis, latest news.'",
      },
      pipelineNext: {
        type: "string",
        description: "Optional: the ID of another schedule to trigger after this one completes (for chained pipelines).",
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

  async execute(args, ctx) {
    const { userId } = ctx;

    // Try template auto-detection from label or channelName
    const rawLabel = args.label ? String(args.label).trim() : "";
    const rawChannel = args.channelName ? String(args.channelName).trim() : "";
    const rawPrompt = args.prompt ? String(args.prompt).trim() : "";
    const rawSchedule = args.schedule ? String(args.schedule).trim() : "";
    const rawTopic = args.topic ? String(args.topic).trim() : "";
    const pipelineNext = args.pipelineNext ? String(args.pipelineNext).trim() : undefined;

    const templateLookup = rawLabel || rawPrompt || rawChannel;
    const matchedTemplate = templateLookup ? detectTemplate(templateLookup) : null;

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
      return {
        ok: false,
        content:
          "The YouTube competitor research template needs a topic to search for. " +
          "For example: 'Set up competitor YouTube research for ADHD productivity'. " +
          "What topic or niche should I search YouTube for?",
        label: "Missing topic for YouTube template",
      };
    }

    // Validate resolved fields
    if (!channelName) {
      return {
        ok: false,
        content:
          "Please provide a channelName for the report (e.g. 'stock-research').\n\n" +
          "**Available templates:** say 'stock research' or 'competitor YouTube'.",
        label: "Missing channelName",
      };
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

    // Build cron expression from schedule string or template default
    const scheduleInput = rawSchedule || matchedTemplate?.cronExpression || "0 7 * * *";
    // If it already looks like a cron expression (5 fields), use as-is; else parse natural language
    const cronExpression = /^\S+ \S+ \S+ \S+ \S+$/.test(scheduleInput)
      ? scheduleInput
      : parseCronExpression(scheduleInput);

    // Ensure channel exists
    await createDiscordChannel(userId, {
      channelName,
      topic: `Automated reports: ${label}`,
      categoryName: "🧠 Jarvis Workspace",
    });

    const schedule = await createSchedule(userId, {
      channelName,
      label,
      cronExpression,
      prompt,
      pipelineNext,
    });

    const templateNote = matchedTemplate ? " (using built-in template)" : "";

    return {
      ok: true,
      content:
        `✅ Scheduled **${label}**${templateNote} — runs \`${cronExpression}\` and posts to #${channelName}.\n` +
        `Schedule ID: \`${schedule.id}\`\n` +
        `To cancel: say "delete my ${label} schedule" or "cancel ${channelName} report".`,
      label: `Schedule created: ${label}`,
      detail: schedule.id,
    };
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

  async execute(_args, ctx) {
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
            "• **AI Stock Research** — weekdays at 7am, posts to #stock-research\n" +
            "• **Competitor YouTube Research** — daily at 8am, posts to #competitor-research",
          label: "No schedules",
        };
      }

      const lines = schedules.map((s) => {
        const status = s.enabled ? "✅ Active" : "⏸ Paused";
        const lastRun = s.lastRun ? `Last run: ${new Date(s.lastRun).toLocaleString()}` : "Never run";
        return `• **${s.label}** → #${s.channelName} | \`${s.cronExpression}\` | ${status} | ${lastRun} | ID: \`${s.id}\``;
      });

      return {
        ok: true,
        content: `**Your Discord Channel Schedules (${schedules.length}):**\n\n${lines.join("\n")}`,
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

  async execute(args, ctx) {
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

      let target: (typeof all)[0] | null = null;
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
