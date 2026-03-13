import crypto from 'crypto';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

function generateWebhookSecret(): string {
  if (process.env.TELEGRAM_WEBHOOK_SECRET) return process.env.TELEGRAM_WEBHOOK_SECRET;
  const secret = crypto.randomBytes(32).toString('hex');
  process.env.TELEGRAM_WEBHOOK_SECRET = secret;
  return secret;
}

let webhookSecret: string | null = null;

export function getWebhookSecret(): string {
  if (!webhookSecret) {
    webhookSecret = generateWebhookSecret();
  }
  return webhookSecret;
}

export function verifyWebhookSecret(headerValue: string | undefined): boolean {
  if (!webhookSecret) return false;
  return headerValue === webhookSecret;
}

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
  };
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  my_chat_member?: {
    chat: { id: number; type: string; title?: string };
    new_chat_member: { status: string };
  };
}

export async function sendMessage(chatId: string, text: string): Promise<void> {
  if (!BOT_TOKEN) return;
  const res = await fetch(`${BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('Telegram sendMessage error:', body);
  }
}

export async function setWebhook(webhookUrl: string): Promise<void> {
  if (!BOT_TOKEN) return;
  const res = await fetch(`${BASE}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'my_chat_member'],
    }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log('Telegram webhook set:', webhookUrl);
  } else {
    console.error('Failed to set Telegram webhook:', data);
  }
}

export function isTelegramConfigured(): boolean {
  return !!BOT_TOKEN;
}

export async function deleteWebhook(): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`${BASE}/deleteWebhook`, { method: 'POST' });
  } catch {
    // ignore
  }
}

export async function downloadTelegramFile(fileId: string): Promise<string | null> {
  if (!BOT_TOKEN) return null;
  try {
    const infoRes = await fetch(`${BASE}/getFile?file_id=${fileId}`);
    if (!infoRes.ok) return null;
    const info = await infoRes.json() as { ok: boolean; result?: { file_path: string } };
    if (!info.ok || !info.result?.file_path) return null;

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) return null;

    const buffer = await fileRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const ext = info.result.file_path.split('.').pop()?.toLowerCase() || 'jpg';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function downloadTelegramFileBuffer(fileId: string): Promise<{ buffer: Buffer; ext: string } | null> {
  if (!BOT_TOKEN) return null;
  try {
    const infoRes = await fetch(`${BASE}/getFile?file_id=${fileId}`);
    if (!infoRes.ok) return null;
    const info = await infoRes.json() as { ok: boolean; result?: { file_path: string } };
    if (!info.ok || !info.result?.file_path) return null;

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) return null;

    const arrayBuf = await fileRes.arrayBuffer();
    const ext = info.result.file_path.split('.').pop()?.toLowerCase() || 'ogg';
    return { buffer: Buffer.from(arrayBuf), ext };
  } catch {
    return null;
  }
}

export async function getUpdates(offset: number): Promise<TelegramUpdate[]> {
  if (!BOT_TOKEN) return [];
  try {
    const res = await fetch(`${BASE}/getUpdates?offset=${offset}&timeout=5&limit=100`);
    if (!res.ok) return [];
    const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };
    return data.ok ? (data.result || []) : [];
  } catch {
    return [];
  }
}

export function logTelegramStatus(): void {
  if (BOT_TOKEN) {
    console.log('Telegram: configured ✓');
  } else {
    console.log('Telegram: not configured (set TELEGRAM_BOT_TOKEN in Replit Secrets)');
  }
}
