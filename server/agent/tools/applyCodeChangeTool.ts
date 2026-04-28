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

const PROJECT_ROOT   = process.cwd();
const AUDIT_LOG_PATH = path.join(PROJECT_ROOT, "server/self-heal-audit.log");
const AUDIT_MAX_DIFF_LINES = 300;

// Module-level map: filePath → timestamp of the most recent audit entry written for it.
// Allows recordVerificationResult() to emit a verification update without knowing the timestamp.
const lastAuditTimestamp = new Map<string, string>();

// ── Audit log helpers ─────────────────────────────────────────────────────────

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
    await fs.appendFile(AUDIT_LOG_PATH, block, "utf-8");
    lastAuditTimestamp.set(entry.filePath, ts);
  } catch {
    // Non-fatal — audit log failure must not block the write
  }
  return ts;
}

/**
 * Append a compact verification-result update to the audit log.
 * Called by selfHealTool after type-check + test suite + smoke-tests complete.
 *
 * @param filePaths - The file paths that were changed in the preceding apply step.
 * @param result    - 'passed' | 'failed' | 'error'
 * @param summary   - Optional short description of the outcome.
 */
export async function recordVerificationResult(
  filePaths: string[],
  result: "passed" | "failed" | "error",
  summary?: string,
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
    await fs.appendFile(AUDIT_LOG_PATH, block, "utf-8");
  } catch {
    // Non-fatal
  }
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
      const proposalResult = await proposeCodeChangeTool.execute(
        {
          file_path:        filePath,
          title:            `Self-heal: ${reason}`,
          reason:           `Autonomous self-heal routed to proposal — '${filePath}' is a protected file that requires explicit user approval. ${reason}`,
          proposed_content: newContent,
        },
        ctx,
      );
      return {
        ok: false,
        content: proposalResult.ok
          ? `'${filePath}' is a hard-protected file and cannot be written autonomously. ` +
            `A code proposal has been created for your review instead.\n\n${proposalResult.content}`
          : `'${filePath}' is a hard-protected file and cannot be written autonomously. ` +
            `Proposal creation also failed: ${proposalResult.content}. ` +
            `Please use propose_code_change manually to submit this change for review.`,
        label: proposalResult.ok ? "apply_code_change: protected→proposal" : "apply_code_change: protected→proposal-failed",
        detail: filePath,
      };
    }

    // ── Dangerous-pattern check → auto-create proposal (same as protected) ────
    const danger = isDangerousPath(filePath);
    if (danger.dangerous) {
      console.log(`[SelfHeal] apply_code_change: '${filePath}' is dangerous (${danger.reason}) → routing to proposal`);
      const proposalResult = await proposeCodeChangeTool.execute(
        {
          file_path:        filePath,
          title:            `Self-heal (dangerous file): ${reason}`,
          reason:           `Autonomous self-heal routed to proposal — '${filePath}' matches a dangerous-change heuristic ("${danger.reason}") and requires explicit user approval. ${reason}`,
          proposed_content: newContent,
        },
        ctx,
      );
      return {
        ok: false,
        content: proposalResult.ok
          ? `'${filePath}' matches a dangerous-change pattern ("${danger.reason}") and cannot be written autonomously. ` +
            `A code proposal has been created for your review:\n\n${proposalResult.content}`
          : `'${filePath}' matches a dangerous-change pattern ("${danger.reason}") and cannot be written autonomously. ` +
            `Proposal creation also failed: ${proposalResult.content}. ` +
            `Please use propose_code_change manually to submit this change for review.`,
        label: proposalResult.ok ? "apply_code_change: dangerous→proposal" : "apply_code_change: dangerous→proposal-failed",
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
      await recordAutonomousWrite();
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
    await appendAuditLog({ filePath, reason, before: originalContent, after: newContent });

    const diffLines = computeSimpleDiff(originalContent, newContent);
    const changeSummary = diffLines[0] ?? "unknown";

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
