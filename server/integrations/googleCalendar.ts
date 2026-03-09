// Google Calendar integration — uses Replit connector: google-calendar
import { google } from 'googleapis';

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
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-calendar',
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
    throw new Error('Google Calendar not connected');
  }
  return accessToken;
}

// WARNING: Never cache this client. Tokens expire.
export async function getUncachableGoogleCalendarClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
}

export async function getGoogleCalendarEvents(date: string, startTime?: string, endTime?: string): Promise<CalendarEvent[]> {
  const calendar = await getUncachableGoogleCalendarClient();
  const startOfDay = startTime ? new Date(startTime) : new Date(date + 'T00:00:00Z');
  const endOfDay = endTime ? new Date(endTime) : new Date(date + 'T23:59:59Z');

  // Fetch all calendars the user has access to
  const calList = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const calendarIds = (calList.data.items || [])
    .filter((c) => !c.deleted)
    .map((c) => c.id!)
    .filter(Boolean);

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
          orderBy: 'startTime',
          maxResults: 20,
        });
        const items = res.data.items || [];
        items
          .filter((e) => e.summary && !seenIds.has(e.id || ''))
          .forEach((e) => {
            seenIds.add(e.id || '');
            allEvents.push({
              id: e.id || String(Math.random()),
              title: e.summary || 'Event',
              start: e.start?.dateTime || e.start?.date || date,
              end: e.end?.dateTime || e.end?.date || date,
              description: e.description || undefined,
              location: e.location || undefined,
            });
          });
      } catch {
        // Skip calendars we can't read
      }
    })
  );

  // Sort by start time
  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return allEvents;
}

export async function checkGoogleCalendarConnection(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
