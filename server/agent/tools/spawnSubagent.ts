import type { AgentTool } from "../types";
import { submitAgentJob, type AgentJobType, getModelForJobType } from "../jobQueue";
import { SUB_AGENT_TYPES } from "../subagents";
import { findDuplicateJob } from "./jobDuplicateGuard";

interface SpawnArgs {
  agent_type?: string;
  title?: string;
  prompt?: string;
}

export const spawnSubagentTool: AgentTool = {
  name: "spawn_subagent",
  description:
    "Spawn a background sub-agent that works while the user is away. Use this for tasks that take real time and produce a deliverable the user can review later — research briefs, longer documents, structured plans, or email drafts. The job runs asynchronously; the user will see the result in their Inbox under Deliverables. Do NOT use this for quick lookups (use search_web), for editing today's plan (use manage_tasks), or for things that need an immediate answer.",
  parameters: {
    type: "object",
    properties: {
      agent_type: {
        type: "string",
        enum: SUB_AGENT_TYPES,
        description:
          "research = web research brief; writing = longer document/note/memo; planning = phased action plan for a project; email = draft a single outbound email reply.",
      },
      title: {
        type: "string",
        description: "Short label shown in the user's Inbox (≤80 chars).",
      },
      prompt: {
        type: "string",
        description:
          "The full instruction for the sub-agent. Include enough context that it can work without asking follow-up questions — the user is not in this conversation. For email type, name the recipient and what the email is about.",
      },
    },
    required: ["agent_type", "title", "prompt"],
  },
  async execute(args, ctx) {
    const a = args as SpawnArgs;
    const agentType = String(a.agent_type || "");
    const title = String(a.title || "").trim();
    const prompt = String(a.prompt || "").trim();

    if (!SUB_AGENT_TYPES.includes(agentType as (typeof SUB_AGENT_TYPES)[number])) {
      return {
        ok: false,
        content: `Invalid agent_type "${agentType}". Use one of: ${SUB_AGENT_TYPES.join(", ")}.`,
        label: "Bad agent_type",
      };
    }
    if (!title) return { ok: false, content: "title is required.", label: "Missing title" };
    if (!prompt) return { ok: false, content: "prompt is required.", label: "Missing prompt" };

    // ── Duplicate-job guard ─────────────────────────────────────────────────
    try {
      const duplicate = await findDuplicateJob(ctx.userId, agentType, title);
      if (duplicate) {
        console.log(
          `[${ctx.channel || "Agent"}] spawn_subagent DUPLICATE SKIPPED type=${agentType} existing="${duplicate.title}" new="${title}"`,
        );
        return {
          ok: true,
          content: `A ${agentType} job for this topic is already running (id=${duplicate.id}, title="${duplicate.title}") — skipped creating a duplicate. The user will be notified when the existing job completes.`,
          label: `Duplicate ${agentType} job skipped`,
          detail: duplicate.id,
        };
      }
    } catch (dupErr) {
      // Non-fatal: if the guard query fails, proceed with queueing normally.
      console.warn(`[spawn_subagent] duplicate guard query failed:`, dupErr);
    }
    // ────────────────────────────────────────────────────────────────────────

    try {
      // Inject per-type model routing at the orchestrator spawn point.
      const routedModel = getModelForJobType(agentType as AgentJobType);
      const spawnInput: Record<string, unknown> = routedModel ? { model: routedModel } : {};
      if (ctx.channel) spawnInput.originChannel = ctx.channel;
      if (ctx.discordChannelId) spawnInput.originDiscordChannelId = ctx.discordChannelId;
      const jobId = await submitAgentJob({
        userId: ctx.userId,
        agentType: agentType as AgentJobType,
        title,
        prompt,
        input: spawnInput,
      });
      console.log(`[${ctx.channel || "Agent"}] spawn_subagent type=${agentType} job=${jobId} title="${title.slice(0, 60)}"`);
      return {
        ok: true,
        content: `Queued a ${agentType} sub-agent (job ${jobId}). It will run in the background and the result will appear in the user's Inbox under Deliverables.`,
        label: `Spawned ${agentType} sub-agent`,
        detail: jobId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Failed to queue sub-agent: ${msg}`, label: "Queue failed", detail: msg };
    }
  },
};
