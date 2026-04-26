import type { Capability } from "./types";
import { spawnSubagentTool } from "../agent/tools/spawnSubagent";
import { sessionsListTool, sessionsHistoryTool, sessionsSendTool } from "../agent/tools/sessionTools";
import { buildFeatureTool, testToolTool } from "../agent/tools/buildFeatureTool";
import { registerApprovalTool } from "../agent/tools/registerApproval";
import { selfDiagnoseTool } from "../agent/tools/selfDiagnoseTool";

export const systemCapability: Capability = {
  id: "system",
  label: "System & Sub-Agents",
  toolGroups: ["system"],
  tools: [spawnSubagentTool, sessionsListTool, sessionsHistoryTool, sessionsSendTool, buildFeatureTool, testToolTool, registerApprovalTool, selfDiagnoseTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
