/**
 * safeWritePolicy.ts — single source of truth for all autonomous write controls.
 *
 * Centralises:
 *   1. The allow-listed source directories Jarvis may read / write.
 *   2. The hard-protected file set that always requires user approval.
 *   3. The dangerous-pattern detector for edge cases not covered by the set.
 *   4. The runtime circuit breaker: max 10 autonomous writes per 60-minute window.
 *
 * Both apply_code_change and any future write tools must import from here.
 * selfEditTools.ts and codeProposalsRoutes.ts import from here as well.
 */

import path from "path";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getIntegrationOwnerId } from "../integrationOwner";

// ── Allow-listed source directories ──────────────────────────────────────────
// Jarvis may only read or write files inside these relative directories.
// Absolute paths and path traversal are always rejected.
export const ALLOWED_SOURCE_DIRS = [
  "server",
  "shared",
  "app",
  "components",
  "hooks",
  "constants",
  "lib",
];

// ── Hard-protected files — require user approval, never written autonomously ──
// Keep this list in sync with any checks in codeProposalsRoutes.ts (which now
// imports from here) and in selfEditTools.ts (same).
export const PROTECTED_FILES = new Set([
  "server/agent/codeProposalsRoutes.ts",
  "server/db.ts",
  "server/auth.ts",
  "server/routes.ts",
  "server/agent/harness.ts",
  "server/integrationOwner.ts",
  "server/index.ts",
  "shared/schema.ts",
  // Self-modification guard: the policy file itself is protected.
  "server/agent/safeWritePolicy.ts",
]);

// ── Dangerous patterns — catch additional risky paths by regex ────────────────
// Used by apply_code_change to block changes that look like migrations or
// credential files even if they are not in the hard-protected set.
const DANGEROUS_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /migration/i,                          reason: "database migration file" },
  { re: /\.env(\.|$)/,                         reason: "environment variables file" },
  { re: /drizzle\.config/,                     reason: "Drizzle ORM config" },
];

// ── Path validation helpers ───────────────────────────────────────────────────

/** Return true if `filePath` is in the hard-protected set (normalised). */
export function isProtectedFile(filePath: string): boolean {
  return PROTECTED_FILES.has(path.normalize(filePath));
}

/**
 * Return { dangerous: true, reason } if the path triggers a dangerous-pattern
 * rule or is in the protected set; otherwise { dangerous: false }.
 */
export function isDangerousPath(filePath: string): { dangerous: boolean; reason?: string } {
  const normalised = path.normalize(filePath);
  if (PROTECTED_FILES.has(normalised)) {
    return { dangerous: true, reason: `'${filePath}' is a hard-protected file that requires user approval` };
  }
  for (const { re, reason } of DANGEROUS_PATTERNS) {
    if (re.test(normalised)) {
      return { dangerous: true, reason: `'${filePath}' looks like a ${reason}` };
    }
  }
  return { dangerous: false };
}

/**
 * Full allow-list check used by AUTONOMOUS WRITE operations (apply_code_change):
 * - Must be a relative path (no leading /)
 * - Must not escape via ../
 * - Must not be in PROTECTED_FILES (autonomous writes are never allowed on protected files)
 * - First path segment must be in ALLOWED_SOURCE_DIRS
 */
export function isPathAllowed(filePath: string): boolean {
  const normalised = path.normalize(filePath);
  if (path.isAbsolute(normalised)) return false;
  if (normalised.startsWith("..")) return false;
  if (PROTECTED_FILES.has(normalised)) return false;
  const firstSegment = normalised.split(path.sep)[0];
  return ALLOWED_SOURCE_DIRS.includes(firstSegment);
}

/**
 * Allow-list check for PROPOSAL operations (propose_code_change).
 * Proposals only write a DB record — the file is never touched until a human
 * explicitly approves it. Therefore protected files MAY be proposed (so the
 * user can review them) but they CANNOT be applied autonomously.
 *
 * Checks:
 * - Must be a relative path (no leading /)
 * - Must not escape via ../
 * - First path segment must be in ALLOWED_SOURCE_DIRS
 * (PROTECTED_FILES are intentionally NOT blocked here)
 */
