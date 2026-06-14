import { getGoogleCalendarEvents } from "../integrations/googleCalendar";
import { getRecentEmailCommitments, type EmailCommitment } from "../integrations/gmail";
import { getValidGoogleTokens } from "../userTokenStore";
import { getLocalDayWindow, type DailyCommandContextWarning } from "./planOps";

export interface DailyCommandCalendarItem {
  id?: string;
  title: string;
  start?: string;
  end?: string;
  time?: string;
  description?: string;
  location?: string;
}

export interface DailyCommandContext {
  calendarEvents: DailyCommandCalendarItem[];
  gmailItems: EmailCommitment[];
  warnings: DailyCommandContextWarning[];
}

function formatEventTime(start: string | undefined, timezone: string): string | undefined {
  if (!start) return undefined;
  const date = new Date(start);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function collectDailyCommandContext(
  userId: string,
  dateKey: string,
  timezone = "America/New_York",
): Promise<DailyCommandContext> {
  const warnings: DailyCommandContextWarning[] = [];
  const tokens = await getValidGoogleTokens(userId).catch((err) => {
    warnings.push({
      source: "google",
      severity: "warning",
      message: `Google account context could not be checked: ${err instanceof Error ? err.message : "unknown error"}`,
    });
    return [];
  });

  if (tokens.length === 0) {
    warnings.push({ source: "calendar", severity: "info", message: "Google Calendar is not connected for today's plan." });
    warnings.push({ source: "gmail", severity: "info", message: "Gmail is not connected for inbox triage." });
    return { calendarEvents: [], gmailItems: [], warnings };
  }

  const token = tokens[0];
  const window = getLocalDayWindow(dateKey, timezone);
  const [calendarResult, gmailResult] = await Promise.allSettled([
    getGoogleCalendarEvents(dateKey, window.startTime, window.endTime, token),
    getRecentEmailCommitments(7, token),
  ]);

  const calendarEvents = calendarResult.status === "fulfilled"
    ? calendarResult.value.map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        time: formatEventTime(event.start, timezone),
        description: event.location || event.description,
        location: event.location,
      }))
    : [];
  if (calendarResult.status === "rejected") {
    warnings.push({
      source: "calendar",
      severity: "warning",
      message: `Calendar context unavailable: ${calendarResult.reason instanceof Error ? calendarResult.reason.message : "unknown error"}`,
    });
  }

  const gmailItems = gmailResult.status === "fulfilled" ? gmailResult.value : [];
  if (gmailResult.status === "rejected") {
    warnings.push({
      source: "gmail",
      severity: "warning",
      message: `Gmail context unavailable: ${gmailResult.reason instanceof Error ? gmailResult.reason.message : "unknown error"}`,
    });
  }

  if (calendarEvents.length === 0 && gmailItems.length === 0 && warnings.length === 0) {
    warnings.push({
      source: "daily_context",
      severity: "info",
      message: "No calendar events or email commitments were found for today's plan.",
    });
  }

  return { calendarEvents, gmailItems, warnings };
}
