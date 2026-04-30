import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
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

type FreqType = 'DAILY' | 'RECURRING' | 'ONE-SHOT';

function getFreqType(recurrence: string | null): FreqType {
  if (!recurrence) return 'ONE-SHOT';
  const r = recurrence.toLowerCase();
  if (r === 'daily' || r.includes('every day') || r.includes('weekday')) return 'DAILY';
  return 'RECURRING';
}

function getFreqColor(freq: FreqType): string {
  if (freq === 'DAILY') return Colors.green;
  if (freq === 'RECURRING') return Colors.purple;
  return Colors.textTertiary;
}

function computeNextRunMs(hour: number, minute: number, dayOfWeek: number | null): number {
  if (hour < 0) return -1;
  const now = new Date();
  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);

  if (dayOfWeek !== null) {
    const currentDay = now.getDay();
    let daysUntil = (dayOfWeek - currentDay + 7) % 7;
    if (daysUntil === 0 && next <= now) daysUntil = 7;
    next.setDate(now.getDate() + daysUntil);
  } else if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

function formatCountdown(ms: number): string {
  if (ms < 0) return 'continuous';
  const totalMins = Math.floor(ms / 60000);
  if (totalMins < 1) return 'in <1m';
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs > 0) return `in ${hrs}h ${mins}m`;
  return `in ${mins}m`;
}

function formatUserNextRun(scheduledAt: string, recurrence: string | null): string {
  const t = new Date(scheduledAt);
  const now = new Date();

  if (recurrence) {
    const r = recurrence.toLowerCase();
    if (r === 'daily' || r.includes('every day')) {
      const next = new Date();
      next.setHours(t.getHours(), t.getMinutes(), 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return formatCountdown(next.getTime() - now.getTime());
    }
    return 'recurring';
  }

  const diff = t.getTime() - now.getTime();
  if (diff < 0) return 'overdue';
  return formatCountdown(diff);
}

interface CardItem {
  id: string;
  name: string;
  active: boolean;
  freq: FreqType;
  schedule: string;
  countdown: string;
  preview: string | null;
  isSystem: boolean;
}

function ScheduleCard({ item }: { item: CardItem }) {
  const freqColor = getFreqColor(item.freq);
  const nameColor = item.active ? Colors.green : Colors.textTertiary;
  const disabledBadge = !item.active;

  return (
    <View style={[styles.card, !item.active && styles.cardDisabled]}>
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <Text style={[styles.cardName, { color: nameColor }]} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.badgeRow}>
            <View style={[styles.freqBadge, { backgroundColor: freqColor + '22' }]}>
              <Text style={[styles.freqBadgeText, { color: freqColor }]}>{item.freq}</Text>
            </View>
            {disabledBadge && (
              <View style={styles.disabledBadge}>
                <Text style={styles.disabledBadgeText}>DISABLED</Text>
              </View>
            )}
            {item.isSystem && (
              <View style={styles.systemBadge}>
                <Text style={styles.systemBadgeText}>SYSTEM</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.countdownText}>{item.countdown}</Text>
        </View>
      </View>

      <Text style={styles.scheduleText}>{item.schedule}</Text>

      {item.preview ? (
        <Text style={styles.previewText} numberOfLines={2}>
          {item.preview}
        </Text>
      ) : null}
    </View>
  );
}

export default function CalendarScreen() {
  const tasksQ = useQuery<ScheduledTask[]>({
    queryKey: ['/api/jarvis/scheduled-tasks'],
  });

  const sysQ = useQuery<SystemTask[]>({
    queryKey: ['/api/jarvis/system-schedule'],
  });

  const items = useMemo<CardItem[]>(() => {
    const result: CardItem[] = [];

    const tasks = tasksQ.data ?? [];
    for (const t of tasks) {
      const freq = getFreqType(t.recurrence);
      result.push({
        id: t.id,
        name: t.title,
        active: t.active && !t.completedAt,
        freq,
        schedule: t.recurrence
          ? t.recurrence.charAt(0).toUpperCase() + t.recurrence.slice(1)
          : new Date(t.scheduledAt).toLocaleString('en-US', {
              month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            }),
        countdown: formatUserNextRun(t.scheduledAt, t.recurrence),
        preview: t.description,
        isSystem: false,
      });
    }

    const sysTasks = sysQ.data ?? [];
    for (const s of sysTasks) {
      const freq = getFreqType(s.recurrence);
      const ms = computeNextRunMs(s.hour, s.minute, s.dayOfWeek);
      result.push({
        id: s.id,
        name: s.label,
        active: true,
        freq,
        schedule: s.hour < 0 ? 'every 30 min' : `${s.dayLabel} · ${s.timeLabel}`,
        countdown: ms < 0 ? 'continuous' : formatCountdown(ms),
        preview: null,
        isSystem: true,
      });
    }

    return result;
  }, [tasksQ.data, sysQ.data]);

  const loading = tasksQ.isLoading || sysQ.isLoading;
  const error = tasksQ.error || sysQ.error;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.green} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="warning-outline" size={24} color={Colors.error} />
        <Text style={styles.errorText}>Failed to load schedule</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.green }]} />
          <Text style={styles.legendText}>daily</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.purple }]} />
          <Text style={styles.legendText}>recurring</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.textTertiary }]} />
          <Text style={styles.legendText}>one-shot</Text>
        </View>
        <Text style={styles.legendCount}>{items.length} jobs</Text>
      </View>

      {items.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="calendar-outline" size={32} color={Colors.textTertiary} />
          <Text style={styles.emptyText}>No scheduled jobs</Text>
        </View>
      )}

      {items.map(item => (
        <ScheduleCard key={item.id} item={item} />
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
    gap: 14,
    marginBottom: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  legendCount: {
    flex: 1,
    textAlign: 'right',
    fontSize: 11,
    color: Colors.textTertiary,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardLeft: {
    flex: 1,
    gap: 5,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '600',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 5,
  },
  freqBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  freqBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  disabledBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Colors.textTertiary + '22',
  },
  disabledBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
  },
  systemBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Colors.cyanDim,
  },
  systemBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.cyan,
    letterSpacing: 0.8,
  },
  cardRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  countdownText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    fontFamily: 'monospace',
  },
  scheduleText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
  },
  previewText: {
    fontSize: 12,
    color: Colors.textTertiary,
    lineHeight: 17,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyText: {
    color: Colors.textTertiary,
    fontSize: 14,
  },
});
