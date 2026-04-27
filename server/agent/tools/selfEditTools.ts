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
import { codeProposals, inboxItems } from "@shared/schema";
import fs from "fs/promises";
import path from "path";
import { isIntegrationOwner } from "../../integrationOwner";

// ── Allow-listed source directories ────────────────────────────────────────────
// Jarvis can only read files inside these relative directories.
// Paths outside this list are always denied.
const ALLOWED_SOURCE_DIRS = [
  "server",
  "shared",
  "app",
  "components",
  "hooks",
  "constants",
  "lib",
];

// ── Hard-protected files — never readable or proposable ────────────────────────
// These files are excluded from proposals (and from reads) to prevent Jarvis
// from inadvertently modifying its own approval gate, auth system, or
// deployment pipeline.  Keep this list in sync with codeProposalsRoutes.ts.
const PROTECTED_FILES = new Set([
  "server/agent/codeProposalsRoutes.ts",
  "server/db.ts",
  "server/auth.ts",
  "server/routes.ts",
  "server/agent/harness.ts",
  "server/integrationOwner.ts",
  "server/index.ts",
  "shared/schema.ts",
]);

const MAX_FILE_LINES = 600;
const PROJECT_ROOT = process.cwd();

function isPathAllowed(filePath: string): boolean {
  const normalised = path.normalize(filePath);
  if (path.isAbsolute(normalised)) return false;
  if (normalised.startsWith("..")) return false;
  if (PROTECTED_FILES.has(normalised)) return false;
  const firstSegment = normalised.split(path.sep)[0];
  return ALLOWED_SOURCE_DIRS.includes(firstSegment);
}

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

// ── propose_code_change ────────────────────────────────────────────────────────

export const proposeCodeChangeTool: AgentTool = {
  name: "propose_code_change",
  description:
    "Propose a code change to a source file. The proposal is saved to the database and shown to the user for review — Jarvis NEVER writes files directly. " +
    "The user must approve the proposal in the 'Code Proposals' screen before any change is applied. " +
    "Use this after reading the file with read_source_file and formulating a minimal, targeted improvement. " +
    "Good reasons to propose: fixing a bug you encountered, adding a missing capability, improving a prompt, adding a tool. " +
    "Bad reasons: cosmetic refactors, changes the user didn't ask for, modifying the approval gate itself.",
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

    if (!isPathAllowed(filePath)) {
      return {
        ok: false,
        content: `Access denied: '${filePath}' is outside the allowed source directories. Proposals can only target server/, shared/, app/, components/, hooks/, constants/, or lib/.`,
        label: "propose_code_change: denied",
      };
    }
    if (!title) return { ok: false, content: "title is required.", label: "propose_code_change: error" };
    if (!reason) return { ok: false, content: "reason is required.", label: "propose_code_change: error" };
    if (!proposedContent) return { ok: false, content: "proposed_content is required.", label: "propose_code_change: error" };

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
        })
        .returning({ id: codeProposals.id });

      // Notify user via inbox
      const sourceId = `code_proposal:${row.id}`;
      await db
        .insert(inboxItems)
        .values({
          userId: ctx.userId,
          sourceType: "other",
          sourceId,
          subject: "Jarvis has a code suggestion ready for your review",
          snippet: `${title} — ${reason.slice(0, 200)}`,
          jarvisReason: `Code proposal: ${filePath}`,
          suggestedActions: [{ label: "Review", actionType: "navigate", target: "/code-proposals" }],
          status: "pending",
        })
        .onConflictDoNothing();

      console.log(`[SelfEdit] proposal ${row.id} created for user ${ctx.userId}: ${filePath}`);

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
