import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';
import Colors from '@/constants/colors';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DebugContext {
  errorMessage: string;
  stackExcerpt?: string;
  rootCauseSummary: string;
  errorLogId?: string;
}

interface ProposalSummary {
  id: string;
  title: string;
  reason: string;
  filePath: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionNote: string | null;
  debugContext: DebugContext | null;
  createdAt: string;
  appliedAt: string | null;
}

interface ProposalDetail extends ProposalSummary {
  originalContent: string;
  proposedContent: string;
}

// ── Diff view helper ───────────────────────────────────────────────────────────

function computeDiffLines(original: string, proposed: string) {
  const oldLines = original.split('\n');
  const newLines = proposed.split('\n');
  const result: { type: 'added' | 'removed' | 'unchanged'; text: string }[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      if (o !== undefined) result.push({ type: 'unchanged', text: o });
    } else {
      if (o !== undefined) result.push({ type: 'removed', text: o });
      if (n !== undefined) result.push({ type: 'added', text: n });
    }
  }
  return result;
}

// ── Components ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProposalSummary['status'] }) {
  const color =
    status === 'pending' ? Colors.violet :
    status === 'approved' ? '#10B981' :
    '#EF4444';
  const label =
    status === 'pending' ? 'Pending' :
    status === 'approved' ? 'Applied' :
    'Archived';
  return (
    <View style={[badgeStyles.container, { backgroundColor: color + '22', borderColor: color + '44' }]}>
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

function DiffView({ original, proposed }: { original: string; proposed: string }) {
  const lines = computeDiffLines(original, proposed);
  return (
    <ScrollView horizontal style={diffStyles.hScroll} showsHorizontalScrollIndicator={false}>
      <View>
        {lines.map((line, i) => {
          const bg =
            line.type === 'added' ? '#10B98122' :
            line.type === 'removed' ? '#EF444422' :
            'transparent';
          const prefix =
            line.type === 'added' ? '+' :
            line.type === 'removed' ? '−' :
            ' ';
          const textColor =
            line.type === 'added' ? '#10B981' :
            line.type === 'removed' ? '#EF4444' :
            Colors.textSecondary;
          return (
            <View key={i} style={[diffStyles.line, { backgroundColor: bg }]}>
              <Text style={[diffStyles.prefix, { color: textColor }]}>{prefix}</Text>
              <Text style={[diffStyles.code, { color: textColor }]}>{line.text}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const diffStyles = StyleSheet.create({
  hScroll: { flex: 1 },
  line: {
    flexDirection: 'row',
    paddingVertical: 1,
    paddingHorizontal: 4,
    minWidth: 400,
  },
  prefix: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    width: 16,
  },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    flex: 1,
  },
});

// ── Debug context section ──────────────────────────────────────────────────────

function DebugContextSection({ ctx }: { ctx: DebugContext }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={debugStyles.container}>
      <Pressable style={debugStyles.header} onPress={() => setExpanded((v) => !v)}>
        <Ionicons name="bug-outline" size={15} color={Colors.violet} />
        <Text style={debugStyles.headerText}>Why Jarvis made this change</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textSecondary} />
      </Pressable>
      {expanded && (
        <View style={debugStyles.body}>
          <Text style={debugStyles.label}>Error detected</Text>
          <Text style={debugStyles.value}>{ctx.errorMessage}</Text>
          <Text style={debugStyles.label}>Root cause</Text>
          <Text style={debugStyles.value}>{ctx.rootCauseSummary}</Text>
          {ctx.stackExcerpt ? (
            <>
              <Text style={debugStyles.label}>Stack excerpt</Text>
              <ScrollView horizontal style={debugStyles.stack}>
                <Text style={debugStyles.stackText}>{ctx.stackExcerpt}</Text>
              </ScrollView>
            </>
          ) : null}
        </View>
      )}
    </View>
  );
}

const debugStyles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.violet + '44',
    backgroundColor: Colors.violet + '0A',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.violet,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.violet + '22',
  },
  label: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 2,
  },
  value: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 19,
  },
  stack: {
    marginTop: 4,
    backgroundColor: Colors.surface,
    borderRadius: 6,
    padding: 8,
    maxHeight: 120,
  },
  stackText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 10,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
});

// ── Detail modal ───────────────────────────────────────────────────────────────

