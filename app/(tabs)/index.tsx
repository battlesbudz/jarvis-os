import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  Modal,
  FlatList,
  TextInput,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import {
  getTodayPlan,
  updateTaskCompletion,
  updateTask,
  getGoals,
  getTodayKey,
  type Goal,
  type Task,
  type DayPlan,
} from '@/lib/storage';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { authFetch } from '@/lib/auth-context';
import BrainDumpModal from '@/components/BrainDumpModal';
import BlockerModal from '@/components/BlockerModal';

// Types

interface InboxItem {
  id: string;
  itemType: string;
  subject: string | null;
  sender: string | null;
  jarvisReason: string | null;
  surfacedAt: string;
  status: string;
}

interface Deliverable {
  id: string;
  type: string;
  title: string;
  summary?: string;
  body: string;
  status: string;
  createdAt: string;
}

interface Memory {
  id: string;
  content: string;
  category: string;
  extractedAt: string;
}

interface UserDocument {
  id: string;
  name: string;
  mimeType: string;
  status: string;
  uploadedAt: string;
}

interface ScheduledTask {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  recurrence: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  source: 'google' | 'outlook';
}

interface SystemTask {
  id: string;
  type: string;
  label: string;
  icon: string;
  timeLabel: string;
  dayLabel: string;
  hour: number;
  minute: number;
  recurrence: string;
  dayOfWeek: number | null;
  isSystem: true;
}

// Helpers

function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatClockTime(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
}

function formatScheduledAt(dt: string) {
  const d = new Date(dt);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isPast = d < now;
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today ${timeStr}`;
  if (isPast) return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${timeStr}`;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ` ${timeStr}`;
}

function isOverdue(dt: string) {
  return new Date(dt) < new Date();
}

function getCategoryColor(cat: string) {
  const map: Record<string, string> = {
    work: Colors.cyan,
    health: Colors.success,
    personal: Colors.violet,
    learning: '#F59E0B',
    finance: '#10B981',
    calendar: Colors.cyan,
  };
  return map[cat?.toLowerCase()] ?? Colors.textSecondary;
}

// Panel Shell

interface PanelProps {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  count?: number;
  loading?: boolean;
  onViewAll?: () => void;
  onAdd?: () => void;
  children: React.ReactNode;
}

function Panel({ title, icon, accent, count, loading, onViewAll, onAdd, children }: PanelProps) {
  return (
    <View style={[styles.panel, { borderLeftColor: accent }]}>
      <View style={styles.panelHeader}>
        <View style={styles.panelHeaderLeft}>
          <Ionicons name={icon} size={14} color={accent} />
          <Text style={[styles.panelTitle, { color: accent }]}>{title}</Text>
          {count !== undefined && count > 0 && (
            <View style={[styles.countBadge, { backgroundColor: accent + '25' }]}>
              <Text style={[styles.countBadgeText, { color: accent }]}>{count}</Text>
            </View>
          )}
        </View>
        <View style={styles.panelHeaderRight}>
          {onAdd && (
            <Pressable onPress={onAdd} style={styles.panelAddBtn}>
              <Ionicons name="add" size={16} color={accent} />
            </Pressable>
          )}
          {onViewAll && (
            <Pressable onPress={onViewAll} style={styles.panelViewAll}>
              <Text style={[styles.panelViewAllText, { color: accent }]}>ALL</Text>
              <Ionicons name="chevron-forward" size={11} color={accent} />
            </Pressable>
          )}
        </View>
      </View>
      <View style={styles.panelBody}>
        {loading ? (
          <ActivityIndicator size="small" color={accent} style={{ margin: 12 }} />
        ) : children}
      </View>
    </View>
  );
}

// Task row (for TODAY panel)

const PRIORITY_COLOR: Record<string, string> = { high: Colors.error, medium: Colors.warning, low: Colors.textTertiary };

