import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';

interface LastShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  ranAt: string;
}

interface ScheduledTask {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  recurrence: string | null;
  taskKind?: 'user_task' | 'jarvis_action' | null;
  completedAt: string | null;
  createdAt: string;
  shellCommand: string | null;
  lastShellResult: LastShellResult | null;
  inProgressAt: string | null;
  active: boolean;
  needsAttention: boolean;
  attentionQuestion: string | null;
}

interface AgentJob {
  id: string;
  title: string;
  agentType: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  input?: {
    workerType?: string;
    workerRuntime?: {
      progress?: {
        currentStep?: string;
        percent?: number;
      };
    };
  } | null;
}

interface ReviewItem {
  id: string;
  title: string;
  type: string;
  summary: string | null;
  body: string;
  createdAt: string;
  jobId: string | null;
}

interface QueuePanelData {
  reviewItems: ReviewItem[];
  activeJobs: AgentJob[];
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function formatRelative(dt: string): string {
  const diff = Date.now() - new Date(dt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatScheduled(dt: string): string {
  const d = new Date(dt);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff < 0) return 'overdue';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.floor(hrs / 24)}d`;
}

function NeedsYouCard({ task }: { task: ScheduledTask }) {
  const [answer, setAnswer] = useState('');
  const queryClient = useQueryClient();

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/jarvis/scheduled-tasks/${task.id}/resolve`, { userAnswer: answer });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jarvis/scheduled-tasks'] });
      setAnswer('');
    },
    onError: () => Alert.alert('Error', 'Could not save your answer. Please try again.'),
  });

  return (
    <View style={styles.needsYouCard}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Ionicons name="alert-circle" size={14} color={Colors.purple} style={{ marginTop: 1 }} />
          <Text style={styles.cardTitle} numberOfLines={2}>{task.title}</Text>
        </View>
        {task.recurrence && (
          <View style={styles.recurrenceBadge}>
            <Ionicons name="repeat" size={9} color={Colors.purple} />
            <Text style={styles.recurrenceText}>{task.recurrence.toUpperCase()}</Text>
          </View>
        )}
      </View>
      {task.attentionQuestion ? (
        <Text style={styles.attentionQuestion}>{task.attentionQuestion}</Text>
      ) : null}
      <TextInput
        style={styles.answerInput}
        placeholder="Type your answer…"
        placeholderTextColor={Colors.textTertiary}
        value={answer}
        onChangeText={setAnswer}
        multiline
      />
      <Pressable
        style={[styles.sendBtn, (!answer.trim() || resolveMutation.isPending) && styles.sendBtnDisabled]}
        onPress={() => answer.trim() && resolveMutation.mutate()}
        disabled={!answer.trim() || resolveMutation.isPending}
      >
        {resolveMutation.isPending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.sendBtnText}>Send Answer</Text>
        )}
      </Pressable>
    </View>
  );
}

