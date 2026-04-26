import type { Capability } from "./types";
import {
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserExtractTool,
  browserCloseTool,
  browserSnapshotTool,
  browserWaitForTool,
  browserSelectTool,
  browserTabsTool,
  browserClearSessionTool,
} from "../agent/tools/browserTools";

export const browserCapability: Capability = {
  id: "browser",
  label: "Headless Browser",
  toolGroups: ["browser"],
  tools: [
    browserNavigateTool,
    browserClickTool,
    browserTypeTool,
    browserScreenshotTool,
    browserExtractTool,
    browserCloseTool,
    browserSnapshotTool,
    browserWaitForTool,
    browserSelectTool,
    browserTabsTool,
    browserClearSessionTool,
  ],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
