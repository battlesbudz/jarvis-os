import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { getValidGoogleToken, getValidMicrosoftToken } from "../../userTokenStore";
import { getRecentEmailCommitments } from "../../integrations/gmail";
import { getRecentOutlookEmails } from "../../integrations/outlook";
import { processLivingContextUpdate } from "../../workspace/livingContextRouter";

function updateLivingContextFromEmails(userId: string, provider: string, emails: any[]): void {
  for (const email of emails) {
    const text = [
      email.subject ? `Subject: ${email.subject}` : "",
      email.from ? `From: ${email.from}` : "",
      email.snippet ?? "",
    ].filter(Boolean).join("\n");
    if (!text.trim()) continue;
    processLivingContextUpdate({
      userId,
      text,
      sourceType: "email",
      sourceRef: `${provider}: ${email.subject || "no subject"}`,
    }).catch((err) => console.error(`[LivingContext/${provider}_email] update failed:`, err));
  }
}

export const fetchEmailsTool: AgentTool = {
  name: "fetch_emails",
  description: "Fetch recent emails on demand from Gmail or Outlook. Use when the user asks about their inbox beyond what's already available in context. provider: 'google' (Gmail) or 'microsoft' (Outlook). count: number of emails to fetch (default 10, max 25).",
  parameters: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: ["google", "microsoft"],
        description: "Email provider: 'google' for Gmail, 'microsoft' for Outlook",
      },
      count: {
        type: "number",
        description: "Number of emails to fetch (max 25, default 10)",
      },
    },
    required: ["provider"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const provider = String(args.provider || "google").toLowerCase();
    const count = Math.min(Number(args.count) || 10, 25);

    try {
      if (provider === "google") {
        const token = await getValidGoogleToken(ctx.userId);
        if (!token) {
          return {
            ok: false,
            content: "Gmail is not connected or the token has expired. Tell the user to reconnect Google in Settings > Connections before Jarvis can check Gmail.",
            label: "Gmail not connected",
          };
        }
        const emails = await getRecentEmailCommitments(14, token);
        const recent = emails.slice(0, count);
        if (recent.length === 0) {
          return { ok: true, content: "No emails found in the last 14 days.", label: "Inbox empty" };
        }
        updateLivingContextFromEmails(ctx.userId, "gmail", recent);
        const lines = recent.map((e: any) =>
          `- From: ${e.from || "unknown"} | Subject: "${e.subject}" — ${e.snippet}`
        ).join("\n");
        return {
          ok: true,
          content: `Fetched ${recent.length} Gmail email(s):\n${lines}`,
          label: `Fetched ${recent.length} Gmail emails`,
        };
      }

      if (provider === "microsoft") {
        const token = await getValidMicrosoftToken(ctx.userId);
        if (!token) {
          return {
            ok: false,
            content: "Outlook is not connected or the token has expired. Tell the user to reconnect Microsoft in Settings > Connections before Jarvis can check Outlook.",
            label: "Outlook not connected",
          };
        }
        const emails = await getRecentOutlookEmails(token, count);
        if (emails.length === 0) {
          return { ok: true, content: "No emails found in Outlook inbox.", label: "Inbox empty" };
        }
        updateLivingContextFromEmails(ctx.userId, "outlook", emails);
        const lines = emails.map((e: any) =>
          `- From: ${e.from} | Subject: "${e.subject}" — ${e.snippet}`
        ).join("\n");
        return {
          ok: true,
          content: `Fetched ${emails.length} Outlook email(s):\n${lines}`,
          label: `Fetched ${emails.length} Outlook emails`,
        };
      }

      return { ok: false, content: `Unknown provider "${provider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `fetch_emails failed: ${msg}`, label: "Email fetch failed" };
    }
  },
};
