import type { Express, Request, Response } from "express";

export function registerAppUpdateRoutes(app: Express): void {
  app.get("/api/app-update/android", async (_req: Request, res: Response) => {
    const releaseBase = (
      process.env.JARVIS_ANDROID_UPDATE_RELEASE_BASE ||
      "https://github.com/battlesbudz/Gameplanjarvisai/releases/download/jarvis-app-latest"
    ).replace(/\/+$/, "");
    const manifestUrl = process.env.JARVIS_ANDROID_UPDATE_MANIFEST_URL || `${releaseBase}/version.json`;
    const fallbackApkUrl = process.env.JARVIS_ANDROID_APK_URL || `${releaseBase}/jarvis-app.apk`;
    const releaseUrl =
      process.env.JARVIS_ANDROID_RELEASE_URL ||
      "https://github.com/battlesbudz/Gameplanjarvisai/releases/tag/jarvis-app-latest";

    try {
      const manifestRes = await fetch(manifestUrl, {
        headers: { Accept: "application/json" },
      });
      if (!manifestRes.ok) {
        return res.status(502).json({
          error: `Android update manifest returned ${manifestRes.status}`,
        });
      }

      const manifest = (await manifestRes.json()) as {
        versionCode?: number;
        versionName?: string;
        apkUrl?: string;
        releaseUrl?: string;
        notes?: string;
        sha256?: string;
      };

      return res.json({
        platform: "android",
        versionCode: Number(manifest.versionCode || 0),
        versionName: manifest.versionName || null,
        apkUrl: manifest.apkUrl || fallbackApkUrl,
        releaseUrl: manifest.releaseUrl || releaseUrl,
        notes: manifest.notes || null,
        sha256: manifest.sha256 || null,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[AppUpdate] Android update check failed:", error);
      return res.status(502).json({
        error: "Failed to fetch Android update manifest",
      });
    }
  });
}
