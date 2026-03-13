import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import * as Haptics from 'expo-haptics';
import {
  getStats,
  claimReward,
  getLevel,
  getLevelName,
  getXpForNextLevel,
  getAvailableRewards,
  getDailyXpEarned,
  getDailyBudgetRemaining,
  getLifetimeXp,
  DAILY_XP_REQUIRED,
  getTodayKey,
  ALL_BADGES,
  ALL_REWARDS,
  TIER_COLORS,
  getLifeContext,
  getUserName,
  type UserStats,
  type Reward,
  type LifeContext,
} from '@/lib/storage';
import { areNotificationsEnabled, setNotificationsEnabled } from '@/lib/notifications';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import { useAuth, authFetch } from '@/lib/auth-context';
import * as WebBrowser from 'expo-web-browser';
import RewardClaimModal from '@/components/RewardClaimModal';
import LifeContextSheet from '@/components/LifeContextSheet';

interface Memory {
  id: string;
  content: string;
  category: string;
  extractedAt: string;
}

interface OAuthProviderStatus {
  connected: boolean;
  email?: string;
  accounts?: { email: string; scopes?: string }[];
}

interface OAuthStatus {
  google: OAuthProviderStatus;
  microsoft: OAuthProviderStatus;
  slack: OAuthProviderStatus;
}

interface TelegramStatus {
  connected: boolean;
  username: string | null;
  configured: boolean;
}

interface PlatformInfo {
  id: 'google' | 'microsoft' | 'slack';
  name: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const PLATFORMS: PlatformInfo[] = [
  {
    id: 'google',
    name: 'Google Account',
    subtitle: 'Calendar + Gmail',
    icon: 'logo-google',
    color: '#4285F4',
  },
  {
    id: 'microsoft',
    name: 'Microsoft Account',
    subtitle: 'Outlook Calendar',
    icon: 'logo-windows',
    color: '#0078D4',
  },
  {
    id: 'slack',
    name: 'Slack',
    subtitle: 'Messages & Channels',
    icon: 'chatbubbles-outline',
    color: '#4A154B',
  },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { logout, username: authUsername } = useAuth();
  const [stats, setStats] = useState<UserStats>({
    streak: 0, totalCompleted: 0, bestStreak: 0, xp: 0, badges: [], claimedRewards: [],
    dailyXpEarned: { date: '', xp: 0 },
  });
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>({
    google: { connected: false },
    microsoft: { connected: false },
    slack: { connected: false },
  });
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>({
    connected: false, username: null, configured: false,
  });
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [telegramPolling, setTelegramPolling] = useState(false);
  const telegramPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [selectedReward, setSelectedReward] = useState<Reward | null>(null);
  const [rewardModalVisible, setRewardModalVisible] = useState(false);
  const [lifeContext, setLifeContext] = useState<LifeContext | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [userName, setUserName] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);

