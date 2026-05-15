import type { Capability } from "./types";
import { driveCreateFileTool, driveListFilesTool, driveReadFileTool } from "../agent/tools/googleDriveTools";
import { createDocumentTool, listDocumentsTool, readDocumentTool } from "../agent/tools/documents";
import { exportDocumentPdfTool } from "../agent/tools/exportPdf";
import { createPresentationTool } from "../agent/tools/createPresentation";
import { getGoogleOAuthConfigStatus } from "./googleOAuthConfig";

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
    exportDocumentPdfTool,
    createPresentationTool,
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
    { key: "GOOGLE_WEB_CLIENT_ID", label: "Google OAuth Web Client ID" },
    { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth Client Secret" },
  ],
  async healthCheck() {
    const status = getGoogleOAuthConfigStatus();
    if (!status.configured) {
      return { healthy: false, reason: status.reason };
    }
    return { healthy: true };
  },
};
