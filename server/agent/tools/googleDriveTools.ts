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

    let name = String(args.name || "").trim().slice(0, 200) || "Untitled";
    const asDoc = !!args.as_google_doc;
    if (!asDoc && !/\.[a-zA-Z0-9]{1,8}$/.test(name)) name += ".md";

    try {
      const file = await createDriveTextFile(ctx.googleAccessToken, name, String(args.content || ""), {
        convertToDoc: asDoc,
      });
      console.log(`[${ctx.channel || "Agent"}] drive_create_file name="${name}" asDoc=${asDoc} id=${file.fileId}`);
      return {
        ok: true,
        content: `Saved to Google Drive: "${file.name}" — ${file.webViewLink}`,
        label: `Saved to Drive: ${file.name}`,
        detail: file.webViewLink,
      };
    } catch (err: any) {
      const msg = String(err?.message || err);
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
    try {
      const files = await listJarvisDriveFiles(ctx.googleAccessToken, Number(args.limit) || 20);
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
    } catch (err: any) {
      return { ok: false, content: `Drive list failed: ${err?.message || err}`, label: "Drive list failed" };
    }
  },
};

export const driveReadFileTool: AgentTool = {
  name: "drive_read_file",
  description:
    "Read the contents of a file from the Jarvis folder in the user's Google Drive by id. Returns up to ~12k characters.",
  parameters: {
    type: "object",
    properties: {
      file_id: { type: "string", description: "Drive file ID from drive_list_files" },
    },
    required: ["file_id"],
  },
  async execute(args, ctx) {
    if (!ctx.googleAccessToken) return noDrive();
    try {
      const f = await readDriveFile(ctx.googleAccessToken, String(args.file_id));
      const body = f.content.slice(0, 12000);
      return {
        ok: true,
        content: `File "${f.name}" (${f.mimeType}):\n\n${body}`,
        label: `Read Drive file: ${f.name}`,
      };
    } catch (err: any) {
      return { ok: false, content: `Drive read failed: ${err?.message || err}`, label: "Drive read failed" };
    }
  },
};
