import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import VisionSprite from '@/components/VisionSprite';

interface GoalItem {
  id: string;
  title: string;
  description: string | null;
  status: 'active' | 'in_progress' | 'complete' | 'blocked';
  category: string;
  current: number;
  target: number;
  unit: string;
  createdAt: string;
  updatedAt?: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  in_progress: { label: 'IN PROGRESS', color: Colors.success, icon: 'trending-up-outline' },
  active: { label: 'ACTIVE', color: Colors.violet, icon: 'radio-button-on-outline' },
  complete: { label: 'COMPLETE', color: Colors.textTertiary, icon: 'checkmark-circle-outline' },
  blocked: { label: 'BLOCKED', color: Colors.error, icon: 'warning-outline' },
};

function statusSort(s: string): number {
  const order: Record<string, number> = { in_progress: 0, active: 1, complete: 2, blocked: 3 };
  return order[s] ?? 4;
}

function GoalCard({ goal, onView }: { goal: GoalItem; onView: () => void }) {
  const cfg = STATUS_CONFIG[goal.status] ?? STATUS_CONFIG.active;
  const pct = goal.target > 0 ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;
  const dateStr = goal.createdAt
    ? new Date(goal.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
    : '';

  return (
    <View style={[styles.card, { borderColor: cfg.color + '30' }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
          <Ionicons name={cfg.icon} size={11} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        {dateStr ? <Text style={styles.cardDate}>{dateStr}</Text> : null}
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>{goal.title}</Text>

      {goal.target > 0 && (
        <View style={styles.progressWrap}>
          <View style={styles.progressBar}>
            <View style={{ flex: pct, backgroundColor: cfg.color, height: 4, borderRadius: 2 }} />
            <View style={{ flex: Math.max(0, 100 - pct) }} />
          </View>
          <Text style={[styles.progressText, { color: cfg.color }]}>{pct}%</Text>
        </View>
      )}

      {goal.target > 0 && (
        <Text style={styles.cardMeta}>
          {goal.current} / {goal.target} {goal.unit}
        </Text>
      )}

      <Pressable
        style={({ pressed }) => [styles.viewBtn, { borderColor: cfg.color + '60', opacity: pressed ? 0.7 : 1 }]}
        onPress={onView}
        accessibilityLabel={`View goal: ${goal.title}`}
      >
        <Text style={[styles.viewBtnText, { color: cfg.color }]}>VIEW</Text>
        <Ionicons name="arrow-forward" size={10} color={cfg.color} />
      </Pressable>
    </View>
  );
}

export default function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const twoCol = width >= 640;
  const router = useRouter();

  const { data, isLoading, isError } = useQuery<GoalItem[]>({
    queryKey: ['/api/goals'],
    refetchInterval: 60_000,
  });

  const sorted = React.useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => statusSort(a.status) - statusSort(b.status));
  }, [data]);

  const handleView = (goal: GoalItem) => {
    router.navigate({ pathname: '/(tabs)/goals', params: { highlightId: goal.id } });
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.violet} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <Ionicons name="warning-outline" size={28} color={Colors.error} />
        <Text style={styles.emptyText}>Failed to load goals</Text>
      </View>
    );
  }

  if (!sorted.length) {
    return (
      <View style={styles.centered}>
        <VisionSprite size={64} tint={Colors.violet} active={false} />
        <Text style={styles.emptyTitle}>No projects yet</Text>
        <Text style={styles.emptyText}>Ask Jarvis to start one</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: bottomPad + 90 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.sectionLabel}>
        <Ionicons name="folder-outline" size={12} color={Colors.violet} />
        <Text style={styles.sectionLabelText}>GOALS & PROJECTS</Text>
        <View style={[styles.countBadge, { backgroundColor: Colors.violet + '25' }]}>
          <Text style={[styles.countBadgeText, { color: Colors.violet }]}>{sorted.length}</Text>
        </View>
      </View>

      <View style={twoCol ? styles.cardsGridTwo : styles.cardsGridOne}>
        {sorted.map(g => (
          <View key={g.id} style={twoCol ? styles.cardWrapTwo : styles.cardWrapOne}>
            <GoalCard goal={g} onView={() => handleView(g)} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    letterSpacing: 0.3,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 10,
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionLabelText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: Colors.violet,
    letterSpacing: 1.5,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  cardsGridOne: {
    gap: 10,
  },
  cardsGridTwo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cardWrapOne: {
    width: '100%',
  },
  cardWrapTwo: {
    width: '48%',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  cardDate: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  cardTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    lineHeight: 20,
  },
  progressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 2,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  progressText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    minWidth: 32,
    textAlign: 'right',
  },
  cardMeta: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 2,
  },
  viewBtnText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.2,
  },
});
