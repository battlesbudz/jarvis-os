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
      parse_mode: 'Markdown',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('Telegram sendMessage error:', body);
  }
}

export async function setWebhook(webhookUrl: string): Promise<void> {
  if (!BOT_TOKEN) return;
  const secret = getWebhookSecret();
  const res = await fetch(`${BASE}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'my_chat_member'],
      secret_token: secret,
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

export function logTelegramStatus(): void {
  if (BOT_TOKEN) {
    console.log('Telegram: configured ✓');
  } else {
    console.log('Telegram: not configured (set TELEGRAM_BOT_TOKEN in Replit Secrets)');
  }
}
