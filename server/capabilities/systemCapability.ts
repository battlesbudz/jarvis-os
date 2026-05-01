import type { Capability } from "./types";
import { spawnSubagentTool } from "../agent/tools/spawnSubagent";
import { sessionsListTool, sessionsHistoryTool, sessionsSendTool } from "../agent/tools/sessionTools";
import { buildFeatureTool, testToolTool } from "../agent/tools/buildFeatureTool";
import { registerApprovalTool } from "../agent/tools/registerApproval";
import { selfDiagnoseTool } from "../agent/tools/selfDiagnoseTool";
import { getCapabilityGapsTool } from "../agent/tools/getCapabilityGaps";
import { runGapAnalysisTool } from "../agent/tools/runGapAnalysisTool";

export const systemCapability: Capability = {
  id: "system",
  label: "System & Sub-Agents",
  toolGroups: ["system"],
  tools: [spawnSubagentTool, sessionsListTool, sessionsHistoryTool, sessionsSendTool, buildFeatureTool, testToolTool, registerApprovalTool, selfDiagnoseTool, getCapabilityGapsTool, runGapAnalysisTool],
  /**
   * run_capability_gap_analysis is placed in coaching + scheduling groups so it is
   * available on every major conversational channel (Telegram, Discord, Slack,
   * WhatsApp, daemon, webchat, in-app) in addition to the system group.
   * The other system tools stay scoped to "system" only.
   */
  toolGroupOverrides: {
    run_capability_gap_analysis: ["system", "coaching", "scheduling"],
  },
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
