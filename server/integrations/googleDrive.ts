// Google Drive integration. Uses the user's Google OAuth access token.
// Requires the `https://www.googleapis.com/auth/drive.file` scope, which
// limits Jarvis to files it creates itself (it cannot read the user's other
// files). Users who connected Google before this scope was added will need to
// reconnect from the Profile screen.

import { google } from "googleapis";
import { Readable } from "node:stream";

function buildDriveClient(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth: oauth2Client });
}

const JARVIS_FOLDER_NAME = "Jarvis Workspace";

export async function ensureJarvisFolder(accessToken: string): Promise<string> {
  const drive = buildDriveClient(accessToken);

  const list = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${JARVIS_FOLDER_NAME}' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 1,
  });

  const existing = list.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name: JARVIS_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  if (!created.data.id) throw new Error("Failed to create Jarvis folder");
  return created.data.id;
}

export interface CreatedDriveFile {
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string;
}

/**
 * Create a text file (markdown by default) inside the Jarvis folder.
 * Pass mimeType="application/vnd.google-apps.document" to create a Google Doc
 * by uploading text/markdown and asking Drive to convert it.
 */
export async function createDriveTextFile(
  accessToken: string,
  name: string,
  body: string,
  options: { mimeType?: string; convertToDoc?: boolean; folderId?: string } = {}
): Promise<CreatedDriveFile> {
  const drive = buildDriveClient(accessToken);
  const folderId = options.folderId || await ensureJarvisFolder(accessToken);

  const sourceMime = options.mimeType || "text/markdown";
  const targetMime = options.convertToDoc
    ? "application/vnd.google-apps.document"
    : sourceMime;

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: targetMime,
      parents: [folderId],
    },
    media: {
      mimeType: sourceMime,
      body: Readable.from([body]),
    },
    fields: "id,name,mimeType,webViewLink",
    supportsAllDrives: false,
  });

  if (!res.data.id) throw new Error("Drive file create returned no id");

  return {
    fileId: res.data.id,
    name: res.data.name || name,
    mimeType: res.data.mimeType || targetMime,
    webViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
  };
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export async function listJarvisDriveFiles(
  accessToken: string,
  limit: number = 25
): Promise<DriveFileMeta[]> {
  const drive = buildDriveClient(accessToken);
  const folderId = await ensureJarvisFolder(accessToken);

  const list = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: Math.min(limit, 100),
  });

  return (list.data.files || []).map((f) => ({
    id: f.id || "",
    name: f.name || "",
    mimeType: f.mimeType || "",
    modifiedTime: f.modifiedTime || undefined,
    webViewLink: f.webViewLink || undefined,
  }));
}

export async function readDriveFile(
  accessToken: string,
  fileId: string
): Promise<{ name: string; mimeType: string; content: string }> {
  const drive = buildDriveClient(accessToken);

  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType",
  });
  const mimeType = meta.data.mimeType || "text/plain";
  const name = meta.data.name || "file";

  // Google Docs need export
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    const exportMime =
      mimeType === "application/vnd.google-apps.document" ? "text/plain" :
      mimeType === "application/vnd.google-apps.spreadsheet" ? "text/csv" :
      "text/plain";
    const res = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: "text" }
    );
    return { name, mimeType, content: String(res.data || "") };
  }

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "text" }
  );
  return { name, mimeType, content: String(res.data || "") };
}

/**
 * Upload a binary file (e.g. PDF, PPTX) inside the Jarvis folder.
 * Unlike createDriveTextFile, this accepts a Buffer and does not attempt
 * format conversion — the file is stored as-is.
 */
export async function createDriveBinaryFile(
  accessToken: string,
  name: string,
  buffer: Buffer,
  mimeType: string,
  options: { folderId?: string } = {}
): Promise<CreatedDriveFile> {
  const drive = buildDriveClient(accessToken);
  const folderId = options.folderId || await ensureJarvisFolder(accessToken);

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from([buffer]),
    },
    fields: "id,name,mimeType,webViewLink",
    supportsAllDrives: false,
  });

  if (!res.data.id) throw new Error("Drive binary file create returned no id");

  return {
    fileId: res.data.id,
    name: res.data.name || name,
    mimeType: res.data.mimeType || mimeType,
    webViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
  };
}

/**
 * Ensure a named subfolder exists inside a parent Drive folder.
 * Creates it if absent; returns its ID either way.
 */
export async function ensureJarvisSubfolder(
  accessToken: string,
  parentFolderId: string,
  name: string,
): Promise<string> {
  const drive = buildDriveClient(accessToken);

  const list = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${name}' and '${parentFolderId}' in parents and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 1,
  });

  const existing = list.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id",
  });

  if (!created.data.id) throw new Error(`Failed to create Drive subfolder "${name}"`);
  return created.data.id;
}

export async function checkDriveScope(accessToken: string): Promise<boolean> {
  try {
    const drive = buildDriveClient(accessToken);
    await drive.about.get({ fields: "user" });
    return true;
  } catch {
    return false;
  }
}
