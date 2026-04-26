import crypto from 'crypto';

// Token selection: in dev, prefer TELEGRAM_BOT_TOKEN_DEV (a separate test bot
// created via BotFather) so the dev server never races with the production
// webhook.  Set TELEGRAM_BOT_TOKEN_DEV as a Replit secret in the workspace.
// In production, always use TELEGRAM_BOT_TOKEN.
const isProduction = process.env.NODE_ENV === 'production';
const BOT_TOKEN = (!isProduction && process.env.TELEGRAM_BOT_TOKEN_DEV)
  ? process.env.TELEGRAM_BOT_TOKEN_DEV
  : process.env.TELEGRAM_BOT_TOKEN;

if (!isProduction && process.env.TELEGRAM_BOT_TOKEN_DEV) {
  console.log('[Telegram] Using DEV bot token (TELEGRAM_BOT_TOKEN_DEV)');
} else if (!isProduction) {
  // Will be caught in index.ts startup guard — no polling will start.
} else {
  console.log('[Telegram] Using production bot token (TELEGRAM_BOT_TOKEN)');
}

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

export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    first_name: string;
    username?: string;
  };
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: {
    chat: { id: number; type: string; title?: string };
    new_chat_member: { status: string };
  };
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export async function sendMessage(
  chatId: string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  if (!BOT_TOKEN) return;
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`${BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error('Telegram sendMessage error:', errBody);
  }
}

/**
 * Sends a generated document (e.g. markdown brief) to a Telegram chat as a
 * file attachment. Used by the agent's create_document tool so the user can
 * actually receive the artifact in the channel they're chatting in.
 */
export async function sendTelegramDocument(
  chatId: string,
  filename: string,
  content: string | Buffer,
  caption?: string,
  mimeType: string = 'text/markdown',
): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const form: FormData = new FormData();
    form.append('chat_id', chatId);
    if (caption) form.append('caption', caption.slice(0, 1024));
    form.append('document', new Blob([buf], { type: mimeType }), filename);
    const res = await fetch(`${BASE}/sendDocument`, { method: 'POST', body: form });
    if (!res.ok) {
      console.error('Telegram sendDocument error:', await res.text());
      return false;
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Telegram sendDocument threw:', msg);
    return false;
  }
}

export async function sendMessageWithButtons(
  chatId: string,
  text: string,
  buttons: InlineKeyboardButton[]
): Promise<void> {
  return sendMessage(chatId, text, {
    inline_keyboard: [buttons],
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`${BASE}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || '' }),
    });
  } catch {
    // best-effort
  }
}

export async function setWebhook(webhookUrl: string): Promise<void> {
  if (!BOT_TOKEN) return;
  const res = await fetch(`${BASE}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'my_chat_member', 'callback_query'],
    }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log('[Telegram] Webhook set successfully:', webhookUrl);
  } else {
    throw new Error(`Failed to set Telegram webhook: ${JSON.stringify(data)}`);
  }
}

export function isTelegramConfigured(): boolean {
  return !!BOT_TOKEN;
}

export async function deleteWebhook(): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    const res = await fetch(`${BASE}/deleteWebhook`, { method: 'POST' });
    const data = await res.json() as { ok: boolean };
    console.log('[Telegram] Webhook cleared before polling:', data.ok ? 'ok' : 'failed');
  } catch {
    // ignore
  }
}

/**
 * Sends a voice message (round audio bubble) to a Telegram chat.
 * Telegram requires OGG-OPUS format for voice bubbles.
 */
export async function sendVoice(
  chatId: string,
  audioBuffer: Buffer,
  caption?: string,
): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("voice", new Blob([audioBuffer], { type: "audio/ogg" }), "voice.ogg");
    const res = await fetch(`${BASE}/sendVoice`, { method: "POST", body: form });
    if (!res.ok) {
      console.error("Telegram sendVoice error:", await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Telegram sendVoice threw:", String(e));
    return false;
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

/**
 * Sends a photo to a Telegram chat as an inline image.
 * Accepts a Buffer (PNG/JPEG) and an optional caption.
 */
export async function sendPhoto(
  chatId: string,
  imageBuffer: Buffer,
  caption?: string,
): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("photo", new Blob([imageBuffer], { type: "image/png" }), "image.png");
    const res = await fetch(`${BASE}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) {
      console.error("Telegram sendPhoto error:", await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Telegram sendPhoto threw:", String(e));
    return false;
  }
}

export async function getUpdates(offset: number): Promise<TelegramUpdate[]> {
  if (!BOT_TOKEN) return [];
  try {
    const res = await fetch(
      `${BASE}/getUpdates?offset=${offset}&timeout=5&limit=100&allowed_updates=["message","my_chat_member","callback_query"]`
    );
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

let _cachedBotUsername: string | null = null;

/**
 * Returns the bot's @username (without the leading @) by calling Telegram's
 * /getMe endpoint. Result is cached in memory so subsequent calls are free.
 * Returns null if the bot token is not configured or the call fails.
 */
export async function getTelegramBotUsername(): Promise<string | null> {
  if (_cachedBotUsername) return _cachedBotUsername;
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`${BASE}/getMe`);
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; result?: { username?: string } };
    if (data.ok && data.result?.username) {
      _cachedBotUsername = data.result.username;
      return _cachedBotUsername;
    }
    return null;
  } catch {
    return null;
  }
}
