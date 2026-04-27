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
  // No dev token set — index.ts will skip polling and log the warning.
  console.log('[Telegram] Dev mode: no TELEGRAM_BOT_TOKEN_DEV set — falling back to TELEGRAM_BOT_TOKEN (polling will be skipped to avoid conflicting with production)');
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
  replyMarkupOrOpts?: InlineKeyboardMarkup | { parse_mode?: string }
): Promise<void> {
  if (!BOT_TOKEN) return;
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (replyMarkupOrOpts) {
    if ("inline_keyboard" in replyMarkupOrOpts) {
      body.reply_markup = replyMarkupOrOpts;
    } else if ("parse_mode" in replyMarkupOrOpts && replyMarkupOrOpts.parse_mode) {
      body.parse_mode = replyMarkupOrOpts.parse_mode;
    }
  }
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

/** Telegram's hard per-message character limit. */
const TG_MAX_CHARS = 4096;

/**
 * Build the "(Part N of M)\n\n" label for chunk index i (0-based) out of total.
 * Returns an empty string when total === 1 (no label needed).
 */
function partLabel(i: number, total: number): string {
  return total > 1 ? `(Part ${i + 1} of ${total})\n\n` : "";
}

/**
 * Find the last position of a sentence-ending boundary (`. `, `? `, `! `,
 * sentence-end before newline, or sentence-end at string end) at or before
 * `maxPos`. Returns the position just after the terminator+space, or -1 if
 * no sentence boundary was found.
 */
function lastSentenceBoundary(text: string, maxPos: number): number {
  // Walk backwards from maxPos looking for '. ', '? ', '! '
  // We want the position *after* the punctuation+space so the chunk
  // includes the terminating punctuation.
  for (let i = Math.min(maxPos, text.length - 1); i >= 0; i--) {
    const ch = text[i];
    if (ch === " " && i > 0) {
      const prev = text[i - 1];
      if (prev === "." || prev === "?" || prev === "!") {
        return i + 1; // include the space
      }
    }
    // Sentence end immediately before a newline
    if ((ch === "\n" || ch === "\r") && i > 0) {
      const prev = text[i - 1];
      if (prev === "." || prev === "?" || prev === "!") {
        return i + 1;
      }
    }
  }
  return -1;
}

/**
 * Split `text` into raw chunks using `limit` as the per-chunk character budget.
 *
 * Boundary preference order (highest to lowest):
 *   1. Double-newline (paragraph break)
 *   2. Sentence terminator (`. `, `? `, `! ` or sentence-end before newline)
 *   3. Single newline
 *   4. Word boundary (space)
 *   5. Hard-cut at limit (last resort, avoids mid-word only when a space exists)
 *
 * The minimum chunk size guard is 200 chars (or 5 % of limit, whichever is
 * smaller), ensuring we never produce excessively tiny leading chunks.
 */
function splitIntoChunks(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const minChunk = Math.min(200, Math.floor(limit * 0.05));
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let cutAt = limit;

    // 1. Paragraph boundary (double newline)
    const dnl = remaining.lastIndexOf("\n\n", cutAt);
    if (dnl >= minChunk) {
      cutAt = dnl + 2;
    } else {
      // 2. Sentence boundary
      const sb = lastSentenceBoundary(remaining, cutAt);
      if (sb >= minChunk) {
        cutAt = sb;
      } else {
        // 3. Single newline
        const nl = remaining.lastIndexOf("\n", cutAt);
        if (nl >= minChunk) {
          cutAt = nl + 1;
        } else {
          // 4. Word boundary (space)
          const sp = remaining.lastIndexOf(" ", cutAt);
          if (sp >= minChunk) {
            cutAt = sp + 1;
          }
          // 5. Hard-cut at limit (avoids infinite loop on no-space text)
        }
      }
    }

    chunks.push(remaining.slice(0, cutAt).trimEnd());
    remaining = remaining.slice(cutAt).trimStart();
  }

  return chunks;
}

/**
 * Split a long text into messages that each fit within Telegram's 4096-character
 * limit, including any "(Part N of M)" label overhead.
 *
 * Strategy:
 *   1. Quick path: if the whole text fits in 4096 chars, return it as-is.
 *   2. Estimate the total number of parts using TG_MAX_CHARS (no label overhead yet).
 *   3. Compute the exact label size for that part count, then re-split using the
 *      reduced budget (TG_MAX_CHARS − label length) so every labelled chunk is
 *      guaranteed to be ≤ 4096 characters.
 *   4. If step 3 produces a different part count, iterate once more with the
 *      updated label size to ensure accuracy.
 *
 * Returns an array of ready-to-send message strings, each ≤ 4096 chars.
 */
export function splitTelegramMessage(text: string): string[] {
  if (text.length <= TG_MAX_CHARS) return [text];

  // First pass: estimate part count without reserving label space
  const estimatedChunks = splitIntoChunks(text, TG_MAX_CHARS);
  const estimatedTotal = estimatedChunks.length;
  if (estimatedTotal <= 1) return estimatedChunks;

  // Compute the label length for the estimated total (worst-case: last part)
  const labelLen = partLabel(estimatedTotal - 1, estimatedTotal).length;
  const budget = TG_MAX_CHARS - labelLen;

  // Second pass: split using the label-adjusted budget
  let finalChunks = splitIntoChunks(text, budget);

  // If the part count grew (more parts than estimated), re-adjust label size
  if (finalChunks.length !== estimatedTotal) {
    const revisedLabelLen = partLabel(finalChunks.length - 1, finalChunks.length).length;
    const revisedBudget = TG_MAX_CHARS - revisedLabelLen;
    if (revisedBudget < budget) {
      finalChunks = splitIntoChunks(text, revisedBudget);
    }
  }

  // Prepend "(Part N of M)" to each chunk
  const total = finalChunks.length;
  return finalChunks.map((chunk, i) => `${partLabel(i, total)}${chunk}`);
}

/**
 * Send a potentially long text response to a Telegram chat, automatically
 * splitting it into ≤4096-character messages when needed. Each chunk is sent
 * sequentially. When more than one chunk is produced the chunks are labelled
 * "(Part N of M)" so the user knows additional messages are coming.
 */
export async function sendLongMessage(chatId: string, text: string): Promise<void> {
  const chunks = splitTelegramMessage(text);
  for (const chunk of chunks) {
    await sendMessage(chatId, chunk);
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

/**
 * Sends a video to a Telegram chat as an inline video message.
 * Accepts an MP4 buffer and an optional caption.
 */
export async function sendVideo(
  chatId: string,
  videoBuffer: Buffer,
  caption?: string,
): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("video", new Blob([videoBuffer], { type: "video/mp4" }), "video.mp4");
    const res = await fetch(`${BASE}/sendVideo`, { method: "POST", body: form });
    if (!res.ok) {
      console.error("Telegram sendVideo error:", await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Telegram sendVideo threw:", String(e));
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
