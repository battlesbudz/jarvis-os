/**
 * Approval Action Executor — Phase 3C
 * Handles the actions triggered when a Discord message is approved/rejected.
 */

import { runCoachAgent } from "../channels/coachAgent";
import { postToDiscordChannel } from "./manager";
import { runSchedule } from "./schedules";
import { submitAgentJob } from "../agent/jobQueue";

export interface ApprovalAction {
  type: "run_prompt" | "run_schedule" | "spawn_subagent" | "notify_only";
  prompt?: string;
  scheduleId?: string;
  agentType?: string;
  title?: string;
  channelId?: string;
  channelName?: string;
}

export async function executeApprovalAction(
  userId: string,
  action: ApprovalAction,
  content: string,
  channelId: string,
): Promise<void> {
  switch (action.type) {
    case "run_prompt": {
      const prompt = (action.prompt || "").replace(/\{\{content\}\}/g, content);
      if (!prompt) return;

      console.log(`[ApprovalActions] Running prompt for user ${userId}`);
      let result = "";
      try {
        const agentResult = await runCoachAgent({
          userId,
          userText: prompt,
          channelName: "Discord Approval",
        });
        result = agentResult.reply || "";
      } catch (err) {
        console.error("[ApprovalActions] runCoachAgent failed:", err);
        result = `⚠️ Action failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      if (result) {
        const targetChannelName = action.channelName || null;
        await postToDiscordChannel(userId, targetChannelName || "", channelId, result);
      }
      break;
    }

    case "run_schedule": {
      if (!action.scheduleId) return;
      await runSchedule(action.scheduleId);
      break;
    }

    case "spawn_subagent": {
      const prompt = (action.prompt || "").replace(/\{\{content\}\}/g, content);
      if (!prompt) return;
      await submitAgentJob({
        userId,
        agentType: (action.agentType as any) || "research",
        title: action.title || "Discord approval task",
        prompt,
      });
      break;
    }

    case "notify_only":
    default:
      break;
  }
}
