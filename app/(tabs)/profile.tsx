import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import Colors from '@/constants/colors';
import {
  getStats,
  getLevel,
  getLevelName,
  getXpForNextLevel,
  ALL_BADGES,
  type UserStats,
} from '@/lib/storage';
import { getApiUrl } from '@/lib/query-client';

interface CalendarStatus {
  google: boolean;
  outlook: boolean;
}

interface PlatformInfo {
  id: 'google' | 'outlook';
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const PLATFORMS: PlatformInfo[] = [
  { id: 'google', name: 'Google Calendar', icon: 'calendar-outline', color: '#4285F4' },
  { id: 'outlook', name: 'Microsoft Outlook', icon: 'mail-outline', color: '#0078D4' },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<UserStats>({
    streak: 0, totalCompleted: 0, bestStreak: 0, xp: 0, badges: [],
  });
  const [calStatus, setCalStatus] = useState<CalendarStatus>({ google: false, outlook: false });
  const [loadingStatus, setLoadingStatus] = useState(true);

  const loadAll = useCallback(async () => {
    const [s] = await Promise.all([getStats()]);
    setStats(s);
    try {
      const url = new URL('/api/calendar/status', getApiUrl());
      const res = await fetch(url.toString(), { cache: 'no-store' });
      const data = await res.json();
      setCalStatus(data);
    } catch {
      setCalStatus({ google: false, outlook: false });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const xpInfo = getXpForNextLevel(stats.xp || 0);
  const level = getLevel(stats.xp || 0);
  const levelName = getLevelName(stats.xp || 0);
  const connectedCount = (calStatus.google ? 1 : 0) + (calStatus.outlook ? 1 : 0);
  const isConnected = (id: 'google' | 'outlook') =>
    id === 'google' ? calStatus.google : calStatus.outlook;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 16 + (Platform.OS === 'web' ? 67 : 0),
            paddingBottom: Platform.OS === 'web' ? 34 + 100 : 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400).delay(100)}>
          <Text style={styles.title}>Profile</Text>
        </Animated.View>

        {/* Level + XP card */}
        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.levelCard}>
          <View style={styles.levelTopRow}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>Lv.{level}</Text>
            </View>
            <View style={styles.levelInfo}>
              <Text style={styles.levelName}>{levelName}</Text>
              <Text style={styles.levelXpText}>{stats.xp || 0} XP total</Text>
            </View>
            <View style={styles.avatarSmall}>
              <Ionicons name="person" size={20} color={Colors.white} />
            </View>
          </View>
          <View style={styles.xpBarTrack}>
            <Animated.View
              style={[styles.xpBarFill, { width: `${Math.round(xpInfo.progress * 100)}%` as any }]}
            />
          </View>
          <View style={styles.xpBarLabels}>
            <Text style={styles.xpBarLabel}>{xpInfo.current} / {xpInfo.needed} XP to Lv.{level + 1}</Text>
            <Text style={styles.xpBarLabel}>{Math.round(xpInfo.progress * 100)}%</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="flame" size={20} color={Colors.warning} />
              <Text style={styles.statValue}>{stats.streak}</Text>
              <Text style={styles.statLabel}>Streak</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Ionicons name="trophy" size={20} color={Colors.primary} />
              <Text style={styles.statValue}>{stats.bestStreak}</Text>
              <Text style={styles.statLabel}>Best</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Ionicons name="checkmark-done" size={20} color={Colors.success} />
              <Text style={styles.statValue}>{stats.totalCompleted}</Text>
              <Text style={styles.statLabel}>Done</Text>
            </View>
          </View>
        </Animated.View>

        {/* Badges */}
        <Animated.View entering={FadeInDown.duration(400).delay(300)}>
          <Text style={styles.sectionTitle}>Achievements</Text>
          <Text style={styles.sectionSubtitle}>
            {stats.badges.length} of {ALL_BADGES.length} unlocked
          </Text>
          <View style={styles.badgeGrid}>
            {ALL_BADGES.map((badge) => {
              const unlocked = stats.badges.includes(badge.id);
              return (
                <View
                  key={badge.id}
                  style={[styles.badgeCell, unlocked && styles.badgeCellUnlocked]}
                >
                  <View style={[styles.badgeIcon, unlocked && styles.badgeIconUnlocked]}>
                    <Ionicons
                      name={badge.icon as any}
                      size={22}
                      color={unlocked ? Colors.primary : Colors.border}
                    />
                  </View>
                  <Text style={[styles.badgeLabel, unlocked && styles.badgeLabelUnlocked]}>
                    {badge.label}
                  </Text>
                  <Text style={styles.badgeDesc} numberOfLines={2}>
                    {badge.description}
                  </Text>
                  {unlocked && (
                    <View style={styles.badgeUnlockedDot} />
                  )}
                </View>
              );
            })}
          </View>
        </Animated.View>

        {/* Connected Calendars */}
        <Animated.View entering={FadeInDown.duration(400).delay(400)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Connected Calendars</Text>
          <Text style={styles.sectionSubtitle}>
            Real events appear in your daily plan
          </Text>
          <View style={styles.platformsList}>
            {PLATFORMS.map((platform, index) => {
              const connected = !loadingStatus && isConnected(platform.id);
              return (
                <View
                  key={platform.id}
                  style={[
                    styles.platformRow,
                    index < PLATFORMS.length - 1 && styles.platformRowBorder,
                  ]}
                >
                  <View style={[styles.platformIcon, { backgroundColor: platform.color + '15' }]}>
                    <Ionicons name={platform.icon} size={20} color={platform.color} />
                  </View>
                  <View style={styles.platformInfo}>
                    <Text style={styles.platformName}>{platform.name}</Text>
                    <Text style={[styles.platformStatus, connected && styles.platformStatusConnected]}>
                      {loadingStatus ? 'Checking...' : connected ? 'Connected' : 'Not connected'}
                    </Text>
                  </View>
                  {loadingStatus ? (
                    <ActivityIndicator size="small" color={Colors.textTertiary} />
                  ) : connected ? (
                    <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={22} color={Colors.border} />
                  )}
                </View>
              );
            })}
          </View>
          <Text style={styles.connectionHint}>
            To reconnect, open your Replit account integrations.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(500)} style={styles.versionRow}>
          <Text style={styles.versionText}>GamePlan v1.0.0</Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 20,
  },

