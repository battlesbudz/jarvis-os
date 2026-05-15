import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import { createJarvisScheduledTask } from "../../jarvisScheduledTasks";

interface ScheduleJarvisTaskArgs {
  title?: string;
  description?: string;
  scheduledAt?: string;
  recurrence?: string;
}

export const scheduleJarvisTaskTool: AgentTool = {
  name: "schedule_jarvis_task",
  description:
    "Schedule a recurring or one-off task for Jarvis to perform automatically. Use this when the user asks you to 'remind me every Monday to...', 'check my inbox every morning', 'do X at Y time', or any request to schedule a future autonomous action. These tasks appear in the user's Mission Control calendar so they can verify Jarvis is actually scheduled to do what they asked.",
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
        description: "When to first run this task. ISO 8601 datetime string (e.g. '2025-05-01T09:00:00Z'). For daily/recurring tasks, use the next scheduled occurrence.",
      },
      recurrence: {
        type: "string",
        description: "Optional recurrence rule in plain English (e.g. 'daily', 'every Monday', 'weekdays at 9am', 'every Sunday at 8pm'). Omit for one-off tasks.",
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

    const scheduledAt = new Date(scheduledAtStr);
    if (isNaN(scheduledAt.getTime())) {
      return { ok: false, content: `Invalid scheduledAt: "${scheduledAtStr}". Use ISO 8601 format.`, label: "Invalid date" };
    }

    try {
      const { task, deduped } = await createJarvisScheduledTask({
        userId: ctx.userId,
        title,
        description: a.description ? String(a.description).trim() : null,
        scheduledAt,
        recurrence: a.recurrence ? String(a.recurrence).trim() : null,
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
        content: `${actionLabel}: "${title}" for ${when}${a.recurrence ? ` (${a.recurrence})` : ""}.\n\n[View in Scheduled Tasks ->](gameplan://scheduled)`,
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
