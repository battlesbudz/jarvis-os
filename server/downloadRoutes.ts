import type { Express, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { db } from "./db";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getUserIdFromRequest } from "./auth";
import { validateDownloadToken } from "./agent/appDelivery";
import { getProjectDownloadsDir } from "./projectStorage";
import { readProjectArchive } from "./projectArtifacts";

const MAIN_APK_PATH = path.resolve(process.cwd(), "downloads", "jarvis-app.apk");
const APK_PATH = path.resolve(process.cwd(), "downloads", "jarvis-daemon.apk");
const DOWNLOADS_DIR = getProjectDownloadsDir();
const _p = (v: string | string[]): string => Array.isArray(v) ? (v[0] ?? "") : v;

function getMainAppFallbackUrl(): string | null {
  const releaseBase = (
    process.env.JARVIS_ANDROID_UPDATE_RELEASE_BASE ||
    "https://github.com/battlesbudz/Gameplanjarvisai/releases/download/jarvis-app-latest"
  ).replace(/\/+$/, "");
  return process.env.JARVIS_ANDROID_APK_URL ?? `${releaseBase}/jarvis-app.apk`;
}

function getFallbackUrl(): string | null {
  const releaseBase = (
    process.env.JARVIS_ANDROID_DAEMON_UPDATE_RELEASE_BASE ||
    "https://github.com/battlesbudz/Gameplanjarvisai/releases/download/android-daemon-latest"
  ).replace(/\/+$/, "");
  return (
    process.env.JARVIS_ANDROID_DAEMON_APK_URL ??
    process.env.ANDROID_APK_URL ??
    `${releaseBase}/jarvis-daemon.apk`
  );
}

async function proxyFallbackApk(
  fallbackUrl: string,
  res: Response,
  filename = "jarvis-daemon.apk",
): Promise<void> {
  const remote = await fetch(fallbackUrl, {
    headers: {
      Accept: "application/vnd.android.package-archive, application/octet-stream, */*",
      "User-Agent": "JarvisAPKDownloader/1.0",
    },
  });

  if (!remote.ok) {
    res.status(502).json({
      error: "Hosted APK unavailable",
      status: remote.status,
    });
    return;
  }

  res.setHeader(
    "Content-Type",
    remote.headers.get("content-type") || "application/vnd.android.package-archive",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const contentLength = remote.headers.get("content-length");
  if (contentLength) res.setHeader("Content-Length", contentLength);
  res.setHeader("Cache-Control", "public, max-age=300");
  if (!remote.body) {
    res.status(502).json({ error: "Hosted APK response did not include a body" });
    return;
  }

  await pipeline(Readable.fromWeb(remote.body as any), res);
}

export function registerDownloadRoutes(app: Express): void {
  app.get("/api/download/android", async (_req: Request, res: Response) => {
    if (fs.existsSync(MAIN_APK_PATH)) {
      const stat = fs.statSync(MAIN_APK_PATH);
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", 'attachment; filename="jarvis-app.apk"');
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Cache-Control", "public, max-age=3600");
      fs.createReadStream(MAIN_APK_PATH).pipe(res);
      return;
    }

    const fallback = getMainAppFallbackUrl();
    if (fallback) {
      try {
        await proxyFallbackApk(fallback, res, "jarvis-app.apk");
      } catch (error) {
        console.error("[DownloadRoutes] failed to proxy hosted Jarvis APK:", error);
        if (!res.headersSent) {
          res.status(502).json({ error: "Failed to download hosted Jarvis APK" });
        }
      }
      return;
    }

    res.status(404).json({
      error: "Jarvis APK not available",
      instructions:
        "Either place the built APK at downloads/jarvis-app.apk, " +
        "or set JARVIS_ANDROID_APK_URL to a hosted Jarvis APK URL.",
    });
  });

  app.get("/api/download/apk", async (_req: Request, res: Response) => {
    if (fs.existsSync(APK_PATH)) {
      const stat = fs.statSync(APK_PATH);
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", 'attachment; filename="jarvis-daemon.apk"');
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Cache-Control", "public, max-age=3600");
      fs.createReadStream(APK_PATH).pipe(res);
      return;
    }

    const fallback = getFallbackUrl();
    if (fallback) {
      try {
        await proxyFallbackApk(fallback, res);
      } catch (error) {
        console.error("[DownloadRoutes] failed to proxy hosted daemon APK:", error);
        if (!res.headersSent) {
          res.status(502).json({ error: "Failed to download hosted APK" });
        }
      }
      return;
    }

    res.status(404).json({
      error: "APK not available",
      instructions:
        "Either place the built APK at downloads/jarvis-daemon.apk, " +
        "or set the ANDROID_APK_URL environment variable to a hosted APK URL (e.g. a GitHub Release asset URL).",
    });
  });

  app.get("/api/download/apk/info", (_req: Request, res: Response) => {
    if (fs.existsSync(APK_PATH)) {
      const stat = fs.statSync(APK_PATH);
      return res.json({
        available: true,
        source: "local",
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    }

    const fallback = getFallbackUrl();
    if (fallback) {
      return res.json({ available: true, source: "remote", url: fallback });
    }

    res.json({ available: false });
  });

  // ── Project download ─────────────────────────────────────────────────────
  // Accepts EITHER:
  //   a) A valid signed ?token=<token> query param (for Telegram/Discord clickthrough)
  //   b) Bearer auth (for in-app download button)
  app.get("/api/downloads/project/:projectId", async (req: Request, res: Response) => {
    const projectId = _p(req.params.projectId);
    const queryToken = typeof req.query.token === "string" ? req.query.token : null;

    // ── Auth: signed token OR bearer ────────────────────────────────────────
    // Signed token: usable from Telegram/Discord clickthrough without auth headers
    // Bearer token: used by the in-app download button
    const tokenValid = queryToken ? validateDownloadToken(projectId, queryToken) : false;
    const bearerUserId = tokenValid ? null : await getUserIdFromRequest(req);

    if (!tokenValid && !bearerUserId) {
      return res.status(401).json({ error: "Unauthorized — provide a valid token or authenticate" });
    }

    try {
      const [project] = await db
        .select()
        .from(schema.jarvisProjects)
        .where(eq(schema.jarvisProjects.id, projectId))
        .limit(1);

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Bearer auth: enforce project ownership
      if (!tokenValid && project.userId !== bearerUserId) {
        return res.status(404).json({ error: "Project not found" });
      }

      const zipPath = path.join(DOWNLOADS_DIR, `${projectId}.zip`);

      if (!fs.existsSync(zipPath)) {
        const archive = await readProjectArchive(projectId);
        if (!archive) {
          return res.status(404).json({
            error: "Project zip not yet available",
            detail: "The project may still be building. You will receive a notification when the download is ready.",
          });
        }

        const safeName = (project.title ?? projectId).replace(/[^a-z0-9]/gi, "-").toLowerCase();
        const filename = `${safeName}.zip`;
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", archive.sizeBytes);
        res.setHeader("Cache-Control", "no-cache");
        return res.end(archive.data);
      }

      const stat = fs.statSync(zipPath);
      const safeName = (project.title ?? projectId).replace(/[^a-z0-9]/gi, "-").toLowerCase();
      const filename = `${safeName}.zip`;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Cache-Control", "no-cache");

      fs.createReadStream(zipPath).pipe(res);
    } catch (err) {
      console.error(`[DownloadRoutes] project download error for ${projectId}:`, err);
      res.status(500).json({ error: "Download failed" });
    }
  });
}
