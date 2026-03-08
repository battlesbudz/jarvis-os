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
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import { getStats, type UserStats } from '@/lib/storage';
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
  const [stats, setStats] = useState<UserStats>({ streak: 0, totalCompleted: 0, bestStreak: 0 });
  const [calStatus, setCalStatus] = useState<CalendarStatus>({ google: false, outlook: false });
  const [loadingStatus, setLoadingStatus] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const url = new URL('/api/calendar/status', getApiUrl());
      const res = await fetch(url.toString());
      const data = await res.json();
      setCalStatus(data);
    } catch {
      setCalStatus({ google: false, outlook: false });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    getStats().then(setStats);
    loadStatus();
  }, [loadStatus]);

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

        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={32} color={Colors.white} />
          </View>
          <View style={styles.avatarInfo}>
            <Text style={styles.userName}>Your GamePlan</Text>
            <Text style={styles.userSubtitle}>
              {connectedCount} calendar{connectedCount !== 1 ? 's' : ''} connected
            </Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.streakCard}>
          <View style={styles.streakRow}>
            <View style={styles.streakItem}>
              <Ionicons name="flame" size={24} color={Colors.warning} />
              <Text style={styles.streakValue}>{stats.streak}</Text>
              <Text style={styles.streakLabel}>Current</Text>
            </View>
            <View style={styles.streakDivider} />
            <View style={styles.streakItem}>
              <Ionicons name="trophy" size={24} color={Colors.primary} />
              <Text style={styles.streakValue}>{stats.bestStreak}</Text>
              <Text style={styles.streakLabel}>Best</Text>
            </View>
            <View style={styles.streakDivider} />
            <View style={styles.streakItem}>
              <Ionicons name="checkmark-done" size={24} color={Colors.success} />
              <Text style={styles.streakValue}>{stats.totalCompleted}</Text>
              <Text style={styles.streakLabel}>Done</Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(400)}>
          <Text style={styles.sectionTitle}>Connected Calendars</Text>
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
                    <View style={styles.connectedBadge}>
                      <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
                    </View>
                  ) : (
                    <View style={styles.notConnectedBadge}>
                      <Ionicons name="ellipse-outline" size={22} color={Colors.border} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          <Text style={styles.connectionHint}>
            To reconnect, open your Replit account integrations.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(500)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Preferences</Text>
          <View style={styles.prefsList}>
            <Pressable style={styles.prefRow}>
              <View style={[styles.prefIcon, { backgroundColor: Colors.accent + '15' }]}>
                <Ionicons name="notifications-outline" size={18} color={Colors.accent} />
              </View>
              <Text style={styles.prefLabel}>Notifications</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
            </Pressable>
            <Pressable style={styles.prefRow}>
              <View style={[styles.prefIcon, { backgroundColor: Colors.success + '15' }]}>
                <Ionicons name="time-outline" size={18} color={Colors.success} />
              </View>
              <Text style={styles.prefLabel}>Plan Generation Time</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
            </Pressable>
            <Pressable style={styles.prefRow}>
              <View style={[styles.prefIcon, { backgroundColor: Colors.secondary + '15' }]}>
                <Ionicons name="color-palette-outline" size={18} color={Colors.secondary} />
              </View>
              <Text style={styles.prefLabel}>Appearance</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(600)} style={styles.versionRow}>
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
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  userSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  streakCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 20,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  streakItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  streakValue: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  streakLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  streakDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.border,
  },
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
    marginBottom: 16,
  },
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
  connectedBadge: {
    marginLeft: 8,
  },
  notConnectedBadge: {
    marginLeft: 8,
  },
  connectionHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 10,
    textAlign: 'center',
  },
  prefsList: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginTop: 12,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  prefIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  prefLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
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
