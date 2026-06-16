import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairCodeHint, setPairCodeHint] = useState<string>("Valid for 15 minutes.");
  const [status, setStatus] = useState<AndroidDaemonStatus | null>(null);
  const [busy, setBusy] = useState<"code" | "connect" | "disconnect" | string | null>(null);
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

  const healthy = serverConnected && status?.connected === true;
  const nativeAvailable = Platform.OS === "android" && status?.available !== false && !!AndroidDaemonNative;
  const anyBusy = busy !== null;
  const alreadyConnected = serverConnected || status?.connected === true;
  const canDisconnect = !anyBusy && (nativeAvailable || !!onUnpair);

  useEffect(() => {
    if (alreadyConnected) {
      setPairCode(null);
      setPairCodeHint("Valid for 15 minutes.");
    }
  }, [alreadyConnected]);

  const generateCode = useCallback(async () => {
    if (!nativeAvailable || anyBusy || alreadyConnected) return;
    setBusy("code");
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/channels/daemon/code");
      const data = await res.json();
      setPairCode(String(data.code ?? "").slice(0, 8).toUpperCase());
      const expiresInSec = Number(data.expiresInSec ?? data.expires_in_sec ?? data.ttlSec);
      setPairCodeHint(Number.isFinite(expiresInSec) && expiresInSec > 0
        ? `Valid for ${Math.ceil(expiresInSec / 60)} minutes.`
        : "Valid for 15 minutes.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create pair code.";
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [alreadyConnected, anyBusy, nativeAvailable]);

  const connect = useCallback(async () => {
    if (!AndroidDaemonNative || !nativeAvailable || !pairCode || anyBusy || alreadyConnected) return;
    setBusy("connect");
    setError(null);
    try {
      const next = await AndroidDaemonNative.connect(getApiUrl(), pairCode);
      setStatus(next);
      setPairCode(null);
      setPairCodeHint("Valid for 15 minutes.");
      await onRefreshChannels?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to connect Android device control.";
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [alreadyConnected, anyBusy, nativeAvailable, onRefreshChannels, pairCode]);

  const disconnect = useCallback(async () => {
    if (anyBusy || (!nativeAvailable && !onUnpair)) return;
    setBusy("disconnect");
    setError(null);
    try {
      if (nativeAvailable && AndroidDaemonNative) {
        await AndroidDaemonNative.disconnect();
      }
      setPairCode(null);
      setPairCodeHint("Valid for 15 minutes.");
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
      key: "screen-recording",
      label: "Screen Recording",
      detail: "Unavailable until the foreground Android system prompt flow is wired.",
      disabled: true,
    },
  ], [status?.accessibilityEnabled, status?.notificationListenerActive]);

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

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="phone-portrait-outline" size={20} color="#34A853" />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Android Device</Text>
          <Text style={styles.subtitle}>
            {healthy
              ? `Connected${hostname ? ` - ${hostname}` : ""}`
              : description}
          </Text>
        </View>
        <View style={[styles.statusPill, healthy ? styles.statusPillGood : styles.statusPillNeutral]}>
          <Ionicons
            name={healthy ? "checkmark-circle" : "ellipse-outline"}
            size={13}
            color={healthy ? Colors.success : Colors.textSecondary}
          />
          <Text numberOfLines={1} style={[styles.statusText, healthy ? styles.statusTextGood : undefined]}>
            {healthy ? "Ready" : status?.status ?? "Checking"}
          </Text>
        </View>
      </View>

      {!nativeAvailable && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>Open this Profile tab on Android to pair the built-in device control service.</Text>
        </View>
      )}

      <View style={styles.setup}>
        <View style={styles.pairCodeBox}>
          <Text style={styles.pairCodeLabel}>Pair code</Text>
          <Text selectable style={styles.pairCode}>
            {pairCode ?? "--------"}
          </Text>
          <Text style={styles.pairCodeHint}>{pairCodeHint}</Text>
        </View>
        <View style={styles.setupActions}>
          <Pressable
            style={[styles.secondaryButton, (!nativeAvailable || anyBusy || alreadyConnected) && styles.disabledButton]}
            onPress={generateCode}
            disabled={!nativeAvailable || anyBusy || alreadyConnected}
          >
            {busy === "code" ? (
              <ActivityIndicator size="small" color={Colors.text} />
            ) : (
              <Ionicons name="refresh-outline" size={15} color={Colors.text} />
            )}
            <Text style={styles.secondaryButtonText}>Code</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, (!nativeAvailable || !pairCode || anyBusy || alreadyConnected) && styles.disabledButton]}
            onPress={connect}
            disabled={!nativeAvailable || !pairCode || anyBusy || alreadyConnected}
          >
            {busy === "connect" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="link-outline" size={15} color="#fff" />
            )}
            <Text style={styles.primaryButtonText}>Connect</Text>
          </Pressable>
        </View>
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
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  statusTextGood: {
    color: Colors.success,
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
  setup: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  pairCodeBox: {
    flex: 1,
    minHeight: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    paddingHorizontal: 12,
    paddingVertical: 9,
    justifyContent: "center",
  },
  pairCodeLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textTertiary,
    textTransform: "uppercase",
  },
  pairCode: {
    marginTop: 4,
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: "#34A853",
    letterSpacing: 3,
  },
  pairCodeHint: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
  },
  setupActions: {
    width: 116,
    gap: 8,
  },
  primaryButton: {
    minHeight: 28,
    borderRadius: 8,
    backgroundColor: "#34A853",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
  },
  primaryButtonText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  secondaryButton: {
    minHeight: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
  },
  secondaryButtonText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
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
