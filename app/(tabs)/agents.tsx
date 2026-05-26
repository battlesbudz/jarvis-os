import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Platform,
  Alert,
  RefreshControl,
  Switch,
  Animated,
  KeyboardAvoidingView,
  Image,
  Linking,
  LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetch as expoFetch } from "expo/fetch";
import { router, useLocalSearchParams } from "expo-router";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { getAuthToken } from "@/lib/auth-context";
import Colors from "@/constants/colors";
import { IntegrationErrorCard } from "@/components/IntegrationErrorCard";
import {
  CHAT_HISTORY_WINDOW_MAIN,
  CHAT_HISTORY_WINDOW_SUB,
  type ChatMessage,
  type InAppAttachment,
  clearStoredSessionId,
  loadChatHistory,
  loadStoredSessionId,
  safeAtob,
  saveChatHistory,
  saveStoredSessionId,
} from "@/lib/agents/chatStorage";

// ── Types ──────────────────────────────────────────────────────────────────────

type PolicyScope = "global" | "permissive" | "strict" | "custom";

interface AllowlistEntry {
  id: string;
  agentId: string;
  pattern: string;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

interface AgentPolicy {
  agentId: string;
  scope: PolicyScope;
  allowlist: AllowlistEntry[];
}

const POLICY_SCOPE_LABELS: Record<PolicyScope, { label: string; description: string; color: string }> = {
  global:     { label: "Global",     description: "Use system defaults",                   color: "#6b7280" },
  permissive: { label: "Permissive", description: "Auto-approve all reversible tools",      color: "#22c55e" },
  strict:     { label: "Strict",     description: "Always require manual approval",         color: "#ef4444" },
  custom:     { label: "Custom",     description: "Allowlist controls auto-approval",       color: "#f59e0b" },
};

interface AgentPermissions {
  can_search_web: boolean;
  can_use_browser: boolean;
  can_send_emails: boolean;
  can_create_email_drafts: boolean;
  can_read_email: boolean;
  can_send_messages: boolean;
  can_access_files: boolean;
  can_take_screenshots: boolean;
  can_open_apps: boolean;
  can_call_user: boolean;
  can_use_voice: boolean;
  can_create_tasks: boolean;
  can_create_other_agents: boolean;
  can_access_global_memory: boolean;
  can_run_code: boolean;
}

const DEFAULT_PERMISSIONS: AgentPermissions = {
  can_search_web: true,
  can_use_browser: false,
  can_send_emails: false,
  can_create_email_drafts: false,
  can_read_email: false,
  can_send_messages: true,
  can_access_files: false,
  can_take_screenshots: false,
  can_open_apps: false,
  can_call_user: false,
  can_use_voice: false,
  can_create_tasks: true,
  can_create_other_agents: false,
  can_access_global_memory: false,
  can_run_code: false,
};

const PERM_LABELS: Record<keyof AgentPermissions, { label: string; icon: keyof typeof Ionicons.glyphMap; danger?: boolean }> = {
  can_search_web:          { label: "Search the web",           icon: "search-outline" },
  can_use_browser:         { label: "Control browser",          icon: "globe-outline",    danger: true },
  can_send_emails:         { label: "Send emails",              icon: "mail-outline",     danger: true },
  can_create_email_drafts: { label: "Create email drafts",      icon: "create-outline",   danger: true },
  can_read_email:          { label: "Read email",               icon: "mail-open-outline" },
  can_send_messages:       { label: "Send messages",            icon: "chatbubble-outline" },
  can_access_files:        { label: "Access files",             icon: "folder-outline" },
  can_take_screenshots:    { label: "Take screenshots",         icon: "camera-outline" },
  can_open_apps:           { label: "Open apps",                icon: "apps-outline" },
  can_call_user:           { label: "Call user",                icon: "call-outline",     danger: true },
  can_use_voice:           { label: "Use voice (TTS)",          icon: "mic-outline",      danger: true },
  can_create_tasks:        { label: "Create tasks",             icon: "checkmark-circle-outline" },
  can_create_other_agents: { label: "Create sub-agents",        icon: "people-outline",   danger: true },
  can_access_global_memory:{ label: "Read global memory",       icon: "library-outline" },
  can_run_code:            { label: "Run Python code",          icon: "code-slash-outline" },
};

export interface AuditEntry {
  timestamp: string;
  file: string;
  reason: string;
  verified: string;
  changesSummary: string;
  diff: string;
}

export interface AgentTask {
  id: string;
  title: string;
  status: string;
  agentId: string;
  agentName: string;
  iterationCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  output: string | null;
}

export interface RosterAgent {
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
  loopEnabled: number;
  loopIntervalMinutes: number;
  loopPrompt?: string;
  heartbeatFailCount: number;
  stuckSince?: string;
  permissions?: AgentPermissions;
  mentionPatterns?: string[];
  // enriched
  memoryCount: number;
  status: "online" | "idle" | "dormant" | "stuck";
  lastAction: string | null;
  lastActivityAt: string | null;
  isCoreAgent: boolean;
  currentJob: {
    id: string;
    title: string;
    status: string;
    createdAt: string;
    iterationCount: number;
  } | null;
}

interface IntegrationReadiness {
  status?: string;
  accountLinked?: boolean;
  serverConfigured?: boolean;
  capabilityRunnable?: boolean;
  blockedReason?: string | null;
  readiness?: string;
}

const ROLE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  coach: "fitness-outline",
  researcher: "search-outline",
  coder: "code-slash-outline",
  writer: "pencil-outline",
  analyst: "bar-chart-outline",
  scheduler: "calendar-outline",
  support: "headset-outline",
  security: "shield-outline",
  devops: "server-outline",
  custom: "person-outline",
};

const ROLE_COLORS: Record<string, string> = {
  coach: "#4A90E2",
  researcher: "#7B68EE",
  coder: "#50C878",
  writer: "#FFD700",
  analyst: "#FF8C00",
  scheduler: "#20B2AA",
  support: "#FF69B4",
  security: "#DC143C",
  devops: "#4682B4",
  custom: "#9370DB",
};

const ROLES = ["coach", "researcher", "coder", "writer", "analyst", "scheduler", "support", "security", "devops", "custom"];

const STATUS_COLORS: Record<string, string> = {
  online: "#22c55e",
  idle: "#f59e0b",
  dormant: "#6b7280",
  stuck: "#ef4444",
};

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dormant: "Dormant",
  stuck: "Stuck",
};

const JOB_STATUS_COLORS: Record<string, string> = {
  queued: "#f59e0b",
  running: "#22c55e",
  complete: Colors.primary,
  delivered: "#6b7280",
  failed: "#ef4444",
  cancelled: "#6b7280",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  complete: "Needs Review",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
};

