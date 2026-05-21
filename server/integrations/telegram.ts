import crypto from 'crypto';
import { getPublicBaseUrl } from '../publicUrl';

// Token selection: in dev, prefer TELEGRAM_BOT_TOKEN_DEV (a separate test bot
// created via BotFather) so the dev server never races with the production
// webhook. Set TELEGRAM_BOT_TOKEN_DEV in the local/dev environment.
// In production, always use TELEGRAM_BOT_TOKEN.
const isProduction = process.env.NODE_ENV === 'production';
const BOT_TOKEN = (!isProduction && process.env.TELEGRAM_BOT_TOKEN_DEV)
  ? process.env.TELEGRAM_BOT_TOKEN_DEV
  : process.env.TELEGRAM_BOT_TOKEN;

// In dev mode without a dedicated dev token, outbound sends are blocked entirely.
// Both polling (index.ts) and sending would otherwise use the production token,
// causing every proactive notification to fire twice — once from dev, once from prod.
const devSendBlocked = !isProduction && !process.env.TELEGRAM_BOT_TOKEN_DEV;

if (!isProduction && process.env.TELEGRAM_BOT_TOKEN_DEV) {
  console.log('[Telegram] Using DEV bot token (TELEGRAM_BOT_TOKEN_DEV)');
} else if (!isProduction) {
  // No dev token set — index.ts will skip polling and outbound sends are blocked below.
  console.log('[Telegram] Dev mode: no TELEGRAM_BOT_TOKEN_DEV set — falling back to TELEGRAM_BOT_TOKEN (polling and outbound sends will be skipped to avoid conflicting with production)');
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
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/**
 * Returns the deep-link redirect URL for the voice call button.
 * Points to /go/voice-call — a public Express route that first attempts to
 * open the native app via jarvis://voice-realtime and falls back to the HTTPS
 * web version of the voice screen after 1.5 s if the app is not installed.
 */
export function getExpectedVoiceCallUrl(): string {
  return `${getPublicBaseUrl()}/go/voice-call`;
}

/**
 * Builds an inline keyboard with a "🎙 Voice call" URL button.
 * When tapped the button opens /go/voice-call which:
 *   1. Attempts to launch the native app via jarvis://voice-realtime
 *   2. Falls back to the HTTPS web voice screen after 1.5 s
 *
 */
export function buildVoiceCallKeyboard(opts?: {
  includeTextReplyButton?: boolean;
}): InlineKeyboardMarkup | null {
  const url = getExpectedVoiceCallUrl();
  if (!url) return null;
  const row: InlineKeyboardButton[] = [
    { text: '🎙 Open voice call', url },
  ];
  if (opts?.includeTextReplyButton) {
    row.push({ text: '💬 Text reply', callback_data: 'voice_dismiss' });
  }
  return { inline_keyboard: [row] };
}

export async function sendMessage(
  chatId: string,
  text: string,
  replyMarkupOrOpts?: InlineKeyboardMarkup | { parse_mode?: string }
): Promise<void> {
  if (!BOT_TOKEN) return;
  if (devSendBlocked) return;
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

/**
 * Sends a message and returns the Telegram message_id of the sent message,
 * or null if the send failed or the bot token is not configured.
 * Used to obtain a handle for in-place edits via editMessage().
 */
export async function sendMessageGetId(
  chatId: string,
  text: string,
): Promise<number | null> {
  if (!BOT_TOKEN) return null;
  if (devSendBlocked) return null;
  try {
    const res = await fetch(`${BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      console.error('Telegram sendMessageGetId error:', await res.text());
      return null;
    }
    const data = await res.json() as { ok: boolean; result?: { message_id: number } };
    return data.result?.message_id ?? null;
  } catch (e) {
    console.error('Telegram sendMessageGetId threw:', String(e));
    return null;
  }
}

/**
 * Edits the text of a previously sent message in-place.
 * Silently ignores "message is not modified" errors (no visible change = no error).
 * Text is clamped to 4096 characters (Telegram's per-message limit).
 *
 * Returns `{ ok: true }` on success or `{ ok: false, retryAfter? }` on failure.
 * When Telegram returns a 429 flood-wait the `retryAfter` field contains the
 * number of seconds the caller should wait before retrying so the streaming
 * interval can be adapted automatically.
 */
export async function editMessage(
  chatId: string,
  messageId: number,
  text: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  if (!BOT_TOKEN) return { ok: false };
  if (devSendBlocked) return { ok: false };
  const safeText = text.slice(0, 4096) || "…";
  try {
    const res = await fetch(`${BASE}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: safeText }),
    });
    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 429) {
        // Parse retry_after from Telegram's flood-wait response body.
        let retryAfter = 30;
        try {
          const body = JSON.parse(errText) as { parameters?: { retry_after?: number } };
          if (body.parameters?.retry_after) retryAfter = body.parameters.retry_after;
        } catch { /* ignore JSON parse errors */ }
        console.warn(
          `[Telegram] editMessage 429 flood-wait: chatId=${chatId} messageId=${messageId} retryAfter=${retryAfter}s`,
        );
        return { ok: false, retryAfter };
      }
      if (!errText.includes('message is not modified')) {
        console.warn('Telegram editMessage error:', errText);
      }
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.warn('Telegram editMessage threw:', String(e));
    return { ok: false };
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
  if (devSendBlocked) return false;
  try {
    const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const form: FormData = new FormData();
    form.append('chat_id', chatId);
    if (caption) form.append('caption', caption.slice(0, 1024));
    form.append('document', new Blob([new Uint8Array(buf)], { type: mimeType }), filename);
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

export interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

/**
 * Fetches the currently registered webhook info from Telegram.
 * Returns null if the bot token is missing or the call fails.
 */
export async function getWebhookInfo(): Promise<WebhookInfo | null> {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`${BASE}/getWebhookInfo`);
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; result?: WebhookInfo };
    if (data.ok && data.result) return data.result;
    return null;
  } catch {
    return null;
  }
}

