import type { AgentTool } from "../types";
import { db } from "../../db";
import { discordPendingApprovals } from "@shared/schema";

export const registerApprovalTool: AgentTool = {
  name: "register_approval",
  description:
    "Register a Discord message as requiring user approval via emoji reaction (✅ or ❌). " +
    "Use this AFTER posting a script, plan, draft, or other item to Discord that needs the user's sign-off. " +
    "When the user reacts with ✅, the onApprove action fires automatically; ❌ fires onReject. " +
    "The onApprove/onReject actions define what happens next: run_prompt, run_schedule, spawn_subagent, or notify_only.",
  parameters: {
    type: "object",
    properties: {
      messageId: {
        type: "string",
        description: "The Discord message ID of the posted item awaiting approval.",
      },
      channelId: {
        type: "string",
        description: "The Discord channel ID where the message was posted.",
      },
      guildId: {
        type: "string",
        description: "Optional: the Discord guild/server ID.",
      },
      type: {
        type: "string",
        enum: ["script", "task", "plan", "custom"],
        description: "The type of item awaiting approval.",
      },
      content: {
        type: "string",
        description: "The text content of the posted item (used as context for the approval action).",
      },
      onApprove: {
        type: "object",
        description: "Action to execute when the user reacts with ✅. Types: run_prompt, run_schedule, spawn_subagent, notify_only.",
        properties: {
          type: { type: "string" },
          prompt: { type: "string" },
          scheduleId: { type: "string" },
          agentType: { type: "string" },
          title: { type: "string" },
        },
      },
      onReject: {
        type: "object",
        description: "Optional: action to execute when the user reacts with ❌.",
        properties: {
          type: { type: "string" },
          prompt: { type: "string" },
        },
      },
    },
    required: ["messageId", "channelId", "type", "content", "onApprove"],
  },
  async execute(args: {
    messageId: string;
    channelId: string;
    guildId?: string;
    type: string;
    content: string;
    onApprove: Record<string, unknown>;
    onReject?: Record<string, unknown>;
  }, ctx) {
    const { userId } = ctx;

    try {
      await db.insert(discordPendingApprovals).values({
        messageId: args.messageId,
        userId,
        channelId: args.channelId,
        guildId: args.guildId,
        type: args.type,
        content: args.content,
        onApprove: args.onApprove,
        onReject: args.onReject ?? null,
        status: "pending",
      }).onConflictDoNothing();

      return {
        ok: true,
        content: `Approval registered for message ${args.messageId}. The user can react with ✅ to approve or ❌ to skip.`,
        label: "Approval registered",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Failed to register approval: ${msg}`, label: "Approval registration failed" };
    }
  },
};
