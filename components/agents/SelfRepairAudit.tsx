import { useEffect, useRef } from "react";
import {
  Animated,
  LayoutChangeEvent,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Colors from "@/constants/colors";

export interface AuditEntry {
  timestamp: string;
  file: string;
  reason: string;
  verified: string;
  changesSummary: string;
  diff: string;
}

export function SelfRepairAuditModal({
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

          <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginTop: 16 }]}>REASON</Text>
          <View style={[styles.personaCard, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
            <Text style={[styles.personaText, { color: Colors.text }]}>{entry.reason || "No reason recorded"}</Text>
          </View>

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

export function SelfRepairAuditCard({
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
  }, [flashAnim, highlighted]);

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
  personaCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 4 },
  personaText: { fontSize: 14, lineHeight: 20 },
  roleIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  cardName: { fontSize: 15, fontWeight: "600" },
  metaText: { fontSize: 11 },
  coreBadge: { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  coreBadgeText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
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
  jobMeta: { fontSize: 10, marginTop: 6 },
});
