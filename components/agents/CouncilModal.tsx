import { useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import Colors from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";

export function CouncilModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
              {running ? "Asking..." : "Ask"}
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
            placeholder="Ask your council a question..."
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={3}
            autoFocus
          />
          {running && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>Consulting agents...</Text>
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
  sheetDone: { fontSize: 16, fontWeight: "600", minWidth: 48, textAlign: "right" },
  sheetBody: { flex: 1, padding: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: "top" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  loadingText: { fontSize: 14, textAlign: "center" },
  replyBox: { borderRadius: 10, borderWidth: 1, padding: 14, marginTop: 16 },
  replyLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.8, marginBottom: 8 },
  replyText: { fontSize: 14, lineHeight: 20 },
  councilDesc: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
});
