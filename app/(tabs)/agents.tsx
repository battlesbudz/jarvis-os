import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
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
import { JobTaskCard, type AgentTask } from "@/components/agents/JobTaskCard";
import { LivingAgentCard, type LivingAgentCardAgent } from "@/components/agents/LivingAgentCard";
import { RunModal } from "@/components/agents/RunModal";
import {
  SelfRepairAuditCard,
  SelfRepairAuditModal,
  type AuditEntry,
} from "@/components/agents/SelfRepairAudit";
import { AgentDetailSheet, type RosterAgent } from "@/components/agents/AgentDetailSheet";
import { TaskDetailSheet } from "@/components/agents/TaskDetailSheet";
import { buildRosterSections } from "@/lib/agents/rosterSections";

// ── Types ──────────────────────────────────────────────────────────────────────

interface IntegrationReadiness {
  status?: string;
  accountLinked?: boolean;
  serverConfigured?: boolean;
  capabilityRunnable?: boolean;
  blockedReason?: string | null;
  readiness?: string;
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

  const showAgentDetail = (agent: LivingAgentCardAgent) => setDetailAgent(agent as RosterAgent);
  const runRosterAgent = (agent: LivingAgentCardAgent) => setRunAgent(agent as RosterAgent);

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
  const {
    coreAgents,
    customAgents,
    runningJobs,
    recentJobs,
    onlineCount,
    activeCount,
    missingCoreNames,
  } = buildRosterSections(agents, activeTasks);

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
              onDetail={showAgentDetail}
              onRun={runRosterAgent}
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
                  onDetail={showAgentDetail}
                  onRun={runRosterAgent}
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
  emptyCustomCard: {
    borderRadius: 12, borderWidth: 1, borderStyle: "dashed",
    padding: 20, marginTop: 8, marginBottom: 4,
    alignItems: "center", gap: 8,
  },
  emptyCustomTitle: { fontSize: 15, fontWeight: "600" },
  emptyCustomSub: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingHint: { fontSize: 14 },
  loopToggleRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  loopToggleLabel: { flex: 1, fontSize: 15 },
  detailSectionHint: { fontSize: 12, lineHeight: 16, marginBottom: 10, marginTop: 6 },
});
