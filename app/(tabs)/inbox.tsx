import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import DailyCommandPlanEditor, {
  type DailyCommandPlanPatch,
  type DailyCommandTask,
} from '@/components/DailyCommandPlanEditor';
import MindTraceDebugPanel, { type MindTraceDebugRecord } from '@/components/MindTraceDebugPanel';

class DriveApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

interface InboxItem {
  id: string;
  sourceType: string;
  sourceId: string;
  subject: string | null;
  sender: string | null;
  snippet: string | null;
  jarvisReason: string | null;
  suggestedActions: { label: string; actionType: string; payload?: Record<string, unknown> }[] | null;
  status: string;
  surfacedAt: string;
  actedAt: string | null;
}

interface GutSignal {
  id: string;
  signalType: string;
  itemRef: string | null;
  confidenceScore: number;
  explanation: string;
  userResponse: string | null;
  createdAt: string;
}

interface AgentJob {
  id: string;
  agentType: string;
  title: string;
  prompt: string;
  input?: Record<string, unknown>;
  status: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
  turns?: number | null;
  toolCallsCount?: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt?: string | null;
  review?: {
    stage: string;
    label: string;
    nextAction: string;
    canCancel: boolean;
    canRetry: boolean;
    preview: string;
    originChannel?: string;
    autonomyPolicy: boolean;
  };
}

interface Deliverable {
  id: string;
  agentType: string;
  type: string;
  title: string;
  summary: string | null;
  body: string;
  meta: Record<string, unknown> | null;
  status: string;
  triageStatus: string | null;
  triageNote: string | null;
  driveLink: string | null;
  createdAt: string;
  actedAt: string | null;
  review?: {
    stage: string;
    label: string;
    nextAction: string;
    canApprove: boolean;
    canEdit: boolean;
    canRevise: boolean;
    canDiscard: boolean;
    canReject: boolean;
    canSaveToDrive: boolean;
    preview: string;
    approvalGateId?: string;
  };
}

interface DailyCommandSnapshot {
  date: string;
  status: 'working' | 'ready' | 'waiting_approval' | 'blocked' | 'failed' | 'recovering';
  plan: { tasks?: DailyCommandTask[] } | null;
  attention: { pendingCount: number };
  jobs: { active: AgentJob[]; failed: AgentJob[] };
  deliverables: { pendingCount: number };
  approvals: { pendingCount: number };
  reminders: { morningBriefSent: boolean; eveningWrapSent: boolean };
  dream: { pendingCount: number; latestInsight?: { insightText: string } | null };
  contextWarnings: { source: string; severity: 'info' | 'warning' | 'error'; message: string }[];
  statusReasons?: {
    state: DailyCommandSnapshot['status'];
    label: string;
    detail: string;
    severity: 'info' | 'warning' | 'error';
    action?: 'retry_available' | 'approval_required' | 'wait' | 'reconnect' | 'generate_plan';
  }[];
}

const DELIVERABLE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  research: 'search',
  document: 'document-text',
  plan: 'list',
  email_draft: 'mail',
  approval_gate: 'shield-checkmark-outline',
};

const DELIVERABLE_LABEL: Record<string, string> = {
  research: 'Research brief',
  document: 'Document',
  plan: 'Plan',
  email_draft: 'Email draft',
  approval_gate: 'Approval required',
};

const JOB_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  research: 'search',
  deep_research: 'library',
  writing: 'create',
  planning: 'list',
  email: 'mail',
  app_project: 'code-slash',
  custom_agent: 'person-circle',
  named_agent_task: 'people',
  goal_decompose: 'git-branch',
  weekly_pattern: 'analytics',
};

const JOB_LABEL: Record<string, string> = {
  research: 'Research',
  deep_research: 'Deep research',
  writing: 'Writing',
  planning: 'Planning',
  email: 'Email',
  app_project: 'App project',
  custom_agent: 'Custom agent',
  named_agent_task: 'Named agent',
  goal_decompose: 'Goal breakdown',
  weekly_pattern: 'Weekly review',
};

function normalizePreviewText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function getDeliverableBody(d: Deliverable): string {
  const meta = (d.meta as { emailBody?: string } | null) || {};
  return d.type === 'email_draft' ? (meta.emailBody || d.body) : d.body;
}

function isLongDeliverable(d: Deliverable): boolean {
  const body = getDeliverableBody(d);
  return body.length > 900 || body.split(/\r?\n/).length > 12;
}

function getDeliverableRevisionInfo(d: Deliverable): {
  isRevision: boolean;
  originalDeliverableId?: string;
  originalJobId?: string;
  instructions?: string;
} {
  const meta = (d.meta || {}) as Record<string, unknown>;
  const originalDeliverableId = typeof meta.revisionOfDeliverableId === 'string' ? meta.revisionOfDeliverableId : undefined;
  const originalJobId = typeof meta.revisionOfJobId === 'string' ? meta.revisionOfJobId : undefined;
  const instructions = typeof meta.revisionInstructions === 'string' ? meta.revisionInstructions : undefined;
  return {
    isRevision: meta.revision === true || Boolean(originalDeliverableId || originalJobId || instructions),
    originalDeliverableId,
    originalJobId,
    instructions,
  };
}

