import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { sendGmailEmail } from "../../integrations/gmail";
import { sendOutlookEmail } from "../../integrations/outlook";
import { getValidGoogleToken, getValidMicrosoftToken } from "../../userTokenStore";

interface SendEmailArgs {
  to?: string;
  subject?: string;
  body?: string;
  provider?: string;
}

export const sendEmailTool: AgentTool = {
  name: "send_email",
  description: "Send an email immediately via Gmail or Outlook. Only use this when the user explicitly confirms they want to send (not just draft). Requires Google or Microsoft to be connected. provider defaults to 'google' if connected, otherwise 'microsoft'. If neither is connected, report the error.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body text (plain text)" },
      provider: { type: "string", enum: ["google", "microsoft"], description: "Which email provider to use: 'google' (Gmail) or 'microsoft' (Outlook). Defaults to 'google'." },
    },
    required: ["to", "subject", "body"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const a = args as SendEmailArgs;
    const to = String(a.to || "").trim();
    const subject = String(a.subject || "").trim();
    const body = String(a.body || "");
    const provider = (a.provider || "google").toLowerCase();

    if (!to || !subject || !body.trim()) {
      return { ok: false, content: "to, subject, and body are all required.", label: "Missing required fields" };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return { ok: false, content: `"${to}" doesn't look like a valid email address.`, label: "Invalid recipient" };
    }

    try {
      if (provider === "google") {
        const token = ctx.googleAccessToken || (await getValidGoogleToken(ctx.userId));
        if (!token) {
          return { ok: false, content: "Gmail is not connected. Ask the user to connect Google in Profile.", label: "Gmail not connected" };
        }
        const result = await sendGmailEmail(token, to, subject, body);
        console.log(`[${ctx.channel || "Agent"}] send_email via Gmail to=${to} subject="${subject.slice(0, 60)}" id=${result.messageId}`);
        return {
          ok: true,
          content: `Email sent via Gmail to ${to} with subject "${subject}".`,
          label: `Email sent to ${to}`,
          detail: result.messageId,
        };
      }

      if (provider === "microsoft") {
        const token = await getValidMicrosoftToken(ctx.userId);
        if (!token) {
          return { ok: false, content: "Outlook is not connected. Ask the user to connect Microsoft in Profile.", label: "Outlook not connected" };
        }
        await sendOutlookEmail(token, to, subject, body);
        console.log(`[${ctx.channel || "Agent"}] send_email via Outlook to=${to} subject="${subject.slice(0, 60)}"`);
        return {
          ok: true,
          content: `Email sent via Outlook to ${to} with subject "${subject}".`,
          label: `Email sent to ${to}`,
        };
      }

      return { ok: false, content: `Unknown provider "${provider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${ctx.channel || "Agent"}] send_email failed:`, msg);
      return { ok: false, content: `Email send failed: ${msg}`, label: "Email send failed", detail: msg };
    }
  },
};
