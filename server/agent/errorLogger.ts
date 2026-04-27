/**
 * SystemErrorLogger — central utility for persisting backend errors to
 * the system_error_log table so Jarvis can read them during debug sessions.
 *
 * Called from:
 *  - Global Express error handler (server/index.ts)
 *  - Agent harness catch blocks (server/agent/harness.ts)
 *  - Health-check failure paths (server/intelligence/integrationValidator.ts)
 */

import { db } from "../db";
import { systemErrorLog } from "@shared/schema";

export interface LogErrorOptions {
  source: string;
  message: string;
  error?: unknown;
  level?: "error" | "critical";
  context?: Record<string, unknown>;
  userId?: string;
}

/**
 * Write one row to system_error_log. Never throws — all errors are swallowed
 * so a logging failure can never break the originating code path.
 */
export async function logSystemError(opts: LogErrorOptions): Promise<string | null> {
  try {
    const err = opts.error;
    const stackTrace =
      err instanceof Error
        ? (err.stack ?? err.message).slice(0, 4000)
        : typeof err === "string"
        ? err.slice(0, 4000)
        : null;

    const [row] = await db
      .insert(systemErrorLog)
      .values({
        source: opts.source.slice(0, 500),
        level: opts.level ?? "error",
        message: opts.message.slice(0, 2000),
        stackTrace,
        contextJson: opts.context ?? {},
        userId: opts.userId ?? null,
      })
      .returning({ id: systemErrorLog.id });

    return row?.id ?? null;
  } catch {
    return null;
  }
}
