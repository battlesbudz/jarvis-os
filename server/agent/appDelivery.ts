/**
 * appDelivery — package and deliver a completed standalone app project.
 *
 * 1. Runs a production build for the project's framework
 * 2. Zips the workspace (excluding node_modules/.git)
 * 3. Schedules cleanup of the zip after 7 days
 * 4. Notifies the user via all connected channels
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";
import * as os from "os";
import { db } from "../db";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getChannel } from "../channels/registry";
import { stopProjectServer } from "./tools/projectShellTool";
import { sendToDiscordUser } from "../discord/manager";
import { hasGitHubPAT } from "../integrations/github";
import { getPublicBaseUrl } from "../publicUrl";
import { getProjectDownloadsDir } from "../projectStorage";
import { hydrateProjectWorkspace, saveProjectArchive, snapshotProjectWorkspace } from "../projectArtifacts";

const DOWNLOADS_DIR = getProjectDownloadsDir();
const ZIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Download token registry ──────────────────────────────────────────────────
// Maps projectId → { token, expiresAt } for time-limited, signed download URLs
// that work from Telegram/Discord without requiring Auth headers.
interface DownloadToken {
  token: string;
  expiresAt: number;
}
const downloadTokens = new Map<string, DownloadToken>();

export function generateDownloadToken(projectId: string): string {
  const token =
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2);
  downloadTokens.set(projectId, { token, expiresAt: Date.now() + ZIP_TTL_MS });
  return token;
}

export function validateDownloadToken(projectId: string, token: string): boolean {
  const entry = downloadTokens.get(projectId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    downloadTokens.delete(projectId);
    return false;
  }
  return entry.token === token;
}

function ensureDownloadsDir(): void {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function countFiles(dir: string): number {
  try {
    const result = execSync(
      `find "${dir}" -not -path "*/node_modules/*" -not -path "*/.git/*" -type f | wc -l`,
      { timeout: 10000, encoding: "utf8" },
    );
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function getZipSizeMb(zipPath: string): number {
  try {
    const stat = fs.statSync(zipPath);
    return Math.round((stat.size / 1024 / 1024) * 100) / 100;
  } catch {
    return 0;
  }
}

/**
 * Schedule the zip to be deleted after ZIP_TTL_MS (7 days).
 * Uses an unref'd timer so it doesn't prevent server shutdown.
 */
function scheduleZipCleanup(zipPath: string): void {
  const timer = setTimeout(() => {
    try {
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
        console.log(`[AppDelivery] cleaned up expired zip: ${zipPath}`);
      }
    } catch (err) {
      console.warn(`[AppDelivery] failed to delete zip ${zipPath}:`, err);
    }
  }, ZIP_TTL_MS);
  (timer as unknown as { unref(): void }).unref();
}

/**
 * Perform a startup-time cleanup pass: delete any zip files older than 7 days.
 * Safe to call on server boot.
 */
export function cleanupExpiredZips(): void {
  try {
    ensureDownloadsDir();
    const cutoff = Date.now() - ZIP_TTL_MS;
    for (const file of fs.readdirSync(DOWNLOADS_DIR)) {
      if (!file.endsWith(".zip")) continue;
      const fullPath = path.join(DOWNLOADS_DIR, file);
      try {
        const { mtimeMs } = fs.statSync(fullPath);
        if (mtimeMs < cutoff) {
          fs.unlinkSync(fullPath);
          console.log(`[AppDelivery] startup cleanup: deleted expired zip ${file}`);
        }
      } catch {
        // skip files we can't stat
      }
    }
  } catch {
    // non-fatal
  }
}

/**
 * Run a production build for the given framework before packaging.
 * Logs a warning and continues if the build fails (zip is still created).
 */
function runProductionBuild(workspaceDir: string, framework: string): void {
  const packageJson = path.join(workspaceDir, "package.json");
  const nodeModules = path.join(workspaceDir, "node_modules");
  if (fs.existsSync(packageJson) && !fs.existsSync(nodeModules)) {
    console.log(`[AppDelivery] node_modules missing; running npm install in ${workspaceDir}`);
    const install = spawnSync("npm", ["install"], {
      cwd: workspaceDir,
      env: { ...process.env, HOME: os.homedir(), CI: "true" },
      encoding: "utf8",
      timeout: 300_000,
      stdio: "pipe",
    });
    if (install.status !== 0) {
      console.warn(`[AppDelivery] npm install exited ${install.status}; build may fail. STDERR: ${(install.stderr ?? "").slice(0, 800)}`);
    }
  }

  const buildCmds: Record<string, string[]> = {
    nextjs: ["npm", "run", "build"],
    "react-vite": ["npm", "run", "build"],
    "node-express": [],
    custom: ["npm", "run", "build"],
  };

  const args = buildCmds[framework] ?? buildCmds.custom;
  if (args.length === 0) {
    console.log(`[AppDelivery] framework=${framework} — no build step needed, skipping`);
    return;
  }

  const env = { ...process.env, HOME: os.homedir(), CI: "true", NODE_ENV: "production" };
  console.log(`[AppDelivery] running production build: ${args.join(" ")} in ${workspaceDir}`);

  const result = spawnSync(args[0], args.slice(1), {
    cwd: workspaceDir,
    env,
    encoding: "utf8",
    timeout: 300_000,
    stdio: "pipe",
  });

  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").slice(0, 1000);
    console.warn(
      `[AppDelivery] production build exited ${result.status} for ${framework} — ` +
      `packaging source anyway.\nSTDERR: ${stderr}`,
    );
  } else {
    console.log(`[AppDelivery] production build succeeded for framework=${framework}`);
  }
}

