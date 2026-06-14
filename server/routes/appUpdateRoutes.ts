import type { Express, Request, Response } from "express";

function firstHeaderValue(value: string | undefined): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function getRequestOrigin(req: Request): string {
  const configured =
    process.env.JARVIS_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const proto = firstHeaderValue(req.get("x-forwarded-proto")) || req.protocol || "https";
  const host =
    firstHeaderValue(req.get("x-forwarded-host")) ||
    req.get("host") ||
    "gameplanjarvisai.up.railway.app";

  return `${proto}://${host}`.replace(/\/+$/, "");
}

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

  app.get("/api/app-update/android-daemon", async (req: Request, res: Response) => {
    const releaseBase = (
      process.env.JARVIS_ANDROID_DAEMON_UPDATE_RELEASE_BASE ||
      "https://github.com/battlesbudz/Gameplanjarvisai/releases/download/android-daemon-latest"
    ).replace(/\/+$/, "");
    const manifestUrl =
      process.env.JARVIS_ANDROID_DAEMON_UPDATE_MANIFEST_URL ||
      `${releaseBase}/version.json`;
    const railwayApkUrl = `${getRequestOrigin(req)}/api/download/apk`;
    const releaseUrl =
      process.env.JARVIS_ANDROID_DAEMON_RELEASE_URL ||
      "https://github.com/battlesbudz/Gameplanjarvisai/releases/tag/android-daemon-latest";

    const envVersionCode = Number(process.env.JARVIS_ANDROID_DAEMON_VERSION_CODE || 0);
    const envVersionName = process.env.JARVIS_ANDROID_DAEMON_VERSION_NAME || null;

    const respondFromEnv = () => {
      if (!Number.isFinite(envVersionCode) || envVersionCode <= 0) return false;
      res.json({
        platform: "android-daemon",
        versionCode: envVersionCode,
        versionName: envVersionName,
        apkUrl: railwayApkUrl,
        releaseUrl,
        notes: process.env.JARVIS_ANDROID_DAEMON_RELEASE_NOTES || null,
        sha256: process.env.JARVIS_ANDROID_DAEMON_APK_SHA256 || null,
        checkedAt: new Date().toISOString(),
      });
      return true;
    };

    try {
      const manifestRes = await fetch(manifestUrl, {
        headers: { Accept: "application/json" },
      });
      if (!manifestRes.ok) {
        if (respondFromEnv()) return;
        return res.status(502).json({
          error: `Android daemon update manifest returned ${manifestRes.status}`,
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
        platform: "android-daemon",
        versionCode: Number(manifest.versionCode || 0),
        versionName: manifest.versionName || null,
        apkUrl: manifest.apkUrl || railwayApkUrl,
        releaseUrl: manifest.releaseUrl || releaseUrl,
        notes: manifest.notes || null,
        sha256: manifest.sha256 || null,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (respondFromEnv()) return;
      console.error("[AppUpdate] Android daemon update check failed:", error);
      return res.status(502).json({
        error: "Failed to fetch Android daemon update manifest",
      });
    }
  });
}
