import * as os from "os";
import * as path from "path";

function getDataRoot(): string {
  const configured = process.env.JARVIS_DATA_DIR?.trim();
  if (configured) return configured;
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) {
    return path.join(os.tmpdir(), "jarvis-data");
  }
  return process.cwd();
}

export function getProjectWorkspaceRoot(): string {
  return path.join(getDataRoot(), "projects");
}

export function getProjectWorkspaceDir(projectId: string): string {
  return path.join(getProjectWorkspaceRoot(), projectId);
}

export function getProjectDownloadsDir(): string {
  return path.join(getDataRoot(), "project-downloads");
}
