import type { AgentTool } from "../types";
import { getGoogleCalendarEvents, type CalendarEvent } from "../../integrations/googleCalendar";

interface CalendarFetchArgs {
  date?: string;
  days?: number;
}

function todayInTZ(tz: string = "Europe/London"): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date());
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const fetchCalendarTool: AgentTool = {
  name: "fetch_calendar",
  description:
    "Fetch the user's Google Calendar events for a given day or date range. Use this whenever the user asks about meetings, schedule, availability, or what's coming up. Returns events grouped by day with title, start/end, location, and attendees.",
  parameters: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "ISO date YYYY-MM-DD. Defaults to today (Europe/London) if omitted.",
      },
      days: {
        type: "number",
        description: "How many consecutive days starting from `date` to fetch. Default 1 (single day). Max 14.",
      },
    },
  },
  async execute(args, ctx) {
    if (!ctx.googleAccessToken) {
      return {
        ok: false,
        content: "User has not connected Google Calendar. Ask them to connect Google in Settings.",
        label: "Calendar not connected",
      };
    }

    const a = args as CalendarFetchArgs;
    const startDate = String(a.date || todayInTZ()).slice(0, 10);
    const days = Math.min(Math.max(Number(a.days) || 1, 1), 14);

    try {
      const blocks: string[] = [];
      let totalEvents = 0;
      for (let i = 0; i < days; i++) {
        const d = addDays(startDate, i);
        const events: CalendarEvent[] = await getGoogleCalendarEvents(d, undefined, undefined, ctx.googleAccessToken);
        totalEvents += events.length;
        if (events.length === 0) {
          blocks.push(`### ${d}\n(no events)`);
          continue;
        }
        const lines = events.map((e) => {
          const loc = e.location ? ` @ ${e.location}` : "";
          return `- ${e.start}${e.end ? `–${e.end}` : ""}: ${e.title || "(no title)"}${loc}`;
        });
        blocks.push(`### ${d}\n${lines.join("\n")}`);
      }

      // Stash for downstream tools (so manage_tasks etc. can reference it)
      ctx.state.lastCalendarFetch = { startDate, days, totalEvents, fetchedAt: Date.now() };

      return {
        ok: true,
        content: `Calendar (${days} day${days === 1 ? "" : "s"} from ${startDate}, ${totalEvents} event${totalEvents === 1 ? "" : "s"}):\n\n${blocks.join("\n\n")}`,
        label: `Fetched calendar: ${days}d, ${totalEvents} event${totalEvents === 1 ? "" : "s"}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${ctx.channel || "Agent"}] fetch_calendar failed:`, msg);
      return { ok: false, content: `Calendar fetch failed: ${msg}`, label: "Calendar fetch failed", detail: msg };
    }
  },
};
