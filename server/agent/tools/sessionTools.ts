import type { AgentTool } from "../types";
import { db } from "../../db";
import { eq, and, desc, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { submitAgentJob } from "../jobQueue";
import type { AgentJobType } from "../jobQueue";

export const sessionsListTool: AgentTool = {
  name: "sessions_list",
  description:
    "List the user's recent background agent sessions (jobs) — research tasks, goal decompositions, writing tasks, etc. Shows job ID, type, title, status, and when it was created. Use to check on active or recent work before spawning duplicate tasks.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description:
          "Optional filter by status: queued, running, complete, failed, cancelled. Omit to see all recent jobs.",
      },
      limit: {
        type: "number",
        description: "Max jobs to return (default 10, max 30)",
      },
    },
    required: [],
  },
  async execute(args, ctx) {
    const statusFilter = args.status ? String(args.status).trim() : null;
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 10));

    try {
      const rows = statusFilter
        ? await db
            .select({
              id: schema.agentJobs.id,
              agentType: schema.agentJobs.agentType,
              title: schema.agentJobs.title,
              status: schema.agentJobs.status,
              createdAt: schema.agentJobs.createdAt,
              completedAt: schema.agentJobs.completedAt,
              turns: schema.agentJobs.turns,
              toolCallsCount: schema.agentJobs.toolCallsCount,
            })
            .from(schema.agentJobs)
            .where(
              and(
                eq(schema.agentJobs.userId, ctx.userId),
                eq(schema.agentJobs.status, statusFilter),
              ),
            )
            .orderBy(desc(schema.agentJobs.createdAt))
            .limit(limit)
        : await db
            .select({
              id: schema.agentJobs.id,
              agentType: schema.agentJobs.agentType,
              title: schema.agentJobs.title,
              status: schema.agentJobs.status,
              createdAt: schema.agentJobs.createdAt,
              completedAt: schema.agentJobs.completedAt,
              turns: schema.agentJobs.turns,
              toolCallsCount: schema.agentJobs.toolCallsCount,
            })
            .from(schema.agentJobs)
            .where(eq(schema.agentJobs.userId, ctx.userId))
            .orderBy(desc(schema.agentJobs.createdAt))
            .limit(limit);

      if (rows.length === 0) {
        return {
          ok: true,
          content: statusFilter
            ? `No ${statusFilter} jobs found.`
            : "No background jobs found.",
          label: "Sessions: none",
        };
      }

      const lines = rows.map((r) => {
        const age = r.completedAt
          ? `completed ${formatAge(r.completedAt)}`
          : r.createdAt
          ? `created ${formatAge(r.createdAt)}`
          : "";
        const stats =
          r.status === "complete" && r.turns
            ? ` (${r.turns} turn${r.turns === 1 ? "" : "s"}, ${r.toolCallsCount || 0} tools)`
            : "";
        return `• [${r.id}] ${r.status.toUpperCase()} | ${r.agentType} | "${r.title}" | ${age}${stats}`;
      });

      const content = `${rows.length} session(s)${statusFilter ? ` (${statusFilter})` : ""}:\n\n${lines.join("\n")}`;

      console.log(
        `[${ctx.channel || "Agent"}] sessions_list user=${ctx.userId} → ${rows.length} rows`,
      );

      return {
        ok: true,
        content,
        label: `Sessions list (${rows.length})`,
        detail: `${rows.length} jobs`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `sessions_list failed: ${msg}`, label: "Sessions list error" };
    }
  },
};

export const sessionsHistoryTool: AgentTool = {
  name: "sessions_history",
  description:
    "Fetch the full output of a background session (job) by its ID. Returns the job details, result summary, and any deliverable body text that was produced. Use after sessions_list to read what a completed job produced.",
  parameters: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The job ID returned by sessions_list or spawn_subagent",
      },
    },
    required: ["job_id"],
  },
  async execute(args, ctx) {
    const jobId = String(args.job_id || "").trim();
    if (!jobId) {
      return { ok: false, content: "No job_id provided.", label: "sessions_history: no ID" };
    }

    try {
      const [job] = await db
        .select()
        .from(schema.agentJobs)
        .where(
          and(
            eq(schema.agentJobs.id, jobId),
            eq(schema.agentJobs.userId, ctx.userId),
          ),
        )
        .limit(1);

      if (!job) {
        return {
          ok: false,
          content: `No job found with ID "${jobId}" for this user.`,
          label: "sessions_history: not found",
        };
      }

      const parts: string[] = [
        `**Job:** ${job.id}`,
        `**Type:** ${job.agentType}`,
        `**Title:** ${job.title}`,
        `**Status:** ${job.status}`,
        `**Created:** ${job.createdAt ? formatDate(job.createdAt) : "unknown"}`,
        job.completedAt ? `**Completed:** ${formatDate(job.completedAt)}` : "",
        job.turns ? `**Turns:** ${job.turns}` : "",
        job.toolCallsCount ? `**Tool calls:** ${job.toolCallsCount}` : "",
        `\n**Original prompt:**\n${job.prompt}`,
      ].filter(Boolean);

      if (job.error) {
        parts.push(`\n**Error:**\n${job.error}`);
      }

      if (job.result && typeof job.result === "object") {
        const r = job.result as Record<string, unknown>;
        parts.push(`\n**Result metadata:**\n${JSON.stringify(r, null, 2)}`);
      }

      const deliverables = await db
        .select({
          type: schema.deliverables.type,
          title: schema.deliverables.title,
          summary: schema.deliverables.summary,
          body: schema.deliverables.body,
          status: schema.deliverables.status,
        })
        .from(schema.deliverables)
        .where(eq(schema.deliverables.jobId, jobId))
        .limit(1);

      const del = deliverables[0];
      if (del) {
        parts.push(
          `\n**Deliverable (${del.type} — ${del.status}):** ${del.title}`,
          del.summary ? `*${del.summary}*` : "",
          `\n${del.body}`,
        );
      }

      const content = parts.filter(Boolean).join("\n");

      console.log(
        `[${ctx.channel || "Agent"}] sessions_history job=${jobId} status=${job.status}`,
      );

      return {
        ok: true,
        content,
        label: `Session history: ${job.title}`,
        detail: `${job.status} job`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        content: `sessions_history failed: ${msg}`,
        label: "sessions_history error",
      };
    }
  },
};

