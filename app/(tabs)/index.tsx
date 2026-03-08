import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import Colors from '@/constants/colors';
import TaskCard from '@/components/TaskCard';
import ProgressRing from '@/components/ProgressRing';
import TaskResizerSheet from '@/components/TaskResizerSheet';
import LogProgressSheet from '@/components/LogProgressSheet';
import {
  getTodayPlan,
  updateTaskCompletion,
  getGoals,
  regeneratePlan,
  savePlan,
  replaceTaskWithSubtasks,
  getCompletionHistory,
  updateGoalProgress,
  getTodayKey,
  incrementStats,
  awardBadge,
  decrementStats,
  calculateTaskXp,
  xpForSubtask,
  ALL_BADGES,
  type DayPlan,
  type Goal,
  type Task,
} from '@/lib/storage';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { formatDate } from '@/lib/helpers';
import XpToast from '@/components/XpToast';

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [resizerVisible, setResizerVisible] = useState(false);
  const [resizerTask, setResizerTask] = useState<Task | null>(null);
  const [logSheetVisible, setLogSheetVisible] = useState(false);
  const [logTask, setLogTask] = useState<Task | null>(null);
  const [logGoal, setLogGoal] = useState<Goal | null>(null);
  const [confirmingRefresh, setConfirmingRefresh] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<Task[]>([]);
  const [xpToastVisible, setXpToastVisible] = useState(false);
  const [xpEarned, setXpEarned] = useState(0);
  const [badgeToastVisible, setBadgeToastVisible] = useState(false);
  const [badgeToastLabel, setBadgeToastLabel] = useState('');

  const loadCalendarEvents = useCallback(async () => {
    try {
      const today = getTodayKey();
      const statusUrl = new URL('/api/calendar/status', getApiUrl());
      const statusRes = await fetch(statusUrl.toString(), { cache: 'no-store' });
      const status = await statusRes.json();

      const events: Task[] = [];

      const fetchEvents = async (source: 'google' | 'outlook') => {
        const url = new URL(`/api/calendar/${source}/events`, getApiUrl());
        url.searchParams.set('date', today);
        const res = await fetch(url.toString(), { cache: 'no-store' });
        const data = await res.json();
        if (data.connected && data.events?.length) {
          data.events.forEach((e: any) => {
            const startTime = e.start
              ? new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              : undefined;
            events.push({
              id: `cal-${source}-${e.id}`,
              title: e.title,
              category: 'calendar',
              completed: false,
              priority: 'high',
              time: startTime,
              description: e.location ? `📍 ${e.location}` : e.description,
            });
          });
        }
      };

      if (status.google) await fetchEvents('google');
      if (status.outlook) await fetchEvents('outlook');

      setCalendarEvents(events);
    } catch {
      setCalendarEvents([]);
    }
  }, []);

  const loadData = useCallback(async () => {
    const loadedGoals = await getGoals();
    setGoals(loadedGoals);
    const todayPlan = await getTodayPlan(loadedGoals);
    setPlan(todayPlan);
    setLoading(false);
    loadCalendarEvents();
  }, [loadCalendarEvents]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      getGoals().then(setGoals);
      loadCalendarEvents();
    }, [loadCalendarEvents])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const loadedGoals = await getGoals();
    setGoals(loadedGoals);
    const newPlan = await regeneratePlan(loadedGoals);
    setPlan(newPlan);
    setRefreshing(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const runSmartRefresh = useCallback(async () => {
    setGeneratingAI(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const loadedGoals = await getGoals();
      const history = await getCompletionHistory();
      const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

      const res = await apiRequest('POST', '/api/ai/generate-plan', {
        goals: loadedGoals.map(g => ({
          id: g.id,
          title: g.title,
          category: g.category,
          current: g.current,
          target: g.target,
          unit: g.unit,
        })),
        history,
        dayOfWeek,
      });
      const data = await res.json();

      const validCategories = ['calendar', 'fitness', 'finance', 'career', 'personal', 'social'];
      const validPriorities = ['high', 'medium', 'low'];

      if (data.tasks && data.tasks.length > 0) {
        const generateId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const newPlan: DayPlan = {
          date: getTodayKey(),
          tasks: data.tasks.map((t: any) => ({
            id: generateId(),
            title: String(t.title || 'Task'),
            category: validCategories.includes(t.category) ? t.category : 'personal',
            completed: false,
            priority: validPriorities.includes(t.priority) ? t.priority : 'medium',
            time: t.time ? String(t.time) : undefined,
            description: t.description ? String(t.description) : undefined,
            goalId: t.goalId ? String(t.goalId) : undefined,
          })),
          greeting: plan?.greeting || 'Good day',
          insight: data.insight || 'Start small, stay consistent.',
        };
        await savePlan(newPlan);
        setPlan(newPlan);
        setGoals(loadedGoals);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      console.error('AI plan generation failed, falling back:', e);
      const loadedGoals = await getGoals();
      const fallbackPlan = await regeneratePlan(loadedGoals);
      setPlan(fallbackPlan);
      setGoals(loadedGoals);
    } finally {
      setGeneratingAI(false);
    }
  }, [plan]);

  const handleSmartRefresh = useCallback(() => {
    if (generatingAI) return;
    setConfirmingRefresh(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [generatingAI]);

  const handleConfirmRefresh = useCallback(() => {
    setConfirmingRefresh(false);
    runSmartRefresh();
  }, [runSmartRefresh]);

  const handleCancelRefresh = useCallback(() => {
    setConfirmingRefresh(false);
  }, []);

  const showXpToast = useCallback((xp: number) => {
    setXpEarned(xp);
    setXpToastVisible(true);
  }, []);

  const handleToggleTask = useCallback(async (taskId: string, completed: boolean) => {
    if (!plan) return;

    let matchedTask: Task | undefined;
    const updatedTasks = plan.tasks.map(t => {
      if (t.id === taskId) {
        matchedTask = t;
        return { ...t, completed };
      }
      if (t.subtasks) {
        const updatedSubs = t.subtasks.map(st =>
          st.id === taskId ? { ...st, completed } : st
        );
        const allDone = updatedSubs.every(st => st.completed) && updatedSubs.length > 0;
        return { ...t, subtasks: updatedSubs, completed: allDone };
      }
      return t;
    });
    const newPlan = { ...plan, tasks: updatedTasks };
    setPlan(newPlan);
    await updateTaskCompletion(plan.date, taskId, completed);

    if (completed) {
      const isGoalLinked = !!(matchedTask?.goalId);
      const priority = matchedTask?.priority ?? 'medium';
      let xpOverride: number | undefined;
      if (matchedTask?.isSubtask) {
        const parentTask = plan.tasks.find(t => t.subtasks?.some(st => st.id === matchedTask!.id));
        if (parentTask && parentTask.subtasks && parentTask.subtasks.length > 0) {
          const parentXp = calculateTaskXp(parentTask);
          xpOverride = xpForSubtask(parentXp, parentTask.subtasks.length);
        }
      }
      const { xpEarned: earned, newBadges } = await incrementStats(priority, isGoalLinked, xpOverride);
      showXpToast(earned);

      if (newBadges.length > 0) {
        const badgeDef = ALL_BADGES.find(b => b.id === newBadges[0]);
        if (badgeDef) {
          setTimeout(() => {
            setBadgeToastLabel(`Badge: ${badgeDef.label}`);
            setBadgeToastVisible(true);
          }, 1800);
        }
      }

      // Check perfect day
      const allDone = newPlan.tasks.every(t =>
        t.subtasks?.length ? t.subtasks.every(s => s.completed) : t.completed
      ) && calendarEvents.every(e => e.completed);
      if (allDone) await awardBadge('perfect_day');

      if (matchedTask && !matchedTask.isSubtask) {
        const linkedGoal = matchedTask.goalId
          ? goals.find(g => g.id === matchedTask!.goalId)
          : goals.find(g => g.category === matchedTask!.category);
        if (linkedGoal && linkedGoal.current < linkedGoal.target) {
          await awardBadge('goal_getter');
          setLogTask(matchedTask);
          setLogGoal(linkedGoal);
          setLogSheetVisible(true);
        }
      }
    } else {
      await decrementStats();
    }
  }, [plan, goals, calendarEvents, showXpToast]);

  const handleLogProgress = useCallback(async (amount: number) => {
    if (!logGoal) return;
    setLogSheetVisible(false);
    const updated = await updateGoalProgress(logGoal.id, amount);
    if (updated) {
      setGoals(prev => prev.map(g => g.id === updated.id ? updated : g));
    }
    setLogTask(null);
    setLogGoal(null);
  }, [logGoal]);

  const handleSkipLog = useCallback(() => {
    setLogSheetVisible(false);
    setLogTask(null);
    setLogGoal(null);
  }, []);

  const handleOpenResizer = useCallback((task: Task) => {
    setResizerTask(task);
    setResizerVisible(true);
  }, []);

  const handleApplyResize = useCallback(async (taskId: string, steps: string[]) => {
    if (!plan) return;
    const updatedPlan = await replaceTaskWithSubtasks(plan.date, taskId, steps);
    if (updatedPlan) {
      setPlan(updatedPlan);
    }
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

  const allTasks = plan.tasks.reduce((count, t) => {
    if (t.subtasks && t.subtasks.length > 0) return count + t.subtasks.length;
    return count + 1;
  }, 0);
  const completedCount = plan.tasks.reduce((count, t) => {
    if (t.subtasks && t.subtasks.length > 0) return count + t.subtasks.filter(s => s.completed).length;
    return count + (t.completed ? 1 : 0);
  }, 0);
  const progress = allTasks > 0 ? Math.round((completedCount / allTasks) * 100) : 0;
  const todayLabel = formatDate(getTodayKey());
  const incompleteTasks = plan.tasks.filter(t => !t.completed);
  const completedTasks = plan.tasks.filter(t => t.completed);
  const incompleteCalEvents = calendarEvents.filter(e => !e.completed);
  const completedCalEvents = calendarEvents.filter(e => e.completed);
  const allCompleted = [...completedTasks, ...completedCalEvents];

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
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>{plan.greeting}</Text>
            <Text style={styles.dateText}>{todayLabel}</Text>
          </View>
          <Pressable
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await loadCalendarEvents();
            }}
            style={({ pressed }) => [styles.syncButton, pressed && { opacity: 0.7 }]}
            testID="sync-calendar"
          >
            <Ionicons name="sync-outline" size={20} color={Colors.primary} />
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.progressCard}>
          <View style={styles.progressLeft}>
            <Text style={styles.progressTitle}>Today's Progress</Text>
            <Text style={styles.progressSubtitle}>
              {completedCount} of {allTasks} tasks done
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

        <Animated.View entering={FadeInDown.duration(400).delay(350)}>
          {confirmingRefresh ? (
            <View style={styles.confirmRow}>
              <Text style={styles.confirmText}>Replace today's tasks?</Text>
              <View style={styles.confirmButtons}>
                <Pressable
                  onPress={handleCancelRefresh}
                  style={({ pressed }) => [styles.confirmCancel, pressed && { opacity: 0.7 }]}
                  testID="smart-refresh-cancel"
                >
                  <Text style={styles.confirmCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleConfirmRefresh}
                  style={({ pressed }) => [styles.confirmGo, pressed && { opacity: 0.85 }]}
                  testID="smart-refresh-confirm"
                >
                  <Ionicons name="sparkles" size={14} color={Colors.white} />
                  <Text style={styles.confirmGoText}>Yes, refresh</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={handleSmartRefresh}
              disabled={generatingAI}
              style={({ pressed }) => [styles.smartRefreshButton, pressed && { opacity: 0.85 }, generatingAI && { opacity: 0.7 }]}
              testID="smart-refresh"
            >
              {generatingAI ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Ionicons name="sparkles" size={16} color={Colors.white} />
              )}
              <Text style={styles.smartRefreshText}>
                {generatingAI ? 'Generating...' : 'Smart Refresh'}
              </Text>
            </Pressable>
          )}
        </Animated.View>

        {incompleteCalEvents.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="calendar" size={15} color="#4285F4" />
              <Text style={[styles.sectionTitle, { color: '#4285F4' }]}>Today's Events</Text>
            </View>
            {incompleteCalEvents.map((event) => (
              <TaskCard
                key={event.id}
                task={event}
                onToggle={async (id, done) => {
                  const updated = calendarEvents.map(e => e.id === id ? { ...e, completed: done } : e);
                  setCalendarEvents(updated);
                  if (done) {
                    const { xpEarned: earned } = await incrementStats('high', false);
                    showXpToast(earned);
                    await awardBadge('calendar_pro');
                    // Check perfect day
                    const allTasksDone = plan?.tasks.every(t =>
                      t.subtasks?.length ? t.subtasks.every(s => s.completed) : t.completed
                    ) ?? true;
                    const allCalDone = updated.every(e => e.completed);
                    if (allTasksDone && allCalDone) await awardBadge('perfect_day');
                  } else {
                    await decrementStats();
                  }
                }}
              />
            ))}
          </View>
        ) : null}

        {incompleteTasks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>To Do</Text>
            {incompleteTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onToggle={handleToggleTask}
                onResize={handleOpenResizer}
              />
            ))}
          </View>
        ) : null}

        {allCompleted.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Completed</Text>
            {allCompleted.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onToggle={task.category === 'calendar'
                  ? async (id, done) => {
                      const updated = calendarEvents.map(e => e.id === id ? { ...e, completed: done } : e);
                      setCalendarEvents(updated);
                      if (!done) await decrementStats();
                    }
                  : handleToggleTask}
                onResize={task.category !== 'calendar' ? handleOpenResizer : undefined}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <TaskResizerSheet
        visible={resizerVisible}
        task={resizerTask}
        onClose={() => { setResizerVisible(false); setResizerTask(null); }}
        onApply={handleApplyResize}
      />

      <LogProgressSheet
        visible={logSheetVisible}
        task={logTask}
        goal={logGoal}
        onLog={handleLogProgress}
        onSkip={handleSkipLog}
      />

      <XpToast
        visible={xpToastVisible}
        xp={xpEarned}
        onHide={() => setXpToastVisible(false)}
      />
      <XpToast
        visible={badgeToastVisible}
        xp={0}
        label={badgeToastLabel}
        onHide={() => setBadgeToastVisible(false)}
      />
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
    marginBottom: 16,
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
  smartRefreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 24,
  },
  smartRefreshText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
  confirmRow: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  confirmText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    textAlign: 'center',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmCancel: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  confirmCancelText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  confirmGo: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  confirmGoText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  syncButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 12,
  },
});
