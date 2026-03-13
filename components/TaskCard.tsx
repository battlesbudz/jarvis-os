import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, withSpring, useSharedValue, FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { Task, calculateTaskXp, xpForSubtask } from '@/lib/storage';
import { getCategoryColor, getCategoryLabel } from '@/lib/helpers';

interface TaskCardProps {
  task: Task;
  onToggle: (id: string, completed: boolean) => void;
  onResize?: (task: Task) => void;
  onEdit?: (task: Task) => void;
  onBlockerTap?: (task: Task) => void;
  onStartFocus?: (task: Task) => void;
  isDragging?: boolean;
}

function SubtaskRow({ subtask, onToggle, xpValue }: { subtask: Task; onToggle: (id: string, completed: boolean) => void; xpValue?: number }) {
  const scale = useSharedValue(1);
  const categoryColor = getCategoryColor(subtask.category);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSpring(0.96, { damping: 15 }, () => {
      scale.value = withSpring(1);
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggle(subtask.id, !subtask.completed);
  };

  const subtaskXp = xpValue ?? calculateTaskXp(subtask);

  return (
    <Animated.View style={animatedStyle}>
      <View style={styles.subtaskRow} testID={`subtask-${subtask.id}`}>
        <Pressable
          onPress={handlePress}
          hitSlop={8}
          style={[styles.subtaskCheck, subtask.completed && { backgroundColor: categoryColor, borderColor: categoryColor }]}
        >
          {subtask.completed && <Ionicons name="checkmark" size={10} color={Colors.white} />}
        </Pressable>
        <Text style={[styles.subtaskText, subtask.completed && styles.subtaskTextDone]}>
          {subtask.title}
        </Text>
        {!subtask.completed && (
          <View style={styles.xpBadge}>
            <Text style={styles.xpBadgeText}>+{subtaskXp} XP</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

export default function TaskCard({ task, onToggle, onResize, onEdit, onBlockerTap, onStartFocus, isDragging }: TaskCardProps) {
  const router = useRouter();
  const scale = useSharedValue(1);
  const categoryColor = getCategoryColor(task.category);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handleCheck = () => {
    if (task.subtasks && task.subtasks.length > 0) return;
    scale.value = withSpring(0.95, { damping: 15 }, () => {
      scale.value = withSpring(1);
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggle(task.id, !task.completed);
  };

  const handleResize = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onResize?.(task);
  };

  const handleEdit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onEdit?.(task);
  };

  const handleStartTimer = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/focus-timer' as any,
      params: { taskTitle: task.title }
    });
  };

  const handleBlockerTap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onBlockerTap?.(task);
  };

  const priorityDot = task.priority === 'high' ? Colors.error : task.priority === 'medium' ? Colors.warning : Colors.textTertiary;

  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const subtasksDone = hasSubtasks ? task.subtasks!.filter(s => s.completed).length : 0;
  const subtasksTotal = hasSubtasks ? task.subtasks!.length : 0;
  const taskXp = calculateTaskXp(task);
  const perSubtaskXp = hasSubtasks ? xpForSubtask(taskXp, subtasksTotal) : undefined;

  return (
    <Animated.View style={animatedStyle}>
      <View
        style={[
          styles.container,
          task.completed && styles.completedContainer,
          isDragging && styles.draggingContainer,
        ]}
        testID={`task-${task.id}`}
      >
        <Pressable
          onPress={handleCheck}
          hitSlop={4}
          style={[styles.checkCircle, task.completed && { backgroundColor: categoryColor, borderColor: categoryColor }]}
          disabled={!!hasSubtasks}
          testID={`check-${task.id}`}
          accessibilityLabel={task.completed ? 'Mark incomplete' : 'Mark complete'}
          accessibilityRole="checkbox"
        >
          {task.completed && <Ionicons name="checkmark" size={14} color={Colors.white} />}
        </Pressable>
        <View style={styles.content}>
          <View style={styles.topRow}>
            <Text style={[styles.title, task.completed && styles.completedText]}>
              {task.title}
            </Text>
            <View style={styles.topActions}>
              {!task.completed && !hasSubtasks && (
                <View style={styles.xpBadge}>
                  <Text style={styles.xpBadgeText}>+{taskXp} XP</Text>
                </View>
              )}
              {!task.completed && onStartFocus && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onStartFocus(task);
                  }}
                  hitSlop={8}
                  style={styles.quickPlayBtn}
                  testID={`quick-start-${task.id}`}
                  accessibilityLabel="Start focus session"
                >
                  <Ionicons name="play-circle" size={24} color={Colors.primary} />
                </Pressable>
              )}
              <View style={[styles.priorityDot, { backgroundColor: priorityDot }]} />
              {onEdit && !task.completed && (
                <Pressable
                  onPress={handleEdit}
                  hitSlop={8}
                  style={styles.editBtn}
                  testID={`edit-${task.id}`}
                  accessibilityLabel="Edit task"
                >
                  <Ionicons name="create-outline" size={16} color={Colors.textTertiary} />
                </Pressable>
              )}
            </View>
          </View>
          {task.description && !hasSubtasks ? (
            <Text style={[styles.description, task.completed && styles.completedSubText]}>
              {task.description}
            </Text>
          ) : null}

          {hasSubtasks ? (
            <View style={styles.subtaskProgress}>
              <View style={styles.subtaskProgressBar}>
                <View style={[styles.subtaskProgressFill, { width: `${subtasksTotal > 0 ? (subtasksDone / subtasksTotal) * 100 : 0}%`, backgroundColor: categoryColor }]} />
              </View>
              <Text style={styles.subtaskProgressText}>{subtasksDone}/{subtasksTotal}</Text>
            </View>
          ) : null}

          <View style={styles.metaRow}>
            {task.time ? (
              <View style={styles.timeBadge}>
                <Ionicons name="time-outline" size={12} color={Colors.textTertiary} />
                <Text style={styles.timeText}>{task.time}</Text>
              </View>
            ) : null}
            <View style={[styles.categoryBadge, { backgroundColor: categoryColor + '15' }]}>
              <Text style={[styles.categoryText, { color: categoryColor }]}>{getCategoryLabel(task.category)}</Text>
            </View>
            {task.fromCarryover && !task.completed ? (
              <View style={styles.carryoverPill}>
                <Ionicons name="return-up-back-outline" size={11} color="#9CA3AF" />
                <Text style={styles.carryoverPillText}>Rolled over</Text>
              </View>
            ) : null}
            {task.skipDays && task.skipDays >= 2 && !task.completed && onBlockerTap ? (
              <Pressable onPress={handleBlockerTap} style={styles.stuckBadge} hitSlop={6} testID={`stuck-${task.id}`}>
                <Ionicons name="warning-outline" size={11} color="#D97706" />
                <Text style={styles.stuckBadgeText}>Stuck?</Text>
              </Pressable>
            ) : null}
            {!task.completed && (
              <Pressable
                onPress={handleStartTimer}
                hitSlop={6}
                style={({ pressed }) => [styles.timerButton, pressed && { opacity: 0.75 }]}
                testID={`timer-${task.id}`}
              >
                <Feather name="clock" size={13} color={Colors.textTertiary} />
                <Text style={styles.timerButtonText}>Focus</Text>
              </Pressable>
            )}
          </View>
          {!task.completed && !task.isSubtask && onResize && (
            <Pressable
              onPress={handleResize}
              hitSlop={6}
              style={({ pressed }) => [styles.resizeButton, pressed && { opacity: 0.75 }]}
              testID={`resize-${task.id}`}
            >
              <Ionicons name="git-branch-outline" size={13} color={Colors.primary} />
              <Text style={styles.resizeButtonText}>{hasSubtasks ? 'Change steps' : 'Break down'}</Text>
            </Pressable>
          )}

          {hasSubtasks ? (
            <View style={styles.subtasksContainer}>
              {task.subtasks!.map((st, idx) => (
                <Animated.View key={st.id} entering={FadeInDown.duration(250).delay(idx * 40)}>
                  <SubtaskRow subtask={st} onToggle={onToggle} xpValue={perSubtaskXp} />
                </Animated.View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  completedContainer: {
    opacity: 0.6,
    backgroundColor: Colors.surface,
  },
  draggingContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderColor: Colors.primary + '40',
    transform: [{ scale: 1.02 }],
  },
  editBtn: {
    padding: 2,
  },
  quickPlayBtn: {
    padding: 2,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resizeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '12',
    marginTop: 8,
  },
  resizeButtonText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: Colors.textTertiary,
  },
  description: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 4,
  },
  completedSubText: {
    color: Colors.textTertiary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  timerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  timerButtonText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
  },
  carryoverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  carryoverPillText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: '#9CA3AF',
  },
  stuckBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  stuckBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#D97706',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  subtaskProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  subtaskProgressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
  },
  subtaskProgressFill: {
    height: 4,
    borderRadius: 2,
  },
  subtaskProgressText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
  },
  subtasksContainer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  xpBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  xpBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#D97706',
    letterSpacing: 0.3,
  },
  subtaskCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  subtaskText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 18,
  },
  subtaskTextDone: {
    textDecorationLine: 'line-through',
    color: Colors.textTertiary,
  },
});