function DetailModal({
  proposalId,
  onClose,
  onApproved,
  onRejected,
}: {
  proposalId: string;
  onClose: () => void;
  onApproved: (restarting: boolean) => void;
  onRejected: () => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const { data: proposal, isLoading } = useQuery<ProposalDetail>({
    queryKey: ['/api/code-proposals', proposalId],
  });

  const approveMutation = useMutation({
    mutationFn: async (): Promise<{ ok: boolean; restarting: boolean }> => {
      const res = await apiRequest('POST', `/api/code-proposals/${proposalId}/approve`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/code-proposals', proposalId] });
      onApproved(data.restarting === true);
      onClose();
    },
    onError: (err: Error) => Alert.alert('Error', err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/code-proposals/${proposalId}/reject`, { note: rejectNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/code-proposals', proposalId] });
      onRejected();
      onClose();
    },
    onError: (err: Error) => Alert.alert('Error', err.message),
  });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[modalStyles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
        {/* Header */}
        <View style={modalStyles.header}>
          <Pressable onPress={onClose} style={modalStyles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={modalStyles.headerTitle} numberOfLines={1}>
            {proposal?.title ?? 'Proposal'}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        {isLoading ? (
          <View style={modalStyles.center}>
            <ActivityIndicator color={Colors.violet} />
          </View>
        ) : !proposal ? (
          <View style={modalStyles.center}>
            <Text style={modalStyles.empty}>Failed to load proposal.</Text>
          </View>
        ) : (
          <ScrollView style={modalStyles.scroll} contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
            {/* Meta */}
            <View style={modalStyles.metaRow}>
              <StatusBadge status={proposal.status} />
              <Text style={modalStyles.filePath} numberOfLines={1}>{proposal.filePath}</Text>
            </View>
            <Text style={modalStyles.reason}>{proposal.reason}</Text>
            {proposal.rejectionNote ? (
              <View style={modalStyles.rejNoteBox}>
                <Text style={modalStyles.rejNoteLabel}>Rejection note</Text>
                <Text style={modalStyles.rejNoteText}>{proposal.rejectionNote}</Text>
              </View>
            ) : null}

            {/* Debug context (shown when proposal originated from a debug session) */}
            {proposal.debugContext ? (
              <DebugContextSection ctx={proposal.debugContext} />
            ) : null}

            {/* Diff */}
            <Text style={modalStyles.sectionTitle}>Before → After</Text>
            <View style={modalStyles.diffBox}>
              <DiffView original={proposal.originalContent} proposed={proposal.proposedContent} />
            </View>

            {/* Reject input */}
            {showRejectInput && (
              <TextInput
                style={modalStyles.noteInput}
                placeholder="Optional rejection note…"
                placeholderTextColor={Colors.textTertiary}
                value={rejectNote}
                onChangeText={setRejectNote}
                multiline
              />
            )}
          </ScrollView>
        )}

        {/* Actions */}
        {proposal?.status === 'pending' && (
          <View style={[modalStyles.actions, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            {!showRejectInput ? (
              <>
                <Pressable
                  style={[modalStyles.btn, modalStyles.rejectBtn]}
                  onPress={() => setShowRejectInput(true)}
                >
                  <Ionicons name="close-circle-outline" size={18} color="#EF4444" />
                  <Text style={[modalStyles.btnText, { color: '#EF4444' }]}>Reject</Text>
                </Pressable>
                <Pressable
                  style={[modalStyles.btn, modalStyles.approveBtn]}
                  onPress={() => {
                    Alert.alert(
                      'Apply Change?',
                      `This will overwrite ${proposal.filePath} with the proposed content. This action cannot be undone.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Apply', style: 'destructive', onPress: () => approveMutation.mutate() },
                      ],
                    );
                  }}
                  disabled={approveMutation.isPending}
                >
                  {approveMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text style={[modalStyles.btnText, { color: '#fff' }]}>Approve & Apply</Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Pressable style={[modalStyles.btn, modalStyles.cancelBtn]} onPress={() => { setShowRejectInput(false); setRejectNote(''); }}>
                  <Text style={[modalStyles.btnText, { color: Colors.textSecondary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[modalStyles.btn, modalStyles.rejectConfirmBtn]}
                  onPress={() => rejectMutation.mutate()}
                  disabled={rejectMutation.isPending}
                >
                  {rejectMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[modalStyles.btnText, { color: '#fff' }]}>Confirm Reject</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        )}
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: Colors.textSecondary, fontSize: 14 },
  scroll: { flex: 1, paddingHorizontal: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 },
  filePath: { flex: 1, fontSize: 12, color: Colors.textTertiary, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  reason: { fontSize: 14, color: Colors.text, lineHeight: 20, marginBottom: 16 },
  rejNoteBox: { backgroundColor: '#EF444411', borderRadius: 8, padding: 12, marginBottom: 16 },
  rejNoteLabel: { fontSize: 11, fontWeight: '600', color: '#EF4444', marginBottom: 4 },
  rejNoteText: { fontSize: 13, color: Colors.textSecondary },
  sectionTitle: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  diffBox: { backgroundColor: Colors.surface, borderRadius: 8, padding: 8, marginBottom: 16, overflow: 'hidden' },
  noteInput: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12 },
  rejectBtn: { backgroundColor: '#EF444411', borderWidth: 1, borderColor: '#EF444433' },
  approveBtn: { backgroundColor: '#10B981' },
  cancelBtn: { backgroundColor: Colors.surface },
  rejectConfirmBtn: { backgroundColor: '#EF4444' },
  btnText: { fontSize: 15, fontWeight: '600' },
});

// ── Card ───────────────────────────────────────────────────────────────────────

