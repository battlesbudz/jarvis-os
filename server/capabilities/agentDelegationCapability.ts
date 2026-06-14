import type { Capability } from "./types";
import { assignAgentTaskTool } from "../agent/tools/assignAgentTask";
import { reviewAgentTaskTool } from "../agent/tools/reviewAgentTask";
import { delegateToCodexTool } from "../agent/tools/delegateToCodex";

export const agentDelegationCapability: Capability = {
  id: "agent_delegation",
  label: "Agent Delegation",
  toolGroups: ["system"],
  tools: [assignAgentTaskTool, reviewAgentTaskTool, delegateToCodexTool],
  toolGroupOverrides: {
    delegate_to_codex: ["system", "mcp"],
  },
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
