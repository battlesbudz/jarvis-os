import type { Capability } from "./types";
import {
  listSourceFilesTool,
  readSourceFileTool,
  proposeCodeChangeTool,
  readRecentErrorsTool,
} from "../agent/tools/selfEditTools";
import { applyCodeChangeTool } from "../agent/tools/applyCodeChangeTool";
import { runShellTool } from "../agent/tools/runShellTool";
import { selfHealTool } from "../agent/tools/selfHealTool";

export const selfEditCapability: Capability = {
  id: "self_edit",
  label: "Self-Inspection, Code Proposals & Autonomous Self-Heal",
  toolGroups: ["self_edit"],
  tools: [
    listSourceFilesTool,
    readSourceFileTool,
    readRecentErrorsTool,
    proposeCodeChangeTool,
    applyCodeChangeTool,
    runShellTool,
    selfHealTool,
  ],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
