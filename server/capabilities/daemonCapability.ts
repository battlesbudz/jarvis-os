import type { Capability } from "./types";
import { daemonActionTool } from "../agent/tools/daemon";
import { daemonShellTool, daemonStatusTool, androidScreenUnderstandTool, androidSearchInAppTool, androidTypeInFieldTool, androidTapElementTool, androidSwipeElementTool, androidTrainButtonTool, androidFindTrainedButtonTool, androidTypeIntoElementTool, androidLongPressElementTool } from "../agent/tools/daemonShellTool";

export const daemonCapability: Capability = {
  id: "daemon",
  label: "Daemon",
  toolGroups: ["coaching", "system"],
  tools: [daemonActionTool, daemonShellTool, daemonStatusTool, androidScreenUnderstandTool, androidSearchInAppTool, androidTypeInFieldTool, androidTapElementTool, androidSwipeElementTool, androidTrainButtonTool, androidFindTrainedButtonTool, androidTypeIntoElementTool, androidLongPressElementTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
