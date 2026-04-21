import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { createGoogleCalendarEvent } from "../../integrations/googleCalendar";
import { createOutlookCalendarEvent } from "../../integrations/outlook";
import { getValidMicrosoftToken } from "../../userTokenStore";

interface CalendarCreateArgs {
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  provider?: string;
}

export const createCalendarEventTool: AgentTool = {
  name: "create_calendar_event",
  description: "Create a calendar event on the user's Google Calendar or Outlook calendar. Use this when the user asks to schedule, block time, or add a meeting. start and end must be ISO 8601 datetime strings (e.g. '2025-04-22T14:00:00Z'). provider defaults to 'google' if connected, otherwise 'microsoft'.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Event title / summary" },
      start: { type: "string", description: "Start datetime in ISO 8601 format (e.g. '2025-04-22T14:00:00Z')" },
      end: { type: "string", description: "End datetime in ISO 8601 format (e.g. '2025-04-22T15:00:00Z')" },
      description: { type: "string", description: "Optional event description or notes" },
      location: { type: "string", description: "Optional location or video call link" },
      provider: { type: "string", enum: ["google", "microsoft"], description: "Calendar provider. Defaults to 'google'." },
    },
    required: ["title", "start", "end"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const a = args as CalendarCreateArgs;
    const title = String(a.title || "").trim();
    const start = String(a.start || "").trim();
    const end = String(a.end || "").trim();
    const description = a.description ? String(a.description).trim() : undefined;
    const location = a.location ? String(a.location).trim() : undefined;
    const provider = (a.provider || "google").toLowerCase();

    if (!title || !start || !end) {
      return { ok: false, content: "title, start, and end are all required.", label: "Missing required fields" };
    }

    try {
      if (provider === "google") {
        if (!ctx.googleAccessToken) {
          return { ok: false, content: "Google Calendar is not connected. Ask the user to connect their Google account in Profile.", label: "Google not connected" };
        }
        const result = await createGoogleCalendarEvent(ctx.googleAccessToken, { title, start, end, description, location });
        const startDate = start.slice(0, 10);
        const startTime = start.slice(11, 16);
        return {
          ok: true,
          content: `Event created on Google Calendar: "${title}" on ${startDate} at ${startTime}${result.htmlLink ? `. View: ${result.htmlLink}` : ''}`,
          label: `Event created: ${title}`,
          detail: result.htmlLink || undefined,
        };
      }

      if (provider === "microsoft") {
        const msToken = await getValidMicrosoftToken(ctx.userId);
        if (!msToken) {
          return { ok: false, content: "Microsoft Calendar is not connected. Ask the user to connect their Microsoft account in Profile.", label: "Microsoft not connected" };
        }
        await createOutlookCalendarEvent(msToken, { title, start, end, description, location });
        const startDate = start.slice(0, 10);
        const startTime = start.slice(11, 16);
        return {
          ok: true,
          content: `Event created on Outlook Calendar: "${title}" on ${startDate} at ${startTime}`,
          label: `Event created: ${title}`,
        };
      }

      return { ok: false, content: `Unknown provider "${provider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${ctx.channel || "Agent"}] create_calendar_event failed:`, msg);
      return { ok: false, content: `Calendar event creation failed: ${msg}`, label: "Calendar create failed", detail: msg };
    }
  },
};
