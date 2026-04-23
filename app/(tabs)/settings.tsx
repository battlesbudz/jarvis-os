import React, { useCallback, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import Colors from '@/constants/colors';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import {
  getStats,
  claimReward,
  getLevel,
  getLevelName,
  getXpForNextLevel,
  getAvailableRewards,
  getLifetimeXp,
  ALL_BADGES,
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
import RewardClaimModal from '@/components/RewardClaimModal';
import LifeContextSheet from '@/components/LifeContextSheet';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Section header component
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ label, accent }: { label: string; accent: string }) {
  return (
    <View style={[sectionStyles.header, { borderLeftColor: accent }]}>
      <Text style={[sectionStyles.label, { color: accent }]}>{label}</Text>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  header: {
    borderLeftWidth: 2,
    paddingLeft: 10,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 10,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 2,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { logout, username: authUsername } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  // ── Auth state ──
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
  const [androidDaemonCode, setAndroidDaemonCode] = useState<string | null>(null);

  // ── Stats / XP ──
  const [stats, setStats] = useState<UserStats>({
    streak: 0, totalCompleted: 0, bestStreak: 0, xp: 0, badges: [], claimedRewards: [],
    dailyXpEarned: { date: '', xp: 0 },
  });
  const [selectedReward, setSelectedReward] = useState<Reward | null>(null);
  const [rewardModalVisible, setRewardModalVisible] = useState(false);

  // ── Preferences ──
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [lifeContext, setLifeContext] = useState<LifeContext | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [userName, setUserName] = useState('');

  // ── Load everything ──
  const loadAll = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [oauthRes, telegramRes] = await Promise.all([
        apiRequest('GET', '/api/oauth/status').then(r => r.json()).catch(() => null),
        apiRequest('GET', '/api/telegram/status').then(r => r.json()).catch(() => null),
      ]);
      if (oauthRes) setOAuthStatus({
        google: oauthRes.google ?? { connected: false },
        microsoft: oauthRes.microsoft ?? { connected: false },
        slack: oauthRes.slack ?? { connected: false },
      });
      if (telegramRes) setTelegramStatus({
        connected: telegramRes.connected ?? false,
        username: telegramRes.username ?? null,
        configured: telegramRes.configured ?? false,
      });
    } catch {}
    setLoadingStatus(false);

    const [s, lc, name, notif] = await Promise.all([
      getStats(),
      getLifeContext(),
      getUserName(),
      areNotificationsEnabled(),
    ]);
    setStats(s);
    setLifeContext(lc);
    setUserName(name ?? '');
    setNotificationsEnabledState(notif);
  }, []);

  useFocusEffect(useCallback(() => {
    loadAll();
    return () => {
      if (telegramPollRef.current) clearInterval(telegramPollRef.current);
    };
  }, [loadAll]));

  // ── OAuth connect ──
  const handleConnect = useCallback(async (platform: string) => {
    setConnectingId(platform);
    try {
      const url = new URL(`/api/oauth/${platform}/connect`, getApiUrl()).toString();
      await WebBrowser.openAuthSessionAsync(url, getApiUrl().toString());
      await loadAll();
    } catch {}
    setConnectingId(null);
  }, [loadAll]);

  const handleDisconnect = useCallback(async (platform: string) => {
    Alert.alert('Disconnect', `Disconnect ${platform}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          try {
            await apiRequest('DELETE', `/api/oauth/disconnect/${platform}`);
            await loadAll();
          } catch {}
        },
      },
    ]);
  }, [loadAll]);

  // ── Telegram link ──
  const handleTelegramLink = useCallback(async () => {
    try {
      const res = await apiRequest('POST', '/api/telegram/link-code');
      const data = await res.json();
      if (data.code) {
        setTelegramLinkCode(data.code);
        setTelegramPolling(true);
        let attempts = 0;
        telegramPollRef.current = setInterval(async () => {
          attempts++;
          if (attempts > 60) {
            clearInterval(telegramPollRef.current!);
            setTelegramPolling(false);
            return;
          }
          try {
            const statusRes = await apiRequest('GET', '/api/telegram/status');
            const status = await statusRes.json();
            if (status.connected) {
              clearInterval(telegramPollRef.current!);
              setTelegramPolling(false);
              setTelegramLinkCode(null);
              setTelegramStatus({ connected: true, username: status.username ?? null, configured: true });
            }
          } catch {}
        }, 5000);
      }
    } catch {}
  }, []);

  const handleTelegramDisconnect = useCallback(async () => {
    Alert.alert('Disconnect Telegram', 'Disconnect Telegram?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          try {
            await apiRequest('DELETE', '/api/telegram/disconnect');
            setTelegramStatus({ connected: false, username: null, configured: false });
          } catch {}
        },
      },
    ]);
  }, []);

  // ── Android Daemon ──
  const handleAndroidDaemon = useCallback(async () => {
    if (androidDaemonCode) { setAndroidDaemonCode(null); return; }
    try {
      const res = await apiRequest('POST', '/api/daemon/link-code');
      const data = await res.json();
      setAndroidDaemonCode(data.code ?? null);
    } catch {}
  }, [androidDaemonCode]);

  // ── Reward claim ──
  const handleClaimReward = useCallback(async (reward: Reward) => {
    try {
      await claimReward(reward.id);
      const refreshed = await getStats();
      setStats(refreshed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
    setRewardModalVisible(false);
    setSelectedReward(null);
  }, []);

  // ── Computed ──
  const lifetimeXp = getLifetimeXp(stats);
  const level = getLevel(lifetimeXp);
  const levelName = getLevelName(lifetimeXp);
  const xpInfo = getXpForNextLevel(lifetimeXp);
  const xpProgress = xpInfo.progress;
  const availableRewards = getAvailableRewards(lifetimeXp);
  const earnedBadges = (stats.badges ?? []).map(id => ALL_BADGES.find(b => b.id === id)).filter(Boolean);

  // OAuth platform configs
  const PLATFORMS = [
    { id: 'google', name: 'Google', subtitle: 'Calendar + Gmail', icon: 'logo-google' as const, color: '#4285F4' },
    { id: 'microsoft', name: 'Microsoft', subtitle: 'Outlook Calendar', icon: 'logo-windows' as const, color: '#0078D4' },
    { id: 'slack', name: 'Slack', subtitle: 'Messages & Channels', icon: 'chatbubbles-outline' as const, color: '#611f69' },
  ];

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SETTINGS</Text>
        <Text style={styles.headerUser}>{userName || authUsername || 'Agent'}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── CONNECTIONS ── */}
        <SectionHeader label="CONNECTIONS" accent={Colors.cyan} />

        <View style={styles.card}>
          {/* OAuth platforms */}
          {PLATFORMS.map((p, idx) => {
            const status = oauthStatus[p.id as keyof OAuthStatus];
            const isConnecting = connectingId === p.id;
            return (
              <View key={p.id} style={[styles.connRow, idx > 0 && styles.connRowBorder]}>
                <View style={[styles.connIconWrap, { backgroundColor: p.color + '20' }]}>
                  <Ionicons name={p.icon} size={18} color={p.color} />
                </View>
                <View style={styles.connInfo}>
                  <Text style={styles.connName}>{p.name}</Text>
                  <Text style={styles.connSub}>
                    {status.connected
                      ? (status.accounts?.[0]?.email ?? status.email ?? 'Connected')
                      : p.subtitle}
                  </Text>
                </View>
                <Pressable
                  style={[styles.connBtn, status.connected ? styles.connBtnConnected : styles.connBtnDisconnected]}
                  onPress={() => status.connected ? handleDisconnect(p.id) : handleConnect(p.id)}
                  disabled={isConnecting || loadingStatus}
                >
                  {isConnecting ? (
                    <ActivityIndicator size="small" color={Colors.cyan} />
                  ) : (
                    <Text style={[styles.connBtnText, status.connected && styles.connBtnTextConnected]}>
                      {status.connected ? 'Connected' : 'Connect'}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          })}

          {/* Telegram */}
          <View style={[styles.connRow, styles.connRowBorder]}>
            <View style={[styles.connIconWrap, { backgroundColor: '#0088CC20' }]}>
              <Ionicons name="paper-plane-outline" size={18} color="#0088CC" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Telegram</Text>
              <Text style={styles.connSub}>
                {telegramStatus.connected ? (telegramStatus.username ? `@${telegramStatus.username}` : 'Connected') : 'Chat with Jarvis via Telegram'}
              </Text>
            </View>
            <Pressable
              style={[styles.connBtn, telegramStatus.connected ? styles.connBtnConnected : styles.connBtnDisconnected]}
              onPress={telegramStatus.connected ? handleTelegramDisconnect : handleTelegramLink}
            >
              <Text style={[styles.connBtnText, telegramStatus.connected && styles.connBtnTextConnected]}>
                {telegramStatus.connected ? 'Connected' : telegramLinkCode ? '...' : 'Connect'}
              </Text>
            </Pressable>
          </View>

          {/* Telegram link code */}
          {telegramLinkCode && (
            <View style={styles.linkCodeBlock}>
              <Text style={styles.linkCodeLabel}>Send this code to @GamePlanAI_bot on Telegram:</Text>
              <Text style={styles.linkCode}>{telegramLinkCode}</Text>
              {telegramPolling && (
                <View style={styles.linkCodeWait}>
                  <ActivityIndicator size="small" color={Colors.cyan} />
                  <Text style={styles.linkCodeWaitText}>Waiting for connection...</Text>
                </View>
              )}
            </View>
          )}

          {/* Android Daemon */}
          <View style={[styles.connRow, styles.connRowBorder]}>
            <View style={[styles.connIconWrap, { backgroundColor: Colors.successDim }]}>
              <Ionicons name="phone-portrait-outline" size={18} color={Colors.success} />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Android Daemon</Text>
              <Text style={styles.connSub}>Let Jarvis act on your Android device</Text>
            </View>
            <Pressable
              style={[styles.connBtn, androidDaemonCode ? styles.connBtnConnected : styles.connBtnDisconnected]}
              onPress={handleAndroidDaemon}
            >
              <Text style={[styles.connBtnText, androidDaemonCode && styles.connBtnTextConnected]}>
                {androidDaemonCode ? 'Hide' : 'Set Up'}
              </Text>
            </Pressable>
          </View>
          {androidDaemonCode && (
            <View style={styles.linkCodeBlock}>
              <Text style={styles.linkCodeLabel}>Enter this code in the GamePlan Daemon app:</Text>
              <Text style={styles.linkCode}>{androidDaemonCode}</Text>
            </View>
          )}
        </View>

        {/* ── PREFERENCES ── */}
        <SectionHeader label="PREFERENCES" accent={Colors.violet} />
        <View style={styles.card}>
          <Pressable style={styles.prefRow} onPress={() => setSheetVisible(true)}>
            <View style={styles.prefLeft}>
              <Ionicons name="person-outline" size={16} color={Colors.violet} />
              <View>
                <Text style={styles.prefTitle}>Life Context</Text>
                <Text style={styles.prefSub}>{lifeContext ? 'Configured' : 'Tell Jarvis about your life'}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </Pressable>
          <View style={[styles.prefRow, styles.prefRowBorder]}>
            <View style={styles.prefLeft}>
              <Ionicons name="notifications-outline" size={16} color={Colors.violet} />
              <View>
                <Text style={styles.prefTitle}>Notifications</Text>
                <Text style={styles.prefSub}>Push reminders & alerts</Text>
              </View>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={async v => {
                setNotificationsEnabledState(v);
                await setNotificationsEnabled(v);
              }}
              trackColor={{ false: Colors.border, true: Colors.violet + '60' }}
              thumbColor={notificationsEnabled ? Colors.violet : Colors.textTertiary}
            />
          </View>
        </View>

        {/* ── ACHIEVEMENTS ── */}
        <SectionHeader label="ACHIEVEMENTS" accent={Colors.cyan} />
        <View style={styles.card}>
          {/* XP Bar */}
          <View style={styles.xpBlock}>
            <View style={styles.xpTopRow}>
              <View>
                <Text style={styles.xpLevelLabel}>LEVEL {level}</Text>
                <Text style={styles.xpLevelName}>{levelName}</Text>
              </View>
              <View style={styles.xpRight}>
                <Text style={styles.xpValue}>{lifetimeXp} XP</Text>
                <Text style={styles.xpNext}>Next: {xpInfo.needed} XP</Text>
              </View>
            </View>
            <View style={styles.xpBarTrack}>
              <View style={[styles.xpBarFill, { width: `${Math.min(100, Math.round(xpProgress * 100))}%` }]} />
            </View>
            <View style={styles.xpStats}>
              <View style={styles.xpStat}>
                <Text style={styles.xpStatValue}>{stats.streak}</Text>
                <Text style={styles.xpStatLabel}>Streak</Text>
              </View>
              <View style={styles.xpStat}>
                <Text style={styles.xpStatValue}>{stats.totalCompleted}</Text>
                <Text style={styles.xpStatLabel}>Completed</Text>
              </View>
              <View style={styles.xpStat}>
                <Text style={styles.xpStatValue}>{stats.bestStreak}</Text>
                <Text style={styles.xpStatLabel}>Best</Text>
              </View>
            </View>
          </View>

          {/* Badges */}
          {earnedBadges.length > 0 && (
            <View style={[styles.badgeBlock, styles.prefRowBorder]}>
              <Text style={styles.badgeSectionTitle}>BADGES</Text>
              <View style={styles.badgeRow}>
                {earnedBadges.slice(0, 8).map(badge => badge && (
                  <View key={badge.id} style={styles.badge}>
                    <Text style={styles.badgeEmoji}>{badge.emoji}</Text>
                    <Text style={styles.badgeLabel} numberOfLines={1}>{badge.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Rewards */}
          {availableRewards.length > 0 && (
            <View style={styles.prefRowBorder}>
              <Text style={[styles.badgeSectionTitle, { marginTop: 12, marginBottom: 8 }]}>REWARDS TO CLAIM</Text>
              {availableRewards.slice(0, 3).map(r => (
                <Pressable
                  key={r.id}
                  style={[styles.rewardRow, { borderColor: (TIER_COLORS as any)[r.tier] + '40', backgroundColor: (TIER_COLORS as any)[r.tier] + '12' }]}
                  onPress={() => { setSelectedReward(r); setRewardModalVisible(true); }}
                >
                  <Text style={styles.rewardEmoji}>{r.emoji}</Text>
                  <View style={styles.rewardInfo}>
                    <Text style={[styles.rewardName, { color: (TIER_COLORS as any)[r.tier] }]}>{r.name}</Text>
                    <Text style={styles.rewardDesc} numberOfLines={1}>{r.description}</Text>
                  </View>
                  <Text style={[styles.rewardClaim, { color: (TIER_COLORS as any)[r.tier] }]}>Claim →</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* ── ACCOUNT ── */}
        <SectionHeader label="ACCOUNT" accent={Colors.textTertiary} />
        <View style={styles.card}>
          <Pressable style={styles.prefRow} onPress={() => {
            Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', style: 'destructive', onPress: logout },
            ]);
          }}>
            <View style={styles.prefLeft}>
              <Ionicons name="log-out-outline" size={16} color={Colors.error} />
              <Text style={[styles.prefTitle, { color: Colors.error }]}>Sign Out</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </Pressable>
        </View>

      </ScrollView>

      {/* Life Context Sheet */}
      <LifeContextSheet
        visible={sheetVisible}
        initialContext={lifeContext}
        onClose={() => setSheetVisible(false)}
        onSave={ctx => {
          setLifeContext(ctx);
          setSheetVisible(false);
        }}
      />

      {/* Reward Claim Modal */}
      <RewardClaimModal
        visible={rewardModalVisible}
        reward={selectedReward}
        onClose={() => { setRewardModalVisible(false); setSelectedReward(null); }}
        onClaim={() => selectedReward && handleClaimReward(selectedReward)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.textTertiary,
    letterSpacing: 2.5,
  },
  headerUser: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  // Connection rows
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  connRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  connIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connInfo: {
    flex: 1,
    gap: 2,
  },
  connName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  connSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  connBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 76,
    alignItems: 'center',
  },
  connBtnConnected: {
    borderColor: Colors.successDim,
    backgroundColor: Colors.successDim,
  },
  connBtnDisconnected: {
    borderColor: Colors.cyan + '50',
    backgroundColor: Colors.cyanDim,
  },
  connBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.cyan,
  },
  connBtnTextConnected: {
    color: Colors.success,
  },
  linkCodeBlock: {
    marginHorizontal: 14,
    marginBottom: 12,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.cyan + '30',
  },
  linkCodeLabel: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  linkCode: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.cyan,
    letterSpacing: 3,
    textAlign: 'center',
  },
  linkCodeWait: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  linkCodeWaitText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  // Preferences
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    gap: 12,
  },
  prefRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  prefLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  prefTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  prefSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 1,
  },
  // XP / achievements
  xpBlock: {
    padding: 16,
    gap: 10,
  },
  xpTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  xpLevelLabel: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: Colors.cyan,
    letterSpacing: 1.5,
  },
  xpLevelName: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginTop: 2,
  },
  xpRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  xpValue: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.cyan,
  },
  xpNext: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  xpBarTrack: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  xpBarFill: {
    height: '100%',
    backgroundColor: Colors.cyan,
    borderRadius: 2,
  },
  xpStats: {
    flexDirection: 'row',
    gap: 20,
    paddingTop: 4,
  },
  xpStat: {
    alignItems: 'center',
    gap: 2,
  },
  xpStatValue: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  xpStatLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  badgeBlock: {
    padding: 14,
    gap: 8,
  },
  badgeSectionTitle: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: Colors.textTertiary,
    letterSpacing: 1.5,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    alignItems: 'center',
    width: 52,
    gap: 4,
  },
  badgeEmoji: {
    fontSize: 24,
  },
  badgeLabel: {
    fontSize: 9,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  rewardEmoji: {
    fontSize: 22,
  },
  rewardInfo: {
    flex: 1,
    gap: 2,
  },
  rewardName: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  rewardDesc: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  rewardClaim: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
});