function ProposalCard({ proposal, onPress }: { proposal: ProposalSummary; onPress: () => void }) {
  const timeAgo = (() => {
    const diff = Date.now() - new Date(proposal.createdAt).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  })();

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [cardStyles.card, pressed && { opacity: 0.75 }]}>
      <View style={cardStyles.top}>
        <StatusBadge status={proposal.status} />
        <Text style={cardStyles.time}>{timeAgo}</Text>
      </View>
      <Text style={cardStyles.title}>{proposal.title}</Text>
      <Text style={cardStyles.filePath} numberOfLines={1}>{proposal.filePath}</Text>
      <Text style={cardStyles.reason} numberOfLines={2}>{proposal.reason}</Text>
      {proposal.status === 'pending' && (
        <View style={cardStyles.actionHint}>
          <Ionicons name="chevron-forward" size={14} color={Colors.violet} />
          <Text style={cardStyles.actionHintText}>Tap to review diff and approve/reject</Text>
        </View>
      )}
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
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { fontSize: 11, color: Colors.textTertiary },
  title: { fontSize: 15, fontWeight: '600', color: Colors.text },
  filePath: { fontSize: 11, color: Colors.textTertiary, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  reason: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  actionHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  actionHintText: { fontSize: 12, color: Colors.violet },
});

// ── Restart banner ─────────────────────────────────────────────────────────────

type RestartState = 'idle' | 'restarting' | 'active';

function RestartBanner({ state, onDismiss }: { state: RestartState; onDismiss: () => void }) {
  if (state === 'idle') return null;
  const isRestarting = state === 'restarting';
  const bg = isRestarting ? '#F59E0B22' : '#10B98122';
  const border = isRestarting ? '#F59E0B44' : '#10B98144';
  const color = isRestarting ? '#F59E0B' : '#10B981';
  const label = isRestarting ? 'Restarting backend…' : 'Backend is active — change is live';
  return (
    <View style={[bannerStyles.container, { backgroundColor: bg, borderColor: border }]}>
      {isRestarting
        ? <ActivityIndicator size="small" color={color} />
        : <Ionicons name="checkmark-circle-outline" size={16} color={color} />}
      <Text style={[bannerStyles.text, { color }]}>{label}</Text>
      {!isRestarting && (
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Ionicons name="close" size={16} color={color} />
        </Pressable>
      )}
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  text: { flex: 1, fontSize: 13, fontWeight: '500' },
});

// ── Main screen ────────────────────────────────────────────────────────────────

export default function CodeProposalsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [restartState, setRestartState] = useState<RestartState>('idle');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: proposals = [], isLoading } = useQuery<ProposalSummary[]>({
    queryKey: ['/api/code-proposals'],
  });

  const filtered = proposals.filter((p) => filter === 'all' ? true : p.status === filter);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiRequest('GET', '/api/ping');
        if (res.ok) {
          stopPolling();
          setRestartState('active');
          queryClient.invalidateQueries({ queryKey: ['/api/code-proposals'] });
        }
      } catch {
        // server still restarting — keep polling
      }
    }, 2000);
  }, [stopPolling, queryClient]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleApproved = useCallback((restarting: boolean) => {
    queryClient.invalidateQueries({ queryKey: ['/api/code-proposals'] });
    if (restarting) {
      setRestartState('restarting');
      startPolling();
    }
  }, [queryClient, startPolling]);

  const handleRejected = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/code-proposals'] });
  }, [queryClient]);

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Code Proposals</Text>
          <Text style={styles.subtitle}>Review Jarvis&apos;s suggested improvements</Text>
        </View>
      </View>

      {/* Restart banner */}
      <RestartBanner state={restartState} onDismiss={() => setRestartState('idle')} />

      {/* Filter tabs */}
      <View style={styles.tabs}>
        {(['all', 'pending', 'approved', 'rejected'] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tab, filter === tab && styles.tabActive]}
            onPress={() => setFilter(tab)}
          >
            <Text style={[styles.tabText, filter === tab && styles.tabTextActive]}>
              {tab === 'all' ? 'All' : tab === 'pending' ? 'Pending' : tab === 'approved' ? 'Applied' : 'Archived'}
              {tab !== 'all' ? ` (${proposals.filter((p) => p.status === tab).length})` : ` (${proposals.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.violet} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="code-slash-outline" size={48} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>No proposals yet</Text>
          <Text style={styles.emptySubtitle}>
            Ask Jarvis to inspect its own code and suggest improvements — they&apos;ll appear here for your review.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {filtered.map((p) => (
            <ProposalCard key={p.id} proposal={p} onPress={() => setSelectedId(p.id)} />
          ))}
        </ScrollView>
      )}

      {/* Detail modal */}
      {selectedId && (
        <DetailModal
          proposalId={selectedId}
          onClose={() => setSelectedId(null)}
          onApproved={handleApproved}
          onRejected={handleRejected}
        />
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
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textSecondary },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8 },
  tabActive: { backgroundColor: Colors.violet + '22' },
  tabText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  tabTextActive: { color: Colors.violet, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSecondary, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center', lineHeight: 18 },
  list: { flex: 1 },
});
