import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

type Props = {
  connected: boolean;
  computerName?: string | null;
  lastSeenAt?: string | null;
  busy?: boolean;
  onStartSetup: () => void;
  onCheckConnection: () => void;
  onReconnect: () => void;
  onVerify: () => void;
  onTroubleshoot: () => void;
  onUninstall: () => void;
};

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function formatLastSeen(lastSeenAt?: string | null): string | null {
  if (!lastSeenAt) return null;

  const parsed = new Date(lastSeenAt);
  if (Number.isNaN(parsed.getTime())) return lastSeenAt;

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ActionButton({
  label,
  icon,
  onPress,
  disabled,
  variant = "secondary",
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const primary = variant === "primary";
  const danger = variant === "danger";
  const color = primary ? Colors.bg : danger ? Colors.error : Colors.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        primary && styles.primaryAction,
        danger && styles.dangerAction,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Ionicons name={icon} size={17} color={color} />
      <Text style={[styles.actionText, primary && styles.primaryActionText, danger && styles.dangerActionText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ConnectedWindowsPcCard({
  connected,
  computerName,
  lastSeenAt,
  busy = false,
  onStartSetup,
  onCheckConnection,
  onReconnect,
  onVerify,
  onTroubleshoot,
  onUninstall,
}: Props) {
  const lastSeen = formatLastSeen(lastSeenAt);
  const statusTitle = connected
    ? `Connected${computerName ? ` to ${computerName}` : ""}`
    : "Not connected yet";

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="desktop-outline" size={22} color={Colors.bg} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>Windows connector</Text>
          <Text style={styles.title}>Connected Windows PC</Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
      </View>

      <View style={[styles.statusBox, connected ? styles.connectedStatus : styles.disconnectedStatus]}>
        <Ionicons
          name={connected ? "checkmark-circle" : "alert-circle-outline"}
          size={19}
          color={connected ? Colors.success : Colors.warningLight}
        />
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>{statusTitle}</Text>
          {connected && lastSeen ? (
            <Text style={styles.statusDetail}>Last seen {lastSeen}</Text>
          ) : null}
        </View>
      </View>

      {connected ? (
        <View style={styles.actions}>
          <ActionButton
            label="Check connection"
            icon="pulse-outline"
            onPress={onCheckConnection}
            disabled={busy}
          />
          <ActionButton
            label="Reconnect"
            icon="sync-outline"
            onPress={onReconnect}
            disabled={busy}
          />
          <ActionButton
            label="Run verification again"
            icon="shield-checkmark-outline"
            onPress={onVerify}
            disabled={busy}
          />
          <ActionButton
            label="Advanced troubleshooting"
            icon="construct-outline"
            onPress={onTroubleshoot}
            disabled={busy}
          />
          <ActionButton
            label="Uninstall connector"
            icon="trash-outline"
            onPress={onUninstall}
            disabled={busy}
            variant="danger"
          />
        </View>
      ) : (
        <>
          <Text style={styles.body}>Use your ChatGPT subscription with Jarvis on this computer</Text>
          <View style={styles.actions}>
            <ActionButton
              label="Set it up for me"
              icon="download-outline"
              onPress={onStartSetup}
              disabled={busy}
              variant="primary"
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 14,
    backgroundColor: Colors.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
  },
  headingCopy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.primaryLight,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    lineHeight: 22,
    letterSpacing: 0,
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  connectedStatus: {
    backgroundColor: Colors.successDim,
    borderColor: Colors.borderGlow,
  },
  disconnectedStatus: {
    backgroundColor: Colors.warningDim,
    borderColor: `${Colors.warning}55`,
  },
  statusCopy: {
    flex: 1,
    gap: 2,
  },
  statusTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    lineHeight: 18,
  },
  statusDetail: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  body: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  action: {
    minHeight: 40,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  primaryAction: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dangerAction: {
    backgroundColor: Colors.errorDim,
    borderColor: `${Colors.error}55`,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.55,
  },
  actionText: {
    color: Colors.text,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 17,
  },
  primaryActionText: {
    color: Colors.bg,
  },
  dangerActionText: {
    color: Colors.error,
  },
});
