export const TELEGRAM_MESSAGE_BATCH_WINDOW_MS = Number(process.env.TELEGRAM_MESSAGE_BATCH_WINDOW_MS || 1_500);

export interface TelegramCoachMessageBatchInput {
  userId: string;
  chatId: string;
  text: string;
  imageUrl?: string;
}

export interface TelegramCoachMessageBatch {
  userId: string;
  chatId: string;
  text: string;
  imageUrl?: string;
}

type PendingTelegramCoachBatch = {
  userId: string;
  chatId: string;
  messages: { text: string; imageUrl?: string }[];
  timer: ReturnType<typeof setTimeout>;
  handler: (batch: TelegramCoachMessageBatch) => void | Promise<void>;
};

const pendingBatches = new Map<string, PendingTelegramCoachBatch>();

function batchKey(userId: string, chatId: string): string {
  return `${userId}:${chatId}`;
}

export function buildTelegramCoachBatchText(messages: { text: string; imageUrl?: string }[]): string {
  if (messages.length <= 1) return messages[0]?.text || "";

  const lines = messages.map((message, index) => {
    const attachment = message.imageUrl ? " [included an image]" : "";
    return `${index + 1}. ${message.text}${attachment}`;
  });

  return [
    `The user sent ${messages.length} Telegram messages close together.`,
    "Treat them as one short conversation burst. Decide whether one reply covers all of them, whether some are context only, or whether each needs a separate answer.",
    "",
    "Messages:",
    ...lines,
  ].join("\n");
}

export function enqueueTelegramCoachMessageBatch(
  input: TelegramCoachMessageBatchInput,
  handler: (batch: TelegramCoachMessageBatch) => void | Promise<void>,
  delayMs = TELEGRAM_MESSAGE_BATCH_WINDOW_MS,
): void {
  const key = batchKey(input.userId, input.chatId);
  const existing = pendingBatches.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    existing.messages.push({ text: input.text, imageUrl: input.imageUrl });
    existing.handler = handler;
    existing.timer = scheduleFlush(key, existing, delayMs);
    return;
  }

  const pending: PendingTelegramCoachBatch = {
    userId: input.userId,
    chatId: input.chatId,
    messages: [{ text: input.text, imageUrl: input.imageUrl }],
    handler,
    timer: setTimeout(() => {}, 0),
  };
  pending.timer = scheduleFlush(key, pending, delayMs);
  pendingBatches.set(key, pending);
}

export function cancelTelegramCoachMessageBatches(userId: string, chatId?: string): number {
  let cancelled = 0;
  for (const [key, pending] of pendingBatches.entries()) {
    if (pending.userId !== userId) continue;
    if (chatId && pending.chatId !== chatId) continue;
    clearTimeout(pending.timer);
    pendingBatches.delete(key);
    cancelled += 1;
  }
  return cancelled;
}

function scheduleFlush(key: string, pending: PendingTelegramCoachBatch, delayMs: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    pendingBatches.delete(key);
    const imageUrl = [...pending.messages].reverse().find((message) => message.imageUrl)?.imageUrl;
    Promise.resolve(pending.handler({
      userId: pending.userId,
      chatId: pending.chatId,
      text: buildTelegramCoachBatchText(pending.messages),
      imageUrl,
    })).catch((error) => {
      console.error("[Telegram] message batch handler failed:", error);
    });
  }, delayMs);
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

export function clearTelegramCoachMessageBatchesForTests(): void {
  for (const pending of pendingBatches.values()) {
    clearTimeout(pending.timer);
  }
  pendingBatches.clear();
}
