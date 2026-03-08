import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import {
  getPlatforms,
  togglePlatform,
  getStats,
  type ConnectedPlatform,
  type UserStats,
} from '@/lib/storage';

const PLATFORM_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  calendar: 'calendar-outline',
  'heart-pulse': 'heart-outline',
  'credit-card': 'card-outline',
  briefcase: 'briefcase-outline',
  bike: 'bicycle-outline',
  mail: 'mail-outline',
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const [platforms, setPlatforms] = useState<ConnectedPlatform[]>([]);
  const [stats, setStats] = useState<UserStats>({ streak: 0, totalCompleted: 0, bestStreak: 0 });

  useEffect(() => {
    getPlatforms().then(setPlatforms);
    getStats().then(setStats);
  }, []);

  const handleToggle = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await togglePlatform(id);
    const updated = await getPlatforms();
    setPlatforms(updated);
  };

  const connectedCount = platforms.filter(p => p.connected).length;

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
            <Text style={styles.userSubtitle}>{connectedCount} platform{connectedCount !== 1 ? 's' : ''} connected</Text>
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
          <Text style={styles.sectionTitle}>Connected Platforms</Text>
          <Text style={styles.sectionSubtitle}>
            Connect services to get smarter daily plans
          </Text>
          <View style={styles.platformsList}>
            {platforms.map((platform) => (
              <View key={platform.id} style={styles.platformRow}>
                <View style={[styles.platformIcon, { backgroundColor: platform.connected ? Colors.primary + '15' : Colors.surfaceAlt }]}>
                  <Ionicons
                    name={PLATFORM_ICONS[platform.icon] || 'ellipse-outline'}
                    size={20}
                    color={platform.connected ? Colors.primary : Colors.textTertiary}
                  />
                </View>
                <View style={styles.platformInfo}>
                  <Text style={styles.platformName}>{platform.name}</Text>
                  <Text style={styles.platformCategory}>
                    {platform.category.charAt(0).toUpperCase() + platform.category.slice(1)}
                  </Text>
                </View>
                <Switch
                  value={platform.connected}
                  onValueChange={() => handleToggle(platform.id)}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={platform.connected ? Colors.primary : Colors.textTertiary}
                />
              </View>
            ))}
          </View>
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
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  platformIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  platformInfo: {
    flex: 1,
  },
  platformName: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  platformCategory: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 2,
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
