import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Colors from "@/constants/colors";
import {
  JOB_STATUS_COLORS,
  JOB_STATUS_LABELS,
  type AgentTask,
} from "@/components/agents/JobTaskCard";

export function TaskDetailSheet({
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
                    - Iteration {task.iterationCount + 1}
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
              <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>Agent is working...</Text>
            </View>
          ) : task.status === "queued" ? (
            <View style={styles.taskRunning}>
              <Ionicons name="time-outline" size={32} color={Colors.textTertiary} />
              <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>Waiting in queue...</Text>
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

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 16 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: "600", flex: 1, textAlign: "center", marginHorizontal: 8 },
  sheetCancel: { fontSize: 16, minWidth: 48 },
  sheetBody: { flex: 1, padding: 20 },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8 },
  loadingText: { fontSize: 14, textAlign: "center" },
  jobIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  jobStatusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  jobStatusText: { fontSize: 11, fontWeight: "600" },
  taskHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
  },
  taskHeroTitle: { fontSize: 15, fontWeight: "600", flex: 1 },
  taskHeroMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  taskHeroAgent: { fontSize: 12, fontWeight: "600" },
  taskHeroIter: { fontSize: 12 },
  outputBox: { borderRadius: 10, borderWidth: 1, padding: 14 },
  outputText: { fontSize: 13, lineHeight: 19 },
  taskRunning: { alignItems: "center", gap: 12, marginTop: 40 },
  reviewHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginTop: 16,
  },
  reviewHintText: { fontSize: 13, lineHeight: 18, flex: 1 },
});
