import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Colors from "@/constants/colors";
import { ROLE_COLORS, ROLE_ICONS } from "@/lib/agents/roleMeta";

interface IntegrationReadiness {
  status?: string;
  accountLinked?: boolean;
  serverConfigured?: boolean;
  capabilityRunnable?: boolean;
  blockedReason?: string | null;
  readiness?: string;
}

export interface LivingAgentCardAgent {
  id: string;
  name: string;
  role: string;
  persona?: string;
  isActive: number;
  platforms: string[];
  memoryScope: string;
  accessGlobalMemory: boolean;
  channelId?: string;
  channelName?: string;
  loopPrompt?: string;
  stuckSince?: string;
  permissions?: unknown;
  mentionPatterns?: string[];
  memoryCount: number;
  status: "online" | "idle" | "dormant" | "stuck";
  lastAction: string | null;
  lastActivityAt: string | null;
  isCoreAgent: boolean;
  loopEnabled: number;
  loopIntervalMinutes: number;
  heartbeatFailCount: number;
  currentJob: {
    id: string;
    title: string;
    status: string;
    createdAt: string;
    iterationCount: number;
  } | null;
}

export const STATUS_COLORS: Record<string, string> = {
  online: "#22c55e",
  idle: "#f59e0b",
  dormant: "#6b7280",
  stuck: "#ef4444",
};

export const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dormant: "Dormant",
  stuck: "Stuck",
};

export const PLATFORM_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  telegram: "paper-plane-outline",
  discord: "logo-discord",
  slack: "logo-slack",
  whatsapp: "chatbubbles-outline",
  mobile: "phone-portrait-outline",
  orchestrator: "git-network-outline",
};

function platformReadinessKey(platform: string): string | null {
  if (platform === "telegram") return "telegram";
  if (platform === "discord") return "discord";
  if (platform === "slack") return "slack";
  if (platform === "whatsapp") return "whatsapp";
  return null;
}

function getRuntimeBadges(
  agent: LivingAgentCardAgent,
  integrations?: Record<string, IntegrationReadiness>,
): { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }[] {
  const badges: { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }[] = [];

  if (agent.isActive !== 1) {
    badges.push({ label: "disabled", color: Colors.textTertiary, icon: "power-outline" });
  } else if (agent.heartbeatFailCount > 0 || agent.status === "stuck") {
    badges.push({ label: "heartbeat blocked", color: Colors.error, icon: "warning-outline" });
  } else if (agent.loopEnabled !== 1 && !agent.isCoreAgent) {
    badges.push({ label: "loop paused", color: Colors.warning, icon: "pause-circle-outline" });
  } else {
    badges.push({ label: agent.loopEnabled === 1 ? "loop enabled" : "listener", color: Colors.success, icon: "radio-outline" });
  }

  const blockedPlatform = (agent.platforms ?? [])
    .map((platform) => ({ platform, key: platformReadinessKey(platform) }))
    .find(({ key }) => key && integrations?.[key] && integrations[key]?.capabilityRunnable === false);
  if (blockedPlatform?.key) {
    badges.push({
      label: `${blockedPlatform.platform} blocked`,
      color: Colors.error,
      icon: "link-outline",
    });
  } else if ((agent.platforms ?? []).length > 0) {
    badges.push({ label: "channel ready", color: Colors.cyan, icon: "checkmark-circle-outline" });
  }

  return badges.slice(0, 2);
}

