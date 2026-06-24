import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Switch,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  RefreshControl,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInDown } from "react-native-reanimated";
import Colors from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduledTask {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  recurrence: string | null;
  completedAt: string | null;
  createdAt: string;
  shellCommand: string | null;
  active: boolean;
}

type Frequency = "daily" | "weekly" | "monthly" | "weekdays" | "weekends" | "custom";

const FREQUENCY_OPTIONS: { value: Frequency; label: string; cron: string }[] = [
  { value: "daily",    label: "Daily",        cron: "daily" },
  { value: "weekly",   label: "Weekly",       cron: "weekly" },
  { value: "monthly",  label: "Monthly",      cron: "monthly" },
  { value: "weekdays", label: "Weekdays",     cron: "weekdays" },
  { value: "weekends", label: "Weekends",     cron: "weekends" },
  { value: "custom",   label: "Custom...",    cron: "" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatNextRun(task: ScheduledTask): string {
  const d = new Date(task.scheduledAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) {
    if (task.recurrence) return `Recurs: ${task.recurrence}`;
    return "Completed";
  }
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 60) return `in ${diffMins}m`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `in ${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatScheduleLabel(task: ScheduledTask): string {
  const d = new Date(task.scheduledAt);
  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (task.recurrence) {
    const rec = task.recurrence.charAt(0).toUpperCase() + task.recurrence.slice(1);
    return `${rec} · ${timeStr}`;
  }
  return `Once · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${timeStr}`;
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onToggle,
  onDelete,
  index,
}: {
  task: ScheduledTask;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string, title: string) => void;
  index: number;
}) {
  const isCompleted = !task.recurrence && !!task.completedAt;
  const isPaused = !task.active;

  return (
    <Animated.View entering={FadeInDown.delay(index * 40).duration(300)}>
      <View style={[styles.card, isPaused && styles.cardPaused, isCompleted && styles.cardCompleted]}>
        <View style={styles.cardLeft}>
          <View style={styles.cardIcon}>
            <Ionicons
              name={task.shellCommand ? "terminal-outline" : task.recurrence ? "repeat-outline" : "time-outline"}
              size={16}
              color={isPaused ? Colors.textTertiary : task.recurrence ? Colors.cyan : Colors.violet}
            />
          </View>
          <View style={styles.cardInfo}>
            <Text style={[styles.cardTitle, isPaused && styles.textMuted]} numberOfLines={1}>
              {task.title}
            </Text>
            {task.description ? (
              <Text style={styles.cardDesc} numberOfLines={1}>
                {task.description}
              </Text>
            ) : null}
            <View style={styles.cardMeta}>
              <Text style={styles.cardSchedule}>{formatScheduleLabel(task)}</Text>
              {!isCompleted && (
                <View style={[styles.badge, isPaused ? styles.badgePaused : styles.badgeActive]}>
                  <Text style={[styles.badgeText, isPaused ? styles.badgeTextPaused : styles.badgeTextActive]}>
                    {isPaused ? "Paused" : formatNextRun(task)}
                  </Text>
                </View>
              )}
              {isCompleted && (
                <View style={[styles.badge, styles.badgeCompleted]}>
                  <Text style={[styles.badgeText, styles.badgeTextCompleted]}>Done</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <View style={styles.cardActions}>
          {!isCompleted && (
            <Switch
              value={task.active}
              onValueChange={(v) => onToggle(task.id, v)}
              trackColor={{ false: Colors.border, true: Colors.cyanDim }}
              thumbColor={task.active ? Colors.cyan : Colors.textTertiary}
              ios_backgroundColor={Colors.border}
              style={styles.switch}
            />
          )}
          <Pressable
            style={styles.deleteBtn}
            onPress={() => onDelete(task.id, task.title)}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={16} color={Colors.textTertiary} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

// ── Create Task Sheet ─────────────────────────────────────────────────────────

function CreateTaskSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [customFreq, setCustomFreq] = useState("");
  const [time, setTime] = useState("09:00");
  const [isOnce, setIsOnce] = useState(false);
  const [loading, setLoading] = useState(false);

  function reset() {
    setTitle("");
    setDescription("");
    setFrequency("daily");
    setCustomFreq("");
    setTime("09:00");
    setIsOnce(false);
  }

  async function handleCreate() {
    if (!title.trim()) {
      Alert.alert("Title required", "Please enter a task title.");
      return;
    }
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      Alert.alert("Invalid time", "Enter time as HH:MM (e.g. 09:00).");
      return;
    }
    const [, h, m] = timeMatch;
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + 1);
    scheduledAt.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);

    let recurrence: string | null = null;
    if (!isOnce) {
      if (frequency === "custom") {
        recurrence = customFreq.trim() || "daily";
      } else {
        const opt = FREQUENCY_OPTIONS.find((o) => o.value === frequency);
        const timeLabel = `${h}:${m}`;
        recurrence = opt ? `${opt.cron} at ${timeLabel}` : "daily";
      }
    }

    setLoading(true);
    try {
      await apiRequest("POST", "/api/jarvis/scheduled-tasks", {
        title: title.trim(),
        description: description.trim() || undefined,
        scheduledAt: scheduledAt.toISOString(),
        recurrence,
      });
      reset();
      onCreated();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Failed to create task", msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetContainer}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Pressable onPress={() => { reset(); onClose(); }} style={styles.sheetCancel}>
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.sheetTitle}>New Scheduled Task</Text>
          <Pressable onPress={handleCreate} style={styles.sheetSave} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color={Colors.cyan} />
            ) : (
              <Text style={styles.sheetSaveText}>Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g. Morning inbox review"
            placeholderTextColor={Colors.textTertiary}
            value={title}
            onChangeText={setTitle}
            maxLength={100}
          />

          <Text style={styles.fieldLabel}>Description (optional)</Text>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            placeholder="What should Jarvis do when this runs?"
            placeholderTextColor={Colors.textTertiary}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={500}
          />

          <View style={styles.onceRow}>
            <Text style={styles.fieldLabel}>One-time task</Text>
            <Switch
              value={isOnce}
              onValueChange={setIsOnce}
              trackColor={{ false: Colors.border, true: Colors.cyanDim }}
              thumbColor={isOnce ? Colors.cyan : Colors.textTertiary}
              ios_backgroundColor={Colors.border}
            />
          </View>

          {!isOnce && (
            <>
              <Text style={styles.fieldLabel}>Frequency</Text>
              <View style={styles.freqGrid}>
                {FREQUENCY_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.freqChip, frequency === opt.value && styles.freqChipActive]}
                    onPress={() => setFrequency(opt.value)}
                  >
                    <Text style={[styles.freqChipText, frequency === opt.value && styles.freqChipTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {frequency === "custom" && (
                <>
                  <Text style={styles.fieldLabel}>Custom recurrence</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. every Monday at 9am"
                    placeholderTextColor={Colors.textTertiary}
                    value={customFreq}
                    onChangeText={setCustomFreq}
                  />
                </>
              )}
            </>
          )}

          <Text style={styles.fieldLabel}>Time (HH:MM)</Text>
          <TextInput
            style={styles.textInput}
            placeholder="09:00"
            placeholderTextColor={Colors.textTertiary}
            value={time}
            onChangeText={setTime}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ScheduledScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");

  const { data: tasks = [], isLoading, refetch } = useQuery<ScheduledTask[]>({
    queryKey: ["/api/jarvis/scheduled-tasks"],
    refetchInterval: 30000,
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiRequest("PATCH", `/api/jarvis/scheduled-tasks/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/jarvis/scheduled-tasks"] }),
    onError: (err) => Alert.alert("Error", err instanceof Error ? err.message : "Failed to update task"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/jarvis/scheduled-tasks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/jarvis/scheduled-tasks"] }),
    onError: (err) => Alert.alert("Error", err instanceof Error ? err.message : "Failed to delete task"),
  });

  function handleDelete(id: string, title: string) {
    Alert.alert("Delete task?", `"${title}" will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(id) },
    ]);
  }

  const filteredTasks = tasks.filter((t) => {
    if (filter === "active") return t.active;
    if (filter === "paused") return !t.active;
    return true;
  });

  const recurringTasks = filteredTasks.filter((t) => !!t.recurrence);
  const onceTasks = filteredTasks.filter((t) => !t.recurrence);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Scheduled</Text>
          <Text style={styles.headerSub}>
            {tasks.length === 0 ? "No tasks yet" : `${tasks.filter((t) => t.active).length} active`}
          </Text>
        </View>
        <Pressable style={styles.addBtn} onPress={() => setShowCreate(true)}>
          <Ionicons name="add" size={22} color={Colors.cyan} />
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {(["all", "active", "paused"] as const).map((f) => (
          <Pressable
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.cyan} />
        </View>
      ) : filteredTasks.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={48} color={Colors.textTertiary} style={{ marginBottom: 12 }} />
          <Text style={styles.emptyTitle}>No scheduled tasks</Text>
          <Text style={styles.emptyBody}>
            Tap + to create one, or ask Jarvis to{"\n"}&quot;remind me every morning at 9am to...&quot;
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: botPad + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => refetch()}
              tintColor={Colors.cyan}
            />
          }
        >
          {recurringTasks.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Recurring</Text>
              {recurringTasks.map((t, i) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  index={i}
                  onToggle={(id, active) => toggleMutation.mutate({ id, active })}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
          {onceTasks.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>One-time</Text>
              {onceTasks.map((t, i) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  index={recurringTasks.length + i}
                  onToggle={(id, active) => toggleMutation.mutate({ id, active })}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}

      <CreateTaskSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["/api/jarvis/scheduled-tasks"] })}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.cyanDim,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.borderGlow,
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.cyanDim,
    borderColor: Colors.borderGlow,
  },
  filterChipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: "500",
  },
  filterChipTextActive: {
    color: Colors.cyan,
  },
  list: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textTertiary,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 8,
  },
  cardPaused: {
    opacity: 0.65,
  },
  cardCompleted: {
    opacity: 0.5,
  },
  cardLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 2,
  },
  textMuted: {
    color: Colors.textSecondary,
  },
  cardDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  cardSchedule: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeActive: {
    backgroundColor: Colors.cyanDim,
  },
  badgePaused: {
    backgroundColor: Colors.warningDim,
  },
  badgeCompleted: {
    backgroundColor: Colors.successDim,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  badgeTextActive: {
    color: Colors.cyan,
  },
  badgeTextPaused: {
    color: Colors.warning,
  },
  badgeTextCompleted: {
    color: Colors.success,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 8,
  },
  switch: {
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  deleteBtn: {
    padding: 6,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 8,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  sheetContainer: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: Colors.text,
  },
  sheetCancel: {
    padding: 4,
  },
  sheetCancelText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  sheetSave: {
    padding: 4,
    minWidth: 48,
    alignItems: "center",
  },
  sheetSaveText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.cyan,
  },
  sheetBody: {
    flex: 1,
    padding: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 8,
    marginTop: 16,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
  },
  textArea: {
    height: 90,
    textAlignVertical: "top",
  },
  onceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  freqGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  freqChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  freqChipActive: {
    backgroundColor: Colors.cyanDim,
    borderColor: Colors.borderGlow,
  },
  freqChipText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: "500",
  },
  freqChipTextActive: {
    color: Colors.cyan,
    fontWeight: "600",
  },
});
