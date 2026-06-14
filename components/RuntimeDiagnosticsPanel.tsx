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
import {
  buildRuntimeDiagnosticRequest,
  RUNTIME_DIAGNOSTIC_PROBES,
  runtimeDiagnosticStatusFromResponse,
  runtimeDiagnosticStatusLabel,
  summarizeRuntimeDiagnosticResponse,
  type RuntimeDiagnosticProbe,
  type RuntimeDiagnosticsResponse,
  type RuntimeDiagnosticsRoute,
  type RuntimeDiagnosticsStatus,
} from '@/lib/runtimeDiagnosticsUx';

interface RuntimeLogEntry {
  id: string;
  message: string;
  at: string;
  probeId: RuntimeDiagnosticProbe['id'];
  route: RuntimeDiagnosticsRoute;
  result?: RuntimeDiagnosticsResponse;
  error?: string;
}

function statusColor(status: RuntimeDiagnosticsStatus): string {
  if (status === 'disabled' || status === 'idle') return Colors.textTertiary;
  if (status === 'ready') return Colors.success;
  if (status === 'blocked') return Colors.error;
  if (status === 'approval') return Colors.warning;
  return Colors.textSecondary;
}

function probeIcon(id: RuntimeDiagnosticProbe['id']): keyof typeof Ionicons.glyphMap {
  if (id === 'ready-auth') return 'shield-checkmark-outline';
  if (id === 'approval-tool') return 'construct-outline';
  if (id === 'blocked-policy') return 'ban-outline';
  return 'albums-outline';
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
  const [selectedProbeId, setSelectedProbeId] = useState<RuntimeDiagnosticProbe['id']>('ready-auth');
  const selectedProbe = RUNTIME_DIAGNOSTIC_PROBES.find((probe) => probe.id === selectedProbeId) ?? RUNTIME_DIAGNOSTIC_PROBES[0];
  const [message, setMessage] = useState(selectedProbe.message);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<RuntimeLogEntry[]>([]);
  const latest = log[0] ?? null;
  const latestStatus = runtimeDiagnosticStatusFromResponse(latest?.result, latest?.error);
  const latestColor = statusColor(latestStatus);
  const canRun = message.trim().length > 0 && !running;
  const snapshotLabels = useMemo(() => {
    const tools = selectedProbe.body.availableTools?.length ?? 0;
    const providers = selectedProbe.body.auth?.connectedProviders?.length ?? 0;
    const policy = [
      selectedProbe.body.policy?.blockedTools?.length ? 'blocked' : null,
      selectedProbe.body.policy?.approvalRequiredTools?.length ? 'approval' : null,
      selectedProbe.body.policy?.maxAllowedRiskTier ? selectedProbe.body.policy.maxAllowedRiskTier : null,
    ].filter(Boolean).join(' / ') || 'open';
    return [`${providers} auth`, `${tools} tools`, policy];
  }, [selectedProbe]);

  const summary = useMemo(() => {
    return summarizeRuntimeDiagnosticResponse(latest?.result, latest?.error);
  }, [latest]);

  function selectProbe(probe: RuntimeDiagnosticProbe) {
    setSelectedProbeId(probe.id);
    setMessage(probe.message);
  }

  async function runPreview() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setRunning(true);
    const request = buildRuntimeDiagnosticRequest(selectedProbeId, trimmed);
    const entryBase = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: trimmed,
      at: new Date().toISOString(),
      probeId: selectedProbeId,
      route: request.route,
    };

    try {
      const res = await apiRequest('POST', request.route, request.body);
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
          <Text style={[styles.statusText, { color: latestColor }]}>{runtimeDiagnosticStatusLabel(latestStatus)}</Text>
        </View>
      </View>

      <View style={styles.probeGrid}>
        {RUNTIME_DIAGNOSTIC_PROBES.map((probe) => {
          const selected = probe.id === selectedProbeId;
          return (
            <Pressable
              key={probe.id}
              onPress={() => selectProbe(probe)}
              disabled={running}
              style={({ pressed }) => [
                styles.probeButton,
                selected && styles.probeButtonSelected,
                (pressed || running) && styles.buttonDimmed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Runtime ${probe.label} probe`}
            >
              <Ionicons
                name={probeIcon(probe.id)}
                size={14}
                color={selected ? Colors.cyan : Colors.textSecondary}
              />
              <Text style={[styles.probeText, selected && styles.probeTextSelected]} numberOfLines={1}>
                {probe.label}
              </Text>
            </Pressable>
          );
        })}
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
        <View style={styles.snapshotRow}>
          {snapshotLabels.map((label) => (
            <View key={label} style={styles.snapshotChip}>
              <Text style={styles.snapshotText} numberOfLines={1}>{label}</Text>
            </View>
          ))}
        </View>
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
            <Text style={styles.primaryButtonText}>{running ? 'Running' : 'Probe'}</Text>
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
            const color = statusColor(runtimeDiagnosticStatusFromResponse(entry.result, entry.error));
            const meta = entry.error
              ? entry.error
              : entry.result?.disabled
                ? entry.result.reason ?? 'disabled'
                : entry.result?.runtimeOwned || entry.result?.runtimeWorkflowId
                  ? summarizeRuntimeDiagnosticResponse(entry.result)
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
                  <Text style={[styles.logMeta, { color }]} numberOfLines={1}>
                    {runtimeDiagnosticStatusLabel(runtimeDiagnosticStatusFromResponse(entry.result, entry.error))} / {entry.route} / {meta}
                  </Text>
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
  probeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  probeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 86,
    minHeight: 32,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 9,
  },
  probeButtonSelected: {
    borderColor: `${Colors.cyan}66`,
    backgroundColor: Colors.cyanDim,
  },
  probeText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  probeTextSelected: {
    color: Colors.cyan,
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
  snapshotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  snapshotChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 7,
    backgroundColor: Colors.bg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 118,
  },
  snapshotText: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
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
