export interface VerifyDatabaseTablesBeforeListenOptions {
  ensureTablesExist: () => Promise<void>;
  attempts?: number;
  delayMsForAttempt?: (attempt: number) => number;
}

function defaultDelayMsForAttempt(attempt: number): number {
  return attempt * 2000;
}

export async function verifyDatabaseTablesBeforeListen({
  ensureTablesExist,
  attempts = 5,
  delayMsForAttempt = defaultDelayMsForAttempt,
}: VerifyDatabaseTablesBeforeListenOptions): Promise<void> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await ensureTablesExist();
      return;
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts) break;

      const delayMs = delayMsForAttempt(attempt);
      console.warn(
        `[Startup] database table verification failed (attempt ${attempt}/${attempts}); retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Database table verification failed before startup", {
    cause: lastErr,
  });
}
