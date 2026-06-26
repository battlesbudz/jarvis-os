import type { AgentTool } from "../types";
import { proposeSoulEdit } from "../../memory/soul";

export const soulEditProposeTool: AgentTool = {
  name: "soul_edit_propose",
  description:
    "Propose a high-authority Soul change when the user corrects identity-critical permanent information about themselves or JARVIS. This never applies the edit directly; it queues the change for user approval in the Soul editor.",
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        enum: ["content", "manual_override"],
        description: "Which Soul field should change. Use content for canonical Soul facts; manual_override for user-pinned notes.",
      },
      new_value: {
        type: "string",
        description: "The full proposed replacement text for the selected Soul field.",
      },
      reason: {
        type: "string",
        description: "Short reason for why this Soul change was proposed.",
      },
    },
    required: ["target", "new_value"],
  },
  async execute(args, ctx) {
    const target = String(args.target ?? "");
    const newValue = String(args.new_value ?? "").trim();
    if (!newValue) {
      return {
        ok: false,
        content: "Soul change proposal requires new_value.",
        label: "Soul edit proposal failed",
      };
    }

    try {
      const proposal = await proposeSoulEdit({
        userId: ctx.userId,
        target,
        newValue,
        source: "chat",
        sourceRef: ctx.channel ?? null,
        requestedBy: ctx.userId,
        reason: typeof args.reason === "string" ? args.reason : null,
      });
      return {
        ok: true,
        content: "Soul change queued for approval in the Soul editor. It has not been applied yet.",
        label: "Soul edit queued for approval",
        metadata: { proposalId: proposal.id, target: proposal.target, status: proposal.status },
      };
    } catch (error) {
      return {
        ok: false,
        content: error instanceof Error ? error.message : "Failed to queue Soul change proposal.",
        label: "Soul edit proposal failed",
      };
    }
  },
};
