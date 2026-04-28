/**
 * apply_code_change — autonomous safe-write tool.
 *
 * For files OUTSIDE the protected list: writes directly to disk, appends a
 * timestamped before/after diff to the append-only audit log
 * (server/self-heal-audit.log), and increments the runtime circuit-breaker.
 *
 * For PROTECTED or DANGEROUS files: automatically falls back to
 * propose_code_change so the user must approve the change before anything
 * is written. Protected = hard-coded sensitive files. Dangerous = runtime
 * heuristic (migrations, credential files, build configs, lock files).
 *
 * Security model mirrors the existing tools:
 *  - Owner-gated (isIntegrationOwner)
 *  - Allow-list check (isPathAllowed from safeWritePolicy)
 *  - Protected-file check (isProtectedFile / isDangerousPath from safeWritePolicy)
 *  - Circuit breaker: max 10 autonomous writes per 60-minute window
 */

import type { AgentTool } from "../types";
import fs from "fs/promises";
import path from "path";
import { isIntegrationOwner } from "../../integrationOwner";
import {
  isPathAllowed,
  isProtectedFile,
  isDangerousPath,
  checkCircuitBreaker,
  recordAutonomousWrite,
} from "../safeWritePolicy";
import { proposeCodeChangeTool } from "./selfEditTools";
import { notifyUser } from "../../channels/registry";
import { db } from "../../db";
import { selfHealAuditLog, inboxItems } from "../../../shared/schema";
import { and, eq } from "drizzle-orm";

const PROJECT_ROOT   = process.cwd();
const AUDIT_LOG_PATH = path.join(PROJECT_ROOT, "server/self-heal-audit.log");
const AUDIT_MAX_DIFF_LINES = 300;

/** Maximum size (in bytes) the audit log may reach before it is rotated. */
const AUDIT_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** Number of rotated archive files to keep; older ones are deleted automatically. */
const AUDIT_LOG_MAX_ARCHIVES = 5;

// Module-level map: filePath → timestamp of the most recent audit entry written for it.
// Allows recordVerificationResult() to emit a verification update without knowing the timestamp.
const lastAuditTimestamp = new Map<string, string>();

// ── Audit log helpers ─────────────────────────────────────────────────────────

/**
 * If the audit log file is at or above AUDIT_LOG_MAX_BYTES, rename it to
 * `self-heal-audit.<ISO-timestamp>.log` so no history is lost, then let the
 * caller create a fresh file by appending normally.  Errors are swallowed so
 * that rotation failures never block the write that follows.
 */
async function rotateAuditLogIfNeeded(): Promise<void> {
  try {
    const stat = await fs.stat(AUDIT_LOG_PATH).catch(() => null);
    if (!stat || stat.size < AUDIT_LOG_MAX_BYTES) return;

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const rotatedPath = path.join(
      PROJECT_ROOT,
      `server/self-heal-audit.${ts}.log`,
    );
    await fs.rename(AUDIT_LOG_PATH, rotatedPath);
    console.log(`[SelfHeal] audit log rotated → ${rotatedPath}`);

    // ── Prune old archives ─────────────────────────────────────────────────
    try {
      const serverDir = path.join(PROJECT_ROOT, "server");
      const entries = await fs.readdir(serverDir);
      const archives = entries
        .filter((name) => /^self-heal-audit\..+\.log$/.test(name))
        .sort() // ISO timestamps sort lexicographically = chronologically
        .map((name) => path.join(serverDir, name));

      const toDelete = archives.slice(0, Math.max(0, archives.length - AUDIT_LOG_MAX_ARCHIVES));
      for (const archivePath of toDelete) {
        await fs.unlink(archivePath);
        console.log(`[SelfHeal] deleted old audit archive → ${archivePath}`);
      }
    } catch {
      // Non-fatal — pruning failure must not block the write
    }
  } catch {
    // Non-fatal — rotation failure must not block the write
  }
}

/**
 * Prune excess audit log archives unconditionally.  Call once on server
 * startup so archives that accumulated before auto-cleanup shipped are
 * removed immediately, without waiting for the next rotation event.
 */
export async function pruneAuditLogArchivesOnStartup(): Promise<void> {
  try {
    const serverDir = path.join(PROJECT_ROOT, "server");
    const entries = await fs.readdir(serverDir);
    const archives = entries
      .filter((name) => /^self-heal-audit\..+\.log$/.test(name))
      .sort()
      .map((name) => path.join(serverDir, name));

    const toDelete = archives.slice(0, Math.max(0, archives.length - AUDIT_LOG_MAX_ARCHIVES));
    for (const archivePath of toDelete) {
      await fs.unlink(archivePath);
      console.log(`[SelfHeal] startup: deleted old audit archive → ${archivePath}`);
    }
    if (toDelete.length === 0) {
      console.log(`[SelfHeal] startup: audit archive count OK (${archives.length}/${AUDIT_LOG_MAX_ARCHIVES} max)`);
    }
  } catch (err) {
    console.warn("[SelfHeal] startup archive prune failed (non-fatal):", err);
  }
}

