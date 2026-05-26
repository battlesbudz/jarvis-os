import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Platform,
  Alert,
  RefreshControl,
  Switch,
  LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { CouncilModal } from "@/components/agents/CouncilModal";
import { CreateAgentSheet } from "@/components/agents/CreateAgentSheet";
import { JobTaskCard, JOB_STATUS_COLORS, JOB_STATUS_LABELS, type AgentTask } from "@/components/agents/JobTaskCard";
import { LivingAgentCard, PulsingDot } from "@/components/agents/LivingAgentCard";
import { RunModal } from "@/components/agents/RunModal";
import {
  SelfRepairAuditCard,
  SelfRepairAuditModal,
  type AuditEntry,
} from "@/components/agents/SelfRepairAudit";
import { TaskDetailSheet } from "@/components/agents/TaskDetailSheet";
import { ROLE_COLORS, ROLE_ICONS, ROLES } from "@/lib/agents/roleMeta";

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

const PLATFORM_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  telegram: "paper-plane-outline",
  discord: "logo-discord",
  slack: "logo-slack",
  whatsapp: "chatbubbles-outline",
  mobile: "phone-portrait-outline",
  orchestrator: "git-network-outline",
};


// Hardcoded fallback so the PLATFORM BOTS section is never empty
const CORE_PLACEHOLDER_NAMES = ["Jarvis Telegram Bot", "Jarvis Discord Bot", "Discord Channel Agent"];


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
  const detailAgentId = agent?.id;
  const detailAgentName = agent?.name;
  const detailAgentRole = agent?.role;
  const detailAgentPersona = agent?.persona;
  const detailAgentChannelId = agent?.channelId;
  const detailAgentLoopEnabled = agent?.loopEnabled;
  const detailAgentLoopIntervalMinutes = agent?.loopIntervalMinutes;
  const detailAgentLoopPrompt = agent?.loopPrompt;
  const detailAgentPermissions = agent?.permissions;
  const detailAgentMentionPatterns = agent?.mentionPatterns;

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
    if (!detailAgentId) return;
    setName(detailAgentName ?? "");
    setRole(detailAgentRole ?? "custom");
    setPersona(detailAgentPersona ?? "");
    setChannelId(detailAgentChannelId ?? "");
    setLoopEnabled(detailAgentLoopEnabled === 1);
    setLoopInterval(String(detailAgentLoopIntervalMinutes ?? 60));
    setLoopPrompt(detailAgentLoopPrompt ?? "");
    setPerms({ ...DEFAULT_PERMISSIONS, ...(detailAgentPermissions ?? {}) });
    setMentionPatterns(detailAgentMentionPatterns ?? []);
    setMentionPatternInput("");
    setSaving(false);
    setActiveTab("overview");
  }, [
    detailAgentId,
    detailAgentName,
    detailAgentRole,
    detailAgentPersona,
    detailAgentChannelId,
    detailAgentLoopEnabled,
    detailAgentLoopIntervalMinutes,
    detailAgentLoopPrompt,
    detailAgentPermissions,
    detailAgentMentionPatterns,
  ]);

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
                  {`"${agent.loopPrompt.slice(0, 100)}${agent.loopPrompt.length > 100 ? "..." : ""}"`}
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
              {(Object.keys(PERM_LABELS) as (keyof AgentPermissions)[]).map((key, idx, arr) => {
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
                Tell Jarvis to &quot;set up a researcher agent&quot; or &quot;create a coder in Discord&quot; - the orchestrator spawns them with their own persona, memory, and channel.
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
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  loadingText: { fontSize: 14 },

  chatInput: {
    flex: 1, borderRadius: 22, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, maxHeight: 120,
  },
  chatSendBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
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
