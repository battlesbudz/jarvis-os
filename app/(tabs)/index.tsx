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
  getGoals,
  getTodayKey,
  type Goal,
  type Task,
  type DayPlan,
} from '@/lib/storage';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { authFetch } from '@/lib/auth-context';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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
  content: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Panel Shell
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Task row (for TODAY panel)
// ─────────────────────────────────────────────────────────────────────────────

function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const color = getCategoryColor(task.category);
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
        </View>
      </View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modals
// ─────────────────────────────────────────────────────────────────────────────

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
          <Text style={[styles.modalTitle, { color: accent }]}>{title}</Text>
          <Pressable onPress={onClose} style={styles.modalClose}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

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

  // ── Modal visibility ──
  const [tasksModal, setTasksModal] = useState(false);
  const [inboxModal, setInboxModal] = useState(false);
  const [deliverablesModal, setDeliverablesModal] = useState(false);
  const [memoriesModal, setMemoriesModal] = useState(false);
  const [docsModal, setDocsModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [newTaskModal, setNewTaskModal] = useState(false);

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

    const [inboxRes, delRes, memRes, docRes, schedRes] = await Promise.allSettled([
      apiRequest('GET', '/api/inbox/items').then(r => r.json()),
      apiRequest('GET', '/api/deliverables').then(r => r.json()),
      authFetch(new URL('/api/memories', getApiUrl()).toString()).then(r => r.json()),
      authFetch(new URL('/api/documents', getApiUrl()).toString()).then(r => r.json()),
      apiRequest('GET', '/api/jarvis/scheduled-tasks').then(r => r.json()),
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

  // ── Dismiss inbox item ──
  const handleDismissInbox = useCallback(async (item: InboxItem) => {
    try {
      await apiRequest('POST', `/api/inbox/items/${item.id}/action`, { actionType: 'dismiss' });
      setInboxItems(prev => prev.filter(i => i.id !== item.id));
    } catch {}
  }, []);

  // ── Computed ──
  const todayTasks = plan?.tasks ?? [];
  const completedCount = todayTasks.filter(t => t.completed).length;
  const totalCount = todayTasks.length;
  const completionPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const pendingScheduled = scheduledTasks.filter(t => !t.completedAt);

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
          <View key={c.label} style={[styles.pill, c.connected ? { borderColor: c.color + '60', backgroundColor: c.color + '15' } : styles.pillOff]}>
            <View style={[styles.pillDot, { backgroundColor: c.connected ? c.color : Colors.textTertiary }]} />
            <Text style={[styles.pillText, { color: c.connected ? c.color : Colors.textTertiary }]}>{c.label}</Text>
          </View>
        ))}
        <Pressable style={styles.pillSettings} onPress={() => router.push('/(tabs)/settings')}>
          <Ionicons name="settings-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.pillSettingsText}>Connections</Text>
        </Pressable>
      </ScrollView>

      {/* ── Panels ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.cyan} />}
        showsVerticalScrollIndicator={false}
      >
        {/* SCHEDULE */}
        <Animated.View entering={FadeInDown.delay(0).duration(400)}>
          <Panel
            title="SCHEDULE"
            icon="calendar-outline"
            accent={Colors.cyan}
            count={pendingScheduled.length}
            loading={scheduledLoading}
            onViewAll={() => setScheduleModal(true)}
            onAdd={() => setNewTaskModal(true)}
          >
            {pendingScheduled.length === 0 ? (
              <Text style={styles.emptyText}>No upcoming scheduled tasks. Ask Jarvis to schedule something for you.</Text>
            ) : (
              pendingScheduled.slice(0, 4).map(t => (
                <View key={t.id} style={styles.scheduleRow}>
                  <View style={[styles.scheduleIcon, { backgroundColor: isOverdue(t.scheduledAt) ? Colors.errorDim : Colors.cyanDim }]}>
                    <Ionicons name="time-outline" size={14} color={isOverdue(t.scheduledAt) ? Colors.error : Colors.cyan} />
                  </View>
                  <View style={styles.scheduleContent}>
                    <Text style={styles.scheduleTitle} numberOfLines={1}>{t.title}</Text>
                    <Text style={[styles.scheduleWhen, isOverdue(t.scheduledAt) && { color: Colors.error }]}>
                      {formatScheduledAt(t.scheduledAt)}
                      {t.recurrence ? ` · ${t.recurrence}` : ''}
                    </Text>
                  </View>
                </View>
              ))
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
                {todayTasks.slice(0, 4).map((t, i) => (
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
                    {item.jarvisReason && <Text style={styles.inboxReason} numberOfLines={2}>{item.jarvisReason}</Text>}
                  </View>
                  <Pressable onPress={() => handleDismissInbox(item)} style={styles.inboxDismiss}>
                    <Ionicons name="close" size={16} color={Colors.textTertiary} />
                  </Pressable>
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
            count={deliverables.filter(d => d.status === 'pending').length}
            loading={deliverablesLoading}
            onViewAll={() => setDeliverablesModal(true)}
          >
            {deliverables.length === 0 ? (
              <Text style={styles.emptyText}>No pending deliverables. Ask Jarvis to draft emails, plans, or summaries.</Text>
            ) : (
              deliverables.slice(0, 3).map(d => (
                <View key={d.id} style={styles.deliverableRow}>
                  <View style={[styles.typeBadge, { backgroundColor: Colors.violetDim }]}>
                    <Text style={[styles.typeBadgeText, { color: Colors.violet }]}>{d.type?.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.deliverableTitle} numberOfLines={1}>{d.title}</Text>
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
                <View key={doc.id} style={styles.docRow}>
                  <Ionicons name="document-outline" size={14} color={Colors.cyan} />
                  <Text style={styles.docName} numberOfLines={1}>{doc.name}</Text>
                  <View style={[styles.docStatus, { backgroundColor: doc.status === 'ready' ? Colors.successDim : Colors.warningDim }]}>
                    <Text style={[styles.docStatusText, { color: doc.status === 'ready' ? Colors.success : Colors.warning }]}>
                      {doc.status}
                    </Text>
                  </View>
                </View>
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
        <View style={[styles.formModal, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.formModalHandle} />
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

      {/* Schedule Modal (all tasks) */}
      <FullModal visible={scheduleModal} title="SCHEDULE" accent={Colors.cyan} onClose={() => setScheduleModal(false)}>
        {scheduledTasks.length === 0 ? (
          <Text style={[styles.emptyText, { margin: 24 }]}>No scheduled tasks. Ask Jarvis to schedule something, or tap + above.</Text>
        ) : (
          scheduledTasks.map(t => (
            <View key={t.id} style={[styles.modalItemRow, { borderLeftColor: isOverdue(t.scheduledAt) && !t.completedAt ? Colors.error : Colors.cyan }]}>
              <View style={styles.modalItemContent}>
                <Text style={styles.modalItemTitle}>{t.title}</Text>
                {t.description && <Text style={styles.modalItemSub}>{t.description}</Text>}
                <Text style={[styles.modalItemMeta, isOverdue(t.scheduledAt) && !t.completedAt && { color: Colors.error }]}>
                  {formatScheduledAt(t.scheduledAt)}
                  {t.recurrence ? ` · ${t.recurrence}` : ''}
                  {t.completedAt ? ' · ✓ done' : ''}
                </Text>
              </View>
              {!t.completedAt && (
                <Pressable onPress={() => handleDeleteScheduledTask(t.id)} style={styles.modalItemDelete}>
                  <Ionicons name="trash-outline" size={16} color={Colors.error} />
                </Pressable>
              )}
            </View>
          ))
        )}
      </FullModal>

      {/* Today tasks modal */}
      <FullModal visible={tasksModal} title="TODAY'S TASKS" accent={Colors.violet} onClose={() => setTasksModal(false)}>
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
                <Text style={styles.modalItemMeta}>
                  {t.category}{t.time ? ` · ${t.time}` : ''}{t.duration ? ` · ${t.duration}min` : ''}
                </Text>
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
              </View>
              <Pressable onPress={() => handleDismissInbox(item)} style={styles.modalItemDelete}>
                <Ionicons name="close-circle-outline" size={18} color={Colors.textTertiary} />
              </Pressable>
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
                {d.content && <Text style={styles.modalItemSub} numberOfLines={4}>{d.content}</Text>}
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
      <FullModal visible={memoriesModal} title="MEMORY" accent={Colors.violet} onClose={() => setMemoriesModal(false)}>
        {memories.length === 0 ? (
          <Text style={[styles.emptyText, { margin: 24 }]}>No memories yet. Jarvis learns from your conversations.</Text>
        ) : (
          memories.map(m => (
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
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 2,
  },
  modalClose: {
    padding: 4,
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
});
