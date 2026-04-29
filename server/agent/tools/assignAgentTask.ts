/**
 * assign_agent_task — directs the orchestrator to hand a specific task
 * to a named sub-agent and track it through to completion.
 *
 * The job is inserted into the agent_jobs queue with agentType="named_agent_task"
 * and processed by the job queue worker, which runs the named agent's full
 * harness (persona + memory + tools) against the task prompt.
 *
 * When complete, the orchestrator can review the output with review_agent_task.
 */
import type { AgentTool } from "../types";
import { submitAgentJob } from "../jobQueue";
import { getAgent } from "../agentManager";

interface AssignAgentTaskArgs {
  agent_id: string;
  task: string;
  context?: string;
  title?: string;
}

export const assignAgentTaskTool: AgentTool = {
  name: "assign_agent_task",
  description:
    "Assign a specific task to a named sub-agent you previously created with setup_named_agent. " +
    "The agent runs the task autonomously using its persona, memory, and tools, then reports back. " +
    "You will receive the output in the Inbox and can then approve it or request a revision with review_agent_task. " +
    "Use this to delegate focused work: research, drafting, analysis, Discord channel operations, etc. " +
    "The agent works in the background — the user gets an immediate acknowledgement.",
  parameters: {
    type: "object",
    properties: {
      agent_id: {
        type: "string",
        description: "The ID of the named agent to run the task (returned by setup_named_agent).",
      },
      task: {
        type: "string",
        description:
          "Complete task instructions for the agent. Include all context needed — the agent has no memory of your current conversation. Be specific about what you expect as output.",
      },
      context: {
        type: "string",
        description:
          "Optional additional background context (prior research, user preferences, constraints). Injected before the task prompt.",
      },
      title: {
        type: "string",
        description: "Short label shown in the Inbox card (≤80 chars). Defaults to the first 60 chars of the task.",
      },
    },
    required: ["agent_id", "task"],
  },
  async execute(args, ctx) {
    const agentId = String(args.agent_id ?? "").trim();
    const task = String(args.task ?? "").trim();

    if (!agentId) return { ok: false, content: "agent_id is required.", label: "Missing agent_id" };
    if (!task) return { ok: false, content: "task is required.", label: "Missing task" };

    // Validate the agent exists and belongs to this user
    const agent = await getAgent(agentId);
    if (!agent) return { ok: false, content: `Agent ${agentId} not found.`, label: "Agent not found" };
    if (agent.userId !== ctx.userId) return { ok: false, content: "Agent does not belong to you.", label: "Permission denied" };
    if (!agent.isActive) return { ok: false, content: `Agent ${agent.name} is disabled. Enable it first.`, label: "Agent disabled" };

    const prompt = args.context
      ? `## Context\n${String(args.context).trim()}\n\n## Task\n${task}`
      : task;

    const title = String(args.title ?? "").trim() || `${agent.name}: ${task.slice(0, 60)}${task.length > 60 ? "…" : ""}`;

    const { id: jobId } = await submitAgentJob({
      userId: ctx.userId,
      agentType: "named_agent_task",
      title,
      prompt,
      input: {
        namedAgentId: agentId,
        agentName: agent.name,
        iterationCount: 0,
      },
    });

    console.log(`[assign_agent_task] agent=${agent.name}(${agentId}) job=${jobId} title="${title.slice(0, 60)}"`);

    return {
      ok: true,
      content:
        `Task assigned to **${agent.name}** (job ID: \`${jobId}\`). ` +
        `The agent is now working on it. You'll get an Inbox notification when done — ` +
        `then use \`review_agent_task\` with job_id="${jobId}" to approve or request changes.`,
      label: `Task → ${agent.name}`,
      detail: jobId,
    };
  },
};
