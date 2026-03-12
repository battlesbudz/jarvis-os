import { getGmailClient } from './gmailClient';

export interface EmailCommitment {
  subject: string;
  snippet: string;
  date: string;
  from?: string;
}

export async function checkGmailConnection(userAccessToken?: string | null): Promise<boolean> {
  try {
    await getGmailClient(userAccessToken);
    return true;
  } catch {
    return false;
  }
}

export async function getRecentEmailCommitments(
  days: number = 7,
  userAccessToken?: string | null
): Promise<EmailCommitment[]> {
  try {
    const gmail = await getGmailClient(userAccessToken);

    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - days);
    const afterDateStr = afterDate.toISOString().slice(0, 10).replace(/-/g, '/');

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${afterDateStr}`,
      maxResults: 25,
    });

    const messages = listRes.data.messages || [];
    const results: EmailCommitment[] = [];

    for (const msg of messages.slice(0, 25)) {
      if (!msg.id) continue;
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'Date', 'From'],
        });
        const headers = detail.data.payload?.headers || [];
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';
        const from = headers.find((h: any) => h.name === 'From')?.value || '';
        const snippet = (detail.data.snippet || '').slice(0, 150);
        results.push({ subject, snippet, date, from });
      } catch {
        continue;
      }
    }

    return results;
  } catch (err) {
    console.error('[Gmail] getRecentEmailCommitments error:', err);
    return [];
  }
}
