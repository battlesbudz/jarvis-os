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
 */

import fs from "fs/promises";
import path from "path";

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
 * Read and parse the last N audit entries from the audit log.
 * Returns an empty array if the log doesn't exist yet.
 */
export async function readAuditEntries(limit = 20): Promise<AuditEntry[]> {
  try {
    const raw = await fs.readFile(AUDIT_LOG_PATH, "utf-8");
    const all = parseAuditLog(raw);
    return all.slice(0, limit);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
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
  } catch {
    return 0;
  }
}
