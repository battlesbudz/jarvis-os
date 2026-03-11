// Outlook integration — uses per-user OAuth token when available, falls back to Replit connector
import { Client } from '@microsoft/microsoft-graph-client';

async function getProjectAccessToken(): Promise<string> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) throw new Error('X-Replit-Token not available');

  const connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=outlook',
    { headers: { Accept: 'application/json', 'X-Replit-Token': xReplitToken } }
  )
    .then((res) => res.json())
    .then((data) => data.items?.[0]);

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!accessToken) throw new Error('Outlook not connected');
  return accessToken;
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
  userAccessToken?: string | null
): Promise<CalendarEvent[]> {
  const accessToken = userAccessToken ?? (await getProjectAccessToken());
  const client = buildOutlookClient(accessToken);

  const startOfDay = startTime
    ? new Date(startTime).toISOString()
    : new Date(date + 'T00:00:00').toISOString();
  const endOfDay = endTime
    ? new Date(endTime).toISOString()
    : new Date(date + 'T23:59:59').toISOString();

  const res = await client
    .api('/me/calendarView')
    .query({ startDateTime: startOfDay, endDateTime: endOfDay })
    .select('id,subject,start,end,body,location')
    .orderby('start/dateTime')
    .top(20)
    .get();

  const items: any[] = res.value || [];
  return items.map((e) => ({
    id: e.id || String(Math.random()),
    title: e.subject || 'Event',
    start: e.start?.dateTime || date,
    end: e.end?.dateTime || date,
    description: e.body?.content
      ? e.body.content.replace(/<[^>]+>/g, '').trim().slice(0, 120)
      : undefined,
    location: e.location?.displayName || undefined,
  }));
}

export async function checkOutlookConnection(userAccessToken?: string | null): Promise<boolean> {
  try {
    if (userAccessToken) return true;
    await getProjectAccessToken();
    return true;
  } catch {
    return false;
  }
}
