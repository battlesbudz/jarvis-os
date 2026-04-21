import type { AgentTool } from "../types";
import {
  createDriveTextFile,
  listJarvisDriveFiles,
  readDriveFile,
} from "../../integrations/googleDrive";

function noDrive() {
  return {
    ok: false as const,
    content:
      "Google Drive is not available — the user needs to reconnect their Google account from the Profile screen so Jarvis can request the drive.file scope.",
    label: "Drive not connected",
  };
}

export const driveCreateFileTool: AgentTool = {
  name: "drive_create_file",
  description:
    "Create a new file in the user's Google Drive inside the 'Jarvis' folder (created automatically). Use this for content the user wants saved to Drive — meeting notes, briefs, plans, etc. Set as_google_doc=true to save as an editable Google Doc; otherwise it's saved as markdown.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "File name (without extension; one will be added if needed)" },
      content: { type: "string", description: "File body text/markdown" },
      as_google_doc: {
        type: "boolean",
        description: "If true, convert to an editable Google Doc. If false (default), save as a .md file.",
      },
    },
    required: ["name", "content"],
  },
  async execute(args, ctx) {
    if (!ctx.googleAccessToken) return noDrive();
    const a = args as { name?: string; content?: string; as_google_doc?: boolean };

    let name = String(a.name || "").trim().slice(0, 200) || "Untitled";
    const asDoc = !!a.as_google_doc;
    if (!asDoc && !/\.[a-zA-Z0-9]{1,8}$/.test(name)) name += ".md";

    try {
      const file = await createDriveTextFile(ctx.googleAccessToken, name, String(a.content || ""), {
        convertToDoc: asDoc,
      });
      console.log(`[${ctx.channel || "Agent"}] drive_create_file name="${name}" asDoc=${asDoc} id=${file.fileId}`);
      return {
        ok: true,
        content: `Saved to Google Drive: "${file.name}" — ${file.webViewLink}`,
        label: `Saved to Drive: ${file.name}`,
        detail: file.webViewLink,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const insufficientScope = /insufficient|scope|permission/i.test(msg);
      return {
        ok: false,
        content: insufficientScope
          ? "Drive write failed — the user's Google connection is missing the drive.file scope. Ask them to reconnect Google in the Profile screen."
          : `Drive write failed: ${msg}`,
        label: "Drive write failed",
        detail: msg,
      };
    }
  },
};

export const driveListFilesTool: AgentTool = {
  name: "drive_list_files",
  description:
    "List files Jarvis has previously saved to the user's Google Drive (in the Jarvis folder).",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max files to return (default 20)" },
    },
  },
  async execute(args, ctx) {
    if (!ctx.googleAccessToken) return noDrive();
    const limit = Number((args as { limit?: number }).limit) || 20;
    try {
      const files = await listJarvisDriveFiles(ctx.googleAccessToken, limit);
      if (files.length === 0) {
        return { ok: true, content: "No files in the Jarvis Drive folder yet.", label: "Drive: 0 files" };
      }
      const formatted = files
        .map((f) => `- [id:${f.id}] "${f.name}" (${f.mimeType})${f.modifiedTime ? ` modified ${f.modifiedTime}` : ""}`)
        .join("\n");
      return {
        ok: true,
        content: `Files in Jarvis Drive folder:\n${formatted}`,
        label: `Drive: ${files.length} files`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Drive list failed: ${msg}`, label: "Drive list failed" };
    }
  },
};

/**
 * Extracts a Drive file id from either a raw id or a Drive URL.
 * Accepts: bare id, /file/d/<id>/..., open?id=<id>, /document/d/<id>/...
 */
export function parseDriveFileId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // Bare id (Drive ids are typically 25+ alphanum/underscore/dash)
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  // /d/<id>/ pattern (files, docs, sheets)
  const dMatch = s.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (dMatch) return dMatch[1];
  // ?id=<id> pattern
  try {
    const url = new URL(s);
    const idParam = url.searchParams.get("id");
    if (idParam && /^[A-Za-z0-9_-]{20,}$/.test(idParam)) return idParam;
  } catch {
    // not a URL
  }
  return null;
}

interface DriveReadArgs {
  file_id?: string;
  url?: string;
}

export const driveReadFileTool: AgentTool = {
  name: "drive_read_file",
  description:
    "Read the contents of a Drive file by id or by full Drive URL (e.g. https://drive.google.com/file/d/<id>/view or a Google Doc URL). Returns up to ~12k characters.",
  parameters: {
    type: "object",
    properties: {
      file_id: { type: "string", description: "Drive file ID from drive_list_files (preferred when known)" },
      url: { type: "string", description: "Full Drive/Docs URL — id will be parsed from it" },
    },
  },
  async execute(args, ctx) {
    if (!ctx.googleAccessToken) return noDrive();
    const a = args as DriveReadArgs;
    const raw = (a.file_id && a.file_id.trim()) || (a.url && a.url.trim()) || "";
    if (!raw) {
      return { ok: false, content: "Either file_id or url is required.", label: "Missing id" };
    }
    const id = parseDriveFileId(raw);
    if (!id) {
      return {
        ok: false,
        content: `Could not parse a Drive file id from "${raw}". Pass either a bare id or a Drive URL.`,
        label: "Invalid Drive id/url",
      };
    }
    try {
      const f = await readDriveFile(ctx.googleAccessToken, id);
      const body = f.content.slice(0, 12000);
      return {
        ok: true,
        content: `File "${f.name}" (${f.mimeType}):\n\n${body}`,
        label: `Read Drive file: ${f.name}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Drive read failed: ${msg}`, label: "Drive read failed", detail: msg };
    }
  },
};
