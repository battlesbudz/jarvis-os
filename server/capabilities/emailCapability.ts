import type { Capability } from "./types";
import { gmailActionTool, gmailDraftTool } from "../agent/tools/gmailActions";
import { sendEmailTool } from "../agent/tools/sendEmail";
import { fetchEmailsTool } from "../agent/tools/fetchEmails";

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
      toolNames: ["gmail_action", "create_gmail_draft"],
    },
    {
      integrationId: "outlook",
      label: "Microsoft Outlook",
      toolNames: [],
    },
  ],
  configRequirements: [
    { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID", optional: true },
    { key: "MICROSOFT_CLIENT_ID", label: "Microsoft OAuth Client ID", optional: true },
  ],
  async healthCheck() {
    const hasGoogle = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const hasMicrosoft = !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
    if (!hasGoogle && !hasMicrosoft) {
      return { healthy: false, reason: "Neither Google nor Microsoft OAuth credentials are configured" };
    }
    return { healthy: true };
  },
};
