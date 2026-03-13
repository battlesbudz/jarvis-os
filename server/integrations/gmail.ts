import { getGmailClient } from './gmailClient';
import { Buffer } from 'node:buffer';

export interface EmailCommitment {
  subject: string;
  snippet: string;
  date: string;
  from?: string;
  labels: string[];
}

const LABEL_NAMES: Record<string, string> = {
  STARRED: '⭐ Starred',
  INBOX: 'Inbox',
  IMPORTANT: 'Important',
  CATEGORY_PERSONAL: 'Personal',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_FORUMS: 'Forums',
  SENT: 'Sent',
  DRAFT: 'Draft',
};

export async function createGmailDraft(
  userAccessToken: string,
  to: string,
  subject: string,
  body: string
): Promise<{ draftId: string; gmailUrl: string }> {
  const gmail = await getGmailClient(userAccessToken);

  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n');

  const encodedMessage = Buffer.from(messageParts)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: encodedMessage,
      },
    },
  });

  const draftId = res.data.id || '';
  const messageId = res.data.message?.id || '';
  const gmailUrl = `https://mail.google.com/mail/#drafts/${messageId}`;

  return { draftId, gmailUrl };
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
      maxResults: 100,
    });

    const messages = (listRes.data.messages || []).slice(0, 100);
    const results: EmailCommitment[] = [];

    const BATCH_SIZE = 10;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (msg) => {
          if (!msg.id) return null;
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
            const labelIds: string[] = (detail.data.labelIds as string[]) || [];
            const labels = labelIds.map((id) => LABEL_NAMES[id] || id);
            return { subject, snippet, date, from, labels } as EmailCommitment;
          } catch {
            return null;
          }
        })
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results;
  } catch (err) {
    console.error('[Gmail] getRecentEmailCommitments error:', err);
    return [];
  }
}
