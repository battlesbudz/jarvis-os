import type { Capability } from "./types";
import { cronCreateTool, cronListTool, cronDeleteTool, cronUpdateTool } from "../agent/tools/cronTools";
import {
  workflowCreateTool,
  workflowRunTool,
  workflowStatusTool,
  workflowPauseTool,
  workflowResumeTool,
  workflowListTool,
} from "../agent/tools/workflowTools";

export const schedulingCapability: Capability = {
  id: "scheduling",
  label: "Scheduling (Crons & Workflows)",
  toolGroups: ["scheduling"],
  tools: [
    cronCreateTool,
    cronListTool,
    cronDeleteTool,
    cronUpdateTool,
    workflowCreateTool,
    workflowRunTool,
    workflowStatusTool,
    workflowPauseTool,
    workflowResumeTool,
    workflowListTool,
  ],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
