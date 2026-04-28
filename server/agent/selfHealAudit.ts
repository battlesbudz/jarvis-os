/**
 * selfHealAudit.ts — Parser and reader for server/self-heal-audit.log.
 *
 * The log is append-only and written by applyCodeChangeTool.  Each entry
 * begins with a separator line of 72 × "─" and has the form:
 *
 *   ────────────────────────────────────────────────────────────────────────
 *   Timestamp : 2024-01-01T00:00:00.000Z
 *   File      : server/agent/tools/myTool.ts
 *   Reason    : Fix null pointer exception in tool handler
 *   Verified  : pending | passed | failed | error
 *   Changes   : +3 -2 lines
 *
 *   + new line
 *   - old line
 *
 * Verification update lines (appended after verification completes):
 *   [VERIFY] 2024-01-01T00:00:00.000Z server/agent/tools/myTool.ts: passed — type-check + tests
 *
 * Persistence: every audit entry is also mirrored to the `self_heal_audit_log`
 * DB table by applyCodeChangeTool.  When the flat file is absent (e.g. after a
 * container restart), readAuditEntries() rebuilds it automatically from the DB
 * so audit history is never lost.
 */

import fs from "fs/promises";
import path from "path";
import { db } from "../db";
import { selfHealAuditLog } from "../../shared/schema";
import { asc } from "drizzle-orm";

const AUDIT_LOG_PATH = path.join(process.cwd(), "server/self-heal-audit.log");
const SEPARATOR_CHAR = "─";
const SEPARATOR_LENGTH = 72;
const SEPARATOR = SEPARATOR_CHAR.repeat(SEPARATOR_LENGTH);

export interface AuditEntry {
  timestamp: string;
  file: string;
  reason: string;
  verified: string;
  changesSummary: string;
  diff: string;
}

/**
 * Parse the raw audit log text into structured entries (newest-first).
 * Also reads [VERIFY] update lines and merges them into the corresponding entries.
 */
function parseAuditLog(raw: string): AuditEntry[] {
  // Collect all [VERIFY] update lines first (key: "timestamp|filePath" → result string)
  const verifyUpdates = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const m = line.match(/^\[VERIFY\]\s+(\S+)\s+(.+?):\s+(.+)$/);
    if (m) {
      const [, ts, fp, result] = m;
      verifyUpdates.set(`${ts}|${fp}`, result.trim());
    }
  }

  const blocks = raw.split(SEPARATOR).filter((b) => b.trim().length > 0);

  const entries: AuditEntry[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    let timestamp = "";
    let file = "";
    let reason = "";
    let verified = "pending";
    let changesSummary = "";
    const diffLines: string[] = [];
    let inDiff = false;

    for (const line of lines) {
      if (line.startsWith("Timestamp :")) {
        timestamp = line.slice("Timestamp :".length).trim();
      } else if (line.startsWith("File      :")) {
        file = line.slice("File      :".length).trim();
      } else if (line.startsWith("Reason    :")) {
        reason = line.slice("Reason    :".length).trim();
      } else if (line.startsWith("Verified  :")) {
        verified = line.slice("Verified  :".length).trim();
      } else if (line.startsWith("Changes   :")) {
        changesSummary = line.slice("Changes   :".length).trim();
        inDiff = true;
      } else if (inDiff && (line.startsWith("+") || line.startsWith("-") || line.startsWith("…"))) {
        diffLines.push(line);
      }
    }

    if (timestamp && file) {
      // Check if a [VERIFY] update exists for this entry and override the parsed field.
      const verifyKey = `${timestamp}|${file}`;
      const verifyUpdate = verifyUpdates.get(verifyKey);
      if (verifyUpdate !== undefined) {
        verified = verifyUpdate;
      }

      entries.push({
        timestamp,
        file,
        reason,
        verified,
        changesSummary,
        diff: diffLines.join("\n"),
      });
    }
  }

  // Return newest-first
  return entries.reverse();
}

/**
 * Reconstruct the flat audit log file from the DB backup.
 * Called automatically when the log file is missing (e.g. after a container
 * restart). Entries are written oldest-first so the file matches the natural
 * append order.
 */
async function restoreFromDB(): Promise<void> {
  let rows: Array<{
    timestamp: string;
    file: string;
    reason: string;
    verified: string;
    changesSummary: string;
    diff: string;
  }>;
  try {
    rows = await db
      .select({
        timestamp: selfHealAuditLog.timestamp,
        file: selfHealAuditLog.file,
        reason: selfHealAuditLog.reason,
        verified: selfHealAuditLog.verified,
        changesSummary: selfHealAuditLog.changesSummary,
        diff: selfHealAuditLog.diff,
      })
      .from(selfHealAuditLog)
      .orderBy(asc(selfHealAuditLog.createdAt));
  } catch {
    // DB unavailable — nothing to restore
    return;
  }

  if (rows.length === 0) return;

  const blocks: string[] = [];
  for (const row of rows) {
    // Filter to only +/- lines in case the stored diff has stray content
    const diffLines = row.diff
      ? row.diff.split("\n").filter(
          (l) => l.startsWith("+") || l.startsWith("-") || l.startsWith("…"),
        )
      : [];

    const block = [
      SEPARATOR,
      `Timestamp : ${row.timestamp}`,
      `File      : ${row.file}`,
      `Reason    : ${row.reason}`,
      `Verified  : ${row.verified}`,
      `Changes   : ${row.changesSummary}`,
      "",
      ...diffLines,
      "",
    ].join("\n");

    blocks.push(block);
  }

  // Ensure the server/ directory exists (it always does, but guard anyway)
  await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  await fs.writeFile(AUDIT_LOG_PATH, blocks.join(""), "utf-8");
  console.log(`[selfHealAudit] Restored ${rows.length} audit entries from DB.`);
}

/**
 * Read and parse the last N audit entries from the audit log.
 * If the log file is absent (e.g. after a container restart), it is
 * automatically rebuilt from the DB backup before parsing.
 * Returns an empty array if both the file and the DB are empty.
 */
export async function readAuditEntries(limit = 20): Promise<AuditEntry[]> {
  try {
    const raw = await fs.readFile(AUDIT_LOG_PATH, "utf-8");
    const all = parseAuditLog(raw);
    return all.slice(0, limit);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Flat file is missing — attempt to restore from DB, then re-read.
      try {
        await restoreFromDB();
        const raw = await fs.readFile(AUDIT_LOG_PATH, "utf-8");
        return parseAuditLog(raw).slice(0, limit);
      } catch {
        return [];
      }
    }
    throw err;
  }
}

/**
 * Return the total number of audit entries in the log.
 */
export async function countAuditEntries(): Promise<number> {
  try {
    const raw = await fs.readFile(AUDIT_LOG_PATH, "utf-8");
    return parseAuditLog(raw).length;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Count from DB when flat file is absent
      try {
        const rows = await db
          .select({ id: selfHealAuditLog.id })
          .from(selfHealAuditLog);
        return rows.length;
      } catch {
        return 0;
      }
    }
    return 0;
  }
}
