import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Colors from "@/constants/colors";
import { ROLE_COLORS, ROLE_ICONS, ROLES } from "@/lib/agents/roleMeta";

export function CreateAgentSheet({
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
            placeholder="Agent name..."
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
            placeholder="Describe this agent's personality and specialty..."
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={4}
          />
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
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: "top" },
  roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  roleChipText: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
});
