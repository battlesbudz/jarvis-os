import type { Capability } from "./types";
import { fetchCalendarTool } from "../agent/tools/calendar";
import { createCalendarEventTool } from "../agent/tools/calendarCreate";
import { getGoogleOAuthConfigStatus } from "./googleOAuthConfig";

export const calendarCapability: Capability = {
  id: "calendar",
  label: "Calendar",
  toolGroups: ["calendar"],
  tools: [fetchCalendarTool, createCalendarEventTool],
  googleGatedToolNames: ["fetch_calendar"],
  integrationDependencies: [
    {
      integrationId: "google",
      label: "Google (Gmail + Calendar + Drive)",
      toolNames: ["fetch_calendar", "create_calendar_event"],
    },
    {
      integrationId: "outlook",
      label: "Microsoft Outlook",
      toolNames: ["create_calendar_event"],
    },
  ],
  configRequirements: [
    { key: "GOOGLE_WEB_CLIENT_ID", label: "Google OAuth Web Client ID" },
    { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth Client Secret" },
  ],
  async healthCheck() {
    const status = getGoogleOAuthConfigStatus();
    if (!status.configured) {
      return { healthy: false, reason: status.reason };
    }
    return { healthy: true };
  },
};
