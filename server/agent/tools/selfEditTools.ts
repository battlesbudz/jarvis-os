/**
 * Self-edit capability tools — allow Jarvis to inspect its own source code and
 * propose targeted improvements via a user-gated approval flow.
 *
 * Security model:
 *  - `list_source_files` and `read_source_file` are strictly read-only.
 *  - `propose_code_change` ONLY writes a DB record — never touches the filesystem.
 *  - The approve endpoint (codeProposalsRoutes.ts) re-validates the path allow-list
 *    before writing any file.
 */

import type { AgentTool } from "../types";
import { db } from "../../db";
import { codeProposals, inboxItems, systemErrorLog } from "@shared/schema";
import type { DebugContext } from "@shared/schema";
import fs from "fs/promises";
import path from "path";
import { isIntegrationOwner } from "../../integrationOwner";
import { desc, and, eq, gte } from "drizzle-orm";
import {
  ALLOWED_SOURCE_DIRS,
  isPathAllowed,
  isPathAllowedForProposal,
} from "../safeWritePolicy";

const MAX_FILE_LINES = 600;
const PROJECT_ROOT = process.cwd();

// ── list_source_files ──────────────────────────────────────────────────────────

export const listSourceFilesTool: AgentTool = {
  name: "list_source_files",
  description:
    "List source files in an allowed project directory. Use this to explore the codebase before proposing a change or when the user asks you to inspect your own code. " +
    "Allowed base directories: server/, shared/, app/, components/, hooks/, constants/, lib/. " +
    "Returns a tree of .ts and .tsx file paths relative to the project root.",
  parameters: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description:
          "Directory to list (relative to project root, e.g. 'server/agent/tools' or 'server/capabilities'). Must be inside an allowed base directory.",
      },
    },
    required: ["directory"],
  },
  async execute(args, ctx) {
    if (!await isIntegrationOwner(ctx.userId)) {
      return { ok: false, content: "Access denied: self-edit tools are only available to the account owner.", label: "list_source_files: forbidden" };
    }
    const dir = String(args.directory ?? "").trim();
    if (!isPathAllowed(dir)) {
      return {
        ok: false,
        content: `Access denied: '${dir}' is outside the allowed source directories (${ALLOWED_SOURCE_DIRS.join(", ")}).`,
        label: "list_source_files: denied",
      };
    }

    try {
      const absDir = path.join(PROJECT_ROOT, dir);
      const files = await collectSourceFiles(absDir, PROJECT_ROOT);
      if (files.length === 0) {
        return { ok: true, content: `No .ts/.tsx files found in '${dir}'.`, label: "list_source_files: empty" };
      }
      return {
        ok: true,
        content: `Files in ${dir}:\n${files.join("\n")}`,
        label: `list_source_files: ${files.length} file(s)`,
        detail: dir,
      };
    } catch (err) {
      return {
        ok: false,
        content: `Could not list '${dir}': ${err instanceof Error ? err.message : String(err)}`,
        label: "list_source_files: error",
      };
    }
  },
};

async function collectSourceFiles(absDir: string, root: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const sub = await collectSourceFiles(abs, root);
      results.push(...sub);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(path.relative(root, abs));
    }
  }
  return results;
}

// ── read_source_file ───────────────────────────────────────────────────────────

