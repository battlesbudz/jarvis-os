import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Colors from "@/constants/colors";

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

export const JOB_STATUS_COLORS: Record<string, string> = {
  queued: "#f59e0b",
  running: "#22c55e",
  complete: Colors.primary,
  delivered: "#6b7280",
  failed: "#ef4444",
  cancelled: "#6b7280",
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  complete: "Needs Review",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function JobTaskCard({ job, onPress }: { job: AgentTask; onPress: () => void }) {
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
            {job.iterationCount > 0 ? ` - iter ${job.iterationCount + 1}` : ""}
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
        {job.completedAt ? ` - done ${new Date(job.completedAt).toLocaleTimeString()}` : ""}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  jobCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    padding: 12,
  },
  jobCardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  jobIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  jobCardTitle: { flex: 1 },
  jobTitle: { fontSize: 14, fontWeight: "600" },
  jobAgent: { fontSize: 11, marginTop: 1 },
  jobStatusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  jobStatusText: { fontSize: 11, fontWeight: "600" },
  jobOutput: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  jobMeta: { fontSize: 10, marginTop: 6 },
});
