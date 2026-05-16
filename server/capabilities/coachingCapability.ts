import type { Capability } from "./types";
import { manageTasksTool } from "../agent/tools/manageTasks";
import { queueBackgroundJobTool } from "../agent/tools/queueBackgroundJob";
import { scheduleJarvisTaskTool } from "../agent/tools/scheduleJarvisTask";
import { startProjectTool } from "../agent/tools/startProject";

export const coachingCapability: Capability = {
  id: "coaching",
  label: "Coaching",
  toolGroups: ["coaching"],
  toolGroupOverrides: {
    schedule_jarvis_task: ["coaching", "scheduling"],
  },
  tools: [manageTasksTool, queueBackgroundJobTool, scheduleJarvisTaskTool, startProjectTool],
  configRequirements: [],
  async healthCheck() {
    return { healthy: true };
  },
};