export const readSourceFileTool: AgentTool = {
  name: "read_source_file",
  description:
    "Read the contents of a single source file. Use this to understand existing code before proposing a change. " +
    `Returns up to ${MAX_FILE_LINES} lines. For large files, use the offset parameter to page through sections. ` +
    "Only files inside allowed base directories (server/, shared/, app/, components/, hooks/, constants/, lib/) can be read.",
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Relative path from project root (e.g. 'server/capabilities/systemCapability.ts').",
      },
      offset: {
        type: "number",
        description: "Optional: 1-based line number to start reading from. Default: 1.",
      },
    },
    required: ["file_path"],
  },
  async execute(args, ctx) {
    if (!await isIntegrationOwner(ctx.userId)) {
      return { ok: false, content: "Access denied: self-edit tools are only available to the account owner.", label: "read_source_file: forbidden" };
    }
    const filePath = String(args.file_path ?? "").trim();
    if (!isPathAllowed(filePath)) {
      return {
        ok: false,
        content: `Access denied: '${filePath}' is outside the allowed source directories.`,
        label: "read_source_file: denied",
      };
    }

    try {
      const absPath = path.join(PROJECT_ROOT, filePath);
      const raw = await fs.readFile(absPath, "utf-8");
      const allLines = raw.split("\n");
      const totalLines = allLines.length;
      const offset = Math.max(1, Math.floor(Number(args.offset ?? 1)));
      const start = offset - 1;
      const slice = allLines.slice(start, start + MAX_FILE_LINES);
      const numbered = slice.map((line, i) => `${String(start + i + 1).padStart(4)}: ${line}`).join("\n");
      const truncNote =
        totalLines > start + MAX_FILE_LINES
          ? `\n\n[Showing lines ${offset}–${start + MAX_FILE_LINES} of ${totalLines}. Use offset=${start + MAX_FILE_LINES + 1} to continue.]`
          : "";

      return {
        ok: true,
        content: `// ${filePath} (lines ${offset}–${Math.min(start + MAX_FILE_LINES, totalLines)} of ${totalLines})\n\n${numbered}${truncNote}`,
        label: `read_source_file: ${filePath}`,
        detail: `${Math.min(slice.length, MAX_FILE_LINES)} lines returned`,
      };
    } catch (err) {
      return {
        ok: false,
        content: `Could not read '${filePath}': ${err instanceof Error ? err.message : String(err)}`,
        label: "read_source_file: error",
      };
    }
  },
};

// ── read_recent_errors ─────────────────────────────────────────────────────────

export const readRecentErrorsTool: AgentTool = {
  name: "read_recent_errors",
  description:
    "Read recent entries from the system error log. Use this as the first step in a debug session to understand what has been going wrong. " +
    "You can filter by source module (e.g. 'integrationValidator', 'jobQueue', 'telegram') and choose a lookback window. " +
    "Returns up to 20 entries by default. Use this when the user says a feature is broken or after a health check failure is reported.",
  parameters: {
    type: "object",
    properties: {
      source_filter: {
        type: "string",
        description: "Optional: filter errors whose source contains this string (case-insensitive). E.g. 'telegram', 'jobQueue', 'integrationValidator'.",
      },
      lookback_minutes: {
        type: "number",
        description: "Optional: only return errors from the last N minutes. Default: 60. Max: 1440 (24h).",
      },
      limit: {
        type: "number",
        description: "Optional: max number of rows to return. Default: 20. Max: 50.",
      },
    },
    required: [],
  },
  async execute(args, ctx) {
    if (!await isIntegrationOwner(ctx.userId)) {
      return { ok: false, content: "Access denied: self-edit tools are only available to the account owner.", label: "read_recent_errors: forbidden" };
    }

    const lookbackMinutes = Math.min(Math.max(1, Number(args.lookback_minutes ?? 60)), 1440);
    const limit = Math.min(Math.max(1, Number(args.limit ?? 20)), 50);
    const sourceFilter = typeof args.source_filter === "string" ? args.source_filter.trim().toLowerCase() : null;

    try {
      const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);
      const rows = await db
        .select()
        .from(systemErrorLog)
        .where(gte(systemErrorLog.createdAt, since))
        .orderBy(desc(systemErrorLog.createdAt))
        .limit(sourceFilter ? 200 : limit); // fetch more if filtering locally

      const filtered = sourceFilter
        ? rows.filter((r) => r.source.toLowerCase().includes(sourceFilter)).slice(0, limit)
        : rows;

      if (filtered.length === 0) {
        return {
          ok: true,
          content: `No errors found in the last ${lookbackMinutes} minutes${sourceFilter ? ` matching source="${sourceFilter}"` : ""}.`,
          label: "read_recent_errors: 0 results",
        };
      }

      const formatted = filtered.map((r, i) => {
        const lines = [
          `[${i + 1}] ID: ${r.id}`,
          `    Time: ${r.createdAt.toISOString()}`,
          `    Source: ${r.source}`,
          `    Level: ${r.level}`,
          `    Message: ${r.message}`,
        ];
        if (r.stackTrace) {
          lines.push(`    Stack: ${r.stackTrace.slice(0, 500)}`);
        }
        const ctx = r.contextJson as Record<string, unknown>;
        if (ctx && Object.keys(ctx).length > 0) {
          lines.push(`    Context: ${JSON.stringify(ctx).slice(0, 300)}`);
        }
        return lines.join("\n");
      }).join("\n\n");

      return {
        ok: true,
        content: `Found ${filtered.length} error(s) in the last ${lookbackMinutes}min:\n\n${formatted}`,
        label: `read_recent_errors: ${filtered.length} result(s)`,
        detail: `lookback=${lookbackMinutes}min source=${sourceFilter ?? "all"}`,
      };
    } catch (err) {
      return {
        ok: false,
        content: `Failed to query error log: ${err instanceof Error ? err.message : String(err)}`,
        label: "read_recent_errors: error",
      };
    }
  },
};