function computeSimpleDiff(before: string, after: string): string[] {
  const bs = before.split("\n");
  const as = after.split("\n");
  const max = Math.max(bs.length, as.length);
  const diff: string[] = [];
  let added = 0;
  let removed = 0;
  for (let i = 0; i < max; i++) {
    const b = bs[i];
    const a = as[i];
    if (b !== a) {
      if (b !== undefined) { diff.push(`- ${b}`); removed++; }
      if (a !== undefined) { diff.push(`+ ${a}`); added++; }
    }
  }
  return [`+${added} -${removed} lines`, ...diff];
}

async function appendAuditLog(entry: {
  filePath: string;
  reason: string;
  before: string;
  after: string;
}): Promise<string> {
  const sep   = "─".repeat(72);
  const ts    = new Date().toISOString();
  const diff  = computeSimpleDiff(entry.before, entry.after);
  const capped = diff.length > AUDIT_MAX_DIFF_LINES
    ? [...diff.slice(0, AUDIT_MAX_DIFF_LINES), `…[diff truncated at ${AUDIT_MAX_DIFF_LINES} lines]`]
    : diff;

  const block = [
    sep,
    `Timestamp : ${ts}`,
    `File      : ${entry.filePath}`,
    `Reason    : ${entry.reason}`,
    `Verified  : pending`,
    `Changes   : ${capped[0]}`,
    "",
    ...capped.slice(1),
    "",
  ].join("\n");

  try {
    await rotateAuditLogIfNeeded();
    await fs.appendFile(AUDIT_LOG_PATH, block, "utf-8");
    lastAuditTimestamp.set(entry.filePath, ts);
  } catch {
    // Non-fatal — audit log failure must not block the write
  }

  // Mirror to DB so the history survives container restarts (fire-and-forget).
  db.insert(selfHealAuditLog).values({
    timestamp: ts,
    file: entry.filePath,
    reason: entry.reason,
    verified: "pending",
    changesSummary: capped[0] ?? "",
    diff: capped.slice(1).join("\n"),
  }).catch(() => {});

  return ts;
}

/**
 * Append a compact verification-result update to the audit log and, when a
 * userId is provided, send a follow-up notification via the user's self_repair
 * channel preference so they learn whether the fix actually compiled / tested.
 *
 * @param filePaths - The file paths that were changed in the preceding apply step.
 * @param result    - 'passed' | 'failed' | 'error'
 * @param summary   - Optional short description of the outcome.
 * @param userId    - When supplied, a follow-up notification is sent to the user.
 */
