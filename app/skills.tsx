import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Switch,
  ActivityIndicator,
  Platform,
  TextInput,
  Modal,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';

interface UserSkill {
  id: string;
  name: string;
  emoji: string;
  description: string;
  instructions: string;
  isBuiltIn: boolean;
  isActive: boolean;
  createdAt: string;
}

const SKILL_ACCENTS: Record<string, string> = {
  'Morning Ritual': Colors.warning,
  'Finance Awareness': Colors.success,
  'Stoic Coach': '#8B7CF6',
  'Deadline Hawk': Colors.error,
  'Deep Work Mode': Colors.violet,
  'Weekly Review': Colors.cyan,
  'Gratitude Practice': '#F472B6',
  'Fitness Check-in': Colors.success,
  'Communication Filter': Colors.cyan,
  'Energy Management': Colors.warning,
};

function getAccent(skill: UserSkill): string {
  return SKILL_ACCENTS[skill.name] ?? Colors.violet;
}

function SkillCard({
  skill,
  onToggle,
  onDelete,
  toggling,
}: {
  skill: UserSkill;
  onToggle: (skill: UserSkill) => void;
  onDelete?: (skill: UserSkill) => void;
  toggling: boolean;
}) {
  const accent = getAccent(skill);

  return (
    <View style={[styles.card, skill.isActive && { borderColor: accent, borderWidth: 1 }]}>
      <View style={styles.cardRow}>
        <View style={[styles.emojiWrap, { backgroundColor: `${accent}1A` }]}>
          <Text style={styles.emoji}>{skill.emoji}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.skillName}>{skill.name}</Text>
          <Text style={styles.skillDesc} numberOfLines={2}>{skill.description}</Text>
        </View>
        <View style={styles.rightControls}>
          {!skill.isBuiltIn && onDelete && (
            <Pressable
              style={styles.deleteBtn}
              onPress={() => onDelete(skill)}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={14} color={Colors.textTertiary} />
            </Pressable>
          )}
          {toggling ? (
            <ActivityIndicator size="small" color={accent} />
          ) : (
            <Switch
              value={skill.isActive}
              onValueChange={() => onToggle(skill)}
              trackColor={{ false: Colors.border, true: `${accent}55` }}
              thumbColor={skill.isActive ? accent : Colors.textTertiary}
              ios_backgroundColor={Colors.border}
            />
          )}
        </View>
      </View>
      {skill.isActive && (
        <View style={[styles.activeBanner, { borderTopColor: `${accent}33` }]}>
          <Ionicons name="checkmark-circle" size={12} color={accent} />
          <Text style={[styles.activeBannerText, { color: accent }]}>
            Active — takes effect on next conversation
          </Text>
        </View>
      )}
    </View>
  );
}

const EMOJI_PRESETS = ['⚡', '🌟', '🧠', '🎨', '🚀', '🔥', '💡', '🌿', '🏆', '🎯', '🛡️', '🌊', '🎭', '🔮', '🦁'];

