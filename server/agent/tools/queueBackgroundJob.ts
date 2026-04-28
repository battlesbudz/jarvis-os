import type { AgentTool } from "../types";
import { submitAgentJob, type AgentJobType, getModelForJobType } from "../jobQueue";
import { SUB_AGENT_TYPES, type SubAgentType } from "../subagents";
import { db } from "../../db";
import { eq, and, gte, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";

interface QueueJobArgs {
  agent_type?: string;
  prompt?: string;
  title?: string;
}

/**
 * queue_background_job — the primary tool for the coach agent to hand off
 * multi-step or time-consuming requests to a background sub-agent so the
 * user gets an immediate acknowledgement instead of waiting.
 *
 * Compared to spawn_subagent this tool:
 *  - Has a title field with a sensible default derived from the prompt
 *  - Emphasises the "detect and delegate" use case in its description
 *  - Guards against duplicate jobs for the same topic within a 10-minute window
 */
export const queueBackgroundJobTool: AgentTool = {
  name: "queue_background_job",
  description: `Queue a background sub-agent to handle tasks that require multiple steps, deep research, document drafting, structured planning, or composing emails — anything that takes longer than a quick lookup. Use this whenever the user's request would take more than 10-15 seconds to answer inline. The user receives an immediate acknowledgement ("I've queued that — you'll get a notification when it's done") and sees the result in their Inbox when complete.

IMPORTANT — one job per user message: Do NOT call this tool more than once per user message. If you have multiple approaches to a topic, pick the best one and queue a single job. Queuing multiple jobs for the same user message results in the user receiving multiple notifications for what felt like one question. If the user asks to "try another approach", you may queue a second job.

Before calling this tool, use sessions_list (filter: status=queued or status=running) to check whether a recent job already exists for this topic and agent_type. If a matching job is already active, tell the user their request is already in progress rather than queuing a duplicate.

Choose agent_type based on the request:
- research: competitive analysis, market research, fact-finding briefs
- writing: drafting memos, notes, blog posts, documents, reports
- planning: phased project plans, goal breakdowns, action plans
- email: composing an outbound email on the user's behalf

Do NOT use for: quick one-sentence answers, reading today's tasks, anything answered by another tool, or any Discord server action (listing/deleting channels — use discord_list_channels and discord_delete_channel instead).`,
  parameters: {
    type: "object",
    properties: {
      agent_type: {
        type: "string",
        enum: SUB_AGENT_TYPES,
        description: "The type of sub-agent to run.",
      },
      prompt: {
        type: "string",
        description:
          "Complete instructions for the sub-agent. Include all context the sub-agent needs to work autonomously — the user is not in this conversation. For email type, name the recipient and purpose.",
      },
      title: {
        type: "string",
        description:
          "Short label for the Inbox card (≤80 chars). If omitted, a title will be derived from the prompt.",
      },
    },
    required: ["agent_type", "prompt"],
  },
  async execute(args, ctx) {
    const a = args as QueueJobArgs;
    const agentType = String(a.agent_type || "").trim() as SubAgentType;
    const prompt = String(a.prompt || "").trim();

    if (!SUB_AGENT_TYPES.includes(agentType as (typeof SUB_AGENT_TYPES)[number])) {
      return {
        ok: false,
        content: `Invalid agent_type "${agentType}". Must be one of: ${SUB_AGENT_TYPES.join(", ")}.`,
        label: "Invalid agent_type",
      };
    }
    if (!prompt) {
      return { ok: false, content: "prompt is required.", label: "Missing prompt" };
    }

    const title = String(a.title || "").trim() || deriveTitle(agentType, prompt);

    // ── Duplicate-job guard ─────────────────────────────────────────────────
    // Before queuing, check whether an active job with the same agent_type and
    // a similar title was recently created for this user. If so, skip the
    // duplicate to avoid flooding the user with multiple notifications.
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const activeJobs = await db
        .select({ id: schema.agentJobs.id, title: schema.agentJobs.title })
        .from(schema.agentJobs)
        .where(
          and(
            eq(schema.agentJobs.userId, ctx.userId),
            eq(schema.agentJobs.agentType, agentType),
            inArray(schema.agentJobs.status, ["queued", "running"]),
            gte(schema.agentJobs.createdAt, tenMinutesAgo),
          ),
        );

      if (activeJobs.length > 0) {
        const normalizedNew = normalizeTitle(title);
        const duplicate = activeJobs.find((j) => titlesAreSimilar(normalizeTitle(j.title), normalizedNew));
        if (duplicate) {
          console.log(
            `[${ctx.channel || "Coach"}] queue_background_job DUPLICATE SKIPPED type=${agentType} existing="${duplicate.title}" new="${title}"`,
          );
          return {
            // Return ok:true so the coach treats this as a successful no-op
            // rather than a tool failure that might trigger retry behaviour.
            ok: true,
            content: `A ${agentType} job for this topic is already running (id=${duplicate.id}, title="${duplicate.title}") — skipped creating a duplicate. The user will be notified when the existing job completes.`,
            label: `Duplicate ${agentType} job skipped`,
            detail: duplicate.id,
          };
        }
      }
    } catch (dupErr) {
      // Non-fatal: if the guard query fails, proceed with queueing normally.
      console.warn(`[queue_background_job] duplicate guard query failed:`, dupErr);
    }
    // ────────────────────────────────────────────────────────────────────────

    try {
      // Inject per-type model routing so the job queue uses the appropriate
      // GPT mini for each sub-agent workload (research/planning → gpt-4.1-mini,
      // writing/email → gpt-4o-mini).
      const routedModel = getModelForJobType(agentType as AgentJobType);
      const jobId = await submitAgentJob({
        userId: ctx.userId,
        agentType: agentType as AgentJobType,
        title,
        prompt,
        input: routedModel ? { model: routedModel } : undefined,
      });
      console.log(
        `[${ctx.channel || "Coach"}] queue_background_job type=${agentType} job=${jobId} title="${title.slice(0, 60)}"`,
      );
      return {
        ok: true,
        content: `Background job queued successfully (type=${agentType}, id=${jobId}). The user will receive an inbox notification when it finishes.`,
        label: `Queued ${agentType} job`,
        detail: jobId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[queue_background_job] submit failed:`, err);
      return {
        ok: false,
        content: `Failed to queue the job: ${msg}`,
        label: "Queue failed",
        detail: msg,
      };
    }
  },
};

function deriveTitle(agentType: SubAgentType, prompt: string): string {
  const prefixes: Record<SubAgentType, string> = {
    research: "Research:",
    writing: "Draft:",
    planning: "Plan:",
    email: "Email:",
  };
  const prefix = prefixes[agentType] || "Task:";
  const snippet = prompt.slice(0, 60).replace(/\s+/g, " ").trim();
  return `${prefix} ${snippet}${prompt.length > 60 ? "…" : ""}`;
}

/** Lowercase, strip punctuation, collapse whitespace for comparison. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Two titles are considered similar if:
 * 1. Their normalized forms are exactly equal, OR
 * 2. The first 25 normalized characters match (catches minor suffix differences), OR
 * 3. They share ≥60% word overlap (catches reordered or paraphrased titles).
 */
function titlesAreSimilar(a: string, b: string): boolean {
  // 1. Exact normalized match (handles short titles too).
  if (a === b) return true;

  // 2. Prefix check for longer titles.
  const prefixLen = 25;
  if (a.length >= prefixLen && b.length >= prefixLen && a.slice(0, prefixLen) === b.slice(0, prefixLen)) {
    return true;
  }

  // 3. Word overlap (ignores short stop-words ≤2 chars).
  const wordsA = new Set(a.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const similarity = overlap / Math.max(wordsA.size, wordsB.size);
  return similarity >= 0.6;
}
