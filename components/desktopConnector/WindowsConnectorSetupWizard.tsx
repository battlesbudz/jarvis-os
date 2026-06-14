import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import {
  clearDesktopConnectorAuthBridge,
  getDesktopConnectorSetupStatus,
  startDesktopConnectorSetup,
} from "@/lib/desktop-connector-setup";
import type { DesktopConnectorSetupResponse, DesktopConnectorStatusResponse } from "@shared/desktopConnectorSetup";

type Props = {
  onSkip?: () => void;
  onConnected?: () => void;
};

const POLL_INTERVAL_MS = 3000;

function statusLabel(status: DesktopConnectorStatusResponse | null): string {
  if (!status) return "Waiting for the Windows connector to finish setup.";
  if (status.connected) return "Connected.";
  return status.message || "Waiting for the Windows connector to finish setup.";
}

export function WindowsConnectorSetupWizard({ onSkip, onConnected }: Props) {
  const [setup, setSetup] = useState<DesktopConnectorSetupResponse | null>(null);
  const [status, setStatus] = useState<DesktopConnectorStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installerNotice, setInstallerNotice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const cancelledRef = useRef(false);
  const connectedNotifiedRef = useRef(false);

  const canContinue = useCallback(() => mountedRef.current && !cancelledRef.current, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const cancelFlow = useCallback(() => {
    cancelledRef.current = true;
    stopPolling();
    clearDesktopConnectorAuthBridge();
  }, [stopPolling]);

  const handleConnected = useCallback(() => {
    if (!canContinue() || connectedNotifiedRef.current) return;
    connectedNotifiedRef.current = true;
    cancelFlow();
    onConnected?.();
  }, [canContinue, cancelFlow, onConnected]);

  const checkStatus = useCallback(async (setupId: string) => {
    try {
      const next = await getDesktopConnectorSetupStatus(setupId);
      if (!canContinue()) return;
      setStatus(next);
      setError(null);
      if (next.connected) handleConnected();
    } catch (err) {
      if (canContinue()) {
        setError(err instanceof Error ? err.message : "Jarvis could not check the connector yet.");
      }
    }
  }, [canContinue, handleConnected]);

  const poll = useCallback((setupId: string) => {
    if (!canContinue()) return;
    stopPolling();
    void checkStatus(setupId);
    pollRef.current = setInterval(() => {
      if (!canContinue()) return;
      void checkStatus(setupId);
    }, POLL_INTERVAL_MS);
  }, [canContinue, checkStatus, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      stopPolling();
      clearDesktopConnectorAuthBridge();
    };
  }, [stopPolling]);

  const openInstaller = useCallback(async (url: string) => {
    if (!canContinue()) return false;

    try {
      if (Platform.OS === "web") {
        if (typeof window === "undefined") {
          if (canContinue()) {
            setInstallerNotice("Use Open installer again to continue setup.");
          }
          return false;
        }

        const opened = window.open(url, "_blank");
        if (!opened) {
          if (canContinue()) {
            setInstallerNotice("Your browser blocked the installer window. Use Open installer again to continue.");
          }
          return false;
        }

        try {
          opened.opener = null;
        } catch {
          // Some browsers may prevent mutating opener after the new window is created.
        }
        if (canContinue()) setInstallerNotice(null);
        return true;
      }

      await Linking.openURL(url);
      if (canContinue()) setInstallerNotice(null);
      return true;
    } catch (err) {
      if (canContinue()) {
        setError(err instanceof Error ? err.message : "Jarvis could not open the installer.");
        setInstallerNotice("Use Open installer again to continue setup.");
      }
      return false;
    }
  }, [canContinue]);

  const openConnectorHandoff = useCallback(async (url: string) => {
    if (!canContinue()) return false;

    try {
      if (Platform.OS === "web") {
        if (typeof document === "undefined") return false;
        const link = document.createElement("a");
        link.href = url;
        link.rel = "noopener noreferrer";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        await Linking.openURL(url);
      }

      if (canContinue()) {
        setInstallerNotice("If Windows asks, allow Jarvis Desktop Connector to open. After installation finishes, choose Finish pairing.");
      }
      return true;
    } catch (err) {
      if (canContinue()) {
        setInstallerNotice("Install the connector, then choose Finish pairing to complete setup.");
      }
      return false;
    }
  }, [canContinue]);

  const start = useCallback(async () => {
    cancelledRef.current = false;
    setBusy(true);
    setError(null);
    setInstallerNotice(null);
    connectedNotifiedRef.current = false;

    try {
      const next = await startDesktopConnectorSetup();
      if (!canContinue()) return;
      setSetup(next);
      setStatus(null);

      await openConnectorHandoff(next.handoffUrl);
      await openInstaller(next.installer.url);

      if (canContinue()) {
        setInstallerNotice("Jarvis opened the installer and sent this setup to the desktop connector. After installation finishes, choose Finish pairing.");
      }
      if (!canContinue()) return;
      poll(next.setupId);
    } catch (err) {
      if (canContinue()) {
        setError(err instanceof Error ? err.message : "Jarvis could not start Windows setup.");
      }
    } finally {
      if (canContinue()) setBusy(false);
    }
  }, [canContinue, openConnectorHandoff, openInstaller, poll]);

  const openInstallerAgain = useCallback(() => {
    if (!setup || !canContinue()) return;
    setError(null);
    void openInstaller(setup.installer.url);
  }, [canContinue, openInstaller, setup]);

  const finishPairing = useCallback(() => {
    if (!setup || !canContinue()) return;
    setError(null);
    void openConnectorHandoff(setup.handoffUrl);
    poll(setup.setupId);
  }, [canContinue, openConnectorHandoff, poll, setup]);

  const handleSkip = useCallback(() => {
    cancelFlow();
    onSkip?.();
  }, [cancelFlow, onSkip]);

  const connected = status?.connected === true;
  const waiting = setup !== null && !connected;

  return (
    <View style={styles.shell}>
      <View style={styles.iconWrap}>
        <Ionicons name="desktop-outline" size={24} color={Colors.bg} />
      </View>

      <View style={styles.copy}>
        <Text style={styles.eyebrow}>Windows connector</Text>
        <Text style={styles.title}>Use your ChatGPT subscription with Jarvis</Text>
        <Text style={styles.body}>
          Jarvis can connect this Windows PC so it can use Codex through your ChatGPT subscription and help with
          desktop tasks when you ask.
        </Text>
        <Text style={styles.disclosure}>
          By continuing, you allow Jarvis to install and keep a desktop connector running on this computer. This gives
          Jarvis the ability to use Codex locally, control your desktop, and run shell commands through the connector.
          If you do not want that, skip this step and use Jarvis with another model provider instead.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.primary, busy && styles.disabled]}
          onPress={start}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={Colors.bg} />
          ) : (
            <>
              <Ionicons name="download-outline" size={17} color={Colors.bg} />
              <Text style={styles.primaryText}>Set it up for me</Text>
            </>
          )}
        </Pressable>
        {setup ? (
          <Pressable style={styles.secondary} onPress={finishPairing}>
            <Ionicons name="link-outline" size={16} color={Colors.text} />
            <Text style={styles.secondaryText}>Finish pairing</Text>
          </Pressable>
        ) : null}
        {setup ? (
          <Pressable style={styles.secondary} onPress={openInstallerAgain}>
            <Ionicons name="open-outline" size={16} color={Colors.text} />
            <Text style={styles.secondaryText}>Open installer again</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.secondary} onPress={handleSkip}>
          <Text style={styles.secondaryText}>Skip desktop connector</Text>
        </Pressable>
      </View>

      {installerNotice ? (
        <View style={styles.noticeBox}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.warningLight} />
          <Text style={styles.noticeText}>{installerNotice}</Text>
        </View>
      ) : null}

      {waiting ? (
        <View style={styles.statusBox}>
          <ActivityIndicator size="small" color={Colors.cyan} />
          <Text style={styles.statusText}>{statusLabel(status)}</Text>
        </View>
      ) : null}

      {connected ? (
        <View style={styles.successBox}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text style={styles.successText}>
            Connected. Jarvis can now use your ChatGPT subscription on this computer.
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="warning-outline" size={16} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    padding: 22,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    gap: 16,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
  },
  copy: {
    gap: 8,
  },
  eyebrow: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.primaryLight,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 25,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    lineHeight: 31,
    letterSpacing: 0,
  },
  body: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    lineHeight: 22,
  },
  disclosure: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primary: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: Colors.primary,
  },
  disabled: {
    opacity: 0.6,
  },
  primaryText: {
    color: Colors.bg,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  secondary: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryText: {
    color: Colors.text,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  noticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: Colors.warningDim,
    borderWidth: 1,
    borderColor: `${Colors.warning}55`,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.warningLight,
    lineHeight: 19,
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: Colors.cyanDim,
    borderWidth: 1,
    borderColor: Colors.cyanGlow,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    lineHeight: 19,
  },
  successBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: Colors.successDim,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.successLight,
    lineHeight: 19,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: Colors.errorDim,
    borderWidth: 1,
    borderColor: `${Colors.error}55`,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.error,
    lineHeight: 19,
  },
});
