import type { Capability } from "./types";
import { assignAgentTaskTool } from "../agent/tools/assignAgentTask";
import { reviewAgentTaskTool } from "../agent/tools/reviewAgentTask";

export const agentDelegationCapability: Capability = {
  id: "agent_delegation",
  label: "Agent Delegation",
  toolGroups: ["system"],
  tools: [assignAgentTaskTool, reviewAgentTaskTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
