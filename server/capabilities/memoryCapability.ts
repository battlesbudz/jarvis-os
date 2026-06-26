import type { Capability } from "./types";
import { memorySearchTool, memoryGetTool, memorySaveTool } from "../agent/tools/memorySearch";
import { soulEditProposeTool } from "../agent/tools/soulEdit";

export const memoryCapability: Capability = {
  id: "memory",
  label: "Memory",
  toolGroups: ["memory"],
  tools: [memorySearchTool, memoryGetTool, memorySaveTool, soulEditProposeTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
