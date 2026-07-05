import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { AndroidDaemonNative, getAndroidDaemonStatus, type AndroidDaemonStatus } from "@/lib/android-daemon-native";
import { apiRequest, getApiUrl } from "@/lib/query-client";

type AndroidDeviceControlCardProps = {
  serverConnected: boolean;
  hostname?: string | null;
  description?: string;
  onRefreshChannels?: () => unknown | Promise<unknown>;
  onUnpair?: () => unknown | Promise<unknown>;
};

type PermissionRow = {
  key: string;
  label: string;
  detail: string;
  enabled?: boolean;
  action?: () => Promise<void>;
  disabled?: boolean;
};

export function AndroidDeviceControlCard({
  serverConnected,
  hostname,
  description = "Enable Android device control in this Jarvis app.",
  onRefreshChannels,
  onUnpair,
}: AndroidDeviceControlCardProps) {
  const [status, setStatus] = useState<AndroidDaemonStatus | null>(null);
  const [busy, setBusy] = useState<"enable" | "disconnect" | string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshNativeStatus = useCallback(async () => {
    const next = await getAndroidDaemonStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    refreshNativeStatus().catch((err) => {
      setError(err instanceof Error ? err.message : "Unable to read Android daemon status.");
    });
    const interval = setInterval(() => {
      refreshNativeStatus().catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshNativeStatus]);

  const nativeConnected = status?.connected === true;
  const healthy = serverConnected || nativeConnected;
  const nativeAvailable = Platform.OS === "android" && status?.available !== false && !!AndroidDaemonNative;
  const checkingAccessibility = nativeAvailable && healthy && status?.accessibilityEnabled === undefined;
  const needsAccessibility = nativeAvailable && healthy && status?.accessibilityEnabled === false;
  const statusReady = healthy && !checkingAccessibility && !needsAccessibility;
  const anyBusy = busy !== null;
  const alreadyConnected = healthy;
  const canDisconnect = !anyBusy && (nativeAvailable || !!onUnpair);

  const enableDeviceControl = useCallback(async () => {
    if (!AndroidDaemonNative || !nativeAvailable || anyBusy || alreadyConnected) return;
    setBusy("enable");
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/channels/android-daemon/bootstrap");
      const data = await res.json();
      const bootstrapToken = String(data.bootstrapToken ?? "");
      if (!bootstrapToken) throw new Error("Android device bootstrap token was not returned.");
      const next = await AndroidDaemonNative.enable(getApiUrl(), bootstrapToken);
      setStatus(next);
      await onRefreshChannels?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to enable Android device control.";
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [alreadyConnected, anyBusy, nativeAvailable, onRefreshChannels]);

  const disconnect = useCallback(async () => {
    if (anyBusy || (!nativeAvailable && !onUnpair)) return;
    setBusy("disconnect");
    setError(null);
    try {
      if (nativeAvailable && AndroidDaemonNative) {
        await AndroidDaemonNative.disconnect();
      }
      await onUnpair?.();
      if (nativeAvailable) {
        await refreshNativeStatus();
      }
      await onRefreshChannels?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to disconnect Android device control.";
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [anyBusy, nativeAvailable, onRefreshChannels, onUnpair, refreshNativeStatus]);

  const permissionRows = useMemo<PermissionRow[]>(() => [
    {
      key: "accessibility",
      label: "Accessibility",
      detail: "Screen reading, taps, typing, and swipes.",
      enabled: status?.accessibilityEnabled,
      action: () => AndroidDaemonNative?.openAccessibilitySettings() ?? Promise.resolve(),
    },
    {
      key: "notifications",
      label: "Notifications",
      detail: "Read and reply to Android notifications.",
      enabled: status?.notificationListenerActive,
      action: () => AndroidDaemonNative?.openNotificationListenerSettings() ?? Promise.resolve(),
    },
    {
      key: "files",
      label: "All Files",
      detail: "Device file listing and reads after you allow it.",
      action: () => AndroidDaemonNative?.openAllFilesAccessSettings() ?? Promise.resolve(),
    },
    {
      key: "camera",
      label: "Camera",
      detail: "Photos and video clips require app permission.",
      action: () => AndroidDaemonNative?.requestCameraPermission() ?? Promise.resolve(),
    },
    {
      key: "microphone",
      label: "Microphone",
      detail: "Voice capture requires app permission.",
      action: () => AndroidDaemonNative?.requestMicrophonePermission() ?? Promise.resolve(),
    },
    {
      key: "voice-overlay",
      label: "Voice Overlay",
      detail: "Floating mic while JARVIS listens outside the app.",
      enabled: status?.voiceOverlayPermission,
      action: () => AndroidDaemonNative?.openOverlayPermissionSettings?.() ?? Promise.resolve(),
    },
    {
      key: "screen-recording",
      label: "Screen Recording",
      detail: "Unavailable until the foreground Android system prompt flow is wired.",
      disabled: true,
    },
  ], [status?.accessibilityEnabled, status?.notificationListenerActive, status?.voiceOverlayPermission]);

  const runPermissionAction = useCallback(async (row: PermissionRow) => {
    if (!nativeAvailable || anyBusy || row.disabled || !row.action) return;
    setBusy(row.key);
    setError(null);
    try {
      await row.action();
      await refreshNativeStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "This permission must be granted from Android settings.";
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [anyBusy, nativeAvailable, refreshNativeStatus]);

  const openAndroidDownload = useCallback(async () => {
    setError(null);
    try {
      const baseUrl = getApiUrl().replace(/\/+$/, "");
      await Linking.openURL(`${baseUrl}/api/download/android`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to open Android APK download.";
      setError(message);
    }
  }, []);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="phone-portrait-outline" size={20} color="#34A853" />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Android Device</Text>
          <Text style={styles.subtitle}>
            {needsAccessibility
              ? "Connected - enable Accessibility for app control."
              : checkingAccessibility
              ? "Connected - checking Accessibility setup."
              : healthy
              ? `Connected${hostname ? ` - ${hostname}` : ""}`
              : description}
          </Text>
        </View>
        <View style={[
          styles.statusPill,
          statusReady ? styles.statusPillGood : needsAccessibility ? styles.statusPillWarning : styles.statusPillNeutral,
        ]}>
          <Ionicons
            name={statusReady ? "checkmark-circle" : needsAccessibility ? "alert-circle-outline" : "ellipse-outline"}
            size={13}
            color={statusReady ? Colors.success : needsAccessibility ? Colors.warning : Colors.textSecondary}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.statusText,
              statusReady ? styles.statusTextGood : needsAccessibility ? styles.statusTextWarning : undefined,
            ]}
          >
            {statusReady
              ? "Ready"
              : needsAccessibility
              ? "Accessibility"
              : checkingAccessibility
              ? "Checking"
              : status?.status ?? "Checking"}
          </Text>
        </View>
      </View>

      {!nativeAvailable && !alreadyConnected && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>Install the Jarvis Android app, then open Profile on Android to enable device control.</Text>
          <Pressable style={styles.installButton} onPress={openAndroidDownload}>
            <Ionicons name="download-outline" size={14} color={Colors.warningLight} />
            <Text style={styles.installButtonText}>Install APK</Text>
          </Pressable>
        </View>
      )}

      {needsAccessibility && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>Accessibility is still off. Jarvis can connect, but opening apps, reading the screen, taps, typing, and screenshots need the Jarvis Accessibility Service.</Text>
          <Pressable style={styles.installButton} onPress={() => runPermissionAction(permissionRows[0])}>
            <Ionicons name="settings-outline" size={14} color={Colors.warningLight} />
            <Text style={styles.installButtonText}>Open Accessibility</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.setup}>
        <View style={styles.enableCopy}>
          <Text style={styles.enableTitle}>
            {needsAccessibility ? "Finish Android control setup" : "Device control runs inside this app"}
          </Text>
          <Text style={styles.enableDetail}>
            {needsAccessibility
              ? "Turn on Accessibility below so Jarvis can operate the phone."
              : "Jarvis uses your signed-in session to connect this phone locally."}
          </Text>
        </View>
        <Pressable
          style={[styles.primaryButton, (!nativeAvailable || anyBusy || alreadyConnected) && styles.disabledButton]}
          onPress={enableDeviceControl}
          disabled={!nativeAvailable || anyBusy || alreadyConnected}
        >
          {busy === "enable" ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="shield-checkmark-outline" size={15} color="#fff" />
          )}
          <Text style={styles.primaryButtonText}>Enable Device Control</Text>
        </Pressable>
      </View>

      <View style={styles.permissionList}>
        {permissionRows.map((row) => (
          <Pressable
            key={row.key}
            style={[styles.permissionRow, row.disabled && styles.disabledPermissionRow]}
            onPress={() => runPermissionAction(row)}
            disabled={!nativeAvailable || anyBusy || row.disabled}
          >
            <View style={styles.permissionCopy}>
              <Text style={styles.permissionLabel}>{row.label}</Text>
              <Text style={styles.permissionDetail}>{row.detail}</Text>
            </View>
            {busy === row.key ? (
              <ActivityIndicator size="small" color="#34A853" />
            ) : row.disabled ? (
              <Ionicons name="time-outline" size={18} color={Colors.textTertiary} />
            ) : row.enabled !== undefined ? (
              <Ionicons
                name={row.enabled ? "checkmark-circle" : "alert-circle-outline"}
                size={18}
                color={row.enabled ? Colors.success : Colors.warning}
              />
            ) : (
              <Ionicons name="chevron-forward" size={17} color={Colors.textTertiary} />
            )}
          </Pressable>
        ))}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="warning-outline" size={14} color={Colors.warning} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {alreadyConnected && (
        <Pressable
          style={[styles.disconnectButton, !canDisconnect && styles.disabledButton]}
          onPress={disconnect}
          disabled={!canDisconnect}
        >
          {busy === "disconnect" ? (
            <ActivityIndicator size="small" color={Colors.textSecondary} />
          ) : (
            <Ionicons name="unlink-outline" size={15} color={Colors.textSecondary} />
          )}
          <Text style={styles.disconnectText}>Disconnect</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#34A85318",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: 126,
  },
  statusPillGood: {
    backgroundColor: Colors.successDim,
    borderColor: Colors.success,
  },
  statusPillNeutral: {
    backgroundColor: Colors.surfaceAlt,
    borderColor: Colors.border,
  },
  statusPillWarning: {
    backgroundColor: Colors.warningDim,
    borderColor: Colors.warning,
  },
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  statusTextGood: {
    color: Colors.success,
  },
  statusTextWarning: {
    color: Colors.warning,
  },
  notice: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.warning,
    backgroundColor: Colors.warningDim,
    padding: 10,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    color: Colors.warningLight,
  },
  installButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.warning,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  installButtonText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.warningLight,
  },
  setup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  enableCopy: {
    flex: 1,
    minWidth: 0,
  },
  enableTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  enableDetail: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  primaryButton: {
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: "#34A853",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 12,
  },
  primaryButtonText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  disabledButton: {
    opacity: 0.55,
  },
  permissionList: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  permissionRow: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  disabledPermissionRow: {
    opacity: 0.65,
  },
  permissionCopy: {
    flex: 1,
    minWidth: 0,
  },
  permissionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  permissionDetail: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  errorBox: {
    margin: 16,
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.warning,
    backgroundColor: Colors.warningDim,
    padding: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.warningLight,
  },
  disconnectButton: {
    marginHorizontal: 16,
    marginBottom: 14,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  disconnectText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
});
