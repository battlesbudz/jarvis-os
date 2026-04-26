import React, { useState, useCallback } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Agent {
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
  heartbeatFailCount: number;
  stuckSince?: string;
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
                  <Ionicons
                    name={ROLE_ICONS[r] ?? "person-outline"}
                    size={14}
                    color={isSelected ? roleColor : Colors.textSecondary}
                  />
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

// ── AgentCard ──────────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  onRun,
  onToggle,
  onDelete,
}: {
  agent: Agent;
  onRun: (agent: Agent) => void;
  onToggle: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
}) {
  const roleColor = ROLE_COLORS[agent.role] || Colors.primary;
  const isActive = agent.isActive === 1;
  const isStuck = agent.heartbeatFailCount > 0;

  return (
    <View style={[styles.card, { backgroundColor: Colors.surface, borderColor: Colors.border, opacity: isActive ? 1 : 0.6 }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.roleIcon, { backgroundColor: roleColor + "22" }]}>
          <Ionicons name={ROLE_ICONS[agent.role] ?? "person-outline"} size={20} color={roleColor} />
        </View>
        <View style={styles.cardInfo}>
          <Text style={[styles.cardName, { color: Colors.text }]} numberOfLines={1}>{agent.name}</Text>
          <Text style={[styles.cardRole, { color: roleColor }]}>{agent.role}</Text>
        </View>
        <View style={styles.cardActions}>
          {isStuck && (
            <View style={[styles.stuckBadge, { backgroundColor: Colors.errorDim }]}>
              <Ionicons name="warning-outline" size={12} color={Colors.error} />
            </View>
          )}
          <TouchableOpacity style={[styles.iconBtn, { backgroundColor: Colors.background }]} onPress={() => onRun(agent)}>
            <Ionicons name="play-outline" size={16} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, { backgroundColor: Colors.background }]} onPress={() => onToggle(agent)}>
            <Ionicons
              name={isActive ? "pause-outline" : "checkmark-circle-outline"}
              size={16}
              color={isActive ? Colors.textSecondary : Colors.success}
            />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, { backgroundColor: Colors.background }]} onPress={() => onDelete(agent)}>
            <Ionicons name="trash-outline" size={16} color={Colors.error} />
          </TouchableOpacity>
        </View>
      </View>

      {agent.persona ? (
        <Text style={[styles.cardPersona, { color: Colors.textSecondary }]} numberOfLines={2}>{agent.persona}</Text>
      ) : null}

      <View style={styles.cardMeta}>
        {agent.channelName ? (
          <View style={styles.metaChip}>
            <Ionicons name="logo-discord" size={11} color={Colors.textTertiary} />
            <Text style={[styles.metaText, { color: Colors.textTertiary }]}>{agent.channelName}</Text>
          </View>
        ) : null}
        {agent.loopEnabled === 1 ? (
          <View style={styles.metaChip}>
            <Ionicons name="refresh-outline" size={11} color={Colors.textTertiary} />
            <Text style={[styles.metaText, { color: Colors.textTertiary }]}>{agent.loopIntervalMinutes}m loop</Text>
          </View>
        ) : null}
        {agent.accessGlobalMemory ? (
          <View style={styles.metaChip}>
            <Ionicons name="globe-outline" size={11} color={Colors.textTertiary} />
            <Text style={[styles.metaText, { color: Colors.textTertiary }]}>global mem</Text>
          </View>
        ) : null}
        {(agent.platforms ?? []).map((p: string) => (
          <View key={p} style={styles.metaChip}>
            <Text style={[styles.metaText, { color: Colors.textTertiary }]}>{p}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── RunModal ───────────────────────────────────────────────────────────────────

function RunModal({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [running, setRunning] = useState(false);

  async function handleRun() {
    if (!agent || !message.trim()) return;
    setRunning(true);
    setReply("");
    try {
      const data = await apiRequest<{ reply: string }>("POST", `/api/agents/${agent.id}/run`, { message, platform: "mobile" });
      setReply(data.reply);
    } catch (err) {
      setReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  function handleClose() {
    setMessage("");
    setReply("");
    setRunning(false);
    onClose();
  }

  return (
    <Modal visible={!!agent} animationType="slide" presentationStyle="formSheet" onRequestClose={handleClose}>
      <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity onPress={handleClose}>
            <Text style={[styles.sheetCancel, { color: Colors.textSecondary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.sheetTitle, { color: Colors.text }]}>{agent?.name ?? ""}</Text>
          <TouchableOpacity onPress={handleRun} disabled={!message.trim() || running}>
            <Text style={[styles.sheetDone, { color: message.trim() && !running ? Colors.primary : Colors.textTertiary }]}>
              {running ? "Running…" : "Run"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <TextInput
            style={[styles.input, styles.inputMultiline, { backgroundColor: Colors.surface, color: Colors.text, borderColor: Colors.border }]}
            value={message}
            onChangeText={setMessage}
            placeholder="Send a message to this agent…"
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={3}
          />
          {running && <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 12 }} />}
          {reply ? (
            <View style={[styles.replyBox, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
              <Text style={[styles.replyLabel, { color: Colors.textSecondary }]}>Reply</Text>
              <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
                <Text style={[styles.replyText, { color: Colors.text }]}>{reply}</Text>
              </ScrollView>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
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
      const data = await apiRequest<{ synthesis: string; succeededCount: number; agentCount: number }>(
        "POST", "/api/agents/council", { question },
      );
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

// ── Main screen ────────────────────────────────────────────────────────────────

export default function AgentsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [runAgent, setRunAgent] = useState<Agent | null>(null);
  const [showCouncil, setShowCouncil] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { data, isLoading, refetch, isRefetching } = useQuery<{ agents: Agent[] }>({
    queryKey: ["/api/agents"],
  });

  const agents = data?.agents ?? [];
  const activeAgents = agents.filter((a) => a.isActive === 1);
  const disabledAgents = agents.filter((a) => a.isActive !== 1);

  const createMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/agents", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      setShowCreate(false);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      apiRequest("POST", `/api/agents/${id}/${enable ? "enable" : "disable"}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/agents"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/agents/${id}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/agents"] }),
  });

  function handleDelete(agent: Agent) {
    Alert.alert(
      `Delete ${agent.name}?`,
      "This will permanently remove the agent and all its memories.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(agent.id) },
      ],
    );
  }

  const renderEmpty = useCallback(() => (
    <View style={styles.emptyState}>
      <Ionicons name="people-outline" size={48} color={Colors.textTertiary} />
      <Text style={[styles.emptyTitle, { color: Colors.text }]}>No agents yet</Text>
      <Text style={[styles.emptySubtitle, { color: Colors.textSecondary }]}>
        Create named sub-agents for specific tasks — research, coding, scheduling, and more.
      </Text>
    </View>
  ), []);

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: Colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Agents</Text>
          <Text style={[styles.headerSub, { color: Colors.textSecondary }]}>
            {activeAgents.length} active{disabledAgents.length > 0 ? `, ${disabledAgents.length} disabled` : ""}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {activeAgents.length >= 2 && (
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
        </View>
      ) : agents.length === 0 ? (
        renderEmpty()
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 100 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {activeAgents.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>ACTIVE</Text>
              {activeAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onRun={setRunAgent}
                  onToggle={(a) => toggleMutation.mutate({ id: a.id, enable: a.isActive !== 1 })}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
          {disabledAgents.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>DISABLED</Text>
              {disabledAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onRun={setRunAgent}
                  onToggle={(a) => toggleMutation.mutate({ id: a.id, enable: a.isActive !== 1 })}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
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
  headerSub: { fontSize: 13, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 2 },
  councilBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  list: { flex: 1 },
  sectionLabel: {
    fontSize: 11, fontWeight: "600", letterSpacing: 0.8,
    marginTop: 8, marginBottom: 8, paddingHorizontal: 4,
  },
  card: {
    borderRadius: 14, borderWidth: 1,
    padding: 14, marginBottom: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  roleIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "600" },
  cardRole: { fontSize: 12, fontWeight: "500", textTransform: "capitalize", marginTop: 1 },
  cardActions: { flexDirection: "row", gap: 6, alignItems: "center" },
  iconBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  stuckBadge: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardPersona: { fontSize: 13, lineHeight: 18, marginTop: 8, marginLeft: 48 },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10, marginLeft: 48 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyTitle: { fontSize: 20, fontWeight: "600", marginTop: 16, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },

  // Sheet
  sheet: { flex: 1, paddingTop: 16 },
  sheetHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetCancel: { fontSize: 16 },
  sheetDone: { fontSize: 16, fontWeight: "600" },
  sheetBody: { flex: 1, padding: 20 },

  // Form
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

  // Reply / council
  replyBox: { borderRadius: 10, borderWidth: 1, padding: 14, marginTop: 16 },
  replyLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.8, marginBottom: 8 },
  replyText: { fontSize: 14, lineHeight: 20 },
  councilDesc: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  loadingText: { fontSize: 14 },
});
