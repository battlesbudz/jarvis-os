// Outlook integration — uses Replit connector: outlook
// Uses @microsoft/microsoft-graph-client@3.0.7
import { Client } from '@microsoft/microsoft-graph-client';

async function getAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  const connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=outlook',
    {
      headers: {
        Accept: 'application/json',
        'X-Replit-Token': xReplitToken,
      },
    }
  )
    .then((res) => res.json())
    .then((data) => data.items?.[0]);

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Outlook not connected');
  }
  return accessToken;
}

// WARNING: Never cache this client. Tokens expire.
export async function getUncachableOutlookClient() {
  const accessToken = await getAccessToken();
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => accessToken,
    },
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

export async function getOutlookCalendarEvents(date: string): Promise<CalendarEvent[]> {
  const client = await getUncachableOutlookClient();
  const startOfDay = new Date(date + 'T00:00:00').toISOString();
  const endOfDay = new Date(date + 'T23:59:59').toISOString();

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
    description: e.body?.content ? e.body.content.replace(/<[^>]+>/g, '').trim().slice(0, 120) : undefined,
    location: e.location?.displayName || undefined,
  }));
}

export async function checkOutlookConnection(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