export function isPathAllowedForProposal(filePath: string): boolean {
  const normalised = path.normalize(filePath);
  if (path.isAbsolute(normalised)) return false;
  if (normalised.startsWith("..")) return false;
  const firstSegment = normalised.split(path.sep)[0];
  return ALLOWED_SOURCE_DIRS.includes(firstSegment);
}

// ── Runtime circuit breaker ───────────────────────────────────────────────────
// DB-backed sliding-window counter. Timestamps are stored in `write_budget_log`
// so the budget survives server restarts and cannot be bypassed by restarting.
// Rows older than the 60-minute window are pruned on each write to keep the
// table small.

const CIRCUIT_MAX_WRITES       = 10;
const CIRCUIT_WINDOW_MS        = 60 * 60 * 1000; // 60 minutes
/** Send an early-warning notification to the owner when the write count reaches this value. */
export const CIRCUIT_WARNING_THRESHOLD = 7;

export interface CircuitStatus {
  tripped: boolean;
  count: number;
  /** Only set when tripped — earliest time the window will clear */
  resetAt?: Date;
}

/** Check the circuit breaker without recording a write. Non-mutating. */
export async function checkCircuitBreaker(): Promise<CircuitStatus> {
  try {
    const windowStart = new Date(Date.now() - CIRCUIT_WINDOW_MS);
    const rows = await db.execute(sql`
      SELECT written_at FROM write_budget_log
      WHERE written_at >= ${windowStart}
      ORDER BY written_at ASC
    `);
    const timestamps: Date[] = (rows.rows as Array<{ written_at: Date }>).map(r => new Date(r.written_at));
    const count = timestamps.length;
    if (count >= CIRCUIT_MAX_WRITES) {
      const resetAt = new Date(timestamps[0].getTime() + CIRCUIT_WINDOW_MS);
      return { tripped: true, count, resetAt };
    }
    return { tripped: false, count };
  } catch {
    // If the DB is unavailable, fail open (don't block writes) but log a warning.
    console.warn("[safeWritePolicy] write_budget_log query failed — circuit breaker bypassed");
    return { tripped: false, count: 0 };
  }
}

/** Record one autonomous write. Call AFTER a successful fs.writeFile. */
export async function recordAutonomousWrite(): Promise<void> {
  try {
    const now = new Date();
    const pruneOlderThan = new Date(now.getTime() - CIRCUIT_WINDOW_MS);
    // Insert this write and prune expired rows in one round-trip.
    await db.execute(sql`
      WITH inserted AS (
        INSERT INTO write_budget_log (written_at) VALUES (${now})
      )
      DELETE FROM write_budget_log WHERE written_at < ${pruneOlderThan}
    `);

    // Check whether the new count has crossed the warning threshold.
    // Use >= (not ===) so a concurrent burst that jumps past the exact threshold
    // still triggers the alert.  Deduplication (one alert per 60-minute window)
    // is enforced via a conditional UPDATE on the singleton write_budget_warnings
    // row, which takes a Postgres row-level lock — safe under concurrent writes.
    const status = await checkCircuitBreaker();
    if (status.count >= CIRCUIT_WARNING_THRESHOLD && status.count < CIRCUIT_MAX_WRITES) {
      _maybeSendBudgetWarning(status.count).catch((err) =>
        console.error("[safeWritePolicy] Failed to send write-budget warning:", err)
      );
    }
  } catch (err) {
    console.error("[safeWritePolicy] Failed to record autonomous write in DB:", err);
  }
}

/**
 * Attempt to claim the "warning slot" for the current 60-minute window.
 *
 * Uses a single-row UPDATE with a Postgres row-level lock so concurrent
 * callers serialize: only the first one whose UPDATE satisfies the WHERE
 * clause (warned_at < windowStart) will get rowCount > 0 and proceed to send
 * the notification.  All subsequent concurrent callers see the updated row
 * (warned_at = NOW()) and return false — no duplicate notifications.
 *
 * This is safe at Postgres's default READ COMMITTED isolation because the row
 * lock acquired by the UPDATE prevents a second caller from evaluating the
 * WHERE clause against a stale snapshot.
 *
 * Returns true if this caller won the slot, false if a warning was already
 * dispatched in this window.
 */
