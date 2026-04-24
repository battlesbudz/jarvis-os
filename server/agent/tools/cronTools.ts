import type { AgentTool } from "../types";
import { db } from "../../db";
import { eq, and, desc, gte } from "drizzle-orm";
import * as schema from "@shared/schema";

// ─── Natural-language time parser ────────────────────────────────────────────
// Handles the most common patterns the agent will produce without adding a
// dependency. Falls back gracefully to ISO 8601 if the input is already valid.

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function parseTimeOfDay(str: string): { hours: number; minutes: number } | null {
  const m = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = (m[3] || "").toLowerCase();
  if (meridiem === "pm" && hours !== 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function nextWeekday(dayIndex: number, timeStr?: string): Date {
  const now = new Date();
  const result = new Date(now);
  const currentDay = now.getDay();
  let daysUntil = (dayIndex - currentDay + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  result.setDate(now.getDate() + daysUntil);
  if (timeStr) {
    const t = parseTimeOfDay(timeStr);
    if (t) {
      result.setHours(t.hours, t.minutes, 0, 0);
    } else {
      result.setHours(9, 0, 0, 0);
    }
  } else {
    result.setHours(9, 0, 0, 0);
  }
  return result;
}

export function parseNaturalTime(expr: string): Date | null {
  const s = expr.trim();
  if (!s) return null;

  // Already a valid ISO / date string?
  const direct = new Date(s);
  if (!isNaN(direct.getTime()) && s.includes("-")) return direct;

  const lower = s.toLowerCase();
  const now = new Date();

  // "in X minutes/hours/days"
  const relM = lower.match(/^in\s+(\d+(?:\.\d+)?)\s+(minute|minutes|hour|hours|day|days|week|weeks)$/);
  if (relM) {
    const n = parseFloat(relM[1]);
    const unit = relM[2];
    const result = new Date(now);
    if (unit.startsWith("minute")) result.setMinutes(now.getMinutes() + n);
    else if (unit.startsWith("hour")) result.setTime(now.getTime() + n * 3600 * 1000);
    else if (unit.startsWith("day")) result.setDate(now.getDate() + n);
    else if (unit.startsWith("week")) result.setDate(now.getDate() + n * 7);
    return result;
  }

  // "tomorrow [at HH:MM]"
  if (lower.startsWith("tomorrow")) {
    const timeStr = lower.replace(/^tomorrow\s*(at\s*)?/, "").trim();
    const result = new Date(now);
    result.setDate(now.getDate() + 1);
    const t = timeStr ? parseTimeOfDay(timeStr) : null;
    result.setHours(t ? t.hours : 9, t ? t.minutes : 0, 0, 0);
    return result;
  }

  // "today at HH:MM"
  if (lower.startsWith("today")) {
    const timeStr = lower.replace(/^today\s*(at\s*)?/, "").trim();
    const result = new Date(now);
    const t = timeStr ? parseTimeOfDay(timeStr) : null;
    result.setHours(t ? t.hours : now.getHours() + 1, t ? t.minutes : 0, 0, 0);
    return result;
  }

  // "next [weekday]" or "[weekday]" or "next [weekday] at HH:MM"
  const weekdayM = lower.match(/^(?:next\s+)?(\w+)(?:\s+at\s+(.+))?$/);
  if (weekdayM) {
    const dayKey = weekdayM[1];
    const timeStr = weekdayM[2];
    const dayIndex = WEEKDAYS[dayKey];
    if (dayIndex !== undefined) {
      return nextWeekday(dayIndex, timeStr);
    }
  }

  // "HH:MM [am/pm]" (time today, or tomorrow if already past)
  const justTime = parseTimeOfDay(lower);
  if (justTime) {
    const result = new Date(now);
    result.setHours(justTime.hours, justTime.minutes, 0, 0);
    if (result <= now) result.setDate(result.getDate() + 1);
    return result;
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatWhen(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatAge(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 2) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const cronCreateTool: AgentTool = {
  name: "cron_create",
  description:
    "Schedule a one-off or recurring job for Jarvis to run at a specific time. Accepts natural-language time expressions ('in 4 hours', 'tomorrow at 9am', 'next Monday', 'every Friday at 6pm') or ISO 8601 dates. Jobs appear in the user's Mission Control schedule. Returns the job ID which you can use with cron_delete or cron_update.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short label for the job (e.g. 'Follow up on proposal', 'Weekly inbox review')",
      },
      description: {
        type: "string",
        description: "What Jarvis should do when this job fires — be specific about the action.",
      },
      when: {
        type: "string",
        description:
          "When to run — natural language ('in 4 hours', 'tomorrow at 9am', 'next Monday at 10am') or ISO 8601 datetime. For recurring jobs, this sets the first occurrence.",
      },
      recurrence: {
        type: "string",
        description:
          "Optional: how often to repeat ('daily', 'every Monday', 'weekdays at 9am', 'weekly'). Omit for one-off jobs.",
      },
    },
    required: ["title", "when"],
  },
  async execute(args, ctx) {
    const title = String(args.title || "").trim();
    const whenExpr = String(args.when || "").trim();
    const recurrence = args.recurrence ? String(args.recurrence).trim() : null;
    const description = args.description ? String(args.description).trim() : null;

    if (!title) return { ok: false, content: "title is required.", label: "cron_create: no title" };
    if (!whenExpr) return { ok: false, content: "when is required.", label: "cron_create: no when" };

    const scheduledAt = parseNaturalTime(whenExpr);
    if (!scheduledAt) {
      return {
        ok: false,
        content: `Could not parse time expression: "${whenExpr}". Try "in 4 hours", "tomorrow at 9am", "next Monday", or an ISO date.`,
        label: "cron_create: unparseable time",
      };
    }

    try {
      const [task] = await db
        .insert(schema.jarvisScheduledTasks)
        .values({ userId: ctx.userId, title, description, scheduledAt, recurrence })
        .returning();

      const when = formatWhen(scheduledAt);
      console.log(`[${ctx.channel || "Agent"}] cron_create id=${task.id} title="${title}" scheduledAt=${scheduledAt.toISOString()}`);

      return {
        ok: true,
        content: `Scheduled "${title}" for ${when}${recurrence ? ` (repeats: ${recurrence})` : ""}.\nJob ID: ${task.id}`,
        label: `Scheduled: ${title}`,
        detail: JSON.stringify({ id: task.id, scheduledAt: task.scheduledAt }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `cron_create failed: ${msg}`, label: "cron_create: error" };
    }
  },
};

export const cronListTool: AgentTool = {
  name: "cron_list",
  description:
    "List scheduled Jarvis jobs for this user — upcoming one-offs and recurring tasks. Shows job IDs (needed for cron_delete/cron_update), titles, next-run times, and whether they're complete. Use to check what's already scheduled before creating duplicates.",
  parameters: {
    type: "object",
    properties: {
      include_completed: {
        type: "boolean",
        description: "Set true to include jobs that have already run (default: false — only shows upcoming)",
      },
      limit: {
        type: "number",
        description: "Max jobs to return (default 15, max 40)",
      },
    },
    required: [],
  },
  async execute(args, ctx) {
    const includeCompleted = args.include_completed === true;
    const limit = Math.min(40, Math.max(1, Number(args.limit) || 15));

    try {
      const now = new Date();
      const rows = includeCompleted
        ? await db
            .select()
            .from(schema.jarvisScheduledTasks)
            .where(eq(schema.jarvisScheduledTasks.userId, ctx.userId))
            .orderBy(desc(schema.jarvisScheduledTasks.scheduledAt))
            .limit(limit)
        : await db
            .select()
            .from(schema.jarvisScheduledTasks)
            .where(
              and(
                eq(schema.jarvisScheduledTasks.userId, ctx.userId),
                gte(schema.jarvisScheduledTasks.scheduledAt, now),
              ),
            )
            .orderBy(schema.jarvisScheduledTasks.scheduledAt)
            .limit(limit);

      if (rows.length === 0) {
        return {
          ok: true,
          content: includeCompleted ? "No scheduled jobs found." : "No upcoming scheduled jobs.",
          label: "cron_list: empty",
        };
      }

      const lines = rows.map((r) => {
        const when = formatWhen(new Date(r.scheduledAt));
        const completed = r.completedAt ? ` ✓ ran ${formatAge(new Date(r.completedAt))}` : "";
        const recurring = r.recurrence ? ` [${r.recurrence}]` : "";
        return `• [${r.id}] "${r.title}"${recurring} — ${when}${completed}`;
      });

      const content = `${rows.length} scheduled job(s):\n\n${lines.join("\n")}`;
      console.log(`[${ctx.channel || "Agent"}] cron_list user=${ctx.userId} → ${rows.length} rows`);

      return {
        ok: true,
        content,
        label: `Cron list (${rows.length})`,
        detail: `${rows.length} job(s)`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `cron_list failed: ${msg}`, label: "cron_list: error" };
    }
  },
};

export const cronDeleteTool: AgentTool = {
  name: "cron_delete",
  description:
    "Cancel and delete a scheduled Jarvis job by its ID. Use cron_list to get IDs. Only deletes jobs belonging to the current user.",
  parameters: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The job ID to delete (from cron_list or cron_create output)",
      },
    },
    required: ["job_id"],
  },
  async execute(args, ctx) {
    const jobId = String(args.job_id || "").trim();
    if (!jobId) return { ok: false, content: "job_id is required.", label: "cron_delete: no ID" };

    try {
      const existing = await db
        .select({ id: schema.jarvisScheduledTasks.id, title: schema.jarvisScheduledTasks.title })
        .from(schema.jarvisScheduledTasks)
        .where(
          and(
            eq(schema.jarvisScheduledTasks.id, jobId),
            eq(schema.jarvisScheduledTasks.userId, ctx.userId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        return {
          ok: false,
          content: `No scheduled job found with ID "${jobId}" for this user.`,
          label: "cron_delete: not found",
        };
      }

      await db
        .delete(schema.jarvisScheduledTasks)
        .where(
          and(
            eq(schema.jarvisScheduledTasks.id, jobId),
            eq(schema.jarvisScheduledTasks.userId, ctx.userId),
          ),
        );

      console.log(`[${ctx.channel || "Agent"}] cron_delete id=${jobId} title="${existing[0].title}"`);

      return {
        ok: true,
        content: `Deleted scheduled job "${existing[0].title}" (ID: ${jobId}).`,
        label: `Deleted: ${existing[0].title}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `cron_delete failed: ${msg}`, label: "cron_delete: error" };
    }
  },
};

export const cronUpdateTool: AgentTool = {
  name: "cron_update",
  description:
    "Update an existing scheduled Jarvis job — change its title, description, next-run time, or recurrence. Use cron_list to get IDs. Only updates jobs belonging to the current user.",
  parameters: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The job ID to update (from cron_list or cron_create output)",
      },
      title: {
        type: "string",
        description: "New title (omit to keep existing)",
      },
      description: {
        type: "string",
        description: "New description of what Jarvis should do (omit to keep existing)",
      },
      when: {
        type: "string",
        description:
          "New scheduled time — natural language ('in 4 hours', 'next Monday at 9am') or ISO 8601 (omit to keep existing)",
      },
      recurrence: {
        type: "string",
        description: "New recurrence rule ('daily', 'every Monday', etc.). Pass 'none' to make it a one-off.",
      },
    },
    required: ["job_id"],
  },
  async execute(args, ctx) {
    const jobId = String(args.job_id || "").trim();
    if (!jobId) return { ok: false, content: "job_id is required.", label: "cron_update: no ID" };

    try {
      const existing = await db
        .select()
        .from(schema.jarvisScheduledTasks)
        .where(
          and(
            eq(schema.jarvisScheduledTasks.id, jobId),
            eq(schema.jarvisScheduledTasks.userId, ctx.userId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        return {
          ok: false,
          content: `No scheduled job found with ID "${jobId}" for this user.`,
          label: "cron_update: not found",
        };
      }

      const patch: Partial<typeof schema.jarvisScheduledTasks.$inferInsert> = {};

      if (args.title) patch.title = String(args.title).trim();
      if (args.description) patch.description = String(args.description).trim();

      if (args.when) {
        const whenExpr = String(args.when).trim();
        const newDate = parseNaturalTime(whenExpr);
        if (!newDate) {
          return {
            ok: false,
            content: `Could not parse time expression: "${whenExpr}". Try "in 4 hours", "next Monday", or an ISO date.`,
            label: "cron_update: unparseable time",
          };
        }
        patch.scheduledAt = newDate;
      }

      if (args.recurrence !== undefined) {
        const rec = String(args.recurrence).trim().toLowerCase();
        patch.recurrence = rec === "none" || rec === "" ? null : rec;
      }

      if (Object.keys(patch).length === 0) {
        return {
          ok: false,
          content: "No fields to update — provide at least one of: title, description, when, recurrence.",
          label: "cron_update: nothing to change",
        };
      }

      const [updated] = await db
        .update(schema.jarvisScheduledTasks)
        .set(patch)
        .where(
          and(
            eq(schema.jarvisScheduledTasks.id, jobId),
            eq(schema.jarvisScheduledTasks.userId, ctx.userId),
          ),
        )
        .returning();

      const title = updated.title;
      const when = formatWhen(new Date(updated.scheduledAt));
      console.log(`[${ctx.channel || "Agent"}] cron_update id=${jobId} title="${title}"`);

      return {
        ok: true,
        content: `Updated "${title}" — next run: ${when}${updated.recurrence ? ` (${updated.recurrence})` : ""}.`,
        label: `Updated: ${title}`,
        detail: JSON.stringify({ id: updated.id, scheduledAt: updated.scheduledAt }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `cron_update failed: ${msg}`, label: "cron_update: error" };
    }
  },
};