function ReviewItemCard({ item }: { item: ReviewItem }) {
  const queryClient = useQueryClient();
  const [busyAction, setBusyAction] = useState<'approve' | 'reject' | null>(null);

  const reviewMutation = useMutation({
    mutationFn: async (action: 'approve' | 'reject') => {
      setBusyAction(action);
      const res = await apiRequest('POST', `/api/deliverables/${item.id}/${action}`, {});
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/mission-control/queue-panel'] }),
    onError: () => Alert.alert('Review failed', 'Jarvis could not update this item. Please try again.'),
    onSettled: () => setBusyAction(null),
  });

  const reviewLabel = item.type === 'approval_gate' ? 'Approval request' : 'Review item';
  const preview = item.summary || item.body;

  return (
    <View style={styles.reviewCard}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Ionicons name="shield-checkmark-outline" size={14} color={Colors.warning} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.reviewMeta}>{reviewLabel} - {formatRelative(item.createdAt)}</Text>
          </View>
        </View>
      </View>
      {preview ? (
        <Text style={styles.reviewPreview} numberOfLines={3}>{preview}</Text>
      ) : null}
      <View style={styles.reviewActions}>
        <Pressable
          style={[styles.reviewBtn, styles.rejectBtn]}
          onPress={() => reviewMutation.mutate('reject')}
          disabled={reviewMutation.isPending}
        >
          {busyAction === 'reject' ? (
            <ActivityIndicator size="small" color={Colors.error} />
          ) : (
            <>
              <Ionicons name="close" size={14} color={Colors.error} />
              <Text style={[styles.reviewBtnText, { color: Colors.error }]}>Reject</Text>
            </>
          )}
        </Pressable>
        <Pressable
          style={[styles.reviewBtn, styles.approveBtn]}
          onPress={() => reviewMutation.mutate('approve')}
          disabled={reviewMutation.isPending}
        >
          {busyAction === 'approve' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={14} color="#fff" />
              <Text style={[styles.reviewBtnText, { color: '#fff' }]}>Approve</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function WorkerJobCard({ job }: { job: AgentJob }) {
  const queryClient = useQueryClient();
  const progress = job.input?.workerRuntime?.progress;
  const workerType = job.input?.workerType || job.agentType;
  const isRunning = job.status === 'running';
  const color = isRunning ? Colors.green : job.status === 'queued' ? Colors.warning : Colors.textTertiary;
  const percent = typeof progress?.percent === 'number'
    ? Math.max(0, Math.min(100, progress.percent))
    : null;

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/mission-control/agent-jobs/${job.id}/cancel`, {});
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/mission-control/queue-panel'] }),
    onError: () => Alert.alert('Cancel failed', 'Jarvis could not cancel this worker job.'),
  });

  return (
    <View style={styles.workerCard}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={2}>{job.title}</Text>
            <Text style={styles.workerMeta}>
              {workerType.replace(/_/g, ' ')} - {job.status} - {formatRelative(job.createdAt)}
            </Text>
          </View>
        </View>
        <Pressable
          style={styles.cancelBtn}
          onPress={() => cancelMutation.mutate()}
          disabled={cancelMutation.isPending}
        >
          {cancelMutation.isPending ? (
            <ActivityIndicator size="small" color={Colors.textSecondary} />
          ) : (
            <Ionicons name="stop-circle-outline" size={18} color={Colors.textSecondary} />
          )}
        </Pressable>
      </View>
      {progress?.currentStep ? (
        <Text style={styles.workerStep} numberOfLines={1}>{progress.currentStep}</Text>
      ) : null}
      {percent !== null && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: color }]} />
        </View>
      )}
      {job.error ? <Text style={styles.workerError} numberOfLines={2}>{job.error}</Text> : null}
    </View>
  );
}

function TaskCard({ task }: { task: ScheduledTask }) {
  const [expanded, setExpanded] = useState(false);
  const exitCode = task.lastShellResult?.exitCode;
  const statusColor = exitCode === undefined || exitCode === null
    ? Colors.textTertiary
    : exitCode === 0
      ? Colors.green
      : Colors.error;

  return (
    <Pressable onPress={() => setExpanded(e => !e)} style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.cardTitle} numberOfLines={expanded ? undefined : 2}>{task.title}</Text>
        </View>
        <View style={styles.cardMeta}>
          {task.recurrence && (
            <View style={styles.recurrenceBadge}>
              <Ionicons name="repeat" size={9} color={Colors.purple} />
              <Text style={styles.recurrenceText}>{task.recurrence.toUpperCase()}</Text>
            </View>
          )}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={Colors.textTertiary} />
        </View>
      </View>
      {expanded && (
        <View style={styles.cardExpanded}>
          {task.description ? <Text style={styles.cardDesc}>{task.description}</Text> : null}
          {task.inProgressAt && !task.completedAt && (
            <Text style={styles.cardMeta2}>Started {formatRelative(task.inProgressAt)}</Text>
          )}
          {task.completedAt && (
            <Text style={styles.cardMeta2}>Completed {formatRelative(task.completedAt)}</Text>
          )}
          {!task.completedAt && !task.inProgressAt && (
            <Text style={styles.cardMeta2}>Scheduled {formatScheduled(task.scheduledAt)}</Text>
          )}
          {task.lastShellResult && (
            <View style={[styles.shellResult, { borderLeftColor: statusColor }]}>
              <Text style={styles.shellResultLabel}>
                Last run · exit {task.lastShellResult.exitCode} · {formatRelative(task.lastShellResult.ranAt)}
              </Text>
              {task.lastShellResult.stdout ? (
                <Text style={styles.shellResultText} numberOfLines={4}>{task.lastShellResult.stdout.trim()}</Text>
              ) : null}
              {task.lastShellResult.stderr ? (
                <Text style={[styles.shellResultText, { color: Colors.error }]} numberOfLines={3}>{task.lastShellResult.stderr.trim()}</Text>
              ) : null}
            </View>
          )}
          {!task.lastShellResult && (
            <Text style={styles.cardNoResult}>No run history</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

interface SectionProps {
  label: string;
  color: string;
  tasks: ScheduledTask[];
  collapsible?: boolean;
  emptyText?: string;
}

function Section({ label, color, tasks, collapsible = false, emptyText }: SectionProps) {
  const [collapsed, setCollapsed] = useState(collapsible);

  return (
    <View style={styles.section}>
      <Pressable style={styles.sectionHeader} onPress={collapsible ? () => setCollapsed(c => !c) : undefined}>
        <View style={[styles.sectionDot, { backgroundColor: color }]} />
        <Text style={[styles.sectionLabel, { color }]}>{label}</Text>
        <View style={[styles.sectionCount, { backgroundColor: color + '22' }]}>
          <Text style={[styles.sectionCountText, { color }]}>{tasks.length}</Text>
        </View>
        {collapsible && (
          <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} color={color} style={{ marginLeft: 4 }} />
        )}
      </Pressable>
      {!collapsed && (
        <>
          {tasks.length === 0 ? (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionText}>{emptyText ?? '—'}</Text>
            </View>
          ) : (
            tasks.map(t =>
              label === 'Needs You'
                ? <NeedsYouCard key={t.id} task={t} />
                : <TaskCard key={t.id} task={t} />
            )
          )}
        </>
      )}
    </View>
  );
}

export default function TasksScreen() {
  const { data, isLoading, error } = useQuery<ScheduledTask[]>({
    queryKey: ['/api/jarvis/scheduled-tasks'],
    refetchInterval: 30000,
  });
  const { data: queuePanel, isLoading: queuePanelLoading } = useQuery<QueuePanelData>({
    queryKey: ['/api/mission-control/queue-panel'],
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.green} />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Ionicons name="warning-outline" size={24} color={Colors.error} />
        <Text style={styles.errorText}>Failed to load tasks</Text>
      </View>
    );
  }

  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
  const reviewItems = queuePanel?.reviewItems ?? [];
  const activeJobs = queuePanel?.activeJobs ?? [];

  const needsYou: ScheduledTask[] = [];
  const myTasks: ScheduledTask[] = [];
  const inProgress: ScheduledTask[] = [];
  const scheduled: ScheduledTask[] = [];
  const done: ScheduledTask[] = [];

  for (const t of data) {
    if (t.needsAttention) {
      needsYou.push(t);
    } else if (t.completedAt) {
      if (new Date(t.completedAt).getTime() >= sevenDaysAgo) {
        done.push(t);
      }
    } else if ((t.taskKind ?? 'user_task') === 'user_task') {
      myTasks.push(t);
    } else if (t.inProgressAt) {
      inProgress.push(t);
    } else if (t.active) {
      scheduled.push(t);
    }
  }

  myTasks.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  scheduled.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  done.sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>TASK PANEL</Text>
        <Text style={styles.legendSub}>{data.length} task{data.length !== 1 ? 's' : ''}</Text>
      </View>
      <Section
        label="Needs You"
        color={Colors.purple}
        tasks={needsYou}
        emptyText="No tasks waiting on you"
      />
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionDot, { backgroundColor: Colors.warning }]} />
          <Text style={[styles.sectionLabel, { color: Colors.warning }]}>Needs Review</Text>
          <View style={[styles.sectionCount, { backgroundColor: Colors.warning + '22' }]}>
            <Text style={[styles.sectionCountText, { color: Colors.warning }]}>{reviewItems.length}</Text>
          </View>
        </View>
        {queuePanelLoading ? (
          <View style={styles.emptySection}><ActivityIndicator color={Colors.warning} /></View>
        ) : reviewItems.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>No queued approvals or deliverables</Text>
          </View>
        ) : (
          reviewItems.slice(0, 5).map(item => <ReviewItemCard key={item.id} item={item} />)
        )}
      </View>
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionDot, { backgroundColor: Colors.green }]} />
          <Text style={[styles.sectionLabel, { color: Colors.green }]}>Worker Queue</Text>
          <View style={[styles.sectionCount, { backgroundColor: Colors.green + '22' }]}>
            <Text style={[styles.sectionCountText, { color: Colors.green }]}>{activeJobs.length}</Text>
          </View>
        </View>
        {queuePanelLoading ? (
          <View style={styles.emptySection}><ActivityIndicator color={Colors.green} /></View>
        ) : activeJobs.length === 0 ? (
          <View style={styles.emptySection}>
            <Text style={styles.emptySectionText}>No background workers running</Text>
          </View>
        ) : (
          activeJobs.map(job => <WorkerJobCard key={job.id} job={job} />)
        )}
      </View>
      <Section
        label="My Tasks"
        color={Colors.green}
        tasks={myTasks}
        emptyText="No personal tasks scheduled"
      />
      <Section
        label="Jarvis Running"
        color={Colors.green}
        tasks={inProgress}
        emptyText="Nothing running right now"
      />
      <Section
        label="Scheduled Jarvis Actions"
        color={Colors.textSecondary}
        tasks={scheduled}
        emptyText="No autonomous actions scheduled"
      />
      <Section
        label="Done (last 7 days)"
        color="#888"
        tasks={done}
        collapsible
        emptyText="No completed tasks in the last 7 days"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  errorText: { color: Colors.textSecondary, fontSize: 14 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  legendTitle: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 1.5 },
  legendSub: { fontSize: 11, color: Colors.textTertiary },
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionDot: { width: 6, height: 6, borderRadius: 3 },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, flex: 1 },
  sectionCount: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  sectionCountText: { fontSize: 11, fontWeight: '700' },
  emptySection: { paddingVertical: 12, alignItems: 'center' },
  emptySectionText: { color: Colors.textTertiary, fontSize: 13 },
  needsYouCard: {
    backgroundColor: Colors.purpleDim,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.purple + '40',
    gap: 8,
  },
  attentionQuestion: {
    color: Colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  answerInput: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 14,
    padding: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  sendBtn: {
    backgroundColor: Colors.purple,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  reviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.warning + '55',
    gap: 8,
  },
  reviewMeta: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  reviewPreview: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  reviewActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  reviewBtn: {
    minWidth: 86,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  rejectBtn: { backgroundColor: Colors.error + '12', borderWidth: 1, borderColor: Colors.error + '55' },
  approveBtn: { backgroundColor: Colors.green },
  reviewBtnText: { fontSize: 12, fontWeight: '700' },
  workerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  workerMeta: { color: Colors.textTertiary, fontSize: 11, marginTop: 2, textTransform: 'capitalize' },
  workerStep: { color: Colors.textSecondary, fontSize: 12 },
  workerError: { color: Colors.error, fontSize: 12, lineHeight: 16 },
  cancelBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: Colors.border },
  progressFill: { height: 4, borderRadius: 2 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginTop: 3,
    flexShrink: 0,
  },
  cardTitle: { flex: 1, color: Colors.text, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  cardMeta2: { color: Colors.textTertiary, fontSize: 11 },
  recurrenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.purpleDim,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  recurrenceText: { fontSize: 9, fontWeight: '700', color: Colors.purple, letterSpacing: 0.5 },
  cardExpanded: { marginTop: 10, gap: 8 },
  cardDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  shellResult: { borderLeftWidth: 2, paddingLeft: 10, gap: 4 },
  shellResultLabel: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  shellResultText: { color: Colors.textSecondary, fontSize: 12, fontFamily: 'monospace', lineHeight: 16 },
  cardNoResult: { color: Colors.textTertiary, fontSize: 12, fontStyle: 'italic' },
});