export const sessionsSendTool: AgentTool = {
  name: "sessions_send",
  description:
    "Start a new background agent session (sub-task) and return its job ID. Use this to delegate work to a background agent — research, writing, planning, goal decomposition — without blocking the current conversation. The user will be notified when it completes via their configured channel.",
  parameters: {
    type: "object",
    properties: {
      agent_type: {
        type: "string",
        description:
          "Type of agent session to start: research, writing, planning, goal_decompose, weekly_pattern",
      },
      title: {
        type: "string",
        description: "Short descriptive title for this session (shown in the inbox)",
      },
      prompt: {
        type: "string",
        description: "Full instructions for the background agent — what it should do and produce",
      },
    },
    required: ["agent_type", "title", "prompt"],
  },
  async execute(args, ctx) {
    const agentType = String(args.agent_type || "").trim() as AgentJobType;
    const title = String(args.title || "").trim();
    const prompt = String(args.prompt || "").trim();

    if (!agentType || !title || !prompt) {
      return {
        ok: false,
        content: "agent_type, title, and prompt are all required.",
        label: "sessions_send: missing params",
      };
    }

    const validTypes: AgentJobType[] = [
      "research",
      "writing",
      "planning",
      "goal_decompose",
      "weekly_pattern",
    ];

    if (!validTypes.includes(agentType)) {
      return {
        ok: false,
        content: `Unknown agent_type "${agentType}". Valid types: ${validTypes.join(", ")}`,
        label: "sessions_send: invalid type",
      };
    }

    try {
      const jobId = await submitAgentJob({
        userId: ctx.userId,
        agentType,
        title,
        prompt,
        input: { source: "sessions_send", channel: ctx.channel || "agent" },
      });

      console.log(
        `[${ctx.channel || "Agent"}] sessions_send spawned ${agentType} job ${jobId} title="${title}"`,
      );

      return {
        ok: true,
        content: `Background session started — job ID: ${jobId}\nType: ${agentType}\nTitle: ${title}\n\nThe agent is now running. You can check its status with sessions_list or read its output with sessions_history once it completes. The user will be notified via their preferred channel when done.`,
        label: `Session started: ${title}`,
        detail: `Job ID: ${jobId}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `sessions_send failed: ${msg}`, label: "sessions_send error" };
    }
  },
};

export const sessionsCancelTool: AgentTool = {
  name: "sessions_cancel",
  description:
    "Cancel a background agent session (job) by its ID. Use when the user asks to stop, abort, or cancel a running or queued background job. " +
    "Queued jobs are cancelled immediately (they never started). " +
    "Running jobs are marked as 'cancelling' — they stop at the next checkpoint. " +
    "First call sessions_list if you need to look up the job ID.",
  parameters: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The job ID to cancel. Get this from sessions_list output.",
      },
    },
    required: ["job_id"],
  },
  async execute(args, ctx) {
    const jobId = String(args.job_id || "").trim();
    if (!jobId) {
      return { ok: false, content: "No job_id provided.", label: "sessions_cancel: no ID" };
    }

    try {
      const [job] = await db
        .select()
        .from(schema.agentJobs)
        .where(and(eq(schema.agentJobs.id, jobId), eq(schema.agentJobs.userId, ctx.userId)))
        .limit(1);

      if (!job) {
        return {
          ok: false,
          content: `No job found with ID "${jobId}" for this user.`,
          label: "sessions_cancel: not found",
        };
      }

      if (job.status === "complete" || job.status === "failed") {
        return {
          ok: true,
          content: `Job "${job.title}" already finished with status "${job.status}" — nothing to cancel.`,
          label: "sessions_cancel: already finished",
        };
      }

      if (job.status === "cancelled" || job.status === "cancelling") {
        return {
          ok: true,
          content: `Job "${job.title}" is already being cancelled (status: ${job.status}).`,
          label: "sessions_cancel: already cancelling",
        };
      }

      const newStatus = job.status === "queued" ? "cancelled" : "cancelling";
      await db
        .update(schema.agentJobs)
        .set({
          status: newStatus,
          completedAt: newStatus === "cancelled" ? new Date() : undefined,
        })
        .where(eq(schema.agentJobs.id, jobId));

      const msg =
        newStatus === "cancelled"
          ? `Job "${job.title}" cancelled immediately — it was still queued and never started.`
          : `Job "${job.title}" marked for cancellation. It will stop at the next checkpoint (usually within seconds).`;

      console.log(
        `[${ctx.channel || "Agent"}] sessions_cancel job=${jobId} "${job.title}" → ${newStatus}`
      );

      return { ok: true, content: msg, label: `sessions_cancel: ${newStatus}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `sessions_cancel failed: ${msg}`, label: "sessions_cancel error" };
    }
  },
};

function formatAge(date: Date | null): string {
  if (!date) return "unknown";
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 2) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatDate(date: Date | null): string {
  if (!date) return "unknown";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