// ── Webhook health state (module-level, lives for the process lifetime) ────────
let _webhookHealth: {
  healthy: boolean;
  registeredUrl: string | null;
  lastChecked: string | null;
} = { healthy: false, registeredUrl: null, lastChecked: null };

export function getWebhookHealth() {
  return { ..._webhookHealth };
}

/**
 * Verifies that the Telegram webhook is registered to `expectedUrl`.
 * If it is missing or points elsewhere, re-registers immediately.
 * Updates the in-memory health state so it can be surfaced by the API.
 */
export async function ensureWebhook(expectedUrl: string): Promise<{ healthy: boolean; reregistered: boolean }> {
  const info = await getWebhookInfo();
  const now = new Date().toISOString();

  if (info && info.url === expectedUrl) {
    _webhookHealth = { healthy: true, registeredUrl: info.url, lastChecked: now };
    console.log('[Telegram] Webhook health check passed — URL matches expected:', expectedUrl);
    return { healthy: true, reregistered: false };
  }

  const reason = !info
    ? 'getWebhookInfo call failed'
    : info.url
    ? `registered to wrong URL: ${info.url}`
    : 'no webhook registered';
  console.warn(`[Telegram] Webhook mismatch (${reason}) — re-registering to ${expectedUrl}`);

  try {
    await setWebhook(expectedUrl);
    _webhookHealth = { healthy: true, registeredUrl: expectedUrl, lastChecked: now };
    console.log('[Telegram] Webhook re-registered successfully:', expectedUrl);
    return { healthy: true, reregistered: true };
  } catch (err) {
    _webhookHealth = { healthy: false, registeredUrl: info?.url || null, lastChecked: now };
    console.error('[Telegram] Webhook re-registration failed:', err);
    return { healthy: false, reregistered: false };
  }
}

/**
 * Returns the expected production webhook URL.
 */
export function getExpectedWebhookUrl(): string | null {
  return `${getPublicBaseUrl()}/api/telegram/webhook`;
}

export function getExpectedMiniAppUrl(): string | null {
  const configured = process.env.TELEGRAM_MINI_APP_URL || process.env.TELEGRAM_WEB_APP_URL;
  return configured ? new URL(configured).origin : getPublicBaseUrl();
}

export async function setMiniAppMenuButton(url: string, chatId?: string): Promise<void> {
  if (!BOT_TOKEN) return;
  if (!/^https:\/\//i.test(url)) {
    throw new Error(`Telegram Mini App URL must be HTTPS: ${url}`);
  }

  const res = await fetch(`${BASE}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(chatId ? { chat_id: chatId } : {}),
      menu_button: {
        type: 'web_app',
        text: process.env.TELEGRAM_MINI_APP_BUTTON_TEXT || 'Open Jarvis',
        web_app: { url },
      },
    }),
  });
  const data = await res.json() as { ok: boolean; description?: string };
  if (!data.ok) {
    throw new Error(`Failed to set Telegram Mini App button: ${data.description || JSON.stringify(data)}`);
  }
}

export async function ensureMiniAppMenuButton(expectedUrl: string, chatId?: string): Promise<boolean> {
  try {
    await setMiniAppMenuButton(expectedUrl, chatId);
    console.log('[Telegram] Mini App menu button set:', chatId ? `${expectedUrl} (chat ${chatId})` : expectedUrl);
    return true;
  } catch (err) {
    console.error('[Telegram] Mini App menu button setup failed:', err);
    return false;
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
  if (devSendBlocked) return false;
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("voice", new Blob([new Uint8Array(audioBuffer)], { type: "audio/ogg" }), "voice.ogg");
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
 * Accepts a Buffer (PNG/JPEG), an optional caption, and optional MIME type + filename.
 * The MIME type defaults to "image/png" for backward compatibility.
 */
export async function sendPhoto(
  chatId: string,
  imageBuffer: Buffer,
  caption?: string,
  mimeType?: string,
  filename?: string,
): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  if (devSendBlocked) return false;
  const actualMime = mimeType || "image/png";
  const actualFilename = filename || (actualMime === "image/jpeg" ? "image.jpg" : "image.png");
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("photo", new Blob([new Uint8Array(imageBuffer)], { type: actualMime }), actualFilename);
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
  if (devSendBlocked) return false;
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("video", new Blob([new Uint8Array(videoBuffer)], { type: "video/mp4" }), "video.mp4");
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

/**
 * Sends a chat action (e.g. "typing") to show the bot is active.
 * The typing indicator disappears automatically after ~5 seconds, so
 * call it again if the operation takes longer than that.
 */
export async function sendChatAction(
  chatId: string,
  action: "typing" | "upload_document" | "upload_photo" | "upload_voice" = "typing",
): Promise<void> {
  if (!BOT_TOKEN) return;
  if (devSendBlocked) return;
  try {
    await fetch(`${BASE}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // best-effort: a failed typing indicator is not worth surfacing
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
    console.log('Telegram: not configured (set TELEGRAM_BOT_TOKEN in the server environment)');
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
