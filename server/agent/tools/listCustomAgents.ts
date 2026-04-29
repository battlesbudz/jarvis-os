/**
 * list_custom_agents — coach tool to list and describe the user's custom sub-agents.
 * Allows the coach to be aware of user-defined agents and suggest or invoke them.
 */
import type { AgentTool, ToolContext } from "../types";
import { db } from "../../db";
import { customAgents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { submitAgentJob } from "../jobClient";

export const listCustomAgentsTool: AgentTool = {
  name: "list_custom_agents",
  description: `List the user's custom sub-agents — named, specialized agents they have created with a custom system prompt and a specific focus area (e.g. "Tech Research", "Weekly Report Writer").

Use this tool when:
- The user asks what custom agents they have
- The user says "use my X agent to do Y" — look up the slug here first
- A task sounds like it could benefit from one of their custom agents
- You want to tell the user about agents they've built

The tool returns each agent's name, slug, description, and base type. You can then queue a job for a custom agent by calling queue_background_job with agent_type="custom_agent" and including custom_agent_id in the extra context, OR tell the user to invoke it via /jarvis agent <slug> <prompt>.

If the user says "run my X agent", find the matching slug here, then queue a custom_agent job.`,
  parameters: {
    type: "object",
    properties: {
      run_slug: {
        type: "string",
        description: "Optional. If provided, also queue a background job for this custom agent slug. Requires run_prompt.",
      },
      run_prompt: {
        type: "string",
        description: "The prompt to send to the custom agent when run_slug is provided.",
      },
    },
    required: [],
  },
  execute: async (args: Record<string, unknown>, context: ToolContext) => {
    const { userId } = context;

    const agents = await db
      .select()
      .from(customAgents)
      .where(eq(customAgents.userId, userId))
      .orderBy(customAgents.createdAt);

    if (agents.length === 0) {
      return {
        agents: [],
        message: "You have no custom agents yet. You can create them from the app's Profile tab under 'Custom Agents'.",
      };
    }

    const runSlug = typeof args.run_slug === "string" ? args.run_slug.trim() : "";
    const runPrompt = typeof args.run_prompt === "string" ? args.run_prompt.trim() : "";

    let runResult: { jobId: string; agentName: string } | null = null;

    if (runSlug && runPrompt) {
      const agent = agents.find((a) => a.slug === runSlug || a.name.toLowerCase() === runSlug.toLowerCase());
      if (agent) {
        const jobId = await submitAgentJob({
          userId,
          agentType: "custom_agent",
          title: `${agent.name}: ${runPrompt.slice(0, 80)}`,
          prompt: runPrompt,
          input: {
            customAgentId: agent.id,
            customAgentSlug: agent.slug,
            customAgentName: agent.name,
            originChannel: context.channel ?? "coach",
          },
        });
        runResult = { jobId, agentName: agent.name };
      }
    }

    const agentList = agents.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      description: a.description,
      baseType: a.baseType,
      hasCustomPrompt: !!a.extraPrompt,
    }));

    return {
      agents: agentList,
      count: agents.length,
      ...(runResult
        ? { queued: runResult, message: `Queued job for "${runResult.agentName}" — you'll be notified when it's done.` }
        : {}),
    };
  },
};
