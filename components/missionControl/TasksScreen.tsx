import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

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
}

type Column = { key: string; label: string; color: string; tasks: ScheduledTask[] };

function getColumnColor(key: string): string {
  if (key === 'backlog') return Colors.textSecondary;
  if (key === 'inprogress') return Colors.green;
  return Colors.purple;
}

function categorize(tasks: ScheduledTask[]): Column[] {
  const backlog: ScheduledTask[] = [];
  const inprogress: ScheduledTask[] = [];
  const done: ScheduledTask[] = [];

  for (const t of tasks) {
    if (t.completedAt) {
      done.push(t);
    } else if (t.inProgressAt) {
      inprogress.push(t);
    } else if (t.active) {
      backlog.push(t);
    }
  }

  return [
    { key: 'backlog', label: 'Backlog', color: getColumnColor('backlog'), tasks: backlog },
    { key: 'inprogress', label: 'In Progress', color: getColumnColor('inprogress'), tasks: inprogress },
    { key: 'done', label: 'Done', color: getColumnColor('done'), tasks: done },
  ];
}

function formatRelative(dt: string): string {
  const diff = Date.now() - new Date(dt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
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
    <Pressable
      onPress={() => setExpanded(e => !e)}
      style={styles.card}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.cardTitle} numberOfLines={expanded ? undefined : 2}>
            {task.title}
          </Text>
        </View>
        <View style={styles.cardMeta}>
          {task.recurrence && (
            <View style={styles.recurrenceBadge}>
              <Ionicons name="repeat" size={9} color={Colors.purple} />
              <Text style={styles.recurrenceText}>{task.recurrence.toUpperCase()}</Text>
            </View>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={Colors.textTertiary}
          />
        </View>
      </View>

      {expanded && (
        <View style={styles.cardExpanded}>
          {task.description ? (
            <Text style={styles.cardDesc}>{task.description}</Text>
          ) : null}
          {task.lastShellResult && (
            <View style={[styles.shellResult, { borderLeftColor: statusColor }]}>
              <Text style={styles.shellResultLabel}>
                Last run · exit {task.lastShellResult.exitCode} · {formatRelative(task.lastShellResult.ranAt)}
              </Text>
              {task.lastShellResult.stdout ? (
                <Text style={styles.shellResultText} numberOfLines={4}>
                  {task.lastShellResult.stdout.trim()}
                </Text>
              ) : null}
              {task.lastShellResult.stderr ? (
                <Text style={[styles.shellResultText, { color: Colors.error }]} numberOfLines={3}>
                  {task.lastShellResult.stderr.trim()}
                </Text>
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

function KanbanColumn({ col }: { col: Column }) {
  return (
    <View style={styles.column}>
      <View style={styles.columnHeader}>
        <View style={[styles.columnDot, { backgroundColor: col.color }]} />
        <Text style={[styles.columnLabel, { color: col.color }]}>{col.label}</Text>
        <View style={[styles.columnCount, { backgroundColor: col.color + '22' }]}>
          <Text style={[styles.columnCountText, { color: col.color }]}>{col.tasks.length}</Text>
        </View>
      </View>
      {col.tasks.length === 0 ? (
        <View style={styles.emptyCol}>
          <Text style={styles.emptyColText}>—</Text>
        </View>
      ) : (
        col.tasks.map(t => <TaskCard key={t.id} task={t} />)
      )}
    </View>
  );
}

export default function TasksScreen() {
  const { data, isLoading, error } = useQuery<ScheduledTask[]>({
    queryKey: ['/api/jarvis/scheduled-tasks'],
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

  const columns = categorize(data);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>KANBAN BOARD</Text>
        <Text style={styles.legendSub}>{data.length} task{data.length !== 1 ? 's' : ''} total</Text>
      </View>
      {columns.map(col => (
        <KanbanColumn key={col.key} col={col} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  legendTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 1.5,
  },
  legendSub: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  column: {
    marginBottom: 20,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  columnDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  columnLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    flex: 1,
  },
  columnCount: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  columnCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyCol: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  emptyColText: {
    color: Colors.textTertiary,
    fontSize: 14,
  },
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
  cardTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  recurrenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.purpleDim,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  recurrenceText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.purple,
    letterSpacing: 0.5,
  },
  cardExpanded: {
    marginTop: 10,
    gap: 8,
  },
  cardDesc: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  shellResult: {
    borderLeftWidth: 2,
    paddingLeft: 10,
    gap: 4,
  },
  shellResultLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  shellResultText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  cardNoResult: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontStyle: 'italic',
  },
});
