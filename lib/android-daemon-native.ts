import { NativeModules, Platform } from "react-native";

export type AndroidDaemonStatus = {
  available: boolean;
  connected: boolean;
  status: string;
  accessibilityEnabled: boolean;
  notificationListenerActive: boolean;
  assistantActive?: boolean;
  assistantStatus?: string;
  hotwordPhrase?: string;
  hotwordAvailability?: string;
  hotwordDetail?: string;
  hotwordRecognitionActive?: boolean;
  hotwordLastError?: string | null;
  serverUrl?: string;
};

const unavailableStatus: AndroidDaemonStatus = {
  available: false,
  connected: false,
  status: "Unavailable",
  accessibilityEnabled: false,
  notificationListenerActive: false,
};

const NativeJarvisDaemon = NativeModules.JarvisDaemonModule as
  | {
      getStatus(): Promise<AndroidDaemonStatus>;
      enable(serverUrl: string, bootstrapToken: string): Promise<AndroidDaemonStatus>;
      disconnect(): Promise<AndroidDaemonStatus>;
      openAccessibilitySettings(): Promise<void>;
      openNotificationListenerSettings(): Promise<void>;
      openAssistantSettings(): Promise<void>;
      refreshAssistantStatus(): Promise<AndroidDaemonStatus>;
      openAllFilesAccessSettings(): Promise<void>;
      requestCameraPermission(): Promise<void>;
      requestMicrophonePermission(): Promise<void>;
      requestScreenRecordPermission(): Promise<void>;
      getLocalGemmaStatus?(model: string): Promise<string | Record<string, unknown>>;
      validateLocalGemmaModel?(model: string): Promise<string | Record<string, unknown>>;
    }
  | undefined;

function parseNativeJsonResult(result: unknown): Record<string, unknown> | null {
  if (!result) return null;
  if (typeof result === "string") {
    const parsed = JSON.parse(result);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  }
  return typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null;
}

export async function getAndroidDaemonStatus(): Promise<AndroidDaemonStatus> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon) {
    return unavailableStatus;
  }
  return NativeJarvisDaemon.getStatus();
}

export async function getAndroidLocalGemmaStatus(model: string): Promise<Record<string, unknown> | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.getLocalGemmaStatus) {
    return null;
  }
  return parseNativeJsonResult(await NativeJarvisDaemon.getLocalGemmaStatus(model));
}

export async function validateAndroidLocalGemmaModel(model: string): Promise<Record<string, unknown>> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.validateLocalGemmaModel) {
    throw new Error("Phone Gemma validation is only available in the Android app.");
  }
  const parsed = parseNativeJsonResult(await NativeJarvisDaemon.validateLocalGemmaModel(model));
  if (!parsed) throw new Error("Phone Gemma validation returned an empty status.");
  return parsed;
}

export const AndroidDaemonNative = NativeJarvisDaemon;