const PLATFORM_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
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
  agent: RosterAgent,
  integrations?: Record<string, IntegrationReadiness>,
): Array<{ label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> {
  const badges: Array<{ label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = [];

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

// Hardcoded fallback so the PLATFORM BOTS section is never empty
const CORE_PLACEHOLDER_NAMES = ["Jarvis Telegram Bot", "Jarvis Discord Bot", "Discord Channel Agent"];

// ── PulsingDot ─────────────────────────────────────────────────────────────────

function PulsingDot({ color, active }: { color: string; active: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.4, duration: 800, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [active]);

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

// ── JobTaskCard — dynamic orchestrator-dispatched task ─────────────────────────

function JobTaskCard({ job, onPress }: { job: AgentTask; onPress: () => void }) {
  const statusColor = JOB_STATUS_COLORS[job.status] ?? "#6b7280";
  const statusLabel = JOB_STATUS_LABELS[job.status] ?? job.status;
  const isRunning = job.status === "running";
  const isQueued = job.status === "queued";
  const needsReview = job.status === "complete";

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[
        styles.jobCard,
        {
          backgroundColor: Colors.surface,
          borderColor: needsReview ? Colors.primary + "66" : Colors.border,
        },
      ]}
    >
      <View style={styles.jobCardHeader}>
        <View style={[styles.jobIconWrap, { backgroundColor: statusColor + "22" }]}>
          <Ionicons
            name={
              isRunning ? "flash-outline" :
              isQueued ? "time-outline" :
              needsReview ? "checkmark-circle-outline" :
              job.status === "failed" ? "alert-circle-outline" :
              "archive-outline"
            }
            size={16}
            color={statusColor}
          />
        </View>
        <View style={styles.jobCardTitle}>
          <Text style={[styles.jobTitle, { color: Colors.text }]} numberOfLines={1}>
            {job.title}
          </Text>
          <Text style={[styles.jobAgent, { color: Colors.textSecondary }]} numberOfLines={1}>
            {job.agentName}
            {job.iterationCount > 0 ? ` · iter ${job.iterationCount + 1}` : ""}
          </Text>
        </View>
        <View style={[styles.jobStatusBadge, { backgroundColor: statusColor + "22" }]}>
          {isRunning && <ActivityIndicator size="small" color={statusColor} style={{ width: 12, height: 12 }} />}
          <Text style={[styles.jobStatusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {job.output && (
        <Text style={[styles.jobOutput, { color: Colors.textSecondary }]} numberOfLines={2}>
          {job.output}
        </Text>
      )}
      {job.error && (
        <Text style={[styles.jobOutput, { color: Colors.error }]} numberOfLines={2}>
          Error: {job.error}
        </Text>
      )}

      <Text style={[styles.jobMeta, { color: Colors.textTertiary }]}>
        {new Date(job.createdAt).toLocaleString()}
        {job.completedAt ? ` · done ${new Date(job.completedAt).toLocaleTimeString()}` : ""}
      </Text>
    </TouchableOpacity>
  );
}

// ── LivingAgentCard ────────────────────────────────────────────────────────────

function LivingAgentCard({
  agent,
  onDetail,
  onRun,
  integrations,
}: {
  agent: RosterAgent;
  onDetail: (a: RosterAgent) => void;
  onRun: (a: RosterAgent) => void;
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

// ── CorePlaceholderCard — shown when seeding hasn't completed yet ──────────────

function CorePlaceholderCard({ name }: { name: string }) {
  const platform = name.toLowerCase().includes("telegram") ? "telegram" : "discord";
  return (
    <View style={[styles.livingCard, { backgroundColor: Colors.surface, borderColor: Colors.border, opacity: 0.6 }]}>
      <View style={[styles.cardAccent, { backgroundColor: Colors.textTertiary }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <View style={[styles.roleIconWrap, { backgroundColor: Colors.background }]}>
            <Ionicons
              name={platform === "telegram" ? "paper-plane-outline" : "logo-discord"}
              size={18}
              color={Colors.textTertiary}
            />
          </View>
          <View style={styles.cardNameBlock}>
            <Text style={[styles.cardName, { color: Colors.textSecondary }]}>{name}</Text>
            <View style={styles.cardStatusRow}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.textTertiary }} />
              <Text style={[styles.cardStatusText, { color: Colors.textTertiary }]}>Connecting…</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

// ── CreateAgentSheet ───────────────────────────────────────────────────────────

function CreateAgentSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; role: string; persona?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("custom");
  const [persona, setPersona] = useState("");

  function handleCreate() {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), role, persona: persona.trim() || undefined });
    setName("");
    setRole("custom");
    setPersona("");
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.sheetCancel, { color: Colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.sheetTitle, { color: Colors.text }]}>New Agent</Text>
          <TouchableOpacity onPress={handleCreate} disabled={!name.trim()}>
            <Text style={[styles.sheetDone, { color: name.trim() ? Colors.primary : Colors.textTertiary }]}>Create</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>NAME</Text>
          <TextInput
            style={[styles.input, { backgroundColor: Colors.surface, color: Colors.text, borderColor: Colors.border }]}
            value={name}
            onChangeText={setName}
            placeholder="Agent name…"
            placeholderTextColor={Colors.textTertiary}
            autoFocus
          />

          <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>ROLE</Text>
          <View style={styles.roleGrid}>
            {ROLES.map((r) => {
              const roleColor = ROLE_COLORS[r] || Colors.primary;
              const isSelected = role === r;
              return (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.roleChip,
                    {
                      backgroundColor: isSelected ? roleColor + "33" : Colors.surface,
                      borderColor: isSelected ? roleColor : Colors.border,
                    },
                  ]}
                  onPress={() => setRole(r)}
                >
                  <Ionicons name={ROLE_ICONS[r] ?? "person-outline"} size={14} color={isSelected ? roleColor : Colors.textSecondary} />
                  <Text style={[styles.roleChipText, { color: isSelected ? roleColor : Colors.textSecondary }]}>{r}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>PERSONA (OPTIONAL)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline, { backgroundColor: Colors.surface, color: Colors.text, borderColor: Colors.border }]}
            value={persona}
            onChangeText={setPersona}
            placeholder="Describe this agent's personality and specialty…"
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={4}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── RunModal ───────────────────────────────────────────────────────────────────

function RunModal({ agent, onClose }: { agent: RosterAgent | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [running, setRunning] = useState(false);
  const [integrationError, setIntegrationError] = useState<{ integration: string } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const prevAgentIdRef = useRef<string | null>(null);
  const sdkSessionIdRef = useRef<string | null>(null);

  // Load history: try permanent server history first (no TTL), fall back to AsyncStorage.
  // Also restore the session ID from storage so subsequent turns can resume the session.
  useEffect(() => {
    if (!agent) return;
    if (prevAgentIdRef.current === agent.id) return;
    prevAgentIdRef.current = agent.id;
    sdkSessionIdRef.current = null;
    setHistoryLoading(true);

    (async () => {
      try {
        // Restore session ID from local storage (used for session resumption, not history)
        const storedSessionId = await loadStoredSessionId(agent.id);
        if (storedSessionId) {
          sdkSessionIdRef.current = storedSessionId;
        }

        // Primary: permanent history endpoint (survives session expiry)
        const token = await getAuthToken();
        const historyUrl = new URL(`/api/agents/${agent.id}/history`, getApiUrl());
        const resp = await fetch(historyUrl.toString(), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>;
          };
          if (data.messages && data.messages.length > 0) {
            const serverMessages: ChatMessage[] = data.messages
              .filter((m) => m.content)
              .map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                timestamp: new Date(m.createdAt).getTime(),
              }));
            setMessages(serverMessages);
            // Sync local AsyncStorage to server truth
            await saveChatHistory(agent.id, serverMessages);
            setStreamingContent("");
            setIntegrationError(null);
            setHistoryLoading(false);
            return;
          }
        }

        // Fallback: local AsyncStorage history (offline / pre-feature messages)
        const history = await loadChatHistory(agent.id);
        setMessages(history);
        setStreamingContent("");
        setIntegrationError(null);
      } catch {
        const history = await loadChatHistory(agent.id);
        setMessages(history);
        setStreamingContent("");
        setIntegrationError(null);
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, [agent?.id]);

  function buildConversationHistory(msgs: ChatMessage[]): Array<{ role: string; content: string }> {
    const window = agent?.isCoreAgent ? CHAT_HISTORY_WINDOW_MAIN : CHAT_HISTORY_WINDOW_SUB;
    const windowed = msgs.length > window ? msgs.slice(msgs.length - window) : msgs;
    return windowed.map((m) => ({ role: m.role, content: m.content }));
  }

  async function handleRun() {
    if (!agent || !message.trim()) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    runIdRef.current = null;

    const userMsg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role: "user",
      content: message.trim(),
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    saveChatHistory(agent.id, updatedMessages);
    setMessage("");
    setRunning(true);
    setStreamingContent("");
    setIntegrationError(null);

    try {
      const token = await getAuthToken();
      const conversationHistory = buildConversationHistory(messages);

      const url = new URL(`/api/agents/${agent.id}/chat`, getApiUrl());
      const response = await expoFetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: userMsg.content,
          conversationHistory,
          ...(sdkSessionIdRef.current ? { sdkSessionId: sdkSessionIdRef.current } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const serverRunId = response.headers.get("X-Run-Id");
      if (serverRunId) runIdRef.current = serverRunId;

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let hadToolError = false;
      const pendingAttachments: InAppAttachment[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as {
              content?: string;
              type?: string;
              integration?: string;
              message?: string;
              sdkSessionId?: string;
              tool?: string;
              kind?: string;
              url?: string;
              data?: string;
              mimeType?: string;
              caption?: string;
              filename?: string;
              text?: string;
            };
            if (parsed.type === "aborted") {
              accumulated += "\n\n[Stopped]";
              setStreamingContent(accumulated.trim());
              break;
            }
            if (parsed.type === "session_init" && parsed.sdkSessionId && agent) {
              sdkSessionIdRef.current = parsed.sdkSessionId;
              saveStoredSessionId(agent.id, parsed.sdkSessionId);
            }
            if (parsed.type === "integration_error" && parsed.integration) {
              setIntegrationError({ integration: parsed.integration });
            }
            if (parsed.type === "tool_error") {
              hadToolError = true;
            }
            if (parsed.type === "attachment" && parsed.kind) {
              pendingAttachments.push({
                kind: parsed.kind as InAppAttachment["kind"],
                url: parsed.url,
                data: parsed.data,
                content: parsed.content,
                mimeType: parsed.mimeType,
                caption: parsed.caption,
                filename: parsed.filename,
                text: parsed.text,
              });
            } else if (!parsed.type && parsed.content) {
              accumulated += parsed.content;
              setStreamingContent(accumulated);
            }
          } catch { /* skip malformed lines */ }
        }
      }

      if (accumulated || pendingAttachments.length > 0) {
        const assistantMsg: ChatMessage = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: accumulated,
          timestamp: Date.now(),
          isToolError: hadToolError || undefined,
          attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
        };
        const finalMessages = [...updatedMessages, assistantMsg];
        setMessages(finalMessages);
        saveChatHistory(agent.id, finalMessages);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Client-side abort — partial content already shown
      } else {
        const errorMsg: ChatMessage = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        };
        const finalMessages = [...updatedMessages, errorMsg];
        setMessages(finalMessages);
        saveChatHistory(agent.id, finalMessages);
      }
    } finally {
      setRunning(false);
      setStreamingContent("");
      abortControllerRef.current = null;
      runIdRef.current = null;
    }
  }

  async function handleStop() {
    if (!agent) return;
    if (runIdRef.current) {
      try {
        await apiRequest("POST", `/api/agents/${agent.id}/abort`, { runId: runIdRef.current });
      } catch { /* best-effort */ }
    }
    abortControllerRef.current?.abort();
  }

  function handleClear() {
    if (!agent) return;
    Alert.alert("Clear conversation", "Remove all messages with this agent?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          setMessages([]);
          setStreamingContent("");
          setIntegrationError(null);
          saveChatHistory(agent.id, []);
          sdkSessionIdRef.current = null;
          clearStoredSessionId(agent.id);
        },
      },
    ]);
  }

  function handleClose() {
    handleStop();
    setMessage("");
    setStreamingContent("");
    setRunning(false);
    setIntegrationError(null);
    prevAgentIdRef.current = null;
    onClose();
  }

  function handleGoToSettings() {
    const integration = integrationError?.integration;
    handleClose();
    router.push({ pathname: "/(tabs)/settings", params: integration ? { scrollTo: integration } : {} });
  }

  // Build display list: persisted messages + live streaming bubble
  const displayMessages = streamingContent
    ? [...messages, { id: "__streaming__", role: "assistant" as const, content: streamingContent, timestamp: Date.now() }]
    : messages;

  // Inverted FlatList: newest at bottom
  const invertedMessages = [...displayMessages].reverse();

  function renderAttachment(att: InAppAttachment, idx: number) {
    if (att.kind === "image") {
      const source = att.url
        ? { uri: att.url }
        : att.data
        ? { uri: `data:${att.mimeType ?? "image/png"};base64,${att.data}` }
        : null;
      if (!source) return null;
      return (
        <View key={idx} style={{ marginTop: 8 }}>
          <Image
            source={source}
            style={{ width: "100%", height: 200, borderRadius: 8 }}
            resizeMode="contain"
          />
          {!!att.caption && (
            <Text style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 4 }}>
              {att.caption}
            </Text>
          )}
        </View>
      );
    }

    if (att.kind === "markdown" && att.text) {
      return (
        <View key={idx} style={{ marginTop: 8, padding: 8, backgroundColor: Colors.background, borderRadius: 6, borderWidth: 1, borderColor: Colors.border }}>
          {!!att.caption && (
            <Text style={{ fontSize: 11, color: Colors.textSecondary, marginBottom: 4 }}>{att.caption}</Text>
          )}
          <Text style={{ fontSize: 13, color: Colors.text, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>
            {att.text}
          </Text>
        </View>
      );
    }

    if (att.kind === "file" || att.kind === "document") {
      const name = att.filename ?? "File";
      const hasLink = !!att.url;
      const rawPayload = att.data ?? att.content;
      const mimeType = att.mimeType ?? "";
      const isText = mimeType.includes("text") || mimeType.includes("json") || mimeType.includes("xml") || mimeType.includes("csv") || mimeType.includes("markdown");

      let textPreview: string | null = null;
      if (!hasLink && rawPayload && isText) {
        const decoded = safeAtob(rawPayload);
        if (decoded !== null) textPreview = decoded.slice(0, 500);
      }

      return (
        <View key={idx} style={{ marginTop: 8 }}>
          <TouchableOpacity
            activeOpacity={hasLink ? 0.7 : 1}
            onPress={hasLink ? () => {
              const u = att.url!;
              if (u.startsWith("https://") || u.startsWith("http://")) {
                Linking.openURL(u);
              }
            } : undefined}
            style={{ flexDirection: "row", alignItems: "center", padding: 10, backgroundColor: Colors.background, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, gap: 8 }}
          >
            <Ionicons name="document-outline" size={20} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: Colors.text, fontWeight: "500" as const }} numberOfLines={1}>{name}</Text>
              {!!att.caption && (
                <Text style={{ fontSize: 11, color: Colors.textSecondary }} numberOfLines={1}>{att.caption}</Text>
              )}
              {!hasLink && !!rawPayload && !isText && (
                <Text style={{ fontSize: 11, color: Colors.textTertiary }}>File content available</Text>
              )}
            </View>
            {hasLink && <Ionicons name="open-outline" size={14} color={Colors.textSecondary} />}
          </TouchableOpacity>
          {!!textPreview && (
            <View style={{ marginTop: 4, padding: 8, backgroundColor: Colors.background, borderRadius: 6, borderWidth: 1, borderColor: Colors.border }}>
              <Text style={{ fontSize: 12, color: Colors.text, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }} numberOfLines={12}>
                {textPreview}
              </Text>
            </View>
          )}
        </View>
      );
    }

    return null;
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isUser = item.role === "user";
    const isStreaming = item.id === "__streaming__";
    const isToolError = !isUser && !!item.isToolError;
    const attachments = !isUser ? (item.attachments ?? []) : [];
    return (
      <View style={[styles.chatBubbleRow, isUser ? styles.chatBubbleRowUser : styles.chatBubbleRowAgent]}>
        {!isUser && (
          <View
            style={[
              styles.chatAvatar,
              isToolError
                ? { backgroundColor: Colors.warningDim }
                : { backgroundColor: Colors.primary + "22" },
            ]}
          >
            <Ionicons
              name={isToolError ? "warning-outline" : "flash-outline"}
              size={12}
              color={isToolError ? Colors.warning : Colors.primary}
            />
          </View>
        )}
        <View
          style={[
            styles.chatBubble,
            isUser
              ? [styles.chatBubbleUser, { backgroundColor: Colors.primary }]
              : isToolError
              ? [styles.chatBubbleAgent, { backgroundColor: Colors.surface, borderColor: Colors.warning + "80" }]
              : [styles.chatBubbleAgent, { backgroundColor: Colors.surface, borderColor: Colors.border }],
          ]}
        >
          {isToolError && (
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 4 }}>
              <Ionicons name="warning-outline" size={12} color={Colors.warning} />
              <Text style={{ fontSize: 11, color: Colors.warning, fontWeight: "600" as const }}>
                Tool failed
              </Text>
            </View>
          )}
          {(item.content || isStreaming) && (
            <Text style={[styles.chatBubbleText, { color: isUser ? Colors.white : Colors.text }]}>
              {item.content}
            </Text>
          )}
          {attachments.map((att, idx) => renderAttachment(att, idx))}
          {isStreaming && (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 4, alignSelf: "flex-start" }} />
          )}
        </View>
      </View>
    );
  }

  const bottomPad = insets.bottom;

  return (
    <Modal visible={!!agent} animationType="slide" presentationStyle="formSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={[styles.sheet, { backgroundColor: Colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={[styles.sheetHeader, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity onPress={handleClose}>
            <Text style={[styles.sheetCancel, { color: Colors.textSecondary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.sheetTitle, { color: Colors.text }]} numberOfLines={1}>
            {agent?.name ?? ""}
          </Text>
          {running ? (
            <TouchableOpacity onPress={handleStop}>
              <Text style={[styles.sheetDone, { color: Colors.error }]}>Stop</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleClear} disabled={messages.length === 0}>
              <Ionicons
                name="trash-outline"
                size={18}
                color={messages.length > 0 ? Colors.textSecondary : Colors.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Messages */}
        {historyLoading ? (
          <View style={styles.chatEmpty}>
            <ActivityIndicator size="small" color={Colors.textTertiary} />
            <Text style={[styles.chatEmptyText, { color: Colors.textTertiary }]}>
              Loading conversation…
            </Text>
          </View>
        ) : displayMessages.length === 0 && !running ? (
          <View style={styles.chatEmpty}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={Colors.textTertiary} />
            <Text style={[styles.chatEmptyText, { color: Colors.textTertiary }]}>
              Start a conversation with {agent?.name ?? "this agent"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={invertedMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            inverted
            style={{ flex: 1 }}
            contentContainerStyle={styles.chatList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListFooterComponent={(() => {
              const historyWindow = agent?.isCoreAgent ? CHAT_HISTORY_WINDOW_MAIN : CHAT_HISTORY_WINDOW_SUB;
              return messages.length > historyWindow ? (
                <View style={[styles.trimBanner, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                  <Ionicons name="information-circle-outline" size={14} color={Colors.textTertiary} />
                  <Text style={[styles.trimBannerText, { color: Colors.textTertiary }]}>
                    Conversation is long — only the most recent context is sent to the agent
                  </Text>
                </View>
              ) : null;
            })()}
          />
        )}

        {/* Integration error */}
        {integrationError ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <IntegrationErrorCard
              integrationKey={integrationError.integration}
              cardStyle={{}}
              onDismiss={() => setIntegrationError(null)}
              onGoToSettings={handleGoToSettings}
            />
          </View>
        ) : null}

        {/* Input bar */}
        <View
          style={[
            styles.chatInputBar,
            {
              backgroundColor: Colors.background,
              borderTopColor: Colors.border,
              paddingBottom: bottomPad > 0 ? bottomPad : 12,
            },
          ]}
        >
          <TextInput
            style={[
              styles.chatInput,
              { backgroundColor: Colors.surface, color: Colors.text, borderColor: Colors.border },
            ]}
            value={message}
            onChangeText={setMessage}
            placeholder={`Message ${agent?.name ?? "agent"}…`}
            placeholderTextColor={Colors.textTertiary}
            multiline
            maxLength={2000}
            editable={!running}
            onSubmitEditing={handleRun}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[
              styles.chatSendBtn,
              { backgroundColor: message.trim() && !running ? Colors.primary : Colors.border },
            ]}
            onPress={handleRun}
            disabled={!message.trim() || running}
          >
            {running ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="arrow-up" size={18} color={Colors.white} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── SelfRepairAuditModal ───────────────────────────────────────────────────────

function SelfRepairAuditModal({
  entry,
  onClose,
}: {
  entry: AuditEntry | null;
  onClose: () => void;
}) {
  if (!entry) return null;

  const ts = new Date(entry.timestamp).toLocaleString();

  return (
    <Modal visible={!!entry} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.sheetCancel, { color: Colors.textSecondary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.sheetTitle, { color: Colors.text }]}>Self-Repair</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
          {/* File + timestamp */}
          <View style={[styles.personaCard, { backgroundColor: Colors.surface, borderColor: Colors.border, gap: 6 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[styles.roleIconWrap, { backgroundColor: Colors.primary + "22" }]}>
                <Ionicons name="code-slash-outline" size={16} color={Colors.primary} />
              </View>
              <Text style={[styles.cardName, { color: Colors.text, flex: 1 }]} numberOfLines={2}>
                {entry.file}
              </Text>
            </View>
            <Text style={[styles.metaText, { color: Colors.textTertiary }]}>{ts}</Text>
            {entry.changesSummary ? (
              <View style={[styles.coreBadge, { backgroundColor: Colors.primary + "22", alignSelf: "flex-start" }]}>
                <Text style={[styles.coreBadgeText, { color: Colors.primary }]}>{entry.changesSummary}</Text>
              </View>
            ) : null}
          </View>

          {/* Verification result */}
          {(() => {
            const v = (entry.verified ?? "pending").toLowerCase();
            const passed = v.startsWith("passed");
            const failed = v.startsWith("failed") || v.startsWith("error");
            const bg = passed ? "#16a34a22" : failed ? "#dc262622" : "#78716c22";
            const fg = passed ? "#16a34a" : failed ? "#dc2626" : Colors.textSecondary;
            const verifyIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
              passed: "checkmark-circle-outline",
              failed: "close-circle-outline",
              pending: "time-outline",
            };
            const iconKey = passed ? "passed" : failed ? "failed" : "pending";
            const label = passed ? "Passed" : failed ? "Failed" : "Pending";
            return (
              <>
                <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginTop: 16 }]}>VERIFICATION</Text>
                <View style={[styles.personaCard, { backgroundColor: bg, borderColor: Colors.border, flexDirection: "row", alignItems: "center", gap: 8 }]}>
                  <Ionicons name={verifyIcons[iconKey]} size={18} color={fg} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardName, { color: fg, fontSize: 14 }]}>{label}</Text>
                    {entry.verified && entry.verified !== "pending" && entry.verified !== "not recorded" ? (
                      <Text style={[styles.metaText, { color: fg, opacity: 0.8 }]} numberOfLines={2}>{entry.verified}</Text>
                    ) : null}
                  </View>
                </View>
              </>
            );
          })()}

          {/* Reason */}
          <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginTop: 16 }]}>REASON</Text>
          <View style={[styles.personaCard, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
            <Text style={[styles.personaText, { color: Colors.text }]}>{entry.reason || "No reason recorded"}</Text>
          </View>

          {/* Diff */}
          {entry.diff ? (
            <>
              <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginTop: 16 }]}>CHANGES</Text>
              <View style={[styles.personaCard, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <Text
                    style={{
                      fontSize: 11,
                      color: Colors.textSecondary,
                      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                      lineHeight: 18,
                    }}
                  >
                    {entry.diff}
                  </Text>
                </ScrollView>
              </View>
            </>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── SelfRepairAuditCard — inline card for one audit entry ─────────────────────

function SelfRepairAuditCard({
  entry,
  onPress,
  highlighted = false,
  onLayout,
}: {
  entry: AuditEntry;
  onPress: () => void;
  highlighted?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ts = new Date(entry.timestamp).toLocaleString();
  const shortFile = entry.file.split("/").pop() ?? entry.file;
  const flashAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!highlighted) return;
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
      Animated.timing(flashAnim, { toValue: 0, duration: 300, useNativeDriver: false }),
      Animated.timing(flashAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
      Animated.timing(flashAnim, { toValue: 0, duration: 400, useNativeDriver: false }),
    ]).start();
  }, [highlighted]);

  const animatedBg = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.surface, Colors.primary + "44"],
  });
  const animatedBorder = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.border, Colors.primary],
  });

  return (
    <Animated.View
      onLayout={onLayout}
      style={[styles.jobCard, { backgroundColor: animatedBg, borderColor: animatedBorder }]}
    >
      <TouchableOpacity activeOpacity={0.75} onPress={onPress}>
        <View style={styles.jobCardHeader}>
          <View style={[styles.jobIconWrap, { backgroundColor: Colors.primary + "22" }]}>
            <Ionicons name="construct-outline" size={16} color={Colors.primary} />
          </View>
          <View style={styles.jobCardTitle}>
            <Text style={[styles.jobTitle, { color: Colors.text }]} numberOfLines={1}>
              {shortFile}
            </Text>
            <Text style={[styles.jobAgent, { color: Colors.textSecondary }]} numberOfLines={1}>
              {entry.reason}
            </Text>
          </View>
          {(() => {
            const v = (entry.verified ?? "pending").toLowerCase();
            const passed = v.startsWith("passed");
            const failed = v.startsWith("failed") || v.startsWith("error");
            const bg = passed ? "#16a34a22" : failed ? "#dc262622" : "#78716c22";
            const fg = passed ? "#16a34a" : failed ? "#dc2626" : Colors.textSecondary;
            const verifyIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
              passed: "checkmark-circle-outline",
              failed: "close-circle-outline",
              pending: "time-outline",
            };
            const iconKey = passed ? "passed" : failed ? "failed" : "pending";
            return (
              <View style={[styles.coreBadge, { backgroundColor: bg, flexDirection: "row", alignItems: "center", gap: 3 }]}>
                <Ionicons name={verifyIcons[iconKey]} size={11} color={fg} />
                <Text style={[styles.coreBadgeText, { color: fg }]}>
                  {iconKey}
                </Text>
              </View>
            );
          })()}
        </View>
        <Text style={[styles.jobMeta, { color: Colors.textTertiary }]}>{ts}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── CouncilModal ───────────────────────────────────────────────────────────────

function CouncilModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<{ synthesis: string; succeededCount: number; agentCount: number } | null>(null);
  const [running, setRunning] = useState(false);

  async function handleRun() {
    if (!question.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await apiRequest("POST", "/api/agents/council", { question });
      const data = await res.json() as { synthesis: string; succeededCount: number; agentCount: number };
      setResult(data);
    } catch (err) {
      setResult({ synthesis: `Error: ${err instanceof Error ? err.message : String(err)}`, succeededCount: 0, agentCount: 0 });
    } finally {
      setRunning(false);
    }
  }

  function handleClose() {
    setQuestion("");
    setResult(null);
    setRunning(false);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={handleClose}>
      <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity onPress={handleClose}>
            <Text style={[styles.sheetCancel, { color: Colors.textSecondary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.sheetTitle, { color: Colors.text }]}>Council</Text>
          <TouchableOpacity onPress={handleRun} disabled={!question.trim() || running}>
            <Text style={[styles.sheetDone, { color: question.trim() && !running ? Colors.primary : Colors.textTertiary }]}>
              {running ? "Asking…" : "Ask"}
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <Text style={[styles.councilDesc, { color: Colors.textSecondary }]}>
            All your agents respond in parallel. Their answers are synthesized into one unified reply.
          </Text>
          <TextInput
            style={[styles.input, styles.inputMultiline, { backgroundColor: Colors.surface, color: Colors.text, borderColor: Colors.border }]}
            value={question}
            onChangeText={setQuestion}
            placeholder="Ask your council a question…"
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={3}
            autoFocus
          />
          {running && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>Consulting agents…</Text>
            </View>
          )}
          {result ? (
            <View style={[styles.replyBox, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
              <Text style={[styles.replyLabel, { color: Colors.textSecondary }]}>
                Synthesis ({result.succeededCount}/{result.agentCount} agents)
              </Text>
              <Text style={[styles.replyText, { color: Colors.text }]}>{result.synthesis}</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── TaskDetailSheet — shows a specific job's output and revision history ───────

function TaskDetailSheet({
  task,
  onClose,
}: {
  task: AgentTask | null;
  onClose: () => void;
}) {
  if (!task) return null;
  const statusColor = JOB_STATUS_COLORS[task.status] ?? "#6b7280";
  const statusLabel = JOB_STATUS_LABELS[task.status] ?? task.status;

  return (
    <Modal visible={!!task} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.sheetCancel, { color: Colors.textSecondary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.sheetTitle, { color: Colors.text }]} numberOfLines={1}>Task Output</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
          <View style={[styles.taskHero, { backgroundColor: statusColor + "15" }]}>
            <View style={[styles.jobIconWrap, { backgroundColor: statusColor + "22" }]}>
              <Ionicons
                name={task.status === "complete" ? "checkmark-circle-outline" :
                      task.status === "running" ? "flash-outline" :
                      task.status === "failed" ? "alert-circle-outline" : "archive-outline"}
                size={22}
                color={statusColor}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.taskHeroTitle, { color: Colors.text }]}>{task.title}</Text>
              <View style={styles.taskHeroMeta}>
                <Text style={[styles.taskHeroAgent, { color: Colors.primary }]}>{task.agentName}</Text>
                {task.iterationCount > 0 && (
                  <Text style={[styles.taskHeroIter, { color: Colors.textSecondary }]}>
                    · Iteration {task.iterationCount + 1}
                  </Text>
                )}
              </View>
            </View>
            <View style={[styles.jobStatusBadge, { backgroundColor: statusColor + "22" }]}>
              <Text style={[styles.jobStatusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>

          {task.output ? (
            <>
              <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginTop: 20 }]}>OUTPUT</Text>
              <View style={[styles.outputBox, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                <Text style={[styles.outputText, { color: Colors.text }]}>{task.output}</Text>
              </View>
            </>
          ) : task.status === "running" ? (
            <View style={styles.taskRunning}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>Agent is working…</Text>
            </View>
          ) : task.status === "queued" ? (
            <View style={styles.taskRunning}>
              <Ionicons name="time-outline" size={32} color={Colors.textTertiary} />
              <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>Waiting in queue…</Text>
            </View>
          ) : null}

          {task.error && (
            <>
              <Text style={[styles.fieldLabel, { color: Colors.error, marginTop: 20 }]}>ERROR</Text>
              <View style={[styles.outputBox, { backgroundColor: Colors.errorDim, borderColor: Colors.error + "33" }]}>
                <Text style={[styles.outputText, { color: Colors.error }]}>{task.error}</Text>
              </View>
            </>
          )}

          {(task.status === "complete" || task.status === "delivered") && (
            <View style={[styles.reviewHint, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.textSecondary} />
              <Text style={[styles.reviewHintText, { color: Colors.textSecondary }]}>
                {task.status === "complete"
                  ? "This task is ready for review. Ask Jarvis to approve it or request a revision."
                  : "This task has been approved and delivered."}
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── AgentDetailSheet ───────────────────────────────────────────────────────────

interface MemoryItem {
  id: string;
  content: string;
  category: string;
  createdAt: string;
}

function AgentDetailSheet({
  agent,
  activeTasks,
  onClose,
  onSave,
  onDelete,
  onToggle,
}: {
  agent: RosterAgent | null;
  activeTasks: AgentTask[];
  onClose: () => void;
  onSave: (id: string, data: Partial<RosterAgent> & { permissions: AgentPermissions }) => void;
  onDelete: (agent: RosterAgent) => void;
  onToggle: (agent: RosterAgent) => void;
}) {
  const [activeTab, setActiveTab] = useState<"overview" | "memories" | "config" | "policy">("overview");
  const [name, setName] = useState("");
  const [role, setRole] = useState("custom");
  const [persona, setPersona] = useState("");
  const [channelId, setChannelId] = useState("");
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopInterval, setLoopInterval] = useState("60");
  const [loopPrompt, setLoopPrompt] = useState("");
  const [perms, setPerms] = useState<AgentPermissions>({ ...DEFAULT_PERMISSIONS });
  const [mentionPatterns, setMentionPatterns] = useState<string[]>([]);
  const [mentionPatternInput, setMentionPatternInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [addingPattern, setAddingPattern] = useState(false);

  const queryClient = useQueryClient();

  const { data: memData, isLoading: memLoading } = useQuery<{ memories: MemoryItem[]; count: number }>({
    queryKey: ["/api/agents", agent?.id, "memories"],
    enabled: !!agent && activeTab === "memories",
  });

  const { data: policyData, isLoading: policyLoading } = useQuery<AgentPolicy>({
    queryKey: ["/api/agents", agent?.id, "policy"],
    enabled: !!agent && activeTab === "policy",
  });

  const setScopeMutation = useMutation({
    mutationFn: ({ scope }: { scope: PolicyScope }) =>
      apiRequest("PUT", `/api/agents/${agent!.id}/policy`, { scope }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/agents", agent?.id, "policy"] }),
  });

  const addPatternMutation = useMutation({
    mutationFn: ({ pattern }: { pattern: string }) =>
      apiRequest("POST", `/api/agents/${agent!.id}/policy/allowlist`, { pattern }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agent?.id, "policy"] });
      setNewPattern("");
      setAddingPattern(false);
    },
  });

  const removePatternMutation = useMutation({
    mutationFn: ({ patternId }: { patternId: string }) =>
      apiRequest("DELETE", `/api/agents/${agent!.id}/policy/allowlist/${patternId}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/agents", agent?.id, "policy"] }),
  });

  useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setRole(agent.role);
    setPersona(agent.persona ?? "");
    setChannelId(agent.channelId ?? "");
    setLoopEnabled(agent.loopEnabled === 1);
    setLoopInterval(String(agent.loopIntervalMinutes ?? 60));
    setLoopPrompt(agent.loopPrompt ?? "");
    setPerms({ ...DEFAULT_PERMISSIONS, ...(agent.permissions ?? {}) });
    setMentionPatterns(agent.mentionPatterns ?? []);
    setMentionPatternInput("");
    setSaving(false);
    setActiveTab("overview");
  }, [agent?.id]);

  function togglePerm(key: keyof AgentPermissions) {
    setPerms((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSave() {
    if (!agent || !name.trim()) return;
    setSaving(true);
    onSave(agent.id, {
      name: name.trim(),
      role,
      persona: persona.trim() || undefined,
      channelId: channelId.trim() || undefined,
      loopEnabled: loopEnabled ? 1 : 0,
      loopIntervalMinutes: parseInt(loopInterval, 10) || 60,
      loopPrompt: loopPrompt.trim() || undefined,
      permissions: perms,
      mentionPatterns,
    });
  }

  function handleAddPattern() {
    const trimmed = mentionPatternInput.trim();
    if (!trimmed) return;
    setMentionPatterns((prev) => [...prev, trimmed]);
    setMentionPatternInput("");
  }

  function handleRemovePattern(idx: number) {
    setMentionPatterns((prev) => prev.filter((_, i) => i !== idx));
  }

  if (!agent) return null;

  const roleColor = ROLE_COLORS[agent.role] || Colors.primary;
  const statusColor = STATUS_COLORS[agent.status] || "#6b7280";
  const memCount = memData?.count ?? agent.memoryCount;
  const memories = memData?.memories ?? [];

  return (
    <Modal visible={!!agent} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.sheetCancel, { color: Colors.textSecondary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.sheetTitle, { color: Colors.text }]} numberOfLines={1}>{agent.name}</Text>
          {activeTab === "config" ? (
            <TouchableOpacity onPress={handleSave} disabled={!name.trim() || saving}>
              {saving ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Text style={[styles.sheetDone, { color: name.trim() ? Colors.primary : Colors.textTertiary }]}>Save</Text>
              )}
            </TouchableOpacity>
          ) : (
            <View style={{ width: 48 }} />
          )}
        </View>

        {/* Hero block */}
        <View style={[styles.heroBlock, { backgroundColor: roleColor + "18" }]}>
          <View style={[styles.heroIconWrap, { backgroundColor: roleColor + "33" }]}>
            <Ionicons name={ROLE_ICONS[agent.role] ?? "person-outline"} size={28} color={roleColor} />
          </View>
          <View style={styles.heroInfo}>
            <View style={styles.heroStatusRow}>
              <PulsingDot color={statusColor} active={agent.status === "online"} />
              <Text style={[styles.heroStatus, { color: statusColor }]}>{STATUS_LABELS[agent.status]}</Text>
              <Text style={[styles.heroRole, { color: roleColor }]}>· {agent.role}</Text>
            </View>
            {agent.lastAction && (
              <Text style={[styles.heroLastAction, { color: Colors.textSecondary }]} numberOfLines={1}>
                {agent.lastAction}
              </Text>
            )}
          </View>
          <View style={styles.heroBadges}>
            <View style={[styles.heroBadge, { backgroundColor: Colors.background }]}>
              <Ionicons name="library-outline" size={11} color={Colors.textSecondary} />
              <Text style={[styles.heroBadgeText, { color: Colors.textSecondary }]}>{memCount}</Text>
            </View>
            {agent.loopEnabled === 1 && (
              <View style={[styles.heroBadge, { backgroundColor: Colors.background }]}>
                <Ionicons name="refresh-outline" size={11} color={Colors.textSecondary} />
                <Text style={[styles.heroBadgeText, { color: Colors.textSecondary }]}>{agent.loopIntervalMinutes}m</Text>
              </View>
            )}
          </View>
        </View>

        {/* Tab bar */}
        <View style={[styles.tabBar, { borderBottomColor: Colors.border }]}>
          {(["overview", "memories", "config", "policy"] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && { borderBottomColor: Colors.primary, borderBottomWidth: 2 }]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, { color: activeTab === tab ? Colors.primary : Colors.textSecondary }]}>
                {tab === "overview" ? "Overview"
                  : tab === "memories" ? `Memories${memCount > 0 ? ` (${memCount})` : ""}`
                  : tab === "config" ? "Config"
                  : "Policy"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Overview tab */}
        {activeTab === "overview" && (
          <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
            <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginTop: 4 }]}>PERSONA</Text>
            <View style={[styles.personaCard, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
              <Text style={[styles.personaText, { color: Colors.text }]}>
                {agent.persona || "No persona defined. Edit this agent to add one."}
              </Text>
            </View>

            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>PLATFORMS</Text>
            <View style={styles.platformRow}>
              {(agent.platforms ?? []).length > 0 ? (agent.platforms ?? []).map((p) => (
                <View key={p} style={[styles.platformChip, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                  <Ionicons name={PLATFORM_ICONS[p] ?? "ellipse-outline"} size={14} color={Colors.textSecondary} />
                  <Text style={[styles.platformChipText, { color: Colors.text }]}>{p}</Text>
                </View>
              )) : (
                <Text style={[styles.personaText, { color: Colors.textTertiary }]}>No platforms assigned</Text>
              )}
            </View>

            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>LOOP</Text>
            <View style={[styles.loopCard, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
              <View style={styles.loopRow}>
                <Ionicons
                  name={agent.loopEnabled ? "refresh-circle-outline" : "pause-circle-outline"}
                  size={18}
                  color={agent.loopEnabled ? Colors.primary : Colors.textTertiary}
                />
                <Text style={[styles.loopText, { color: agent.loopEnabled ? Colors.text : Colors.textTertiary }]}>
                  {agent.loopEnabled
                    ? `Runs every ${agent.loopIntervalMinutes} minutes`
                    : "Autonomous loop disabled"}
                </Text>
              </View>
              {agent.lastActivityAt && (
                <Text style={[styles.loopLastRun, { color: Colors.textTertiary }]}>
                  Last run: {new Date(agent.lastActivityAt).toLocaleString()}
                </Text>
              )}
              {agent.loopEnabled && agent.loopPrompt ? (
                <Text style={[styles.loopPromptSnippet, { color: Colors.textTertiary }]} numberOfLines={2}>
                  "{agent.loopPrompt.slice(0, 100)}{agent.loopPrompt.length > 100 ? "…" : ""}"
                </Text>
              ) : null}
            </View>

            {/* Recent actions log — tasks run by/assigned to this agent */}
            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>RECENT ACTIONS</Text>
            {(() => {
              const agentOutputs = activeTasks
                .filter((t) => t.agentId === agent.id)
                .slice(0, 5);

              if (agentOutputs.length === 0) {
                return (
                  <View style={[styles.recentOutputCard, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                    <View style={styles.recentOutputHeader}>
                      <Ionicons name="time-outline" size={14} color={Colors.textTertiary} />
                      <Text style={[styles.recentOutputText, { color: Colors.textTertiary, flex: 1 }]}>
                        {agent.lastAction ?? "No recent actions"}
                      </Text>
                    </View>
                    {agent.lastActivityAt && (
                      <Text style={[styles.jobMeta, { color: Colors.textTertiary }]}>
                        {new Date(agent.lastActivityAt).toLocaleString()}
                      </Text>
                    )}
                  </View>
                );
              }

              return agentOutputs.map((task) => {
                const statusColor = JOB_STATUS_COLORS[task.status] ?? "#6b7280";
                const statusLabel = JOB_STATUS_LABELS[task.status] ?? task.status;
                return (
                  <View
                    key={task.id}
                    style={[styles.recentOutputCard, { backgroundColor: Colors.surface, borderColor: Colors.border }]}
                  >
                    <View style={styles.recentOutputHeader}>
                      <Text style={[styles.recentOutputTitle, { color: Colors.text }]} numberOfLines={1}>
                        {task.title}
                      </Text>
                      <View style={[styles.jobStatusBadge, { backgroundColor: statusColor + "22" }]}>
                        <Text style={[styles.jobStatusText, { color: statusColor }]}>{statusLabel}</Text>
                      </View>
                    </View>
                    {task.output ? (
                      <Text style={[styles.recentOutputText, { color: Colors.textSecondary }]} numberOfLines={3}>
                        {task.output}
                      </Text>
                    ) : task.status === "running" || task.status === "queued" ? (
                      <Text style={[styles.recentOutputText, { color: Colors.textTertiary }]}>Working…</Text>
                    ) : null}
                    <Text style={[styles.jobMeta, { color: Colors.textTertiary }]}>
                      {new Date(task.createdAt).toLocaleString()}
                      {task.iterationCount > 0 ? ` · iter ${task.iterationCount + 1}` : ""}
                    </Text>
                  </View>
                );
              });
            })()}

            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>ACTIONS</Text>
            <View style={styles.actionBtnRow}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: agent.isActive ? Colors.errorDim : Colors.surface, borderColor: Colors.border }]}
                onPress={() => onToggle(agent)}
              >
                <Ionicons
                  name={agent.isActive ? "pause-outline" : "play-outline"}
                  size={15}
                  color={agent.isActive ? Colors.error : Colors.success}
                />
                <Text style={[styles.actionBtnText, { color: agent.isActive ? Colors.error : Colors.success }]}>
                  {agent.isActive ? "Disable" : "Enable"}
                </Text>
              </TouchableOpacity>

              {!agent.isCoreAgent && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: Colors.errorDim, borderColor: Colors.border }]}
                  onPress={() => { onClose(); setTimeout(() => onDelete(agent), 300); }}
                >
                  <Ionicons name="trash-outline" size={15} color={Colors.error} />
                  <Text style={[styles.actionBtnText, { color: Colors.error }]}>Delete</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        )}

        {/* Memories tab */}
        {activeTab === "memories" && (
          <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
            {memLoading ? (
              <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
            ) : memories.length === 0 ? (
              <View style={styles.emptyMem}>
                <Ionicons name="library-outline" size={36} color={Colors.textTertiary} />
                <Text style={[styles.emptyMemText, { color: Colors.textTertiary }]}>No memories yet</Text>
              </View>
            ) : (
              memories.map((mem) => (
                <View key={mem.id} style={[styles.memCard, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                  <View style={styles.memCardTop}>
                    <View style={[styles.memCategoryBadge, { backgroundColor: Colors.background }]}>
                      <Text style={[styles.memCategoryText, { color: Colors.textSecondary }]}>{mem.category}</Text>
                    </View>
                    <Text style={[styles.memDate, { color: Colors.textTertiary }]}>
                      {new Date(mem.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={[styles.memContent, { color: Colors.text }]}>{mem.content}</Text>
                </View>
              ))
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}

        {/* Config tab */}
        {activeTab === "config" && (
          <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>NAME</Text>
            <TextInput
              style={[styles.input, { backgroundColor: Colors.surface, borderColor: Colors.border, color: Colors.text }]}
              value={name}
              onChangeText={setName}
              placeholder="Agent name"
              placeholderTextColor={Colors.textTertiary}
              editable={!agent.isCoreAgent}
            />

            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>ROLE</Text>
            <View style={styles.roleGrid}>
              {ROLES.map((r) => {
                const isSelected = role === r;
                const color = ROLE_COLORS[r] || Colors.primary;
                return (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.roleChip,
                      {
                        backgroundColor: isSelected ? color + "22" : Colors.surface,
                        borderColor: isSelected ? color : Colors.border,
                      },
                    ]}
                    onPress={() => setRole(r)}
                  >
                    <Ionicons name={ROLE_ICONS[r] ?? "person-outline"} size={14} color={isSelected ? color : Colors.textSecondary} />
                    <Text style={[styles.roleChipText, { color: isSelected ? color : Colors.textSecondary }]}>{r}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>PERSONA</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline, { backgroundColor: Colors.surface, borderColor: Colors.border, color: Colors.text }]}
              value={persona}
              onChangeText={setPersona}
              placeholder="Describe how this agent should behave…"
              placeholderTextColor={Colors.textTertiary}
              multiline
            />

            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>DISCORD CHANNEL ID</Text>
            <TextInput
              style={[styles.input, { backgroundColor: Colors.surface, borderColor: Colors.border, color: Colors.text }]}
              value={channelId}
              onChangeText={setChannelId}
              placeholder="e.g. 1234567890123456789"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
            />

            {/* Loop controls */}
            <View style={[styles.detailSectionDivider, { borderTopColor: Colors.border }]} />
            <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>AUTONOMOUS LOOP</Text>
            <Text style={[styles.detailSectionHint, { color: Colors.textTertiary }]}>
              When enabled, this agent runs a scheduled task on its own without being asked.
            </Text>

            <View style={[styles.loopToggleRow, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
              <Ionicons
                name={loopEnabled ? "refresh-circle-outline" : "pause-circle-outline"}
                size={20}
                color={loopEnabled ? Colors.primary : Colors.textTertiary}
              />
              <Text style={[styles.loopToggleLabel, { color: Colors.text }]}>
                {loopEnabled ? "Loop enabled" : "Loop disabled"}
              </Text>
              <Switch
                value={loopEnabled}
                onValueChange={setLoopEnabled}
                trackColor={{ false: Colors.border, true: Colors.primary + "55" }}
                thumbColor={loopEnabled ? Colors.primary : Colors.textTertiary}
              />
            </View>

            {loopEnabled && (
              <>
                <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>INTERVAL (MINUTES)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: Colors.surface, borderColor: Colors.border, color: Colors.text }]}
                  value={loopInterval}
                  onChangeText={setLoopInterval}
                  placeholder="60"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                />

                <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>LOOP TASK PROMPT</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline, { backgroundColor: Colors.surface, borderColor: Colors.border, color: Colors.text }]}
                  value={loopPrompt}
                  onChangeText={setLoopPrompt}
                  placeholder="What should this agent do each cycle? E.g. 'Review the channel and post a summary of any important updates.'"
                  placeholderTextColor={Colors.textTertiary}
                  multiline
                  numberOfLines={4}
                />
              </>
            )}

            <View style={[styles.detailSectionDivider, { borderTopColor: Colors.border }]} />
            <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>MENTION PATTERNS</Text>
            <Text style={[styles.detailSectionHint, { color: Colors.textTertiary }]}>
              Messages containing these words or patterns will always route to this agent, regardless of which channel they arrive in. Wrap in /slashes/ for regex, e.g. /^@research/i
            </Text>

            {mentionPatterns.map((pattern, idx) => (
              <View
                key={idx}
                style={[styles.mentionChip, { backgroundColor: Colors.surface, borderColor: Colors.border }]}
              >
                <Text style={[styles.mentionChipText, { color: Colors.text }]} numberOfLines={1}>
                  {pattern}
                </Text>
                <TouchableOpacity onPress={() => handleRemovePattern(idx)} style={styles.mentionChipRemove}>
                  <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
                </TouchableOpacity>
              </View>
            ))}

            <View style={styles.mentionInputRow}>
              <TextInput
                style={[styles.mentionInput, { backgroundColor: Colors.surface, borderColor: Colors.border, color: Colors.text }]}
                value={mentionPatternInput}
                onChangeText={setMentionPatternInput}
                placeholder="e.g. @research or /^hey jarvis/i"
                placeholderTextColor={Colors.textTertiary}
                onSubmitEditing={handleAddPattern}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.mentionAddBtn, { backgroundColor: Colors.primary, opacity: mentionPatternInput.trim() ? 1 : 0.4 }]}
                onPress={handleAddPattern}
                disabled={!mentionPatternInput.trim()}
              >
                <Text style={styles.mentionAddBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.detailSectionDivider, { borderTopColor: Colors.border }]} />
            <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>PERMISSIONS</Text>
            <Text style={[styles.detailSectionHint, { color: Colors.textTertiary }]}>
              High-risk capabilities require approval gates before running.
            </Text>

            <View style={[styles.permsList, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
              {(Object.keys(PERM_LABELS) as Array<keyof AgentPermissions>).map((key, idx, arr) => {
                const { label, icon, danger } = PERM_LABELS[key];
                const isLast = idx === arr.length - 1;
                return (
                  <View key={key}>
                    <View style={styles.permRow}>
                      <View style={[styles.permIconWrap, { backgroundColor: danger ? Colors.errorDim : Colors.background }]}>
                        <Ionicons name={icon} size={15} color={danger ? Colors.error : Colors.textSecondary} />
                      </View>
                      <Text style={[styles.permLabel, { color: Colors.text }]} numberOfLines={1}>{label}</Text>
                      {danger && (
                        <View style={[styles.dangerBadge, { backgroundColor: Colors.errorDim }]}>
                          <Text style={[styles.dangerText, { color: Colors.error }]}>approval</Text>
                        </View>
                      )}
                      <Switch
                        value={perms[key]}
                        onValueChange={() => togglePerm(key)}
                        trackColor={{ false: Colors.border, true: Colors.primary + "55" }}
                        thumbColor={perms[key] ? Colors.primary : Colors.textTertiary}
                      />
                    </View>
                    {!isLast && <View style={[styles.permDivider, { backgroundColor: Colors.border }]} />}
                  </View>
                );
              })}
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        )}

        {/* Policy tab */}
        {activeTab === "policy" && (
          <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={[styles.detailSectionHint, { color: Colors.textTertiary, marginTop: 0 }]}>
              Control when this agent needs your approval before running high-risk tools.
            </Text>

            {/* Scope picker */}
            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>APPROVAL SCOPE</Text>
            {policyLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 12 }} />
            ) : (
              <View style={[styles.permsList, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                {(["global", "permissive", "strict", "custom"] as PolicyScope[]).map((scope, idx, arr) => {
                  const { label, description, color } = POLICY_SCOPE_LABELS[scope];
                  const isSelected = (policyData?.scope ?? "global") === scope;
                  const isLast = idx === arr.length - 1;
                  return (
                    <View key={scope}>
                      <TouchableOpacity
                        style={styles.permRow}
                        onPress={() => setScopeMutation.mutate({ scope })}
                        disabled={setScopeMutation.isPending}
                      >
                        <View style={[styles.permIconWrap, { backgroundColor: isSelected ? color + "22" : Colors.background }]}>
                          <Ionicons
                            name={
                              scope === "global" ? "globe-outline" :
                              scope === "permissive" ? "checkmark-circle-outline" :
                              scope === "strict" ? "lock-closed-outline" :
                              "list-outline"
                            }
                            size={15}
                            color={isSelected ? color : Colors.textSecondary}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.permLabel, { color: isSelected ? color : Colors.text, fontWeight: isSelected ? "600" : "400" }]}>
                            {label}
                          </Text>
                          <Text style={[styles.metaText, { color: Colors.textTertiary, marginTop: 1 }]}>{description}</Text>
                        </View>
                        {isSelected && (
                          <Ionicons name="checkmark" size={16} color={color} />
                        )}
                      </TouchableOpacity>
                      {!isLast && <View style={[styles.permDivider, { backgroundColor: Colors.border }]} />}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Allowlist patterns */}
            <View style={[styles.detailSectionDivider, { borderTopColor: Colors.border, marginTop: 20 }]} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 6 }}>
              <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginTop: 0, marginBottom: 0 }]}>
                TOOL ALLOWLIST
              </Text>
              <TouchableOpacity
                style={[styles.runBtn, { backgroundColor: Colors.primary + "22" }]}
                onPress={() => setAddingPattern(true)}
              >
                <Ionicons name="add" size={16} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.detailSectionHint, { color: Colors.textTertiary, marginTop: 0, marginBottom: 8 }]}>
              Tools matching a pattern here are auto-approved for this agent regardless of scope. Wildcards supported: e.g. gmail_*
            </Text>

            {addingPattern && (
              <View style={[styles.loopToggleRow, { backgroundColor: Colors.surface, borderColor: Colors.primary + "55", marginBottom: 10 }]}>
                <TextInput
                  style={[styles.chatInput, { flex: 1, backgroundColor: "transparent", borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0, fontSize: 14, height: 32 }]}
                  value={newPattern}
                  onChangeText={setNewPattern}
                  placeholder="e.g. gmail_* or browser_navigate"
                  placeholderTextColor={Colors.textTertiary}
                  autoFocus
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[styles.chatSendBtn, { width: 32, height: 32, backgroundColor: newPattern.trim() ? Colors.primary : Colors.border }]}
                  onPress={() => { if (newPattern.trim()) addPatternMutation.mutate({ pattern: newPattern.trim() }); }}
                  disabled={!newPattern.trim() || addPatternMutation.isPending}
                >
                  <Ionicons name="checkmark" size={16} color={Colors.white} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chatSendBtn, { width: 32, height: 32, backgroundColor: Colors.background }]}
                  onPress={() => { setAddingPattern(false); setNewPattern(""); }}
                >
                  <Ionicons name="close" size={16} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
            )}

            {policyLoading ? null : (policyData?.allowlist ?? []).length === 0 ? (
              <View style={[styles.personaCard, { backgroundColor: Colors.surface, borderColor: Colors.border, alignItems: "center", gap: 6 }]}>
                <Ionicons name="list-outline" size={22} color={Colors.textTertiary} />
                <Text style={[styles.personaText, { color: Colors.textTertiary, textAlign: "center" }]}>
                  No allowlist patterns yet.{"\n"}Tap + to add one.
                </Text>
              </View>
            ) : (
              <View style={[styles.permsList, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                {(policyData?.allowlist ?? []).map((entry, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  const lastUsed = entry.lastUsedAt
                    ? new Date(entry.lastUsedAt).toLocaleDateString()
                    : "never";
                  return (
                    <View key={entry.id}>
                      <View style={styles.permRow}>
                        <View style={[styles.permIconWrap, { backgroundColor: Colors.background }]}>
                          <Ionicons name="code-slash-outline" size={13} color={Colors.textSecondary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.permLabel, { color: Colors.text, fontFamily: "monospace", fontSize: 13 }]}>
                            {entry.pattern}
                          </Text>
                          <Text style={[styles.metaText, { color: Colors.textTertiary, marginTop: 1 }]}>
                            Used {entry.useCount}× · last {lastUsed}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => Alert.alert(
                            "Remove pattern",
                            `Remove "${entry.pattern}" from the allowlist?`,
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Remove", style: "destructive", onPress: () => removePatternMutation.mutate({ patternId: entry.id }) },
                            ]
                          )}
                          disabled={removePatternMutation.isPending}
                          style={{ padding: 4 }}
                        >
                          <Ionicons name="trash-outline" size={15} color={Colors.error} />
                        </TouchableOpacity>
                      </View>
                      {!isLast && <View style={[styles.permDivider, { backgroundColor: Colors.border }]} />}
                    </View>
                  );
                })}
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function AgentsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [runAgent, setRunAgent] = useState<RosterAgent | null>(null);
  const [showCouncil, setShowCouncil] = useState(false);
  const [detailAgent, setDetailAgent] = useState<RosterAgent | null>(null);
  const [detailTask, setDetailTask] = useState<AgentTask | null>(null);
  const [qualityCheckEnabled, setQualityCheckEnabled] = useState(true);
  const [auditEntry, setAuditEntry] = useState<AuditEntry | null>(null);
  const [highlightedAuditKey, setHighlightedAuditKey] = useState<string | null>(null);
  const pendingHighlightKeyRef = useRef<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const cardLayoutsRef = useRef<Record<string, number>>({});

  // Deep-link params: auditTs + auditFile are set when the user taps a
  // self-repair failure notification that includes a gameplan://agents?auditTs=...&auditFile=... link.
  const { auditTs, auditFile } = useLocalSearchParams<{ auditTs?: string; auditFile?: string }>();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { data, isLoading, refetch, isRefetching } = useQuery<{
    agents: RosterAgent[];
    activeTasks: AgentTask[];
  }>({
    queryKey: ["/api/agents/roster"],
    refetchInterval: 20000,
  });

  const { data: integrationReadiness } = useQuery<Record<string, IntegrationReadiness>>({
    queryKey: ["/api/integrations/status"],
    refetchInterval: 60000,
    retry: 1,
  });

  const { data: prefs } = useQuery<Record<string, unknown>>({
    queryKey: ["/api/preferences"],
    select: (d) => d,
    staleTime: 60_000,
  });

  const { data: auditData } = useQuery<{ entries: AuditEntry[]; total: number }>({
    queryKey: ["/api/self-heal/audit"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (prefs && "responseQualityCheck" in prefs) {
      setQualityCheckEnabled(prefs.responseQualityCheck !== false);
    }
  }, [prefs]);

  // When the screen is opened via a deep link (gameplan://agents?auditTs=...&auditFile=...),
  // find the matching audit entry and open its detail modal. The highlight + scroll is deferred
  // until the modal is dismissed so the user actually sees the animated card.
  useEffect(() => {
    if (!auditTs || !auditData?.entries) return;
    const match = auditData.entries.find(
      (e) =>
        e.timestamp === auditTs &&
        (!auditFile || e.file === auditFile),
    );
    if (match) {
      const key = `${match.timestamp}|${match.file}`;
      pendingHighlightKeyRef.current = key;
      setAuditEntry(match);
    }
  }, [auditTs, auditFile, auditData]);

  useEffect(() => {
    if (!highlightedAuditKey) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tryScroll = (attempts = 0) => {
      if (cancelled) return;
      const y = cardLayoutsRef.current[highlightedAuditKey];
      if (y !== undefined) {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
      } else if (attempts < 6) {
        const t = setTimeout(() => tryScroll(attempts + 1), 150);
        timers.push(t);
      }
    };
    const t = setTimeout(() => tryScroll(), 200);
    timers.push(t);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [highlightedAuditKey]);

  function handleAuditCardLayout(ts: string, file: string, event: LayoutChangeEvent) {
    cardLayoutsRef.current[`${ts}|${file}`] = event.nativeEvent.layout.y;
  }

  function handleAuditModalClose() {
    setAuditEntry(null);
    if (pendingHighlightKeyRef.current) {
      const key = pendingHighlightKeyRef.current;
      pendingHighlightKeyRef.current = null;
      // Reset to null first so repeated deep links always retrigger the effect
      setHighlightedAuditKey(null);
      setTimeout(() => setHighlightedAuditKey(key), 0);
    }
  }

  const prefMutation = useMutation({
    mutationFn: (value: boolean) =>
      apiRequest("PATCH", "/api/preferences", { responseQualityCheck: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/preferences"] }),
  });

  const agents = data?.agents ?? [];
  const activeTasks = data?.activeTasks ?? [];
  const coreAgents = agents.filter((a) => a.isCoreAgent);
  const customAgents = agents.filter((a) => !a.isCoreAgent);
  const runningJobs = activeTasks.filter((t) => ["queued", "running"].includes(t.status));
  const recentJobs = activeTasks.filter((t) => !["queued", "running"].includes(t.status)).slice(0, 10);
  const onlineCount = agents.filter((a) => a.status === "online").length;
  const activeCount = agents.filter((a) => a.isActive === 1).length;

  // Fallback core agent names if seeding silently failed
  const missingCoreNames = CORE_PLACEHOLDER_NAMES.filter(
    (n) => !coreAgents.some((a) => a.name === n)
  );

  const createMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/agents", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents/roster"] });
      setShowCreate(false);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      apiRequest("POST", `/api/agents/${id}/${enable ? "enable" : "disable"}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents/roster"] });
      setDetailAgent(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/agents/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents/roster"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => apiRequest("PUT", `/api/agents/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents/roster"] });
      setDetailAgent(null);
    },
  });

  function handleDelete(agent: RosterAgent) {
    Alert.alert(
      `Delete ${agent.name}?`,
      "This will permanently remove the agent and all its memories.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(agent.id) },
      ],
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: Colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Agents</Text>
          <View style={styles.headerStatRow}>
            <View style={[styles.onlineDot, { backgroundColor: onlineCount > 0 ? "#22c55e" : runningJobs.length > 0 ? Colors.primary : "#6b7280" }]} />
            <Text style={[styles.headerSub, { color: Colors.textSecondary }]}>
              {runningJobs.length > 0
                ? `${runningJobs.length} task${runningJobs.length === 1 ? "" : "s"} running`
                : onlineCount > 0
                ? `${onlineCount} online`
                : `${activeCount} active`}
              {agents.length > 0 ? ` · ${agents.length} agent${agents.length === 1 ? "" : "s"}` : ""}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          {activeCount >= 2 && (
            <TouchableOpacity
              style={[styles.councilBtn, { backgroundColor: Colors.surface, borderColor: Colors.border }]}
              onPress={() => setShowCouncil(true)}
            >
              <Ionicons name="people-outline" size={16} color={Colors.primary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: Colors.primary }]}
            onPress={() => setShowCreate(true)}
          >
            <Ionicons name="add" size={20} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={[styles.loadingHint, { color: Colors.textSecondary }]}>Waking agents…</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 100 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Active tasks — running/queued jobs */}
          {runningJobs.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>ACTIVE TASKS</Text>
                <View style={[styles.sectionBadge, { backgroundColor: Colors.success + "22" }]}>
                  <ActivityIndicator size="small" color={Colors.success} style={{ width: 10, height: 10 }} />
                  <Text style={[styles.sectionBadgeText, { color: Colors.success }]}>{runningJobs.length}</Text>
                </View>
              </View>
              {runningJobs.map((job) => (
                <JobTaskCard key={job.id} job={job} onPress={() => setDetailTask(job)} />
              ))}
            </>
          )}

          {/* Core platform bots */}
          <View style={[styles.sectionHeader, { marginTop: runningJobs.length > 0 ? 16 : 0 }]}>
            <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>PLATFORM BOTS</Text>
            <View style={[styles.sectionBadge, { backgroundColor: Colors.primary + "22" }]}>
              <Text style={[styles.sectionBadgeText, { color: Colors.primary }]}>always on</Text>
            </View>
          </View>
          {coreAgents.map((agent) => (
            <LivingAgentCard
              key={agent.id}
              agent={agent}
              integrations={integrationReadiness}
              onDetail={setDetailAgent}
              onRun={setRunAgent}
            />
          ))}
          {/* Fallback placeholders for any core agents not yet seeded */}
          {!isLoading && missingCoreNames.map((n) => (
            <CorePlaceholderCard key={n} name={n} />
          ))}

          {/* Custom / orchestrator-spawned agents */}
          {customAgents.length > 0 && (
            <>
              <View style={[styles.sectionHeader, { marginTop: 16 }]}>
                <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>AGENTS</Text>
                <Text style={[styles.sectionHint, { color: Colors.textTertiary }]}>
                  spawned by orchestrator
                </Text>
              </View>
              {customAgents.map((agent) => (
                <LivingAgentCard
                  key={agent.id}
                  agent={agent}
                  integrations={integrationReadiness}
                  onDetail={setDetailAgent}
                  onRun={setRunAgent}
                />
              ))}
            </>
          )}

          {/* Empty custom agents hint */}
          {customAgents.length === 0 && (
            <View style={[styles.emptyCustomCard, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
              <Ionicons name="git-network-outline" size={22} color={Colors.textTertiary} />
              <Text style={[styles.emptyCustomTitle, { color: Colors.textSecondary }]}>
                No agents yet
              </Text>
              <Text style={[styles.emptyCustomSub, { color: Colors.textTertiary }]}>
                Tell Jarvis to "set up a researcher agent" or "create a coder in Discord" — the orchestrator spawns them with their own persona, memory, and channel.
              </Text>
            </View>
          )}

          {/* Completed tasks */}
          {recentJobs.length > 0 && (
            <>
              <View style={[styles.sectionHeader, { marginTop: 20 }]}>
                <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>RECENT TASKS</Text>
              </View>
              {recentJobs.map((job) => (
                <JobTaskCard key={job.id} job={job} onPress={() => setDetailTask(job)} />
              ))}
            </>
          )}

          {/* Self-repair audit history */}
          {(auditData?.entries?.length ?? 0) > 0 && (
            <>
              <View style={[styles.sectionHeader, { marginTop: 20 }]}>
                <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>SELF-REPAIRS</Text>
                {(auditData?.total ?? 0) > 0 && (
                  <View style={[styles.sectionBadge, { backgroundColor: Colors.primary + "22" }]}>
                    <Text style={[styles.sectionBadgeText, { color: Colors.primary }]}>
                      {auditData!.total} total
                    </Text>
                  </View>
                )}
              </View>
              {auditData!.entries.map((entry, idx) => (
                <SelfRepairAuditCard
                  key={`${entry.timestamp}-${idx}`}
                  entry={entry}
                  onPress={() => setAuditEntry(entry)}
                  highlighted={highlightedAuditKey === `${entry.timestamp}|${entry.file}`}
                  onLayout={(e) => handleAuditCardLayout(entry.timestamp, entry.file, e)}
                />
              ))}
            </>
          )}

          {/* Quality review preference */}
          <View style={[styles.sectionHeader, { marginTop: 20 }]}>
            <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>QUALITY REVIEW</Text>
          </View>
          <View style={[styles.loopToggleRow, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
            <Ionicons
              name="shield-checkmark-outline"
              size={20}
              color={qualityCheckEnabled ? Colors.primary : Colors.textTertiary}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.loopToggleLabel, { color: Colors.text }]}>
                Response quality check
              </Text>
              <Text style={[styles.detailSectionHint, { color: Colors.textTertiary, marginTop: 0 }]} numberOfLines={2}>
                Jarvis reviews agent replies before sending. May add 1–2s on complex requests.
              </Text>
            </View>
            <Switch
              value={qualityCheckEnabled}
              onValueChange={(v) => {
                setQualityCheckEnabled(v);
                prefMutation.mutate(v);
              }}
              trackColor={{ false: Colors.border, true: Colors.primary + "55" }}
              thumbColor={qualityCheckEnabled ? Colors.primary : Colors.textTertiary}
            />
          </View>
        </ScrollView>
      )}

      {/* Modals */}
      <CreateAgentSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={(d) => createMutation.mutate(d)}
      />
      <RunModal agent={runAgent} onClose={() => setRunAgent(null)} />
      <CouncilModal visible={showCouncil} onClose={() => setShowCouncil(false)} />
      <AgentDetailSheet
        agent={detailAgent}
        activeTasks={activeTasks}
        onClose={() => setDetailAgent(null)}
        onSave={(id, d) => updateMutation.mutate({ id, data: d })}
        onDelete={handleDelete}
        onToggle={(a) => toggleMutation.mutate({ id: a.id, enable: a.isActive !== 1 })}
      />
      <TaskDetailSheet task={detailTask} onClose={() => setDetailTask(null)} />
      <SelfRepairAuditModal entry={auditEntry} onClose={handleAuditModalClose} />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  headerTitle: { fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  headerStatRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  headerSub: { fontSize: 13 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 2 },
  councilBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center", borderWidth: 1,
  },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },

  list: { flex: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, paddingHorizontal: 4 },
  sectionLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.8 },
  sectionHint: { fontSize: 11 },
  sectionBadge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, flexDirection: "row", alignItems: "center", gap: 4 },
  sectionBadgeText: { fontSize: 10, fontWeight: "600" },

  // Job task card
  jobCard: {
    borderRadius: 12, borderWidth: 1,
    marginBottom: 8, padding: 12,
  },
  jobCardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  jobIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  jobCardTitle: { flex: 1 },
  jobTitle: { fontSize: 14, fontWeight: "600" },
  jobAgent: { fontSize: 11, marginTop: 1 },
  jobStatusBadge: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    flexDirection: "row", alignItems: "center", gap: 4,
  },
  jobStatusText: { fontSize: 11, fontWeight: "600" },
  jobOutput: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  jobMeta: { fontSize: 10, marginTop: 6 },

  // Living agent card
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

  // Empty custom agents card
  emptyCustomCard: {
    borderRadius: 12, borderWidth: 1, borderStyle: "dashed",
    padding: 20, marginTop: 8, marginBottom: 4,
    alignItems: "center", gap: 8,
  },
  emptyCustomTitle: { fontSize: 15, fontWeight: "600" },
  emptyCustomSub: { fontSize: 13, lineHeight: 18, textAlign: "center" },

  // Loading
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingHint: { fontSize: 14 },

  // Sheet
  sheet: { flex: 1, paddingTop: 16 },
  sheetHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: "600", flex: 1, textAlign: "center", marginHorizontal: 8 },
  sheetCancel: { fontSize: 16, minWidth: 48 },
  sheetDone: { fontSize: 16, fontWeight: "600", minWidth: 48, textAlign: "right" },
  sheetBody: { flex: 1, padding: 20 },

  // Task detail sheet
  taskHero: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12,
  },
  taskHeroTitle: { fontSize: 15, fontWeight: "600", flex: 1 },
  taskHeroMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  taskHeroAgent: { fontSize: 12, fontWeight: "600" },
  taskHeroIter: { fontSize: 12 },
  outputBox: { borderRadius: 10, borderWidth: 1, padding: 14 },
  outputText: { fontSize: 13, lineHeight: 19 },
  taskRunning: { alignItems: "center", gap: 12, marginTop: 40 },
  reviewHint: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 16,
  },
  reviewHintText: { fontSize: 13, lineHeight: 18, flex: 1 },

  // Hero block in agent detail
  heroBlock: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  heroIconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  heroInfo: { flex: 1 },
  heroStatusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroStatus: { fontSize: 13, fontWeight: "600" },
  heroRole: { fontSize: 13, fontWeight: "500", textTransform: "capitalize" },
  heroLastAction: { fontSize: 12, marginTop: 3 },
  heroBadges: { gap: 4 },
  heroBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  heroBadgeText: { fontSize: 11, fontWeight: "500" },

  // Tab bar
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  tab: {
    flex: 1, paddingVertical: 10, alignItems: "center",
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabText: { fontSize: 13, fontWeight: "500" },

  // Overview
  personaCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 4 },
  personaText: { fontSize: 14, lineHeight: 20 },
  platformRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  platformChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  platformChipText: { fontSize: 13, fontWeight: "500" },
  loopCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 4 },
  loopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  loopText: { fontSize: 14, flex: 1 },
  loopLastRun: { fontSize: 12, marginTop: 6 },
  loopPromptSnippet: { fontSize: 12, lineHeight: 17, marginTop: 6, fontStyle: "italic" },
  actionBtnRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
  },
  actionBtnText: { fontSize: 14, fontWeight: "500" },

  // Memories tab
  emptyMem: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 12 },
  emptyMemText: { fontSize: 14 },
  memCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  memCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  memCategoryBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  memCategoryText: { fontSize: 10, fontWeight: "600", textTransform: "uppercase" },
  memDate: { fontSize: 11 },
  memContent: { fontSize: 13, lineHeight: 19 },

  // Config tab
  fieldLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.8, marginBottom: 6, marginTop: 16 },
  input: {
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 90, paddingTop: 10, textAlignVertical: "top" },
  roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roleChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
  },
  roleChipText: { fontSize: 13, fontWeight: "500" },
  loopToggleRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  loopToggleLabel: { flex: 1, fontSize: 15 },
  detailSectionDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 24 },
  detailSectionHint: { fontSize: 12, lineHeight: 16, marginBottom: 10, marginTop: 6 },
  permsList: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  permRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10, gap: 10,
  },
  permIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  permLabel: { flex: 1, fontSize: 14 },
  dangerBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dangerText: { fontSize: 10, fontWeight: "600" as const },
  permDivider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },

  // Recent outputs in Overview tab
  recentOutputCard: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  recentOutputHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  recentOutputTitle: { fontSize: 13, fontWeight: "600", flex: 1, marginRight: 8 },
  recentOutputText: { fontSize: 12, lineHeight: 17, marginBottom: 4 },

  // Shared
  replyBox: { borderRadius: 10, borderWidth: 1, padding: 14, marginTop: 16 },
  replyLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.8, marginBottom: 8 },
  replyText: { fontSize: 14, lineHeight: 20 },
  councilDesc: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  loadingText: { fontSize: 14 },

  // Chat (RunModal)
  chatList: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  chatEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  chatEmptyText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  chatBubbleRow: { flexDirection: "row", marginBottom: 12, alignItems: "flex-end", gap: 8 },
  chatBubbleRowUser: { justifyContent: "flex-end" },
  chatBubbleRowAgent: { justifyContent: "flex-start" },
  chatAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chatBubble: { maxWidth: "78%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  chatBubbleUser: { borderBottomRightRadius: 4 },
  chatBubbleAgent: { borderWidth: 1, borderBottomLeftRadius: 4 },
  chatBubbleText: { fontSize: 14, lineHeight: 20 },
  chatInputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chatInput: {
    flex: 1, borderRadius: 22, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, maxHeight: 120,
  },
  chatSendBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  trimBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 16, marginBottom: 8, marginTop: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
  },
  trimBannerText: { flex: 1, fontSize: 12, lineHeight: 16 },
  mentionChip: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10, paddingVertical: 7,
    marginBottom: 6, gap: 6,
  },
  mentionChipText: { flex: 1, fontSize: 14 },
  mentionChipRemove: { padding: 2 },
  mentionInputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  mentionInput: {
    flex: 1, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14,
  },
  mentionAddBtn: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 8, alignItems: "center", justifyContent: "center",
  },
  mentionAddBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
