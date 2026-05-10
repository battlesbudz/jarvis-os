import React, { useMemo, useState } from 'react';
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
import { apiRequest } from '@/lib/query-client';

interface UsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  failedCalls: number;
}

interface UsageByModel extends UsageTotals {
  provider: string;
  model: string;
  estimatedCalls: number;
  lastUsedAt: string | null;
  sources: string[];
}

interface RecentUsage {
  id: string;
  provider: string;
  model: string;
  source: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  success: boolean;
  estimated: boolean;
  createdAt: string;
}

interface UsageResponse {
  days: number;
  totals: UsageTotals;
  byModel: UsageByModel[];
  recent: RecentUsage[];
}

const WINDOWS = [1, 7, 30] as const;

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatMs(value: number): string {
  if (!value) return '0ms';
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

function formatRelative(dt: string | null): string {
  if (!dt) return 'never';
  const diff = Date.now() - new Date(dt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function providerColor(provider: string): string {
  const key = provider.toLowerCase();
  if (key.includes('claude')) return Colors.warning;
  if (key.includes('compatible') || key.includes('openrouter')) return Colors.cyan;
  return Colors.green;
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function ModelCard({ item, maxTokens }: { item: UsageByModel; maxTokens: number }) {
  const color = providerColor(item.provider);
  const percent = maxTokens > 0 ? Math.max(4, Math.round((item.totalTokens / maxTokens) * 100)) : 4;
  const average = item.calls > 0 ? Math.round(item.durationMs / item.calls) : 0;

  return (
    <View style={styles.modelCard}>
      <View style={styles.modelHeader}>
        <View style={styles.modelTitleWrap}>
          <View style={[styles.modelDot, { backgroundColor: color }]} />
          <View style={styles.modelTextWrap}>
            <Text style={styles.modelName} numberOfLines={1}>{item.model}</Text>
            <Text style={styles.providerName}>{item.provider}</Text>
          </View>
        </View>
        <Text style={styles.modelCalls}>{item.calls} call{item.calls === 1 ? '' : 's'}</Text>
      </View>

      <View style={styles.usageBar}>
        <View style={[styles.usageFill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>

      <View style={styles.metricGrid}>
        <View style={styles.metricCell}>
          <Text style={styles.metricValue}>{formatNumber(item.totalTokens)}</Text>
          <Text style={styles.metricLabel}>total</Text>
        </View>
        <View style={styles.metricCell}>
          <Text style={styles.metricValue}>{formatNumber(item.promptTokens)}</Text>
          <Text style={styles.metricLabel}>prompt</Text>
        </View>
        <View style={styles.metricCell}>
          <Text style={styles.metricValue}>{formatNumber(item.completionTokens)}</Text>
          <Text style={styles.metricLabel}>reply</Text>
        </View>
        <View style={styles.metricCell}>
          <Text style={styles.metricValue}>{formatMs(average)}</Text>
          <Text style={styles.metricLabel}>avg</Text>
        </View>
      </View>

      <View style={styles.modelFooter}>
        <Text style={styles.footerText}>Last used {formatRelative(item.lastUsedAt)}</Text>
        {item.estimatedCalls > 0 && (
          <Text style={styles.estimatedText}>estimated</Text>
        )}
      </View>
      {item.sources.length > 0 && (
        <Text style={styles.sourcesText} numberOfLines={1}>{item.sources.join(' / ')}</Text>
      )}
    </View>
  );
}

function RecentRow({ item }: { item: RecentUsage }) {
  const color = item.success ? providerColor(item.provider) : Colors.error;
  return (
    <View style={styles.recentRow}>
      <View style={[styles.recentDot, { backgroundColor: color }]} />
      <View style={styles.recentMain}>
        <Text style={styles.recentTitle} numberOfLines={1}>{item.model}</Text>
        <Text style={styles.recentMeta}>{item.source} - {formatRelative(item.createdAt)}</Text>
      </View>
      <Text style={styles.recentTokens}>{formatNumber(item.totalTokens)}</Text>
    </View>
  );
}

export default function UsageScreen() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(7);

  const { data, isLoading, error } = useQuery<UsageResponse>({
    queryKey: ['/api/jarvis/model-usage', days],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/jarvis/model-usage?days=${days}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const maxTokens = useMemo(
    () => Math.max(0, ...(data?.byModel.map((item) => item.totalTokens) ?? [0])),
    [data?.byModel],
  );

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
        <Text style={styles.errorText}>Failed to load usage</Text>
      </View>
    );
  }

  const avgLatency = data.totals.calls > 0
    ? Math.round(data.totals.durationMs / data.totals.calls)
    : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.legend}>
        <View>
          <Text style={styles.legendTitle}>MODEL USAGE</Text>
          <Text style={styles.legendSub}>Per-model call and token ledger</Text>
        </View>
        <View style={styles.windowControl}>
          {WINDOWS.map((windowDays) => {
            const active = days === windowDays;
            return (
              <Pressable
                key={windowDays}
                onPress={() => setDays(windowDays)}
                style={[styles.windowButton, active && styles.windowButtonActive]}
              >
                <Text style={[styles.windowText, active && styles.windowTextActive]}>
                  {windowDays}d
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.statsGrid}>
        <StatCard
          label="Calls"
          value={formatNumber(data.totals.calls)}
          sub={`${data.byModel.length} model${data.byModel.length === 1 ? '' : 's'}`}
          icon="chatbubbles-outline"
          color={Colors.green}
        />
        <StatCard
          label="Tokens"
          value={formatNumber(data.totals.totalTokens)}
          sub={`${formatNumber(data.totals.promptTokens)} prompt`}
          icon="pulse-outline"
          color={Colors.cyan}
        />
        <StatCard
          label="Latency"
          value={formatMs(avgLatency)}
          sub="average"
          icon="timer-outline"
          color={Colors.violet}
        />
        <StatCard
          label="Failures"
          value={formatNumber(data.totals.failedCalls)}
          sub="model errors"
          icon="warning-outline"
          color={data.totals.failedCalls > 0 ? Colors.error : Colors.textTertiary}
        />
      </View>

      <View style={styles.sectionHeader}>
        <View style={[styles.sectionDot, { backgroundColor: Colors.green }]} />
        <Text style={[styles.sectionLabel, { color: Colors.green }]}>BY MODEL</Text>
      </View>

      {data.byModel.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="analytics-outline" size={22} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>No model usage recorded yet</Text>
          <Text style={styles.emptyText}>Send Jarvis a message after this deploy and usage will appear here.</Text>
        </View>
      ) : (
        data.byModel.map((item) => (
          <ModelCard key={`${item.provider}:${item.model}`} item={item} maxTokens={maxTokens} />
        ))
      )}

      {data.recent.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionDot, { backgroundColor: Colors.cyan }]} />
            <Text style={[styles.sectionLabel, { color: Colors.cyan }]}>RECENT CALLS</Text>
          </View>
          <View style={styles.recentList}>
            {data.recent.map((item) => (
              <RecentRow key={item.id} item={item} />
            ))}
          </View>
        </>
      )}
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
    gap: 12,
    marginBottom: 14,
  },
  legendTitle: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 1.5 },
  legendSub: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  windowControl: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 3,
  },
  windowButton: {
    minWidth: 36,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  windowButtonActive: { backgroundColor: Colors.greenDim },
  windowText: { color: Colors.textTertiary, fontSize: 12, fontWeight: '700' },
  windowTextActive: { color: Colors.green },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  statCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 118,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statValue: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  statLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 2 },
  statSub: { color: Colors.textTertiary, fontSize: 11, marginTop: 5 },
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
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  modelCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  modelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  modelTitleWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  modelDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  modelTextWrap: { flex: 1, minWidth: 0 },
  modelName: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  providerName: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  modelCalls: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', flexShrink: 0 },
  usageBar: {
    height: 6,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 12,
    marginBottom: 12,
  },
  usageFill: { height: 6, borderRadius: 4 },
  metricGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCell: {
    flex: 1,
    minHeight: 46,
    backgroundColor: Colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  metricValue: { color: Colors.text, fontSize: 13, fontWeight: '800' },
  metricLabel: { color: Colors.textTertiary, fontSize: 10, marginTop: 3 },
  modelFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  footerText: { color: Colors.textTertiary, fontSize: 11 },
  estimatedText: { color: Colors.warning, fontSize: 10, fontWeight: '700' },
  sourcesText: { color: Colors.textTertiary, fontSize: 11, marginTop: 6 },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 20,
    marginBottom: 18,
    gap: 8,
  },
  emptyTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  emptyText: { color: Colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  recentList: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  recentRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  recentDot: { width: 7, height: 7, borderRadius: 3.5, flexShrink: 0 },
  recentMain: { flex: 1, minWidth: 0 },
  recentTitle: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  recentMeta: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  recentTokens: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
});