export async function recordVerificationResult(
  filePaths: string[],
  result: "passed" | "failed" | "error",
  summary?: string,
  userId?: string,
): Promise<void> {
  const updates: string[] = [];
  for (const fp of filePaths) {
    const ts = lastAuditTimestamp.get(fp);
    if (!ts) continue;
    const summaryPart = summary ? ` — ${summary}` : "";
    updates.push(`[VERIFY] ${ts} ${fp}: ${result}${summaryPart}`);
  }
  if (updates.length === 0) return;
  const block = updates.join("\n") + "\n";
  try {
    await rotateAuditLogIfNeeded();
    await fs.appendFile(AUDIT_LOG_PATH, block, "utf-8");
  } catch {
    // Non-fatal
  }

  // Mirror verification status update to DB (fire-and-forget).
  for (const fp of filePaths) {
    const ts = lastAuditTimestamp.get(fp);
    if (!ts) continue;
    const summaryPart = summary ? ` — ${summary}` : "";
    db.update(selfHealAuditLog)
      .set({ verified: `${result}${summaryPart}` })
      .where(and(eq(selfHealAuditLog.timestamp, ts), eq(selfHealAuditLog.file, fp)))
      .catch(() => {});
  }

  // ── Follow-up notification ────────────────────────────────────────────────
  if (!userId) return;

  const fileList = filePaths.join(", ");
  const summaryLine = summary ? `\nDetails: ${summary}` : "";

  let notifyText: string;
  if (result === "passed") {
    notifyText =
      `[Self-repair ✅] Verification passed for ${fileList}` +
      summaryLine;
  } else {
    // Build a deep link to the specific audit log entry so the user can tap
    // straight into the relevant entry without hunting through the log.
    const firstFile = filePaths[0];
    const firstTs   = firstFile ? lastAuditTimestamp.get(firstFile) : undefined;
    let cta: string;
    if (firstFile && firstTs) {
      const deepLink =
        `gameplan://agents?auditTs=${encodeURIComponent(firstTs)}` +
        `&auditFile=${encodeURIComponent(firstFile)}`;
      cta = `\nView audit entry: ${deepLink}`;
    } else {
      cta = "\nOpen the Agents tab and check the Self-Repairs section.";
    }
    notifyText =
      `[Self-repair ⚠] Verification ${result} for ${fileList}` +
      summaryLine +
      cta;

    // ── Inbox alert for failed/error repairs ──────────────────────────────
    // Passing repairs are intentionally excluded to avoid noise.
    const inboxSourceId = `self-repair:${result}:${firstTs ?? Date.now()}:${firstFile ?? "unknown"}`;
    const snippetLines: string[] = [
      `Verification ${result} for: ${fileList}`,
    ];
    if (summary) snippetLines.push(`Details: ${summary}`);
    snippetLines.push("Open the Self-Repair Log in the Agents tab for the full diff.");
    const inboxSnippet = snippetLines.join("\n");

    db.insert(inboxItems).values({
      userId,
      sourceType: "other",
      sourceId: inboxSourceId,
      subject: `Self-repair ${result}: ${firstFile ?? fileList}`,
      snippet: inboxSnippet.slice(0, 600),
      jarvisReason: "A self-repair change failed its verification step and needs your attention.",
      suggestedActions: [
        { label: "View Self-Repair Log", actionType: "navigate_self_repair" },
        { label: "Dismiss", actionType: "dismiss" },
      ],
      status: "pending",
    }).onConflictDoNothing().catch(() => {});
  }

  notifyUser(userId, "self_repair", notifyText).catch(() => {});
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const applyCodeChangeTool: AgentTool = {
  name: "apply_code_change",
  description:
    "Autonomously write a targeted code change to disk for files outside the protected list. " +
    "For protected files (auth, DB schema, approval routes, harness, etc.) the change is " +
    "automatically routed to a user-approval proposal instead of being written directly. " +
    "Every write is recorded in server/self-heal-audit.log with a before/after diff. " +
    "A circuit breaker limits autonomous writes to 10 per 60-minute window to prevent runaway loops. " +
    "Use this inside the self_heal loop to apply targeted fixes. " +
    "Keep changes minimal and surgical — always pass the COMPLETE file content, not a partial patch.",
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description:
          "Relative path from project root (e.g. 'server/agent/tools/myTool.ts'). " +
          "Must be inside an allowed base directory (server/, shared/, app/, components/, hooks/, constants/, lib/).",
      },
      new_content: {
        type: "string",
        description:
          "The complete new file content to write (full file replacement, not a diff or patch).",
      },
      reason: {
        type: "string",
        description:
          "One-line explanation of what this change fixes or adds (recorded in the audit log).",
      },
    },
    required: ["file_path", "new_content", "reason"],
  },

  async execute(args, ctx) {
    if (!await isIntegrationOwner(ctx.userId)) {
      return {
        ok: false,
        content: "Access denied: only the account owner may apply code changes autonomously.",
        label: "apply_code_change: forbidden",
      };
    }

    const filePath   = String(args.file_path   ?? "").trim();
    const newContent = String(args.new_content  ?? "");
    const reason     = String(args.reason       ?? "").trim();

    if (!filePath)    return { ok: false, content: "file_path is required.",   label: "apply_code_change: error" };
    if (!newContent)  return { ok: false, content: "new_content is required.", label: "apply_code_change: error" };
    if (!reason)      return { ok: false, content: "reason is required.",      label: "apply_code_change: error" };

    // ── Protected file → route to propose_code_change ─────────────────────────
    if (isProtectedFile(filePath)) {
      console.log(`[SelfHeal] apply_code_change: '${filePath}' is protected → routing to proposal`);
      let proposalOk = false;
      let proposalContent = "";
      try {
        const proposalResult = await proposeCodeChangeTool.execute(
          {
            file_path:        filePath,
            title:            `Self-heal: ${reason}`,
            reason:           `Autonomous self-heal routed to proposal — '${filePath}' is a protected file that requires explicit user approval. ${reason}`,
            proposed_content: newContent,
          },
          ctx,
        );
        proposalOk = proposalResult.ok;
        proposalContent = proposalResult.content;
      } catch (err) {
        proposalContent = err instanceof Error ? err.message : String(err);
      }
      return {
        ok: false,
        content: proposalOk
          ? `'${filePath}' is a hard-protected file and cannot be written autonomously. ` +
            `A code proposal has been created for your review instead.\n\n${proposalContent}`
          : `'${filePath}' is a hard-protected file and cannot be written autonomously. ` +
            `Proposal creation also failed: ${proposalContent}. ` +
            `Please use propose_code_change manually to submit this change for review.`,
        label: proposalOk ? "apply_code_change: protected→proposal" : "apply_code_change: protected→proposal-failed",
        detail: filePath,
      };
    }

    // ── Dangerous-pattern check → auto-create proposal (same as protected) ────
    const danger = isDangerousPath(filePath);
    if (danger.dangerous) {
      console.log(`[SelfHeal] apply_code_change: '${filePath}' is dangerous (${danger.reason}) → routing to proposal`);
      let proposalOk = false;
      let proposalContent = "";
      try {
        const proposalResult = await proposeCodeChangeTool.execute(
          {
            file_path:        filePath,
            title:            `Self-heal (dangerous file): ${reason}`,
            reason:           `Autonomous self-heal routed to proposal — '${filePath}' matches a dangerous-change heuristic ("${danger.reason}") and requires explicit user approval. ${reason}`,
            proposed_content: newContent,
          },
          ctx,
        );
        proposalOk = proposalResult.ok;
        proposalContent = proposalResult.content;
      } catch (err) {
        proposalContent = err instanceof Error ? err.message : String(err);
      }
      return {
        ok: false,
        content: proposalOk
          ? `'${filePath}' matches a dangerous-change pattern ("${danger.reason}") and cannot be written autonomously. ` +
            `A code proposal has been created for your review:\n\n${proposalContent}`
          : `'${filePath}' matches a dangerous-change pattern ("${danger.reason}") and cannot be written autonomously. ` +
            `Proposal creation also failed: ${proposalContent}. ` +
            `Please use propose_code_change manually to submit this change for review.`,
        label: proposalOk ? "apply_code_change: dangerous→proposal" : "apply_code_change: dangerous→proposal-failed",
        detail: danger.reason,
      };
    }

    // ── Allow-list check ──────────────────────────────────────────────────────
    if (!isPathAllowed(filePath)) {
      return {
        ok: false,
        content:
          `'${filePath}' is outside the allowed source directories. ` +
          `Only server/, shared/, app/, components/, hooks/, constants/, lib/ may be written.`,
        label: "apply_code_change: denied",
      };
    }

    // ── Circuit-breaker check ─────────────────────────────────────────────────
    const circuit = await checkCircuitBreaker();
    if (circuit.tripped) {
      return {
        ok: false,
        content:
          `Circuit breaker tripped: ${circuit.count} autonomous writes have occurred in the last 60 minutes ` +
          `(limit: 10). The self-heal loop is paused. ` +
          `Please review the recent changes in server/self-heal-audit.log and confirm it is safe to continue. ` +
          `The write budget resets at ${circuit.resetAt?.toISOString() ?? "unknown"}.`,
        label: "apply_code_change: circuit-tripped",
      };
    }

    // ── Read original content for diff and no-op detection ───────────────────
    let originalContent = "";
    try {
      const absPath = path.join(PROJECT_ROOT, filePath);
      originalContent = await fs.readFile(absPath, "utf-8");
    } catch {
      // File does not exist yet — treat as a new file (empty original)
    }

    if (originalContent === newContent) {
      return {
        ok: true,
        content: `No change applied — '${filePath}' already matches the proposed content.`,
        label: "apply_code_change: no-op",
        detail: filePath,
      };
    }

    // ── Write the file ────────────────────────────────────────────────────────
    try {
      const absPath = path.join(PROJECT_ROOT, filePath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, newContent, "utf-8");
      await recordAutonomousWrite(filePath);
      const newCount = circuit.count + 1;
      console.log(`[SelfHeal] wrote '${filePath}' (circuit: ${newCount}/10 in last 60 min)`);
    } catch (err) {
      return {
        ok: false,
        content: `Failed to write '${filePath}': ${err instanceof Error ? err.message : String(err)}`,
        label: "apply_code_change: write-error",
      };
    }

    // ── Audit log (non-blocking) ──────────────────────────────────────────────
    const auditTs = await appendAuditLog({ filePath, reason, before: originalContent, after: newContent });

    const diffLines = computeSimpleDiff(originalContent, newContent);
    const changeSummary = diffLines[0] ?? "unknown";

    // ── Self-repair notification (fire-and-forget, non-blocking) ─────────────
    const deepLink =
      `gameplan://agents?auditTs=${encodeURIComponent(auditTs)}` +
      `&auditFile=${encodeURIComponent(filePath)}`;
    const notifyText =
      `[Self-repair] Jarvis updated ${filePath}\n` +
      `Change: ${changeSummary}\n` +
      `Reason: ${reason}\n` +
      `View audit entry: ${deepLink}`;
    notifyUser(ctx.userId, "self_repair", notifyText).catch(() => {});

    return {
      ok: true,
      content:
        `Successfully wrote '${filePath}' (${changeSummary}). ` +
        `Change logged to server/self-heal-audit.log. ` +
        `Circuit breaker: ${circuit.count + 1}/10 autonomous writes in the last 60 min.`,
      label: `apply_code_change: ${filePath}`,
      detail: reason,
    };
  },
};
