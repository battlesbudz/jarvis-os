import type { AgentTool } from "../types";
import { gmailModifyMessage, createGmailDraft } from "../../integrations/gmail";

const ACTION_MAP: Record<string, { add: string[]; remove: string[] }> = {
  star: { add: ["STARRED"], remove: [] },
  unstar: { add: [], remove: ["STARRED"] },
  archive: { add: [], remove: ["INBOX"] },
  mark_read: { add: [], remove: ["UNREAD"] },
  mark_unread: { add: ["UNREAD"], remove: [] },
  spam: { add: ["SPAM"], remove: ["INBOX"] },
  trash: { add: ["TRASH"], remove: ["INBOX"] },
};

const ACTIONS = Object.keys(ACTION_MAP) as Array<keyof typeof ACTION_MAP>;

interface GmailActionArgs {
  message_id?: string;
  action?: string;
}

export const gmailActionTool: AgentTool = {
  name: "gmail_action",
  description:
    "Perform a label/state action on a Gmail email shown in the system context. Use the message id from [id:...] in the email list. Valid actions: star, unstar, archive, mark_read, mark_unread, spam, trash. Use create_gmail_draft for composing replies.",
  parameters: {
    type: "object",
    properties: {
      message_id: { type: "string", description: "Gmail message ID from [id:...]" },
      action: {
        type: "string",
        enum: ACTIONS,
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

    const a = args as GmailActionArgs;
    const messageId = String(a.message_id || "");
    const action = String(a.action || "");
    if (!messageId || !action) {
      return { ok: false, content: "message_id and action are required.", label: "Missing args" };
    }

    const knownIds = ctx.state?.gmailMessageIds || [];
    if (knownIds.length > 0 && !knownIds.includes(messageId)) {
      return {
        ok: false,
        content: `Message ID "${messageId}" is not in the current email list. Use a valid id from [id:...] in the system context.`,
        label: "Unknown message id",
      };
    }

    const mapping = ACTION_MAP[action];
    if (!mapping) {
      return { ok: false, content: `Unknown action: ${action}`, label: "Unknown gmail action" };
    }

    try {
      await gmailModifyMessage(messageId, mapping.add, mapping.remove, ctx.googleAccessToken);
      return {
        ok: true,
        content: `Successfully performed "${action}" on the email.`,
        label: `Email ${action}`,
        detail: messageId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Gmail action failed: ${msg}`, label: "Gmail action failed", detail: msg };
    }
  },
};

interface GmailDraftArgs {
  to?: string;
  subject?: string;
  body?: string;
}

export const gmailDraftTool: AgentTool = {
  name: "create_gmail_draft",
  description:
    "Create a Gmail draft (does NOT send it). Use this when the user asks to draft, reply to, or compose an email. The user can review and send it from Gmail. Returns the draft URL.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address (one address)" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body (plain text, line breaks preserved)" },
    },
    required: ["to", "subject", "body"],
  },
  async execute(args, ctx) {
    if (!ctx.googleAccessToken) {
      return {
        ok: false,
        content: "Gmail is not connected. Ask the user to connect their Google account first.",
        label: "Gmail not connected",
      };
    }
    const a = args as GmailDraftArgs;
    const to = String(a.to || "").trim();
    const subject = String(a.subject || "").trim();
    const body = String(a.body || "");
    if (!to || !subject || !body.trim()) {
      return { ok: false, content: "to, subject, and body are all required.", label: "Missing draft fields" };
    }
    try {
      const draft = await createGmailDraft(ctx.googleAccessToken, to, subject, body);
      console.log(`[${ctx.channel || "Agent"}] create_gmail_draft to=${to} subject="${subject.slice(0, 60)}" id=${draft.draftId}`);
      return {
        ok: true,
        content: `Drafted email to ${to} (subject: "${subject}"). Review/send: ${draft.gmailUrl}`,
        label: `Drafted email to ${to}`,
        detail: draft.gmailUrl,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Draft creation failed: ${msg}`, label: "Draft failed", detail: msg };
    }
  },
};
