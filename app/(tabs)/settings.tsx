import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  Switch,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useFocusEffect } from 'expo-router';
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
  getCoachingMode,
  saveCoachingMode,
  type UserStats,
  type Reward,
  type LifeContext,
  type CoachingMode,
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
  const [discordConnected, setDiscordConnected] = useState(false);
  const [discordUsername, setDiscordUsername] = useState<string | null>(null);
  const [discordPairExpanded, setDiscordPairExpanded] = useState(false);
  const [discordPairCode, setDiscordPairCode] = useState('');
  const [discordLinking, setDiscordLinking] = useState(false);
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
  const [coachingMode, setCoachingModeState] = useState<CoachingMode>('sharp');
  const [timezone, setTimezone] = useState('America/New_York');

  // ── OpenClaw Brain ──
  type OpenClawMode = 'telegram' | 'gateway';
  const [openclawExpanded, setOpenclawExpanded] = useState(false);
  const [openclawEnabled, setOpenclawEnabled] = useState(false);
  const [openclawMode, setOpenclawMode] = useState<OpenClawMode>('telegram');
  const [openclawTelegramChatId, setOpenclawTelegramChatId] = useState('');
  const [openclawGatewayUrl, setOpenclawGatewayUrl] = useState('');
  const [openclawGatewayToken, setOpenclawGatewayToken] = useState('');
  const [openclawSaving, setOpenclawSaving] = useState(false);
  const [openclawTesting, setOpenclawTesting] = useState(false);
  const [openclawOnline, setOpenclawOnline] = useState<boolean | null>(null);
  const openclawPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (openclawOnline !== true) {
      openclawPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(openclawPulse, { toValue: 1.5, duration: 800, useNativeDriver: true }),
        Animated.timing(openclawPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [openclawOnline, openclawPulse]);

  const loadOpenClawConfig = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/openclaw/config');
      const data = await res.json();
      const cfg = data.config ?? {};
      setOpenclawEnabled(!!cfg.enabled);
      setOpenclawMode(cfg.mode === 'gateway' ? 'gateway' : 'telegram');
      setOpenclawTelegramChatId(cfg.telegramChatId ?? '');
      setOpenclawGatewayUrl(cfg.gatewayUrl ?? '');
      setOpenclawGatewayToken(cfg.gatewayToken ?? '');
    } catch {}
  }, []);

  const saveOpenClawConfig = useCallback(async (patch?: Partial<{ mode: OpenClawMode; enabled: boolean; telegramChatId: string; gatewayUrl: string; gatewayToken: string }>) => {
    setOpenclawSaving(true);
    try {
      await apiRequest('POST', '/api/openclaw/config', {
        mode: patch?.mode ?? openclawMode,
        enabled: patch?.enabled ?? openclawEnabled,
        telegramChatId: patch?.telegramChatId ?? openclawTelegramChatId,
        gatewayUrl: patch?.gatewayUrl ?? openclawGatewayUrl,
        gatewayToken: patch?.gatewayToken ?? openclawGatewayToken,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setOpenclawSaving(false);
  }, [openclawMode, openclawEnabled, openclawTelegramChatId, openclawGatewayUrl, openclawGatewayToken]);

  const testOpenClawConnection = useCallback(async () => {
    setOpenclawTesting(true);
    setOpenclawOnline(null);
    try {
      await saveOpenClawConfig();
      const statusRes = await apiRequest('GET', '/api/openclaw/status').catch(() => null);
      if (statusRes && statusRes.ok) {
        const data = await statusRes.json().catch(() => null);
        setOpenclawOnline(!!(data?.online));
      } else {
        setOpenclawOnline(false);
      }
    } catch {
      setOpenclawOnline(false);
    }
    setOpenclawTesting(false);
  }, [saveOpenClawConfig]);

  // ── Nervous System ──
  interface WatchTopic {
    id: string;
    label: string;
    category: string;
    active: boolean;
    lastCheckedAt: string | null;
  }
  interface NsSignal {
    id: string;
    watchLabel: string;
    headline: string;
    relevanceExplanation: string | null;
    url: string | null;
    createdAt: string;
  }
  const [watches, setWatches] = useState<WatchTopic[]>([]);
  const [recentSignals, setRecentSignals] = useState<NsSignal[]>([]);
  const [newWatchLabel, setNewWatchLabel] = useState('');
  const [newWatchCategory, setNewWatchCategory] = useState('keyword');
  const [nsAddingWatch, setNsAddingWatch] = useState(false);
  const [nsLoading, setNsLoading] = useState(false);

  // ── Gut Threat Log ──
  interface GutThreatSignal {
    id: string;
    signalType: string;
    confidenceScore: number;
    explanation: string;
    itemRef: string | null;
    userResponse: string | null;
    createdAt: string;
  }
  const [threatLog, setThreatLog] = useState<GutThreatSignal[]>([]);
  const [threatLogLoading, setThreatLogLoading] = useState(false);

  const loadThreatLog = useCallback(async () => {
    setThreatLogLoading(true);
    try {
      const res = await apiRequest('GET', '/api/gut/threat-log').then(r => r.json()).catch(() => []);
      setThreatLog(Array.isArray(res) ? res : []);
    } catch {}
    setThreatLogLoading(false);
  }, []);

  const GUT_THREAT_LABEL: Record<string, string> = {
    calendar_anomaly: 'Calendar Anomaly',
    email_pattern: 'Email Manipulation',
    deep_work_erosion: 'Deep Work Erosion',
    project_drift: 'Project Drift',
    relationship_anomaly: 'Relationship Signal',
  };

  const loadNervousSystem = useCallback(async () => {
    setNsLoading(true);
    try {
      const [watchRes, signalRes] = await Promise.all([
        apiRequest('GET', '/api/nervous-system/watches').then(r => r.json()).catch(() => []),
        apiRequest('GET', '/api/nervous-system/signals?limit=5').then(r => r.json()).catch(() => []),
      ]);
      setWatches(Array.isArray(watchRes) ? watchRes : []);
      setRecentSignals(Array.isArray(signalRes) ? signalRes : []);
    } catch {}
    setNsLoading(false);
  }, []);

  const handleAddWatch = useCallback(async () => {
    const label = newWatchLabel.trim();
    if (!label) return;
    try {
      const res = await apiRequest('POST', '/api/nervous-system/watches', { label, category: newWatchCategory });
      const watch = await res.json();
      setWatches(prev => [...prev, watch]);
      setNewWatchLabel('');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
  }, [newWatchLabel, newWatchCategory]);

  const handleToggleWatch = useCallback(async (id: string, active: boolean) => {
    try {
      await apiRequest('PATCH', `/api/nervous-system/watches/${id}`, { active: !active });
      setWatches(prev => prev.map(w => w.id === id ? { ...w, active: !active } : w));
    } catch {}
  }, []);

  const handleDeleteWatch = useCallback(async (id: string) => {
    try {
      await apiRequest('DELETE', `/api/nervous-system/watches/${id}`);
      setWatches(prev => prev.filter(w => w.id !== id));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
  }, []);

  // ── Load everything ──
  const loadAll = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [oauthRes, telegramRes, discordRes] = await Promise.all([
        apiRequest('GET', '/api/oauth/status').then(r => r.json()).catch(() => null),
        apiRequest('GET', '/api/telegram/status').then(r => r.json()).catch(() => null),
        apiRequest('GET', '/api/discord/status').then(r => r.json()).catch(() => null),
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
      setDiscordConnected(discordRes?.connected ?? false);
      setDiscordUsername(discordRes?.discordUsername ?? null);
    } catch {}
    setLoadingStatus(false);

    const [s, lc, name, notif, cm] = await Promise.all([
      getStats(),
      getLifeContext(),
      getUserName(),
      areNotificationsEnabled(),
      getCoachingMode(),
    ]);
    setStats(s);
    setLifeContext(lc);
    setUserName(name ?? '');
    setNotificationsEnabledState(notif);
    setCoachingModeState(cm);
    try {
      const prefsRes = await apiRequest('GET', '/api/data/user-preferences').then(r => r.json()).catch(() => null);
      if (prefsRes?.data?.timezone) setTimezone(prefsRes.data.timezone);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => {
    loadAll();
    loadNervousSystem();
    loadThreatLog();
    loadOpenClawConfig();
    return () => {
      if (telegramPollRef.current) clearInterval(telegramPollRef.current);
    };
  }, [loadAll, loadNervousSystem, loadThreatLog, loadOpenClawConfig]));

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

  const handleDiscordPairSubmit = useCallback(async () => {
    const code = discordPairCode.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-character code from Discord.');
      return;
    }
    setDiscordLinking(true);
    try {
      const res = await apiRequest('POST', '/api/discord/link', { code });
      const data = await res.json();
      if (res.ok && data.ok) {
        setDiscordConnected(true);
        setDiscordUsername(data.discordUsername ?? null);
        setDiscordPairExpanded(false);
        setDiscordPairCode('');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Pairing Failed', data.error ?? 'Could not link Discord. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not connect. Check your network and try again.');
    }
    setDiscordLinking(false);
  }, [discordPairCode]);

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

          {/* Discord */}
          <Pressable
            style={[styles.connRow, styles.connRowBorder]}
            onPress={() => {
              if (!discordConnected) setDiscordPairExpanded(v => !v);
            }}
          >
            <View style={[styles.connIconWrap, { backgroundColor: '#5865F220' }]}>
              <Ionicons name="logo-discord" size={18} color="#5865F2" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Discord</Text>
              <Text style={styles.connSub}>
                {discordConnected
                  ? (discordUsername ? `@${discordUsername}` : 'Connected')
                  : 'Tap to link your Discord account'}
              </Text>
            </View>
            <View style={[styles.connBtn, discordConnected ? styles.connBtnConnected : styles.connBtnDisconnected]}>
              <Text style={[styles.connBtnText, discordConnected && styles.connBtnTextConnected]}>
                {discordConnected ? 'Connected' : 'Connect'}
              </Text>
            </View>
          </Pressable>
          {discordPairExpanded && !discordConnected && (
            <View style={styles.linkCodeBlock}>
              <Text style={styles.linkCodeLabel}>How to link Discord:</Text>
              <Text style={[styles.connSub, { marginBottom: 6 }]}>
                1. Open Discord and DM your Jarvis bot{'\n'}
                2. The bot replies with a 6-character code{'\n'}
                3. Enter that code below
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  style={[styles.linkCodeInput]}
                  placeholder="ABC123"
                  placeholderTextColor={Colors.textTertiary}
                  value={discordPairCode}
                  onChangeText={t => setDiscordPairCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  autoCapitalize="characters"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={handleDiscordPairSubmit}
                />
                <Pressable
                  style={[styles.connBtn, styles.connBtnDisconnected, { paddingHorizontal: 16 }]}
                  onPress={handleDiscordPairSubmit}
                  disabled={discordLinking}
                >
                  {discordLinking
                    ? <ActivityIndicator size="small" color={Colors.cyan} />
                    : <Text style={styles.connBtnText}>Link</Text>
                  }
                </Pressable>
              </View>
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

        {/* ── OPENCLAW BRAIN ── */}
        <SectionHeader label="OPENCLAW BRAIN" accent="#8B5CF6" />
        <View style={styles.card}>
          {/* Header row */}
          <Pressable
            style={styles.connRow}
            onPress={() => setOpenclawExpanded(v => !v)}
          >
            <View style={[styles.connIconWrap, { backgroundColor: '#8B5CF620' }]}>
              <Ionicons name="hardware-chip-outline" size={18} color="#8B5CF6" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>OpenClaw</Text>
              <Text style={styles.connSub}>
                {openclawEnabled
                  ? openclawMode === 'telegram' ? 'Active via Telegram' : 'Active via Gateway'
                  : 'Connect Jarvis to your local AI compute'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {openclawOnline !== null && (
                <Animated.View style={[
                  ocStyles.statusDot,
                  {
                    backgroundColor: openclawOnline ? '#10B981' : Colors.textTertiary,
                    transform: openclawOnline ? [{ scale: openclawPulse }] : [],
                  }
                ]} />
              )}
              <Switch
                value={openclawEnabled}
                onValueChange={async v => {
                  setOpenclawEnabled(v);
                  await saveOpenClawConfig({ enabled: v });
                }}
                trackColor={{ false: Colors.border, true: '#8B5CF660' }}
                thumbColor={openclawEnabled ? '#8B5CF6' : Colors.textTertiary}
              />
            </View>
          </Pressable>

          {/* Expanded config */}
          {openclawExpanded && (
            <View style={[ocStyles.configBlock, styles.connRowBorder]}>
              {/* Mode selector */}
              <Text style={ocStyles.label}>Connection Mode</Text>
              <View style={ocStyles.modeRow}>
                {(['telegram', 'gateway'] as OpenClawMode[]).map(m => (
                  <Pressable
                    key={m}
                    style={[ocStyles.modePill, openclawMode === m && ocStyles.modePillActive]}
                    onPress={() => setOpenclawMode(m)}
                  >
                    <Ionicons
                      name={m === 'telegram' ? 'paper-plane-outline' : 'server-outline'}
                      size={12}
                      color={openclawMode === m ? '#8B5CF6' : Colors.textTertiary}
                    />
                    <Text style={[ocStyles.modePillText, openclawMode === m && ocStyles.modePillTextActive]}>
                      {m === 'telegram' ? 'Telegram' : 'Gateway'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Telegram mode fields */}
              {openclawMode === 'telegram' && (
                <>
                  <Text style={ocStyles.label}>Telegram Chat ID</Text>
                  <Text style={ocStyles.hint}>
                    Your Telegram chat ID where OpenClaw listens. OpenClaw will receive tasks as Telegram messages and reply in that chat.
                  </Text>
                  <TextInput
                    style={ocStyles.input}
                    value={openclawTelegramChatId}
                    onChangeText={setOpenclawTelegramChatId}
                    placeholder="e.g. -100123456789"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </>
              )}

              {/* Gateway mode fields */}
              {openclawMode === 'gateway' && (
                <>
                  <Text style={ocStyles.label}>Gateway URL</Text>
                  <Text style={ocStyles.hint}>
                    Your OpenClaw server URL exposed via a tunnel (ngrok, Cloudflare, Tailscale). E.g. https://xyz.ngrok.app
                  </Text>
                  <TextInput
                    style={ocStyles.input}
                    value={openclawGatewayUrl}
                    onChangeText={setOpenclawGatewayUrl}
                    placeholder="https://your-tunnel.ngrok.app"
                    placeholderTextColor={Colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                  <Text style={[ocStyles.label, { marginTop: 10 }]}>API Token (optional)</Text>
                  <TextInput
                    style={ocStyles.input}
                    value={openclawGatewayToken}
                    onChangeText={setOpenclawGatewayToken}
                    placeholder="Bearer token if your gateway requires auth"
                    placeholderTextColor={Colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                </>
              )}

              {/* Status result */}
              {openclawOnline !== null && (
                <View style={[ocStyles.statusRow, { backgroundColor: openclawOnline ? '#10B98120' : Colors.errorDim ?? '#FF000020' }]}>
                  <Ionicons
                    name={openclawOnline ? 'checkmark-circle' : 'close-circle'}
                    size={14}
                    color={openclawOnline ? '#10B981' : Colors.error}
                  />
                  <Text style={[ocStyles.statusText, { color: openclawOnline ? '#10B981' : Colors.error }]}>
                    {openclawOnline ? 'OpenClaw is reachable' : 'Could not reach OpenClaw'}
                  </Text>
                </View>
              )}

              {/* Actions */}
              <View style={ocStyles.actionRow}>
                <Pressable
                  style={[ocStyles.btn, ocStyles.btnSecondary]}
                  onPress={testOpenClawConnection}
                  disabled={openclawTesting || openclawSaving}
                >
                  {openclawTesting
                    ? <ActivityIndicator size="small" color="#8B5CF6" />
                    : <Text style={[ocStyles.btnText, { color: '#8B5CF6' }]}>Test Connection</Text>
                  }
                </Pressable>
                <Pressable
                  style={[ocStyles.btn, ocStyles.btnPrimary]}
                  onPress={() => saveOpenClawConfig()}
                  disabled={openclawSaving}
                >
                  {openclawSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={[ocStyles.btnText, { color: '#fff' }]}>Save</Text>
                  }
                </Pressable>
              </View>
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

          <View style={[styles.prefRow, styles.prefRowBorder]}>
            <View style={[styles.prefLeft, { flex: 1 }]}>
              <Ionicons name="sparkles-outline" size={16} color={Colors.violet} />
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>Coaching Mode</Text>
                <Text style={styles.prefSub}>How Jarvis communicates with you</Text>
                <View style={styles.coachingModeRow}>
                  {(['sharp', 'flow', 'mentor', 'drill', 'strategist'] as CoachingMode[]).map(m => (
                    <Pressable
                      key={m}
                      style={[styles.modePill, coachingMode === m && styles.modePillActive]}
                      onPress={async () => {
                        setCoachingModeState(m);
                        await saveCoachingMode(m);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                    >
                      <Text style={[styles.modePillText, coachingMode === m && styles.modePillTextActive]}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          </View>

          <View style={[styles.prefRow, styles.prefRowBorder]}>
            <View style={[styles.prefLeft, { flex: 1 }]}>
              <Ionicons name="globe-outline" size={16} color={Colors.violet} />
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>Timezone</Text>
                <Text style={styles.prefSub}>Used for scheduling and morning briefings</Text>
                <TextInput
                  style={styles.tzInput}
                  value={timezone}
                  onChangeText={setTimezone}
                  onBlur={async () => {
                    try {
                      const prefsRes = await apiRequest('GET', '/api/data/user-preferences').then(r => r.json()).catch(() => ({}));
                      const prefs = prefsRes?.data ?? {};
                      prefs.timezone = timezone;
                      await apiRequest('PUT', '/api/data/user-preferences', { data: prefs });
                    } catch {}
                  }}
                  placeholder="e.g. America/New_York"
                  placeholderTextColor={Colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>
          </View>
        </View>

        {/* ── NERVOUS SYSTEM ── */}
        <SectionHeader label="NERVOUS SYSTEM" accent="#F59E0B" />
        <View style={styles.card}>
          {/* Watch Topics */}
          <View style={nsStyles.header}>
            <Ionicons name="radio-outline" size={14} color="#F59E0B" />
            <Text style={nsStyles.headerText}>WATCH TOPICS</Text>
            <Text style={nsStyles.headerSub}>Jarvis monitors these for new signals</Text>
          </View>

          {nsLoading ? (
            <View style={nsStyles.loadingRow}>
              <ActivityIndicator size="small" color="#F59E0B" />
            </View>
          ) : (
            <>
              {watches.length === 0 && (
                <Text style={nsStyles.emptyText}>No watch topics yet. Add companies, keywords, or topics below.</Text>
              )}
              {watches.map((w, idx) => (
                <View key={w.id} style={[nsStyles.watchRow, idx > 0 && styles.prefRowBorder]}>
                  <View style={nsStyles.watchInfo}>
                    <Text style={nsStyles.watchLabel} numberOfLines={1}>{w.label}</Text>
                    <Text style={nsStyles.watchCat}>{w.category}{w.lastCheckedAt ? ` · checked ${new Date(w.lastCheckedAt).toLocaleDateString()}` : ''}</Text>
                  </View>
                  <Switch
                    value={w.active}
                    onValueChange={() => handleToggleWatch(w.id, w.active)}
                    trackColor={{ false: Colors.border, true: '#F59E0B60' }}
                    thumbColor={w.active ? '#F59E0B' : Colors.textTertiary}
                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                  />
                  <Pressable onPress={() => handleDeleteWatch(w.id)} hitSlop={8}>
                    <Ionicons name="close-circle-outline" size={18} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              ))}

              {/* Add watch topic */}
              {nsAddingWatch ? (
                <View style={[nsStyles.addRow, styles.prefRowBorder]}>
                  <TextInput
                    style={nsStyles.addInput}
                    value={newWatchLabel}
                    onChangeText={setNewWatchLabel}
                    placeholder="e.g. Acme Corp, AI regulation..."
                    placeholderTextColor={Colors.textTertiary}
                    autoFocus
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={() => { handleAddWatch(); setNsAddingWatch(false); }}
                  />
                  <View style={nsStyles.catRow}>
                    {(['keyword', 'company', 'person', 'industry'] as const).map(cat => (
                      <Pressable
                        key={cat}
                        style={[nsStyles.catPill, newWatchCategory === cat && nsStyles.catPillActive]}
                        onPress={() => setNewWatchCategory(cat)}
                      >
                        <Text style={[nsStyles.catPillText, newWatchCategory === cat && nsStyles.catPillTextActive]}>
                          {cat}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={nsStyles.addActions}>
                    <Pressable onPress={() => setNsAddingWatch(false)} style={nsStyles.cancelBtn}>
                      <Text style={nsStyles.cancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { handleAddWatch(); setNsAddingWatch(false); }}
                      style={nsStyles.addBtn}
                    >
                      <Text style={nsStyles.addBtnText}>Add</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable style={[nsStyles.addTrigger, watches.length > 0 && styles.prefRowBorder]} onPress={() => setNsAddingWatch(true)}>
                  <Ionicons name="add-circle-outline" size={16} color="#F59E0B" />
                  <Text style={nsStyles.addTriggerText}>Add watch topic</Text>
                </Pressable>
              )}
            </>
          )}

          {/* Recent signals */}
          {recentSignals.length > 0 && (
            <View style={[nsStyles.signalsBlock, styles.prefRowBorder]}>
              <Text style={nsStyles.signalsTitle}>RECENT SIGNALS</Text>
              {recentSignals.map(sig => (
                <View key={sig.id} style={nsStyles.signalRow}>
                  <View style={nsStyles.signalDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={nsStyles.signalHeadline} numberOfLines={2}>{sig.headline}</Text>
                    {sig.relevanceExplanation ? (
                      <Text style={nsStyles.signalExpl} numberOfLines={1}>{sig.relevanceExplanation}</Text>
                    ) : null}
                    <Text style={nsStyles.signalWatch}>{sig.watchLabel}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
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
                    <Ionicons name={badge.icon as any} size={20} color={Colors.violet} />
                    <Text style={styles.badgeLabel} numberOfLines={1}>{badge.label}</Text>
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
                  style={[styles.rewardRow, { borderColor: TIER_COLORS[r.tier] + '40', backgroundColor: TIER_COLORS[r.tier] + '12' }]}
                  onPress={() => { setSelectedReward(r); setRewardModalVisible(true); }}
                >
                  <Ionicons name={r.icon as any} size={18} color={TIER_COLORS[r.tier]} />
                  <View style={styles.rewardInfo}>
                    <Text style={[styles.rewardName, { color: TIER_COLORS[r.tier] }]}>{r.title}</Text>
                    <Text style={styles.rewardDesc} numberOfLines={1}>{r.description}</Text>
                  </View>
                  <Text style={[styles.rewardClaim, { color: TIER_COLORS[r.tier] }]}>Claim →</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* ── JARVIS GUT — THREAT LOG ── */}
        <SectionHeader label="THREAT LOG" accent="#F59E0B" />
        <View style={styles.card}>
          <View style={tlStyles.header}>
            <Ionicons name="eye-outline" size={16} color="#F59E0B" />
            <Text style={tlStyles.headerText}>ANOMALY DETECTION</Text>
            <Text style={tlStyles.headerSub}>Patterns flagged by Jarvis's reflexive gut layer</Text>
          </View>
          {threatLogLoading ? (
            <View style={tlStyles.loadingRow}>
              <ActivityIndicator size="small" color="#F59E0B" />
            </View>
          ) : threatLog.length === 0 ? (
            <Text style={tlStyles.emptyText}>No anomalies detected yet. Jarvis will flag unusual patterns as they appear.</Text>
          ) : (
            threatLog.map((signal, idx) => (
              <View
                key={signal.id}
                style={[tlStyles.signalRow, idx < threatLog.length - 1 && tlStyles.signalBorder]}
              >
                <View style={tlStyles.signalIconWrap}>
                  <Ionicons
                    name={
                      signal.userResponse === 'confirmed' ? 'checkmark-circle' :
                      signal.userResponse === 'dismissed' ? 'close-circle' :
                      'alert-circle'
                    }
                    size={16}
                    color={
                      signal.userResponse === 'confirmed' ? '#10B981' :
                      signal.userResponse === 'dismissed' ? Colors.textTertiary :
                      '#F59E0B'
                    }
                  />
                </View>
                <View style={tlStyles.signalBody}>
                  <View style={tlStyles.signalTitleRow}>
                    <Text style={tlStyles.signalType}>
                      {GUT_THREAT_LABEL[signal.signalType] || signal.signalType}
                    </Text>
                    <View style={[
                      tlStyles.confidenceBadge,
                      { backgroundColor: signal.confidenceScore >= 75 ? '#F59E0B20' : Colors.surfaceAlt }
                    ]}>
                      <Text style={[
                        tlStyles.confidenceText,
                        { color: signal.confidenceScore >= 75 ? '#D97706' : Colors.textTertiary }
                      ]}>
                        {signal.confidenceScore}%
                      </Text>
                    </View>
                  </View>
                  <Text style={tlStyles.signalExplanation} numberOfLines={2}>{signal.explanation}</Text>
                  <Text style={tlStyles.signalDate}>
                    {signal.userResponse
                      ? signal.userResponse === 'confirmed' ? 'Good catch' : "This one's fine"
                      : new Date(signal.createdAt).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* ── JARVIS REPORT ── */}
        <SectionHeader label="JARVIS INTELLIGENCE" accent={Colors.cyan} />
        <View style={styles.card}>
          <Link href="/jarvis-report" asChild>
            <Pressable style={styles.prefRow}>
              <View style={styles.prefLeft}>
                <Ionicons name="bar-chart-outline" size={16} color={Colors.cyan} />
                <View>
                  <Text style={styles.prefTitle}>Jarvis Report</Text>
                  <Text style={styles.prefSub}>Impact metrics & weekly self-report</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </Pressable>
          </Link>
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
        existing={lifeContext}
        onClose={() => setSheetVisible(false)}
        onComplete={() => {
          setSheetVisible(false);
          loadAll();
        }}
      />

      {/* Reward Claim Modal */}
      <RewardClaimModal
        visible={rewardModalVisible}
        reward={selectedReward}
        onClose={() => { setRewardModalVisible(false); setSelectedReward(null); }}
        onClaim={() => { if (selectedReward) handleClaimReward(selectedReward); }}
        claimCount={0}
        canClaim={true}
        budgetRemaining={999}
        dailyXpRequired={0}
        claimedToday={false}
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
  linkCodeInput: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.cyan + '60',
    backgroundColor: Colors.surface,
    color: Colors.text,
    paddingHorizontal: 12,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 3,
    textAlign: 'center',
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
  coachingModeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  modePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modePillActive: {
    borderColor: Colors.violet + '60',
    backgroundColor: Colors.violetDim,
  },
  modePillText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
  modePillTextActive: {
    color: Colors.violet,
  },
  tzInput: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
});

const nsStyles = StyleSheet.create({
  header: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#F59E0B',
    letterSpacing: 1.5,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    width: '100%',
    marginTop: 2,
  },
  loadingRow: {
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  watchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  watchInfo: {
    flex: 1,
    gap: 2,
  },
  watchLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  watchCat: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    textTransform: 'capitalize',
  },
  addTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
  },
  addTriggerText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#F59E0B',
  },
  addRow: {
    padding: 14,
    gap: 10,
  },
  addInput: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  catRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  catPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catPillActive: {
    backgroundColor: '#F59E0B20',
    borderColor: '#F59E0B',
  },
  catPillText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    textTransform: 'capitalize',
  },
  catPillTextActive: {
    color: '#F59E0B',
  },
  addActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cancelText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F59E0B20',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  addBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#F59E0B',
  },
  signalsBlock: {
    padding: 14,
    gap: 10,
  },
  signalsTitle: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: Colors.textTertiary,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  signalRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  signalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
    marginTop: 5,
  },
  signalHeadline: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
    lineHeight: 17,
  },
  signalExpl: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  signalWatch: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 2,
    textTransform: 'capitalize',
  },
});

const tlStyles = StyleSheet.create({
  header: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#F59E0B',
    letterSpacing: 1.5,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    width: '100%',
    marginTop: 2,
  },
  loadingRow: {
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  signalBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  signalIconWrap: {
    paddingTop: 2,
  },
  signalBody: {
    flex: 1,
    gap: 3,
  },
  signalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signalType: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    flex: 1,
  },
  confidenceBadge: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  confidenceText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  signalExplanation: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  signalDate: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
});

const ocStyles = StyleSheet.create({
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  configBlock: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  hint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    lineHeight: 15,
    marginBottom: 4,
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  modePillActive: {
    borderColor: '#8B5CF6',
    backgroundColor: '#8B5CF620',
  },
  modePillText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
  },
  modePillTextActive: {
    color: '#8B5CF6',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  statusText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: '#8B5CF6',
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#8B5CF6',
  },
  btnText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