  /* Level card */
  levelCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 20,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  levelTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  levelBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 12,
  },
  levelBadgeText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.white,
  },
  levelInfo: {
    flex: 1,
  },
  levelName: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  levelXpText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 1,
  },
  avatarSmall: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xpBarTrack: {
    height: 8,
    backgroundColor: Colors.borderLight,
    borderRadius: 99,
    overflow: 'hidden',
    marginBottom: 6,
  },
  xpBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 99,
  },
  xpBarLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  xpBarLabel: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 16,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: Colors.border,
  },

  /* Section headings */
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 14,
  },

  /* Badge grid */
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  badgeCell: {
    width: '30.5%',
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
    position: 'relative',
    opacity: 0.5,
  },
  badgeCellUnlocked: {
    opacity: 1,
    borderColor: Colors.primary + '40',
    backgroundColor: Colors.primary + '08',
  },
  badgeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  badgeIconUnlocked: {
    backgroundColor: Colors.primary + '15',
  },
  badgeLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    textAlign: 'center',
    marginBottom: 3,
  },
  badgeLabelUnlocked: {
    color: Colors.text,
  },
  badgeDesc: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 13,
  },
  badgeUnlockedDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },

  /* Calendars */
  platformsList: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  platformRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  platformIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  platformInfo: {
    flex: 1,
  },
  platformName: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  platformStatus: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 2,
  },
  platformStatusConnected: {
    color: Colors.success,
    fontFamily: 'Inter_500Medium',
  },
  connectionHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 10,
    textAlign: 'center',
  },
  versionRow: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  versionText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
});
