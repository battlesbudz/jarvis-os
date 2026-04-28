import type { Capability } from "./types";
import { workspaceUpdateTool } from "../agent/tools/workspaceUpdateTool";

export const workspaceCapability: Capability = {
  id: "workspace",
  label: "Workspace File System (SOUL / AGENTS / MEMORY)",
  toolGroups: ["system"],
  tools: [workspaceUpdateTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
