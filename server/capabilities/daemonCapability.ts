import type { Capability } from "./types";
import { daemonActionTool } from "../agent/tools/daemon";
import { daemonShellTool, daemonStatusTool, androidScreenUnderstandTool, androidSearchInAppTool, androidTypeInFieldTool, androidTapElementTool, androidSwipeElementTool, androidPinchElementTool, androidTrainButtonTool, androidFindTrainedButtonTool, androidTypeIntoElementTool, androidLongPressElementTool, androidDragElementTool, androidFillFormTool, androidScrollToTopTool, androidSelectOptionTool } from "../agent/tools/daemonShellTool";

export const daemonCapability: Capability = {
  id: "daemon",
  label: "Daemon",
  toolGroups: ["coaching", "system"],
  tools: [daemonActionTool, daemonShellTool, daemonStatusTool, androidScreenUnderstandTool, androidSearchInAppTool, androidTypeInFieldTool, androidTapElementTool, androidSwipeElementTool, androidPinchElementTool, androidScrollToTopTool, androidTrainButtonTool, androidFindTrainedButtonTool, androidTypeIntoElementTool, androidLongPressElementTool, androidDragElementTool, androidFillFormTool, androidSelectOptionTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
