import type { Express, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";

const APK_PATH = path.resolve(process.cwd(), "downloads", "jarvis-daemon.apk");

function getFallbackUrl(): string | null {
  return process.env.ANDROID_APK_URL ?? null;
}

export function registerDownloadRoutes(app: Express): void {
  app.get("/api/download/apk", (_req: Request, res: Response) => {
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
      res.redirect(302, fallback);
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
}
