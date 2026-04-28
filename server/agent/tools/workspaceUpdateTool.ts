/**
 * workspaceUpdateTool.ts — workspace_update
 *
 * Allows the agent to read or write workspace files (SOUL.md, AGENTS.md,
 * MEMORY.md, or any .learnings/ file). Gated to the integration owner only.
 * Writes are logged to the self-heal audit log for observability.
 */

import type { AgentTool } from "../types";
import fs from "fs/promises";
import path from "path";
import { isIntegrationOwner } from "../../integrationOwner";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFileKey,
} from "../../workspace/loader";

const AUDIT_LOG = path.join(process.cwd(), "server", "self-heal-audit.log");
const VALID_FILES: WorkspaceFileKey[] = [
  "soul",
  "agents",
  "memory",
  "corrections",
  "errors",
  "feature_requests",
];

async function appendAudit(entry: string): Promise<void> {
  try {
    await fs.appendFile(AUDIT_LOG, entry + "\n", "utf-8");
  } catch {
    // Non-fatal
  }
}

export const workspaceUpdateTool: AgentTool = {
  name: "workspace_update",
  description:
    "Read or update a Jarvis workspace file. " +
    "Workspace files are plain-text instructions that are injected into every agent session:\n" +
    "  • soul           → SOUL.md (persona, character, standing instructions)\n" +
    "  • agents         → AGENTS.md (operating principles, agent behaviour rules)\n" +
    "  • memory         → MEMORY.md (HOT memory, always loaded, capped at 100 lines)\n" +
    "  • corrections    → .learnings/CORRECTIONS.md (past corrections log)\n" +
    "  • errors         → .learnings/ERRORS.md (past error log)\n" +
    "  • feature_requests → .learnings/FEATURE_REQUESTS.md\n" +
    "Use action=read to inspect a file. Use action=write to update it.\n" +
    "MEMORY.md is capped at 100 lines; corrections/errors/feature_requests at 50 entries.\n" +
    "Owner access only.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["read", "write"],
        description: "read — return the current file content. write — update the file.",
      },
      file: {
        type: "string",
        enum: VALID_FILES,
        description: "Which workspace file to read or write.",
      },
      content: {
        type: "string",
        description: "Required when action=write. The content to write or append.",
      },
      mode: {
        type: "string",
        enum: ["overwrite", "append"],
        description:
          "overwrite (default) — replace the entire file. append — add content at the end.",
      },
    },
    required: ["action", "file"],
  },

  async execute(args, ctx) {
    if (!await isIntegrationOwner(ctx.userId)) {
      return {
        ok: false,
        content: "Access denied: workspace_update is restricted to the account owner.",
        label: "workspace_update: forbidden",
      };
    }

    const action = String(args.action ?? "read");
    const fileKey = String(args.file ?? "") as WorkspaceFileKey;

    if (!VALID_FILES.includes(fileKey)) {
      return {
        ok: false,
        content: `Invalid file key "${fileKey}". Valid options: ${VALID_FILES.join(", ")}`,
        label: "workspace_update: invalid-file",
      };
    }

    if (action === "read") {
      const content = await readWorkspaceFile(fileKey);
      return {
        ok: true,
        content: content || "(file is empty)",
        label: `workspace_update: read ${fileKey}`,
      };
    }

    if (action === "write") {
      const content = args.content != null ? String(args.content) : "";
      const mode = String(args.mode ?? "overwrite") as "overwrite" | "append";

      if (!content.trim()) {
        return {
          ok: false,
          content: "content is required for action=write.",
          label: "workspace_update: missing-content",
        };
      }

      await writeWorkspaceFile(fileKey, content, mode);

      const auditLine = JSON.stringify({
        ts: new Date().toISOString(),
        event: "workspace_write",
        file: fileKey,
        mode,
        userId: ctx.userId,
        preview: content.slice(0, 120),
      });
      await appendAudit(auditLine);

      return {
        ok: true,
        content: `workspace/${fileKey} updated (${mode}). Cache invalidated.`,
        label: `workspace_update: write ${fileKey}`,
      };
    }

    return { ok: false, content: `Unknown action "${action}".`, label: "workspace_update: bad-action" };
  },
};
