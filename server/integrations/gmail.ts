import { getUncachableGmailClient } from './gmailClient';

export interface EmailCommitment {
  subject: string;
  snippet: string;
  date: string;
}

export async function checkGmailConnection(): Promise<boolean> {
  try {
    const client = await getUncachableGmailClient();
    if (!client) return false;
    return true;
  } catch {
    return false;
  }
}

export async function getRecentEmailCommitments(days: number = 7): Promise<EmailCommitment[]> {
  try {
    const gmail = await getUncachableGmailClient();

    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - days);
    const afterTimestamp = Math.floor(afterDate.getTime() / 1000);

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${afterTimestamp} in:inbox`,
      maxResults: 20,
    });

    const messages = listRes.data.messages || [];
    const results: EmailCommitment[] = [];

    for (const msg of messages.slice(0, 20)) {
      if (!msg.id) continue;
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'Date'],
        });
        const headers = detail.data.payload?.headers || [];
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';
        const snippet = (detail.data.snippet || '').slice(0, 200);
        results.push({ subject, snippet, date });
      } catch {
        continue;
      }
    }

    return results;
  } catch {
    return [];
  }
}
