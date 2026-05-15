import type { Capability } from "./types";
import { gmailActionTool, gmailDraftTool } from "../agent/tools/gmailActions";
import { sendEmailTool } from "../agent/tools/sendEmail";
import { fetchEmailsTool } from "../agent/tools/fetchEmails";
import { getGoogleOAuthConfigStatus } from "./googleOAuthConfig";

export const emailCapability: Capability = {
  id: "email",
  label: "Email (Gmail + Outlook)",
  toolGroups: ["email"],
  tools: [gmailActionTool, gmailDraftTool, sendEmailTool, fetchEmailsTool],
  googleGatedToolNames: ["gmail_action", "create_gmail_draft"],
  integrationDependencies: [
    {
      integrationId: "google",
      label: "Google (Gmail + Calendar + Drive)",
      toolNames: ["gmail_action", "create_gmail_draft", "send_email", "fetch_emails"],
    },
    {
      integrationId: "outlook",
      label: "Microsoft Outlook",
      toolNames: ["send_email", "fetch_emails"],
    },
  ],
  configRequirements: [
    { key: "GOOGLE_WEB_CLIENT_ID", label: "Google OAuth Web Client ID", optional: true },
    { key: "MICROSOFT_CLIENT_ID", label: "Microsoft OAuth Client ID", optional: true },
  ],
  async healthCheck() {
    const googleStatus = getGoogleOAuthConfigStatus();
    const hasGoogle = googleStatus.configured;
    const hasMicrosoft = !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
    if (!hasGoogle && !hasMicrosoft) {
      return {
        healthy: false,
        reason: `${googleStatus.configured ? "Google OAuth configured" : googleStatus.reason}; Microsoft OAuth credentials are not configured`,
      };
    }
    return { healthy: true };
  },
};
