import type { AgentTool } from "../types";
import { getGoogleCalendarEvents } from "../../integrations/googleCalendar";

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

    const startDate = String(args.date || todayInTZ()).slice(0, 10);
    const days = Math.min(Math.max(Number(args.days) || 1, 1), 14);

    try {
      const blocks: string[] = [];
      let totalEvents = 0;
      for (let i = 0; i < days; i++) {
        const d = addDays(startDate, i);
        const events = await getGoogleCalendarEvents(d, undefined, undefined, ctx.googleAccessToken);
        totalEvents += events.length;
        if (events.length === 0) {
          blocks.push(`### ${d}\n(no events)`);
          continue;
        }
        const lines = events.map((e: any) => {
          const t = e.start?.dateTime || e.start?.date || "";
          const end = e.end?.dateTime || e.end?.date || "";
          const loc = e.location ? ` @ ${e.location}` : "";
          const att = Array.isArray(e.attendees) && e.attendees.length > 0
            ? ` (${e.attendees.length} attendee${e.attendees.length === 1 ? "" : "s"})`
            : "";
          return `- ${t}${end ? `–${end}` : ""}: ${e.summary || "(no title)"}${loc}${att}`;
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
    } catch (err: any) {
      console.error(`[${ctx.channel || "Agent"}] fetch_calendar failed:`, err?.message || err);
      return {
        ok: false,
        content: `Calendar fetch failed: ${err?.message || err}`,
        label: "Calendar fetch failed",
        detail: String(err?.message || err),
      };
    }
  },
};
