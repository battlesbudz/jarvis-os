import type { Capability } from "./types";
import { listSourceFilesTool, readSourceFileTool, proposeCodeChangeTool } from "../agent/tools/selfEditTools";

export const selfEditCapability: Capability = {
  id: "self_edit",
  label: "Self-Inspection & Code Proposals",
  toolGroups: ["self_edit"],
  tools: [listSourceFilesTool, readSourceFileTool, proposeCodeChangeTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