  const loadTelegramStatus = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/telegram/status');
      const data = await res.json();
      setTelegramStatus({
        connected: data.connected ?? false,
        username: data.username ?? null,
        configured: data.configured ?? false,
      });
    } catch {
      setTelegramStatus({ connected: false, username: null, configured: false });
    }
  }, []);

  const loadOAuthStatus = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/oauth/status');
      const data = await res.json();
      setOAuthStatus({
        google: data.google ?? { connected: false, accounts: [] },
        microsoft: data.microsoft ?? { connected: false, accounts: [] },
        slack: data.slack ?? { connected: false, accounts: [] },
      });
    } catch {
      setOAuthStatus({ google: { connected: false, accounts: [] }, microsoft: { connected: false, accounts: [] }, slack: { connected: false, accounts: [] } });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const loadMemories = useCallback(async () => {
    setMemoriesLoading(true);
    try {
      const url = new URL('/api/memories', getApiUrl());
      const res = await authFetch(url.toString());
      const data = await res.json();
      if (data.memories && Array.isArray(data.memories)) {
        setMemories(data.memories);
      }
    } catch {}
    setMemoriesLoading(false);
  }, []);

  const handleDeleteMemory = useCallback(async (id: string) => {
    setMemories(prev => prev.filter(m => m.id !== id));
    try {
      const url = new URL(`/api/memories/${id}`, getApiUrl());
      await authFetch(url.toString(), { method: 'DELETE' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      loadMemories();
    }
  }, [loadMemories]);

  const loadAll = useCallback(async () => {
    const [s, lc, notifications, name] = await Promise.all([
      getStats(),
      getLifeContext(),
      areNotificationsEnabled(),
      getUserName(),
    ]);
    setStats(s);
    setLifeContext(lc);
    setNotificationsEnabledState(notifications);
    setUserName(name);
    await Promise.all([loadOAuthStatus(), loadMemories(), loadTelegramStatus()]);
  }, [loadOAuthStatus, loadMemories, loadTelegramStatus]);

  const stopTelegramPolling = useCallback(() => {
    if (telegramPollRef.current) {
      clearInterval(telegramPollRef.current);
      telegramPollRef.current = null;
    }
    setTelegramPolling(false);
    setTelegramLinkCode(null);
  }, []);

  useEffect(() => {
    return () => {
      if (telegramPollRef.current) {
        clearInterval(telegramPollRef.current);
        telegramPollRef.current = null;
      }
    };
  }, []);

  const handleConnectTelegram = useCallback(async () => {
    setConnectingId('telegram');
    try {
      const url = new URL('/api/telegram/link-code', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error || 'Could not generate link code.';
        if (msg.includes('not configured')) {
          alert('Telegram bot not set up yet — add your TELEGRAM_BOT_TOKEN in Replit Secrets to enable this.');
        } else {
          alert(msg);
        }
        setConnectingId(null);
        return;
      }
      if (telegramPollRef.current) {
        clearInterval(telegramPollRef.current);
        telegramPollRef.current = null;
      }

      setTelegramLinkCode(data.code);
      setTelegramPolling(true);
      setConnectingId(null);

      let attempts = 0;
      const maxAttempts = 40;
      const pollInterval = setInterval(async () => {
        attempts++;
        if (attempts >= maxAttempts) {
          stopTelegramPolling();
          return;
        }
        try {
          const statusRes = await apiRequest('GET', '/api/telegram/status');
          const statusData = await statusRes.json();
          if (statusData.connected) {
            stopTelegramPolling();
            setTelegramStatus(statusData);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } catch {}
      }, 3000);
      telegramPollRef.current = pollInterval;
    } catch (e: any) {
      console.error('Telegram connect error:', e);
      alert('Could not generate link code. Please try again.');
      setConnectingId(null);
    }
  }, [stopTelegramPolling]);

  const handleDisconnectTelegram = useCallback(async () => {
    setConnectingId('telegram');
    try {
      await apiRequest('DELETE', '/api/telegram/disconnect');
      setTelegramStatus({ connected: false, username: null, configured: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error('Telegram disconnect error:', e);
    } finally {
      setConnectingId(null);
    }
  }, []);

  const handleConnect = useCallback(async (provider: 'google' | 'microsoft' | 'slack') => {
    setConnectingId(provider);
    try {
      const res = await apiRequest('GET', `/api/oauth/${provider}/authorize`);
      const data = await res.json();
      if (!data.url) {
        if (data.error === 'Microsoft OAuth not configured') {
          alert('Microsoft OAuth is not yet configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to connect Outlook.');
        } else if (data.error === 'Slack OAuth not configured') {
          alert('Slack OAuth is not yet configured. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to connect Slack.');
        }
        return;
      }
      await WebBrowser.openBrowserAsync(data.url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
      });
      await loadOAuthStatus();
    } catch (e: any) {
      console.error('Connect error:', e);
      alert('Could not connect. Please try again.');
    } finally {
      setConnectingId(null);
    }
  }, [loadOAuthStatus]);

  const handleDisconnect = useCallback(async (provider: 'google' | 'microsoft' | 'slack', email?: string) => {
    setConnectingId(provider + (email || ''));
    try {
      const url = email
        ? `/api/oauth/${provider}/disconnect?email=${encodeURIComponent(email)}`
        : `/api/oauth/${provider}/disconnect`;
      await apiRequest('DELETE', url);
      await loadOAuthStatus();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error('Disconnect error:', e);
    } finally {
      setConnectingId(null);
    }
  }, [loadOAuthStatus]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const lifetimeXp = getLifetimeXp(stats);
  const xpInfo = getXpForNextLevel(lifetimeXp);
  const level = getLevel(lifetimeXp);
  const levelName = getLevelName(lifetimeXp);

  const todayStr = getTodayKey();
  const todayXp = getDailyXpEarned(stats);
  const budgetRemaining = getDailyBudgetRemaining(stats);

  const claimCounts: Record<string, number> = {};
  const lastClaimedAt: Record<string, string> = {};
  for (const entry of (stats.claimedRewards || [])) {
    claimCounts[entry.id] = (claimCounts[entry.id] || 0) + 1;
    if (!lastClaimedAt[entry.id] || entry.claimedAt > lastClaimedAt[entry.id]) {
      lastClaimedAt[entry.id] = entry.claimedAt;
    }
  }
  const availableRewards = getAvailableRewards(lifetimeXp);
  const unclaimedAvailable = availableRewards.filter(r => {
    const canAfford = budgetRemaining >= DAILY_XP_REQUIRED[r.tier];
    const claimedToday = (stats.claimedRewards || []).some(
      e => e.id === r.id && e.claimedAt.startsWith(todayStr)
    );
    return canAfford && !claimedToday;
  });

  const handleOpenReward = (reward: Reward) => {
    setSelectedReward(reward);
    setRewardModalVisible(true);
  };

  const handleClaimReward = async (reward: Reward) => {
    await claimReward(reward.id);
    setRewardModalVisible(false);
    setSelectedReward(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const updated = await getStats();
    setStats(updated);
  };

  const handleToggleNotifications = async () => {
    const newValue = !notificationsEnabled;
    setNotificationsEnabledState(newValue);
    await setNotificationsEnabled(newValue);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

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
          <Text style={styles.title}>{userName || 'Profile'}</Text>
        </Animated.View>

        {/* Level + XP card */}
        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.levelCard}>
          <View style={styles.levelTopRow}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>Lv.{level}</Text>
            </View>
            <View style={styles.levelInfo}>
              <Text style={styles.levelName}>{levelName}</Text>
              <Text style={styles.levelXpText}>{stats.xp || 0} XP  ·  {lifetimeXp} earned</Text>
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

        {/* Rewards */}
        <Animated.View entering={FadeInDown.duration(400).delay(350)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Rewards</Text>
          <Text style={styles.sectionSubtitle}>
            {todayXp === 0
              ? 'Complete tasks to earn your daily reward budget'
              : budgetRemaining > 0
                ? `${budgetRemaining} XP budget remaining today`
                : 'Daily budget spent — earn more tomorrow'}
          </Text>
          <View style={styles.rewardsList}>
            {ALL_REWARDS.map((reward) => {
              const permanentlyUnlocked = lifetimeXp >= reward.xpRequired;
              const tierXpCost = DAILY_XP_REQUIRED[reward.tier];
              const canAfford = budgetRemaining >= tierXpCost;
              const budgetDepleted = permanentlyUnlocked && !canAfford && todayXp >= tierXpCost;
              const claimedToday = (stats.claimedRewards || []).some(
                e => e.id === reward.id && e.claimedAt.startsWith(todayStr)
              );
              const count = claimCounts[reward.id] || 0;
              const tierColor = TIER_COLORS[reward.tier];
              const canTap = permanentlyUnlocked && canAfford && !claimedToday;

              return (
                <Pressable
                  key={reward.id}
                  style={[styles.rewardRow, !permanentlyUnlocked && styles.rewardRowLocked]}
                  onPress={() => canTap ? handleOpenReward(reward) : undefined}
                  disabled={!canTap}
                >
                  <View style={[styles.rewardIconCircle, { backgroundColor: permanentlyUnlocked ? tierColor + '22' : '#F1F5F9' }]}>
                    <Ionicons
                      name={reward.icon as any}
                      size={22}
                      color={permanentlyUnlocked ? tierColor : '#CBD5E1'}
                    />
                  </View>
                  <View style={styles.rewardInfo}>
                    <Text style={[styles.rewardTitle, !permanentlyUnlocked && styles.rewardTitleLocked]}>
                      {reward.title}
                    </Text>
                    <Text style={styles.rewardDesc} numberOfLines={1}>
                      {reward.description}
                    </Text>
                    {!permanentlyUnlocked ? (
                      <Text style={styles.rewardXp}>{reward.xpRequired} XP to unlock</Text>
                    ) : claimedToday ? (
                      <Text style={[styles.rewardXpCost, { color: Colors.textTertiary }]}>
                        ⚡ {tierXpCost} XP · claimed today
                      </Text>
                    ) : budgetDepleted ? (
                      <Text style={styles.rewardXpSpent}>
                        ⚡ {tierXpCost} XP · budget used today
                      </Text>
                    ) : !canAfford ? (
                      <Text style={styles.rewardXpEarn}>
                        ⚡ {tierXpCost} XP · need {tierXpCost - todayXp > 0 ? tierXpCost - todayXp : 0} more today
                      </Text>
                    ) : (
                      <Text style={[styles.rewardXpCost, { color: tierColor }]}>
                        ⚡ {tierXpCost} XP to claim
                      </Text>
                    )}
                  </View>
                  {!permanentlyUnlocked ? (
                    <View style={[styles.rewardPill, styles.rewardPillLocked]}>
                      <Ionicons name="lock-closed" size={10} color="#94A3B8" />
                    </View>
                  ) : claimedToday ? (
                    <View style={[styles.rewardPill, styles.rewardPillToday]}>
                      <Ionicons name="checkmark" size={12} color="#059669" />
                    </View>
                  ) : budgetDepleted ? (
                    <View style={[styles.rewardPill, styles.rewardPillSpent]}>
                      <Text style={styles.rewardPillTextSpent}>SPENT</Text>
                    </View>
                  ) : !canAfford ? (
                    <View style={[styles.rewardPill, styles.rewardPillEarn]}>
                      <Ionicons name="flash-outline" size={12} color="#D97706" />
                    </View>
                  ) : (
                    <View style={[styles.rewardPill, { backgroundColor: tierColor + '22' }]}>
                      <Ionicons name="gift-outline" size={12} color={tierColor} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        {/* About You */}
        <Animated.View entering={FadeInDown.duration(400).delay(400)}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { marginTop: 28 }]}>About You</Text>
            {lifeContext && (
              <Pressable style={styles.editBtn} onPress={() => setSheetVisible(true)}>
                <Ionicons name="pencil-outline" size={15} color={Colors.primary} />
                <Text style={styles.editBtnText}>Edit</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.sectionSubtitle}>
            Help your coach understand your life and goals
          </Text>

          {!lifeContext ? (
            <Pressable style={styles.aboutEmptyCard} onPress={() => setSheetVisible(true)}>
              <View style={styles.aboutEmptyIcon}>
                <Ionicons name="sparkles-outline" size={22} color={Colors.primary} />
              </View>
              <View style={styles.aboutEmptyText}>
                <Text style={styles.aboutEmptyTitle}>Tell your coach about you</Text>
                <Text style={styles.aboutEmptySub}>Personalize your plan with 5 quick questions</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
            </Pressable>
          ) : (
            <View style={styles.aboutFilledCard}>
              {[
                { label: 'Priority', value: lifeContext.priorityGoal },
                { label: 'Commitment', value: lifeContext.upcomingDeadline },
                { label: 'Improvement area', value: lifeContext.improvementArea },
                { label: 'Current blocker', value: lifeContext.currentBlocker },
                { label: 'Additional context', value: lifeContext.freeText },
              ]
                .filter(row => row.value && row.value.trim())
                .map((row, i, arr) => (
                  <View key={row.label} style={[styles.aboutRow, i < arr.length - 1 && styles.aboutRowBorder]}>
                    <Text style={styles.aboutLabel}>{row.label.toUpperCase()}</Text>
                    <Text style={styles.aboutValue} numberOfLines={2}>{row.value}</Text>
                  </View>
                ))
              }
              <View style={styles.aboutFooter}>
                <Text style={styles.aboutUpdated}>
                  Updated {formatRelativeDate(lifeContext.lastUpdated)}
                </Text>
                <Pressable onPress={() => setSheetVisible(true)}>
                  <Text style={styles.aboutUpdateBtn}>Update</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Animated.View>

        {/* Coach Memory */}
        <Animated.View entering={FadeInDown.duration(400).delay(420)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Coach Memory</Text>
          <Text style={styles.sectionSubtitle}>
            Facts your coach has learned from conversations
          </Text>
          {memoriesLoading ? (
            <View style={styles.memoryEmptyCard}>
              <ActivityIndicator size="small" color={Colors.textTertiary} />
            </View>
          ) : memories.length === 0 ? (
            <View style={styles.memoryEmptyCard}>
              <View style={styles.memoryEmptyIcon}>
                <Ionicons name="bulb-outline" size={22} color={Colors.textTertiary} />
              </View>
              <Text style={styles.memoryEmptyText}>
                No memories yet — the coach learns from your conversations
              </Text>
            </View>
          ) : (
            <View style={styles.memoryList}>
              {memories.map((memory, idx) => (
                <View
                  key={memory.id}
                  style={[styles.memoryRow, idx < memories.length - 1 && styles.memoryRowBorder]}
                >
                  <View style={styles.memoryContent}>
                    <View style={styles.memoryCategoryRow}>
                      <View style={styles.memoryCategoryPill}>
                        <Text style={styles.memoryCategoryText}>
                          {memory.category.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.memoryText}>{memory.content}</Text>
                  </View>
                  <Pressable
                    style={styles.memoryDeleteBtn}
                    onPress={() => handleDeleteMemory(memory.id)}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={16} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </Animated.View>

        {/* Connected Apps */}
        <Animated.View entering={FadeInDown.duration(400).delay(450)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Connected Apps</Text>
          <Text style={styles.sectionSubtitle}>
            Real data feeds your daily plan and coach
          </Text>
          <View style={styles.platformsList}>
            {PLATFORMS.map((platform, index) => {
              const status = oauthStatus[platform.id];
              const accounts = status?.accounts ?? [];
              const connected = accounts.length > 0 || (status?.connected ?? false);
              const isLast = index === PLATFORMS.length - 1;

              if (platform.id === 'google' && accounts.length > 0) {
                return (
                  <View key={platform.id} style={[!isLast && styles.platformRowBorder]}>
                    {accounts.map((account, accIdx) => {
                      const accLoading = connectingId === platform.id + account.email;
                      const needsCompose = account.scopes && !account.scopes.includes('gmail.compose');
                      return (
                        <View
                          key={account.email || accIdx}
                          style={[styles.platformRow, accIdx < accounts.length - 1 && styles.platformRowBorder]}
                        >
                          <View style={[styles.platformIcon, { backgroundColor: platform.color + '18' }]}>
                            <Ionicons name={platform.icon} size={20} color={platform.color} />
                          </View>
                          <View style={styles.platformInfo}>
                            <View style={styles.platformNameRow}>
                              <Text style={styles.platformName}>{platform.name}</Text>
                              {account.scopes?.includes('gmail.compose') ? (
                                <View style={styles.draftsBadge}>
                                  <Ionicons name="checkmark" size={10} color="#059669" />
                                  <Text style={styles.draftsBadgeText}>Drafts</Text>
                                </View>
                              ) : (
                                <View style={styles.readOnlyBadge}>
                                  <Text style={styles.readOnlyBadgeText}>Read only</Text>
                                </View>
                              )}
                            </View>
                            {account.email ? (
                              <Text style={styles.platformEmail}>{account.email}</Text>
                            ) : (
                              <Text style={styles.platformSubtitle}>{platform.subtitle}</Text>
                            )}
                            {needsCompose && (
                              <Pressable onPress={() => handleConnect(platform.id)}>
                                <Text style={styles.upgradePermText}>Grant draft access</Text>
                              </Pressable>
                            )}
                          </View>
                          {loadingStatus ? (
                            <ActivityIndicator size="small" color={Colors.textTertiary} />
                          ) : accLoading ? (
                            <ActivityIndicator size="small" color={platform.color} />
                          ) : (
                            <Pressable
                              style={styles.disconnectBtn}
                              onPress={() => handleDisconnect(platform.id, account.email)}
                            >
                              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                              <Text style={styles.disconnectBtnText}>Disconnect</Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    })}
                    <View style={[styles.platformRow, styles.platformRowBorder]}>
                      <View style={[styles.platformIcon, { backgroundColor: platform.color + '18' }]}>
                        <Ionicons name="add-circle-outline" size={20} color={platform.color} />
                      </View>
                      <View style={styles.platformInfo}>
                        <Text style={[styles.platformName, { color: platform.color }]}>Add Google Account</Text>
                        <Text style={styles.platformSubtitle}>{platform.subtitle}</Text>
                      </View>
                      {connectingId === platform.id ? (
                        <ActivityIndicator size="small" color={platform.color} />
                      ) : (
                        <Pressable
                          style={[styles.connectBtn, { borderColor: platform.color }]}
                          onPress={() => handleConnect(platform.id)}
                        >
                          <Text style={[styles.connectBtnText, { color: platform.color }]}>Add</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              }

              const isLoading = connectingId === platform.id;
              return (
                <View
                  key={platform.id}
                  style={[styles.platformRow, !isLast && styles.platformRowBorder]}
                >
                  <View style={[styles.platformIcon, { backgroundColor: platform.color + '18' }]}>
                    <Ionicons name={platform.icon} size={20} color={platform.color} />
                  </View>
                  <View style={styles.platformInfo}>
                    <Text style={styles.platformName}>{platform.name}</Text>
                    <Text style={styles.platformSubtitle}>{platform.subtitle}</Text>
                    {connected && status?.email ? (
                      <Text style={styles.platformEmail}>{status.email}</Text>
                    ) : null}
                  </View>
                  {loadingStatus ? (
                    <ActivityIndicator size="small" color={Colors.textTertiary} />
                  ) : isLoading ? (
                    <ActivityIndicator size="small" color={platform.color} />
                  ) : connected ? (
                    <Pressable
                      style={styles.disconnectBtn}
                      onPress={() => handleDisconnect(platform.id)}
                    >
                      <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                      <Text style={styles.disconnectBtnText}>Disconnect</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[styles.connectBtn, { borderColor: platform.color }]}
                      onPress={() => handleConnect(platform.id)}
                    >
                      <Text style={[styles.connectBtnText, { color: platform.color }]}>Connect</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>

          <View style={[styles.platformsList, { marginTop: 12 }]}>
            <View style={styles.platformRow}>
              <View style={[styles.platformIcon, { backgroundColor: '#229ED918' }]}>
                <Ionicons name="paper-plane-outline" size={20} color="#229ED9" />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>Telegram</Text>
                <Text style={styles.platformSubtitle}>Chat + Group Messages</Text>
                {telegramStatus.connected && telegramStatus.username && (
                  <Text style={styles.platformEmail}>@{telegramStatus.username}</Text>
                )}
              </View>
              {loadingStatus ? (
                <ActivityIndicator size="small" color={Colors.textTertiary} />
              ) : connectingId === 'telegram' ? (
                <ActivityIndicator size="small" color="#229ED9" />
              ) : telegramStatus.connected ? (
                <Pressable
                  style={styles.disconnectBtn}
                  onPress={handleDisconnectTelegram}
                >
                  <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                  <Text style={styles.disconnectBtnText}>Disconnect</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.connectBtn, { borderColor: '#229ED9' }]}
                  onPress={handleConnectTelegram}
                >
                  <Text style={[styles.connectBtnText, { color: '#229ED9' }]}>Connect</Text>
                </Pressable>
              )}
            </View>
          </View>

          {telegramLinkCode && (
            <View style={styles.telegramCodeCard}>
              <Text style={styles.telegramCodeTitle}>Link your Telegram</Text>
              <Text style={styles.telegramCodeInstructions}>
                Open Telegram, search for @GamePlanCoachBot, and send this code:
              </Text>
              <View style={styles.telegramCodeBox}>
                <Text style={styles.telegramCodeText}>{telegramLinkCode}</Text>
              </View>
              {telegramPolling && (
                <View style={styles.telegramPollingRow}>
                  <ActivityIndicator size="small" color="#229ED9" />
                  <Text style={styles.telegramPollingText}>Waiting for connection...</Text>
                </View>
              )}
              <Pressable
                style={styles.telegramCancelBtn}
                onPress={stopTelegramPolling}
              >
                <Text style={styles.telegramCancelText}>Cancel</Text>
              </Pressable>
            </View>
          )}

          <Text style={styles.connectionHint}>
            Your data stays private — each account connects independently.
          </Text>
        </Animated.View>

        {/* Settings */}
        <Animated.View entering={FadeInDown.duration(400).delay(480)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Settings</Text>
          <View style={styles.platformsList}>
            <Pressable 
              style={styles.platformRow}
              onPress={handleToggleNotifications}
            >
              <View style={[styles.platformIcon, { backgroundColor: Colors.primary + '15' }]}>
                <Ionicons name="notifications-outline" size={20} color={Colors.primary} />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>Daily Reminders</Text>
                <Text style={styles.platformStatus}>
                  {notificationsEnabled ? 'Enabled' : 'Disabled'}
                </Text>
              </View>
              <Ionicons 
                name={notificationsEnabled ? "toggle" : "toggle-outline"} 
                size={32} 
                color={notificationsEnabled ? Colors.primary : Colors.border} 
              />
            </Pressable>
            <Pressable 
              style={styles.platformRow}
              onPress={logout}
            >
              <View style={[styles.platformIcon, { backgroundColor: '#FF3B3015' }]}>
                <Ionicons name="log-out-outline" size={20} color="#FF3B30" />
              </View>
              <View style={styles.platformInfo}>
                <Text style={[styles.platformName, { color: '#FF3B30' }]}>Log Out</Text>
                <Text style={styles.platformStatus}>
                  {authUsername ? `Signed in as ${authUsername}` : 'Sign out of your account'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(500)} style={styles.versionRow}>
          <Text style={styles.versionText}>GamePlan v1.0.0</Text>
        </Animated.View>
      </ScrollView>

      <RewardClaimModal
        visible={rewardModalVisible}
        reward={selectedReward}
        claimCount={selectedReward ? (claimCounts[selectedReward.id] || 0) : 0}
        lastClaimedAt={selectedReward ? lastClaimedAt[selectedReward.id] : undefined}
        canClaim={selectedReward ? budgetRemaining >= DAILY_XP_REQUIRED[selectedReward.tier] : false}
        budgetRemaining={budgetRemaining}
        dailyXpRequired={selectedReward ? DAILY_XP_REQUIRED[selectedReward.tier] : 30}
        claimedToday={selectedReward
          ? (stats.claimedRewards || []).some(e => e.id === selectedReward.id && e.claimedAt.startsWith(todayStr))
          : false}
        onClaim={() => selectedReward && handleClaimReward(selectedReward)}
        onClose={() => { setRewardModalVisible(false); setSelectedReward(null); }}
      />

      <LifeContextSheet
        visible={sheetVisible}
        existing={lifeContext}
        onComplete={async () => {
          setSheetVisible(false);
          const updated = await getLifeContext();
          setLifeContext(updated);
        }}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

function formatRelativeDate(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  } catch {
    return '';
  }
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
  platformSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 1,
  },
  platformEmail: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.success,
    marginTop: 3,
  },
  connectBtn: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  connectBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  disconnectBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    textDecorationLine: 'underline',
  },
  upgradePermText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#D97706',
    marginTop: 3,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden' as const,
    alignSelf: 'flex-start' as const,
  },
  platformNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  draftsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  draftsBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#059669',
  },
  readOnlyBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  readOnlyBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: '#94A3B8',
  },
  connectionHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 10,
    textAlign: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 0,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 28,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  editBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  aboutEmptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  aboutEmptyIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutEmptyText: {
    flex: 1,
  },
  aboutEmptyTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 2,
  },
  aboutEmptySub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  aboutFilledCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  aboutRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  aboutRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  aboutLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  aboutValue: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 20,
  },
  aboutFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  aboutUpdated: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  aboutUpdateBtn: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  memoryEmptyCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  memoryEmptyIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryEmptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  memoryList: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  memoryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  memoryRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  memoryContent: {
    flex: 1,
  },
  memoryCategoryRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  memoryCategoryPill: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  memoryCategoryText: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  memoryText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 20,
  },
  memoryDeleteBtn: {
    padding: 4,
    marginLeft: 8,
    marginTop: 2,
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

  /* Rewards */
  rewardsList: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rewardRowLocked: {
    opacity: 0.6,
  },
  rewardIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rewardInfo: {
    flex: 1,
  },
  rewardTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  rewardTitleLocked: {
    color: Colors.textTertiary,
  },
  rewardDesc: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  rewardXp: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
    marginTop: 3,
  },
  rewardXpCost: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 3,
  },
  rewardXpEarn: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: '#D97706',
    marginTop: 3,
  },
  rewardXpSpent: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: '#DC2626',
    marginTop: 3,
  },
  rewardPill: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
  },
  rewardPillLocked: {
    backgroundColor: '#F1F5F9',
  },
  rewardPillEarn: {
    backgroundColor: '#FEF3C7',
  },
  rewardPillSpent: {
    backgroundColor: '#FEE2E2',
  },
  rewardPillToday: {
    backgroundColor: '#D1FAE5',
  },
  rewardPillTextLocked: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  rewardPillTextEarn: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#D97706',
    letterSpacing: 0.5,
  },
  rewardPillTextSpent: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  rewardPillTextToday: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#059669',
    letterSpacing: 0.5,
  },
  rewardPillTextAvail: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
  telegramCodeCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#229ED940',
    padding: 20,
    marginTop: 12,
    alignItems: 'center' as const,
  },
  telegramCodeTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 8,
  },
  telegramCodeInstructions: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: 16,
    lineHeight: 18,
  },
  telegramCodeBox: {
    backgroundColor: '#229ED910',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderWidth: 2,
    borderColor: '#229ED940',
    borderStyle: 'dashed' as const,
    marginBottom: 12,
  },
  telegramCodeText: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: '#229ED9',
    letterSpacing: 4,
    textAlign: 'center' as const,
  },
  telegramPollingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  telegramPollingText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#229ED9',
  },
  telegramCancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  telegramCancelText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
  },
});
