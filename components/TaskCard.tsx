import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, withSpring, useSharedValue } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import { Task } from '@/lib/storage';
import { getCategoryColor, getCategoryLabel } from '@/lib/helpers';

interface TaskCardProps {
  task: Task;
  onToggle: (id: string, completed: boolean) => void;
}

export default function TaskCard({ task, onToggle }: TaskCardProps) {
  const scale = useSharedValue(1);
  const categoryColor = getCategoryColor(task.category);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSpring(0.95, { damping: 15 }, () => {
      scale.value = withSpring(1);
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggle(task.id, !task.completed);
  };

  const priorityDot = task.priority === 'high' ? Colors.error : task.priority === 'medium' ? Colors.warning : Colors.textTertiary;

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.container,
          task.completed && styles.completedContainer,
          pressed && { opacity: 0.9 },
        ]}
        testID={`task-${task.id}`}
      >
        <View style={[styles.checkCircle, task.completed && { backgroundColor: categoryColor, borderColor: categoryColor }]}>
          {task.completed && <Ionicons name="checkmark" size={14} color={Colors.white} />}
        </View>
        <View style={styles.content}>
          <View style={styles.topRow}>
            <Text style={[styles.title, task.completed && styles.completedText]} numberOfLines={1}>
              {task.title}
            </Text>
            <View style={[styles.priorityDot, { backgroundColor: priorityDot }]} />
          </View>
          {task.description ? (
            <Text style={[styles.description, task.completed && styles.completedSubText]} numberOfLines={1}>
              {task.description}
            </Text>
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
          </View>
        </View>
      </Pressable>
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
});
