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
import SortableList from '@/components/SortableList';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import Colors from '@/constants/colors';
import TaskCard from '@/components/TaskCard';
import ProgressRing from '@/components/ProgressRing';
import TaskResizerSheet from '@/components/TaskResizerSheet';
import TaskEditSheet from '@/components/TaskEditSheet';
import LogProgressSheet from '@/components/LogProgressSheet';
import TimelineView from '@/components/TimelineView';
import BrainDumpModal from '@/components/BrainDumpModal';
import BlockerModal from '@/components/BlockerModal';
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
  xpForTask,
  xpForSubtask,
  resetStats,
  getStats,
  getDailyCoachNote,
  saveDailyCoachNote,
  getLifeContext,
  getViewMode,
  saveViewMode,
  ALL_BADGES,
  getBrainDumpInbox,
  saveBrainDumpItem,
  clearBrainDumpItem,
  addTaskToToday,
  getCompletedCalendarIds,
  saveCompletedCalendarId,
  getUserName,
  updateTask,
  deleteTask,
  reorderTasks,
  savePlanSnapshot,
  getPlanSnapshot,
  clearPlanSnapshot,
  restorePlanSnapshot,
  getBlockedTasks,
  saveBlockerAnswer,
  type DayPlan,
  type Goal,
  type Task,
  type ViewMode,
  type BrainDumpItem,
} from '@/lib/storage';
import { scheduleAllTaskReminders, requestNotificationPermissions } from '@/lib/notifications';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { formatDate } from '@/lib/helpers';
import XpToast from '@/components/XpToast';
import JustOneThingModal from '@/components/JustOneThingModal';
import EnergyCheckIn from '@/components/EnergyCheckIn';
import { getEnergyCheckin, type EnergyCheckin } from '@/lib/storage';

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
  const [coachNote, setCoachNote] = useState<string | null>(null);
  const [brainDumpVisible, setBrainDumpVisible] = useState(false);
  const [brainDumpInbox, setBrainDumpInbox] = useState<BrainDumpItem[]>([]);
  const [jotVisible, setJotVisible] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [jotTask, setJotTask] = useState<Task | null>(null);
  const [jotTaskIndex, setJotTaskIndex] = useState(0);
  const [energyCheckin, setEnergyCheckin] = useState<EnergyCheckin | null>(null);
  const [energyCheckInVisible, setEnergyCheckInVisible] = useState(false);
  const [userName, setUserName] = useState('');
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [blockerTask, setBlockerTask] = useState<Task | null>(null);

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
        // Pass local-timezone UTC bounds so server uses correct day window
        url.searchParams.set('startTime', new Date(today + 'T00:00:00').toISOString());
        url.searchParams.set('endTime', new Date(today + 'T23:59:59').toISOString());
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

      // Restore previously completed calendar events for today
      const completedIds = await getCompletedCalendarIds();
      const eventsWithCompletion = events.map(e =>
        completedIds.includes(e.id) ? { ...e, completed: true } : e
      );

      setCalendarEvents(eventsWithCompletion);
    } catch {
      setCalendarEvents([]);
    }
  }, []);

  const loadDailyCoachNote = useCallback(async (loadedGoals: Goal[]) => {
    try {
      const today = getTodayKey();
      const cached = await getDailyCoachNote();
      if (cached && cached.date === today && cached.note) {
        setCoachNote(cached.note);
        return;
      }
      const [stats, history, lc] = await Promise.all([getStats(), getCompletionHistory(), getLifeContext()]);
      const url = new URL('/api/coach/checkin', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goals: loadedGoals, stats, history, lifeContext: lc }),
      });
      const data = await res.json();
      if (data.note) {
        setCoachNote(data.note);
        await saveDailyCoachNote(data.note);
      }
    } catch {}
  }, []);

  const loadData = useCallback(async () => {
    const loadedGoals = await getGoals();
    setGoals(loadedGoals);
    const todayPlan = await getTodayPlan(loadedGoals);
    setPlan(todayPlan);
    const [checkin, mode, inbox, name] = await Promise.all([
      getEnergyCheckin(),
      getViewMode(),
      getBrainDumpInbox(),
      getUserName(),
    ]);
    setUserName(name);
    setEnergyCheckin(checkin);
    if (!checkin) {
      setEnergyCheckInVisible(true);
    }
    setViewMode(mode);
    setBrainDumpInbox(inbox);
    setLoading(false);
    loadCalendarEvents();
    loadDailyCoachNote(loadedGoals);
    const snapshot = await getPlanSnapshot();
    if (snapshot) setCanUndo(true);
    
    // Request notification permissions and schedule reminders
    requestNotificationPermissions().then(granted => {
      if (granted && todayPlan.tasks.length > 0) {
        scheduleAllTaskReminders(todayPlan.tasks);
      }
    });
  }, [loadCalendarEvents, loadDailyCoachNote]);

  const toggleViewMode = useCallback(async () => {
    const newMode = viewMode === 'list' ? 'timeline' : 'list';
    setViewMode(newMode);
    await saveViewMode(newMode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [viewMode]);

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
      const currentPlan = await getTodayPlan(loadedGoals);
      const brainDumpTasks = currentPlan.tasks.filter(t => t.fromBrainDump && !t.completed);
      const carriedOverTasks = currentPlan.tasks
        .filter(t => t.fromCarryover && !t.completed)
        .map(t => ({ title: t.title, category: t.category, skipDays: t.skipDays ?? 1 }));
      const blockedTasksList = await getBlockedTasks();
      const history = await getCompletionHistory();
      const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

      const [lc, gmailData] = await Promise.allSettled([
        getLifeContext(),
        fetch(new URL('/api/gmail/commitments', getApiUrl()).toString(), { cache: 'no-store' }).then(r => r.json()).catch(() => ({ connected: false, items: [] })),
      ]);
      const lifeContext = lc.status === 'fulfilled' ? lc.value : null;
      const gmailItems = gmailData.status === 'fulfilled' && gmailData.value.connected ? gmailData.value.items : [];

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
        lifeContext,
        gmailItems,
        energyCheckin,
        brainDumpTasks: brainDumpTasks.map(t => ({
          title: t.title,
          description: t.description,
          category: t.category,
        })),
        carriedOverTasks,
        blockedTasks: blockedTasksList.map(bt => ({
          title: bt.title,
          skipDays: bt.skipDays,
          blockerType: bt.blockerType,
        })),
      });
      const data = await res.json();

      const validCategories = ['calendar', 'fitness', 'finance', 'career', 'personal', 'social'];
      const validPriorities = ['high', 'medium', 'low'];

      if (data.tasks && data.tasks.length > 0) {
        const generateId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const aiTasks = data.tasks.map((t: any) => ({
          id: generateId(),
          title: String(t.title || 'Task'),
          category: validCategories.includes(t.category) ? t.category : 'personal',
          completed: false,
          priority: validPriorities.includes(t.priority) ? t.priority : 'medium',
          time: t.time ? String(t.time) : undefined,
          description: t.description ? String(t.description) : undefined,
          goalId: t.goalId ? String(t.goalId) : undefined,
        }));

        const isBrainDumpCovered = (btTitle: string): boolean => {
          const btWords = btTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          if (btWords.length === 0) return false;
          return aiTasks.some((nt: Task) => {
            const ntWords = nt.title.toLowerCase().split(/\s+/);
            return btWords.some(bw => ntWords.some(nw => nw.includes(bw) || bw.includes(nw)));
          });
        };

        const missedBrainDumpTasks = brainDumpTasks.filter(bt => !isBrainDumpCovered(bt.title));

        const newPlan: DayPlan = {
          date: getTodayKey(),
          tasks: [...aiTasks, ...missedBrainDumpTasks],
          greeting: plan?.greeting || 'Good day',
          insight: data.insight || 'Start small, stay consistent.',
        };
        if (currentPlan.tasks.length > 0) await savePlanSnapshot(currentPlan);
        await savePlan(newPlan);
        setPlan(newPlan);
        setGoals(loadedGoals);
        setCanUndo(true);
        scheduleAllTaskReminders(newPlan.tasks);
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

  const handleUndo = useCallback(async () => {
    const loadedGoals = await getGoals();
    const restored = await restorePlanSnapshot(loadedGoals);
    if (restored) {
      setPlan(restored);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setCanUndo(false);
  }, []);

  const handleDismissUndo = useCallback(async () => {
    await clearPlanSnapshot();
    setCanUndo(false);
  }, []);

  const handleBlockerSolved = useCallback(async (task: Task, blockerType: string, suggestion: string) => {
    await saveBlockerAnswer(task.title, blockerType, suggestion);
    setBlockerTask(null);
    const loadedGoals = await getGoals();
    const refreshed = await getTodayPlan(loadedGoals);
    setPlan(refreshed);
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
      let xpToRemove = 10;
      if (matchedTask) {
        if (matchedTask.isSubtask) {
          const parentTask = plan.tasks.find(t => t.subtasks?.some(st => st.id === matchedTask!.id));
          if (parentTask && parentTask.subtasks && parentTask.subtasks.length > 0) {
            xpToRemove = xpForSubtask(calculateTaskXp(parentTask), parentTask.subtasks.length);
          } else {
            xpToRemove = calculateTaskXp(matchedTask);
          }
        } else {
          xpToRemove = calculateTaskXp(matchedTask);
        }
      }
      await decrementStats(xpToRemove);
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

  const parseBrainDump = useCallback(async (text: string) => {
    try {
      const url = new URL('/api/ai/parse-brain-dump', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (Array.isArray(data.tasks) && data.tasks.length > 0) return data.tasks;
    } catch {}
    return null;
  }, []);

  const handleSaveToToday = useCallback(async (text: string) => {
    const mkId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const parsed = await parseBrainDump(text);
    if (parsed && parsed.length > 0) {
      for (const t of parsed) {
        const subtaskObjs = Array.isArray(t.subtasks) && t.subtasks.length > 0
          ? t.subtasks.map((s: string) => ({
              id: mkId(),
              title: s,
              category: t.category || 'personal',
              completed: false,
              priority: 'low' as const,
              isSubtask: true,
            }))
          : undefined;
        await addTaskToToday({
          title: t.title || text,
          description: t.description || undefined,
          category: t.category || 'personal',
          priority: t.priority || 'low',
          subtasks: subtaskObjs,
          fromBrainDump: true,
        });
      }
    } else {
      await addTaskToToday({ title: text, category: 'personal', priority: 'low', fromBrainDump: true });
    }
    const loadedGoals = await getGoals();
    const todayPlan = await getTodayPlan(loadedGoals);
    setPlan(todayPlan);
  }, [parseBrainDump]);

  const handleSaveToInbox = useCallback(async (text: string) => {
    const parsed = await parseBrainDump(text);
    if (parsed && parsed.length > 0) {
      for (const t of parsed) {
        const itemText = t.description
          ? `${t.title}: ${t.description}`
          : t.title;
        await saveBrainDumpItem(itemText || text);
      }
    } else {
      await saveBrainDumpItem(text);
    }
    const inbox = await getBrainDumpInbox();
    setBrainDumpInbox(inbox);
  }, [parseBrainDump]);

  const handlePromoteInboxItem = useCallback(async (item: BrainDumpItem) => {
    await addTaskToToday({ title: item.text, category: 'personal', priority: 'low', fromBrainDump: true });
    await clearBrainDumpItem(item.id);
    const [loadedGoals, inbox] = await Promise.all([getGoals(), getBrainDumpInbox()]);
    const todayPlan = await getTodayPlan(loadedGoals);
    setPlan(todayPlan);
    setBrainDumpInbox(inbox);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleDismissInboxItem = useCallback(async (id: string) => {
    await clearBrainDumpItem(id);
    const inbox = await getBrainDumpInbox();
    setBrainDumpInbox(inbox);
  }, []);

  const handleOpenEdit = useCallback((task: Task) => {
    setEditingTask(task);
    setEditSheetVisible(true);
  }, []);

  const handleSaveEdit = useCallback(async (updatedTask: Task) => {
    if (!plan) return;
    await updateTask(plan.date, updatedTask.id, updatedTask);
    const loadedGoals = await getGoals();
    const refreshed = await getTodayPlan(loadedGoals);
    setPlan(refreshed);
    setEditSheetVisible(false);
    setEditingTask(null);
  }, [plan]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (!plan) return;
    await deleteTask(plan.date, taskId);
    const loadedGoals = await getGoals();
    const refreshed = await getTodayPlan(loadedGoals);
    setPlan(refreshed);
    setEditSheetVisible(false);
    setEditingTask(null);
  }, [plan]);

  const handleReorderTasks = useCallback(async (newOrder: Task[]) => {
    if (!plan) return;
    setPlan(prev => prev ? { ...prev, tasks: [...newOrder, ...prev.tasks.filter(t => t.completed)] } : prev);
    await reorderTasks(plan.date, newOrder);
  }, [plan]);

  const getJotTasks = useCallback(() => {
    if (!plan) return [];
    
    // Pick incomplete tasks
    let candidates = plan.tasks.filter(t => !t.completed);
    
    // If energy is low (<= 2), prioritize low-priority tasks (which we'll use as a proxy for low-effort)
    // Actually, T003 says "filter to low-effort tasks when energy <= 2"
    // Since we don't have an explicit effort field, we use priority 'low' or 'medium' as proxy
    if (energyCheckin && energyCheckin.energy <= 2) {
      const lowEffort = candidates.filter(t => t.priority === 'low');
      if (lowEffort.length > 0) {
        candidates = lowEffort;
      } else {
        const medEffort = candidates.filter(t => t.priority === 'medium');
        if (medEffort.length > 0) {
          candidates = medEffort;
        }
      }
    } else {
      // Normal energy: sort by priority high -> med -> low
      candidates.sort((a, b) => {
        const score = { high: 3, medium: 2, low: 1 };
        return score[b.priority] - score[a.priority];
      });
    }

    return candidates;
  }, [plan, energyCheckin]);

  const handleOpenJot = useCallback(() => {
    const tasks = getJotTasks();
    if (tasks.length > 0) {
      setJotTask(tasks[0]);
      setJotTaskIndex(0);
      setJotVisible(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [getJotTasks]);

  const handleJotPickAnother = useCallback(() => {
    const tasks = getJotTasks();
    if (tasks.length > 1) {
      const nextIndex = (jotTaskIndex + 1) % tasks.length;
      setJotTaskIndex(nextIndex);
      setJotTask(tasks[nextIndex]);
    }
  }, [getJotTasks, jotTaskIndex]);

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
            <Text style={styles.greeting}>{plan.greeting}{userName ? `, ${userName}` : ''}</Text>
            <View style={styles.headerDateRow}>
              <Text style={styles.dateText}>{todayLabel}</Text>
              {energyCheckin && (
                <View style={[styles.energyPill, energyCheckin.energy <= 2 && styles.energyPillLow]}>
                  <Ionicons
                    name={energyCheckin.energy >= 4 ? 'flash' : energyCheckin.energy <= 2 ? 'bed-outline' : 'bicycle-outline'}
                    size={11}
                    color={energyCheckin.energy >= 4 ? '#D97706' : energyCheckin.energy <= 2 ? '#6B7280' : Colors.primary}
                  />
                  <Text style={[styles.energyPillText, energyCheckin.energy >= 4 && { color: '#D97706' }, energyCheckin.energy <= 2 && { color: '#6B7280' }]}>
                    {energyCheckin.energy === 1 ? 'Dead' : energyCheckin.energy === 2 ? 'Low Energy' : energyCheckin.energy === 3 ? 'Okay' : energyCheckin.energy === 4 ? 'Good' : 'On Fire'}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={toggleViewMode}
              style={({ pressed }) => [styles.syncButton, { marginRight: 8 }, pressed && { opacity: 0.7 }]}
              testID="toggle-view-mode"
            >
              <Ionicons name={viewMode === 'list' ? "calendar-outline" : "list-outline"} size={22} color={Colors.primary} />
            </Pressable>
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
          </View>
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

        {coachNote ? (
          <Animated.View entering={FadeInDown.duration(400).delay(340)} style={styles.coachNoteCard}>
            <View style={styles.coachNoteHeader}>
              <Ionicons name="sparkles-outline" size={15} color={Colors.secondary} />
              <Text style={styles.coachNoteLabel}>Coach</Text>
            </View>
            <Text style={styles.coachNoteText}>{coachNote}</Text>
          </Animated.View>
        ) : null}

        {canUndo ? (
          <Animated.View entering={FadeInDown.duration(300)} style={styles.undoBanner}>
            <Pressable
              style={styles.undoBannerMain}
              onPress={handleUndo}
            >
              <Ionicons name="arrow-undo-outline" size={16} color="#fff" />
              <Text style={styles.undoBannerText}>Plan replaced — tap to undo</Text>
            </Pressable>
            <Pressable onPress={handleDismissUndo} style={styles.undoBannerDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={16} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </Animated.View>
        ) : null}

        {energyCheckin && energyCheckin.energy <= 2 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(345)} style={styles.lowEnergyBanner}>
            <Ionicons name="moon-outline" size={15} color="#6B7280" />
            <Text style={styles.lowEnergyText}>Low energy mode — lighter tasks are prioritized for you today</Text>
          </Animated.View>
        ) : null}

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

        {viewMode === 'list' && (incompleteTasks.length > 0 || incompleteCalEvents.length > 0) ? (
          <Animated.View entering={FadeInDown.duration(400).delay(355)} style={styles.focusToolsRow}>
            <Pressable
              style={({ pressed }) => [styles.focusTool, pressed && { opacity: 0.75 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setBrainDumpVisible(true);
              }}
            >
              <View style={[styles.focusToolIcon, { backgroundColor: Colors.primary + '18' }]}>
                <Ionicons name="create-outline" size={20} color={Colors.primary} />
              </View>
              <Text style={styles.focusToolLabel}>Brain Dump</Text>
              <Text style={styles.focusToolSub}>Clear your head</Text>
            </Pressable>
            <View style={styles.focusToolDivider} />
            <Pressable
              style={({ pressed }) => [styles.focusTool, pressed && { opacity: 0.75 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                handleOpenJot();
              }}
            >
              <View style={[styles.focusToolIcon, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="flash" size={20} color="#D97706" />
              </View>
              <Text style={styles.focusToolLabel}>Just One Thing</Text>
              <Text style={styles.focusToolSub}>Feeling overwhelmed?</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        {viewMode === 'list' ? (
          <>
            {brainDumpInbox.length > 0 ? (
              <View style={styles.inboxSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="archive-outline" size={15} color={Colors.textSecondary} />
                  <Text style={styles.inboxSectionTitle}>Inbox</Text>
                </View>
                {brainDumpInbox.map((item) => (
                  <View key={item.id} style={styles.inboxItem}>
                    <Text style={styles.inboxItemText}>{item.text}</Text>
                    <View style={styles.inboxActions}>
                      <Pressable
                        onPress={() => handleDismissInboxItem(item.id)}
                        style={({ pressed }) => [styles.inboxAction, pressed && { opacity: 0.6 }]}
                      >
                        <Ionicons name="trash-outline" size={18} color={Colors.textTertiary} />
                      </Pressable>
                      <Pressable
                        onPress={() => handlePromoteInboxItem(item)}
                        style={({ pressed }) => [styles.inboxAction, styles.promoteAction, pressed && { opacity: 0.8 }]}
                      >
                        <Ionicons name="add" size={20} color={Colors.white} />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

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
                      await saveCompletedCalendarId(id, done);
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
                        await decrementStats(xpForTask('high', false));
                      }
                    }}
                  />
                ))}
              </View>
            ) : null}

            {incompleteTasks.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>To Do</Text>
                  <View style={styles.dragHint}>
                    <Ionicons name="reorder-three-outline" size={14} color={Colors.textTertiary} />
                    <Text style={styles.dragHintText}>Drag handle to reorder</Text>
                  </View>
                </View>
                <SortableList
                  data={incompleteTasks}
                  keyExtractor={(item) => item.id}
                  onReorder={handleReorderTasks}
                  renderItem={({ item, isActive }) => (
                    <TaskCard
                      task={item}
                      onToggle={handleToggleTask}
                      onResize={handleOpenResizer}
                      onEdit={handleOpenEdit}
                      onBlockerTap={setBlockerTask}
                      isDragging={isActive}
                    />
                  )}
                />
              </View>
            ) : allCompleted.length === 0 && incompleteCalEvents.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="flag-outline" size={40} color={Colors.borderLight} />
                <Text style={styles.emptyStateTitle}>No tasks yet</Text>
                <Text style={styles.emptyStateText}>
                  Head to the Goals tab to set your first goal, then tap the AI button to generate your daily plan.
                </Text>
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
                          await saveCompletedCalendarId(id, done);
                          if (!done) await decrementStats(xpForTask('high', false));
                        }
                      : handleToggleTask}
                    onResize={task.category !== 'calendar' ? handleOpenResizer : undefined}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <TimelineView
            tasks={[...calendarEvents, ...plan.tasks]}
            onToggle={async (id, done) => {
              if (id.startsWith('cal-')) {
                const updated = calendarEvents.map(e => e.id === id ? { ...e, completed: done } : e);
                setCalendarEvents(updated);
                await saveCompletedCalendarId(id, done);
                if (done) {
                  incrementStats('high', false).then(({ xpEarned: earned }) => {
                    showXpToast(earned);
                    awardBadge('calendar_pro');
                  });
                } else {
                  decrementStats(xpForTask('high', false));
                }
              } else {
                handleToggleTask(id, done);
              }
            }}
          />
        )}
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
      <JustOneThingModal
        visible={jotVisible}
        task={jotTask}
        onClose={() => setJotVisible(false)}
        onComplete={handleToggleTask}
        onPickAnother={handleJotPickAnother}
      />
      <BrainDumpModal
        visible={brainDumpVisible}
        onClose={() => setBrainDumpVisible(false)}
        onSaveToToday={handleSaveToToday}
        onSaveToInbox={handleSaveToInbox}
      />

      <EnergyCheckIn
        visible={energyCheckInVisible}
        onComplete={(checkin) => {
          setEnergyCheckInVisible(false);
          setEnergyCheckin(checkin);
        }}
      />

      <TaskEditSheet
        task={editingTask}
        visible={editSheetVisible}
        onClose={() => { setEditSheetVisible(false); setEditingTask(null); }}
        onSave={handleSaveEdit}
        onDelete={handleDeleteTask}
      />

      <BlockerModal
        visible={blockerTask !== null}
        task={blockerTask}
        onClose={() => setBlockerTask(null)}
        onSolved={handleBlockerSolved}
      />

      <Pressable
        style={[styles.fab, { bottom: (Platform.OS === 'web' ? 34 : 0) + 90 }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setBrainDumpVisible(true);
        }}
      >
        <Ionicons name="create-outline" size={24} color={Colors.white} />
      </Pressable>
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
  coachNoteCard: {
    backgroundColor: '#F5F3FF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDE9FE',
  },
  coachNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  coachNoteLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  coachNoteText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#4C1D95',
    lineHeight: 20,
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
  headerDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  energyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: Colors.primary + '15',
  },
  energyPillLow: {
    backgroundColor: '#F3F4F6',
  },
  energyPillText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  lowEnergyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  lowEnergyText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#4B5563',
    lineHeight: 18,
  },
  undoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  undoBannerMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  undoBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#fff',
  },
  undoBannerDismiss: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  focusToolsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  focusTool: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    gap: 4,
  },
  focusToolIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  focusToolLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    textAlign: 'center',
  },
  focusToolSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  focusToolDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },
  syncButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxSection: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inboxSectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inboxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  inboxItemText: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    marginRight: 12,
  },
  inboxActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inboxAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoteAction: {
    backgroundColor: Colors.primary,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dragHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dragHintText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  dragPlaceholder: {
    height: 72,
    borderRadius: 16,
    backgroundColor: Colors.borderLight,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  jotSmallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
  },
  jotSmallButtonText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyStateTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
