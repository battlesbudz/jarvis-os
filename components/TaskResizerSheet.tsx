import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import { type Task, type CompletionHistoryItem, getCompletionHistory } from '@/lib/storage';

interface TaskResizerSheetProps {
  visible: boolean;
  task: Task | null;
  onClose: () => void;
  onApply: (taskId: string, steps: string[]) => void;
}

const DETAIL_LABELS = ['Broad', 'Clear', 'Specific', 'Detailed', 'Micro'];
const DETAIL_DESCRIPTIONS = [
  '2-3 high-level steps',
  '3-4 clear steps',
  '4-6 specific steps',
  '6-8 detailed steps',
  '8-12 tiny micro-steps',
];

export default function TaskResizerSheet({ visible, task, onClose, onApply }: TaskResizerSheetProps) {
  const insets = useSafeAreaInsets();
  const [detailLevel, setDetailLevel] = useState(3);
  const [direction, setDirection] = useState<'smaller' | 'bigger'>('smaller');
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && task) {
      setSteps([]);
      setError(null);
      setLoading(false);
      setDetailLevel(3);
      setDirection('smaller');
    }
  }, [visible, task?.id]);

  const handleGenerate = useCallback(async () => {
    if (!task) return;
    setLoading(true);
    setError(null);
    setSteps([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const history = await getCompletionHistory();
      const res = await apiRequest('POST', '/api/ai/resize-task', {
        taskTitle: task.title,
        taskDescription: task.description,
        detailLevel,
        direction,
        history,
      });
      const data = await res.json();
      if (data.steps && data.steps.length > 0) {
        setSteps(data.steps);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setError('No steps were generated. Try again.');
      }
    } catch (e) {
      console.error('Resize error:', e);
      setError('Could not reach the AI service. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [task, detailLevel, direction]);

  const handleApply = () => {
    if (!task || steps.length === 0) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onApply(task.id, steps);
    setSteps([]);
    setDetailLevel(3);
    onClose();
  };

  const handleClose = () => {
    setSteps([]);
    setError(null);
    setDetailLevel(3);
    setDirection('smaller');
    onClose();
  };

  if (!task) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.headerTitle}>Resize Task</Text>
            <Pressable onPress={handleClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.taskPreview}>
              <View style={[styles.taskDot, { backgroundColor: Colors.primary }]} />
              <Text style={styles.taskPreviewText} numberOfLines={2}>{task.title}</Text>
            </View>

            <View style={styles.directionRow}>
              <Pressable
                onPress={() => { setDirection('smaller'); Haptics.selectionAsync(); setSteps([]); }}
                style={[styles.directionButton, direction === 'smaller' && styles.directionActive]}
              >
                <Ionicons name="git-branch-outline" size={18} color={direction === 'smaller' ? Colors.white : Colors.textSecondary} />
                <Text style={[styles.directionText, direction === 'smaller' && styles.directionTextActive]}>
                  Make Smaller
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setDirection('bigger'); Haptics.selectionAsync(); setSteps([]); }}
                style={[styles.directionButton, direction === 'bigger' && styles.directionActive]}
              >
                <Ionicons name="git-merge-outline" size={18} color={direction === 'bigger' ? Colors.white : Colors.textSecondary} />
                <Text style={[styles.directionText, direction === 'bigger' && styles.directionTextActive]}>
                  Simplify
                </Text>
              </Pressable>
            </View>

            {direction === 'smaller' && (
              <View style={styles.sliderSection}>
                <View style={styles.sliderHeader}>
                  <Text style={styles.sliderLabel}>Detail Level</Text>
                  <Text style={styles.sliderValue}>{DETAIL_LABELS[detailLevel - 1]}</Text>
                </View>
                <Text style={styles.sliderDescription}>{DETAIL_DESCRIPTIONS[detailLevel - 1]}</Text>
                <View style={styles.sliderTrack}>
                  {[1, 2, 3, 4, 5].map((level) => (
                    <Pressable
                      key={level}
                      onPress={() => { setDetailLevel(level); Haptics.selectionAsync(); setSteps([]); }}
                      style={styles.sliderDotContainer}
                    >
                      <View style={[
                        styles.sliderDot,
                        level <= detailLevel && styles.sliderDotActive,
                        level === detailLevel && styles.sliderDotCurrent,
                      ]} />
                    </Pressable>
                  ))}
                  <View style={styles.sliderLine} />
                  <View style={[styles.sliderLineFill, { width: `${((detailLevel - 1) / 4) * 100}%` }]} />
                </View>
              </View>
            )}

            {loading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.loadingText}>Thinking...</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={20} color={Colors.error} />
                <Text style={styles.errorText}>{error}</Text>
                <Pressable onPress={handleGenerate} style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>Try again</Text>
                </Pressable>
              </View>
            )}

            {steps.length > 0 && (
              <View style={styles.stepsContainer}>
                <Text style={styles.stepsHeader}>
                  {direction === 'smaller' ? 'Broken down into:' : 'Simplified to:'}
                </Text>
                {steps.map((step, index) => (
                  <Animated.View
                    key={index}
                    entering={FadeInDown.duration(300).delay(index * 60)}
                    style={styles.stepRow}
                  >
                    <View style={styles.stepBullet}>
                      <Text style={styles.stepNumber}>{index + 1}</Text>
                    </View>
                    <Text style={styles.stepText}>{step}</Text>
                  </Animated.View>
                ))}
              </View>
            )}
          </ScrollView>

          {!loading && steps.length === 0 && !error && (
            <Pressable
              onPress={handleGenerate}
              style={({ pressed }) => [styles.generateButton, pressed && { opacity: 0.9 }]}
            >
              <Ionicons name="sparkles" size={18} color={Colors.white} />
              <Text style={styles.generateButtonText}>
                {direction === 'smaller' ? 'Break it down' : 'Simplify it'}
              </Text>
            </Pressable>
          )}

          {steps.length > 0 && (
            <View style={styles.actionRow}>
              <Pressable
                onPress={handleGenerate}
                style={({ pressed }) => [styles.regenerateButton, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="refresh-outline" size={16} color={Colors.primary} />
                <Text style={styles.regenerateText}>Regenerate</Text>
              </Pressable>
              <Pressable
                onPress={handleApply}
                style={({ pressed }) => [styles.applyButton, pressed && { opacity: 0.9 }]}
              >
                <Ionicons name="checkmark" size={18} color={Colors.white} />
                <Text style={styles.applyButtonText}>Apply to task</Text>
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
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    maxHeight: '88%',
  },
  scrollArea: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  taskPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  taskDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  taskPreviewText: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  directionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  directionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.textSecondary,
    backgroundColor: Colors.white,
  },
  directionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  directionText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  directionTextActive: {
    color: Colors.white,
  },
  sliderSection: {
    marginBottom: 20,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sliderLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
  sliderValue: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
  },
  sliderDescription: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginBottom: 14,
  },
  sliderTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 32,
    position: 'relative',
    paddingHorizontal: 4,
  },
  sliderLine: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 3,
    backgroundColor: Colors.borderLight,
    borderRadius: 2,
  },
  sliderLineFill: {
    position: 'absolute',
    left: 16,
    height: 3,
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  sliderDotContainer: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  sliderDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.borderLight,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  sliderDotActive: {
    backgroundColor: Colors.primaryLight,
  },
  sliderDotCurrent: {
    backgroundColor: Colors.primary,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 12,
  },
  generateButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  errorContainer: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  errorText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.error,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    marginTop: 4,
  },
  retryButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  stepsContainer: {
    marginBottom: 12,
  },
  stepsHeader: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  stepBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 20,
    paddingTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 14,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  regenerateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
  },
  regenerateText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  applyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  applyButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
});
