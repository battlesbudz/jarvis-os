import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Switch,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';

interface SkillPack {
  id: string;
  name: string;
  description: string;
  version: number;
  isActive: boolean;
}

const PACK_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'ADHD Focus Mode': 'flash-outline',
  'Deep Work Mode': 'shield-outline',
  'Research Mode': 'search-outline',
  'Email Zero': 'mail-outline',
};

const PACK_ACCENT: Record<string, string> = {
  'ADHD Focus Mode': Colors.warning,
  'Deep Work Mode': Colors.violet,
  'Research Mode': Colors.cyan,
  'Email Zero': Colors.success,
};

function PackCard({
  pack,
  onToggle,
  toggling,
}: {
  pack: SkillPack;
  onToggle: (pack: SkillPack) => void;
  toggling: boolean;
}) {
  const icon = PACK_ICONS[pack.name] ?? 'sparkles-outline';
  const accent = PACK_ACCENT[pack.name] ?? Colors.cyan;

  return (
    <View style={[styles.card, pack.isActive && { borderColor: accent, borderWidth: 1 }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconWrap, { backgroundColor: `${accent}1A` }]}>
          <Ionicons name={icon} size={18} color={accent} />
        </View>
        <View style={styles.cardTitles}>
          <View style={styles.nameRow}>
            <Text style={styles.packName}>{pack.name}</Text>
            <View style={[styles.versionChip, { backgroundColor: `${accent}22` }]}>
              <Text style={[styles.versionText, { color: accent }]}>v{pack.version}</Text>
            </View>
          </View>
          <Text style={styles.packDesc}>{pack.description}</Text>
        </View>
        <View style={styles.toggleWrap}>
          {toggling ? (
            <ActivityIndicator size="small" color={accent} />
          ) : (
            <Switch
              value={pack.isActive}
              onValueChange={() => onToggle(pack)}
              trackColor={{ false: Colors.border, true: `${accent}55` }}
              thumbColor={pack.isActive ? accent : Colors.textTertiary}
              ios_backgroundColor={Colors.border}
            />
          )}
        </View>
      </View>
      {pack.isActive && (
        <View style={styles.activeBadgeRow}>
          <Ionicons name="checkmark-circle" size={12} color={accent} />
          <Text style={[styles.activeBadgeText, { color: accent }]}>Active — takes effect on next conversation</Text>
        </View>
      )}
    </View>
  );
}

export default function SkillsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<{ packs: SkillPack[] }>({
    queryKey: ['/api/skill-packs'],
  });

  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const activate = useMutation({
    mutationFn: (packId: string) => apiRequest('POST', `/api/skill-packs/${packId}/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/skill-packs'] }),
  });

  const deactivate = useMutation({
    mutationFn: (packId: string) => apiRequest('DELETE', `/api/skill-packs/${packId}/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/skill-packs'] }),
  });

  const handleToggle = useCallback(async (pack: SkillPack) => {
    setTogglingId(pack.id);
    try {
      if (pack.isActive) {
        await deactivate.mutateAsync(pack.id);
      } else {
        await activate.mutateAsync(pack.id);
      }
    } finally {
      setTogglingId(null);
    }
  }, [activate, deactivate]);

  const packs = data?.packs ?? [];

  const paddingTop = isWeb ? 67 : insets.top;
  const paddingBottom = isWeb ? 34 : insets.bottom + 16;

  return (
    <View style={[styles.container, { paddingTop }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Skill Store</Text>
          <Text style={styles.headerSub}>Personalise how Jarvis thinks and acts</Text>
        </View>
      </View>

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.cyan} />
        </View>
      )}

      {isError && !isLoading && (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color={Colors.error} />
          <Text style={styles.errorText}>Could not load skills</Text>
        </View>
      )}

      {!isLoading && !isError && packs.length === 0 && (
        <View style={styles.center}>
          <Ionicons name="cube-outline" size={40} color={Colors.textTertiary} />
          <Text style={styles.emptyText}>No skill packs available yet</Text>
          <Text style={styles.emptySubText}>The Jarvis team will publish packs here soon</Text>
        </View>
      )}

      {!isLoading && packs.length > 0 && (
        <FlatList
          data={packs}
          keyExtractor={(p) => p.id}
          contentContainerStyle={[styles.list, { paddingBottom }]}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListHeaderComponent={
            <Text style={styles.sectionLabel}>AVAILABLE PACKS</Text>
          }
          renderItem={({ item }) => (
            <PackCard
              pack={item}
              onToggle={handleToggle}
              toggling={togglingId === item.id}
            />
          )}
          ListFooterComponent={
            <Text style={styles.footerNote}>
              Active packs' instructions are merged into Jarvis's context at the start of each conversation.
              Only skills enabled here affect behaviour — toggle any time.
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 32,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center',
  },
  emptyText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
  emptySubText: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  sep: {
    height: 10,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  cardTitles: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  packName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  versionChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  versionText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  packDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  toggleWrap: {
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  activeBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  footerNote: {
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 17,
    paddingHorizontal: 8,
  },
});
