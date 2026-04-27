import type { Capability } from "./types";
import { codeExecutionTool } from "../agent/tools/codeExecution";

export const codeCapability: Capability = {
  id: "compute",
  label: "Python Code Execution",
  toolGroups: ["compute"],
  tools: [codeExecutionTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
