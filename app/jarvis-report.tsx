import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';

interface EgoAnalysis {
  weekOf: string;
  totalActions: number;
  completionRate: number;
  engagementRate: number;
  predictionAccuracy: number;
  actionBreakdown: Record<string, { total: number; actedOn: number; pending: number; ignored: number }>;
  twoWeekBreakdown: Record<string, { total: number; actedOn: number }>;
  mostEffective: string[];
  leastEffective: string[];
  relationshipHealth: 'improving' | 'stable' | 'declining';
  avgResponseLatencyMs: number;
  messageFrequency: number;
  selfCorrectionSignals: string[];
}

interface EgoReport {
  id: string;
  weekOf: string;
  reportText: string;
  deliveredAt: string | null;
  createdAt: string;
}

interface DashboardResponse {
  analysis: EgoAnalysis;
  latestReport: EgoReport | null;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function healthColor(h: 'improving' | 'stable' | 'declining'): string {
  if (h === 'improving') return Colors.success;
  if (h === 'declining') return Colors.error;
  return Colors.textSecondary;
}

function formatActionType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function MetricCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <View style={[styles.metricCard, accent ? { borderTopColor: accent, borderTopWidth: 2 } : {}]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {sub ? <Text style={styles.metricSub}>{sub}</Text> : null}
    </View>
  );
}

export default function JarvisReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: winWidth } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery<DashboardResponse>({
    queryKey: ['/api/ego/dashboard'],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: reportsData } = useQuery<{ reports: EgoReport[] }>({
    queryKey: ['/api/ego/reports'],
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const analysis = data?.analysis;
  const topActions = Object.entries(analysis?.actionBreakdown ?? {})
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 6);

  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Jarvis Report</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.cyan} />}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && !analysis ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={Colors.cyan} />
            <Text style={styles.loadingText}>Analysing Jarvis's performance…</Text>
          </View>
        ) : !analysis ? (
          <View style={styles.empty}>
            <Ionicons name="bar-chart-outline" size={48} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No data yet</Text>
            <Text style={styles.emptyBody}>
              Jarvis will start tracking its own performance as soon as it takes its first actions on your behalf.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>THIS WEEK AT A GLANCE</Text>
            <View style={styles.metricsRow}>
              <MetricCard
                label="Actions Taken"
                value={String(analysis.totalActions)}
                accent={Colors.cyan}
              />
              <MetricCard
                label="Engagement"
                value={pct(analysis.engagementRate)}
                sub="of all actions"
                accent={Colors.violet}
              />
              <MetricCard
                label="Completion"
                value={pct(analysis.completionRate)}
                sub="of resolved"
                accent={Colors.success}
              />
            </View>

            <View style={styles.metricsRow}>
              <MetricCard
                label="Relationship Health"
                value={analysis.relationshipHealth.charAt(0).toUpperCase() + analysis.relationshipHealth.slice(1)}
                accent={healthColor(analysis.relationshipHealth)}
              />
              <MetricCard
                label="Prediction Accuracy"
                value={analysis.predictionAccuracy > 0 ? pct(analysis.predictionAccuracy) : '—'}
                sub="2-week window"
                accent={Colors.cyan}
              />
            </View>

            <View style={styles.metricsRow}>
              <MetricCard
                label="Avg Response Time"
                value={analysis.avgResponseLatencyMs > 0
                  ? `${(analysis.avgResponseLatencyMs / 3_600_000).toFixed(1)}h`
                  : '—'}
                sub="to user action"
                accent={Colors.textSecondary}
              />
              <MetricCard
                label="Messages This Week"
                value={String(analysis.messageFrequency)}
                accent={Colors.warning}
              />
            </View>

            {topActions.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>ACTION BREAKDOWN</Text>
                <View style={styles.card}>
                  {topActions.map(([type, v], i) => {
                    const rate = v.total > 0 ? v.actedOn / v.total : 0;
                    const barWidth = Math.round(rate * 100);
                    const trackWidth = winWidth - 64;
                    return (
                      <View key={type} style={[styles.actionRow, i < topActions.length - 1 && styles.actionRowBorder]}>
                        <View style={styles.actionRowTop}>
                          <Text style={styles.actionType}>{formatActionType(type)}</Text>
                          <Text style={styles.actionRate}>{pct(rate)}</Text>
                        </View>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { width: (barWidth / 100) * trackWidth }]} />
                        </View>
                        <Text style={styles.actionMeta}>
                          {v.actedOn} acted on · {v.pending} pending · {v.ignored} ignored
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {analysis.mostEffective.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>MOST EFFECTIVE</Text>
                <View style={styles.card}>
                  {analysis.mostEffective.map((t) => (
                    <View key={t} style={styles.tagRow}>
                      <Ionicons name="checkmark-circle" size={16} color={Colors.success ?? '#4ade80'} />
                      <Text style={styles.tagText}>{formatActionType(t)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {analysis.leastEffective.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>PULLING BACK ON</Text>
                <View style={styles.card}>
                  {analysis.leastEffective.map((t) => (
                    <View key={t} style={styles.tagRow}>
                      <Ionicons name="arrow-down-circle" size={16} color={Colors.warning} />
                      <Text style={styles.tagText}>{formatActionType(t)}</Text>
                    </View>
                  ))}
                  <Text style={styles.pullbackNote}>
                    Jarvis has reduced these automatically based on low engagement.
                  </Text>
                </View>
              </>
            )}

            {data?.latestReport && (
              <>
                <Text style={styles.sectionLabel}>LATEST SELF-REPORT</Text>
                <View style={styles.reportCard}>
                  <Text style={styles.reportWeek}>Week of {data.latestReport.weekOf}</Text>
                  <Text style={styles.reportText}>{data.latestReport.reportText}</Text>
                </View>
              </>
            )}

            {reportsData && reportsData.reports.length > 1 && (
              <>
                <Text style={styles.sectionLabel}>PREVIOUS REPORTS</Text>
                {reportsData.reports.slice(1, 5).map((r) => (
                  <View key={r.id} style={styles.prevReportCard}>
                    <Text style={styles.prevReportWeek}>Week of {r.weekOf}</Text>
                    <Text style={styles.prevReportText} numberOfLines={4}>{r.reportText}</Text>
                  </View>
                ))}
              </>
            )}

            {!data?.latestReport && analysis.totalActions > 0 && (
              <View style={styles.noReportNote}>
                <Ionicons name="time-outline" size={20} color={Colors.textTertiary} />
                <Text style={styles.noReportNoteText}>
                  Your first weekly self-report will be generated this Sunday evening.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  loading: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 16,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  emptyBody: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 1.2,
    marginTop: 24,
    marginBottom: 10,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  metricCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  metricLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  metricSub: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  actionRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  actionRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  actionType: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  actionRate: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.cyan,
  },
  barTrack: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    marginBottom: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    backgroundColor: Colors.cyan,
    borderRadius: 2,
  },
  actionMeta: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tagText: {
    fontSize: 14,
    color: Colors.text,
  },
  pullbackNote: {
    fontSize: 12,
    color: Colors.textTertiary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontStyle: 'italic',
  },
  reportCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.cyan,
    padding: 16,
  },
  reportWeek: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 10,
    fontWeight: '500',
  },
  reportText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 22,
  },
  prevReportCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
  },
  prevReportWeek: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  prevReportText: {
    fontSize: 13,
    color: Colors.textTertiary,
    lineHeight: 20,
  },
  noReportNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginTop: 16,
  },
  noReportNoteText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
