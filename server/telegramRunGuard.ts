import crypto from "crypto";
import { activeCoachRuns } from "./runRegistry";

export const MIN_TELEGRAM_TURN_TIMEOUT_MS = 900_000;

const NON_MEANINGFUL_ACTIVITY_KINDS = new Set([
  "auto_progress",
  "keepalive",
  "typing",
]);

export function resolveTelegramReplyTimeoutMs(raw = process.env.TELEGRAM_REPLY_TIMEOUT_MS): number {
  const parsed = Number(raw || MIN_TELEGRAM_TURN_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return MIN_TELEGRAM_TURN_TIMEOUT_MS;
  return Math.max(parsed, MIN_TELEGRAM_TURN_TIMEOUT_MS);
}

export const TELEGRAM_REPLY_TIMEOUT_MS = resolveTelegramReplyTimeoutMs();

export class TelegramRunAbortedError extends Error {
  constructor(message = "Telegram turn was aborted.") {
    super(message);
    this.name = "TelegramRunAbortedError";
  }
}

export class TelegramRunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Telegram turn had no meaningful activity for ${timeoutMs}ms.`);
    this.name = "TelegramRunTimeoutError";
  }
}

export function isTelegramRunAbortedError(error: unknown): error is TelegramRunAbortedError {
  return error instanceof TelegramRunAbortedError;
}

export function isTelegramRunTimeoutError(error: unknown): error is TelegramRunTimeoutError {
  return error instanceof TelegramRunTimeoutError;
}

export function createTelegramRunGuard(userId: string) {
  const runId = `telegram_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const controller = new AbortController();
  let lastMeaningfulActivityAtMs = Date.now();
  let rescheduleInactivityTimer: (() => void) | null = null;
  activeCoachRuns.set(runId, { controller, userId });

  const touch = (kind = "progress", _message?: string) => {
    if (NON_MEANINGFUL_ACTIVITY_KINDS.has(kind)) return;
    lastMeaningfulActivityAtMs = Date.now();
    rescheduleInactivityTimer?.();
  };

  const finish = () => {
    const active = activeCoachRuns.get(runId);
    if (active?.controller === controller) {
      activeCoachRuns.delete(runId);
    }
  };

  const race = async <T>(promise: Promise<T>, timeoutMs = TELEGRAM_REPLY_TIMEOUT_MS): Promise<T> => {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new TelegramRunAbortedError();
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        if (rescheduleInactivityTimer === scheduleTimeout) {
          rescheduleInactivityTimer = null;
        }
        controller.signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        cleanup();
        reject(controller.signal.reason instanceof Error ? controller.signal.reason : new TelegramRunAbortedError());
      };
      const onTimeout = () => {
        if (settled) return;
        const error = new TelegramRunTimeoutError(timeoutMs);
        cleanup();
        controller.abort(error);
        reject(error);
      };
      const scheduleTimeout = () => {
        clearTimeout(timeout);
        const elapsedSinceMeaningfulActivity = Date.now() - lastMeaningfulActivityAtMs;
        const remainingMs = Math.max(0, timeoutMs - elapsedSinceMeaningfulActivity);
        timeout = setTimeout(onTimeout, remainingMs);
      };

      controller.signal.addEventListener("abort", onAbort, { once: true });
      rescheduleInactivityTimer = scheduleTimeout;
      scheduleTimeout();
      promise.then(
        (value) => {
          if (settled) return;
          cleanup();
          resolve(value);
        },
        (error) => {
          if (settled) return;
          cleanup();
          reject(error);
        },
      );
    });
  };

  return {
    runId,
    signal: controller.signal,
    finish,
    race,
    touch,
  };
}
