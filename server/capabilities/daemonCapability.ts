import type { Capability } from "./types";
import { daemonActionTool } from "../agent/tools/daemon";

export const daemonCapability: Capability = {
  id: "daemon",
  label: "Daemon",
  toolGroups: ["coaching", "system"],
  tools: [daemonActionTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
