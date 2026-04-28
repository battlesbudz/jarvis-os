import type { Capability } from "./types";
import { daemonActionTool } from "../agent/tools/daemon";
import { daemonShellTool, daemonStatusTool } from "../agent/tools/daemonShellTool";

export const daemonCapability: Capability = {
  id: "daemon",
  label: "Daemon",
  toolGroups: ["coaching", "system"],
  tools: [daemonActionTool, daemonShellTool, daemonStatusTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