// ── propose_code_change ────────────────────────────────────────────────────────

export const proposeCodeChangeTool: AgentTool = {
  name: "propose_code_change",
  description:
    "Propose a code change to a source file. The proposal is saved to the database and shown to the user for review — Jarvis NEVER writes files directly. " +
    "The user must approve the proposal in the 'Code Proposals' screen before any change is applied. " +
    "Use this after reading the file with read_source_file and formulating a minimal, targeted improvement. " +
    "Good reasons to propose: fixing a bug you encountered, adding a missing capability, improving a prompt, adding a tool. " +
    "Bad reasons: cosmetic refactors, changes the user didn't ask for, modifying the approval gate itself. " +
    "IMPORTANT: Before creating a proposal for a file, check whether a pending proposal already exists for the same file — if one does, skip re-investigation and tell the user to review the existing proposal first.",
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Relative path of the file to modify (e.g. 'server/capabilities/systemCapability.ts').",
      },
      title: {
        type: "string",
        description: "Short title for the proposal shown in the UI (e.g. 'Fix retry logic in email sender').",
      },
      reason: {
        type: "string",
        description: "Plain-English explanation of what problem this fixes or capability it adds. One to three sentences.",
      },
      proposed_content: {
        type: "string",
        description: "The complete proposed file content after the change. Must be a full file replacement, not a partial diff.",
      },
      debug_context: {
        type: "object",
        description: "Optional: attach debug information when this proposal originates from a self-debugging session. Include errorMessage, stackExcerpt, and rootCauseSummary.",
        properties: {
          error_message: { type: "string" },
          stack_excerpt: { type: "string" },
          root_cause_summary: { type: "string" },
          error_log_id: { type: "string" },
        },
      },
    },
    required: ["file_path", "title", "reason", "proposed_content"],
  },
  async execute(args, ctx) {
    if (!await isIntegrationOwner(ctx.userId)) {
      return { ok: false, content: "Access denied: self-edit tools are only available to the account owner.", label: "propose_code_change: forbidden" };
    }
    const filePath = String(args.file_path ?? "").trim();
    const title = String(args.title ?? "").trim();
    const reason = String(args.reason ?? "").trim();
    const proposedContent = String(args.proposed_content ?? "");

    // Proposals write only to the database (never to disk until user approves),
    // so protected files are allowed here. The approve endpoint enforces a
    // secondary path check and will refuse to write protected files autonomously.
    if (!isPathAllowedForProposal(filePath)) {
      return {
        ok: false,
        content: `Access denied: '${filePath}' is outside the allowed source directories. Proposals can only target server/, shared/, app/, components/, hooks/, constants/, or lib/.`,
        label: "propose_code_change: denied",
      };
    }
    if (!title) return { ok: false, content: "title is required.", label: "propose_code_change: error" };
    if (!reason) return { ok: false, content: "reason is required.", label: "propose_code_change: error" };
    if (!proposedContent) return { ok: false, content: "proposed_content is required.", label: "propose_code_change: error" };

    // ── Duplicate suppression: skip if a pending proposal already exists for the same file ──
    try {
      const existing = await db
        .select({ id: codeProposals.id })
        .from(codeProposals)
        .where(
          and(
            eq(codeProposals.userId, ctx.userId),
            eq(codeProposals.filePath, filePath),
            eq(codeProposals.status, "pending"),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        return {
          ok: false,
          content: `A pending proposal for '${filePath}' already exists (ID: ${existing[0].id}). The user must review and resolve that proposal before a new one can be created for the same file. Notify the user to check the Code Proposals screen.`,
          label: "propose_code_change: duplicate suppressed",
        };
      }
    } catch {
      // Non-fatal — proceed without duplicate check if DB is unavailable
    }

    let originalContent = "";
    try {
      const absPath = path.join(PROJECT_ROOT, filePath);
      originalContent = await fs.readFile(absPath, "utf-8");
    } catch (err) {
      return {
        ok: false,
        content: `Could not read '${filePath}' to snapshot original: ${err instanceof Error ? err.message : String(err)}`,
        label: "propose_code_change: error",
      };
    }

    if (originalContent === proposedContent) {
      return {
        ok: false,
        content: "proposed_content is identical to the current file. No change would be applied.",
        label: "propose_code_change: no-op",
      };
    }

    // Build optional debug_context from args
    let debugCtx: DebugContext | undefined;
    if (args.debug_context && typeof args.debug_context === "object") {
      const dc = args.debug_context as Record<string, unknown>;
      if (dc.error_message || dc.root_cause_summary) {
        debugCtx = {
          errorMessage: String(dc.error_message ?? ""),
          stackExcerpt: dc.stack_excerpt ? String(dc.stack_excerpt).slice(0, 800) : undefined,
          rootCauseSummary: String(dc.root_cause_summary ?? ""),
          errorLogId: dc.error_log_id ? String(dc.error_log_id) : undefined,
        };
      }
    }

    try {
      const [row] = await db
        .insert(codeProposals)
        .values({
          userId: ctx.userId,
          title,
          reason,
          filePath,
          originalContent,
          proposedContent,
          status: "pending",
          debugContext: debugCtx ?? null,
        })
        .returning({ id: codeProposals.id });

      // Notify user via inbox
      const sourceId = `code_proposal:${row.id}`;
      const isDebug = !!debugCtx;
      await db
        .insert(inboxItems)
        .values({
          userId: ctx.userId,
          sourceType: "other",
          sourceId,
          subject: isDebug
            ? "Jarvis found a bug and has a fix ready for your review"
            : "Jarvis has a code suggestion ready for your review",
          snippet: `${title} — ${reason.slice(0, 200)}`,
          jarvisReason: `Code proposal: ${filePath}`,
          suggestedActions: [{ label: "Review", actionType: "navigate", target: "/code-proposals" }],
          status: "pending",
        })
        .onConflictDoNothing();

      console.log(`[SelfEdit] proposal ${row.id} created for user ${ctx.userId}: ${filePath}${isDebug ? " [debug]" : ""}`);

      return {
        ok: true,
        content: `Proposal saved (ID: ${row.id}). The user will see it in the Code Proposals screen and can approve or reject it. The file will not be changed until they approve.`,
        label: `propose_code_change: proposal ${row.id}`,
        detail: `${filePath} — ${title}`,
      };
    } catch (err) {
      return {
        ok: false,
        content: `Failed to save proposal: ${err instanceof Error ? err.message : String(err)}`,
        label: "propose_code_change: error",
      };
    }
  },
};