function CreateSkillModal({
  visible,
  onClose,
  onSave,
  saving,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (data: { name: string; emoji: string; description: string; instructions: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('⚡');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';

  React.useEffect(() => {
    if (visible) {
      setName('');
      setEmoji('⚡');
      setDescription('');
      setInstructions('');
    }
  }, [visible]);

  const canSave = name.trim().length > 0 && instructions.trim().length > 0;

  function handleSave() {
    if (!canSave || saving) return;
    onSave({ name: name.trim(), emoji, description: description.trim(), instructions: instructions.trim() });
  }

  function handleClose() {
    setName('');
    setEmoji('⚡');
    setDescription('');
    setInstructions('');
    onClose();
  }

  const paddingBottom = isWeb ? 34 : insets.bottom + 16;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalHeader, { paddingTop: isWeb ? 20 : insets.top + 8 }]}>
          <Pressable style={styles.backBtn} onPress={handleClose}>
            <Ionicons name="close" size={20} color={Colors.text} />
          </Pressable>
          <Text style={styles.modalTitle}>Create Skill</Text>
          <Pressable
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={[styles.modalContent, { paddingBottom }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Emoji picker */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>ICON</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.emojiRow}>
              {EMOJI_PRESETS.map((e) => (
                <Pressable
                  key={e}
                  style={[styles.emojiOption, emoji === e && styles.emojiOptionSelected]}
                  onPress={() => setEmoji(e)}
                >
                  <Text style={styles.emojiOptionText}>{e}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>SKILL NAME *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Meeting Prep, Nutrition Focus…"
              placeholderTextColor={Colors.textTertiary}
              maxLength={80}
            />
          </View>

          {/* Description */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>SHORT DESCRIPTION</Text>
            <TextInput
              style={styles.input}
              value={description}
              onChangeText={setDescription}
              placeholder="One sentence about what this skill does"
              placeholderTextColor={Colors.textTertiary}
              maxLength={200}
            />
          </View>

          {/* Instructions */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>INSTRUCTIONS FOR JARVIS *</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={instructions}
              onChangeText={setInstructions}
              placeholder="Write instructions in the second person: 'When the user asks about X, always Y…' Be specific and actionable."
              placeholderTextColor={Colors.textTertiary}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={3000}
            />
            <Text style={styles.charCount}>{instructions.length}/3000</Text>
          </View>

          {/* Live preview */}
          {(name.trim() || instructions.trim()) && (
            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>PROMPT PREVIEW</Text>
              <Text style={styles.previewText}>
                {'### '}
                {emoji} {name || 'Untitled Skill'}{'\n'}
                {instructions || '(instructions go here)'}
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function SkillsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const qc = useQueryClient();

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<{ skills: UserSkill[] }>({
    queryKey: ['/api/user-skills'],
  });

  const toggleMutation = useMutation({
    mutationFn: (skillId: string) => apiRequest('PATCH', `/api/user-skills/${skillId}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/user-skills'] }),
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; emoji: string; description: string; instructions: string }) =>
      apiRequest('POST', '/api/user-skills', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/user-skills'] });
      setCreateOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (skillId: string) => apiRequest('DELETE', `/api/user-skills/${skillId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/user-skills'] }),
  });

  const handleToggle = useCallback(async (skill: UserSkill) => {
    setTogglingId(skill.id);
    try {
      await toggleMutation.mutateAsync(skill.id);
    } finally {
      setTogglingId(null);
    }
  }, [toggleMutation]);

  const handleDelete = useCallback((skill: UserSkill) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete "${skill.name}"? This cannot be undone.`)) {
        deleteMutation.mutate(skill.id);
      }
    } else {
      Alert.alert(
        'Delete Skill',
        `Delete "${skill.name}"? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(skill.id) },
        ],
      );
    }
  }, [deleteMutation]);

  const handleCreate = useCallback(async (data: { name: string; emoji: string; description: string; instructions: string }) => {
    await createMutation.mutateAsync(data);
  }, [createMutation]);

  const skills = data?.skills ?? [];
  const builtInSkills = skills.filter((s) => s.isBuiltIn);
  const customSkills = skills.filter((s) => !s.isBuiltIn);
  const activeCount = skills.filter((s) => s.isActive).length;

  const paddingTop = isWeb ? 67 : insets.top;
  const paddingBottom = isWeb ? 34 : insets.bottom + 16;

  function renderSkillCard({ item }: { item: UserSkill }) {
    const isExpanded = expandedId === item.id;
    const accent = getAccent(item);
    return (
      <View>
        <SkillCard
          skill={item}
          onToggle={handleToggle}
          onDelete={!item.isBuiltIn ? handleDelete : undefined}
          toggling={togglingId === item.id}
        />
        {/* Expand to show instructions */}
        <Pressable
          style={styles.expandBtn}
          onPress={() => setExpandedId(isExpanded ? null : item.id)}
        >
          <Text style={styles.expandBtnText}>
            {isExpanded ? 'Hide instructions' : 'See instructions'}
          </Text>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={Colors.textTertiary}
          />
        </Pressable>
        {isExpanded && (
          <View style={[styles.instructionsBox, { borderLeftColor: accent }]}>
            <Text style={styles.instructionsText}>{item.instructions}</Text>
          </View>
        )}
      </View>
    );
  }

  const listData = [
    { type: 'section', label: `BUILT-IN LIBRARY (${builtInSkills.length})`, key: 'header-builtin' },
    ...builtInSkills.map((s) => ({ type: 'skill', skill: s, key: s.id })),
    { type: 'section', label: `MY SKILLS (${customSkills.length})`, key: 'header-custom', isCustom: true },
    ...customSkills.map((s) => ({ type: 'skill', skill: s, key: s.id })),
    { type: 'footer', key: 'footer' },
  ] as Array<{ type: string; key: string; label?: string; skill?: UserSkill; isCustom?: boolean }>;

  return (
    <View style={[styles.container, { paddingTop }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Skills</Text>
          <Text style={styles.headerSub}>
            {activeCount > 0 ? `${activeCount} active · ` : ''}Personalise how Jarvis thinks
          </Text>
        </View>
        <Pressable style={styles.createBtn} onPress={() => setCreateOpen(true)}>
          <Ionicons name="add" size={20} color={Colors.bg} />
        </Pressable>
      </View>

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.violet} />
        </View>
      )}

      {isError && !isLoading && (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color={Colors.error} />
          <Text style={styles.errorText}>Could not load skills</Text>
        </View>
      )}

      {!isLoading && !isError && (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.key}
          contentContainerStyle={[styles.list, { paddingBottom }]}
          renderItem={({ item }) => {
            if (item.type === 'section') {
              return (
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionLabel}>{item.label}</Text>
                  {item.isCustom && (
                    <Pressable style={styles.addCustomBtn} onPress={() => setCreateOpen(true)}>
                      <Ionicons name="add-circle-outline" size={14} color={Colors.violet} />
                      <Text style={styles.addCustomText}>Add</Text>
                    </Pressable>
                  )}
                </View>
              );
            }
            if (item.type === 'footer') {
              return (
                <View>
                  {customSkills.length === 0 && (
                    <Pressable style={styles.emptyCustomCard} onPress={() => setCreateOpen(true)}>
                      <Ionicons name="sparkles-outline" size={22} color={Colors.violet} />
                      <View style={styles.emptyCustomText}>
                        <Text style={styles.emptyCustomTitle}>Create your first skill</Text>
                        <Text style={styles.emptyCustomSub}>
                          Write a custom instruction set — Jarvis will follow it every session.
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                    </Pressable>
                  )}
                  <Text style={styles.footerNote}>
                    Active skills are injected into Jarvis's context at the start of every conversation.
                    Toggle any time — changes take effect on the next conversation.
                  </Text>
                </View>
              );
            }
            if (item.type === 'skill' && item.skill) {
              return renderSkillCard({ item: item.skill });
            }
            return null;
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      <CreateSkillModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleCreate}
        saving={createMutation.isPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  createBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center',
  },
  list: {
    padding: 16,
    gap: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
  },
  addCustomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addCustomText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.violet,
  },
  sep: {
    height: 8,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emojiWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  emoji: {
    fontSize: 20,
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  skillName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  skillDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  deleteBtn: {
    padding: 4,
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  activeBannerText: {
    fontSize: 11,
    fontWeight: '500',
  },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 14,
  },
  expandBtnText: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  instructionsBox: {
    marginHorizontal: 0,
    marginBottom: 4,
    padding: 12,
    backgroundColor: `${Colors.surface}CC`,
    borderRadius: 8,
    borderLeftWidth: 3,
  },
  instructionsText: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  emptyCustomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: `${Colors.violet}12`,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: `${Colors.violet}30`,
    marginBottom: 12,
  },
  emptyCustomText: {
    flex: 1,
    gap: 3,
  },
  emptyCustomTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  emptyCustomSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  footerNote: {
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 17,
    paddingHorizontal: 8,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  modalTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: Colors.violet,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 56,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalScroll: {
    flex: 1,
  },
  modalContent: {
    padding: 20,
    gap: 20,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
  },
  emojiRow: {
    flexGrow: 0,
  },
  emojiOption: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  emojiOptionSelected: {
    borderColor: Colors.violet,
    backgroundColor: `${Colors.violet}20`,
  },
  emojiOptionText: {
    fontSize: 22,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.text,
    fontSize: 14,
  },
  inputMultiline: {
    minHeight: 120,
    paddingTop: 12,
  },
  charCount: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'right',
  },
  previewBox: {
    backgroundColor: `${Colors.violet}0D`,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: `${Colors.violet}30`,
    gap: 6,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.violet,
    letterSpacing: 0.8,
  },
  previewText: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
