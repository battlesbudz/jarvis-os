import { getGmailClient } from './gmailClient';
import { Buffer } from 'node:buffer';

export interface EmailCommitment {
  id: string;
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

export interface EmailAlert {
  messageId: string;
  subject: string;
  from: string;
  snippet: string;
  receivedAt: number;
}

export async function getEmailsSince(
  sinceMs: number,
  userAccessToken?: string | null
): Promise<EmailAlert[]> {
  try {
    const gmail = await getGmailClient(userAccessToken);
    const sinceSeconds = Math.floor(sinceMs / 1000);

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `in:inbox -from:me after:${sinceSeconds}`,
      maxResults: 20,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) return [];

    const results: EmailAlert[] = [];
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
              metadataHeaders: ['Subject', 'From', 'Date'],
            });
            const headers = detail.data.payload?.headers || [];
            const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
            const from = headers.find((h: any) => h.name === 'From')?.value || 'unknown';
            const snippet = (detail.data.snippet || '').slice(0, 200);
            const receivedAt = parseInt(detail.data.internalDate || '0', 10);
            const labelIds: string[] = (detail.data.labelIds as string[]) || [];
            if (labelIds.includes('SENT') || labelIds.includes('DRAFT')) return null;
            return { messageId: msg.id, subject, from, snippet, receivedAt } as EmailAlert;
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
    console.error('[Gmail] getEmailsSince error:', err);
    return [];
  }
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
            return { id: msg.id, subject, snippet, date, from, labels } as EmailCommitment;
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

export interface StarredEmail {
  messageId: string;
  subject: string;
  from: string;
  snippet: string;
  receivedAt: number;
  ageDays: number;
}

export async function getStarredFollowUpEmails(
  userAccessToken: string,
  minAgeDays: number = 3
): Promise<StarredEmail[]> {
  try {
    const gmail = await getGmailClient(userAccessToken);
    const fourteenDaysAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `in:inbox (is:starred OR is:important) -from:me after:${fourteenDaysAgo}`,
      maxResults: 20,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) return [];

    const results: StarredEmail[] = [];
    const nowMs = Date.now();
    const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
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
              metadataHeaders: ['Subject', 'From', 'Date'],
            });
            const headers = detail.data.payload?.headers || [];
            const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
            const from = headers.find((h: any) => h.name === 'From')?.value || 'unknown';
            const snippet = (detail.data.snippet || '').slice(0, 200);
            const receivedAt = parseInt(detail.data.internalDate || '0', 10);
            const labelIds: string[] = (detail.data.labelIds as string[]) || [];

            if (!labelIds.includes('INBOX')) return null;
            if (labelIds.includes('SENT') || labelIds.includes('DRAFT')) return null;

            const ageMs = nowMs - receivedAt;
            if (ageMs < minAgeMs) return null;

            const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
            return { messageId: msg.id, subject, from, snippet, receivedAt, ageDays } as StarredEmail;
          } catch {
            return null;
          }
        })
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    results.sort((a, b) => a.receivedAt - b.receivedAt);
    return results;
  } catch (err) {
    console.error('[Gmail] getStarredFollowUpEmails error:', err);
    return [];
  }
}

export async function gmailModifyMessage(
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
  userAccessToken: string
): Promise<void> {
  const gmail = await getGmailClient(userAccessToken);
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds: addLabelIds.length > 0 ? addLabelIds : undefined,
      removeLabelIds: removeLabelIds.length > 0 ? removeLabelIds : undefined,
    },
  });
}
