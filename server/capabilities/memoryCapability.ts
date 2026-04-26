import type { Capability } from "./types";
import { memorySearchTool, memoryGetTool } from "../agent/tools/memorySearch";

export const memoryCapability: Capability = {
  id: "memory",
  label: "Memory",
  toolGroups: ["memory"],
  tools: [memorySearchTool, memoryGetTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
