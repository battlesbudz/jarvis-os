import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  Platform,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: number;
  timestamp: string;
  file: string;
  reason: string;
  verified: string;
  changesSummary: string;
  diff: string | null;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────

function VerifiedBadge({ status }: { status: string }) {
  const lower = (status ?? 'pending').toLowerCase();
  const color =
    lower === 'passed' ? Colors.success :
    lower === 'failed' || lower === 'error' ? Colors.error :
    Colors.warning;
  const label =
    lower === 'passed' ? 'Passed' :
    lower === 'failed' ? 'Failed' :
    lower === 'error' ? 'Error' :
    'Pending';
  return (
    <View style={[badgeStyles.container, { backgroundColor: color + '22', borderColor: color + '55' }]}>
      <Text style={[badgeStyles.text, { color }]}>{label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});

// ── Diff renderer ─────────────────────────────────────────────────────────────

function DiffContent({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {lines.map((line, i) => {
          const isAdded = line.startsWith('+') && !line.startsWith('+++');
          const isRemoved = line.startsWith('-') && !line.startsWith('---');
          const bg = isAdded ? '#10B98118' : isRemoved ? '#EF444418' : 'transparent';
          const textColor = isAdded ? '#10B981' : isRemoved ? '#EF4444' : Colors.textSecondary;
          return (
            <View key={i} style={[diffStyles.line, { backgroundColor: bg }]}>
              <Text style={[diffStyles.code, { color: textColor }]}>{line}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const diffStyles = StyleSheet.create({
  line: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    minWidth: 320,
  },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    lineHeight: 17,
  },
});

// ── Detail modal ──────────────────────────────────────────────────────────────

function EntryModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[modalStyles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
        {/* Header */}
        <View style={modalStyles.header}>
          <Pressable onPress={onClose} style={modalStyles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={modalStyles.headerTitle} numberOfLines={1}>Self-Repair Detail</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={modalStyles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        >
          {/* Meta */}
          <View style={modalStyles.metaRow}>
            <VerifiedBadge status={entry.verified} />
            <Text style={modalStyles.timestamp}>{formatTs(entry.timestamp)}</Text>
          </View>

          {/* File */}
          <View style={modalStyles.fieldBlock}>
            <Text style={modalStyles.fieldLabel}>FILE</Text>
            <Text style={modalStyles.fileText}>{entry.file}</Text>
          </View>

          {/* Reason */}
          <View style={modalStyles.fieldBlock}>
            <Text style={modalStyles.fieldLabel}>REASON</Text>
            <Text style={modalStyles.fieldValue}>{entry.reason}</Text>
          </View>

          {/* Changes summary */}
          <View style={modalStyles.fieldBlock}>
            <Text style={modalStyles.fieldLabel}>CHANGES</Text>
            <Text style={modalStyles.summaryText}>{entry.changesSummary || '—'}</Text>
          </View>

          {/* Diff */}
          {entry.diff ? (
            <View style={modalStyles.fieldBlock}>
              <Text style={modalStyles.fieldLabel}>DIFF</Text>
              <View style={modalStyles.diffBox}>
                <DiffContent diff={entry.diff} />
              </View>
            </View>
          ) : (
            <View style={modalStyles.fieldBlock}>
              <Text style={modalStyles.fieldLabel}>DIFF</Text>
              <Text style={modalStyles.emptyDiff}>No diff recorded.</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 36, height: 36, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: Colors.text },
  scroll: { flex: 1, paddingHorizontal: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 16 },
  timestamp: { fontSize: 12, color: Colors.textTertiary },
  fieldBlock: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  fileText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    color: Colors.cyan,
    lineHeight: 18,
  },
  fieldValue: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  summaryText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    color: Colors.textSecondary,
  },
  diffBox: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyDiff: { fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' },
});

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({ entry, onPress }: { entry: AuditEntry; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [cardStyles.card, pressed && { opacity: 0.7 }]}
    >
      <View style={cardStyles.topRow}>
        <VerifiedBadge status={entry.verified} />
        <Text style={cardStyles.time}>{timeAgo(entry.timestamp)}</Text>
      </View>

      <Text style={cardStyles.filePath} numberOfLines={1}>{entry.file}</Text>
      <Text style={cardStyles.reason} numberOfLines={2}>{entry.reason}</Text>

      {entry.changesSummary ? (
        <View style={cardStyles.summaryRow}>
          <Ionicons name="git-commit-outline" size={13} color={Colors.textTertiary} />
          <Text style={cardStyles.summary}>{entry.changesSummary}</Text>
        </View>
      ) : null}

      <View style={cardStyles.tapHint}>
        <Ionicons name="chevron-forward" size={13} color={Colors.violet} />
        <Text style={cardStyles.tapHintText}>Tap to view diff</Text>
      </View>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { fontSize: 11, color: Colors.textTertiary },
  filePath: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    color: Colors.cyan,
  },
  reason: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  summary: { fontSize: 12, color: Colors.textTertiary },
  tapHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  tapHintText: { fontSize: 12, color: Colors.violet },
});

// ── Main screen ────────────────────────────────────────────────────────────────

export default function SelfRepairHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ entries: AuditEntry[] }>({
    queryKey: ['/api/self-heal-audit'],
  });

  const entries = data?.entries ?? [];

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Self-Repair Log</Text>
          <Text style={styles.subtitle}>Autonomous changes Jarvis made to the codebase</Text>
        </View>
        <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={20} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.violet} />
          <Text style={styles.loadingText}>Loading repair history…</Text>
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={40} color={Colors.error} />
          <Text style={styles.errorText}>Failed to load repair history.</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="shield-checkmark-outline" size={48} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>No repairs yet</Text>
          <Text style={styles.emptySubtitle}>
            When Jarvis autonomously fixes code, each change will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => (
            <EntryCard entry={item} onPress={() => setSelected(item)} />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Detail modal */}
      {selected && (
        <EntryModal entry={selected} onClose={() => setSelected(null)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center' },
  headerText: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  refreshBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'flex-end' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center' },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryBtnText: { fontSize: 14, color: Colors.text, fontWeight: '600' },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.textSecondary, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center', lineHeight: 19 },
});
