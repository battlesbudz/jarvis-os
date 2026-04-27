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
  Alert,
  DimensionValue,
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
import AsyncStorage from '@react-native-async-storage/async-storage';

// Types

interface InboxItem {
  id: string;
  itemType: string;
  sourceType: string;
  subject: string | null;
  sender: string | null;
  jarvisReason: string | null;
  surfacedAt: string;
  status: string;
}

function getInboxSourceIcon(sourceType: string): { icon: keyof typeof Ionicons.glyphMap; color: string } {
  switch (sourceType) {
    case 'email':
    case 'gmail':
      return { icon: 'mail', color: '#EA4335' };
    case 'google_calendar':
      return { icon: 'calendar', color: Colors.primary };
    case 'outlook_calendar':
      return { icon: 'calendar', color: '#0078D4' };
    case 'calendar':
      return { icon: 'calendar', color: Colors.primary };
    case 'outlook':
    case 'outlook_email':
      return { icon: 'mail', color: '#0078D4' };
    case 'telegram':
      return { icon: 'paper-plane', color: '#2AABEE' };
    default:
      return { icon: 'notifications-outline', color: Colors.textSecondary };
  }
}

function getInboxSourceLabel(sourceType: string): string {
  switch (sourceType) {
    case 'email':
    case 'gmail':
      return 'Gmail';
    case 'google_calendar':
      return 'Google Cal';
    case 'outlook_calendar':
      return 'Outlook Cal';
    case 'calendar':
      return 'Calendar';
    case 'outlook':
    case 'outlook_email':
      return 'Outlook Mail';
    case 'telegram':
      return 'Telegram';
    default:
      return sourceType || 'Inbox';
  }
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

interface Prediction {
  id: string;
  predictionType: 'energy_dip' | 'procrastination_risk' | 'email_overdue' | 'project_stall';
  targetDatetime: string;
  targetDate: string;
  confidenceScore: number;
  basisSummary: string;
  humanReadable: string;
  actionSuggestion: string | null;
  observationCount: number;
  validated: boolean | null;
  createdAt: string;
}

interface Memory {
  id: string;
  content: string;
  category: string;
  extractedAt: string;
  relevanceScore?: number;
  lastReferencedAt?: string | null;
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

function getEmotionalColor(label: string): string {
  switch (label) {
    case 'overwhelmed': return '#EF4444';
    case 'stressed': return '#F97316';
    case 'calm': return '#6B7280';
    case 'focused': return '#8B5CF6';
    case 'in flow': return '#06B6D4';
    default: return '#6B7280';
  }
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

// ── Prediction Card ────────────────────────────────────────────────────────
const PREDICTION_TYPE_CONFIG = {
  energy_dip: { icon: 'flash-outline' as const, color: '#f39c12', label: 'ENERGY DIP' },
  procrastination_risk: { icon: 'warning-outline' as const, color: '#e74c3c', label: 'PROCRASTINATION RISK' },
  email_overdue: { icon: 'mail-outline' as const, color: '#3498db', label: 'EMAIL OVERDUE' },
  project_stall: { icon: 'trending-down-outline' as const, color: '#e67e22', label: 'PROJECT STALL' },
} as const;

function PredictionCard({ pred, compact = false }: { pred: Prediction; compact?: boolean }) {
  const typeConfig = PREDICTION_TYPE_CONFIG[pred.predictionType]
    ?? { icon: 'information-circle-outline' as const, color: '#9b59b6', label: 'PREDICTION' };
  const obsText = pred.observationCount > 0
    ? `${pred.observationCount} obs`
    : null;
  const dateLabel = compact ? ` · ${new Date(pred.targetDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : '';

  return (
    <View style={styles.predictionCard}>
      <View style={[styles.predictionIconWrap, { backgroundColor: typeConfig.color + '20' }]}>
        <Ionicons name={typeConfig.icon} size={14} color={typeConfig.color} />
      </View>
      <View style={styles.predictionContent}>
        <Text style={[styles.predictionTypeLabel, { color: typeConfig.color }]}>
          {typeConfig.label}{dateLabel}
        </Text>
        <Text style={styles.predictionText}>{pred.humanReadable}</Text>
        {!compact && pred.actionSuggestion && (
          <Text style={styles.predictionAction}>→ {pred.actionSuggestion}</Text>
        )}
        <View style={styles.predictionMeta}>
          <View style={styles.predictionConfBar}>
            <View style={[styles.predictionConfFill, { width: `${pred.confidenceScore}%`, backgroundColor: typeConfig.color }]} />
          </View>
          <Text style={styles.predictionConfText}>{pred.confidenceScore}%</Text>
          {obsText && <Text style={styles.predictionObsText}>{obsText}</Text>}
        </View>
      </View>
    </View>
  );
}

// Accordion panel with collapsible body and persisted expanded state

interface CollapsiblePanelProps {
  panelId: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  summary: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
  onViewAll?: () => void;
  onAdd?: () => void;
  count?: number;
  loading?: boolean;
}

function CollapsiblePanel({
  panelId, title, icon, accent, summary, expanded, onToggle,
  children, onViewAll, onAdd, count, loading,
}: CollapsiblePanelProps) {
  return (
    <View style={[styles.panel, { borderLeftColor: accent }]}>
      <Pressable style={styles.panelHeader} onPress={() => onToggle(panelId)}>
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
          {!expanded && (
            <Text style={styles.accordionSummary} numberOfLines={1}>{summary}</Text>
          )}
          {expanded && onAdd && (
            <Pressable onPress={(e) => { e.stopPropagation(); onAdd!(); }} style={styles.panelAddBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="add" size={16} color={accent} />
            </Pressable>
          )}
          {expanded && onViewAll && (
            <Pressable onPress={(e) => { e.stopPropagation(); onViewAll!(); }} style={styles.panelViewAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.panelViewAllText, { color: accent }]}>ALL</Text>
              <Ionicons name="chevron-forward" size={11} color={accent} />
            </Pressable>
          )}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textTertiary} />
        </View>
      </Pressable>
      {expanded && (
        <View style={styles.panelBody}>
          {loading ? (
            <ActivityIndicator size="small" color={accent} style={{ margin: 12 }} />
          ) : children}
        </View>
      )}
    </View>
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
  const [fadingMemories, setFadingMemories] = useState<Memory[]>([]);
  const [keepingMemoryId, setKeepingMemoryId] = useState<string | null>(null);
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

  // ── Auto-refresh & last-updated tracking ──
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Accordion state (collapsed by default, persisted to AsyncStorage) ──
  const ACCORDION_KEY = 'mc_accordion_v2';
  const PANEL_DEFAULTS: Record<string, boolean> = {
    tasks: false, schedule: false, inbox: false,
    deliverables: false, foresight: false, docs: false, memory: false,
  };
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>(PANEL_DEFAULTS);

  // ── Predictions (Jarvis Foresight) ──
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [weekPredictions, setWeekPredictions] = useState<Prediction[]>([]);
  const [predictionAccuracy, setPredictionAccuracy] = useState<{ validated: number; accuracyRate: number; autoSkipped: number } | null>(null);
  const [predictionsLoading, setPredictionsLoading] = useState(true);

  // ── Emotional State ──
  const [emotionalState, setEmotionalState] = useState<{
    stressScore: number;
    flowScore: number;
    label: string;
    explanation: string | null;
    signalSources: string[];
    manualOverride: string | null;
    baselineStress: number | null;
    baselineFlow: number | null;
    patternNote: string | null;
  } | null>(null);
  const [emotionalStateModal, setEmotionalStateModal] = useState(false);
  const [settingOverride, setSettingOverride] = useState(false);

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
    const [inboxRes, delRes, memRes, fadingMemRes, docRes, schedRes, gcalRes, ocalRes, sysSchedRes, esRes, predsRes, weekPredsRes, predAccRes] = await Promise.allSettled([
      apiRequest('GET', '/api/inbox/items').then(r => r.json()),
      apiRequest('GET', '/api/deliverables').then(r => r.json()),
      authFetch(new URL('/api/memories', getApiUrl()).toString()).then(r => r.json()),
      authFetch(new URL('/api/memories/fading', getApiUrl()).toString()).then(r => r.json()).catch(() => null),
      authFetch(new URL('/api/documents', getApiUrl()).toString()).then(r => r.json()),
      apiRequest('GET', '/api/jarvis/scheduled-tasks').then(r => r.json()),
      apiRequest('GET', `/api/calendar/google/events${calParams}`).then(r => r.json()).catch(() => null),
      apiRequest('GET', `/api/calendar/outlook/events${calParams}`).then(r => r.json()).catch(() => null),
      apiRequest('GET', '/api/jarvis/system-schedule').then(r => r.json()).catch(() => null),
      apiRequest('GET', '/api/jarvis/emotional-state').then(r => r.json()).catch(() => null),
      apiRequest('GET', '/api/predictions').then(r => r.json()).catch(() => null),
      apiRequest('GET', `/api/predictions/week?startDate=${new Date().toISOString().slice(0, 10)}`).then(r => r.json()).catch(() => null),
      apiRequest('GET', '/api/predictions/accuracy').then(r => r.json()).catch(() => null),
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
    if (fadingMemRes.status === 'fulfilled' && fadingMemRes.value?.memories) {
      setFadingMemories(fadingMemRes.value.memories);
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

    if (esRes.status === 'fulfilled' && esRes.value && typeof esRes.value === 'object' && esRes.value.label) {
      setEmotionalState(esRes.value);
    }

    if (predsRes.status === 'fulfilled' && predsRes.value?.predictions) {
      setPredictions((predsRes.value.predictions as Prediction[]).filter((p: Prediction) => p.confidenceScore >= 55));
    }
    if (weekPredsRes.status === 'fulfilled' && weekPredsRes.value?.predictions) {
      const todayStr = new Date().toISOString().slice(0, 10);
      setWeekPredictions(
        (weekPredsRes.value.predictions as Prediction[])
          .filter((p: Prediction) => p.confidenceScore >= 55 && p.targetDate !== todayStr)
      );
    }
    if (predAccRes.status === 'fulfilled' && predAccRes.value && typeof predAccRes.value.validated === 'number') {
      setPredictionAccuracy({ validated: predAccRes.value.validated, accuracyRate: predAccRes.value.accuracyRate, autoSkipped: predAccRes.value.autoSkipped ?? 0 });
    }
    setPredictionsLoading(false);

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
    setLastUpdated(new Date());
  }, [loadLocal, loadApi]);

  useFocusEffect(useCallback(() => {
    loadAll();
  }, [loadAll]));

  // ── Auto-refresh every 60 seconds (paused when screen is not focused) ──
  useFocusEffect(useCallback(() => {
    autoRefreshRef.current = setInterval(() => { loadAll(); }, 60_000);
    return () => { if (autoRefreshRef.current) { clearInterval(autoRefreshRef.current); autoRefreshRef.current = null; } };
  }, [loadAll]));

  // ── Load accordion state from storage on mount ──
  useEffect(() => {
    AsyncStorage.getItem(ACCORDION_KEY).then(raw => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, boolean>;
          setExpandedPanels(prev => ({ ...prev, ...parsed }));
        } catch {}
      }
    });
  }, []);

  const handleTogglePanel = useCallback((id: string) => {
    setExpandedPanels(prev => {
      const next = { ...prev, [id]: !prev[id] };
      AsyncStorage.setItem(ACCORDION_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

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

  const handleKeepMemory = useCallback(async (id: string) => {
    setKeepingMemoryId(id);
    try {
      const res = await authFetch(new URL(`/api/memories/${id}/keep`, getApiUrl()).toString(), { method: 'POST' });
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFadingMemories(prev => prev.filter(m => m.id !== id));
        setMemories(prev => prev.map(m => m.id === id ? { ...m, relevanceScore: 50 } : m));
      }
    } catch (_e) {
    } finally {
      setKeepingMemoryId(null);
    }
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

  const handleOverrideEmotionalState = useCallback(async (override: string) => {
    setSettingOverride(true);
    const scoreMap: Record<string, { stressScore: number; flowScore: number }> = {
      overwhelmed: { stressScore: 9, flowScore: 1 },
      stressed:    { stressScore: 7, flowScore: 3 },
      focused:     { stressScore: 3, flowScore: 7 },
      'in flow':   { stressScore: 2, flowScore: 9 },
      calm:        { stressScore: 2, flowScore: 5 },
    };
    const scores = scoreMap[override] ?? { stressScore: 2, flowScore: 5 };
    try {
      await apiRequest('POST', '/api/jarvis/emotional-state/override', { override });
      setEmotionalState(prev => prev ? {
        ...prev,
        label: override,
        stressScore: scores.stressScore,
        flowScore: scores.flowScore,
        explanation: `You self-reported as "${override}". Jarvis will adapt its tone for the next 3 hours.`,
        manualOverride: override,
      } : prev);
      setEmotionalStateModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
    setSettingOverride(false);
  }, []);

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

  // ── Today's Focus computed values ──
  const mostUrgentTask = todayTasks.find(t => !t.completed && t.priority === 'high')
    ?? todayTasks.find(t => !t.completed && t.priority === 'medium')
    ?? todayTasks.find(t => !t.completed);

  const focusWindowEnd = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const nextCalEvent = calendarEvents.find(e => {
    const start = new Date(e.start);
    return start >= now && start <= focusWindowEnd;
  });

  const topPrediction = (() => {
    const combined = [...predictions, ...weekPredictions];
    if (combined.length === 0) return null;
    return combined.sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
  })();

  const lastUpdatedDisplay = lastUpdated
    ? (() => {
        const secs = Math.floor((now.getTime() - lastUpdated.getTime()) / 1000);
        if (secs < 5) return 'live';
        if (secs < 60) return `${secs}s ago`;
        return `${Math.floor(secs / 60)}m ago`;
      })()
    : null;

  // ── Accordion summaries ──
  const tasksSummary = totalCount === 0
    ? 'No tasks today'
    : completedCount === totalCount
    ? `All ${totalCount} done`
    : `${totalCount - completedCount} of ${totalCount} remaining`;

  const scheduleSummary = todayScheduleItems.length === 0
    ? 'Nothing scheduled'
    : (() => {
        const next = todayScheduleItems.find(i => {
          if (i.kind === 'calendar') return new Date((i.data as CalendarEvent).start) >= now;
          if (i.kind === 'jarvis') return new Date((i.data as ScheduledTask).scheduledAt) >= now;
          return false;
        });
        if (next) {
          if (next.kind === 'calendar') return `Next: ${(next.data as CalendarEvent).title}`;
          if (next.kind === 'jarvis') return `Next: ${(next.data as ScheduledTask).title}`;
        }
        return `${todayScheduleItems.length} item${todayScheduleItems.length !== 1 ? 's' : ''} today`;
      })();

  const inboxSummary = inboxItems.length === 0
    ? 'No flagged items'
    : `${inboxItems.length} item${inboxItems.length !== 1 ? 's' : ''} waiting`;

  const deliverablesSummary = deliverables.length === 0
    ? 'Nothing pending'
    : `${deliverables.length} pending review`;

  const foresightSummary = predictions.length === 0 && weekPredictions.length === 0
    ? 'No predictions yet'
    : `${predictions.length + weekPredictions.length} signal${predictions.length + weekPredictions.length !== 1 ? 's' : ''}`;

  const docsSummary = documents.length === 0
    ? 'No documents'
    : `${documents.length} document${documents.length !== 1 ? 's' : ''}`;

  const memorySummary = memories.length === 0
    ? 'Nothing remembered yet'
    : `${memories.length} memor${memories.length !== 1 ? 'ies' : 'y'}`;

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
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>{formatDate(now)}</Text>
          <View style={styles.headerClockRow}>
            <Text style={styles.headerClock}>{formatClockTime(now)}</Text>
            {emotionalState && (
              <Pressable
                onPress={() => setEmotionalStateModal(true)}
                style={[styles.emotionalBadge, { backgroundColor: getEmotionalColor(emotionalState.label) + '20', borderColor: getEmotionalColor(emotionalState.label) + '40' }]}
              >
                <View style={[styles.emotionalDot, { backgroundColor: getEmotionalColor(emotionalState.label) }]} />
                <Text style={[styles.emotionalBadgeText, { color: getEmotionalColor(emotionalState.label) }]}>
                  {emotionalState.label.toUpperCase()}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => router.push('/voice-realtime')}
            style={styles.voiceBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="mic-circle-outline" size={22} color={Colors.cyan} />
          </Pressable>
          <Text style={styles.headerTitle}>MISSION{'\n'}CONTROL</Text>
          {lastUpdatedDisplay && (
            <Text style={styles.headerUpdated}>{lastUpdatedDisplay}</Text>
          )}
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

      {/* ── Emotional State Override Modal ── */}
      <Modal visible={emotionalStateModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEmotionalStateModal(false)}>
        <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
          <View style={[styles.modalHeader, { borderBottomColor: Colors.cyan + '30' }]}>
            <Pressable onPress={() => setEmotionalStateModal(false)} style={styles.modalBackBtn}>
              <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
              <Text style={styles.modalBackText}>Back</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: Colors.cyan }]}>JARVIS STATE</Text>
            <View style={styles.modalHeaderSpacer} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
            {emotionalState && (
              <>
                <View style={styles.esCurrentCard}>
                  <View style={[styles.esCurrentDot, { backgroundColor: getEmotionalColor(emotionalState.label) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.esCurrentLabel}>Jarvis perceives you as</Text>
                    <Text style={[styles.esCurrentState, { color: getEmotionalColor(emotionalState.label) }]}>
                      {emotionalState.label.toUpperCase()}
                    </Text>
                    <Text style={styles.esCurrentExplanation}>{emotionalState.explanation}</Text>
                  </View>
                </View>
                <View style={styles.esScores}>
                  <View style={styles.esScoreItem}>
                    <Text style={styles.esScoreLabel}>Stress</Text>
                    <Text style={[styles.esScoreValue, { color: emotionalState.stressScore >= 7 ? Colors.error : emotionalState.stressScore >= 5 ? Colors.warning : Colors.textSecondary }]}>
                      {emotionalState.stressScore}/10
                    </Text>
                  </View>
                  <View style={styles.esScoreItem}>
                    <Text style={styles.esScoreLabel}>Flow</Text>
                    <Text style={[styles.esScoreValue, { color: emotionalState.flowScore >= 7 ? Colors.cyan : emotionalState.flowScore >= 5 ? Colors.violet : Colors.textSecondary }]}>
                      {emotionalState.flowScore}/10
                    </Text>
                  </View>
                </View>
                {emotionalState.signalSources.length > 0 && (
                  <View style={styles.esSignals}>
                    <Text style={styles.esSignalsTitle}>Signals used</Text>
                    {emotionalState.signalSources.map((s, i) => (
                      <Text key={i} style={styles.esSignalItem}>· {s}</Text>
                    ))}
                  </View>
                )}
                {emotionalState.manualOverride && (
                  <View style={styles.esOverrideNote}>
                    <Ionicons name="information-circle-outline" size={13} color={Colors.textTertiary} />
                    <Text style={styles.esOverrideNoteText}>Manual override active (lasts 3h)</Text>
                  </View>
                )}
              </>
            )}

            {/* ── Your Patterns / Baseline Card — only shown once state has loaded ── */}
            {emotionalState && (
            <View style={styles.esBaselineCard}>
              <View style={styles.esBaselineHeader}>
                <Ionicons name="stats-chart-outline" size={12} color={Colors.textTertiary} />
                <Text style={styles.esBaselineSectionTitle}>YOUR PATTERNS</Text>
              </View>
              {emotionalState.baselineStress !== null && emotionalState.baselineStress !== undefined
               && emotionalState.baselineFlow !== null && emotionalState.baselineFlow !== undefined ? (
                <>
                  <Text style={styles.esBaselineSubtitle}>
                    Your 30-day baseline: stress {emotionalState.baselineStress.toFixed(1)} · flow {emotionalState.baselineFlow.toFixed(1)}
                  </Text>
                  <View style={styles.esBaselineRow}>
                    <Text style={styles.esBaselineDimLabel}>STRESS</Text>
                    <View style={{ flex: 1 }}>
                      <View style={styles.esBaselineTrackWrap}>
                        <View style={styles.esBaselineTrack}>
                          <View style={[styles.esBaselineFill, {
                            width: `${(emotionalState.stressScore / 10) * 100}%` as DimensionValue,
                            backgroundColor: emotionalState.stressScore >= 7 ? Colors.error : emotionalState.stressScore >= 5 ? Colors.warning : Colors.textTertiary,
                          }]} />
                        </View>
                        <View style={[styles.esBaselineMarker, {
                          left: `${(emotionalState.baselineStress / 10) * 100}%` as DimensionValue,
                        }]} />
                      </View>
                      <Text style={styles.esBaselineCompare}>
                        {emotionalState.stressScore}/10
                        {emotionalState.stressScore > emotionalState.baselineStress + 1.5
                          ? '  ↑ above usual'
                          : emotionalState.stressScore < emotionalState.baselineStress - 1.5
                          ? '  ↓ below usual'
                          : '  · on track'}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.esBaselineRow, { marginBottom: 0 }]}>
                    <Text style={styles.esBaselineDimLabel}>FLOW</Text>
                    <View style={{ flex: 1 }}>
                      <View style={styles.esBaselineTrackWrap}>
                        <View style={styles.esBaselineTrack}>
                          <View style={[styles.esBaselineFill, {
                            width: `${(emotionalState.flowScore / 10) * 100}%` as DimensionValue,
                            backgroundColor: emotionalState.flowScore >= 7 ? Colors.cyan : emotionalState.flowScore >= 5 ? Colors.violet : Colors.textTertiary,
                          }]} />
                        </View>
                        <View style={[styles.esBaselineMarker, {
                          left: `${(emotionalState.baselineFlow / 10) * 100}%` as DimensionValue,
                        }]} />
                      </View>
                      <Text style={styles.esBaselineCompare}>
                        {emotionalState.flowScore}/10
                        {emotionalState.flowScore > emotionalState.baselineFlow + 1.5
                          ? '  ↑ above usual'
                          : emotionalState.flowScore < emotionalState.baselineFlow - 1.5
                          ? '  ↓ below usual'
                          : '  · on track'}
                      </Text>
                    </View>
                  </View>
                  {emotionalState.patternNote ? (
                    <View style={styles.esPatternNote}>
                      <Ionicons name="trending-up-outline" size={11} color={Colors.violet} />
                      <Text style={styles.esPatternNoteText}>{emotionalState.patternNote}</Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.esBaselineEmpty}>
                  Keep using Jarvis — your personal baseline will appear after a week of check-ins.
                </Text>
              )}
            </View>
            )}

            <Text style={styles.esOverrideTitle}>Correct Jarvis's perception</Text>
            <Text style={styles.esOverrideSubtitle}>Tap to tell Jarvis how you actually feel. This adjusts its tone for the next 3 hours.</Text>

            {(['calm', 'focused', 'in flow', 'stressed', 'overwhelmed'] as const).map(opt => (
              <Pressable
                key={opt}
                onPress={() => handleOverrideEmotionalState(opt)}
                disabled={settingOverride}
                style={[
                  styles.esOverrideBtn,
                  { borderColor: getEmotionalColor(opt) + '60', backgroundColor: getEmotionalColor(opt) + '15' },
                  emotionalState?.label === opt && { borderWidth: 1.5 },
                ]}
              >
                <View style={[styles.emotionalDot, { backgroundColor: getEmotionalColor(opt) }]} />
                <Text style={[styles.esOverrideBtnText, { color: getEmotionalColor(opt) }]}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </Text>
                {emotionalState?.label === opt && (
                  <Ionicons name="checkmark-circle" size={14} color={getEmotionalColor(opt)} style={{ marginLeft: 'auto' }} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Panels ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ════ TODAY'S FOCUS ════ */}
        <Animated.View entering={FadeInDown.delay(0).duration(350)}>
          <View style={styles.focusSection}>
            <View style={styles.focusSectionHeader}>
              <Ionicons name="flash" size={13} color={Colors.cyan} />
              <Text style={styles.focusSectionTitle}>TODAY'S FOCUS</Text>
            </View>

            {/* Focus: Most urgent task */}
            {mostUrgentTask ? (
              <Pressable style={styles.focusCard} onPress={() => setTasksModal(true)}>
                <View style={[styles.focusCardIcon, { backgroundColor: Colors.violetDim }]}>
                  <Ionicons name="checkmark-circle-outline" size={18} color={Colors.violet} />
                </View>
                <View style={styles.focusCardContent}>
                  <Text style={styles.focusCardType}>TOP TASK</Text>
                  <Text style={styles.focusCardTitle} numberOfLines={2}>{mostUrgentTask.title}</Text>
                  <Text style={styles.focusCardMeta}>
                    {mostUrgentTask.priority.toUpperCase()} · {mostUrgentTask.category}
                    {mostUrgentTask.time ? ` · ${mostUrgentTask.time}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
              </Pressable>
            ) : tasksLoading ? (
              <View style={styles.focusCardEmpty}>
                <ActivityIndicator size="small" color={Colors.violet} />
              </View>
            ) : (
              <Pressable style={[styles.focusCard, { opacity: 0.5 }]} onPress={() => router.push('/(tabs)/insights')}>
                <View style={[styles.focusCardIcon, { backgroundColor: Colors.violetDim }]}>
                  <Ionicons name="checkmark-circle-outline" size={18} color={Colors.violet} />
                </View>
                <View style={styles.focusCardContent}>
                  <Text style={styles.focusCardType}>TOP TASK</Text>
                  <Text style={styles.focusCardMeta}>Ask Jarvis to build your day</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
              </Pressable>
            )}

            {/* Focus: Next calendar event */}
            {nextCalEvent ? (
              <Pressable style={({ pressed }) => [styles.focusCard, pressed && { opacity: 0.7 }]} onPress={() => handleTogglePanel('schedule')}>
                <View style={[styles.focusCardIcon, { backgroundColor: nextCalEvent.source === 'google' ? '#4285F420' : '#0078D420' }]}>
                  <Ionicons name="calendar" size={18} color={nextCalEvent.source === 'google' ? '#4285F4' : '#0078D4'} />
                </View>
                <View style={styles.focusCardContent}>
                  <Text style={styles.focusCardType}>NEXT EVENT</Text>
                  <Text style={styles.focusCardTitle} numberOfLines={1}>{nextCalEvent.title}</Text>
                  <Text style={styles.focusCardMeta}>{formatScheduledAt(nextCalEvent.start)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
              </Pressable>
            ) : (
              <View style={[styles.focusCard, { opacity: 0.35 }]}>
                <View style={[styles.focusCardIcon, { backgroundColor: Colors.cyanDim }]}>
                  <Ionicons name="calendar-outline" size={18} color={Colors.cyan} />
                </View>
                <View style={styles.focusCardContent}>
                  <Text style={styles.focusCardType}>NEXT EVENT</Text>
                  <Text style={styles.focusCardMeta}>No events in the next 3 hours</Text>
                </View>
              </View>
            )}

            {/* Focus: Top Jarvis signal */}
            {topPrediction ? (
              <Pressable style={({ pressed }) => [styles.focusCard, { borderBottomWidth: 0 }, pressed && { opacity: 0.7 }]} onPress={() => handleTogglePanel('foresight')}>
                {(() => {
                  const cfg = PREDICTION_TYPE_CONFIG[topPrediction.predictionType] ?? { icon: 'telescope-outline' as const, color: Colors.violet, label: 'SIGNAL' };
                  return (
                    <>
                      <View style={[styles.focusCardIcon, { backgroundColor: cfg.color + '20' }]}>
                        <Ionicons name={cfg.icon} size={18} color={cfg.color} />
                      </View>
                      <View style={styles.focusCardContent}>
                        <Text style={[styles.focusCardType, { color: cfg.color }]}>
                          JARVIS SIGNAL · {topPrediction.confidenceScore}%
                        </Text>
                        <Text style={styles.focusCardTitle} numberOfLines={2}>{topPrediction.humanReadable}</Text>
                        {topPrediction.actionSuggestion && (
                          <Text style={styles.focusCardMeta} numberOfLines={1}>→ {topPrediction.actionSuggestion}</Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
                    </>
                  );
                })()}
              </Pressable>
            ) : null}
          </View>
        </Animated.View>

        {/* ════ COLLAPSIBLE SECONDARY PANELS ════ */}

        {/* TASKS */}
        <Animated.View entering={FadeInDown.delay(60).duration(350)}>
          <CollapsiblePanel
            panelId="tasks"
            title="TASKS"
            icon="checkmark-circle-outline"
            accent={Colors.violet}
            summary={tasksSummary}
            expanded={!!expandedPanels.tasks}
            onToggle={handleTogglePanel}
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
                <Text style={styles.goalsSummarySub}>Manage →</Text>
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
          </CollapsiblePanel>
        </Animated.View>

        {/* SCHEDULE */}
        <Animated.View entering={FadeInDown.delay(80).duration(350)}>
          <CollapsiblePanel
            panelId="schedule"
            title="SCHEDULE"
            icon="calendar-outline"
            accent={Colors.cyan}
            summary={scheduleSummary}
            expanded={!!expandedPanels.schedule}
            onToggle={handleTogglePanel}
            count={todayScheduleItems.length}
            loading={scheduledLoading}
            onViewAll={() => setScheduleModal(true)}
            onAdd={() => setNewTaskModal(true)}
          >
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
            {todayScheduleItems.length === 0 ? (
              <Text style={styles.emptyText}>Nothing scheduled today.</Text>
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
          </CollapsiblePanel>
        </Animated.View>

        {/* INBOX */}
        <Animated.View entering={FadeInDown.delay(100).duration(350)}>
          <CollapsiblePanel
            panelId="inbox"
            title="INBOX"
            icon="mail-open-outline"
            accent={Colors.cyan}
            summary={inboxSummary}
            expanded={!!expandedPanels.inbox}
            onToggle={handleTogglePanel}
            count={inboxItems.length}
            loading={inboxLoading}
            onViewAll={() => setInboxModal(true)}
          >
            {inboxItems.length === 0 ? (
              <Text style={styles.emptyText}>No flagged items. Jarvis will surface important emails here.</Text>
            ) : (
              inboxItems.slice(0, 3).map(item => {
                const srcIcon = getInboxSourceIcon(item.sourceType);
                return (
                  <View key={item.id} style={styles.inboxRow}>
                    <Ionicons name={srcIcon.icon} size={13} color={srcIcon.color} style={{ marginTop: 2 }} />
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
                );
              })
            )}
          </CollapsiblePanel>
        </Animated.View>

        {/* DELIVERABLES */}
        <Animated.View entering={FadeInDown.delay(120).duration(350)}>
          <CollapsiblePanel
            panelId="deliverables"
            title="DELIVERABLES"
            icon="document-text-outline"
            accent={Colors.violet}
            summary={deliverablesSummary}
            expanded={!!expandedPanels.deliverables}
            onToggle={handleTogglePanel}
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
          </CollapsiblePanel>
        </Animated.View>

        {/* FORESIGHT */}
        <Animated.View entering={FadeInDown.delay(140).duration(350)}>
          <CollapsiblePanel
            panelId="foresight"
            title="JARVIS FORESIGHT"
            icon="telescope-outline"
            accent="#9b59b6"
            summary={foresightSummary}
            expanded={!!expandedPanels.foresight}
            onToggle={handleTogglePanel}
            loading={predictionsLoading}
          >
            {predictions.length === 0 && weekPredictions.length === 0 ? (
              <Text style={styles.emptyText}>No predictions yet.</Text>
            ) : (
              <>
                {predictions.length > 0 && (
                  <>
                    <Text style={styles.predictionSectionLabel}>TODAY</Text>
                    {predictions.slice(0, 4).map((pred) => <PredictionCard key={pred.id} pred={pred} />)}
                  </>
                )}
                {weekPredictions.length > 0 && (
                  <>
                    <Text style={[styles.predictionSectionLabel, { marginTop: predictions.length > 0 ? 10 : 0 }]}>THIS WEEK</Text>
                    {weekPredictions.slice(0, 3).map((pred) => <PredictionCard key={pred.id} pred={pred} compact />)}
                  </>
                )}
                {predictionAccuracy && predictionAccuracy.validated >= 3 && (
                  <View style={styles.predictionAccuracyRow}>
                    <Ionicons name="analytics-outline" size={11} color="#9b59b6" />
                    <Text style={styles.predictionAccuracyText}>
                      {Math.round(predictionAccuracy.accuracyRate * 100)}% accurate · {predictionAccuracy.validated} validated
                    </Text>
                  </View>
                )}
              </>
            )}
          </CollapsiblePanel>
        </Animated.View>

        {/* DOCS */}
        <Animated.View entering={FadeInDown.delay(160).duration(350)}>
          <CollapsiblePanel
            panelId="docs"
            title="DOCS"
            icon="folder-open-outline"
            accent={Colors.cyan}
            summary={docsSummary}
            expanded={!!expandedPanels.docs}
            onToggle={handleTogglePanel}
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
          </CollapsiblePanel>
        </Animated.View>

        {/* MEMORY */}
        <Animated.View entering={FadeInDown.delay(180).duration(350)}>
          <CollapsiblePanel
            panelId="memory"
            title="MEMORY"
            icon="bookmark-outline"
            accent={Colors.violet}
            summary={memorySummary}
            expanded={!!expandedPanels.memory}
            onToggle={handleTogglePanel}
            count={memories.length}
            loading={memoriesLoading}
            onViewAll={() => setMemoriesModal(true)}
          >
            {fadingMemories.length > 0 && (
              <Pressable style={styles.fadingBadgeRow} onPress={() => setMemoriesModal(true)}>
                <Ionicons name="hourglass-outline" size={12} color={Colors.warning} />
                <Text style={styles.fadingBadgeText}>
                  {fadingMemories.length} {fadingMemories.length === 1 ? 'memory' : 'memories'} fading — tap to review
                </Text>
              </Pressable>
            )}
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
          </CollapsiblePanel>
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
          inboxItems.map(item => {
            const srcIcon = getInboxSourceIcon(item.sourceType);
            const srcLabel = getInboxSourceLabel(item.sourceType);
            return (
            <View key={item.id} style={[styles.modalItemRow, { borderLeftColor: srcIcon.color }]}>
              <View style={styles.modalItemContent}>
                <View style={[styles.typeBadge, { backgroundColor: srcIcon.color + '18', marginBottom: 4, alignSelf: 'flex-start' }]}>
                  <Ionicons name={srcIcon.icon} size={9} color={srcIcon.color} />
                  <Text style={[styles.typeBadgeText, { color: srcIcon.color, marginLeft: 3 }]}>{srcLabel.toUpperCase()}</Text>
                </View>
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
          );
          })
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
        {fadingMemories.length > 0 && !memorySearch && (
          <View style={styles.fadingSectionWrapper}>
            <View style={styles.fadingSectionHeader}>
              <Ionicons name="hourglass-outline" size={14} color={Colors.warning} />
              <Text style={styles.fadingSectionTitle}>FADING — {fadingMemories.length} {fadingMemories.length === 1 ? 'memory' : 'memories'} Jarvis may forget</Text>
            </View>
            {fadingMemories.map(m => (
              <View key={m.id} style={[styles.modalItemRow, { borderLeftColor: Colors.warning }]}>
                <View style={styles.modalItemContent}>
                  <View style={[styles.catBadge, { backgroundColor: Colors.warningDim, marginBottom: 6 }]}>
                    <Text style={[styles.catBadgeText, { color: Colors.warning }]}>{m.category}</Text>
                  </View>
                  <Text style={styles.modalItemTitle}>{m.content}</Text>
                  <Text style={styles.modalItemMeta}>
                    {m.lastReferencedAt
                      ? `Last referenced ${new Date(m.lastReferencedAt).toLocaleDateString()}`
                      : `Saved ${new Date(m.extractedAt).toLocaleDateString()}`}
                    {' · '}relevance {m.relevanceScore ?? '?'}/100
                  </Text>
                </View>
                <Pressable
                  style={[styles.keepMemoryBtn, keepingMemoryId === m.id && { opacity: 0.5 }]}
                  onPress={() => handleKeepMemory(m.id)}
                  disabled={keepingMemoryId === m.id}
                >
                  <Ionicons name="heart-outline" size={13} color={Colors.warning} />
                  <Text style={styles.keepMemoryText}>Keep</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
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
    gap: 6,
  },
  voiceBtn: {
    padding: 2,
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
    flexDirection: 'row',
    alignItems: 'center',
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
  fadingBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.warningDim,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
  },
  fadingBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.warning,
    flex: 1,
  },
  fadingSectionWrapper: {
    marginBottom: 4,
  },
  fadingSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  fadingSectionTitle: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.warning,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  keepMemoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.warningDim,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  keepMemoryText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.warning,
    letterSpacing: 0.3,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusLineText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    letterSpacing: 0.3,
    flex: 1,
  },
  emotionalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  emotionalDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  emotionalBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  esCurrentCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  esCurrentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  esCurrentLabel: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  esCurrentState: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  esCurrentExplanation: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  esScores: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  esScoreItem: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    alignItems: 'center',
  },
  esScoreLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  esScoreValue: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  esSignals: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 16,
  },
  esSignalsTitle: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  esSignalItem: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 3,
  },
  esOverrideNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 20,
  },
  esOverrideNoteText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  esOverrideTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  esOverrideSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: 16,
  },
  esOverrideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  esOverrideBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
  },
  esBaselineCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 20,
  },
  esBaselineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  esBaselineSectionTitle: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    letterSpacing: 1,
  },
  esBaselineSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  esBaselineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  esBaselineDimLabel: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
    width: 34,
    marginTop: 5,
  },
  esBaselineTrackWrap: {
    height: 12,
    position: 'relative',
    justifyContent: 'center',
    marginBottom: 4,
  },
  esBaselineTrack: {
    height: 6,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
  },
  esBaselineFill: {
    height: 6,
    borderRadius: 3,
    minWidth: 3,
  },
  esBaselineMarker: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: 12,
    backgroundColor: Colors.white,
    opacity: 0.45,
    borderRadius: 1,
  },
  esBaselineCompare: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  esPatternNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  esPatternNoteText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 16,
  },
  esBaselineEmpty: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    lineHeight: 17,
    fontStyle: 'italic',
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
  predictionSectionLabel: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.5,
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  predictionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  predictionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  predictionContent: {
    flex: 1,
    gap: 3,
  },
  predictionTypeLabel: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.2,
  },
  predictionText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 18,
  },
  predictionAction: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  predictionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  predictionConfBar: {
    width: 60,
    height: 3,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  predictionConfFill: {
    height: 3,
    borderRadius: 2,
  },
  predictionConfText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
  },
  predictionObsText: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    flex: 1,
  },
  predictionAccuracyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  predictionAccuracyText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  // ── Header updates ──
  headerClockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  headerUpdated: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    letterSpacing: 0.5,
    textAlign: 'right',
    marginTop: 3,
  },
  // ── Today's Focus section ──
  focusSection: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    padding: 14,
    gap: 2,
  },
  focusSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  focusSectionTitle: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: Colors.cyan,
    letterSpacing: 2,
  },
  focusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  focusCardIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  focusCardContent: {
    flex: 1,
    gap: 2,
  },
  focusCardType: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: Colors.textTertiary,
    letterSpacing: 1.2,
  },
  focusCardTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    lineHeight: 20,
  },
  focusCardMeta: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  focusCardEmpty: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  // ── Accordion summary text ──
  accordionSummary: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    maxWidth: 160,
    textAlign: 'right',
  },
});
