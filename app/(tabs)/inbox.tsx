import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { getApiUrl, apiRequest } from '@/lib/query-client';

interface InboxItem {
  id: string;
  sourceType: string;
  sourceId: string;
  subject: string | null;
  sender: string | null;
  snippet: string | null;
  jarvisReason: string | null;
  suggestedActions: { label: string; actionType: string }[] | null;
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
  status: string;
  createdAt: string;
  startedAt: string | null;
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
  createdAt: string;
  actedAt: string | null;
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
  writing: 'create',
  planning: 'list',
  email: 'mail',
  goal_decompose: 'git-branch',
  weekly_pattern: 'analytics',
};

const JOB_LABEL: Record<string, string> = {
  research: 'Research',
  writing: 'Writing',
  planning: 'Planning',
  email: 'Email',
  goal_decompose: 'Goal breakdown',
  weekly_pattern: 'Weekly review',
};

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
  'navigate_self_repair',
]);

export default function InboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const queryClient = useQueryClient();

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

  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest('POST', `/api/agent-jobs/${jobId}/cancel`, {});
      return res.json() as Promise<{ ok: boolean; status: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agent-jobs/active'] });
    },
    onError: () => {
      Alert.alert('Error', 'Could not cancel this job.');
    },
  });

  const approveDeliverableMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/deliverables/${id}/approve`, {});
      return res.json() as Promise<{ ok: boolean; gmailDraftUrl?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables'] });
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables?triageSection=auto_handled'] });
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
    },
  });

  const [editingDeliverable, setEditingDeliverable] = useState<Deliverable | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editTo, setEditTo] = useState('');
  const [editSubject, setEditSubject] = useState('');

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
      refetchGut();
    }, [refetch, refetchDrafts, refetchDeliverables, refetchAutoHandled, refetchActiveJobs, refetchGut])
  );

  const handleAction = (itemId: string, actionType: string) => {
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
      router.push({ pathname: '/(tabs)/agents', params: { focus: 'self_repair' } });
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
                  onPress={() => handleAction(item.id, action.actionType)}
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
          const busy =
            (approveDeliverableMutation.isPending && approveDeliverableMutation.variables === d.id) ||
            (discardDeliverableMutation.isPending && discardDeliverableMutation.variables === d.id);
          const meta = d.meta as { to?: string; subject?: string } | null;
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

                <View style={styles.draftBodyBox}>
                  <Text style={styles.draftBodyText} numberOfLines={8}>
                    {d.summary || d.body}
                  </Text>
                </View>

                <View style={styles.actionsRow}>
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
      {renderGutNoticed()}
      {renderRunningJobs()}
      {renderDeliverables()}
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

  return (
    <View style={[styles.container, { paddingTop: isWeb ? 67 : insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inbox</Text>
        {(items.length + deliverables.length) > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{items.length + deliverables.length}</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 : insets.bottom + 90 }]}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.primary} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

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
                <Text style={styles.gutModalBtnDismissText}>This one's fine</Text>
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