export function PulsingDot({ color, active }: { color: string; active: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.4, duration: 800, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [active, scale]);

  return (
    <View style={{ width: 12, height: 12, alignItems: "center", justifyContent: "center" }}>
      {active && (
        <Animated.View
          style={{
            position: "absolute",
            width: 12, height: 12, borderRadius: 6,
            backgroundColor: color + "44",
            transform: [{ scale }],
          }}
        />
      )}
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

export function LivingAgentCard({
  agent,
  onDetail,
  onRun,
  integrations,
}: {
  agent: LivingAgentCardAgent;
  onDetail: (agent: LivingAgentCardAgent) => void;
  onRun: (agent: LivingAgentCardAgent) => void;
  integrations?: Record<string, IntegrationReadiness>;
}) {
  const roleColor = ROLE_COLORS[agent.role] || Colors.primary;
  const isActive = agent.isActive === 1;
  const statusColor = STATUS_COLORS[agent.status] || "#6b7280";
  const isPulsing = agent.status === "online";
  const hasActiveJob = agent.currentJob && ["queued", "running"].includes(agent.currentJob.status);
  const runtimeBadges = getRuntimeBadges(agent, integrations);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => onDetail(agent)}
      style={[
        styles.livingCard,
        {
          backgroundColor: Colors.surface,
          borderColor: hasActiveJob ? Colors.primary + "55" : Colors.border,
          opacity: isActive ? 1 : 0.5,
        },
      ]}
    >
      <View style={[styles.cardAccent, { backgroundColor: roleColor }]} />

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <View style={[styles.roleIconWrap, { backgroundColor: roleColor + "22" }]}>
            <Ionicons name={ROLE_ICONS[agent.role] ?? "person-outline"} size={18} color={roleColor} />
          </View>

          <View style={styles.cardNameBlock}>
            <Text style={[styles.cardName, { color: Colors.text }]} numberOfLines={1}>
              {agent.name}
            </Text>
            <View style={styles.cardStatusRow}>
              <PulsingDot color={statusColor} active={isPulsing} />
              <Text style={[styles.cardStatusText, { color: statusColor }]}>
                {STATUS_LABELS[agent.status]}
              </Text>
              {agent.isCoreAgent && (
                <View style={[styles.coreBadge, { backgroundColor: Colors.primary + "22" }]}>
                  <Text style={[styles.coreBadgeText, { color: Colors.primary }]}>core</Text>
                </View>
              )}
              {hasActiveJob && (
                <View style={[styles.coreBadge, { backgroundColor: Colors.success + "22" }]}>
                  <Text style={[styles.coreBadgeText, { color: Colors.success }]}>working</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.cardRightCol}>
            <View style={[styles.memBadge, { backgroundColor: Colors.background }]}>
              <Ionicons name="library-outline" size={10} color={Colors.textSecondary} />
              <Text style={[styles.memBadgeText, { color: Colors.textSecondary }]}>
                {agent.memoryCount > 99 ? "99+" : agent.memoryCount}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => onRun(agent)}
              style={[styles.runBtn, { backgroundColor: Colors.background }]}
            >
              <Ionicons name="play-outline" size={14} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {agent.persona ? (
          <Text style={[styles.cardPersona, { color: Colors.textSecondary }]} numberOfLines={2}>
            {agent.persona}
          </Text>
        ) : null}

        <View style={styles.runtimeBadgeRow}>
          {runtimeBadges.map((badge) => (
            <View key={badge.label} style={[styles.runtimeBadge, { backgroundColor: badge.color + "18", borderColor: badge.color + "55" }]}>
              <Ionicons name={badge.icon} size={10} color={badge.color} />
              <Text style={[styles.runtimeBadgeText, { color: badge.color }]} numberOfLines={1}>{badge.label}</Text>
            </View>
          ))}
        </View>

        {hasActiveJob && agent.currentJob ? (
          <View style={[styles.activeJobRow, { backgroundColor: Colors.success + "11" }]}>
            <ActivityIndicator size="small" color={Colors.success} style={{ width: 12, height: 12 }} />
            <Text style={[styles.activeJobText, { color: Colors.success }]} numberOfLines={1}>
              {agent.currentJob.title}
            </Text>
          </View>
        ) : (
          <View style={styles.cardMeta}>
            {agent.lastAction ? (
              <View style={styles.metaChip}>
                <Ionicons name="time-outline" size={10} color={Colors.textTertiary} />
                <Text style={[styles.metaText, { color: Colors.textTertiary }]} numberOfLines={1}>
                  {agent.lastAction}
                </Text>
              </View>
            ) : null}

            {(agent.platforms ?? []).map((p) => (
              <View key={p} style={styles.metaChip}>
                <Ionicons
                  name={PLATFORM_ICONS[p] ?? "ellipse-outline"}
                  size={10}
                  color={Colors.textTertiary}
                />
                <Text style={[styles.metaText, { color: Colors.textTertiary }]}>{p}</Text>
              </View>
            ))}

            {agent.loopEnabled === 1 && (
              <View style={styles.metaChip}>
                <Ionicons name="refresh-outline" size={10} color={Colors.textTertiary} />
                <Text style={[styles.metaText, { color: Colors.textTertiary }]}>
                  {agent.loopIntervalMinutes}m loop
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  livingCard: {
    borderRadius: 14, borderWidth: 1,
    marginBottom: 10, flexDirection: "row", overflow: "hidden",
  },
  cardAccent: { width: 3 },
  cardBody: { flex: 1, padding: 14 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  roleIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  cardNameBlock: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "600" },
  cardStatusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  cardStatusText: { fontSize: 11, fontWeight: "500" },
  coreBadge: { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  coreBadgeText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  cardRightCol: { alignItems: "flex-end", gap: 6 },
  memBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3,
  },
  memBadgeText: { fontSize: 11, fontWeight: "600" },
  runBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  cardPersona: { fontSize: 12, lineHeight: 17, marginTop: 8, marginLeft: 46 },
  runtimeBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
    marginLeft: 46,
  },
  runtimeBadge: {
    minHeight: 22,
    maxWidth: 150,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  runtimeBadgeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginLeft: 46 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11 },
  activeJobRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 8, marginLeft: 46,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
  },
  activeJobText: { fontSize: 11, fontWeight: "500", flex: 1 },
});
