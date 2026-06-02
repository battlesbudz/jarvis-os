import crypto from "crypto";
import { activeCoachRuns } from "./runRegistry";

export const TELEGRAM_REPLY_TIMEOUT_MS = Number(process.env.TELEGRAM_REPLY_TIMEOUT_MS || 420_000);

export class TelegramRunAbortedError extends Error {
  constructor(message = "Telegram turn was aborted.") {
    super(message);
    this.name = "TelegramRunAbortedError";
  }
}

export class TelegramRunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Telegram turn timed out after ${timeoutMs}ms.`);
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
  activeCoachRuns.set(runId, { controller, userId });

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
      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        cleanup();
        reject(controller.signal.reason instanceof Error ? controller.signal.reason : new TelegramRunAbortedError());
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        const error = new TelegramRunTimeoutError(timeoutMs);
        cleanup();
        controller.abort(error);
        reject(error);
      }, timeoutMs);
      timeout.unref?.();

      controller.signal.addEventListener("abort", onAbort, { once: true });
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
  };
}
