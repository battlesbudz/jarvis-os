import { getModelForJobType, type AgentJobType } from "../jobClient";
import type { ToolContext } from "../types";

export function buildQueueBackgroundJobInput(
  agentType: AgentJobType,
  ctx: Pick<ToolContext, "channel" | "originChannelId" | "discordChannelId">,
): Record<string, unknown> {
  const routedModel = getModelForJobType(agentType);
  const jobInput: Record<string, unknown> = routedModel ? { model: routedModel } : {};
  if (ctx.channel) jobInput.originChannel = ctx.channel;
  if (ctx.originChannelId) jobInput.originChannelId = ctx.originChannelId;
  if (ctx.discordChannelId) jobInput.originDiscordChannelId = ctx.discordChannelId;

  if (agentType === "ephemeral_agent_task") {
    jobInput.workerType = "goal_task";
    jobInput.ephemeralAgent = {
      kind: "task_worker",
      template: "task_worker",
      cleanupMode: "delete",
    };
  }

  return jobInput;
}
