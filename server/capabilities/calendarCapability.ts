import type { Capability } from "./types";
import { fetchCalendarTool } from "../agent/tools/calendar";
import { createCalendarEventTool } from "../agent/tools/calendarCreate";

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
    { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID" },
    { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth Client Secret" },
  ],
  async healthCheck() {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return { healthy: false, reason: "Google OAuth credentials not configured" };
    }
    return { healthy: true };
  },
};
