/**
 * SessionCache — a lightweight TTL-based cache for in-memory coach session IDs.
 *
 * Each entry records the last-access timestamp.  A background sweep (default:
 * every hour) evicts entries that have not been accessed within the TTL window
 * (default: 24 hours).  Reads also lazily evict their own entry when it is
 * found to be expired, so stale data is never returned even if the sweep
 * hasn't run yet.
 *
 * On a cache miss the coach pipeline falls back to a full DB chat-history
 * injection, so eviction never causes data loss — only a minor efficiency cost
 * on the first turn after a long gap.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours
const DEFAULT_SWEEP_MS = 60 * 60 * 1000;        // 1 hour

interface Entry {
  sessionId: string;
  lastUsed: number;
}

export class SessionCache {
  private readonly store = new Map<string, Entry>();
  private readonly ttlMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  readonly name: string;

  constructor(name: string, ttlMs = DEFAULT_TTL_MS) {
    this.name = name;
    this.ttlMs = ttlMs;
  }

  /** Return the session ID for `userId`, or `undefined` if absent / expired. */
  get(userId: string): string | undefined {
    const entry = this.store.get(userId);
    if (!entry) return undefined;
    if (Date.now() - entry.lastUsed > this.ttlMs) {
      this.store.delete(userId);
      return undefined;
    }
    return entry.sessionId;
  }

  /** Store (or refresh) the session ID for `userId`. */
  set(userId: string, sessionId: string): void {
    this.store.set(userId, { sessionId, lastUsed: Date.now() });
  }

  /** Remove the entry for `userId` immediately. */
  delete(userId: string): void {
    this.store.delete(userId);
  }

  /**
   * Start a background interval that evicts all entries not accessed within
   * the TTL.  Safe to call multiple times — subsequent calls are no-ops.
   * The interval is unref'd so it never prevents the process from exiting.
   */
  startSweep(sweepIntervalMs = DEFAULT_SWEEP_MS): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this._sweep(), sweepIntervalMs);
    const sweepTimer = this.sweepTimer as unknown as NodeJS.Timeout;
    if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  }

  private _sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    let evicted = 0;
    for (const [userId, entry] of this.store) {
      if (entry.lastUsed < cutoff) {
        this.store.delete(userId);
        evicted++;
      }
    }
    if (evicted > 0) {
      console.log(`[SessionCache:${this.name}] swept ${evicted} stale session(s)`);
    }
  }
}
