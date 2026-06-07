import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';

type RuntimePreviewStatus = 'ready' | 'needs_approval' | 'blocked' | 'degraded' | string;

interface RuntimePreviewReport {
  status: RuntimePreviewStatus;
  eventId: string;
  userId: string;
  intent: string;
  responseMode: string;
  riskTier: string;
  readyToolCount: number;
  blockedToolCount: number;
  approvalRequired: boolean;
  reasons: string[];
}

interface RuntimeDiagnosticsResponse {
  ok?: boolean;
  previewOnly?: boolean;
  disabled?: boolean;
  reason?: string;
  eventId?: string;
  report?: RuntimePreviewReport;
  approvalPreview?: {
    approvalId: string;
    reason: string;
  } | null;
  formatted?: string;
}

interface RuntimeLogEntry {
  id: string;
  message: string;
  at: string;
  result?: RuntimeDiagnosticsResponse;
  error?: string;
}

function statusColor(status: RuntimePreviewStatus | undefined, disabled?: boolean): string {
  if (disabled) return Colors.textTertiary;
  if (status === 'ready') return Colors.success;
  if (status === 'blocked') return Colors.error;
  if (status === 'needs_approval' || status === 'degraded') return Colors.warning;
  return Colors.textSecondary;
}

function statusLabel(entry: RuntimeLogEntry | null): string {
  if (!entry) return 'Idle';
  if (entry.error) return 'Error';
  if (entry.result?.disabled) return 'Disabled';
  const status = entry.result?.report?.status;
  if (status === 'needs_approval') return 'Approval';
  if (status === 'ready') return 'Ready';
  if (status === 'blocked') return 'Blocked';
  if (status === 'degraded') return 'Degraded';
  return status ?? 'Ready';
}

function formatTime(value: string): string {
  try {
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return value;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function RuntimeDiagnosticsPanel() {
  const [message, setMessage] = useState('What can you do?');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<RuntimeLogEntry[]>([]);
  const latest = log[0] ?? null;
  const latestColor = statusColor(latest?.result?.report?.status, latest?.result?.disabled);
  const canRun = message.trim().length > 0 && !running;

  const summary = useMemo(() => {
    if (!latest) return 'No preview yet';
    if (latest.error) return latest.error;
    if (latest.result?.disabled) return latest.result.reason ?? 'Runtime dry run disabled';
    const report = latest.result?.report;
    if (!report) return 'No report returned';
    return `${report.intent} / ${report.riskTier} / ${report.readyToolCount} ready / ${report.blockedToolCount} blocked`;
  }, [latest]);

  async function runPreview() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setRunning(true);
    const entryBase = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: trimmed,
      at: new Date().toISOString(),
    };

    try {
      const res = await apiRequest('POST', '/api/runtime/dry-run', {
        message: trimmed,
        source: 'app',
        channel: 'settings-runtime-preview',
      });
      const result = await res.json() as RuntimeDiagnosticsResponse;
      setLog((items) => [{ ...entryBase, result }, ...items].slice(0, 5));
    } catch (err) {
      setLog((items) => [{ ...entryBase, error: errorText(err) }, ...items].slice(0, 5));
    } finally {
      setRunning(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <Ionicons name="git-compare-outline" size={17} color={Colors.cyan} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Runtime Preview</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{summary}</Text>
        </View>
        <View style={[styles.statusPill, { borderColor: `${latestColor}66`, backgroundColor: `${latestColor}18` }]}>
          <Text style={[styles.statusText, { color: latestColor }]}>{statusLabel(latest)}</Text>
        </View>
      </View>

      <View style={styles.inputBlock}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="What can you do?"
          placeholderTextColor={Colors.textTertiary}
          multiline
          style={styles.input}
        />
        <View style={styles.actionRow}>
          <Pressable
            onPress={runPreview}
            disabled={!canRun}
            style={({ pressed }) => [
              styles.primaryButton,
              (!canRun || pressed) && styles.buttonDimmed,
            ]}
          >
            {running ? (
              <ActivityIndicator size="small" color={Colors.cyan} />
            ) : (
              <Ionicons name="play-outline" size={15} color={Colors.cyan} />
            )}
            <Text style={styles.primaryButtonText}>{running ? 'Running' : 'Dry Run'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setLog([])}
            disabled={log.length === 0 || running}
            style={({ pressed }) => [
              styles.iconButton,
              (pressed || log.length === 0 || running) && styles.buttonDimmed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Clear runtime preview log"
          >
            <Ionicons name="trash-outline" size={15} color={Colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {latest?.result?.formatted ? (
        <View style={styles.outputBlock}>
          {latest.result.formatted.split('\n').slice(0, 6).map((line, index) => (
            <Text key={`${index}-${line}`} style={styles.outputText} numberOfLines={1}>{line}</Text>
          ))}
        </View>
      ) : null}

      {log.length > 0 ? (
        <View style={styles.logBlock}>
          <Text style={styles.logTitle}>Log</Text>
          {log.map((entry) => {
            const color = entry.error ? Colors.error : statusColor(entry.result?.report?.status, entry.result?.disabled);
            const meta = entry.error
              ? entry.error
              : entry.result?.disabled
                ? entry.result.reason ?? 'disabled'
                : entry.result?.report
                  ? `${entry.result.report.responseMode} / ${entry.result.report.riskTier}`
                  : 'no report';
            return (
              <View key={entry.id} style={styles.logRow}>
                <View style={[styles.logDot, { backgroundColor: color }]} />
                <View style={styles.logTextWrap}>
                  <View style={styles.logTopLine}>
                    <Text style={styles.logMessage} numberOfLines={1}>{entry.message}</Text>
                    <Text style={styles.logTime}>{formatTime(entry.at)}</Text>
                  </View>
                  <Text style={[styles.logMeta, { color }]} numberOfLines={1}>{meta}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cyanDim,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: Colors.text,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 74,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
  },
  inputBlock: {
    gap: 9,
  },
  input: {
    minHeight: 72,
    maxHeight: 126,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.surfaceAlt,
    color: Colors.text,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlignVertical: 'top',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: `${Colors.cyan}66`,
    backgroundColor: Colors.cyanDim,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 104,
  },
  primaryButtonText: {
    color: Colors.cyan,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  buttonDimmed: {
    opacity: 0.55,
  },
  outputBlock: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
    borderRadius: 8,
    padding: 10,
    gap: 3,
  },
  outputText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  logBlock: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 10,
    gap: 8,
  },
  logTitle: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  logDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 6,
  },
  logTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  logTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logMessage: {
    flex: 1,
    color: Colors.text,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  logTime: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  logMeta: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
});
