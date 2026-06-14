import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import { createJarvisScheduledTask } from "../../jarvisScheduledTasks";
import { parseNaturalTime, parseRecurringExpr } from "./cronTools";

interface ScheduleJarvisTaskArgs {
  title?: string;
  description?: string;
  scheduledAt?: string;
  recurrence?: string;
  taskKind?: string;
}

export const scheduleJarvisTaskTool: AgentTool = {
  name: "schedule_jarvis_task",
  description:
    "Schedule a recurring or one-off task/reminder for the user's own to-do list. Use this for human tasks like 'remind me to call...', 'add Make $140 on DoorDash as a daily task', habits, errands, chores, and anything Jarvis cannot personally do because it requires the user's body, car, money, physical presence, or real-world action. These are non-executable user tasks by default. Do not use this tool for autonomous work Jarvis should perform later, such as checking inboxes, running scripts, sending reports, or operating connected apps; use the explicit cron/job tools for those.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short title for the scheduled task (e.g. 'Morning inbox scan', 'Weekly goal review')",
      },
      description: {
        type: "string",
        description: "What Jarvis will do when this task runs. Be specific.",
      },
      scheduledAt: {
        type: "string",
        description: "When to first run this task. Accepts an ISO 8601 datetime string or common natural language such as 'in an hour', 'tomorrow at 9am', or 'next Monday at 10am'. For daily/recurring tasks, use the next scheduled occurrence.",
      },
      recurrence: {
        type: "string",
        description: "Optional recurrence rule in plain English (e.g. 'daily', 'every Monday', 'weekdays at 9am', 'every Sunday at 8pm'). Omit for one-off tasks.",
      },
      taskKind: {
        type: "string",
        enum: ["user_task", "jarvis_action"],
        description: "Defaults to user_task. Only use jarvis_action when Jarvis can actually perform the future action with tools; never use jarvis_action for physical or user-owned tasks.",
      },
    },
    required: ["title", "scheduledAt"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const a = args as ScheduleJarvisTaskArgs;
    const title = String(a.title || "").trim();
    const scheduledAtStr = String(a.scheduledAt || "").trim();

    if (!title) {
      return { ok: false, content: "title is required.", label: "Missing title" };
    }
    if (!scheduledAtStr) {
      return { ok: false, content: "scheduledAt is required.", label: "Missing scheduledAt" };
    }

    const recurring = parseRecurringExpr(scheduledAtStr);
    const scheduledAt = recurring?.scheduledAt ?? parseNaturalTime(scheduledAtStr) ?? new Date(scheduledAtStr);
    const recurrence = a.recurrence ? String(a.recurrence).trim() : recurring?.recurrence ?? null;
    if (isNaN(scheduledAt.getTime())) {
      return { ok: false, content: `Invalid scheduledAt: "${scheduledAtStr}". Use ISO 8601 or natural language like "in an hour" or "tomorrow at 9am".`, label: "Invalid date" };
    }

    try {
      const { task, deduped } = await createJarvisScheduledTask({
        userId: ctx.userId,
        title,
        description: a.description ? String(a.description).trim() : null,
        scheduledAt,
        recurrence,
        taskKind: a.taskKind,
      });

      const when = scheduledAt.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const actionLabel = deduped ? "Already scheduled" : "Scheduled";

      return {
        ok: true,
        content: `${actionLabel}: "${title}" for ${when}${recurrence ? ` (${recurrence})` : ""}.\n\n[View in Scheduled Tasks ->](gameplan://scheduled)`,
        label: `${actionLabel}: ${title}`,
        detail: JSON.stringify({ id: task.id, title, scheduledAt: task.scheduledAt, deduped }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[schedule_jarvis_task] failed:", msg);
      return { ok: false, content: `Failed to schedule task: ${msg}`, label: "Schedule failed", detail: msg };
    }
  },
};
