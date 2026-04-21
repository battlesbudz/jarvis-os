import type { AgentTool } from "../types";
import { gmailModifyMessage } from "../../integrations/gmail";

const ACTION_MAP: Record<string, { add: string[]; remove: string[] }> = {
  star: { add: ["STARRED"], remove: [] },
  unstar: { add: [], remove: ["STARRED"] },
  archive: { add: [], remove: ["INBOX"] },
  mark_read: { add: [], remove: ["UNREAD"] },
  mark_unread: { add: ["UNREAD"], remove: [] },
  spam: { add: ["SPAM"], remove: ["INBOX"] },
  trash: { add: ["TRASH"], remove: ["INBOX"] },
};

export const gmailActionTool: AgentTool = {
  name: "gmail_action",
  description:
    "Perform an action on a Gmail email shown in the system context. Use the message id from [id:...] in the email list. Valid actions: star, unstar, archive, mark_read, mark_unread, spam, trash.",
  parameters: {
    type: "object",
    properties: {
      message_id: { type: "string", description: "Gmail message ID from [id:...]" },
      action: {
        type: "string",
        enum: Object.keys(ACTION_MAP),
        description: "The action to perform",
      },
    },
    required: ["message_id", "action"],
  },
  async execute(args, ctx) {
    if (!ctx.googleAccessToken) {
      return {
        ok: false,
        content: "Gmail is not connected. Ask the user to connect their Google account first.",
        label: "Gmail not connected",
      };
    }

    const knownIds: string[] = ctx.state?.gmailMessageIds || [];
    if (knownIds.length > 0 && !knownIds.includes(args.message_id)) {
      return {
        ok: false,
        content: `Message ID "${args.message_id}" is not in the current email list. Use a valid id from [id:...] in the system context.`,
        label: "Unknown message id",
      };
    }

    const mapping = ACTION_MAP[args.action];
    if (!mapping) {
      return {
        ok: false,
        content: `Unknown action: ${args.action}`,
        label: "Unknown gmail action",
      };
    }

    try {
      await gmailModifyMessage(args.message_id, mapping.add, mapping.remove, ctx.googleAccessToken);
      return {
        ok: true,
        content: `Successfully performed "${args.action}" on the email.`,
        label: `Email ${args.action}`,
        detail: args.message_id,
      };
    } catch (err: any) {
      return {
        ok: false,
        content: `Gmail action failed: ${err?.message || err}`,
        label: "Gmail action failed",
        detail: String(err?.message || err),
      };
    }
  },
};
