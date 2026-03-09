import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { Task } from '@/lib/storage';
import { getApiUrl } from '@/lib/query-client';

type BlockerType = 'too_big' | 'bad_timing' | 'need_info' | 'low_energy' | 'unknown';

interface BlockerOption {
  type: BlockerType;
  label: string;
  icon: string;
}

const OPTIONS: BlockerOption[] = [
  { type: 'too_big', label: "It feels too big to start", icon: 'resize-outline' },
  { type: 'bad_timing', label: "Not the right time or moment", icon: 'time-outline' },
  { type: 'need_info', label: "I need more information first", icon: 'help-circle-outline' },
  { type: 'low_energy', label: "I'm too drained or tired", icon: 'battery-dead-outline' },
  { type: 'unknown', label: "I'm not sure why", icon: 'chatbubble-ellipses-outline' },
];

interface BlockerModalProps {
  visible: boolean;
  task: Task | null;
  onClose: () => void;
  onSolved: (task: Task, blockerType: string, suggestion: string) => void;
}

export default function BlockerModal({ visible, task, onClose, onSolved }: BlockerModalProps) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<BlockerType | null>(null);

  const reset = () => {
    setSuggestion(null);
    setSelectedType(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleOption = async (option: BlockerOption) => {
    if (!task) return;
    setSelectedType(option.type);
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const url = new URL('/api/ai/unblock-task', getApiUrl()).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskTitle: task.title,
          taskDescription: task.description,
          blockerType: option.type,
          skipDays: task.skipDays ?? 1,
        }),
      });
      const data = await res.json();
      setSuggestion(data.suggestion || "Start with just 2 minutes on this task and see what happens.");
    } catch {
      setSuggestion("Start with just 2 minutes on this task and see what happens.");
    } finally {
      setLoading(false);
    }
  };

  const handleGotIt = () => {
    if (!task || !selectedType || !suggestion) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSolved(task, selectedType, suggestion);
    reset();
  };

  if (!task) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.dismissArea} onPress={handleClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
              <Text style={styles.subtitle}>
                Carried over {task.skipDays ?? 1} day{(task.skipDays ?? 1) > 1 ? 's' : ''} — what's getting in the way?
              </Text>
            </View>
            <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </Pressable>
          </View>

          {!suggestion && !loading && (
            <ScrollView style={styles.options} showsVerticalScrollIndicator={false}>
              {OPTIONS.map(opt => (
                <Pressable
                  key={opt.type}
                  style={({ pressed }) => [styles.optionBtn, pressed && styles.optionBtnPressed]}
                  onPress={() => handleOption(opt)}
                >
                  <Ionicons name={opt.icon as any} size={20} color={Colors.primary} />
                  <Text style={styles.optionText}>{opt.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                </Pressable>
              ))}
            </ScrollView>
          )}

          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>Getting your unblock plan...</Text>
            </View>
          )}

          {suggestion && !loading && (
            <View style={styles.suggestionContainer}>
              <View style={styles.suggestionCard}>
                <View style={styles.suggestionHeader}>
                  <Ionicons name="flash" size={16} color={Colors.primary} />
                  <Text style={styles.suggestionLabel}>Your plan</Text>
                </View>
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.gotItBtn, pressed && { opacity: 0.8 }]}
                onPress={handleGotIt}
              >
                <Text style={styles.gotItText}>Got it, let's do this</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '75%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  closeBtn: {
    padding: 2,
    marginTop: 2,
  },
  options: {
    flexGrow: 0,
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    marginBottom: 8,
  },
  optionBtnPressed: {
    opacity: 0.7,
    backgroundColor: Colors.primary + '10',
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  suggestionContainer: {
    gap: 16,
  },
  suggestionCard: {
    backgroundColor: Colors.primary + '0D',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  suggestionLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  suggestionText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 22,
  },
  gotItBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  gotItText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
