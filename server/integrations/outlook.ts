import { Client } from "@microsoft/microsoft-graph-client";

function ensureUtc(dateTime: string): string {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(dateTime)) return dateTime;
  return `${dateTime}Z`;
}

function buildOutlookClient(accessToken: string) {
  return Client.initWithMiddleware({
    authProvider: { getAccessToken: async () => accessToken },
  });
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
}

export async function getOutlookCalendarEvents(
  date: string,
  startTime?: string,
  endTime?: string,
  userAccessToken?: string | null,
): Promise<CalendarEvent[]> {
  if (!userAccessToken) throw new Error("Outlook user OAuth token is required");
  const client = buildOutlookClient(userAccessToken);

  const startOfDay = startTime
    ? new Date(startTime).toISOString()
    : new Date(`${date}T00:00:00`).toISOString();
  const endOfDay = endTime
    ? new Date(endTime).toISOString()
    : new Date(`${date}T23:59:59`).toISOString();

  const res = await client
    .api("/me/calendarView")
    .query({ startDateTime: startOfDay, endDateTime: endOfDay })
    .header("Prefer", 'outlook.timezone="UTC"')
    .select("id,subject,start,end,body,location")
    .orderby("start/dateTime")
    .top(20)
    .get();

  const items: any[] = res.value || [];
  return items.map((e) => ({
    id: e.id || String(Math.random()),
    title: e.subject || "Event",
    start: e.start?.dateTime ? ensureUtc(e.start.dateTime) : date,
    end: e.end?.dateTime ? ensureUtc(e.end.dateTime) : date,
    description: e.body?.content
      ? e.body.content.replace(/<[^>]+>/g, "").trim().slice(0, 120)
      : undefined,
    location: e.location?.displayName || undefined,
  }));
}

export async function checkOutlookConnection(userAccessToken?: string | null): Promise<boolean> {
  return Boolean(userAccessToken);
}

export async function createOutlookCalendarEvent(
  userAccessToken: string,
  event: { title: string; start: string; end: string; description?: string; location?: string },
): Promise<{ id: string }> {
  const client = buildOutlookClient(userAccessToken);
  const startDt = event.start.includes("T") ? ensureUtc(event.start) : `${event.start}T00:00:00Z`;
  const endDt = event.end.includes("T") ? ensureUtc(event.end) : `${event.end}T01:00:00Z`;
  const body: Record<string, unknown> = {
    subject: event.title,
    start: { dateTime: startDt.slice(0, 19), timeZone: "UTC" },
    end: { dateTime: endDt.slice(0, 19), timeZone: "UTC" },
  };
  if (event.description) body.body = { contentType: "text", content: event.description };
  if (event.location) body.location = { displayName: event.location };
  const res = await client.api("/me/events").post(body);
  return { id: res.id || "" };
}

export async function sendOutlookEmail(
  userAccessToken: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const client = buildOutlookClient(userAccessToken);
  await client.api("/me/sendMail").post({
    message: {
      subject,
      body: { contentType: "text", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  });
}

export interface OutlookEmailItem {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  isRead: boolean;
}

export async function getRecentOutlookEmails(
  userAccessToken: string,
  count = 10,
): Promise<OutlookEmailItem[]> {
  const client = buildOutlookClient(userAccessToken);
  const res = await client
    .api("/me/messages")
    .select("id,subject,from,bodyPreview,receivedDateTime,isRead")
    .orderby("receivedDateTime desc")
    .top(Math.min(count, 25))
    .get();
  const items: any[] = res.value || [];
  return items.map((m) => ({
    id: m.id || "",
    subject: m.subject || "(no subject)",
    from: m.from?.emailAddress?.address || "unknown",
    snippet: (m.bodyPreview || "").slice(0, 150),
    date: m.receivedDateTime || "",
    isRead: Boolean(m.isRead),
  }));
}
