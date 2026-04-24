import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Alert,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';

interface InboxRule {
  id: string;
  type: string;
  scope: string;
  pattern: string;
  matchHints: Record<string, unknown> | null;
  source: string;
  matchCount: number | null;
  active: boolean | null;
  createdAt: string;
}

export default function InboxRulesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [newPattern, setNewPattern] = useState('');
  const [newType, setNewType] = useState<'surface' | 'suppress'>('suppress');
  const [newScope, setNewScope] = useState<'email' | 'calendar' | 'both'>('both');

  const { data: rules = [], isLoading } = useQuery<InboxRule[]>({
    queryKey: ['/api/inbox/rules'],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/inbox/rules', {
        pattern: newPattern,
        type: newType,
        scope: newScope,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/inbox/rules'] });
      setShowAddModal(false);
      setNewPattern('');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to create rule.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/inbox/rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/inbox/rules'] });
    },
  });

  const handleDelete = (rule: InboxRule) => {
    Alert.alert(
      'Delete rule?',
      `"${rule.pattern}" will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(rule.id) },
      ]
    );
  };

  const renderRule = ({ item }: { item: InboxRule }) => {
    const isSurface = item.type === 'surface';
    const isLearned = item.source === 'learned';
    const matchCount = item.matchCount ?? 0;

    return (
      <View style={styles.ruleCard}>
        <View style={styles.ruleHeader}>
          <View style={styles.ruleBadges}>
            <View style={[styles.typeBadge, isSurface ? styles.surfaceBadge : styles.suppressBadge]}>
              <Text style={[styles.typeBadgeText, isSurface ? styles.surfaceBadgeText : styles.suppressBadgeText]}>
                {isSurface ? 'Surface' : 'Suppress'}
              </Text>
            </View>
            {isLearned && (
              <View style={styles.learnedBadge}>
                <Ionicons name="bulb" size={11} color={Colors.warning} />
                <Text style={styles.learnedBadgeText}>Learned</Text>
              </View>
            )}
            <View style={styles.scopeBadge}>
              <Text style={styles.scopeBadgeText}>
                {item.scope === 'both' ? 'All' : item.scope}
              </Text>
            </View>
          </View>
          <Pressable onPress={() => handleDelete(item)} hitSlop={12}>
            <Ionicons name="trash-outline" size={18} color={Colors.textTertiary} />
          </Pressable>
        </View>
        <Text style={styles.rulePattern}>{item.pattern}</Text>
        {matchCount > 0 && (
          <Text style={styles.matchCount}>Matched {matchCount} time{matchCount !== 1 ? 's' : ''}</Text>
        )}
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="funnel-outline" size={40} color={Colors.textTertiary} />
        <Text style={styles.emptyTitle}>No rules yet</Text>
        <Text style={styles.emptySubtitle}>
          Add rules to tell Jarvis what to surface or suppress from your email and calendar
        </Text>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Inbox Rules',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ paddingRight: 8 }}>
              <Ionicons name="arrow-back" size={24} color={Colors.primary} />
            </Pressable>
          ),
        }}
      />
      <View style={[styles.container, { paddingBottom: isWeb ? 34 : insets.bottom + 20 }]}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <FlatList
            data={rules}
            renderItem={renderRule}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={renderEmpty}
            showsVerticalScrollIndicator={false}
          />
        )}

        <Pressable style={styles.addButton} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={24} color="#fff" />
          <Text style={styles.addButtonText}>Add Rule</Text>
        </Pressable>

        <Modal visible={showAddModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { paddingBottom: isWeb ? 34 : insets.bottom + 20 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>New Rule</Text>
                <Pressable onPress={() => setShowAddModal(false)} hitSlop={12}>
                  <Ionicons name="close" size={24} color={Colors.text} />
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>What should Jarvis do?</Text>
              <View style={styles.toggleRow}>
                <Pressable
                  style={[styles.toggleOption, newType === 'suppress' && styles.toggleActive]}
                  onPress={() => setNewType('suppress')}
                >
                  <Ionicons name="eye-off" size={16} color={newType === 'suppress' ? '#fff' : Colors.textSecondary} />
                  <Text style={[styles.toggleText, newType === 'suppress' && styles.toggleTextActive]}>
                    Suppress
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleOption, newType === 'surface' && styles.toggleActiveSurface]}
                  onPress={() => setNewType('surface')}
                >
                  <Ionicons name="eye" size={16} color={newType === 'surface' ? '#fff' : Colors.textSecondary} />
                  <Text style={[styles.toggleText, newType === 'surface' && styles.toggleTextActive]}>
                    Surface
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>Applies to</Text>
              <View style={styles.toggleRow}>
                {(['both', 'email', 'calendar'] as const).map((s) => (
                  <Pressable
                    key={s}
                    style={[styles.toggleOption, newScope === s && styles.toggleActive]}
                    onPress={() => setNewScope(s)}
                  >
                    <Text style={[styles.toggleText, newScope === s && styles.toggleTextActive]}>
                      {s === 'both' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Describe in plain English</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g., suppress Replit notifications"
                placeholderTextColor={Colors.textTertiary}
                value={newPattern}
                onChangeText={setNewPattern}
                multiline
              />

              <Pressable
                style={[styles.saveButton, (!newPattern.trim() || createMutation.isPending) && styles.saveButtonDisabled]}
                onPress={() => createMutation.mutate()}
                disabled={!newPattern.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveButtonText}>Create Rule</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    padding: 16,
    paddingBottom: 100,
  },
  ruleCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ruleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ruleBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  typeBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  surfaceBadge: {
    backgroundColor: Colors.success + '18',
  },
  suppressBadge: {
    backgroundColor: Colors.error + '18',
  },
  typeBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  surfaceBadgeText: {
    color: Colors.success,
  },
  suppressBadgeText: {
    color: Colors.error,
  },
  learnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.warning + '18',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  learnedBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.warning,
  },
  scopeBadge: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  scopeBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  rulePattern: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  matchCount: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginTop: 12,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 18,
  },
  addButton: {
    position: 'absolute' as const,
    bottom: 30,
    right: 20,
    left: 20,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    marginBottom: 8,
    marginTop: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toggleActive: {
    backgroundColor: Colors.primary,
  },
  toggleActiveSurface: {
    backgroundColor: Colors.success,
  },
  toggleText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  toggleTextActive: {
    color: '#fff',
  },
  textInput: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    minHeight: 60,
    textAlignVertical: 'top' as const,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});
