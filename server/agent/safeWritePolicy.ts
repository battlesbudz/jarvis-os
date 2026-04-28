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
    // value still triggers the alert.  Deduplication (one alert per window) is
    // tracked by a follow-up task; for now multiple alerts (at 7, 8, 9) are
    // acceptable and give the owner escalating urgency.
    const status = await checkCircuitBreaker();
    if (status.count >= CIRCUIT_WARNING_THRESHOLD && status.count < CIRCUIT_MAX_WRITES) {
      _sendBudgetWarning(status.count).catch((err) =>
        console.error("[safeWritePolicy] Failed to send write-budget warning:", err)
      );
    }
  } catch (err) {
    console.error("[safeWritePolicy] Failed to record autonomous write in DB:", err);
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
  } catch (err) {
    console.error("[safeWritePolicy] Failed to reset write_budget_log:", err);
  }
}
