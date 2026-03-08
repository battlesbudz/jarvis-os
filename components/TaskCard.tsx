import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, withSpring, useSharedValue, FadeInDown } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import { Task, calculateTaskXp } from '@/lib/storage';
import { getCategoryColor, getCategoryLabel } from '@/lib/helpers';

interface TaskCardProps {
  task: Task;
  onToggle: (id: string, completed: boolean) => void;
  onResize?: (task: Task) => void;
}

function SubtaskRow({ subtask, onToggle }: { subtask: Task; onToggle: (id: string, completed: boolean) => void }) {
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

  const subtaskXp = calculateTaskXp(subtask);

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
        <Text style={[styles.subtaskText, subtask.completed && styles.subtaskTextDone]} numberOfLines={1}>
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

export default function TaskCard({ task, onToggle, onResize }: TaskCardProps) {
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

  const priorityDot = task.priority === 'high' ? Colors.error : task.priority === 'medium' ? Colors.warning : Colors.textTertiary;

  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const subtasksDone = hasSubtasks ? task.subtasks!.filter(s => s.completed).length : 0;
  const subtasksTotal = hasSubtasks ? task.subtasks!.length : 0;
  const taskXp = calculateTaskXp(task);

  return (
    <Animated.View style={animatedStyle}>
      <View
        style={[
          styles.container,
          task.completed && styles.completedContainer,
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
            <Text style={[styles.title, task.completed && styles.completedText]} numberOfLines={1}>
              {task.title}
            </Text>
            <View style={styles.topActions}>
              {!task.completed && !hasSubtasks && (
                <View style={styles.xpBadge}>
                  <Text style={styles.xpBadgeText}>+{taskXp} XP</Text>
                </View>
              )}
              <View style={[styles.priorityDot, { backgroundColor: priorityDot }]} />
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
            {!task.completed && !task.isSubtask && onResize && (
              <Pressable
                onPress={handleResize}
                hitSlop={6}
                style={({ pressed }) => [styles.resizeButton, { marginLeft: 'auto' }, pressed && { opacity: 0.75 }]}
                testID={`resize-${task.id}`}
              >
                <Ionicons name="git-branch-outline" size={13} color={Colors.primary} />
                <Text style={styles.resizeButtonText}>{hasSubtasks ? 'Change steps' : 'Break down'}</Text>
              </Pressable>
            )}
          </View>

          {hasSubtasks ? (
            <View style={styles.subtasksContainer}>
              {task.subtasks!.map((st, idx) => (
                <Animated.View key={st.id} entering={FadeInDown.duration(250).delay(idx * 40)}>
                  <SubtaskRow subtask={st} onToggle={onToggle} />
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
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '12',
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
