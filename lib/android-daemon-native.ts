import { NativeModules, Platform } from "react-native";

export type AndroidDaemonStatus = {
  available: boolean;
  connected: boolean;
  status: string;
  accessibilityEnabled: boolean;
  notificationListenerActive: boolean;
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
      connect(serverUrl: string, pairCode: string): Promise<AndroidDaemonStatus>;
      disconnect(): Promise<AndroidDaemonStatus>;
      openAccessibilitySettings(): Promise<void>;
      openNotificationListenerSettings(): Promise<void>;
      openAllFilesAccessSettings(): Promise<void>;
      requestCameraPermission(): Promise<void>;
      requestMicrophonePermission(): Promise<void>;
      requestScreenRecordPermission(): Promise<void>;
    }
  | undefined;

export async function getAndroidDaemonStatus(): Promise<AndroidDaemonStatus> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon) {
    return unavailableStatus;
  }
  return NativeJarvisDaemon.getStatus();
}

export const AndroidDaemonNative = NativeJarvisDaemon;
