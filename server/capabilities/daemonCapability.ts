import type { Capability } from "./types";
import { daemonActionTool } from "../agent/tools/daemon";
import { daemonShellTool, daemonStatusTool, androidScreenUnderstandTool, androidSearchInAppTool, androidTypeInFieldTool, androidTapElementTool, androidSwipeElementTool, androidPinchElementTool, androidPinchCoordinatesTool, androidTrainButtonTool, androidFindTrainedButtonTool, androidTypeIntoElementTool, androidLongPressElementTool, androidDragElementTool, androidDragCoordinatesTool, androidFillFormTool, androidScrollToTopTool, androidSelectOptionTool } from "../agent/tools/daemonShellTool";

export const daemonCapability: Capability = {
  id: "daemon",
  label: "Daemon",
  toolGroups: ["coaching", "system"],
  tools: [daemonActionTool, daemonShellTool, daemonStatusTool, androidScreenUnderstandTool, androidSearchInAppTool, androidTypeInFieldTool, androidTapElementTool, androidSwipeElementTool, androidPinchElementTool, androidPinchCoordinatesTool, androidScrollToTopTool, androidTrainButtonTool, androidFindTrainedButtonTool, androidTypeIntoElementTool, androidLongPressElementTool, androidDragElementTool, androidDragCoordinatesTool, androidFillFormTool, androidSelectOptionTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
