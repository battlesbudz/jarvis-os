import { google } from "googleapis";

function buildCalendarClient(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: CalendarAttendee[];
}

export async function getGoogleCalendarEvents(
  date: string,
  startTime?: string,
  endTime?: string,
  userAccessToken?: string | null,
): Promise<CalendarEvent[]> {
  if (!userAccessToken) throw new Error("Google Calendar user OAuth token is required");
  const calendar = buildCalendarClient(userAccessToken);

  const startOfDay = startTime ? new Date(startTime) : new Date(`${date}T00:00:00Z`);
  const endOfDay = endTime ? new Date(endTime) : new Date(`${date}T23:59:59Z`);

  const calList = await calendar.calendarList.list({ minAccessRole: "reader" });
  const calendarIds = (calList.data.items || [])
    .filter((c) => !c.deleted)
    .map((c) => c.id!)
    .filter(Boolean);

  console.log(`[Calendar] Found ${calendarIds.length} calendar(s) for token. Querying ${startOfDay.toISOString()} -> ${endOfDay.toISOString()}`);

  const allEvents: CalendarEvent[] = [];
  const seenIds = new Set<string>();

  await Promise.all(
    calendarIds.map(async (calId) => {
      try {
        const res = await calendar.events.list({
          calendarId: calId,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 20,
        });
        const items = res.data.items || [];
        console.log(`[Calendar] Cal "${calId}": ${items.length} event(s)`);
        items
          .filter((e) => e.summary && !seenIds.has(e.id || ""))
          .forEach((e) => {
            seenIds.add(e.id || "");
            const attendees = (e.attendees || [])
              .filter((a) => a.email)
              .map((a) => ({
                email: String(a.email),
                displayName: a.displayName || undefined,
                organizer: Boolean(a.organizer),
                self: Boolean(a.self),
              }));
            allEvents.push({
              id: e.id || String(Math.random()),
              title: e.summary || "Event",
              start: e.start?.dateTime || e.start?.date || date,
              end: e.end?.dateTime || e.end?.date || date,
              description: e.description || undefined,
              location: e.location || undefined,
              attendees: attendees.length > 0 ? attendees : undefined,
            });
          });
      } catch (err: any) {
        console.error(`[Calendar] Error fetching events for cal "${calId}":`, err?.message || err);
      }
    }),
  );

  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return allEvents;
}

export async function checkGoogleCalendarConnection(userAccessToken?: string | null): Promise<boolean> {
  return Boolean(userAccessToken);
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  event: { title: string; start: string; end: string; description?: string; location?: string },
): Promise<{ id: string; htmlLink: string }> {
  const calendar = buildCalendarClient(accessToken);
  const startDt = event.start.includes("T") ? event.start : `${event.start}T00:00:00Z`;
  const endDt = event.end.includes("T") ? event.end : `${event.end}T01:00:00Z`;
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.title,
      description: event.description || undefined,
      location: event.location || undefined,
      start: { dateTime: startDt },
      end: { dateTime: endDt },
    },
  });
  return { id: res.data.id || "", htmlLink: res.data.htmlLink || "" };
}
