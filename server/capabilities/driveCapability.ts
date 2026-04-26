import type { Capability } from "./types";
import { driveCreateFileTool, driveListFilesTool, driveReadFileTool } from "../agent/tools/googleDriveTools";
import { createDocumentTool, listDocumentsTool, readDocumentTool } from "../agent/tools/documents";

export const driveCapability: Capability = {
  id: "drive",
  label: "Google Drive & Documents",
  toolGroups: ["documents"],
  tools: [
    driveCreateFileTool,
    driveListFilesTool,
    driveReadFileTool,
    createDocumentTool,
    listDocumentsTool,
    readDocumentTool,
  ],
  googleGatedToolNames: ["drive_create_file", "drive_list_files", "drive_read_file"],
  integrationDependencies: [
    {
      integrationId: "google",
      label: "Google (Gmail + Calendar + Drive)",
      toolNames: ["drive_create_file", "drive_list_files", "drive_read_file"],
    },
  ],
  configRequirements: [
    { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID" },
    { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth Client Secret" },
  ],
  async healthCheck() {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return { healthy: false, reason: "Google OAuth credentials not configured" };
    }
    return { healthy: true };
  },
};
