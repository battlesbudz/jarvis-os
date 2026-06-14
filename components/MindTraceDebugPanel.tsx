import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export interface MindTraceDebugRecord {
  traceId: string;
  createdAt: string;
  channel: string;
  taskTypeDetected: string;
  routeChosen: string;
  riskLevel: string;
  contextLoaded?: string[];
  memoriesRetrieved?: unknown[];
  soulSectionsUsed?: string[];
  toolsCalled?: { name: string; status: string; approvalRequired?: boolean }[];
  approval?: { required: boolean; gateId?: string | null };
  errors?: string[];
  blockedSetupIssues?: string[];
  orchestration?: {
    databaseId?: number;
    subtaskCount?: number;
    resultCount?: number;
    totalRetries?: number;
    durationMs?: number | null;
  };
}

interface MindTraceDebugPanelProps {
  traces: MindTraceDebugRecord[];
  loading?: boolean;
}

function formatAge(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function compactList(values: string[] | undefined, fallback: string): string {
  if (!values || values.length === 0) return fallback;
  return values.slice(0, 3).join(', ') + (values.length > 3 ? ` +${values.length - 3}` : '');
}

export default function MindTraceDebugPanel({ traces, loading = false }: MindTraceDebugPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const latest = traces[0];
  const visible = expanded ? traces.slice(0, 5) : traces.slice(0, 1);

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={() => setExpanded((open) => !open)}>
        <View style={styles.headerIcon}>
          <Ionicons name="analytics-outline" size={16} color={Colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Mind Trace</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {latest ? `${latest.taskTypeDetected} / ${latest.routeChosen} / ${latest.riskLevel}` : loading ? 'Loading recent traces' : 'No persisted traces yet'}
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={Colors.textSecondary} />
      </Pressable>

      {visible.map((trace) => {
        const toolSummary = compactList((trace.toolsCalled ?? []).map((tool) => `${tool.name}:${tool.status}`), 'no tools');
        const contextSummary = compactList(trace.contextLoaded, 'kernel only');
        const memoryCount = trace.memoriesRetrieved?.length ?? 0;
        const errorCount = (trace.errors?.length ?? 0) + (trace.blockedSetupIssues?.length ?? 0);
        return (
          <View key={trace.traceId} style={styles.traceRow}>
            <View style={styles.traceTopLine}>
              <Text style={styles.traceLabel} numberOfLines={1}>
                {trace.routeChosen} - {trace.taskTypeDetected}
              </Text>
              <Text style={styles.traceAge}>{formatAge(trace.createdAt)}</Text>
            </View>
            <Text style={styles.traceText} numberOfLines={2}>Context: {contextSummary}</Text>
            <Text style={styles.traceText} numberOfLines={2}>Tools: {toolSummary}</Text>
            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <Ionicons name="server-outline" size={11} color={Colors.textSecondary} />
                <Text style={styles.badgeText}>db {trace.orchestration?.databaseId ?? '-'}</Text>
              </View>
              <View style={styles.badge}>
                <Ionicons name="book-outline" size={11} color={Colors.textSecondary} />
                <Text style={styles.badgeText}>{memoryCount} memories</Text>
              </View>
              <View style={[styles.badge, trace.approval?.required && styles.badgeWarning]}>
                <Ionicons name="shield-checkmark-outline" size={11} color={trace.approval?.required ? Colors.warning : Colors.textSecondary} />
                <Text style={[styles.badgeText, trace.approval?.required && styles.badgeWarningText]}>
                  {trace.approval?.required ? 'approval' : 'no approval'}
                </Text>
              </View>
              {errorCount > 0 && (
                <View style={[styles.badge, styles.badgeError]}>
                  <Ionicons name="alert-circle-outline" size={11} color={Colors.error} />
                  <Text style={[styles.badgeText, styles.badgeErrorText]}>{errorCount} issue{errorCount === 1 ? '' : 's'}</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.greenDim,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  traceRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    gap: 5,
  },
  traceTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  traceLabel: {
    flex: 1,
    color: Colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  traceAge: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
  },
  traceText: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  badgeWarning: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warningDim,
  },
  badgeError: {
    borderColor: Colors.error,
    backgroundColor: Colors.errorDim,
  },
  badgeText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  badgeWarningText: {
    color: Colors.warning,
  },
  badgeErrorText: {
    color: Colors.error,
  },
});
