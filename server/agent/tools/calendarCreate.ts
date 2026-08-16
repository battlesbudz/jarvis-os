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

export type CalendarProvider = "google" | "microsoft";

const ISO_DATETIME_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isValidIsoDateTimeWithZone(value: string): boolean {
  const match = value.match(ISO_DATETIME_WITH_ZONE);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText == null ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText == null ? 0 : Number(offsetMinuteText);
  if (
    month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)
  ) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

export function validateCalendarDateRange(start: string, end: string): string | null {
  if (!isValidIsoDateTimeWithZone(start)) {
    return "start must be a valid ISO 8601 datetime with a timezone (for example, 2025-04-22T14:00:00Z).";
  }
  if (!isValidIsoDateTimeWithZone(end)) {
    return "end must be a valid ISO 8601 datetime with a timezone (for example, 2025-04-22T15:00:00Z).";
  }
  if (Date.parse(end) <= Date.parse(start)) return "end must be later than start.";
  return null;
}

export function resolveCalendarProvider(
  requestedProvider: string | undefined,
  connections: { googleConnected: boolean; microsoftConnected: boolean },
): CalendarProvider | null {
  const requested = requestedProvider?.trim().toLowerCase();
  if (requested === "google" || requested === "microsoft") return requested;
  if (requested) return null;
  if (connections.googleConnected) return "google";
  if (connections.microsoftConnected) return "microsoft";
  return null;
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

    if (!title || !start || !end) {
      return { ok: false, content: "title, start, and end are all required.", label: "Missing required fields" };
    }

    const dateRangeError = validateCalendarDateRange(start, end);
    if (dateRangeError) {
      return { ok: false, content: dateRangeError, label: "Invalid calendar date range" };
    }

    try {
      const requestedProvider = a.provider ? String(a.provider) : undefined;
      const requestedNormalized = requestedProvider?.trim().toLowerCase();
      if (requestedNormalized && requestedNormalized !== "google" && requestedNormalized !== "microsoft") {
        return { ok: false, content: `Unknown provider "${requestedProvider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
      }
      const needsMicrosoftConnection = requestedNormalized === "microsoft" || (!requestedNormalized && !ctx.googleAccessToken);
      const msToken = needsMicrosoftConnection ? await getValidMicrosoftToken(ctx.userId) : null;
      const provider = resolveCalendarProvider(requestedProvider, {
        googleConnected: Boolean(ctx.googleAccessToken),
        microsoftConnected: Boolean(msToken),
      });
      if (!provider) {
        return { ok: false, content: "No calendar provider is connected. Ask the user to connect Google or Microsoft Calendar in Profile.", label: "Calendar not connected" };
      }

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

      return { ok: false, content: "No connected calendar provider is available.", label: "Calendar not connected" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${ctx.channel || "Agent"}] create_calendar_event failed:`, msg);
      return { ok: false, content: `Calendar event creation failed: ${msg}`, label: "Calendar create failed", detail: msg };
    }
  },
};