async function _claimWarningSlot(): Promise<boolean> {
  const windowStart = new Date(Date.now() - CIRCUIT_WINDOW_MS);
  // UPDATE the singleton row only when no warning has been sent in this window.
  // The row-level lock makes this race-condition-safe under concurrent writes.
  const result = await db.execute(sql`
    UPDATE write_budget_warnings
    SET    warned_at = NOW()
    WHERE  id = 1 AND warned_at < ${windowStart}
    RETURNING id
  `);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Deduplication wrapper — sends a budget warning only if no warning has
 * already been dispatched in the current 60-minute window.
 *
 * If notification delivery fails, the slot is rolled back so the next write
 * that crosses the threshold can retry sending the warning.
 */
async function _maybeSendBudgetWarning(count: number): Promise<void> {
  const claimed = await _claimWarningSlot();
  if (!claimed) return; // Another concurrent call already sent the warning.
  try {
    await _sendBudgetWarning(count);
  } catch (err) {
    // Delivery failed — reset the slot so a subsequent write in this window
    // can retry the notification rather than silently dropping it for 60 min.
    await db
      .execute(sql`UPDATE write_budget_warnings SET warned_at = '1970-01-01' WHERE id = 1`)
      .catch((resetErr) =>
        console.error("[safeWritePolicy] Failed to reset warning slot after delivery failure:", resetErr)
      );
    throw err;
  }
}

/**
 * Fire-and-forget helper — sends an early-warning notification to the owner
 * when the write count reaches CIRCUIT_WARNING_THRESHOLD.
 */
async function _sendBudgetWarning(count: number): Promise<void> {
  const ownerId = await getIntegrationOwnerId();
  if (!ownerId) return;

  // Lazy-load the channel registry to avoid a circular import at module load time.
  const { notifyUser } = await import("../channels/registry");
  const remaining = CIRCUIT_MAX_WRITES - count;
  const msg =
    `⚠️ *Write budget warning* — Jarvis has used ${count}/${CIRCUIT_MAX_WRITES} autonomous writes in the last hour. ` +
    `Only ${remaining} write${remaining === 1 ? "" : "s"} left before the circuit breaker trips. ` +
    `Review the audit log or reset the counter if needed.`;

  await notifyUser(ownerId, "general", msg);
}

/** Return a human-readable description of the current write budget. */
export async function writeBudgetSummary(): Promise<string> {
  const status = await checkCircuitBreaker();
  if (status.tripped) {
    return `Circuit breaker OPEN — ${status.count}/${CIRCUIT_MAX_WRITES} writes in the last 60 min. Resets at ${status.resetAt?.toISOString()}.`;
  }
  return `${status.count}/${CIRCUIT_MAX_WRITES} autonomous writes in the last 60 min.`;
}

/**
 * Manually reset the circuit-breaker write counter.
 * Owner-only action — intended for use after the owner has reviewed the audit
 * log and is satisfied that the recent writes were correct.
 */
export async function resetCircuitBreaker(): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM write_budget_log`);
    // Reset the warning deduplication state so a fresh warning can be sent
    // if autonomous writes ramp up again after this manual reset.
    await db.execute(sql`
      UPDATE write_budget_warnings SET warned_at = '1970-01-01' WHERE id = 1
    `);
  } catch (err) {
    console.error("[safeWritePolicy] Failed to reset write_budget_log:", err);
  }
}

/**
 * TEST-ONLY: Insert a write record at an arbitrary timestamp into the DB.
 * Allows tests to simulate writes at specific points in time (e.g. 61 minutes
 * ago) to exercise the sliding-window eviction logic without waiting.
 * Never call this from production code.
 */
export async function _injectTimestampForTest(ts: Date): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("_injectTimestampForTest must not be called in production");
  }
  await db.execute(sql`INSERT INTO write_budget_log (written_at) VALUES (${ts})`);
}
