import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GapGroup {
  userMessage: string;
  agentReplySnippet: string | null;
  detectedReason: string;
  channel: string | null;
  occurrenceCount: number;
  addressed: boolean;
  latestCreatedAt: string;
}

interface DismissArgs {
  userMessage: string;
  detectedReason: string;
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
  return `${d}d ago`;
}

function reasonLabel(reason: string): string {
  if (reason === 'deflection') return 'Deflected';
  if (reason === 'apology_only') return 'Apology only';
  if (reason === 'no_tool_for_request') return 'No tool';
  return reason;
}

function reasonColor(reason: string): string {
  if (reason === 'deflection') return Colors.warning;
  if (reason === 'apology_only') return Colors.textSecondary;
  if (reason === 'no_tool_for_request') return Colors.error;
  return Colors.textTertiary;
}

function gapKey(g: GapGroup): string {
  return `${g.userMessage}||${g.detectedReason}`;
}

// ── Reason badge ───────────────────────────────────────────────────────────────

function ReasonBadge({ reason }: { reason: string }) {
  const color = reasonColor(reason);
  return (
    <View style={[badge.container, { backgroundColor: color + '22', borderColor: color + '55' }]}>
      <Text style={[badge.text, { color }]}>{reasonLabel(reason)}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  container: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  text: { fontSize: 10, fontWeight: '600' },
});

// ── Count badge ───────────────────────────────────────────────────────────────

function CountBadge({ count }: { count: number }) {
  return (
    <View style={countBadge.container}>
      <Text style={countBadge.text}>×{count}</Text>
    </View>
  );
}

const countBadge = StyleSheet.create({
  container: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: Colors.violetDim,
    borderWidth: 1,
    borderColor: Colors.borderViolet,
  },
  text: { fontSize: 10, fontWeight: '700', color: Colors.violet },
});

// ── Gap card ──────────────────────────────────────────────────────────────────

function GapCard({
  gap,
  onDismiss,
  dismissing,
}: {
  gap: GapGroup;
  onDismiss: (args: DismissArgs) => void;
  dismissing: boolean;
}) {
  const dimmed = gap.addressed;

  return (
    <View style={[card.container, dimmed && card.containerDimmed]}>
      <View style={card.topRow}>
        <View style={card.topLeft}>
          <ReasonBadge reason={gap.detectedReason} />
          <CountBadge count={gap.occurrenceCount} />
          {gap.addressed ? (
            <View style={card.addressedBadge}>
              <Ionicons name="checkmark-circle" size={11} color={Colors.success} />
              <Text style={card.addressedText}>Dismissed</Text>
            </View>
          ) : null}
        </View>
        <View style={card.topRight}>
          {gap.channel ? (
            <Text style={card.channel}>{gap.channel}</Text>
          ) : null}
          <Text style={card.time}>{timeAgo(gap.latestCreatedAt)}</Text>
        </View>
      </View>

      <Text style={[card.message, dimmed && card.messageDimmed]} numberOfLines={3}>
        {gap.userMessage}
      </Text>

      {gap.agentReplySnippet ? (
        <Text style={[card.reply, dimmed && card.messageDimmed]} numberOfLines={2}>
          Jarvis: &quot;{gap.agentReplySnippet}&quot;
        </Text>
      ) : null}

      {!gap.addressed ? (
        <Pressable
          style={({ pressed }) => [card.dismissBtn, pressed && { opacity: 0.6 }]}
          onPress={() =>
            onDismiss({ userMessage: gap.userMessage, detectedReason: gap.detectedReason })
          }
          disabled={dismissing}
        >
          {dismissing ? (
            <ActivityIndicator size="small" color={Colors.textTertiary} />
          ) : (
            <>
              <Ionicons name="close-circle-outline" size={14} color={Colors.textTertiary} />
              <Text style={card.dismissText}>Dismiss</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const card = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  containerDimmed: {
    opacity: 0.55,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  channel: { fontSize: 10, color: Colors.cyan, fontWeight: '500' },
  time: { fontSize: 11, color: Colors.textTertiary },
  addressedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  addressedText: { fontSize: 10, color: Colors.success, fontWeight: '600' },
  message: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  messageDimmed: { color: Colors.textSecondary },
  reply: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic', lineHeight: 17 },
  dismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: Colors.surfaceAlt,
  },
  dismissText: { fontSize: 12, color: Colors.textTertiary },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CapabilityGapsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dismissingKeys, setDismissingKeys] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, refetch } = useQuery<{ gaps: GapGroup[] }>({
    queryKey: ['/api/capability-gaps'],
  });

  const dismissMutation = useMutation({
    mutationFn: async (args: DismissArgs) => {
      await apiRequest('DELETE', '/api/capability-gaps', args);
    },
    onMutate: (args: DismissArgs) => {
      const key = `${args.userMessage}||${args.detectedReason}`;
      setDismissingKeys((prev) => new Set(prev).add(key));
    },
    onSuccess: (_data, args) => {
      const key = `${args.userMessage}||${args.detectedReason}`;
      setDismissingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['/api/capability-gaps'] });
    },
    onError: (_err, args) => {
      const key = `${args.userMessage}||${args.detectedReason}`;
      setDismissingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      Alert.alert('Error', 'Failed to dismiss the gap. Please try again.');
    },
  });

  const gaps = data?.gaps ?? [];
  const unaddressedCount = gaps.filter((g) => !g.addressed).length;
  const addressedCount = gaps.filter((g) => g.addressed).length;

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Capability Gaps</Text>
          <Text style={styles.subtitle}>What Jarvis couldn&apos;t do this week</Text>
        </View>
        <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={20} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.violet} />
          <Text style={styles.loadingText}>Loading gaps…</Text>
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={40} color={Colors.error} />
          <Text style={styles.errorText}>Failed to load capability gaps.</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : gaps.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={48} color={Colors.success} />
          <Text style={styles.emptyTitle}>No gaps this week</Text>
          <Text style={styles.emptySubtitle}>
            Jarvis handled everything it was asked. Gaps are analysed on Sunday&apos;s self-improvement cycle.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.infoBar}>
            <Ionicons name="information-circle-outline" size={14} color={Colors.textTertiary} />
            <Text style={styles.infoText}>
              {unaddressedCount} open · {addressedCount} dismissed · Sunday&apos;s cycle will analyse unaddressed gaps
            </Text>
          </View>
          <FlatList
            data={gaps}
            keyExtractor={(item) => gapKey(item)}
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
            renderItem={({ item }) => (
              <GapCard
                gap={item}
                onDismiss={(args) => dismissMutation.mutate(args)}
                dismissing={dismissingKeys.has(gapKey(item))}
              />
            )}
            showsVerticalScrollIndicator={false}
          />
        </>
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
  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoText: { fontSize: 12, color: Colors.textTertiary, flex: 1 },
});
