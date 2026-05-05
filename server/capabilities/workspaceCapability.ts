import type { Capability } from "./types";
import { workspaceUpdateTool } from "../agent/tools/workspaceUpdateTool";
import { livingContextUpdateTool } from "../agent/tools/livingContextUpdateTool";

export const workspaceCapability: Capability = {
  id: "workspace",
  label: "Workspace File System (SOUL / AGENTS / MEMORY / living context)",
  toolGroups: ["system"],
  tools: [workspaceUpdateTool, livingContextUpdateTool],
  toolGroupOverrides: {
    [livingContextUpdateTool.name]: ["memory", "system"],
  },
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
