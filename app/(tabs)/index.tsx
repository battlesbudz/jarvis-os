import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import TaskCard from '@/components/TaskCard';
import ProgressRing from '@/components/ProgressRing';
import {
  getTodayPlan,
  updateTaskCompletion,
  getGoals,
  regeneratePlan,
  getTodayKey,
  type DayPlan,
  type Goal,
} from '@/lib/storage';
import { formatDate } from '@/lib/helpers';

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const loadedGoals = await getGoals();
    setGoals(loadedGoals);
    const todayPlan = await getTodayPlan(loadedGoals);
    setPlan(todayPlan);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const loadedGoals = await getGoals();
    setGoals(loadedGoals);
    const newPlan = await regeneratePlan(loadedGoals);
    setPlan(newPlan);
    setRefreshing(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleToggleTask = useCallback(async (taskId: string, completed: boolean) => {
    if (!plan) return;
    const updatedTasks = plan.tasks.map(t =>
      t.id === taskId ? { ...t, completed } : t
    );
    setPlan({ ...plan, tasks: updatedTasks });
    await updateTaskCompletion(plan.date, taskId, completed);
  }, [plan]);

  if (loading || !plan) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <View style={styles.shimmer} />
        <View style={[styles.shimmer, { width: '60%' }]} />
        <View style={[styles.shimmer, { height: 100, marginTop: 20 }]} />
        <View style={[styles.shimmer, { height: 80, marginTop: 12 }]} />
        <View style={[styles.shimmer, { height: 80, marginTop: 12 }]} />
      </View>
    );
  }

  const completedCount = plan.tasks.filter(t => t.completed).length;
  const totalCount = plan.tasks.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const todayLabel = formatDate(getTodayKey());
  const incompleteTasks = plan.tasks.filter(t => !t.completed);
  const completedTasks = plan.tasks.filter(t => t.completed);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 16 + (Platform.OS === 'web' ? 67 : 0),
            paddingBottom: Platform.OS === 'web' ? 34 + 100 : 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <Animated.View entering={FadeInDown.duration(400).delay(100)}>
          <Text style={styles.greeting}>{plan.greeting}</Text>
          <Text style={styles.dateText}>{todayLabel}</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.progressCard}>
          <View style={styles.progressLeft}>
            <Text style={styles.progressTitle}>Today's Progress</Text>
            <Text style={styles.progressSubtitle}>
              {completedCount} of {totalCount} tasks done
            </Text>
            {progress === 100 ? (
              <View style={styles.completeBadge}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={styles.completeText}>All done!</Text>
              </View>
            ) : null}
          </View>
          <ProgressRing
            progress={progress}
            size={72}
            strokeWidth={6}
            color={progress === 100 ? Colors.success : Colors.primary}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.insightCard}>
          <Ionicons name="bulb-outline" size={18} color={Colors.warning} />
          <Text style={styles.insightText}>{plan.insight}</Text>
        </Animated.View>

        {incompleteTasks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>To Do</Text>
            {incompleteTasks.map((task) => (
              <TaskCard key={task.id} task={task} onToggle={handleToggleTask} />
            ))}
          </View>
        ) : null}

        {completedTasks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Completed</Text>
            {completedTasks.map((task) => (
              <TaskCard key={task.id} task={task} onToggle={handleToggleTask} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
  },
  shimmer: {
    height: 28,
    backgroundColor: Colors.border,
    borderRadius: 8,
    marginBottom: 8,
    width: '80%',
    opacity: 0.5,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  greeting: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 4,
  },
  dateText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  progressLeft: {
    flex: 1,
    marginRight: 16,
  },
  progressTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 4,
  },
  progressSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  completeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  completeText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.success,
  },
  insightCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 24,
    gap: 10,
    borderWidth: 1,
    borderColor: '#FEF3C7',
  },
  insightText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#92400E',
    lineHeight: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 12,
  },
});
