import type { Capability } from "./types";
import { manageTasksTool } from "../agent/tools/manageTasks";
import { queueBackgroundJobTool } from "../agent/tools/queueBackgroundJob";
import { scheduleJarvisTaskTool } from "../agent/tools/scheduleJarvisTask";

export const coachingCapability: Capability = {
  id: "coaching",
  label: "Coaching",
  toolGroups: ["coaching"],
  tools: [manageTasksTool, queueBackgroundJobTool, scheduleJarvisTaskTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