function formatElapsed(from: string): string {
  const ms = Date.now() - new Date(from).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

interface EmailDraft {
  id: string;
  fromSender: string | null;
  originalSubject: string | null;
  draftSubject: string;
  draftBody: string;
  jarvisReason: string | null;
  status: string;
  createdAt: string;
}

function getSenderName(sender: string | null): string {
  if (!sender) return 'Unknown';
  return sender.replace(/<.*>/, '').trim() || sender;
}

function getDailyCommandStatusConfig(status: DailyCommandSnapshot['status']): {
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
} {
  switch (status) {
    case 'working':
      return { label: 'Jarvis is working', detail: 'Active jobs are moving through the queue.', icon: 'sync-outline', color: Colors.primary };
    case 'waiting_approval':
      return { label: 'Waiting approval', detail: 'Review the approval cards before Jarvis acts.', icon: 'shield-checkmark-outline', color: '#F59E0B' };
    case 'blocked':
      return { label: 'Blocked', detail: 'A required source or setup path needs attention.', icon: 'alert-circle-outline', color: Colors.error };
    case 'failed':
      return { label: 'Needs recovery', detail: 'At least one job failed and can be retried.', icon: 'refresh-circle-outline', color: Colors.error };
    case 'recovering':
      return { label: 'Recovering', detail: 'Some jobs failed while other work is still running.', icon: 'construct-outline', color: '#F59E0B' };
    case 'ready':
    default:
      return { label: 'Ready', detail: 'Your daily command loop is clear right now.', icon: 'checkmark-circle-outline', color: Colors.success };
  }
}

interface SourceConfig {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bgColor: string;
}

function getSourceConfig(sourceType: string): SourceConfig {
  switch (sourceType) {
    case 'email':
    case 'gmail':
      return { label: 'Gmail', icon: 'mail', color: '#EA4335', bgColor: '#EA433515' };
    case 'google_calendar':
      return { label: 'Google Cal', icon: 'calendar', color: Colors.primary, bgColor: Colors.primary + '15' };
    case 'outlook_calendar':
      return { label: 'Outlook Cal', icon: 'calendar', color: '#0078D4', bgColor: '#0078D415' };
    case 'calendar':
      return { label: 'Calendar', icon: 'calendar', color: Colors.primary, bgColor: Colors.primary + '15' };
    case 'outlook':
    case 'outlook_email':
      return { label: 'Outlook Mail', icon: 'mail', color: '#0078D4', bgColor: '#0078D415' };
    case 'telegram':
      return { label: 'Telegram', icon: 'paper-plane', color: '#2AABEE', bgColor: '#2AABEE15' };
    default:
      return { label: sourceType || 'Inbox', icon: 'notifications', color: Colors.textSecondary, bgColor: Colors.surface };
  }
}

const GUT_TYPE_LABEL: Record<string, string> = {
  calendar_anomaly: 'Calendar flag',
  email_pattern: 'Email pattern',
  deep_work_erosion: 'Focus erosion',
  project_drift: 'Project drift',
  relationship_anomaly: 'Relationship flag',
};

const SUPPORTED_ACTION_TYPES = new Set([
  'dismiss', 'never_again', 'archive', 'mark_important',
  'save_as_task', 'add_prep_time', 'save_to_focus', 'navigate_telegram_health', 'reply',
  'navigate_self_repair', 'review_approval',
]);

export default function InboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList>(null);

  const { data: items = [], isLoading, refetch } = useQuery<InboxItem[]>({
    queryKey: ['/api/inbox/items'],
  });

  const { data: gutSignals = [], refetch: refetchGut } = useQuery<GutSignal[]>({
    queryKey: ['/api/gut/signals'],
  });

  // Build a set of all inbox item refs so we can detect "orphaned" signals
  // (e.g. calendar_anomaly signals whose itemRef is a Google Calendar event ID
  //  not imported as an inbox row) and route them to the global Jarvis noticed section.
  const inboxRefSet = React.useMemo(() => {
    const s = new Set<string>();
    for (const item of items) {
      s.add(item.id);
      if (item.sourceId) s.add(item.sourceId);
    }
    return s;
  }, [items]);

  const gutByItemRef = React.useMemo(() => {
    const map = new Map<string, GutSignal>();
    for (const g of gutSignals) {
      if (g.itemRef && !g.userResponse) map.set(g.itemRef, g);
    }
    return map;
  }, [gutSignals]);

  const [gutModalSignal, setGutModalSignal] = useState<GutSignal | null>(null);
  const [dailyPlanEditorOpen, setDailyPlanEditorOpen] = useState(false);

  const respondGutMutation = useMutation({
    mutationFn: async ({ id, response }: { id: string; response: string }) => {
      const res = await apiRequest('POST', `/api/gut/signals/${id}/respond`, { response });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/gut/signals'] });
      setGutModalSignal(null);
    },
  });

  const { data: drafts = [], refetch: refetchDrafts } = useQuery<EmailDraft[]>({
    queryKey: ['/api/email-drafts'],
  });

  const { data: deliverables = [], refetch: refetchDeliverables } = useQuery<Deliverable[]>({
    queryKey: ['/api/deliverables'],
    refetchInterval: 30000,
  });

  const { data: autoHandledDeliverables = [], refetch: refetchAutoHandled } = useQuery<Deliverable[]>({
    queryKey: ['/api/deliverables?triageSection=auto_handled'],
    refetchInterval: 60000,
  });

  const { data: dismissedInboxItems = [] } = useQuery<InboxItem[]>({
    queryKey: ['/api/inbox/items?status=dismissed'],
    refetchInterval: 60000,
  });

  const [autoHandledExpanded, setAutoHandledExpanded] = useState(false);

  const { data: activeJobs = [], refetch: refetchActiveJobs } = useQuery<AgentJob[]>({
    queryKey: ['/api/agent-jobs/active'],
    refetchInterval: (query) => {
      const jobs = query.state.data ?? [];
      return jobs.length > 0 ? 10000 : false;
    },
  });

  const { data: failedJobs = [], refetch: refetchFailedJobs } = useQuery<AgentJob[]>({
    queryKey: ['/api/agent-jobs?status=failed&limit=10'],
    refetchInterval: 60000,
  });

  const { data: dailyCommand, refetch: refetchDailyCommand } = useQuery<DailyCommandSnapshot>({
    queryKey: ['/api/daily-command/today'],
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'working' || status === 'recovering' || status === 'waiting_approval' ? 10000 : 60000;
    },
  });

  const { data: mindTraceData, isLoading: mindTraceLoading, refetch: refetchMindTrace } = useQuery<{ traces: MindTraceDebugRecord[] }>({
    queryKey: ['/api/mind-trace/recent?limit=5'],
    refetchInterval: 60000,
  });

  const refreshDailyPlanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/daily-command/plan/generate', { mode: 'merge' });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
      if (dailyCommand?.date) {
        queryClient.invalidateQueries({ queryKey: [`/api/data/plans/${dailyCommand.date}`] });
      }
    },
    onError: () => {
      Alert.alert('Error', 'Could not refresh the daily plan.');
    },
  });

  const patchDailyPlanMutation = useMutation({
    mutationFn: async (patch: DailyCommandPlanPatch | { ops: DailyCommandPlanPatch[] }) => {
      const res = await apiRequest('PATCH', '/api/daily-command/plan', patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
      if (dailyCommand?.date) {
        queryClient.invalidateQueries({ queryKey: [`/api/data/plans/${dailyCommand.date}`] });
      }
    },
    onError: () => {
      Alert.alert('Error', 'Could not update the daily plan.');
    },
  });

  const refreshAll = useCallback(() => {
    void Promise.all([
      refetch(),
      refetchGut(),
      refetchDrafts(),
      refetchDeliverables(),
      refetchAutoHandled(),
      refetchActiveJobs(),
      refetchFailedJobs(),
      refetchDailyCommand(),
      refetchMindTrace(),
    ]);
  }, [
    refetch,
    refetchGut,
    refetchDrafts,
    refetchDeliverables,
    refetchAutoHandled,
    refetchActiveJobs,
    refetchFailedJobs,
    refetchDailyCommand,
    refetchMindTrace,
  ]);

  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest('POST', `/api/agent-jobs/${jobId}/cancel`, {});
      return res.json() as Promise<{ ok: boolean; status: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agent-jobs/active'] });
      queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
    },
    onError: () => {
      Alert.alert('Error', 'Could not cancel this job.');
    },
  });

  const retryJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest('POST', `/api/agent-jobs/${jobId}/retry`, {});
      return res.json() as Promise<{ ok: boolean; jobId: string; status: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agent-jobs/active'] });
      queryClient.invalidateQueries({ queryKey: ['/api/agent-jobs?status=failed&limit=10'] });
      queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
      Alert.alert('Retry queued', 'Jarvis will try this job again.');
    },
    onError: () => {
      Alert.alert('Error', 'Could not retry this job.');
    },
  });

  const approveDeliverableMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/deliverables/${id}/approve`, {});
      return res.json() as Promise<{ ok: boolean; gmailDraftUrl?: string }>;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables'] });
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables?triageSection=auto_handled'] });
      queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
      const approvedItem = deliverables.find(d => d.id === variables);
      if (approvedItem?.type === 'approval_gate') {
        Alert.alert('Approved', 'The action has been approved and will continue.');
        return;
      }
      Alert.alert(
        'Approved',
        data?.gmailDraftUrl
          ? 'Email saved to Gmail drafts.'
          : 'Saved to your Documents library.',
      );
    },
    onError: () => {
      Alert.alert('Error', 'Could not approve this item.');
    },
  });

  const discardDeliverableMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/deliverables/${id}/discard`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables'] });
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables?triageSection=auto_handled'] });
      queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
    },
  });

  const saveToDriveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/deliverables/${id}/save-to-drive`, {});
      const data = await res.json();
      if (!res.ok) throw new DriveApiError(data.error || 'Failed to save to Drive', data.code || 'DRIVE_ERROR');
      return data as { ok: boolean; driveLink: string };
    },
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables'] });
      queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
      if (data.driveLink) {
        Alert.alert('Saved to Drive', 'Your document has been saved to Google Drive.', [
          { text: 'Open', onPress: () => Linking.openURL(data.driveLink) },
          { text: 'OK' },
        ]);
      }
    },
    onError: (err: Error) => {
      if (err instanceof DriveApiError && err.code === 'DRIVE_NOT_CONNECTED') {
        Alert.alert(
          'Google Drive not connected',
          'Connect Google Drive in Settings to save documents directly to your Drive.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Go to Settings',
              onPress: () => router.push({ pathname: '/(tabs)/profile', params: { focus: 'drive' } }),
            },
          ],
        );
      } else {
        Alert.alert('Error', err.message || 'Could not save to Drive.');
      }
    },
  });

  const rejectGateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/deliverables/${id}/reject`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables'] });
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables?triageSection=auto_handled'] });
      queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
    },
    onError: () => {
      Alert.alert('Error', 'Could not decline this request.');
    },
  });

  const [editingDeliverable, setEditingDeliverable] = useState<Deliverable | null>(null);
  const [revisingDeliverable, setRevisingDeliverable] = useState<Deliverable | null>(null);
  const [viewingDeliverable, setViewingDeliverable] = useState<Deliverable | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editTo, setEditTo] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [revisionInstructions, setRevisionInstructions] = useState('');

  const openEditDeliverable = useCallback((d: Deliverable) => {
    const meta = (d.meta as { to?: string; subject?: string; emailBody?: string } | null) || {};
    setEditingDeliverable(d);
    setEditTitle(d.title);
    setEditBody(d.type === 'email_draft' ? (meta.emailBody || d.body) : d.body);
    setEditTo(meta.to || '');
    setEditSubject(meta.subject || '');
  }, []);

  const closeEditDeliverable = useCallback(() => {
    setEditingDeliverable(null);
  }, []);

  const openReviseDeliverable = useCallback((d: Deliverable) => {
    setRevisingDeliverable(d);
    setRevisionInstructions('');
  }, []);

  const closeReviseDeliverable = useCallback(() => {
    setRevisingDeliverable(null);
    setRevisionInstructions('');
  }, []);

  const closeViewingDeliverable = useCallback(() => {
    setViewingDeliverable(null);
  }, []);

  const editDeliverableMutation = useMutation({
    mutationFn: async (input: { id: string; payload: Record<string, unknown> }) => {
      const res = await apiRequest('PUT', `/api/deliverables/${input.id}`, input.payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables'] });
      closeEditDeliverable();
    },
    onError: () => {
      Alert.alert('Error', 'Could not save your edits.');
    },
  });

  const saveEdit = useCallback(() => {
    if (!editingDeliverable) return;
    const payload: Record<string, unknown> = {
      title: editTitle,
      body: editBody,
    };
    if (editingDeliverable.type === 'email_draft') {
      payload.meta = {
        to: editTo,
        subject: editSubject,
        emailBody: editBody,
      };
    }
    editDeliverableMutation.mutate({ id: editingDeliverable.id, payload });
  }, [editingDeliverable, editTitle, editBody, editTo, editSubject, editDeliverableMutation]);

  const reviseDeliverableMutation = useMutation({
    mutationFn: async (input: { id: string; instructions: string }) => {
      const res = await apiRequest('POST', `/api/deliverables/${input.id}/revise`, {
        instructions: input.instructions,
      });
      return res.json() as Promise<{ ok: boolean; jobId: string; status: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables'] });
      queryClient.invalidateQueries({ queryKey: ['/api/agent-jobs/active'] });
      closeReviseDeliverable();
      Alert.alert('Revision queued', 'Jarvis will create a new version for review.');
    },
    onError: () => {
      Alert.alert('Error', 'Could not request a revision.');
    },
  });

  const submitRevision = useCallback(() => {
    if (!revisingDeliverable || !revisionInstructions.trim()) return;
    reviseDeliverableMutation.mutate({
      id: revisingDeliverable.id,
      instructions: revisionInstructions.trim(),
    });
  }, [revisingDeliverable, revisionInstructions, reviseDeliverableMutation]);

  const actionMutation = useMutation({
    mutationFn: async ({ itemId, actionType }: { itemId: string; actionType: string }) => {
      const res = await apiRequest('POST', `/api/inbox/items/${itemId}/action`, { actionType });
      return res.json();
    },
    onSuccess: (data: { message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/inbox/items'] });
      if (data?.message) {
        Alert.alert('Done', data.message);
      }
    },
    onError: () => {
      Alert.alert('Error', 'Action failed. Please try again.');
    },
  });

  const approveDraftMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await apiRequest('POST', `/api/email-drafts/${draftId}/approve`, {});
      return res.json() as Promise<{ success: boolean; gmailDraftUrl?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-drafts'] });
      Alert.alert(
        'Draft saved to Gmail',
        data?.gmailDraftUrl
          ? 'Open Gmail to review and send.'
          : 'The reply is now in your Gmail drafts.',
      );
    },
    onError: () => {
      Alert.alert('Error', 'Could not save the draft to Gmail.');
    },
  });

  const discardDraftMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await apiRequest('POST', `/api/email-drafts/${draftId}/discard`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-drafts'] });
    },
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
      refetchDrafts();
      refetchDeliverables();
      refetchAutoHandled();
      refetchActiveJobs();
      refetchFailedJobs();
      refetchGut();
    }, [refetch, refetchDrafts, refetchDeliverables, refetchAutoHandled, refetchActiveJobs, refetchFailedJobs, refetchGut])
  );

  const handleAction = (itemId: string, actionType: string, sourceId?: string, payload?: Record<string, unknown>) => {
    if (actionType === 'never_again') {
      Alert.alert(
        'Never show again?',
        'This will create a rule to suppress similar items in the future.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes, suppress', onPress: () => actionMutation.mutate({ itemId, actionType }) },
        ]
      );
      return;
    }
    if (actionType === 'navigate_telegram_health') {
      actionMutation.mutate({ itemId, actionType });
      router.push({ pathname: '/(tabs)/profile', params: { focus: 'telegram_webhook' } });
      return;
    }
    if (actionType === 'navigate_self_repair') {
      actionMutation.mutate({ itemId, actionType });
      const params: Record<string, string> = { focus: 'self_repair' };
      if (sourceId) {
        // sourceId format: self-repair:<result>:<ts>:<file>
        // The <ts> may be an ISO timestamp (which itself contains colons).
        const parts = sourceId.split(':');
        if (parts.length >= 4 && parts[0] === 'self-repair') {
          let auditTs: string;
          let auditFile: string;
          if (parts[2].includes('T')) {
            // ISO timestamp spans parts[2], parts[3], parts[4] (e.g. "2024-04-28T12", "30", "45.123Z")
            auditTs = parts.slice(2, 5).join(':');
            auditFile = parts.slice(5).join(':');
          } else {
            // Numeric Date.now() timestamp
            auditTs = parts[2];
            auditFile = parts.slice(3).join(':');
          }
          if (auditTs) params.auditTs = auditTs;
          if (auditFile) params.auditFile = auditFile;
        }
      }
      router.push({ pathname: '/(tabs)/agents', params });
      return;
    }
    if (actionType === 'review_approval') {
      actionMutation.mutate({ itemId, actionType });
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      const gateId = payload?.gateId as string | undefined;
      if (gateId) {
        const matchingDeliverable = deliverables.find(
          d => d.type === 'approval_gate' && (d.meta as { gateId?: string } | null)?.gateId === gateId
        );
        if (matchingDeliverable) {
          setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
        }
      }
      return;
    }
    actionMutation.mutate({ itemId, actionType });
  };

  const renderItem = ({ item, index }: { item: InboxItem; index: number }) => {
    const senderName = getSenderName(item.sender);
    const src = getSourceConfig(item.sourceType);
    const actions = (item.suggestedActions || []).filter(a => SUPPORTED_ACTION_TYPES.has(a.actionType));
    const gutSignal = gutByItemRef.get(item.id) ?? gutByItemRef.get(item.sourceId);

    return (
      <Animated.View entering={FadeInDown.duration(300).delay(index * 60)}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.sourceIcon, { backgroundColor: src.bgColor }]}>
              <Ionicons name={src.icon} size={18} color={src.color} />
            </View>
            <View style={styles.cardHeaderText}>
              <Text style={styles.senderName} numberOfLines={1}>{senderName}</Text>
              <View style={styles.cardHeaderRight}>
                <View style={[styles.sourceBadge, { backgroundColor: src.bgColor }]}>
                  <Text style={[styles.sourceBadgeText, { color: src.color }]}>{src.label}</Text>
                </View>
                <Text style={styles.timestamp}>
                  {new Date(item.surfacedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.subject} numberOfLines={2}>{item.subject || 'No subject'}</Text>

          {item.snippet && (
            <Text style={styles.snippet} numberOfLines={2}>{item.snippet}</Text>
          )}

          {item.jarvisReason && (
            <View style={styles.reasonContainer}>
              <Ionicons name="sparkles" size={12} color={Colors.primary} />
              <Text style={styles.reasonText}>{item.jarvisReason}</Text>
            </View>
          )}

          {gutSignal && (
            <Pressable style={styles.gutFlagRow} onPress={() => setGutModalSignal(gutSignal)}>
              <Ionicons name="eye-outline" size={12} color="#F59E0B" />
              <Text style={styles.gutFlagText} numberOfLines={2}>{gutSignal.explanation}</Text>
              <Ionicons name="chevron-forward" size={12} color="#F59E0B" />
            </Pressable>
          )}

          <View style={styles.actionsRow}>
            {actions.slice(0, 3).map((action, i) => {
              const isDismiss = action.actionType === 'dismiss';
              return (
                <Pressable
                  key={i}
                  style={[styles.actionButton, isDismiss && styles.actionButtonDismiss]}
                  onPress={() => handleAction(item.id, action.actionType, item.sourceId, action.payload)}
                  disabled={actionMutation.isPending}
                >
                  <Text style={[styles.actionText, isDismiss && styles.actionTextDismiss]}>
                    {action.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={styles.neverButton}
              onPress={() => handleAction(item.id, 'never_again')}
              disabled={actionMutation.isPending}
            >
              <Ionicons name="ban" size={14} color={Colors.error} />
            </Pressable>
          </View>
        </View>
      </Animated.View>
    );
  };

  const renderDailyCommandCard = () => {
    if (!dailyCommand) return null;
    const config = getDailyCommandStatusConfig(dailyCommand.status);
    const tasks = dailyCommand.plan?.tasks || [];
    const openTasks = tasks.filter((task) => task.completed !== true).length;
    const warnings = dailyCommand.contextWarnings || [];
    const activeCount = dailyCommand.jobs?.active?.length ?? 0;
    const failedCount = dailyCommand.jobs?.failed?.length ?? 0;
    const approvalCount = dailyCommand.approvals?.pendingCount ?? 0;
    const attentionCount = dailyCommand.attention?.pendingCount ?? 0;
    const statusReasons = dailyCommand.statusReasons || [];
    return (
      <View style={styles.dailyCommandCard}>
        <View style={styles.dailyCommandHeader}>
          <View style={[styles.dailyCommandIcon, { backgroundColor: config.color + '18' }]}>
            {dailyCommand.status === 'working' ? (
              <ActivityIndicator size="small" color={config.color} />
            ) : (
              <Ionicons name={config.icon} size={18} color={config.color} />
            )}
          </View>
          <View style={styles.dailyCommandHeaderText}>
            <Text style={styles.dailyCommandTitle}>{config.label}</Text>
            <Text style={styles.dailyCommandSubtitle} numberOfLines={2}>{config.detail}</Text>
          </View>
          <Pressable
            style={[styles.dailyCommandRefresh, dailyPlanEditorOpen && styles.dailyCommandRefreshActive]}
            onPress={() => setDailyPlanEditorOpen((open) => !open)}
            testID="daily-command-toggle-plan-editor"
          >
            <Ionicons name={dailyPlanEditorOpen ? 'create' : 'create-outline'} size={17} color={Colors.primary} />
          </Pressable>
          <Pressable
            style={styles.dailyCommandRefresh}
            onPress={() => refreshDailyPlanMutation.mutate()}
            disabled={refreshDailyPlanMutation.isPending}
            testID="daily-command-refresh-plan"
          >
            {refreshDailyPlanMutation.isPending ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Ionicons name="refresh-outline" size={17} color={Colors.primary} />
            )}
          </Pressable>
        </View>

        <View style={styles.dailyCommandStats}>
          <View style={styles.dailyCommandStat}>
            <Text style={styles.dailyCommandStatValue}>{openTasks}</Text>
            <Text style={styles.dailyCommandStatLabel}>plan</Text>
          </View>
          <View style={styles.dailyCommandStat}>
            <Text style={styles.dailyCommandStatValue}>{attentionCount}</Text>
            <Text style={styles.dailyCommandStatLabel}>attention</Text>
          </View>
          <View style={styles.dailyCommandStat}>
            <Text style={styles.dailyCommandStatValue}>{activeCount}</Text>
            <Text style={styles.dailyCommandStatLabel}>working</Text>
          </View>
          <View style={styles.dailyCommandStat}>
            <Text style={[styles.dailyCommandStatValue, failedCount > 0 && { color: Colors.error }]}>{failedCount}</Text>
            <Text style={styles.dailyCommandStatLabel}>failed</Text>
          </View>
          <View style={styles.dailyCommandStat}>
            <Text style={[styles.dailyCommandStatValue, approvalCount > 0 && { color: '#F59E0B' }]}>{approvalCount}</Text>
            <Text style={styles.dailyCommandStatLabel}>approval</Text>
          </View>
        </View>

        <View style={styles.dailyCommandLoopRow}>
          <View style={[styles.loopPill, dailyCommand.reminders?.morningBriefSent && styles.loopPillDone]}>
            <Ionicons
              name={dailyCommand.reminders?.morningBriefSent ? 'checkmark-circle' : 'ellipse-outline'}
              size={12}
              color={dailyCommand.reminders?.morningBriefSent ? Colors.success : Colors.textTertiary}
            />
            <Text style={styles.loopPillText}>Morning</Text>
          </View>
          <View style={[styles.loopPill, dailyCommand.reminders?.eveningWrapSent && styles.loopPillDone]}>
            <Ionicons
              name={dailyCommand.reminders?.eveningWrapSent ? 'checkmark-circle' : 'ellipse-outline'}
              size={12}
              color={dailyCommand.reminders?.eveningWrapSent ? Colors.success : Colors.textTertiary}
            />
            <Text style={styles.loopPillText}>Evening</Text>
          </View>
          <View style={[styles.loopPill, dailyCommand.dream?.pendingCount > 0 && styles.loopPillActive]}>
            <Ionicons name="moon-outline" size={12} color={dailyCommand.dream?.pendingCount > 0 ? Colors.primary : Colors.textTertiary} />
            <Text style={styles.loopPillText}>
              Dream{dailyCommand.dream?.pendingCount > 0 ? ` ${dailyCommand.dream.pendingCount}` : ''}
            </Text>
          </View>
        </View>

        {dailyPlanEditorOpen && (
          <DailyCommandPlanEditor
            tasks={tasks}
            busy={patchDailyPlanMutation.isPending}
            onPatch={(patch) => patchDailyPlanMutation.mutate(patch)}
          />
        )}

        {statusReasons.length > 0 && (
          <View style={styles.dailyCommandReasons}>
            {statusReasons.slice(0, 3).map((reason, index) => (
              <View key={`${reason.state}-${reason.action || 'status'}-${index}`} style={styles.dailyCommandReasonRow}>
                <Ionicons
                  name={
                    reason.severity === 'error'
                      ? 'alert-circle-outline'
                      : reason.severity === 'warning'
                        ? 'shield-checkmark-outline'
                        : 'checkmark-circle-outline'
                  }
                  size={13}
                  color={reason.severity === 'error' ? Colors.error : reason.severity === 'warning' ? '#F59E0B' : Colors.success}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.dailyCommandReasonLabel}>{reason.label}</Text>
                  <Text style={styles.dailyCommandReasonText} numberOfLines={2}>{reason.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {warnings.length > 0 && (
          <View style={styles.dailyCommandWarnings}>
            {warnings.slice(0, 2).map((warning, index) => (
              <View key={`${warning.source}-${index}`} style={styles.dailyCommandWarningRow}>
                <Ionicons
                  name={warning.severity === 'error' ? 'alert-circle-outline' : 'information-circle-outline'}
                  size={13}
                  color={warning.severity === 'error' ? Colors.error : '#F59E0B'}
                />
                <Text style={styles.dailyCommandWarningText} numberOfLines={2}>{warning.message}</Text>
              </View>
            ))}
          </View>
        )}

        <MindTraceDebugPanel
          traces={mindTraceData?.traces ?? []}
          loading={mindTraceLoading}
        />
      </View>
    );
  };

  const renderDeliverables = () => {
    if (deliverables.length === 0) return null;
    return (
      <View style={styles.draftSection}>
        <View style={styles.draftHeader}>
          <Ionicons name="sparkles" size={16} color={Colors.primary} />
          <Text style={styles.draftHeaderText}>
            Needs your review · {deliverables.length} item{deliverables.length === 1 ? '' : 's'}
          </Text>
        </View>
        {deliverables.map((d, index) => {
          const icon = DELIVERABLE_ICON[d.type] || 'document-text';
          const typeLabel = DELIVERABLE_LABEL[d.type] || d.type;
          const review = d.review;
          const canSaveToDrive = review?.canSaveToDrive !== false;
          const busy =
            (approveDeliverableMutation.isPending && approveDeliverableMutation.variables === d.id) ||
            (discardDeliverableMutation.isPending && discardDeliverableMutation.variables === d.id) ||
            (rejectGateMutation.isPending && rejectGateMutation.variables === d.id) ||
            (saveToDriveMutation.isPending && saveToDriveMutation.variables === d.id) ||
            (reviseDeliverableMutation.isPending && reviseDeliverableMutation.variables?.id === d.id);
          const meta = d.meta as {
            to?: string;
            subject?: string;
            noSourceUrls?: boolean;
            verificationPassed?: boolean | null;
            verificationRetries?: number;
          } | null;
          const verificationPassed = meta?.verificationPassed;
          const verificationRetries = meta?.verificationRetries ?? 0;
          const bodyText = getDeliverableBody(d);
          const previewText = review?.preview || normalizePreviewText(d.summary) || bodyText;
          const longDeliverable = isLongDeliverable(d);
          const revisionInfo = getDeliverableRevisionInfo(d);
          return (
            <Animated.View key={d.id} entering={FadeInDown.duration(300).delay(index * 60)}>
              <View style={styles.draftCard}>
                <View style={styles.cardHeader}>
                  <View style={[styles.sourceIcon, { backgroundColor: Colors.primary + '15' }]}>
                    <Ionicons name={icon} size={18} color={Colors.primary} />
                  </View>
                  <View style={styles.cardHeaderText}>
                    <Text style={styles.senderName} numberOfLines={1}>{typeLabel}</Text>
                    <Text style={styles.timestamp}>
                      {new Date(d.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>

                <Text style={styles.subject} numberOfLines={2}>{d.title}</Text>

                {review ? (
                  <View style={styles.jobStatusRow}>
                    <View style={[styles.jobTypeBadge, { backgroundColor: Colors.primary + '14' }]}>
                      <Text style={[styles.jobTypeBadgeText, { color: Colors.primary }]}>{review.label}</Text>
                    </View>
                    <Text style={styles.jobStatusText} numberOfLines={1}>{review.nextAction}</Text>
                  </View>
                ) : null}

                {d.type === 'email_draft' && meta?.to && (
                  <View style={styles.reasonContainer}>
                    <Ionicons name="arrow-forward-outline" size={12} color={Colors.primary} />
                    <Text style={styles.reasonText} numberOfLines={1}>To: {meta.to}</Text>
                  </View>
                )}
                {d.type === 'approval_gate' && (() => {
                  const gateMeta = d.meta as { policyApplied?: string; toolName?: string } | null;
                  const policy = gateMeta?.policyApplied;
                  if (!policy || policy === 'global') return null;
                  return (
                    <View style={[styles.reasonContainer, { backgroundColor: Colors.primary + '10', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 }]}>
                      <Ionicons name="shield-outline" size={12} color={Colors.primary} />
                      <Text style={[styles.reasonText, { color: Colors.primary }]} numberOfLines={1}>
                        Policy: {policy.length > 40 ? policy.slice(0, 40) + '…' : policy}
                      </Text>
                    </View>
                  );
                })()}

                {revisionInfo.isRevision && (
                  <View style={styles.revisionLineageRow}>
                    <Ionicons name="git-compare-outline" size={13} color={Colors.primary} />
                    <Text style={styles.revisionLineageText} numberOfLines={2}>
                      Revision{revisionInfo.instructions ? `: ${revisionInfo.instructions}` : ' of an earlier deliverable'}
                    </Text>
                  </View>
                )}

                {meta?.noSourceUrls && (
                  <View style={styles.noSourcesWarning}>
                    <Ionicons name="warning-outline" size={13} color="#B45309" />
                    <Text style={styles.noSourcesWarningText}>
                      This research may not include live web data — treat findings with caution.
                    </Text>
                  </View>
                )}

                {verificationPassed === true && (
                  <View style={[styles.verifyBadge, styles.verifyBadgePass]}>
                    <Ionicons name="checkmark-circle" size={12} color="#16A34A" />
                    <Text style={[styles.verifyBadgeText, { color: '#16A34A' }]}>
                      Verified{verificationRetries > 0 ? ` (${verificationRetries} retr${verificationRetries === 1 ? 'y' : 'ies'})` : ''}
                    </Text>
                  </View>
                )}
                {verificationPassed === false && (
                  <View style={[styles.verifyBadge, styles.verifyBadgeFail]}>
                    <Ionicons name="flag" size={12} color="#DC2626" />
                    <Text style={[styles.verifyBadgeText, { color: '#DC2626' }]}>
                      Review carefully — quality check did not pass after {verificationRetries} retr{verificationRetries === 1 ? 'y' : 'ies'}
                    </Text>
                  </View>
                )}
                {verificationPassed === null && (
                  <View style={[styles.verifyBadge, styles.verifyBadgeUnknown]}>
                    <Ionicons name="help-circle-outline" size={12} color="#92400E" />
                    <Text style={[styles.verifyBadgeText, { color: '#92400E' }]}>
                      Quality check timed out — verify before acting
                    </Text>
                  </View>
                )}

                <Pressable
                  style={styles.draftBodyBox}
                  onPress={() => setViewingDeliverable(d)}
                  testID={`deliverable-open-${d.id}`}
                >
                  <Text style={styles.draftBodyText} numberOfLines={8}>
                    {previewText}
                  </Text>
                  <View style={styles.draftBodyFooter}>
                    <Text style={styles.draftBodyMeta}>
                      {longDeliverable ? 'Long deliverable' : 'Preview'} · {bodyText.length.toLocaleString()} chars
                    </Text>
                    <View style={styles.openDeliverablePill}>
                      <Ionicons name="reader-outline" size={12} color={Colors.primary} />
                      <Text style={styles.openDeliverableText}>Open full</Text>
                    </View>
                  </View>
                </Pressable>

                {canSaveToDrive && d.driveLink ? (
                  <Pressable
                    style={styles.driveLinkRow}
                    onPress={() => Linking.openURL(d.driveLink!)}
                    testID={`deliverable-drive-link-${d.id}`}
                  >
                    <Ionicons name="logo-google" size={14} color={Colors.primary} />
                    <Text style={styles.driveLinkText}>Open in Drive</Text>
                    <Ionicons name="open-outline" size={13} color={Colors.primary} />
                  </Pressable>
                ) : canSaveToDrive ? (
                  <Pressable
                    style={styles.saveToDriveRow}
                    onPress={() => saveToDriveMutation.mutate(d.id)}
                    disabled={busy}
                    testID={`deliverable-save-to-drive-${d.id}`}
                  >
                    {saveToDriveMutation.isPending && saveToDriveMutation.variables === d.id ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <Ionicons name="logo-google" size={14} color={Colors.primary} />
                    )}
                    <Text style={styles.driveLinkText}>Save to Drive</Text>
                  </Pressable>
                ) : null}

                <View style={styles.actionsRow}>
                  {d.type === 'approval_gate' ? (
                    <>
                      <Pressable
                        style={styles.actionButton}
                        onPress={() => approveDeliverableMutation.mutate(d.id)}
                        disabled={busy}
                        testID={`deliverable-approve-${d.id}`}
                      >
                        <Text style={styles.actionText}>Approve</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.actionButton, styles.actionButtonDismiss]}
                        onPress={() => rejectGateMutation.mutate(d.id)}
                        disabled={busy}
                        testID={`deliverable-decline-${d.id}`}
                      >
                        <Text style={[styles.actionText, styles.actionTextDismiss]}>Decline</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable
                        style={styles.actionButton}
                        onPress={() => approveDeliverableMutation.mutate(d.id)}
                        disabled={busy}
                        testID={`deliverable-approve-${d.id}`}
                      >
                        <Text style={styles.actionText}>
                          {d.type === 'email_draft' ? 'Save to Gmail' : 'Save to Documents'}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.actionButton, styles.actionButtonDismiss]}
                        onPress={() => openReviseDeliverable(d)}
                        disabled={busy}
                        testID={`deliverable-revise-${d.id}`}
                      >
                        <Text style={[styles.actionText, styles.actionTextDismiss]}>Revise</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.actionButton, styles.actionButtonDismiss]}
                        onPress={() => openEditDeliverable(d)}
                        disabled={busy}
                        testID={`deliverable-edit-${d.id}`}
                      >
                        <Text style={[styles.actionText, styles.actionTextDismiss]}>Edit</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.actionButton, styles.actionButtonDismiss]}
                        onPress={() => discardDeliverableMutation.mutate(d.id)}
                        disabled={busy}
                        testID={`deliverable-discard-${d.id}`}
                      >
                        <Text style={[styles.actionText, styles.actionTextDismiss]}>Discard</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  const renderAutoHandledDeliverables = () => {
    const totalCount = autoHandledDeliverables.length + dismissedInboxItems.length;
    if (totalCount === 0) return null;
    const TRIAGE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
      auto_handled: 'checkmark-circle-outline',
      promoted_memory: 'bookmark-outline',
    };
    const TRIAGE_COLOR: Record<string, string> = {
      auto_handled: Colors.success,
      promoted_memory: '#8B5CF6',
    };
    const TRIAGE_LABEL: Record<string, string> = {
      auto_handled: 'Auto-handled',
      promoted_memory: 'Saved to memory',
    };
    return (
      <View style={styles.draftSection}>
        <Pressable
          style={styles.draftHeader}
          onPress={() => setAutoHandledExpanded(!autoHandledExpanded)}
          testID="auto-handled-toggle"
        >
          <Ionicons name="checkmark-done-outline" size={16} color={Colors.textSecondary} />
          <Text style={[styles.draftHeaderText, { color: Colors.textSecondary, flex: 1 }]}>
            Auto-handled · {totalCount} item{totalCount === 1 ? '' : 's'}
          </Text>
          <Ionicons
            name={autoHandledExpanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={Colors.textTertiary}
          />
        </Pressable>
        {autoHandledExpanded && autoHandledDeliverables.map((d, index) => {
          const ts = d.triageStatus || 'auto_handled';
          const statusIcon = TRIAGE_ICONS[ts] || 'checkmark-circle-outline';
          const statusColor = TRIAGE_COLOR[ts] || Colors.success;
          const statusLabel = TRIAGE_LABEL[ts] || 'Auto-handled';
          const icon = DELIVERABLE_ICON[d.type] || 'document-text';
          const typeLabel = DELIVERABLE_LABEL[d.type] || d.type;
          return (
            <Animated.View key={d.id} entering={FadeInDown.duration(300).delay(index * 50)}>
              <View style={[styles.draftCard, styles.autoHandledCard]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.sourceIcon, { backgroundColor: statusColor + '15' }]}>
                    <Ionicons name={icon} size={18} color={statusColor} />
                  </View>
                  <View style={styles.cardHeaderText}>
                    <Text style={[styles.senderName, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {typeLabel}
                    </Text>
                    <Text style={styles.timestamp}>
                      {d.actedAt
                        ? new Date(d.actedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                        : new Date(d.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                  <View style={[styles.triageBadge, { backgroundColor: statusColor + '18' }]}>
                    <Ionicons name={statusIcon} size={11} color={statusColor} />
                    <Text style={[styles.triageBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>
                </View>
                <Text style={[styles.subject, { color: Colors.textSecondary }]} numberOfLines={2}>{d.title}</Text>
                {d.triageNote ? (
                  <View style={styles.triageNoteRow}>
                    <Ionicons name="sparkles" size={11} color={Colors.textTertiary} />
                    <Text style={styles.triageNoteText} numberOfLines={2}>{d.triageNote}</Text>
                  </View>
                ) : null}
              </View>
            </Animated.View>
          );
        })}
        {autoHandledExpanded && dismissedInboxItems.map((item, index) => {
          const offset = autoHandledDeliverables.length;
          return (
            <Animated.View key={item.id} entering={FadeInDown.duration(300).delay((index + offset) * 50)}>
              <View style={[styles.draftCard, styles.autoHandledCard]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.sourceIcon, { backgroundColor: Colors.success + '15' }]}>
                    <Ionicons name="mail-outline" size={18} color={Colors.success} />
                  </View>
                  <View style={styles.cardHeaderText}>
                    <Text style={[styles.senderName, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {item.sender || item.sourceType}
                    </Text>
                    <Text style={styles.timestamp}>
                      {item.actedAt
                        ? new Date(item.actedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                        : new Date(item.surfacedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                  <View style={[styles.triageBadge, { backgroundColor: Colors.success + '18' }]}>
                    <Ionicons name="checkmark-circle-outline" size={11} color={Colors.success} />
                    <Text style={[styles.triageBadgeText, { color: Colors.success }]}>Auto-dismissed</Text>
                  </View>
                </View>
                <Text style={[styles.subject, { color: Colors.textSecondary }]} numberOfLines={2}>
                  {item.subject || '(no subject)'}
                </Text>
                {(item.jarvisReason || item.snippet) ? (
                  <View style={styles.triageNoteRow}>
                    <Ionicons name="sparkles" size={11} color={Colors.textTertiary} />
                    <Text style={styles.triageNoteText} numberOfLines={2}>
                      {item.jarvisReason || item.snippet}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  const renderFailedJobs = () => {
    if (failedJobs.length === 0) return null;
    return (
      <View style={styles.draftSection}>
        <View style={styles.draftHeader}>
          <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
          <Text style={[styles.draftHeaderText, { color: Colors.error }]}>
            Needs retry - {failedJobs.length} failed job{failedJobs.length === 1 ? '' : 's'}
          </Text>
        </View>
        {failedJobs.map((job, index) => {
          const icon = JOB_ICON[job.agentType] || 'sparkles';
          const label = JOB_LABEL[job.agentType] || job.agentType;
          const busy = retryJobMutation.isPending && retryJobMutation.variables === job.id;
          const review = job.review;
          const preview = review?.preview || job.error || job.prompt || 'No details available.';
          return (
            <Animated.View key={job.id} entering={FadeInDown.duration(300).delay(index * 60)}>
              <View style={[styles.jobCard, styles.jobFailedCard]}>
                <View style={styles.jobCardRow}>
                  <View style={[styles.sourceIcon, { backgroundColor: Colors.error + '15' }]}>
                    <Ionicons name={icon} size={18} color={Colors.error} />
                  </View>
                  <View style={styles.jobCardMeta}>
                    <Text style={styles.jobTitle} numberOfLines={2}>{job.title}</Text>
                    <View style={styles.jobStatusRow}>
                      <Ionicons name="warning-outline" size={13} color={Colors.error} style={{ marginRight: 3 }} />
                      <Text style={[styles.jobStatusText, { color: Colors.error }]}>
                        {review?.label || 'Failed'}{job.completedAt ? ` - ${formatElapsed(job.completedAt)} ago` : ''}
                      </Text>
                      <View style={[styles.jobTypeBadge, { backgroundColor: Colors.error + '14' }]}>
                        <Text style={[styles.jobTypeBadgeText, { color: Colors.error }]}>{label}</Text>
                      </View>
                    </View>
                    <View style={styles.jobPreviewBox}>
                      <Text style={styles.jobPreviewText} numberOfLines={3}>{preview}</Text>
                    </View>
                    <View style={styles.actionsRow}>
                      <Pressable
                        style={styles.actionButton}
                        onPress={() => retryJobMutation.mutate(job.id)}
                        disabled={busy}
                        testID={`job-retry-${job.id}`}
                      >
                        <Text style={styles.actionText}>{busy ? 'Queuing...' : (review?.nextAction || 'Retry')}</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  const renderRunningJobs = () => {
    if (activeJobs.length === 0) return null;
    return (
      <View style={styles.draftSection}>
        <View style={styles.draftHeader}>
          <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 2 }} />
          <Text style={styles.draftHeaderText}>
            Running Jobs · {activeJobs.length} in progress
          </Text>
        </View>
        {activeJobs.map((job, index) => {
          const icon = JOB_ICON[job.agentType] || 'sparkles';
          const label = JOB_LABEL[job.agentType] || job.agentType;
          const review = job.review;
          const isRunning = job.status === 'running';
          const isCancelling = job.status === 'cancelling';
          const elapsedFrom = isRunning && job.startedAt ? job.startedAt : job.createdAt;
          const isCancelling_ = cancelJobMutation.isPending && cancelJobMutation.variables === job.id;
          return (
            <Animated.View key={job.id} entering={FadeInDown.duration(300).delay(index * 60)}>
              <View style={styles.jobCard}>
                <View style={styles.jobCardRow}>
                  <View style={[styles.sourceIcon, { backgroundColor: Colors.primary + '15' }]}>
                    <Ionicons name={icon} size={18} color={Colors.primary} />
                  </View>
                  <View style={styles.jobCardMeta}>
                    <Text style={styles.jobTitle} numberOfLines={2}>{job.title}</Text>
                    <View style={styles.jobStatusRow}>
                      {(isRunning || isCancelling) ? (
                        <ActivityIndicator size="small" color={isCancelling ? Colors.textSecondary : Colors.primary} style={{ marginRight: 4 }} />
                      ) : (
                        <Ionicons name="time-outline" size={13} color={Colors.textTertiary} style={{ marginRight: 3 }} />
                      )}
                      <Text style={[styles.jobStatusText, isCancelling && { color: Colors.textSecondary }]}>
                        {isCancelling ? 'Cancelling…' : isRunning ? `Running · ${formatElapsed(elapsedFrom)}` : `Queued · ${formatElapsed(job.createdAt)}`}
                      </Text>
                      <View style={[styles.jobTypeBadge, { backgroundColor: Colors.primary + '18' }]}>
                        <Text style={[styles.jobTypeBadgeText, { color: Colors.primary }]}>{label}</Text>
                      </View>
                    </View>
                    {(review?.preview || job.prompt) ? (
                      <Text style={styles.jobPromptPreview} numberOfLines={2}>{review?.preview || job.prompt}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    style={styles.jobCancelBtn}
                    onPress={() => cancelJobMutation.mutate(job.id)}
                    disabled={isCancelling_ || isCancelling}
                    testID={`job-cancel-${job.id}`}
                  >
                    <Ionicons name="close-circle-outline" size={22} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  // Global "Jarvis noticed" signals: either no itemRef, OR orphaned signals whose
  // itemRef is not an inbox item (e.g. calendar anomalies for events not in inbox).
  // Both cases open the same modal so the user can respond "Good catch" / "This one's fine".
  const globalGutSignals = React.useMemo(
    () => gutSignals.filter(
      (g) => !g.userResponse && (!g.itemRef || !inboxRefSet.has(g.itemRef))
    ),
    [gutSignals, inboxRefSet]
  );

  const renderGutNoticed = () => {
    if (globalGutSignals.length === 0) return null;
    return (
      <View style={styles.gutNoticedSection}>
        <View style={styles.gutNoticedHeader}>
          <Ionicons name="eye-outline" size={14} color="#F59E0B" />
          <Text style={styles.gutNoticedTitle}>Jarvis noticed</Text>
        </View>
        {globalGutSignals.slice(0, 3).map((sig) => (
          <Pressable
            key={sig.id}
            style={styles.gutNoticedRow}
            onPress={() => setGutModalSignal(sig)}
          >
            <Text style={styles.gutNoticedLabel}>{GUT_TYPE_LABEL[sig.signalType] || sig.signalType}</Text>
            <Text style={styles.gutNoticedText} numberOfLines={2}>{sig.explanation}</Text>
          </Pressable>
        ))}
      </View>
    );
  };

  const renderListHeader = () => (
    <View>
      {renderDailyCommandCard()}
      {renderDeliverables()}
      {renderGutNoticed()}
      {renderRunningJobs()}
      {renderFailedJobs()}
      {renderAutoHandledDeliverables()}
      {renderDraftQueue()}
    </View>
  );

  const renderDraftQueue = () => {
    if (drafts.length === 0) return null;
    return (
      <View style={styles.draftSection}>
        <View style={styles.draftHeader}>
          <Ionicons name="create-outline" size={16} color={Colors.primary} />
          <Text style={styles.draftHeaderText}>
            Draft Queue · {drafts.length} reply{drafts.length === 1 ? '' : 'ies'} ready
          </Text>
        </View>
        {drafts.map((draft, index) => {
          const sender = getSenderName(draft.fromSender);
          const busy =
            (approveDraftMutation.isPending && approveDraftMutation.variables === draft.id) ||
            (discardDraftMutation.isPending && discardDraftMutation.variables === draft.id);
          return (
            <Animated.View key={draft.id} entering={FadeInDown.duration(300).delay(index * 60)}>
              <View style={styles.draftCard}>
                <View style={styles.cardHeader}>
                  <View style={[styles.sourceIcon, { backgroundColor: Colors.primary + '15' }]}>
                    <Ionicons name="sparkles" size={18} color={Colors.primary} />
                  </View>
                  <View style={styles.cardHeaderText}>
                    <Text style={styles.senderName} numberOfLines={1}>To: {sender}</Text>
                    <Text style={styles.timestamp}>
                      {new Date(draft.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>

                <Text style={styles.subject} numberOfLines={2}>{draft.draftSubject}</Text>

                {draft.jarvisReason && (
                  <View style={styles.reasonContainer}>
                    <Ionicons name="alert-circle-outline" size={12} color={Colors.primary} />
                    <Text style={styles.reasonText} numberOfLines={2}>{draft.jarvisReason}</Text>
                  </View>
                )}

                <View style={styles.draftBodyBox}>
                  <Text style={styles.draftBodyText} numberOfLines={6}>{draft.draftBody}</Text>
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => approveDraftMutation.mutate(draft.id)}
                    disabled={busy}
                  >
                    <Text style={styles.actionText}>Save to Gmail</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionButton, styles.actionButtonDismiss]}
                    onPress={() => discardDraftMutation.mutate(draft.id)}
                    disabled={busy}
                  >
                    <Text style={[styles.actionText, styles.actionTextDismiss]}>Discard</Text>
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    if (drafts.length > 0) return null;
    if (deliverables.length > 0) return null;
    if (activeJobs.length > 0) return null;
    if (failedJobs.length > 0) return null;
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIcon}>
          <Ionicons name="checkmark-circle" size={48} color={Colors.success} />
        </View>
        <Text style={styles.emptyTitle}>All clear</Text>
        <Text style={styles.emptySubtitle}>
          Jarvis is watching — nothing needs your attention right now
        </Text>
      </View>
    );
  };

  const viewingRevisionInfo = viewingDeliverable ? getDeliverableRevisionInfo(viewingDeliverable) : null;
  const viewingBody = viewingDeliverable ? getDeliverableBody(viewingDeliverable) : '';
  const viewingTypeLabel = viewingDeliverable
    ? (DELIVERABLE_LABEL[viewingDeliverable.type] || viewingDeliverable.type)
    : '';

  return (
    <View style={[styles.container, { paddingTop: isWeb ? 67 : insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inbox</Text>
        {(items.length + deliverables.length + activeJobs.length + failedJobs.length) > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{items.length + deliverables.length + activeJobs.length + failedJobs.length}</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 : insets.bottom + 90 }]}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refreshAll} tintColor={Colors.primary} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={!!viewingDeliverable}
        animationType="slide"
        transparent
        onRequestClose={closeViewingDeliverable}
      >
        <View style={styles.editModalRoot}>
          <View style={styles.reviewSheet}>
            <View style={styles.editHeader}>
              <View style={styles.reviewHeaderText}>
                <Text style={styles.editTitle}>Review deliverable</Text>
                <Text style={styles.reviewKicker} numberOfLines={1}>{viewingTypeLabel}</Text>
              </View>
              <Pressable onPress={closeViewingDeliverable} testID="deliverable-view-close">
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {viewingDeliverable && (
              <ScrollView style={styles.reviewBodyScroll} contentContainerStyle={styles.reviewBodyContent}>
                <Text style={styles.reviewTitle}>{viewingDeliverable.title}</Text>
                <View style={styles.reviewMetaGrid}>
                  <View style={styles.reviewMetaItem}>
                    <Text style={styles.reviewMetaLabel}>Created</Text>
                    <Text style={styles.reviewMetaValue}>
                      {new Date(viewingDeliverable.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <View style={styles.reviewMetaItem}>
                    <Text style={styles.reviewMetaLabel}>Length</Text>
                    <Text style={styles.reviewMetaValue}>{viewingBody.length.toLocaleString()} chars</Text>
                  </View>
                  <View style={styles.reviewMetaItem}>
                    <Text style={styles.reviewMetaLabel}>Status</Text>
                    <Text style={styles.reviewMetaValue}>{viewingDeliverable.review?.label || viewingDeliverable.status}</Text>
                  </View>
                </View>

                {viewingRevisionInfo?.isRevision && (
                  <View style={styles.reviewRevisionBox}>
                    <View style={styles.reviewRevisionHeader}>
                      <Ionicons name="git-compare-outline" size={14} color={Colors.primary} />
                      <Text style={styles.reviewRevisionTitle}>Revision history</Text>
                    </View>
                    {viewingRevisionInfo.instructions ? (
                      <Text style={styles.reviewRevisionText}>{viewingRevisionInfo.instructions}</Text>
                    ) : (
                      <Text style={styles.reviewRevisionText}>This is a revised version of an earlier deliverable.</Text>
                    )}
                    {(viewingRevisionInfo.originalDeliverableId || viewingRevisionInfo.originalJobId) && (
                      <Text style={styles.reviewRevisionIds} numberOfLines={2}>
                        Source {viewingRevisionInfo.originalDeliverableId || viewingRevisionInfo.originalJobId}
                      </Text>
                    )}
                  </View>
                )}

                {viewingDeliverable.summary ? (
                  <View style={styles.reviewSummaryBox}>
                    <Text style={styles.reviewSectionLabel}>Summary</Text>
                    <Text style={styles.reviewSummaryText}>{viewingDeliverable.summary}</Text>
                  </View>
                ) : null}

                <Text style={styles.reviewSectionLabel}>Full content</Text>
                <Text style={styles.reviewBodyText}>{viewingBody}</Text>
              </ScrollView>
            )}

            {viewingDeliverable && (
              <View style={styles.editFooter}>
                <Pressable
                  style={[styles.actionButton, styles.actionButtonDismiss]}
                  onPress={closeViewingDeliverable}
                  testID="deliverable-view-done"
                >
                  <Text style={[styles.actionText, styles.actionTextDismiss]}>Done</Text>
                </Pressable>
                {viewingDeliverable.review?.canRevise && (
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => {
                      const target = viewingDeliverable;
                      closeViewingDeliverable();
                      openReviseDeliverable(target);
                    }}
                    testID="deliverable-view-revise"
                  >
                    <Text style={styles.actionText}>Request revision</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!editingDeliverable}
        animationType="slide"
        transparent
        onRequestClose={closeEditDeliverable}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.editModalRoot}
        >
          <View style={styles.editSheet}>
            <View style={styles.editHeader}>
              <Text style={styles.editTitle}>
                Edit {editingDeliverable ? (DELIVERABLE_LABEL[editingDeliverable.type] || editingDeliverable.type) : ''}
              </Text>
              <Pressable onPress={closeEditDeliverable} testID="deliverable-edit-close">
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView style={styles.editBodyScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.editLabel}>Title</Text>
              <TextInput
                value={editTitle}
                onChangeText={setEditTitle}
                style={styles.editInput}
                placeholder="Title"
                placeholderTextColor={Colors.textTertiary}
                testID="deliverable-edit-title"
              />
              {editingDeliverable?.type === 'email_draft' && (
                <>
                  <Text style={styles.editLabel}>To</Text>
                  <TextInput
                    value={editTo}
                    onChangeText={setEditTo}
                    style={styles.editInput}
                    placeholder="recipient@example.com"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    testID="deliverable-edit-to"
                  />
                  <Text style={styles.editLabel}>Subject</Text>
                  <TextInput
                    value={editSubject}
                    onChangeText={setEditSubject}
                    style={styles.editInput}
                    placeholder="Subject"
                    placeholderTextColor={Colors.textTertiary}
                    testID="deliverable-edit-subject"
                  />
                </>
              )}
              <Text style={styles.editLabel}>
                {editingDeliverable?.type === 'email_draft' ? 'Email body' : 'Body'}
              </Text>
              <TextInput
                value={editBody}
                onChangeText={setEditBody}
                style={[styles.editInput, styles.editBody]}
                placeholder="Content"
                placeholderTextColor={Colors.textTertiary}
                multiline
                textAlignVertical="top"
                testID="deliverable-edit-body"
              />
            </ScrollView>
            <View style={styles.editFooter}>
              <Pressable
                style={[styles.actionButton, styles.actionButtonDismiss]}
                onPress={closeEditDeliverable}
                testID="deliverable-edit-cancel"
              >
                <Text style={[styles.actionText, styles.actionTextDismiss]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={saveEdit}
                disabled={editDeliverableMutation.isPending}
                testID="deliverable-edit-save"
              >
                <Text style={styles.actionText}>
                  {editDeliverableMutation.isPending ? 'Saving…' : 'Save changes'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!revisingDeliverable}
        animationType="slide"
        transparent
        onRequestClose={closeReviseDeliverable}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.editModalRoot}
        >
          <View style={styles.editSheet}>
            <View style={styles.editHeader}>
              <Text style={styles.editTitle}>Request revision</Text>
              <Pressable onPress={closeReviseDeliverable} testID="deliverable-revise-close">
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.reviseItemTitle} numberOfLines={2}>{revisingDeliverable?.title}</Text>
            <Text style={styles.editLabel}>What should Jarvis change?</Text>
            <TextInput
              value={revisionInstructions}
              onChangeText={setRevisionInstructions}
              style={[styles.editInput, styles.editBody]}
              placeholder="Tell Jarvis what to improve, add, remove, or check before sending a new version."
              placeholderTextColor={Colors.textTertiary}
              multiline
              textAlignVertical="top"
              testID="deliverable-revise-instructions"
            />
            <View style={styles.editFooter}>
              <Pressable
                style={[styles.actionButton, styles.actionButtonDismiss]}
                onPress={closeReviseDeliverable}
                disabled={reviseDeliverableMutation.isPending}
                testID="deliverable-revise-cancel"
              >
                <Text style={[styles.actionText, styles.actionTextDismiss]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={submitRevision}
                disabled={!revisionInstructions.trim() || reviseDeliverableMutation.isPending}
                testID="deliverable-revise-submit"
              >
                <Text style={styles.actionText}>
                  {reviseDeliverableMutation.isPending ? 'Queuing...' : 'Queue revision'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!gutModalSignal}
        animationType="fade"
        transparent
        onRequestClose={() => setGutModalSignal(null)}
      >
        <Pressable style={styles.gutModalOverlay} onPress={() => setGutModalSignal(null)}>
          <View style={styles.gutModalCard}>
            <View style={styles.gutModalHeader}>
              <Ionicons name="eye" size={18} color="#F59E0B" />
              <Text style={styles.gutModalTitle}>
                {gutModalSignal ? (GUT_TYPE_LABEL[gutModalSignal.signalType] || 'Jarvis flagged this') : ''}
              </Text>
            </View>
            <Text style={styles.gutModalExplanation}>{gutModalSignal?.explanation}</Text>
            <View style={styles.gutModalActions}>
              <Pressable
                style={[styles.gutModalBtn, styles.gutModalBtnConfirm]}
                onPress={() => gutModalSignal && respondGutMutation.mutate({ id: gutModalSignal.id, response: 'confirmed' })}
                disabled={respondGutMutation.isPending}
              >
                <Text style={styles.gutModalBtnConfirmText}>Good catch</Text>
              </Pressable>
              <Pressable
                style={[styles.gutModalBtn, styles.gutModalBtnDismiss]}
                onPress={() => gutModalSignal && respondGutMutation.mutate({ id: gutModalSignal.id, response: 'dismissed' })}
                disabled={respondGutMutation.isPending}
              >
                <Text style={styles.gutModalBtnDismissText}>This one is fine</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  editModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  editSheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '85%',
  },
  reviewSheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '90%',
  },
  editHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  editTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  reviewHeaderText: {
    flex: 1,
    paddingRight: 12,
  },
  reviewKicker: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  reviewBodyScroll: {
    maxHeight: 620,
  },
  reviewBodyContent: {
    paddingBottom: 8,
  },
  reviewTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    lineHeight: 24,
    marginBottom: 12,
  },
  reviewMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  reviewMetaItem: {
    minWidth: 100,
    flexGrow: 1,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  reviewMetaLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  reviewMetaValue: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  reviewRevisionBox: {
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '25',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  reviewRevisionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  reviewRevisionTitle: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
  },
  reviewRevisionText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 18,
  },
  reviewRevisionIds: {
    marginTop: 6,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
  },
  reviewSummaryBox: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  reviewSectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  reviewSummaryText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
    lineHeight: 18,
  },
  reviewBodyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 21,
  },
  reviseItemTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 4,
  },
  editBodyScroll: {
    maxHeight: 480,
  },
  editLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    marginTop: 12,
    marginBottom: 6,
  },
  editInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  editBody: {
    minHeight: 180,
  },
  editFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  badge: {
    backgroundColor: Colors.error,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 10,
  },
  badgeText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  list: {
    paddingHorizontal: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sourceIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeaderText: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginLeft: 10,
  },
  senderName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    flex: 1,
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
  },
  timestamp: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  subject: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 4,
  },
  snippet: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  reasonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  reasonText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.primary,
    fontStyle: 'italic' as const,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  actionButton: {
    backgroundColor: Colors.primary + '12',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionButtonDismiss: {
    backgroundColor: Colors.surfaceAlt,
  },
  actionText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  actionTextDismiss: {
    color: Colors.textSecondary,
  },
  neverButton: {
    marginLeft: 'auto' as const,
    padding: 8,
  },
  dailyCommandCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dailyCommandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dailyCommandIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dailyCommandHeaderText: {
    flex: 1,
  },
  dailyCommandTitle: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  dailyCommandSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },
  dailyCommandRefresh: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '10',
  },
  dailyCommandRefreshActive: {
    backgroundColor: Colors.greenDim,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  dailyCommandStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  dailyCommandStat: {
    minWidth: 58,
    flexGrow: 1,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  dailyCommandStatValue: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  dailyCommandStatLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    marginTop: 1,
  },
  dailyCommandLoopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  loopPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: Colors.surfaceAlt,
  },
  loopPillDone: {
    backgroundColor: Colors.success + '12',
  },
  loopPillActive: {
    backgroundColor: Colors.primary + '12',
  },
  loopPillText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
  dailyCommandReasons: {
    marginTop: 10,
    gap: 6,
  },
  dailyCommandReasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  dailyCommandReasonLabel: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  dailyCommandReasonText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 16,
    marginTop: 1,
  },
  dailyCommandWarnings: {
    marginTop: 10,
    gap: 6,
  },
  dailyCommandWarningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  dailyCommandWarningText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#92400E',
    lineHeight: 16,
  },
  draftSection: {
    marginBottom: 8,
  },
  draftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  draftHeaderText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  draftCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  noSourcesWarning: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 6,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  noSourcesWarningText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#92400E',
    lineHeight: 17,
  },
  verifyBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 8,
    borderWidth: 1,
  },
  verifyBadgePass: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  verifyBadgeFail: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  verifyBadgeUnknown: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FCD34D',
  },
  verifyBadgeText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    lineHeight: 15,
  },
  revisionLineageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.primary + '10',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginBottom: 8,
  },
  revisionLineageText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
    lineHeight: 16,
  },
  driveLinkRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: Colors.primary + '12',
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: 'flex-start' as const,
  },
  saveToDriveRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: Colors.primary + '08',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: 'flex-start' as const,
  },
  driveLinkText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  draftBodyBox: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  draftBodyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 18,
  },
  draftBodyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
  },
  draftBodyMeta: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
  },
  openDeliverablePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  openDeliverableText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  autoHandledCard: {
    borderColor: Colors.border,
    opacity: 0.85,
  },
  triageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 3,
  },
  triageBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  triageNoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 4,
  },
  triageNoteText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    flex: 1,
    lineHeight: 15,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  jobCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  jobFailedCard: {
    borderColor: Colors.error + '30',
  },
  jobCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jobCardMeta: {
    flex: 1,
    gap: 4,
  },
  jobTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  jobStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap' as const,
  },
  jobStatusText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.primary,
  },
  jobPromptPreview: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  jobPreviewBox: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  jobPreviewText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  jobTypeBadge: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
  },
  jobTypeBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
  },
  jobCancelBtn: {
    padding: 4,
  },
  gutNoticedSection: {
    backgroundColor: '#F59E0B08',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B25',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    gap: 6,
  },
  gutNoticedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  gutNoticedTitle: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#D97706',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  gutNoticedRow: {
    paddingVertical: 4,
    gap: 2,
  },
  gutNoticedLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#92400E',
  },
  gutNoticedText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#92400E',
    lineHeight: 17,
    opacity: 0.8,
  },
  gutFlagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F59E0B10',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F59E0B30',
  },
  gutFlagText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: '#92400E',
    lineHeight: 17,
  },
  gutModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  gutModalCard: {
    backgroundColor: Colors.background,
    borderRadius: 18,
    padding: 22,
    width: '100%',
    maxWidth: 420,
    gap: 14,
  },
  gutModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gutModalTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  gutModalExplanation: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 21,
  },
  gutModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  gutModalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  gutModalBtnConfirm: {
    backgroundColor: '#F59E0B20',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  gutModalBtnConfirmText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#D97706',
  },
  gutModalBtnDismiss: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  gutModalBtnDismissText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
});