export async function packageAndDeliverApp(
  projectId: string,
  userId: string,
  originChannel?: string,
): Promise<{ downloadUrl: string; zipSizeMb: number }> {
  const [project] = await db
    .select()
    .from(schema.jarvisProjects)
    .where(eq(schema.jarvisProjects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project ${projectId} not found`);

  const workspaceDir = project.workspaceDir;
  if (!workspaceDir) {
    throw new Error(`Workspace directory not found for project ${projectId}`);
  }
  await hydrateProjectWorkspace(projectId, workspaceDir);
  if (!fs.existsSync(workspaceDir)) {
    throw new Error(`Workspace directory not found for project ${projectId}`);
  }

  stopProjectServer(projectId);
  await snapshotProjectWorkspace(projectId, workspaceDir).catch(() => undefined);

  const framework = project.appFramework ?? "custom";

  runProductionBuild(workspaceDir, framework);

  ensureDownloadsDir();

  const zipPath = path.join(DOWNLOADS_DIR, `${projectId}.zip`);

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  console.log(`[AppDelivery] zipping workspace for project ${projectId}: ${workspaceDir}`);

  try {
    execSync(
      `zip -r "${zipPath}" . -x "*/node_modules/*" -x "*/.git/*" -x "*.log"`,
      {
        cwd: workspaceDir,
        timeout: 120000,
        stdio: "pipe",
      },
    );
  } catch (err) {
    throw new Error(`Failed to zip project workspace: ${String(err).slice(0, 300)}`);
  }

  if (!fs.existsSync(zipPath)) {
    throw new Error("Zip file was not created — zip command may have failed silently");
  }

  scheduleZipCleanup(zipPath);
  await saveProjectArchive(projectId, zipPath);

  const zipSizeMb = getZipSizeMb(zipPath);
  const fileCount = countFiles(workspaceDir);

  // Generate a signed, time-limited download token so the link works from
  // Telegram/Discord without requiring bearer auth headers.
  const signedToken = generateDownloadToken(projectId);

  // Build an absolute URL so the link is usable in Telegram/Discord notifications.
  const baseUrl = getPublicBaseUrl();
  const downloadUrl = `${baseUrl}/api/downloads/project/${projectId}?token=${signedToken}`;

  console.log(`[AppDelivery] project ${projectId} packaged: ${zipSizeMb}MB, ${fileCount} files, framework=${framework}`);

  // Fall back to the channel stored on the project record (set when the project was
  // first created) if no channel is supplied by the caller.  This ensures the
  // delivery notification reaches the right channel even when the job was re-queued
  // by the autonomous scheduler, which does not carry originChannel in its input.
  const effectiveChannel = originChannel ?? project.originChannel ?? undefined;

  // ── GitHub note ────────────────────────────────────────────────────────────
  const userHasGitHub = await hasGitHubPAT(userId).catch(() => false);
  const githubNote = userHasGitHub
    ? `\n\n🐙 **Push to GitHub?** Open the Projects tab in the app and tap "Push to GitHub" to create a repo and push your code directly — no zip needed.`
    : `\n\n💡 Connect GitHub in Settings to push directly to a repo next time.`;


  // ── Cloud deployment offer (opt-in) ───────────────────────────────────────
  // Deployment is always optional. We check whether credentials are available
  // so we can include a deployment offer in the notification, but we never
  // auto-deploy — the user must explicitly ask Jarvis to deploy.
  const hasVercel = !!process.env.VERCEL_TOKEN;
  const hasRailway = !!process.env.RAILWAY_TOKEN;

  // Strict framework → provider mapping, no cross-provider fallback:
  // nextjs/react-vite → Vercel only, node-express → Railway only.
  let deployOffer = "";
  if ((framework === "nextjs" || framework === "react-vite") && hasVercel) {
    deployOffer = `\n\n🚀 **Want a live URL?** Say "deploy my app" and Jarvis will publish it to Vercel.`;
  } else if (framework === "node-express" && hasRailway) {
    deployOffer = `\n\n🚀 **Want a live URL?** Say "deploy my app" and Jarvis will publish it to Railway.`;
  } else if ((hasVercel || hasRailway) && (framework === "custom" || !framework)) {
    const provider = hasVercel ? "Vercel" : "Railway";
    deployOffer = `\n\n🚀 **Want a live URL?** Say "deploy my app" and Jarvis will publish it to ${provider}.`;
  }

  const notificationText =
    `✅ **${project.title}** is complete!\n\n` +
    `📦 Download your app: ${downloadUrl}\n` +
    `*(Link expires in 7 days)*\n\n` +
    `The zip excludes node_modules — run \`npm install\` to restore dependencies.\n\n` +
    `Tech stack: ${framework} · ${fileCount} files · ${zipSizeMb} MB` +
    githubNote +
    deployOffer;

  await sendDeliveryNotification(userId, effectiveChannel, notificationText);

  return { downloadUrl, zipSizeMb };
}

/** Send a notification to the appropriate channel(s) for a user. */
async function sendDeliveryNotification(
  userId: string,
  effectiveChannel: string | undefined,
  text: string,
): Promise<void> {
  try {
    const origin = (effectiveChannel ?? "").toLowerCase();
    if (origin === "telegram") {
      const telegramCh = getChannel("telegram");
      if (telegramCh) await telegramCh.sendMessage(userId, text, {}).catch(() => {});
    } else if (origin.startsWith("discord")) {
      await sendToDiscordUser(userId, text).catch(() => {});
    }
    const inAppCh = getChannel("in_app");
    if (inAppCh) await inAppCh.sendMessage(userId, text, {}).catch(() => {});
  } catch {
    console.warn(`[AppDelivery] failed to send notification to channel=${effectiveChannel}`);
  }
}

