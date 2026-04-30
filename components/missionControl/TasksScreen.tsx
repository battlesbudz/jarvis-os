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
  completedAt: string | null;
  createdAt: string;
  shellCommand: string | null;
  lastShellResult: LastShellResult | null;
  inProgressAt: string | null;
  active: boolean;
  needsAttention: boolean;
  attentionQuestion: string | null;
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

  const needsYou: ScheduledTask[] = [];
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
    } else if (t.inProgressAt) {
      inProgress.push(t);
    } else if (t.active) {
      scheduled.push(t);
    }
  }

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
      <Section
        label="In Progress"
        color={Colors.green}
        tasks={inProgress}
        emptyText="Nothing running right now"
      />
      <Section
        label="Scheduled"
        color={Colors.textSecondary}
        tasks={scheduled}
        emptyText="No upcoming tasks"
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
