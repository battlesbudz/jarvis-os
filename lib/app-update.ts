import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { fetch } from "expo/fetch";
import * as Linking from "expo-linking";
import { useEffect } from "react";
import { Alert, Platform } from "react-native";
import { getApiUrl } from "@/lib/query-client";

type AndroidUpdateManifest = {
  platform?: string;
  versionCode?: number;
  versionName?: string;
  apkUrl?: string;
  releaseUrl?: string;
  notes?: string;
  sha256?: string;
};

type CheckAndroidApkUpdateOptions = {
  respectCooldown?: boolean;
  showUpToDateAlert?: boolean;
};

const LAST_CHECK_KEY = "jarvis_android_update_last_check_at";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function currentAndroidVersionCode(): number {
  const nativeBuildVersion = Number(Constants.nativeBuildVersion);
  if (Number.isFinite(nativeBuildVersion) && nativeBuildVersion > 0) return nativeBuildVersion;

  const androidConfig = Constants.expoConfig?.android as { versionCode?: number } | undefined;
  const configVersionCode = Number(androidConfig?.versionCode);
  if (Number.isFinite(configVersionCode) && configVersionCode > 0) return configVersionCode;

  return 0;
}

async function shouldCheckForUpdate(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(LAST_CHECK_KEY);
  const lastCheck = raw ? Number(raw) : 0;
  if (!Number.isFinite(lastCheck) || lastCheck <= 0) return true;
  return Date.now() - lastCheck >= CHECK_INTERVAL_MS;
}

async function markChecked(): Promise<void> {
  await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
}

async function fetchAndroidUpdateManifest(): Promise<AndroidUpdateManifest | null> {
  const url = new URL("/api/app-update/android", getApiUrl());
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  return await res.json();
}

async function openApkInstallerUrl(url: string): Promise<void> {
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) throw new Error("Android could not open the APK download link.");
  await Linking.openURL(url);
}

function promptForAndroidUpdate(manifest: AndroidUpdateManifest): void {
  const versionLabel = manifest.versionName
    ? `${manifest.versionName} (${manifest.versionCode})`
    : `build ${manifest.versionCode}`;

  Alert.alert(
    "Jarvis update available",
    `A newer APK is ready: ${versionLabel}. Android will ask you to confirm the install after it downloads.`,
    [
      { text: "Later", style: "cancel" },
      {
        text: "Update",
        onPress: () => {
          openApkInstallerUrl(manifest.apkUrl!).catch(() => {
            if (manifest.releaseUrl) {
              Linking.openURL(manifest.releaseUrl).catch(() => {});
            }
          });
        },
      },
    ],
  );
}

export async function checkAndroidApkUpdate(options: CheckAndroidApkUpdateOptions = {}): Promise<{
  checked: boolean;
  updateAvailable: boolean;
  currentVersionCode: number;
  latestVersionCode: number | null;
}> {
  const { respectCooldown = false, showUpToDateAlert = false } = options;
  if (Platform.OS !== "android") {
    if (showUpToDateAlert) {
      Alert.alert("APK updates", "APK updates are only available inside the Android app.");
    }
    return { checked: false, updateAvailable: false, currentVersionCode: 0, latestVersionCode: null };
  }
  if (Constants.appOwnership === "expo") {
    if (showUpToDateAlert) {
      Alert.alert("APK updates", "Install the Jarvis APK to use in-app APK updates.");
    }
    return { checked: false, updateAvailable: false, currentVersionCode: 0, latestVersionCode: null };
  }

  const currentVersionCode = currentAndroidVersionCode();
  if (currentVersionCode <= 0) {
    if (showUpToDateAlert) {
      Alert.alert("Could not check updates", "Jarvis could not read this APK build number.");
    }
    return { checked: false, updateAvailable: false, currentVersionCode, latestVersionCode: null };
  }

  if (respectCooldown && !await shouldCheckForUpdate()) {
    return { checked: false, updateAvailable: false, currentVersionCode, latestVersionCode: null };
  }

  const manifest = await fetchAndroidUpdateManifest();
  if (!manifest?.apkUrl || !manifest.versionCode) {
    if (showUpToDateAlert) {
      Alert.alert("Could not check updates", "Jarvis could not reach the APK update file. Try again in a minute.");
    }
    return { checked: false, updateAvailable: false, currentVersionCode, latestVersionCode: null };
  }

  await markChecked();
  const latestVersionCode = Number(manifest.versionCode);
  if (latestVersionCode > currentVersionCode) {
    promptForAndroidUpdate(manifest);
    return { checked: true, updateAvailable: true, currentVersionCode, latestVersionCode };
  }

  if (showUpToDateAlert) {
    Alert.alert("Jarvis is up to date", `You already have the latest APK build (${currentVersionCode}).`);
  }
  return { checked: true, updateAvailable: false, currentVersionCode, latestVersionCode };
}

export function useAndroidApkUpdateCheck() {
  useEffect(() => {
    let cancelled = false;

    async function checkForUpdate() {
      if (cancelled) return;
      await checkAndroidApkUpdate({ respectCooldown: true });
    }

    checkForUpdate().catch((err) => {
      console.warn("[appUpdate] Android APK update check failed:", err);
    });

    return () => {
      cancelled = true;
    };
  }, []);
}