function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const color = getCategoryColor(task.category);
  const priorityColor = PRIORITY_COLOR[task.priority] ?? Colors.textTertiary;
  return (
    <Pressable style={styles.taskRow} onPress={onToggle}>
      <View style={[styles.taskCheck, task.completed && { backgroundColor: color, borderColor: color }]}>
        {task.completed && <Ionicons name="checkmark" size={10} color="#000" />}
      </View>
      <View style={styles.taskContent}>
        <Text style={[styles.taskTitle, task.completed && styles.taskDone]} numberOfLines={1}>
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          {task.time && <Text style={styles.taskMetaText}>{task.time}</Text>}
          <View style={[styles.catDot, { backgroundColor: color }]} />
          <Text style={[styles.taskMetaText, { color }]}>{task.category}</Text>
          <View style={[styles.catDot, { backgroundColor: priorityColor }]} />
          <Text style={[styles.taskMetaText, { color: priorityColor }]}>{task.priority}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// Modals

function FullModal({ visible, title, accent, onClose, children }: {
  visible: boolean;
  title: string;
  accent: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
        <View style={[styles.modalHeader, { borderBottomColor: accent + '30' }]}>
          <Pressable onPress={onClose} style={styles.modalBackBtn}>
            <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
            <Text style={styles.modalBackText}>Back</Text>
          </Pressable>
          <Text style={[styles.modalTitle, { color: accent }]}>{title}</Text>
          <View style={styles.modalHeaderSpacer} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

// Main Screen

export default function MissionControlScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = useLiveClock();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  // ── Today's Tasks (local storage) ──
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Connection Status ──
  const [oauthStatus, setOAuthStatus] = useState<{
    google: { connected: boolean };
    microsoft: { connected: boolean };
    slack: { connected: boolean };
  }>({ google: { connected: false }, microsoft: { connected: false }, slack: { connected: false } });
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [discordConnected, setDiscordConnected] = useState(false);

  // ── API Data ──
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [deliverablesLoading, setDeliverablesLoading] = useState(true);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(true);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [systemSchedule, setSystemSchedule] = useState<SystemTask[]>([]);

  const [memorySearch, setMemorySearch] = useState('');

  const [tasksModal, setTasksModal] = useState(false);
  const [inboxModal, setInboxModal] = useState(false);
  const [deliverablesModal, setDeliverablesModal] = useState(false);
  const [memoriesModal, setMemoriesModal] = useState(false);
  const [docsModal, setDocsModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [newTaskModal, setNewTaskModal] = useState(false);
  const [brainDumpModal, setBrainDumpModal] = useState(false);
  const [blockerModal, setBlockerModal] = useState(false);
  const [blockerTask, setBlockerTask] = useState<Task | null>(null);
  const [editTaskModal, setEditTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [breakingDown, setBreakingDown] = useState(false);

  // ── Add Scheduled Task form ──
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newRecurrence, setNewRecurrence] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  // ── Load local data ──
  const loadLocal = useCallback(async () => {
    setTasksLoading(true);
    const g = await getGoals();
    setGoals(g);
    const p = await getTodayPlan(g);
    setPlan(p);
    setTasksLoading(false);
  }, []);

  // ── Load API data ──
  const loadApi = useCallback(async () => {
    try {
      const [oauthRes, telegramRes, discordRes] = await Promise.all([
        apiRequest('GET', '/api/oauth/status').then(r => r.json()).catch(() => null),
        apiRequest('GET', '/api/telegram/status').then(r => r.json()).catch(() => null),
        apiRequest('GET', '/api/discord/status').then(r => r.json()).catch(() => null),
      ]);
      if (oauthRes) setOAuthStatus({
        google: oauthRes.google ?? { connected: false },
        microsoft: oauthRes.microsoft ?? { connected: false },
        slack: oauthRes.slack ?? { connected: false },
      });
      setTelegramConnected(telegramRes?.connected ?? false);
      setDiscordConnected(discordRes?.connected ?? false);
    } catch {}

    const weekStart = new Date().toISOString();
    const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const calParams = `?startTime=${encodeURIComponent(weekStart)}&endTime=${encodeURIComponent(weekEnd)}`;
    const [inboxRes, delRes, memRes, docRes, schedRes, gcalRes, ocalRes, sysSchedRes] = await Promise.allSettled([
      apiRequest('GET', '/api/inbox/items').then(r => r.json()),
      apiRequest('GET', '/api/deliverables').then(r => r.json()),
      authFetch(new URL('/api/memories', getApiUrl()).toString()).then(r => r.json()),
      authFetch(new URL('/api/documents', getApiUrl()).toString()).then(r => r.json()),
      apiRequest('GET', '/api/jarvis/scheduled-tasks').then(r => r.json()),
      apiRequest('GET', `/api/calendar/google/events${calParams}`).then(r => r.json()).catch(() => null),
      apiRequest('GET', `/api/calendar/outlook/events${calParams}`).then(r => r.json()).catch(() => null),
      apiRequest('GET', '/api/jarvis/system-schedule').then(r => r.json()).catch(() => null),
    ]);

    if (inboxRes.status === 'fulfilled' && Array.isArray(inboxRes.value)) {
      setInboxItems(inboxRes.value);
    }
    setInboxLoading(false);

    if (delRes.status === 'fulfilled' && Array.isArray(delRes.value)) {
      setDeliverables(delRes.value);
    }
    setDeliverablesLoading(false);

    if (memRes.status === 'fulfilled' && memRes.value?.memories) {
      setMemories(memRes.value.memories);
    }
    setMemoriesLoading(false);

    if (docRes.status === 'fulfilled' && Array.isArray(docRes.value)) {
      setDocuments(docRes.value);
    } else if (docRes.status === 'fulfilled' && docRes.value?.documents) {
      setDocuments(docRes.value.documents);
    }
    setDocumentsLoading(false);

    if (schedRes.status === 'fulfilled' && Array.isArray(schedRes.value)) {
      setScheduledTasks(schedRes.value);
    }
    setScheduledLoading(false);

    if (sysSchedRes.status === 'fulfilled' && Array.isArray(sysSchedRes.value)) {
      setSystemSchedule(sysSchedRes.value as SystemTask[]);
    }

    const merged: CalendarEvent[] = [];
    if (gcalRes.status === 'fulfilled' && gcalRes.value?.events) {
      gcalRes.value.events.forEach((e: any) => merged.push({ id: e.id ?? e.title, title: e.title, start: e.start, end: e.end, description: e.description, source: 'google' }));
    }
    if (ocalRes.status === 'fulfilled' && ocalRes.value?.events) {
      ocalRes.value.events.forEach((e: any) => merged.push({ id: e.id ?? e.title, title: e.title, start: e.start, end: e.end, description: e.description, source: 'outlook' }));
    }
    merged.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    setCalendarEvents(merged);
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadLocal(), loadApi()]);
  }, [loadLocal, loadApi]);

  useFocusEffect(useCallback(() => {
    loadAll();
  }, [loadAll]));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  // ── Toggle task completion ──
  const handleToggleTask = useCallback(async (task: Task, idx: number) => {
    if (!plan) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newCompleted = !task.completed;
    // Optimistic local update
    setPlan(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map(t => t.id === task.id ? { ...t, completed: newCompleted } : t),
      };
    });
    await updateTaskCompletion(getTodayKey(), task.id, newCompleted);
  }, [plan]);

  // ── Create scheduled task ──
  const handleCreateScheduledTask = useCallback(async () => {
    if (!newTitle.trim() || !newDate.trim()) return;
    setSavingTask(true);
    try {
      const d = new Date(newDate.trim());
      if (isNaN(d.getTime())) {
        Alert.alert('Invalid date', 'Please enter a valid date/time.');
        setSavingTask(false);
        return;
      }
      const res = await apiRequest('POST', '/api/jarvis/scheduled-tasks', {
        title: newTitle.trim(),
        scheduledAt: d.toISOString(),
        recurrence: newRecurrence.trim() || undefined,
      });
      const task = await res.json();
      setScheduledTasks(prev => [...prev, task]);
      setNewTitle('');
      setNewDate('');
      setNewRecurrence('');
      setNewTaskModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Could not create scheduled task.');
    }
    setSavingTask(false);
  }, [newTitle, newDate, newRecurrence]);

  // ── Delete scheduled task ──
  const handleDeleteScheduledTask = useCallback(async (id: string) => {
    try {
      await apiRequest('DELETE', `/api/jarvis/scheduled-tasks/${id}`);
      setScheduledTasks(prev => prev.filter(t => t.id !== id));
    } catch {}
  }, []);

  const handleDismissInbox = useCallback(async (item: InboxItem) => {
    try {
      await apiRequest('POST', `/api/inbox/items/${item.id}/action`, { actionType: 'dismiss' });
      setInboxItems(prev => prev.filter(i => i.id !== item.id));
    } catch {}
  }, []);

  const [importantConfirmId, setImportantConfirmId] = useState<string | null>(null);
  const importantTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (importantTimerRef.current) clearTimeout(importantTimerRef.current);
    };
  }, []);
  const handleMarkImportant = useCallback(async (item: InboxItem) => {
    setImportantConfirmId(item.id);
    importantTimerRef.current = setTimeout(() => {
      setInboxItems(prev => prev.filter(i => i.id !== item.id));
      setImportantConfirmId(null);
      importantTimerRef.current = null;
    }, 1200);
    try {
      await apiRequest('POST', `/api/inbox/items/${item.id}/important`);
    } catch {
      if (importantTimerRef.current) {
        clearTimeout(importantTimerRef.current);
        importantTimerRef.current = null;
      }
      setInboxItems(prev => prev.some(i => i.id === item.id) ? prev : [item, ...prev]);
      setImportantConfirmId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, []);

  const handleReplyWithJarvis = useCallback((item: InboxItem) => {
    setInboxModal(false);
    router.push('/(tabs)/insights');
  }, [router]);

  const handleApproveDeliverable = useCallback(async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDeliverables(prev => prev.filter(d => d.id !== id));
    await apiRequest('POST', `/api/deliverables/${id}/approve`).catch(() => null);
  }, []);

  const handleDiscardDeliverable = useCallback(async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDeliverables(prev => prev.filter(d => d.id !== id));
    await apiRequest('POST', `/api/deliverables/${id}/discard`).catch(() => null);
  }, []);

  const openEditTask = useCallback((task: Task) => {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditDescription(task.description ?? '');
    setEditTaskModal(true);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingTask) return;
    const updated = { title: editTitle.trim() || editingTask.title, description: editDescription.trim() || undefined };
    setPlan(prev => {
      if (!prev) return prev;
      return { ...prev, tasks: prev.tasks.map(t => t.id === editingTask.id ? { ...t, ...updated } : t) };
    });
    setEditTaskModal(false);
    await updateTask(getTodayKey(), editingTask.id, updated);
  }, [editingTask, editTitle, editDescription]);

  const handleBreakDown = useCallback(async () => {
    if (!editingTask) return;
    setBreakingDown(true);
    try {
      const res = await apiRequest('POST', '/api/coach/break-down-task', {
        title: editingTask.title,
        description: editingTask.description,
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      const rawSubtasks: Array<{ title: string; category?: string; priority?: string }> = data.subtasks || [];
      if (rawSubtasks.length === 0) throw new Error('No subtasks returned');

      const validCategories = ['calendar', 'fitness', 'finance', 'career', 'personal', 'social'] as const;
      const validPriorities = ['high', 'medium', 'low'] as const;
      const newTasks: Task[] = rawSubtasks.map((s, i) => ({
        id: `${Date.now()}${Math.random().toString(36).substr(2, 6)}${i}`,
        title: s.title,
        category: (validCategories.includes(s.category as any) ? s.category : editingTask.category) as Task['category'],
        priority: (validPriorities.includes(s.priority as any) ? s.priority : 'medium') as Task['priority'],
        completed: false,
      }));

      setPlan(prev => {
        if (!prev) return prev;
        return { ...prev, tasks: prev.tasks.flatMap(t => t.id === editingTask.id ? newTasks : [t]) };
      });
      setEditTaskModal(false);

      const todayKey = getTodayKey();
      const planRes = await apiRequest('GET', `/api/data/plans/${todayKey}`);
      const planJson = await planRes.json();
      if (planJson.data) {
        const updatedTasks = (planJson.data.tasks as Task[]).flatMap((t: Task) =>
          t.id === editingTask.id ? newTasks : [t]
        );
        await apiRequest('PUT', `/api/data/plans/${todayKey}`, { data: { ...planJson.data, tasks: updatedTasks } });
      }
    } catch (e) {
      console.error('[BreakDown] failed:', e);
    }
    setBreakingDown(false);
  }, [editingTask]);

  // ── Computed ──
  const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const rawTodayTasks = plan?.tasks ?? [];
  const todayTasks = [...rawTodayTasks].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));
  const completedCount = todayTasks.filter(t => t.completed).length;
  const totalCount = todayTasks.length;
  const completionPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const pendingScheduled = scheduledTasks.filter(t => !t.completedAt);
  const filteredMemories = memorySearch.trim()
    ? memories.filter(m => m.content.toLowerCase().includes(memorySearch.toLowerCase()) || m.category.toLowerCase().includes(memorySearch.toLowerCase()))
    : memories;

  // ── Weekly calendar grouping (7 days starting today) ──
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekData = weekDays.map(day => {
    const dow = day.getDay();
    const dateStr = day.toISOString().split('T')[0];
    const sysTasks = systemSchedule.filter(s => s.recurrence === 'daily' || (s.recurrence === 'weekly' && s.dayOfWeek === dow));
    const calEvts = calendarEvents.filter(e => e.start.startsWith(dateStr));
    const jTasks = scheduledTasks.filter(t => t.scheduledAt.startsWith(dateStr));
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    return { day, dateStr, dow, sysTasks, calEvts, jTasks, isToday, dayName: DAY_NAMES[dow] };
  });
  // Today's combined schedule sorted by hour
  const todayData = weekData[0];
  const todayScheduleItems = [
    ...todayData.sysTasks.filter(s => s.hour >= 0).map(s => ({ hour: s.hour, minute: s.minute, kind: 'system' as const, data: s })),
    ...todayData.calEvts.map(e => ({ hour: new Date(e.start).getHours(), minute: new Date(e.start).getMinutes(), kind: 'calendar' as const, data: e })),
    ...todayData.jTasks.map(t => ({ hour: new Date(t.scheduledAt).getHours(), minute: new Date(t.scheduledAt).getMinutes(), kind: 'jarvis' as const, data: t })),
  ].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  // Connection pill statuses
  const connections = [
    { label: 'Google', connected: oauthStatus.google.connected, color: '#4285F4' },
    { label: 'Microsoft', connected: oauthStatus.microsoft.connected, color: '#0078D4' },
    { label: 'Slack', connected: oauthStatus.slack.connected, color: '#4A154B' },
    { label: 'Telegram', connected: telegramConnected, color: '#0088CC' },
    { label: 'Discord', connected: discordConnected, color: '#5865F2' },
  ];

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>{formatDate(now)}</Text>
          <Text style={styles.headerClock}>{formatClockTime(now)}</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.headerTitle}>MISSION{'\n'}CONTROL</Text>
        </View>
      </View>

      {/* ── Connection Pills ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow} contentContainerStyle={styles.pillRowContent}>
        {connections.map(c => (
          <Pressable key={c.label} onPress={() => router.push('/(tabs)/settings')} style={[styles.pill, c.connected ? { borderColor: c.color + '60', backgroundColor: c.color + '15' } : styles.pillOff]}>
            <View style={[styles.pillDot, { backgroundColor: c.connected ? c.color : Colors.textTertiary }]} />
            <Text style={[styles.pillText, { color: c.connected ? c.color : Colors.textTertiary }]}>{c.label}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.pillSettings} onPress={() => router.push('/(tabs)/settings')}>
          <Ionicons name="settings-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.pillSettingsText}>Manage</Text>
        </Pressable>
      </ScrollView>

      {/* ── Status line ── */}
      <View style={styles.statusLine}>
        <Text style={styles.statusLineText}>
          {totalCount - completedCount > 0 ? `${totalCount - completedCount} tasks left` : 'All tasks done'}
          {inboxItems.length > 0 ? `  ·  ${inboxItems.length} inbox` : ''}
          {pendingScheduled.length > 0 ? `  ·  ${pendingScheduled.length} scheduled` : ''}
        </Text>
      </View>

      {/* ── Panels ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.cyan} />}
        showsVerticalScrollIndicator={false}
      >
        {/* SCHEDULE — weekly calendar */}
        <Animated.View entering={FadeInDown.delay(0).duration(400)}>
          <Panel
            title="SCHEDULE"
            icon="calendar-outline"
            accent={Colors.cyan}
            count={todayScheduleItems.length}
            loading={scheduledLoading}
            onViewAll={() => setScheduleModal(true)}
            onAdd={() => setNewTaskModal(true)}
          >
            {/* Day strip */}
            <View style={styles.dayStrip}>
              {weekData.map(wd => (
                <View key={wd.dateStr} style={[styles.dayCell, wd.isToday && styles.dayCellToday]}>
                  <Text style={[styles.dayCellName, wd.isToday && { color: Colors.cyan }]}>{wd.dayName}</Text>
                  <Text style={[styles.dayCellNum, wd.isToday && { color: Colors.cyan }]}>{wd.day.getDate()}</Text>
                  {(wd.sysTasks.length + wd.calEvts.length + wd.jTasks.length) > 0 && (
                    <View style={[styles.dayCellDot, wd.isToday && { backgroundColor: Colors.cyan }]} />
                  )}
                </View>
              ))}
            </View>
            {/* Today's schedule items */}
            {todayScheduleItems.length === 0 ? (
              <Text style={styles.emptyText}>Nothing scheduled today. Ask Jarvis to schedule tasks, or view all to see the full week.</Text>
            ) : (
              todayScheduleItems.slice(0, 5).map((item, idx) => {
                if (item.kind === 'system') {
                  const s = item.data as SystemTask;
                  return (
                    <View key={s.id + idx} style={styles.scheduleRow}>
                      <View style={[styles.scheduleIcon, { backgroundColor: Colors.surfaceAlt }]}>
                        <Ionicons name={s.icon as any} size={13} color={Colors.cyan} />
                      </View>
                      <View style={styles.scheduleContent}>
                        <Text style={styles.scheduleTitle} numberOfLines={1}>{s.label}</Text>
                        <Text style={styles.scheduleWhen}>{s.timeLabel} · JARVIS</Text>
                      </View>
                    </View>
                  );
                }
                if (item.kind === 'calendar') {
                  const ev = item.data as CalendarEvent;
                  const evColor = ev.source === 'google' ? '#4285F4' : '#0078D4';
                  return (
                    <View key={ev.id + idx} style={styles.scheduleRow}>
                      <View style={[styles.scheduleIcon, { backgroundColor: evColor + '20' }]}>
                        <Ionicons name="calendar-outline" size={13} color={evColor} />
                      </View>
                      <View style={styles.scheduleContent}>
                        <Text style={styles.scheduleTitle} numberOfLines={1}>{ev.title}</Text>
                        <Text style={styles.scheduleWhen}>{formatScheduledAt(ev.start)} · {ev.source === 'google' ? 'Google' : 'Outlook'}</Text>
                      </View>
                    </View>
                  );
                }
                const jt = item.data as ScheduledTask;
                return (
                  <View key={jt.id + idx} style={styles.scheduleRow}>
                    <View style={[styles.scheduleIcon, { backgroundColor: isOverdue(jt.scheduledAt) ? Colors.errorDim : Colors.violetDim }]}>
                      <Ionicons name="sparkles-outline" size={13} color={isOverdue(jt.scheduledAt) ? Colors.error : Colors.violet} />
                    </View>
                    <View style={styles.scheduleContent}>
                      <Text style={styles.scheduleTitle} numberOfLines={1}>{jt.title}</Text>
                      <Text style={[styles.scheduleWhen, isOverdue(jt.scheduledAt) && { color: Colors.error }]}>
                        {formatScheduledAt(jt.scheduledAt)} · TASK
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </Panel>
        </Animated.View>

        {/* TODAY */}
        <Animated.View entering={FadeInDown.delay(60).duration(400)}>
          <Panel
            title="TODAY"
            icon="checkmark-circle-outline"
            accent={Colors.violet}
            count={totalCount - completedCount}
            loading={tasksLoading}
            onViewAll={() => setTasksModal(true)}
          >
            {goals.length > 0 && (
              <Pressable style={styles.goalsSummaryRow} onPress={() => setTasksModal(true)}>
                <Ionicons name="flag-outline" size={12} color={Colors.violet} />
                <Text style={styles.goalsSummaryText}>
                  {goals.length} active {goals.length === 1 ? 'goal' : 'goals'}
                </Text>
                <Text style={styles.goalsSummarySub}>Tap to manage day →</Text>
              </Pressable>
            )}
            {totalCount === 0 ? (
              <Text style={styles.emptyText}>No tasks for today. Ask Jarvis to build your day in the Jarvis tab.</Text>
            ) : (
              <>
                <View style={styles.progressRow}>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${completionPct}%`, backgroundColor: Colors.violet }]} />
                  </View>
                  <Text style={[styles.progressPct, { color: Colors.violet }]}>{completionPct}%</Text>
                </View>
                {todayTasks.slice(0, 5).map((t, i) => (
                  <TaskRow key={t.id} task={t} onToggle={() => handleToggleTask(t, i)} />
                ))}
              </>
            )}
          </Panel>
        </Animated.View>

        {/* INBOX */}
        <Animated.View entering={FadeInDown.delay(120).duration(400)}>
          <Panel
            title="INBOX"
            icon="mail-open-outline"
            accent={Colors.cyan}
            count={inboxItems.length}
            loading={inboxLoading}
            onViewAll={() => setInboxModal(true)}
          >
            {inboxItems.length === 0 ? (
              <Text style={styles.emptyText}>No flagged items. Jarvis will surface important emails here.</Text>
            ) : (
              inboxItems.slice(0, 3).map(item => (
                <View key={item.id} style={styles.inboxRow}>
                  <View style={styles.inboxDot} />
                  <View style={styles.inboxContent}>
                    <Text style={styles.inboxSubject} numberOfLines={1}>{item.subject ?? item.itemType}</Text>
                    {item.sender && <Text style={styles.inboxSender} numberOfLines={1}>{item.sender}</Text>}
                    {item.jarvisReason && <Text style={styles.inboxReason} numberOfLines={1}>{item.jarvisReason}</Text>}
                    <View style={styles.inboxInlineActions}>
                      <Pressable onPress={() => handleReplyWithJarvis(item)} style={styles.inboxInlineReply}>
                        <Ionicons name="chatbubble-outline" size={11} color={Colors.cyan} />
                        <Text style={styles.inboxInlineReplyText}>Reply</Text>
                      </Pressable>
                      <Pressable onPress={() => handleDismissInbox(item)} style={styles.inboxInlineDismiss}>
                        <Ionicons name="close" size={11} color={Colors.textTertiary} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))
            )}
          </Panel>
        </Animated.View>

        {/* DELIVERABLES */}
        <Animated.View entering={FadeInDown.delay(180).duration(400)}>
          <Panel
            title="DELIVERABLES"
            icon="document-text-outline"
            accent={Colors.violet}
            count={deliverables.length}
            loading={deliverablesLoading}
            onViewAll={() => setDeliverablesModal(true)}
          >
            {deliverables.length === 0 ? (
              <Text style={styles.emptyText}>No pending deliverables. Ask Jarvis to draft emails, plans, or summaries.</Text>
            ) : (
              deliverables.slice(0, 3).map(d => (
                <View key={d.id} style={styles.deliverableRow}>
                  <View style={styles.deliverableRowTop}>
                    <View style={[styles.typeBadge, { backgroundColor: Colors.violetDim }]}>
                      <Text style={[styles.typeBadgeText, { color: Colors.violet }]}>{d.type?.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.deliverableTitle} numberOfLines={1}>{d.title}</Text>
                  </View>
                  <View style={styles.deliverableInlineActions}>
                    <Pressable onPress={() => handleApproveDeliverable(d.id)} style={styles.deliverableApproveBtn}>
                      <Ionicons name="checkmark" size={11} color={Colors.success} />
                      <Text style={styles.deliverableApproveBtnText}>Approve</Text>
                    </Pressable>
                    <Pressable onPress={() => handleDiscardDeliverable(d.id)} style={styles.deliverableDiscardBtn}>
                      <Ionicons name="trash-outline" size={11} color={Colors.error} />
                      <Text style={styles.deliverableDiscardBtnText}>Discard</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </Panel>
        </Animated.View>

        {/* DOCS */}
        <Animated.View entering={FadeInDown.delay(240).duration(400)}>
          <Panel
            title="DOCS"
            icon="folder-open-outline"
            accent={Colors.cyan}
            count={documents.length}
            loading={documentsLoading}
            onViewAll={() => setDocsModal(true)}
          >
            {documents.length === 0 ? (
              <Text style={styles.emptyText}>No documents. Upload files for Jarvis to reference in conversations.</Text>
            ) : (
              documents.slice(0, 3).map(doc => (
                <Pressable key={doc.id} style={styles.docRow} onPress={() => setDocsModal(true)}>
                  <Ionicons name="document-outline" size={14} color={Colors.cyan} />
                  <Text style={styles.docName} numberOfLines={1}>{doc.name}</Text>
                  <View style={[styles.docStatus, { backgroundColor: doc.status === 'ready' ? Colors.successDim : Colors.warningDim }]}>
                    <Text style={[styles.docStatusText, { color: doc.status === 'ready' ? Colors.success : Colors.warning }]}>
                      {doc.status}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={12} color={Colors.textTertiary} />
                </Pressable>
              ))
            )}
          </Panel>
        </Animated.View>

        {/* MEMORY */}
        <Animated.View entering={FadeInDown.delay(300).duration(400)}>
          <Panel
            title="MEMORY"
            icon="bookmark-outline"
            accent={Colors.violet}
            count={memories.length}
            loading={memoriesLoading}
            onViewAll={() => setMemoriesModal(true)}
          >
            {memories.length === 0 ? (
              <Text style={styles.emptyText}>No memories yet. Jarvis learns about you from conversations.</Text>
            ) : (
              memories.slice(0, 3).map(m => (
                <View key={m.id} style={styles.memoryRow}>
                  <View style={[styles.catBadge, { backgroundColor: Colors.violetDim }]}>
                    <Text style={[styles.catBadgeText, { color: Colors.violet }]}>{m.category}</Text>
                  </View>
                  <Text style={styles.memoryText} numberOfLines={2}>{m.content}</Text>
                </View>
              ))
            )}
          </Panel>
        </Animated.View>
      </ScrollView>

      {/* ─────────── MODALS ─────────── */}

      {/* Add Scheduled Task Modal */}
      <Modal visible={newTaskModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setNewTaskModal(false)}>
        <View style={[styles.formModal, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.formBackRow}>
            <Pressable onPress={() => setNewTaskModal(false)} style={styles.modalBackBtn}>
              <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
              <Text style={styles.modalBackText}>Back</Text>
            </Pressable>
          </View>
          <Text style={styles.formModalTitle}>Schedule a Task</Text>
          <Text style={styles.formModalSub}>Jarvis will remind you and act on this when the time comes.</Text>
          <Text style={styles.formLabel}>What should Jarvis do?</Text>
          <TextInput
            style={styles.formInput}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="e.g. Review inbox, Weekly goal check-in..."
            placeholderTextColor={Colors.textTertiary}
            autoFocus
          />
          <Text style={styles.formLabel}>When?</Text>
          <TextInput
            style={styles.formInput}
            value={newDate}
            onChangeText={setNewDate}
            placeholder="e.g. 2025-12-01 09:00"
            placeholderTextColor={Colors.textTertiary}
          />
          <Text style={styles.formLabel}>Repeat? (optional)</Text>
          <TextInput
            style={styles.formInput}
            value={newRecurrence}
            onChangeText={setNewRecurrence}
            placeholder="e.g. every Monday, daily, weekdays"
            placeholderTextColor={Colors.textTertiary}
          />
          <View style={styles.formActions}>
            <Pressable style={styles.formCancel} onPress={() => setNewTaskModal(false)}>
              <Text style={styles.formCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.formSave, (!newTitle.trim() || !newDate.trim()) && styles.formSaveDisabled]}
              onPress={handleCreateScheduledTask}
              disabled={savingTask || !newTitle.trim() || !newDate.trim()}
            >
              {savingTask ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.formSaveText}>Schedule</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Schedule Modal — merged weekly calendar */}
      <FullModal visible={scheduleModal} title="WEEKLY SCHEDULE" accent={Colors.cyan} onClose={() => setScheduleModal(false)}>
        {weekData.map(wd => {
          const allItems = [
            ...wd.sysTasks.map(s => ({ kind: 'system' as const, data: s, hour: s.hour, minute: s.minute })),
            ...wd.calEvts.map(e => ({ kind: 'calendar' as const, data: e, hour: new Date(e.start).getHours(), minute: new Date(e.start).getMinutes() })),
            ...wd.jTasks.map(t => ({ kind: 'jarvis' as const, data: t, hour: new Date(t.scheduledAt).getHours(), minute: new Date(t.scheduledAt).getMinutes() })),
          ].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
          if (allItems.length === 0) return null;
          const dateLabel = `${wd.dayName} ${wd.day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
          return (
            <View key={wd.dateStr}>
              <Text style={[styles.modalSectionHeader, wd.isToday && { color: Colors.cyan }]}>
                {dateLabel.toUpperCase()}{wd.isToday ? '  — TODAY' : ''}
              </Text>
              {allItems.map((item, idx) => {
                if (item.kind === 'system') {
                  const s = item.data as SystemTask;
                  return (
                    <View key={s.id + idx} style={[styles.modalItemRow, { borderLeftColor: Colors.cyan }]}>
                      <View style={{ alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                        <Ionicons name={s.icon as any} size={14} color={Colors.cyan} />
                      </View>
                      <View style={styles.modalItemContent}>
                        <Text style={styles.modalItemTitle}>{s.label}</Text>
                        <Text style={styles.modalItemMeta}>{s.timeLabel} · {s.recurrence === 'weekly' ? `${s.dayLabel} recurring` : 'Daily recurring'} · JARVIS</Text>
                      </View>
                    </View>
                  );
                }
                if (item.kind === 'calendar') {
                  const ev = item.data as CalendarEvent;
                  const evColor = ev.source === 'google' ? '#4285F4' : '#0078D4';
                  return (
                    <View key={ev.id + idx} style={[styles.modalItemRow, { borderLeftColor: evColor }]}>
                      <View style={styles.modalItemContent}>
                        <Text style={styles.modalItemTitle}>{ev.title}</Text>
                        <Text style={styles.modalItemMeta}>{formatScheduledAt(ev.start)} · {ev.source === 'google' ? 'Google Calendar' : 'Outlook Calendar'}</Text>
                      </View>
                    </View>
                  );
                }
                const t = item.data as ScheduledTask;
                const done = !!t.completedAt;
                const overdue = !done && isOverdue(t.scheduledAt);
                const statusIcon = done ? 'checkmark-circle' : overdue ? 'warning' : 'sparkles-outline';
                const statusColor = done ? Colors.success : overdue ? Colors.error : Colors.violet;
                return (
                  <View key={t.id + idx} style={[styles.modalItemRow, { borderLeftColor: done ? Colors.success : overdue ? Colors.error : Colors.violet }]}>
                    <View style={{ alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                      <Ionicons name={statusIcon as any} size={14} color={statusColor} />
                    </View>
                    <View style={styles.modalItemContent}>
                      <Text style={[styles.modalItemTitle, done && { opacity: 0.5, textDecorationLine: 'line-through' }]}>{t.title}</Text>
                      {t.description && <Text style={styles.modalItemSub}>{t.description}</Text>}
                      <Text style={[styles.modalItemMeta, overdue && { color: Colors.error }]}>{formatScheduledAt(t.scheduledAt)}{t.recurrence ? ` · ${t.recurrence}` : ''} · TASK</Text>
                    </View>
                    {!done && (
                      <Pressable onPress={() => handleDeleteScheduledTask(t.id)} style={styles.modalItemDelete}>
                        <Ionicons name="trash-outline" size={15} color={Colors.error} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
        {weekData.every(wd => wd.sysTasks.length + wd.calEvts.length + wd.jTasks.length === 0) && (
          <Text style={[styles.emptyText, { margin: 24 }]}>Nothing scheduled this week. Ask Jarvis to schedule tasks, or connect Google/Outlook to see your events.</Text>
        )}
      </FullModal>

      {/* Today tasks modal */}
      <FullModal visible={tasksModal} title="TODAY'S TASKS" accent={Colors.violet} onClose={() => setTasksModal(false)}>
        <View style={styles.manageDayRow}>
          <Pressable style={styles.manageDayBtn} onPress={() => { setTasksModal(false); router.push('/(tabs)/insights'); }}>
            <Ionicons name="flash-outline" size={14} color={Colors.violet} />
            <Text style={styles.manageDayBtnText}>Rebuild Day with Jarvis</Text>
          </Pressable>
          <Pressable style={styles.manageDayBtn} onPress={() => { setTasksModal(false); setBrainDumpModal(true); }}>
            <Ionicons name="cloud-upload-outline" size={14} color={Colors.cyan} />
            <Text style={[styles.manageDayBtnText, { color: Colors.cyan }]}>Brain Dump</Text>
          </Pressable>
        </View>
        {goals.length > 0 && (
          <View style={styles.modalGoalsSummary}>
            <Text style={styles.modalSectionHeader}>ACTIVE GOALS</Text>
            {goals.map(g => (
              <Text key={g.id} style={styles.modalGoalItem} numberOfLines={1}>· {g.title}</Text>
            ))}
          </View>
        )}
        {todayTasks.length > 0 && (
          <Text style={[styles.modalSectionHeader, { marginTop: 8 }]}>TODAY</Text>
        )}
        {todayTasks.length === 0 ? (
          <Text style={[styles.emptyText, { margin: 24 }]}>No tasks. Ask Jarvis to build your day.</Text>
        ) : (
          todayTasks.map((t, i) => (
            <View key={t.id} style={[styles.modalItemRow, { borderLeftColor: getCategoryColor(t.category) }]}>
              <Pressable
                style={[styles.modalTaskCheck, t.completed && { backgroundColor: getCategoryColor(t.category) }]}
                onPress={() => handleToggleTask(t, i)}
              >
                {t.completed && <Ionicons name="checkmark" size={12} color="#000" />}
              </Pressable>
              <View style={styles.modalItemContent}>
                <Text style={[styles.modalItemTitle, t.completed && { opacity: 0.4, textDecorationLine: 'line-through' }]}>{t.title}</Text>
                {t.description && <Text style={styles.modalItemSub} numberOfLines={2}>{t.description}</Text>}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <Text style={styles.modalItemMeta}>{t.category}{t.time ? ` · ${t.time}` : ''}</Text>
                  <View style={[styles.catDot, { backgroundColor: PRIORITY_COLOR[t.priority] ?? Colors.textTertiary }]} />
                  <Text style={[styles.modalItemMeta, { color: PRIORITY_COLOR[t.priority] ?? Colors.textTertiary }]}>{t.priority}</Text>
                </View>
                {!t.completed && (
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                    <Pressable style={styles.taskActionBtn} onPress={() => openEditTask(t)}>
                      <Ionicons name="pencil-outline" size={10} color={Colors.violet} />
                      <Text style={[styles.taskActionBtnText, { color: Colors.violet }]}>Edit</Text>
                    </Pressable>
                    <Pressable style={styles.blockerBtn} onPress={() => { setBlockerTask(t); setBlockerModal(true); }}>
                      <Ionicons name="warning-outline" size={10} color={Colors.warning} />
                      <Text style={styles.blockerBtnText}>Report Blocker</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          ))
        )}
      </FullModal>

      {/* Inbox modal */}
      <FullModal visible={inboxModal} title="INBOX" accent={Colors.cyan} onClose={() => setInboxModal(false)}>
        {inboxItems.length === 0 ? (
          <Text style={[styles.emptyText, { margin: 24 }]}>No flagged inbox items.</Text>
        ) : (
          inboxItems.map(item => (
            <View key={item.id} style={[styles.modalItemRow, { borderLeftColor: Colors.cyan }]}>
              <View style={styles.modalItemContent}>
                <Text style={styles.modalItemTitle}>{item.subject ?? item.itemType}</Text>
                {item.sender && <Text style={styles.modalItemMeta}>{item.sender}</Text>}
                {item.jarvisReason && <Text style={styles.modalItemSub}>{item.jarvisReason}</Text>}
                {importantConfirmId === item.id ? (
                  <View style={styles.inboxActions}>
                    <Text style={styles.importantConfirmText}>Saved to memory ✓</Text>
                  </View>
                ) : (
                  <View style={styles.inboxActions}>
                    <Pressable style={styles.replyBtn} onPress={() => handleReplyWithJarvis(item)}>
                      <Ionicons name="chatbubble-outline" size={13} color={Colors.cyan} />
                      <Text style={styles.replyBtnText}>Reply with Jarvis</Text>
                    </Pressable>
                    <Pressable style={styles.importantBtn} onPress={() => handleMarkImportant(item)}>
                      <Ionicons name="star" size={13} color={Colors.warning} />
                      <Text style={styles.importantBtnText}>Important</Text>
                    </Pressable>
                    <Pressable style={styles.dismissBtn} onPress={() => handleDismissInbox(item)}>
                      <Ionicons name="close" size={13} color={Colors.textTertiary} />
                      <Text style={styles.dismissBtnText}>Dismiss</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          ))
        )}
      </FullModal>

      {/* Deliverables modal */}
      <FullModal visible={deliverablesModal} title="DELIVERABLES" accent={Colors.violet} onClose={() => setDeliverablesModal(false)}>
        {deliverables.length === 0 ? (
          <Text style={[styles.emptyText, { margin: 24 }]}>No pending deliverables.</Text>
        ) : (
          deliverables.map(d => (
            <View key={d.id} style={[styles.modalItemRow, { borderLeftColor: Colors.violet }]}>
              <View style={styles.modalItemContent}>
                <View style={[styles.typeBadge, { backgroundColor: Colors.violetDim, marginBottom: 6 }]}>
                  <Text style={[styles.typeBadgeText, { color: Colors.violet }]}>{d.type?.toUpperCase()}</Text>
                </View>
                <Text style={styles.modalItemTitle}>{d.title}</Text>
                {(d.summary || d.body) && <Text style={styles.modalItemSub} numberOfLines={4}>{d.summary ?? d.body}</Text>}
                <View style={styles.deliverableActions}>
                  <Pressable style={styles.approveBtn} onPress={() => handleApproveDeliverable(d.id)}>
                    <Ionicons name="checkmark" size={13} color={Colors.success} />
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </Pressable>
                  <Pressable style={styles.discardBtn} onPress={() => handleDiscardDeliverable(d.id)}>
                    <Ionicons name="trash-outline" size={13} color={Colors.error} />
                    <Text style={styles.discardBtnText}>Discard</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </FullModal>

      {/* Docs modal */}
      <FullModal visible={docsModal} title="DOCUMENTS" accent={Colors.cyan} onClose={() => setDocsModal(false)}>
        {documents.length === 0 ? (
          <Text style={[styles.emptyText, { margin: 24 }]}>No documents uploaded. Go to Settings to upload files.</Text>
        ) : (
          documents.map(doc => (
            <View key={doc.id} style={[styles.modalItemRow, { borderLeftColor: Colors.cyan }]}>
              <View style={styles.modalItemContent}>
                <Text style={styles.modalItemTitle}>{doc.name}</Text>
                <Text style={styles.modalItemMeta}>{doc.status} · {new Date(doc.uploadedAt).toLocaleDateString()}</Text>
              </View>
            </View>
          ))
        )}
      </FullModal>

      {/* Memory modal */}
      <FullModal visible={memoriesModal} title="MEMORY" accent={Colors.violet} onClose={() => { setMemoriesModal(false); setMemorySearch(''); }}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={16} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={memorySearch}
            onChangeText={setMemorySearch}
            placeholder="Search memories..."
            placeholderTextColor={Colors.textTertiary}
          />
          {memorySearch.length > 0 && (
            <Pressable onPress={() => setMemorySearch('')}>
              <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
            </Pressable>
          )}
        </View>
        {filteredMemories.length === 0 ? (
          <Text style={[styles.emptyText, { margin: 24 }]}>
            {memorySearch ? 'No memories match your search.' : 'No memories yet. Jarvis learns from your conversations.'}
          </Text>
        ) : (
          filteredMemories.map(m => (
            <View key={m.id} style={[styles.modalItemRow, { borderLeftColor: Colors.violet }]}>
              <View style={styles.modalItemContent}>
                <View style={[styles.catBadge, { backgroundColor: Colors.violetDim, marginBottom: 6 }]}>
                  <Text style={[styles.catBadgeText, { color: Colors.violet }]}>{m.category}</Text>
                </View>
                <Text style={styles.modalItemTitle}>{m.content}</Text>
                <Text style={styles.modalItemMeta}>{new Date(m.extractedAt).toLocaleDateString()}</Text>
              </View>
            </View>
          ))
        )}
      </FullModal>

      <BrainDumpModal
        visible={brainDumpModal}
        onClose={() => setBrainDumpModal(false)}
        onSaveToToday={async (_text) => { await loadApi(); }}
        onSaveToInbox={async (_text) => { await loadApi(); }}
      />
      <BlockerModal
        visible={blockerModal}
        task={blockerTask}
        onClose={() => { setBlockerModal(false); setBlockerTask(null); }}
        onSolved={(_task, _type, _suggestion) => {
          setBlockerModal(false);
          setBlockerTask(null);
          loadApi();
        }}
      />

      {/* Edit Task Modal */}
      <Modal visible={editTaskModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setEditTaskModal(false)}>
        <View style={styles.editModalRoot}>
          <View style={styles.editModalHeader}>
            <Pressable onPress={() => setEditTaskModal(false)} style={styles.modalBackBtn}>
              <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
              <Text style={styles.modalBackText}>Back</Text>
            </Pressable>
            <Text style={styles.editModalTitle}>EDIT TASK</Text>
            <View style={styles.modalHeaderSpacer} />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.editFieldLabel}>TITLE</Text>
            <TextInput
              style={styles.editInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Task title..."
              placeholderTextColor={Colors.textTertiary}
              multiline
            />
            <Text style={[styles.editFieldLabel, { marginTop: 16 }]}>NOTES (optional)</Text>
            <TextInput
              style={[styles.editInput, { minHeight: 80 }]}
              value={editDescription}
              onChangeText={setEditDescription}
              placeholder="Add notes or details..."
              placeholderTextColor={Colors.textTertiary}
              multiline
            />
            <Pressable style={styles.editSaveBtn} onPress={handleSaveEdit}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#000" />
              <Text style={styles.editSaveBtnText}>Save Changes</Text>
            </Pressable>
            <Pressable
              style={[styles.editBreakDownBtn, breakingDown && { opacity: 0.6 }]}
              onPress={handleBreakDown}
              disabled={breakingDown}
            >
              {breakingDown ? (
                <ActivityIndicator size="small" color={Colors.cyan} />
              ) : (
                <Ionicons name="git-branch-outline" size={16} color={Colors.cyan} />
              )}
              <Text style={styles.editBreakDownBtnText}>
                {breakingDown ? 'Breaking down...' : 'Break into Steps with Jarvis'}
              </Text>
            </Pressable>
            <Text style={styles.editHint}>Breaking into steps sends this task to Jarvis, who will split it into 3–5 simpler sub-tasks and update your plan automatically.</Text>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// Styles

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    letterSpacing: 1.5,
  },
  headerClock: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    color: Colors.cyan,
    letterSpacing: 2,
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.textTertiary,
    letterSpacing: 2.5,
    textAlign: 'right',
    lineHeight: 17,
  },
  pillRow: {
    flexGrow: 0,
    marginBottom: 4,
  },
  pillRowContent: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  pillOff: {
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
  },
  pillSettings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  pillSettingsText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 4,
    gap: 10,
  },
  // Panel
  panel: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    overflow: 'hidden',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  panelHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  panelTitle: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.8,
  },
  countBadge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  countBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  panelHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  panelAddBtn: {
    padding: 2,
  },
  panelViewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  panelViewAllText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
  },
  panelBody: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  emptyText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    lineHeight: 18,
    paddingVertical: 4,
  },
  // Schedule rows
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  scheduleIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleContent: {
    flex: 1,
  },
  scheduleTitle: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  scheduleWhen: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 1,
  },
  // Task rows
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  taskCheck: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  taskDone: {
    opacity: 0.4,
    textDecorationLine: 'line-through',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  taskMetaText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  catDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  // Progress bar
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  progressBar: {
    flex: 1,
    height: 3,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressPct: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    minWidth: 28,
    textAlign: 'right',
  },
  // Inbox rows
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  inboxDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.cyan,
    marginTop: 5,
  },
  inboxContent: {
    flex: 1,
    gap: 2,
  },
  inboxSubject: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  inboxSender: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  inboxReason: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.cyan,
    lineHeight: 15,
  },
  inboxDismiss: {
    padding: 2,
  },
  // Deliverable rows
  deliverableRow: {
    flexDirection: 'column',
    paddingVertical: 4,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  deliverableTitle: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  // Doc rows
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  docName: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  docStatus: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  docStatusText: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
  // Memory rows
  memoryRow: {
    paddingVertical: 4,
    gap: 4,
  },
  catBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  catBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  memoryText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  // Modals
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 4,
    minWidth: 64,
  },
  modalBackText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  modalHeaderSpacer: {
    minWidth: 64,
  },
  modalTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 2,
    flex: 1,
    textAlign: 'center',
  },
  modalClose: {
    padding: 4,
  },
  formBackRow: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  modalItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginVertical: 4,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderLeftWidth: 3,
    padding: 12,
    gap: 10,
  },
  modalItemContent: {
    flex: 1,
    gap: 3,
  },
  modalItemTitle: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
    lineHeight: 20,
  },
  modalItemSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },
  modalItemMeta: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 4,
  },
  modalItemDelete: {
    padding: 4,
  },
  modalTaskCheck: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  // Form modal
  formModal: {
    flex: 1,
    backgroundColor: Colors.bg,
    paddingHorizontal: 20,
  },
  formModalHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  formModalTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 4,
  },
  formModalSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 20,
    lineHeight: 19,
  },
  formLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 12,
  },
  formInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  formActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 28,
  },
  formCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  formCancelText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  formSave: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.cyan,
    alignItems: 'center',
  },
  formSaveDisabled: {
    opacity: 0.4,
  },
  formSaveText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#000',
  },
  goalsSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  goalsSummaryText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.violet,
    letterSpacing: 0.3,
  },
  goalsSummarySub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginLeft: 'auto',
  },
  modalSectionHeader: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: Colors.textTertiary,
    letterSpacing: 1.5,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  manageDayBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.violetDim,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.violet + '40',
  },
  manageDayBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.violet,
  },
  modalGoalsSummary: {
    marginTop: 4,
    marginBottom: 4,
  },
  modalGoalItem: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    paddingHorizontal: 20,
    paddingVertical: 2,
  },
  inboxActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  replyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: Colors.cyanDim,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.cyan + '40',
  },
  replyBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.cyan,
  },
  dismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dismissBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
  },
  importantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: Colors.warningDim,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
  },
  importantBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.warning,
  },
  importantConfirmText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.success,
    paddingVertical: 5,
  },
  blockerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  blockerBtnText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: Colors.warning,
  },
  deliverableActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  approveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: Colors.successDim,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.success + '40',
  },
  approveBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.success,
  },
  discardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: Colors.errorDim,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.error + '40',
  },
  discardBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.error,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  statusLine: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  statusLineText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    letterSpacing: 0.3,
  },
  inboxInlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  inboxInlineReply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: Colors.cyanDim,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.cyan + '30',
  },
  inboxInlineReplyText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.cyan,
  },
  inboxInlineDismiss: {
    padding: 4,
  },
  deliverableRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  deliverableInlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  deliverableApproveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: Colors.successDim,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.success + '30',
  },
  deliverableApproveBtnText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.success,
  },
  deliverableDiscardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: Colors.errorDim,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.error + '30',
  },
  deliverableDiscardBtnText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.error,
  },
  manageDayRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  dayStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginHorizontal: 0,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    gap: 2,
  },
  dayCellToday: {
    backgroundColor: Colors.cyan + '18',
  },
  dayCellName: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dayCellNum: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
  },
  dayCellDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.textTertiary,
    marginTop: 1,
  },
  taskActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: Colors.violetDim,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.violet + '30',
  },
  taskActionBtnText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.violet,
  },
  editModalRoot: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  editModalTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    letterSpacing: 1.5,
    flex: 1,
    textAlign: 'center',
  },
  editFieldLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  editInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 48,
    textAlignVertical: 'top',
  },
  editSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.cyan,
    borderRadius: 10,
    paddingVertical: 13,
    marginTop: 24,
  },
  editSaveBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#000',
    letterSpacing: 0.3,
  },
  editBreakDownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.cyanDim,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.cyan + '40',
    paddingVertical: 13,
    marginTop: 10,
  },
  editBreakDownBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.cyan,
    letterSpacing: 0.3,
  },
  editHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
  },
});
