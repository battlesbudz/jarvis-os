import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  Modal,
  FlatList,
  Alert,
  Linking,
  TextInput,
  Switch,
  Image,
  findNodeHandle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import Colors from '@/constants/colors';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
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

interface UserDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: 'processing' | 'ready' | 'error';
  summary?: string | null;
  uploadedAt: string;
}

const SUPPORTED_DOC_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Memory {
  id: string;
  content: string;
  category: string;
  extractedAt: string;
}

interface MorningVoiceNote {
  id: string;
  recordedAt: string;
  transcript: string;
  moodSignal: string;
  themes: string[];
  blockers: string[];
  wins: string[];
  intention: string | null;
}

const MOOD_COLORS: Record<string, string> = {
  calm: '#10B981',
  energized: '#F59E0B',
  stressed: '#EF4444',
  overwhelmed: '#8B5CF6',
  uncertain: '#6B7280',
};

function formatNoteDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (dateStr === todayStr) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (dateStr === yesterdayStr) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  webhookHealthy: boolean | null;
  webhookLastChecked: string | null;
}

interface PlatformInfo {
  id: 'google' | 'microsoft' | 'slack';
  name: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const TIMEZONES = [
  { label: 'Eastern (ET)', value: 'America/New_York' },
  { label: 'Central (CT)', value: 'America/Chicago' },
  { label: 'Mountain (MT)', value: 'America/Denver' },
  { label: 'Pacific (PT)', value: 'America/Los_Angeles' },
  { label: 'Alaska (AKT)', value: 'America/Anchorage' },
  { label: 'Hawaii (HT)', value: 'Pacific/Honolulu' },
  { label: 'London (GMT/BST)', value: 'Europe/London' },
  { label: 'Paris/Berlin (CET)', value: 'Europe/Paris' },
  { label: 'Dubai (GST)', value: 'Asia/Dubai' },
  { label: 'India (IST)', value: 'Asia/Kolkata' },
  { label: 'Singapore (SGT)', value: 'Asia/Singapore' },
  { label: 'Tokyo (JST)', value: 'Asia/Tokyo' },
  { label: 'Sydney (AEST)', value: 'Australia/Sydney' },
];

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
  const router = useRouter();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const scrollViewRef = useRef<ScrollView>(null);
  const webhookRowRef = useRef<View>(null);
  const { logout, username: authUsername, userEmail: authUserEmail } = useAuth();
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
    connected: false, username: null, configured: false, webhookHealthy: null, webhookLastChecked: null,
  });
  const [webhookResetting, setWebhookResetting] = useState(false);
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [telegramPolling, setTelegramPolling] = useState(false);
  const [channelData, setChannelData] = useState<{
    channels: { name: string; configured: boolean; connected: boolean }[];
    connected: Record<string, boolean>;
    meta: Record<string, any>;
    notificationTypes: string[];
    preferences: Record<string, string[]>;
    desktop_daemon_connected?: boolean;
    android_daemon_connected?: boolean;
  } | null>(null);
  const [whatsappCode, setWhatsappCode] = useState<{ code: string; twilioNumber: string | null } | null>(null);
  const [daemonCode, setDaemonCode] = useState<string | null>(null);
  const [daemonPerms, setDaemonPerms] = useState<Record<string, boolean> | null>(null);
  const [daemonPermsBusy, setDaemonPermsBusy] = useState<string | null>(null);
  const [androidDaemonCode, setAndroidDaemonCode] = useState<string | null>(null);
  const [androidDaemonPerms, setAndroidDaemonPerms] = useState<Record<string, boolean> | null>(null);
  const [androidDaemonPermsBusy, setAndroidDaemonPermsBusy] = useState<string | null>(null);
  const [channelBusy, setChannelBusy] = useState<string | null>(null);
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
  const [soul, setSoul] = useState<{ content: string; manualOverride: string | null; generatedAt: string | null } | null>(null);
  const [soulLoading, setSoulLoading] = useState(true);
  const [soulExpanded, setSoulExpanded] = useState(false);
  const [soulRegenerating, setSoulRegenerating] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState('');
  const [overrideEditing, setOverrideEditing] = useState(false);
  const [contentEditing, setContentEditing] = useState(false);
  const [contentDraft, setContentDraft] = useState('');
  const [savingContent, setSavingContent] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string; email: string | null; relationship: string | null; notes: string | null; lastInteractionAt: string | null; nextInteractionAt: string | null; upcomingCount: number; interactionCount: number }[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [morningNotes, setMorningNotes] = useState<MorningVoiceNote[]>([]);
  const [morningNotesLoading, setMorningNotesLoading] = useState(true);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [dreamInsights, setDreamInsights] = useState<{ id: string; dreamDate: string; insightText: string; confidenceScore: number; shownToUser: boolean; createdAt: string; sourceMemoryIds?: string[] }[]>([]);
  const [dreamInsightsLoading, setDreamInsightsLoading] = useState(true);
  const [expandedDreamId, setExpandedDreamId] = useState<string | null>(null);
  const [expandedInsightMemoryId, setExpandedInsightMemoryId] = useState<string | null>(null);
  const [insightMemoriesCache, setInsightMemoriesCache] = useState<Record<string, { id: string; content: string; category: string; confidence: number }[]>>({});
  const [dreamEnabled, setDreamEnabled] = useState(true);
  const [timezone, setTimezone] = useState('America/New_York');
  const [showTimezoneModal, setShowTimezoneModal] = useState(false);
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(true);
  const [chatgptImportStatus, setChatgptImportStatus] = useState<{
    imported: boolean;
    importedAt?: string;
    memoriesAdded?: number;
  }>({ imported: false });
  const [chatgptImporting, setChatgptImporting] = useState(false);
  const [chatgptImportResult, setChatgptImportResult] = useState<number | null>(null);
  const [discordBotToken, setDiscordBotToken] = useState('');
  const [discordBotTokenVisible, setDiscordBotTokenVisible] = useState(false);
  const [discordPairCode, setDiscordPairCode] = useState('');
  const [discordShowOwnBot, setDiscordShowOwnBot] = useState(false);
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordPairing, setDiscordPairing] = useState(false);
  const [discordShowManage, setDiscordShowManage] = useState(false);
  const [discordGuilds, setDiscordGuilds] = useState<{id: string; name: string}[]>([]);
  const [discordGuildChannels, setDiscordGuildChannels] = useState<{id: string; name: string}[]>([]);
  const [discordSelGuildId, setDiscordSelGuildId] = useState('');
  const [discordSelChannelId, setDiscordSelChannelId] = useState('');
  const [discordRequireMention, setDiscordRequireMention] = useState(true);
  const [discordAllowlistBusy, setDiscordAllowlistBusy] = useState(false);
  const [discordWorkspaceBusy, setDiscordWorkspaceBusy] = useState(false);
  const [discordWorkspaceGuilds, setDiscordWorkspaceGuilds] = useState<{id: string; name: string}[]>([]);
  const [discordWorkspaceSelGuild, setDiscordWorkspaceSelGuild] = useState('');
  const [discordShowWorkspaceSetup, setDiscordShowWorkspaceSetup] = useState(false);
  const [discordTtsEnabled, setDiscordTtsEnabled] = useState(false);
  const [ttsChannels, setTtsChannels] = useState<string[]>([]);
  const [ttsVoice, setTtsVoice] = useState<string>('nova');
  const [ttsLatencyTier, setTtsLatencyTier] = useState<0 | 2 | 4>(2);
  const [discordSlashConfig, setDiscordSlashConfig] = useState<{ interactionsUrl: string; publicKeyConfigured: boolean } | null>(null);
  const [discordShowSlashSetup, setDiscordShowSlashSetup] = useState(false);
  const [discordUrlCopied, setDiscordUrlCopied] = useState(false);
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentUploading, setDocumentUploading] = useState(false);
  const documentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [driveStatus, setDriveStatus] = useState<{
    googleConnected: boolean;
    hasDriveScope: boolean;
    enabled: boolean;
    autoSavePlans: boolean;
    autoSaveWeekly: boolean;
    folderLink: string | null;
  } | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveEnabling, setDriveEnabling] = useState(false);

  const [websiteCrawl, setWebsiteCrawl] = useState<{
    status: 'idle' | 'crawling' | 'done' | 'error';
    url?: string;
    pageCount?: number;
    summary?: string | null;
    crawledAt?: string | null;
  }>({ status: 'idle' });
  const [websiteUrlInput, setWebsiteUrlInput] = useState('');
  const [websiteCrawling, setWebsiteCrawling] = useState(false);
  const websitePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWebsiteCrawl = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/website-crawl');
      const data = await res.json();
      setWebsiteCrawl(data);
      if (data.url) setWebsiteUrlInput(data.url);
    } catch {}
  }, []);

  const startWebsitePoll = useCallback(() => {
    if (websitePollRef.current) clearInterval(websitePollRef.current);
    const poll = setInterval(async () => {
      try {
        const res = await apiRequest('GET', '/api/website-crawl');
        const data = await res.json();
        setWebsiteCrawl(data);
        if (data.status !== 'crawling') {
          clearInterval(websitePollRef.current!);
          websitePollRef.current = null;
          setWebsiteCrawling(false);
        }
      } catch {}
    }, 3000);
    websitePollRef.current = poll;
  }, []);

  useEffect(() => {
    return () => {
      if (websitePollRef.current) {
        clearInterval(websitePollRef.current);
        websitePollRef.current = null;
      }
    };
  }, []);

  const handleCrawlWebsite = useCallback(async () => {
    const url = websiteUrlInput.trim();
    if (!url) return;
    setWebsiteCrawling(true);
    setWebsiteCrawl({ status: 'crawling', url });
    try {
      await apiRequest('POST', '/api/website-crawl', { url });
      startWebsitePoll();
    } catch {
      setWebsiteCrawling(false);
      setWebsiteCrawl({ status: 'error', url });
    }
  }, [websiteUrlInput, startWebsitePoll]);

  const handleRemoveWebsiteCrawl = useCallback(async () => {
    Alert.alert('Remove website data', 'This will remove the crawled website knowledge from Jarvis. You can re-crawl any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest('DELETE', '/api/website-crawl');
            setWebsiteCrawl({ status: 'idle' });
            setWebsiteUrlInput('');
          } catch {}
        },
      },
    ]);
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/channels');
      const data = await res.json();
      setChannelData(data);
    } catch (err) {
      console.error('[channels] load failed:', err);
    }
  }, []);

  const loadTelegramStatus = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/telegram/status');
      const data = await res.json();
      setTelegramStatus({
        connected: data.connected ?? false,
        username: data.username ?? null,
        configured: data.configured ?? false,
        webhookHealthy: data.webhookHealthy ?? null,
        webhookLastChecked: data.webhookLastChecked ?? null,
      });
    } catch {
      setTelegramStatus({ connected: false, username: null, configured: false, webhookHealthy: null, webhookLastChecked: null });
    }
  }, []);

  const handleResetWebhook = useCallback(async () => {
    setWebhookResetting(true);
    try {
      const res = await apiRequest('POST', '/api/telegram/reset-webhook');
      const data = await res.json();
      if (data.healthy) {
        setTelegramStatus(prev => ({ ...prev, webhookHealthy: true, webhookLastChecked: new Date().toISOString() }));
      } else {
        alert('Webhook reset failed. Check server logs for details.');
      }
    } catch {
      alert('Could not reach the server to reset the webhook.');
    } finally {
      setWebhookResetting(false);
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

  const loadSoul = useCallback(async () => {
    setSoulLoading(true);
    try {
      const url = new URL('/api/soul', getApiUrl());
      const res = await authFetch(url.toString());
      const data = await res.json();
      if (data && typeof data.content === 'string') {
        setSoul({ content: data.content, manualOverride: data.manualOverride ?? null, generatedAt: data.generatedAt ?? null });
        setOverrideDraft(data.manualOverride ?? '');
      }
    } catch {}
    setSoulLoading(false);
  }, []);

  const handleRegenerateSoul = useCallback(async () => {
    setSoulRegenerating(true);
    try {
      const url = new URL('/api/soul/regenerate', getApiUrl());
      const res = await authFetch(url.toString(), { method: 'POST' });
      const data = await res.json();
      if (data && typeof data.content === 'string') {
        setSoul({ content: data.content, manualOverride: data.manualOverride ?? null, generatedAt: data.generatedAt ?? null });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
    setSoulRegenerating(false);
  }, []);

  const handleSaveSoulContent = useCallback(async (newContent: string) => {
    try {
      const url = new URL('/api/soul/content', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });
      const data = await res.json();
      if (data && typeof data.content === 'string') {
        setSoul({ content: data.content, manualOverride: data.manualOverride ?? null, generatedAt: data.generatedAt ?? null });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
  }, []);

  const handleSaveOverride = useCallback(async () => {
    setSavingOverride(true);
    try {
      const url = new URL('/api/soul/override', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: overrideDraft }),
      });
      const data = await res.json();
      if (data && typeof data.content === 'string') {
        setSoul({ content: data.content, manualOverride: data.manualOverride ?? null, generatedAt: data.generatedAt ?? null });
      }
      setOverrideEditing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
    setSavingOverride(false);
  }, [overrideDraft]);

  const loadPeople = useCallback(async () => {
    setPeopleLoading(true);
    try {
      const url = new URL('/api/people', getApiUrl());
      const res = await authFetch(url.toString());
      const data = await res.json();
      if (data.people && Array.isArray(data.people)) {
        setPeople(data.people);
      }
    } catch {}
    setPeopleLoading(false);
  }, []);

  const handleDeletePerson = useCallback(async (id: string) => {
    setPeople(prev => prev.filter(p => p.id !== id));
    try {
      const url = new URL(`/api/people/${id}`, getApiUrl());
      await authFetch(url.toString(), { method: 'DELETE' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      loadPeople();
    }
  }, [loadPeople]);

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

  const loadMorningNotes = useCallback(async () => {
    setMorningNotesLoading(true);
    try {
      const res = await apiRequest('GET', '/api/morning-voice-notes?limit=30');
      const data = await res.json();
      if (data.notes && Array.isArray(data.notes)) {
        setMorningNotes(data.notes);
      }
    } catch {}
    setMorningNotesLoading(false);
  }, []);

  const loadDreamInsights = useCallback(async () => {
    setDreamInsightsLoading(true);
    try {
      const res = await apiRequest('GET', '/api/dream-insights');
      const data = await res.json();
      if (data.insights && Array.isArray(data.insights)) {
        setDreamInsights(data.insights);
      }
    } catch {}
    setDreamInsightsLoading(false);
  }, []);

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    try {
      const res = await apiRequest('GET', '/api/documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {
      setDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  const startDocumentPoll = useCallback(() => {
    if (documentPollRef.current) clearInterval(documentPollRef.current);
    const poll = setInterval(async () => {
      try {
        const res = await apiRequest('GET', '/api/documents');
        const data = await res.json();
        const docs: UserDocument[] = data.documents || [];
        setDocuments(docs);
        const stillProcessing = docs.some((d) => d.status === 'processing');
        if (!stillProcessing) {
          clearInterval(documentPollRef.current!);
          documentPollRef.current = null;
        }
      } catch {}
    }, 3000);
    documentPollRef.current = poll;
  }, []);

  useEffect(() => {
    return () => {
      if (documentPollRef.current) {
        clearInterval(documentPollRef.current);
        documentPollRef.current = null;
      }
    };
  }, []);

  const loadDriveStatus = useCallback(async () => {
    setDriveLoading(true);
    try {
      const res = await apiRequest('GET', '/api/drive/status');
      const data = await res.json();
      setDriveStatus(data);
    } catch {
      setDriveStatus(null);
    } finally {
      setDriveLoading(false);
    }
  }, []);

  const handleDriveEnable = useCallback(async () => {
    setDriveEnabling(true);
    try {
      const res = await apiRequest('POST', '/api/drive/enable');
      const data = await res.json();

      if (data.needsConsent && data.authUrl) {
        setDriveEnabling(false);
        await WebBrowser.openAuthSessionAsync(data.authUrl, getApiUrl().toString());
        setDriveEnabling(true);
        const res2 = await apiRequest('POST', '/api/drive/enable');
        const data2 = await res2.json();
        if (data2.needsConsent || !res2.ok) {
          Alert.alert('Drive Access Needed', 'Please grant Google Drive access in the browser and try again.');
          return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await loadDriveStatus();
        return;
      }

      if (!res.ok) {
        Alert.alert('Drive Setup Failed', data.error || 'Could not enable Google Drive.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadDriveStatus();
    } catch {
      Alert.alert('Error', 'Could not enable Google Drive. Please try again.');
    } finally {
      setDriveEnabling(false);
    }
  }, [loadDriveStatus]);

  const handleDriveDisable = useCallback(async () => {
    Alert.alert('Disconnect Drive', 'Stop auto-saving to Google Drive? Your existing files will not be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest('DELETE', '/api/drive/disable');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await loadDriveStatus();
          } catch {
            Alert.alert('Error', 'Could not disconnect Drive. Please try again.');
          }
        },
      },
    ]);
  }, [loadDriveStatus]);

  const handleDriveToggle = useCallback(async (key: 'autoSavePlans' | 'autoSaveWeekly', value: boolean) => {
    setDriveStatus(prev => prev ? { ...prev, [key]: value } : prev);
    try {
      await apiRequest('PATCH', '/api/drive/settings', { [key]: value });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      await loadDriveStatus();
    }
  }, [loadDriveStatus]);

  const handleUploadDocument = useCallback(async () => {
    try {
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: SUPPORTED_DOC_TYPES,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.uri) return;

      setDocumentUploading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      let base64: string;
      if (Platform.OS === 'web') {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        const FileSystem = await import('expo-file-system/legacy');
        base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const mimeType = asset.mimeType || 'application/octet-stream';
      const res = await apiRequest('POST', '/api/documents', {
        name: asset.name,
        mimeType,
        data: base64,
      });

      if (!res.ok) {
        const err = await res.json();
        Alert.alert('Upload failed', err.error || 'Could not upload document.');
        return;
      }

      await loadDocuments();
      startDocumentPoll();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Upload failed', 'Could not read or upload the file. Please try again.');
    } finally {
      setDocumentUploading(false);
    }
  }, [loadDocuments, startDocumentPoll]);

  const handleDeleteDocument = useCallback(async (id: string, name: string) => {
    Alert.alert('Remove document', `Remove "${name}" from Jarvis's knowledge base?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest('DELETE', `/api/documents/${id}`);
            setDocuments((prev) => prev.filter((d) => d.id !== id));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {
            Alert.alert('Error', 'Could not delete document.');
          }
        },
      },
    ]);
  }, []);

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
    await Promise.all([loadOAuthStatus(), loadMemories(), loadTelegramStatus(), loadMorningNotes(), loadDocuments(), loadSoul(), loadPeople(), loadChannels(), loadDaemonPerms(), loadAndroidDaemonPerms(), loadDriveStatus(), loadDreamInsights(), loadWebsiteCrawl()]);
    try {
      const importRes = await apiRequest('GET', '/api/chatgpt-import/status');
      const importData = await importRes.json();
      setChatgptImportStatus(importData);
    } catch {}
    try {
      const res = await apiRequest('GET', '/api/preferences');
      const prefs = await res.json();
      if (prefs.timezone) setTimezone(prefs.timezone);
      if (typeof prefs.emailAlertsEnabled === 'boolean') setEmailAlertsEnabled(prefs.emailAlertsEnabled);
      if (typeof prefs.dreamEnabled === 'boolean') setDreamEnabled(prefs.dreamEnabled);
      const channels: string[] = Array.isArray(prefs.ttsChannels)
        ? prefs.ttsChannels
        : prefs.ttsEnabled === true ? ['telegram'] : [];
      setTtsChannels(channels);
      setDiscordTtsEnabled(channels.includes('discord'));
      if (prefs.ttsVoice) setTtsVoice(prefs.ttsVoice);
      if (typeof prefs.ttsLatencyTier === 'number' && [0, 2, 4].includes(prefs.ttsLatencyTier)) {
        setTtsLatencyTier(prefs.ttsLatencyTier as 0 | 2 | 4);
      }
    } catch {}
  // loadDaemonPerms and loadAndroidDaemonPerms are useCallback([], []) — they are
  // referentially stable and safe to omit from deps; including them causes a
  // temporal-dead-zone ReferenceError because they are declared after loadAll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOAuthStatus, loadMemories, loadTelegramStatus, loadMorningNotes, loadDocuments, loadSoul, loadPeople, loadChannels, loadDriveStatus, loadDreamInsights, loadWebsiteCrawl]);

  const handleToggleEmailAlerts = useCallback(async () => {
    const newValue = !emailAlertsEnabled;
    setEmailAlertsEnabled(newValue);
    try {
      await apiRequest('PATCH', '/api/preferences', { emailAlertsEnabled: newValue });
    } catch {}
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [emailAlertsEnabled]);

  const handleToggleDreamEnabled = useCallback(async () => {
    const newValue = !dreamEnabled;
    setDreamEnabled(newValue);
    try {
      await apiRequest('PATCH', '/api/preferences', { dreamEnabled: newValue });
    } catch {}
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [dreamEnabled]);

  const handleToggleDiscordTts = useCallback(async () => {
    const next = !discordTtsEnabled;
    setDiscordTtsEnabled(next);
    const newChannels = next
      ? [...ttsChannels.filter(c => c !== 'discord'), 'discord']
      : ttsChannels.filter(c => c !== 'discord');
    setTtsChannels(newChannels);
    try {
      await apiRequest('PATCH', '/api/preferences', { ttsChannels: newChannels });
    } catch {}
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [discordTtsEnabled, ttsChannels]);

  const handleSelectVoice = useCallback(async (voiceId: string) => {
    setTtsVoice(voiceId);
    try {
      await apiRequest('PATCH', '/api/preferences', { ttsVoice: voiceId });
    } catch {}
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleSelectLatencyTier = useCallback(async (tier: 0 | 2 | 4) => {
    setTtsLatencyTier(tier);
    try {
      await apiRequest('PATCH', '/api/preferences', { ttsLatencyTier: tier });
    } catch {}
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleToggleSlashSetup = useCallback(async () => {
    setDiscordShowSlashSetup(v => !v);
    if (!discordSlashConfig) {
      try {
        const res = await apiRequest('GET', '/api/channels/discord/interactions-config');
        const data = await res.json();
        setDiscordSlashConfig(data);
      } catch {}
    }
  }, [discordSlashConfig]);

  const handleRefreshSlashConfig = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/channels/discord/interactions-config');
      const data = await res.json();
      setDiscordSlashConfig(data);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
  }, []);

  const handleCopyInteractionsUrl = useCallback(async () => {
    if (!discordSlashConfig?.interactionsUrl) return;
    await Clipboard.setStringAsync(discordSlashConfig.interactionsUrl);
    setDiscordUrlCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setDiscordUrlCopied(false), 2000);
  }, [discordSlashConfig]);

  const handleTimezoneChange = useCallback(async (tz: string) => {
    setTimezone(tz);
    setShowTimezoneModal(false);
    try {
      await apiRequest('PATCH', '/api/preferences', { timezone: tz });
    } catch {}
  }, []);

  const handleChatGPTImport = useCallback(async () => {
    try {
      const DocumentPicker = await import('expo-document-picker');
      const FileSystem = await import('expo-file-system/legacy');
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const file = result.assets[0];
      setChatgptImporting(true);
      setChatgptImportResult(null);

      const fileContent = await FileSystem.readAsStringAsync(file.uri);
      let parsed: any;
      try {
        parsed = JSON.parse(fileContent);
      } catch {
        alert('Invalid JSON file. Please select a valid ChatGPT export file.');
        setChatgptImporting(false);
        return;
      }

      let convos: any[];
      if (Array.isArray(parsed)) {
        convos = parsed;
      } else if (parsed && Array.isArray(parsed.conversations)) {
        convos = parsed.conversations;
      } else {
        alert('This doesn\'t appear to be a ChatGPT conversations export. The file should contain an array of conversations.');
        setChatgptImporting(false);
        return;
      }

      const hasMapping = convos.some((c: any) => c.mapping && typeof c.mapping === 'object');
      if (!hasMapping) {
        alert('This doesn\'t appear to be a ChatGPT conversations export. Expected conversations with message mappings.');
        setChatgptImporting(false);
        return;
      }

      const conversations = convos.slice(-150).map((convo: any) => {
        const messages: { role: string; text: string }[] = [];
        const mapping = convo.mapping;
        if (mapping && typeof mapping === 'object') {
          const nodes = Object.values(mapping) as any[];
          for (const node of nodes) {
            const msg = (node as any)?.message;
            if (!msg || !msg.content?.parts) continue;
            const role = msg.author?.role;
            if (role !== 'user' && role !== 'assistant') continue;
            const text = msg.content.parts
              .filter((p: any) => typeof p === 'string')
              .join(' ')
              .trim();
            if (text.length > 0) {
              messages.push({ role, text: text.slice(0, 500) });
            }
          }
        }
        return { title: convo.title, messages };
      }).filter((c: any) => c.messages.length > 0);

      if (conversations.length === 0) {
        alert('No readable conversations found in this file.');
        setChatgptImporting(false);
        return;
      }

      const res = await apiRequest('POST', '/api/chatgpt-import', { conversations });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Import failed. Please try again.');
        setChatgptImporting(false);
        return;
      }

      setChatgptImportResult(data.imported);
      setChatgptImportStatus({
        imported: true,
        importedAt: data.importedAt || new Date().toISOString(),
        memoriesAdded: data.imported,
      });
      setChatgptImporting(false);
      loadMemories();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      console.error('ChatGPT import error:', e);
      alert('Failed to import. Please try again.');
      setChatgptImporting(false);
    }
  }, [loadMemories]);

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

  const handleGenerateWhatsAppCode = useCallback(async () => {
    setChannelBusy('whatsapp');
    try {
      const res = await apiRequest('POST', '/api/channels/whatsapp/code');
      const data = await res.json();
      setWhatsappCode({ code: data.code, twilioNumber: data.twilioNumber });
    } catch (err) {
      console.error('[whatsapp] code error:', err);
    } finally {
      setChannelBusy(null);
    }
  }, []);

  const handleGenerateDaemonCode = useCallback(async () => {
    setChannelBusy('desktop-daemon');
    try {
      const res = await apiRequest('POST', '/api/channels/daemon/code');
      const data = await res.json();
      setDaemonCode(data.code);
    } catch (err) {
      console.error('[daemon] code error:', err);
    } finally {
      setChannelBusy(null);
    }
  }, []);

  const loadDaemonPerms = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/channels/daemon/permissions');
      const data = await res.json();
      setDaemonPerms(data.permissions || null);
    } catch (err) {
      console.error('[daemon] permissions load error:', err);
    }
  }, []);

  const handleToggleDaemonPerm = useCallback(async (action: string) => {
    if (!daemonPerms) return;
    setDaemonPermsBusy(action);
    const next = { ...daemonPerms, [action]: !daemonPerms[action] };
    setDaemonPerms(next);
    try {
      await apiRequest('PUT', '/api/channels/daemon/permissions', { permissions: next });
    } catch (err) {
      console.error('[daemon] permissions update error:', err);
      setDaemonPerms(daemonPerms);
    } finally {
      setDaemonPermsBusy(null);
    }
  }, [daemonPerms]);

  const handleGenerateAndroidDaemonCode = useCallback(async () => {
    setChannelBusy('android-daemon');
    try {
      const res = await apiRequest('POST', '/api/channels/daemon/code');
      const data = await res.json();
      setAndroidDaemonCode(data.code);
    } catch (err) {
      console.error('[android-daemon] code error:', err);
    } finally {
      setChannelBusy(null);
    }
  }, []);

  const loadAndroidDaemonPerms = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/channels/android-daemon/permissions');
      const data = await res.json();
      setAndroidDaemonPerms(data.permissions || null);
    } catch (err) {
      console.error('[android-daemon] permissions load error:', err);
    }
  }, []);

  const handleToggleAndroidDaemonPerm = useCallback(async (action: string) => {
    if (!androidDaemonPerms) return;
    setAndroidDaemonPermsBusy(action);
    const next = { ...androidDaemonPerms, [action]: !androidDaemonPerms[action] };
    setAndroidDaemonPerms(next);
    try {
      await apiRequest('PUT', '/api/channels/android-daemon/permissions', { permissions: next });
    } catch (err) {
      console.error('[android-daemon] permissions update error:', err);
      setAndroidDaemonPerms(androidDaemonPerms);
    } finally {
      setAndroidDaemonPermsBusy(null);
    }
  }, [androidDaemonPerms]);

  const handleUnlinkChannel = useCallback(async (channel: string) => {
    setChannelBusy(channel);
    try {
      await apiRequest('DELETE', `/api/channels/${channel}`);
      if (channel === 'whatsapp') setWhatsappCode(null);
      if (channel === 'daemon') { setDaemonCode(null); setAndroidDaemonCode(null); }
      if (channel === 'desktop-daemon') { setDaemonCode(null); }
      if (channel === 'android-daemon') { setAndroidDaemonCode(null); }
      if (channel === 'discord') { setDiscordBotToken(''); setDiscordPairCode(''); }
      await loadChannels();
    } catch (err) {
      console.error('[channels] unlink error:', err);
    } finally {
      setChannelBusy(null);
    }
  }, [loadChannels]);

  const handleSaveDiscordToken = useCallback(async () => {
    if (!discordBotToken.trim()) return;
    setDiscordSaving(true);
    try {
      const res = await apiRequest('POST', '/api/channels/discord/token', { botToken: discordBotToken.trim() });
      const data = await res.json();
      if (data.error) { alert(data.error); }
      else { setDiscordBotToken(''); await loadChannels(); }
    } catch (err: any) {
      alert(err?.message || 'Failed to save bot token — check the token and ensure Message Content + Server Members intents are enabled.');
    }
    setDiscordSaving(false);
  }, [discordBotToken, loadChannels]);

  const handleDiscordPair = useCallback(async () => {
    if (!discordPairCode.trim()) return;
    setDiscordPairing(true);
    try {
      const res = await apiRequest('POST', '/api/channels/discord/pair', { code: discordPairCode.trim().toUpperCase() });
      const data = await res.json();
      if (data.error) { alert(data.error); }
      else { setDiscordPairCode(''); await loadChannels(); }
    } catch (err: any) {
      alert(err?.message || 'Pairing failed — check the code and try again.');
    }
    setDiscordPairing(false);
  }, [discordPairCode, loadChannels]);

  const handleFetchDiscordGuilds = useCallback(async () => {
    setDiscordAllowlistBusy(true);
    try {
      const res = await apiRequest('GET', '/api/channels/discord/guilds');
      const data = await res.json();
      setDiscordGuilds(data.guilds || []);
      setDiscordSelGuildId('');
      setDiscordGuildChannels([]);
      setDiscordSelChannelId('');
    } catch (err) {
      console.error('[discord] fetch guilds failed:', err);
    }
    setDiscordAllowlistBusy(false);
  }, []);

  const handleFetchDiscordChannels = useCallback(async (guildId: string) => {
    setDiscordSelGuildId(guildId);
    setDiscordSelChannelId('');
    if (!guildId) { setDiscordGuildChannels([]); return; }
    try {
      const res = await apiRequest('GET', `/api/channels/discord/channels/${guildId}`);
      const data = await res.json();
      setDiscordGuildChannels(data.channels || []);
    } catch (err) {
      console.error('[discord] fetch channels failed:', err);
    }
  }, []);

  const handleAddDiscordAllowlist = useCallback(async () => {
    if (!discordSelGuildId || !discordSelChannelId) return;
    setDiscordAllowlistBusy(true);
    try {
      const guild = discordGuilds.find(g => g.id === discordSelGuildId);
      const chan = discordGuildChannels.find(c => c.id === discordSelChannelId);
      await apiRequest('PUT', '/api/channels/discord/allowlist', {
        guildId: discordSelGuildId,
        guildName: guild?.name || discordSelGuildId,
        channelId: discordSelChannelId,
        channelName: chan?.name || discordSelChannelId,
        requireMention: discordRequireMention,
      });
      setDiscordSelGuildId(''); setDiscordSelChannelId(''); setDiscordGuildChannels([]);
      await loadChannels();
    } catch (err: any) {
      alert(err?.message || 'Failed to add channel.');
    }
    setDiscordAllowlistBusy(false);
  }, [discordSelGuildId, discordSelChannelId, discordGuilds, discordGuildChannels, discordRequireMention, loadChannels]);

  const handleRemoveDiscordAllowlist = useCallback(async (guildId: string, channelId: string) => {
    setDiscordAllowlistBusy(true);
    try {
      await apiRequest('DELETE', `/api/channels/discord/allowlist/${guildId}/${channelId}`);
      await loadChannels();
    } catch (err: any) {
      alert(err?.message || 'Failed to remove channel.');
    }
    setDiscordAllowlistBusy(false);
  }, [loadChannels]);

  const handleOpenWorkspaceSetup = useCallback(async () => {
    setDiscordShowWorkspaceSetup(v => !v);
    if (!discordShowWorkspaceSetup && discordWorkspaceGuilds.length === 0) {
      setDiscordWorkspaceBusy(true);
      try {
        const res = await apiRequest('GET', '/api/channels/discord/guilds');
        const data = await res.json();
        setDiscordWorkspaceGuilds(data.guilds || []);
      } catch (err: any) {
        console.error('[discord workspace] fetch guilds failed:', err);
      }
      setDiscordWorkspaceBusy(false);
    }
  }, [discordShowWorkspaceSetup, discordWorkspaceGuilds.length]);

  const handleSetupWorkspace = useCallback(async (guildId: string) => {
    setDiscordWorkspaceBusy(true);
    try {
      const res = await apiRequest('POST', '/api/channels/discord/workspace/setup', { guildId });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Setup failed.'); return; }
      setDiscordShowWorkspaceSetup(false);
      setDiscordWorkspaceSelGuild('');
      await loadChannels();
      alert('✅ Jarvis Workspace created! Check your Discord server for the new channels.');
    } catch (err: any) {
      alert(err?.message || 'Setup failed.');
    }
    setDiscordWorkspaceBusy(false);
  }, [loadChannels]);

  const handleTogglePreference = useCallback(async (notificationType: string, channel: string) => {
    if (!channelData) return;
    const current = channelData.preferences[notificationType] || ['telegram', 'in_app'];
    const next = current.includes(channel)
      ? current.filter(c => c !== channel)
      : [...current, channel];
    setChannelData({
      ...channelData,
      preferences: { ...channelData.preferences, [notificationType]: next },
    });
    try {
      await apiRequest('PUT', '/api/channels/preferences', {
        notificationType,
        channels: next,
      });
    } catch (err) {
      console.error('[channels] preference toggle failed:', err);
      await loadChannels();
    }
  }, [channelData, loadChannels]);

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

  useEffect(() => {
    if (focus !== 'telegram_webhook') return;
    const timer = setTimeout(() => {
      const scrollNode = findNodeHandle(scrollViewRef.current);
      if (scrollNode && webhookRowRef.current) {
        webhookRowRef.current.measureLayout(
          scrollNode,
          (_x, y) => {
            scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
          },
          () => {}
        );
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [focus]);

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
        ref={scrollViewRef}
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

        {/* JARVIS Soul */}
        <Animated.View entering={FadeInDown.duration(400).delay(410)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 }}>
            <Text style={styles.sectionTitle}>JARVIS Soul</Text>
            <Pressable
              onPress={handleRegenerateSoul}
              disabled={soulRegenerating}
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: soulRegenerating ? 0.5 : 1 }}
            >
              {soulRegenerating ? (
                <ActivityIndicator size="small" color={Colors.textTertiary} />
              ) : (
                <Ionicons name="refresh" size={16} color={Colors.textSecondary} />
              )}
              <Text style={{ color: Colors.textSecondary, fontSize: 13, fontWeight: '500' }}>Regenerate</Text>
            </Pressable>
          </View>
          <Text style={styles.sectionSubtitle}>
            How your coach sees you — distilled from memories, patterns, and people
          </Text>
          {soulLoading ? (
            <View style={styles.memoryEmptyCard}>
              <ActivityIndicator size="small" color={Colors.textTertiary} />
            </View>
          ) : !soul || !soul.content ? (
            <View style={styles.memoryEmptyCard}>
              <View style={styles.memoryEmptyIcon}>
                <Ionicons name="sparkles-outline" size={22} color={Colors.textTertiary} />
              </View>
              <Text style={styles.memoryEmptyText}>
                No soul yet — chat with the coach to start building one
              </Text>
            </View>
          ) : (
            <View style={[styles.memoryEmptyCard, { alignItems: 'stretch' }]}>
              <Text
                style={{ color: Colors.text, fontSize: 14, lineHeight: 21 }}
                numberOfLines={soulExpanded ? undefined : 8}
              >
                {soul.content}
              </Text>
              <Pressable onPress={() => setSoulExpanded(v => !v)} hitSlop={8} style={{ marginTop: 10 }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 13, fontWeight: '500' }}>
                  {soulExpanded ? 'Show less' : 'Show more'}
                </Text>
              </Pressable>
              {soul.generatedAt && (
                <Text style={{ color: Colors.textTertiary, fontSize: 11, marginTop: 8 }}>
                  Updated {new Date(soul.generatedAt).toLocaleString()}
                </Text>
              )}
            </View>
          )}

          {/* Edit canonical SOUL document directly (JARVIS_SOUL.md). */}
          {soul && soul.content && !contentEditing && (
            <View style={{ marginTop: 12 }}>
              <Pressable
                onPress={() => { setContentDraft(soul.content); setContentEditing(true); }}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Ionicons name="document-text-outline" size={15} color={Colors.textSecondary} />
                <Text style={{ color: Colors.textSecondary, fontSize: 13, fontWeight: '500' }}>
                  Edit JARVIS_SOUL.md directly
                </Text>
              </Pressable>
            </View>
          )}
          {contentEditing && (
            <View style={{ marginTop: 12 }}>
              <TextInput
                value={contentDraft}
                onChangeText={setContentDraft}
                multiline
                placeholder="Edit the canonical SOUL document..."
                placeholderTextColor={Colors.textTertiary}
                style={{
                  backgroundColor: Colors.surface,
                  borderRadius: 12,
                  padding: 12,
                  color: Colors.text,
                  fontSize: 14,
                  minHeight: 200,
                  textAlignVertical: 'top',
                  borderWidth: 1,
                  borderColor: Colors.border,
                }}
              />
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
                <Pressable
                  onPress={async () => { setSavingContent(true); await handleSaveSoulContent(contentDraft); setSavingContent(false); setContentEditing(false); }}
                  disabled={savingContent}
                  style={{ flex: 1, backgroundColor: Colors.text, padding: 12, borderRadius: 10, alignItems: 'center', opacity: savingContent ? 0.6 : 1 }}
                >
                  <Text style={{ color: Colors.background, fontWeight: '600', fontSize: 14 }}>
                    {savingContent ? 'Saving…' : 'Save document'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => { setContentEditing(false); setContentDraft(''); }}
                  style={{ flex: 1, backgroundColor: Colors.surface, padding: 12, borderRadius: 10, alignItems: 'center' }}
                >
                  <Text style={{ color: Colors.text, fontWeight: '500', fontSize: 14 }}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={{ marginTop: 12 }}>
            {!overrideEditing ? (
              <Pressable
                onPress={() => setOverrideEditing(true)}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Ionicons name="create-outline" size={15} color={Colors.textSecondary} />
                <Text style={{ color: Colors.textSecondary, fontSize: 13, fontWeight: '500' }}>
                  {soul?.manualOverride ? 'Edit your override' : 'Add personal override'}
                </Text>
              </Pressable>
            ) : (
              <View>
                <TextInput
                  value={overrideDraft}
                  onChangeText={setOverrideDraft}
                  multiline
                  placeholder="Add anything you want JARVIS to always remember about you..."
                  placeholderTextColor={Colors.textTertiary}
                  style={{
                    backgroundColor: Colors.surface,
                    borderRadius: 12,
                    padding: 12,
                    color: Colors.text,
                    fontSize: 14,
                    minHeight: 100,
                    textAlignVertical: 'top',
                    borderWidth: 1,
                    borderColor: Colors.border,
                  }}
                />
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
                  <Pressable
                    onPress={handleSaveOverride}
                    disabled={savingOverride}
                    style={{ flex: 1, backgroundColor: Colors.text, padding: 12, borderRadius: 10, alignItems: 'center', opacity: savingOverride ? 0.6 : 1 }}
                  >
                    <Text style={{ color: Colors.background, fontWeight: '600', fontSize: 14 }}>
                      {savingOverride ? 'Saving…' : 'Save'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { setOverrideEditing(false); setOverrideDraft(soul?.manualOverride ?? ''); }}
                    style={{ flex: 1, backgroundColor: Colors.surface, padding: 12, borderRadius: 10, alignItems: 'center' }}
                  >
                    <Text style={{ color: Colors.text, fontWeight: '500', fontSize: 14 }}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </Animated.View>

        {/* People */}
        <Animated.View entering={FadeInDown.duration(400).delay(415)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>People</Text>
          <Text style={styles.sectionSubtitle}>
            Folks JARVIS has learned about from your conversations
          </Text>
          {peopleLoading ? (
            <View style={styles.memoryEmptyCard}>
              <ActivityIndicator size="small" color={Colors.textTertiary} />
            </View>
          ) : people.length === 0 ? (
            <View style={styles.memoryEmptyCard}>
              <View style={styles.memoryEmptyIcon}>
                <Ionicons name="people-outline" size={22} color={Colors.textTertiary} />
              </View>
              <Text style={styles.memoryEmptyText}>
                No people yet — mention someone by name in chat
              </Text>
            </View>
          ) : (
            <View style={styles.memoryList}>
              {people.map((p, idx) => (
                <View key={p.id} style={[styles.memoryRow, idx < people.length - 1 && styles.memoryRowBorder]}>
                  <View style={styles.memoryContent}>
                    <Text style={[styles.memoryText, { fontWeight: '600' }]}>{p.name}</Text>
                    {p.relationship ? (
                      <Text style={{ color: Colors.textSecondary, fontSize: 13, marginTop: 2 }}>{p.relationship}</Text>
                    ) : null}
                    {(p.interactionCount > 0 || p.lastInteractionAt) ? (
                      <Text style={{ color: Colors.textTertiary, fontSize: 12, marginTop: 4 }}>
                        {p.interactionCount > 0 ? `${p.interactionCount} interaction${p.interactionCount === 1 ? '' : 's'}` : ''}
                        {p.lastInteractionAt ? ` · last ${new Date(p.lastInteractionAt).toLocaleDateString()}` : ''}
                      </Text>
                    ) : null}
                    {(p.upcomingCount > 0 || p.nextInteractionAt) ? (
                      <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                        Upcoming: {p.upcomingCount} event{p.upcomingCount === 1 ? '' : 's'}
                        {p.nextInteractionAt ? ` · next ${new Date(p.nextInteractionAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
                      </Text>
                    ) : null}
                    {p.notes ? (
                      <Text style={{ color: Colors.textTertiary, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                        {p.notes}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable style={styles.memoryDeleteBtn} onPress={() => handleDeletePerson(p.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              ))}
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

        {/* Morning Notes */}
        <Animated.View entering={FadeInDown.duration(400).delay(440)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Morning Notes</Text>
          <Text style={styles.sectionSubtitle}>
            Your daily voice check-ins and patterns
          </Text>
          {morningNotesLoading ? (
            <View style={styles.memoryEmptyCard}>
              <ActivityIndicator size="small" color={Colors.textTertiary} />
            </View>
          ) : morningNotes.length === 0 ? (
            <View style={styles.memoryEmptyCard}>
              <View style={styles.memoryEmptyIcon}>
                <Ionicons name="mic-outline" size={22} color={Colors.textTertiary} />
              </View>
              <Text style={styles.memoryEmptyText}>
                No morning notes yet — record one during your morning check-in
              </Text>
            </View>
          ) : (
            <View style={styles.memoryList}>
              {morningNotes.map((note, idx) => {
                const isExpanded = expandedNoteId === note.id;
                return (
                  <Pressable
                    key={note.id}
                    onPress={() => setExpandedNoteId(isExpanded ? null : note.id)}
                    style={[styles.morningNoteRow, idx < morningNotes.length - 1 && styles.memoryRowBorder]}
                  >
                    <View style={styles.morningNoteHeader}>
                      <View style={[styles.moodDot, { backgroundColor: MOOD_COLORS[note.moodSignal] || Colors.textTertiary }]} />
                      <Text style={styles.morningNoteDate}>{formatNoteDate(note.recordedAt)}</Text>
                      <View style={styles.morningNoteThemes}>
                        {(note.themes as string[]).slice(0, 2).map((theme, ti) => (
                          <View key={ti} style={styles.morningNotePill}>
                            <Text style={styles.morningNotePillText}>{theme}</Text>
                          </View>
                        ))}
                        {(note.themes as string[]).length > 2 && (
                          <Text style={styles.morningNoteMore}>+{(note.themes as string[]).length - 2}</Text>
                        )}
                      </View>
                      <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textTertiary} />
                    </View>
                    {isExpanded && (
                      <View style={styles.morningNoteBody}>
                        <Text style={styles.morningNoteTranscript}>{note.transcript}</Text>
                        {note.intention && (
                          <View style={styles.morningNoteIntentionRow}>
                            <Ionicons name="flag-outline" size={13} color={Colors.primary} />
                            <Text style={styles.morningNoteIntention}>{note.intention}</Text>
                          </View>
                        )}
                        {(note.wins as string[]).length > 0 && (
                          <View style={styles.morningNoteSubRow}>
                            <Text style={styles.morningNoteSubLabel}>Wins:</Text>
                            <Text style={styles.morningNoteSubText}>{(note.wins as string[]).join(', ')}</Text>
                          </View>
                        )}
                        {(note.blockers as string[]).length > 0 && (
                          <View style={styles.morningNoteSubRow}>
                            <Text style={styles.morningNoteSubLabel}>Blockers:</Text>
                            <Text style={styles.morningNoteSubText}>{(note.blockers as string[]).join(', ')}</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </Animated.View>

        {/* Dreams */}
        <Animated.View entering={FadeInDown.duration(400).delay(445)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, marginBottom: 2 }}>
            <Text style={styles.sectionTitle}>Dream Cycle</Text>
            <Pressable onPress={handleToggleDreamEnabled} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons
                name={dreamEnabled ? 'moon' : 'moon-outline'}
                size={15}
                color={dreamEnabled ? '#818CF8' : Colors.border}
              />
              <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: dreamEnabled ? '#818CF8' : Colors.textTertiary }}>
                {dreamEnabled ? 'On' : 'Off'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.sectionSubtitle}>
            Nightly synthesis — non-obvious insights from your history
          </Text>
          {dreamInsightsLoading ? (
            <View style={styles.memoryEmptyCard}>
              <ActivityIndicator size="small" color={Colors.textTertiary} />
            </View>
          ) : dreamInsights.length === 0 ? (
            <View style={styles.memoryEmptyCard}>
              <View style={styles.memoryEmptyIcon}>
                <Ionicons name="moon-outline" size={22} color={Colors.textTertiary} />
              </View>
              <Text style={styles.memoryEmptyText}>
                No dream insights yet — Jarvis synthesises while you sleep, starting when you have 2+ weeks of memory
              </Text>
            </View>
          ) : (
            <View style={styles.memoryList}>
              {(() => {
                const grouped = new Map<string, typeof dreamInsights>();
                for (const ins of dreamInsights) {
                  const arr = grouped.get(ins.dreamDate) || [];
                  arr.push(ins);
                  grouped.set(ins.dreamDate, arr);
                }
                return Array.from(grouped.entries()).slice(0, 10).map(([date, insights]) => {
                  const isExpanded = expandedDreamId === date;
                  return (
                    <Pressable
                      key={date}
                      onPress={() => setExpandedDreamId(isExpanded ? null : date)}
                      style={[styles.morningNoteRow, { borderBottomColor: Colors.border, borderBottomWidth: 1 }]}
                    >
                      <View style={styles.morningNoteHeader}>
                        <Ionicons name="moon" size={13} color="#818CF8" />
                        <Text style={[styles.morningNoteDate, { flex: 1 }]}>
                          {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>
                          {insights.length} insight{insights.length !== 1 ? 's' : ''}
                        </Text>
                        <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textTertiary} style={{ marginLeft: 6 }} />
                      </View>
                      {isExpanded && (
                        <View style={{ paddingTop: 8, gap: 10 }}>
                          {insights.map((ins, i) => {
                            const isInsightExpanded = expandedInsightMemoryId === ins.id;
                            const cachedMems = insightMemoriesCache[ins.id];
                            return (
                              <View key={ins.id}>
                                <Pressable
                                  style={{ flexDirection: 'row', gap: 8 }}
                                  onPress={async () => {
                                    if (isInsightExpanded) {
                                      setExpandedInsightMemoryId(null);
                                      return;
                                    }
                                    setExpandedInsightMemoryId(ins.id);
                                    if (!insightMemoriesCache[ins.id] && ins.sourceMemoryIds && ins.sourceMemoryIds.length > 0) {
                                      try {
                                        const { apiRequest } = await import('@/lib/query-client');
                                        const resp = await apiRequest('GET', `/api/dream-insights/${ins.id}/memories`);
                                        const data = await resp.json();
                                        if (data.memories) {
                                          setInsightMemoriesCache(prev => ({ ...prev, [ins.id]: data.memories }));
                                        }
                                      } catch {}
                                    }
                                  }}
                                >
                                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#818CF820', alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 }}>
                                    <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#818CF8' }}>{i + 1}</Text>
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.text, lineHeight: 19 }}>
                                      {ins.insightText}
                                    </Text>
                                    <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary, marginTop: 3 }}>
                                      Confidence: {ins.confidenceScore}%{ins.shownToUser ? ' · Delivered' : ' · Pending'}{ins.sourceMemoryIds && ins.sourceMemoryIds.length > 0 ? ` · Tap for sources` : ''}
                                    </Text>
                                  </View>
                                  {ins.sourceMemoryIds && ins.sourceMemoryIds.length > 0 && (
                                    <Ionicons name={isInsightExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textTertiary} style={{ marginTop: 3 }} />
                                  )}
                                </Pressable>
                                {isInsightExpanded && (
                                  <View style={{ marginLeft: 28, marginTop: 6, gap: 4, paddingBottom: 4 }}>
                                    <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: Colors.textTertiary, marginBottom: 2 }}>
                                      Source memories synthesised:
                                    </Text>
                                    {cachedMems === undefined ? (
                                      <ActivityIndicator size="small" color={Colors.textTertiary} />
                                    ) : cachedMems.length === 0 ? (
                                      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>
                                        No linked memories found
                                      </Text>
                                    ) : (
                                      cachedMems.map((mem) => (
                                        <View key={mem.id} style={{ flexDirection: 'row', gap: 4, alignItems: 'flex-start' }}>
                                          <Text style={{ fontSize: 10, fontFamily: 'Inter_500Medium', color: '#818CF880', marginTop: 2 }}>•</Text>
                                          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, flex: 1, lineHeight: 16 }}>
                                            [{mem.category}] {mem.content}
                                          </Text>
                                        </View>
                                      ))
                                    )}
                                  </View>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </Pressable>
                  );
                });
              })()}
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

          {/* Google Drive */}
          {driveStatus?.googleConnected && (
            <View style={[styles.platformsList, { marginTop: 12 }]}>
              <View style={[styles.platformRow, driveStatus.enabled ? styles.platformRowBorder : undefined]}>
                <View style={[styles.platformIcon, { backgroundColor: '#34A85318' }]}>
                  <Ionicons name="logo-google" size={20} color="#34A853" />
                </View>
                <View style={styles.platformInfo}>
                  <Text style={styles.platformName}>Google Drive</Text>
                  <Text style={styles.platformSubtitle}>
                    {driveStatus.enabled ? 'Auto-saving to Jarvis Workspace' : 'Save plans & reviews to Drive'}
                  </Text>
                  {driveStatus.enabled && driveStatus.folderLink && (
                    <Pressable onPress={() => WebBrowser.openBrowserAsync(driveStatus.folderLink!)}>
                      <Text style={[styles.upgradePermText, { color: '#34A853' }]}>Open Jarvis Workspace ↗</Text>
                    </Pressable>
                  )}
                </View>
                {driveLoading || driveEnabling ? (
                  <ActivityIndicator size="small" color="#34A853" />
                ) : driveStatus.enabled ? (
                  <Pressable style={styles.disconnectBtn} onPress={handleDriveDisable}>
                    <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                    <Text style={styles.disconnectBtnText}>Disconnect</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[styles.connectBtn, { borderColor: '#34A853' }]}
                    onPress={handleDriveEnable}
                  >
                    <Text style={[styles.connectBtnText, { color: '#34A853' }]}>Enable</Text>
                  </Pressable>
                )}
              </View>

              {driveStatus.enabled && (
                <>
                  <View style={[styles.platformRow, styles.platformRowBorder]}>
                    <View style={styles.platformInfo}>
                      <Text style={styles.platformName}>Auto-save Daily Plans</Text>
                      <Text style={styles.platformSubtitle}>Save each morning plan as a Google Doc</Text>
                    </View>
                    <Switch
                      value={driveStatus.autoSavePlans}
                      onValueChange={(v) => handleDriveToggle('autoSavePlans', v)}
                      trackColor={{ false: Colors.border, true: '#34A853' }}
                      thumbColor={Colors.white || '#fff'}
                    />
                  </View>
                  <View style={styles.platformRow}>
                    <View style={styles.platformInfo}>
                      <Text style={styles.platformName}>Auto-save Weekly Reviews</Text>
                      <Text style={styles.platformSubtitle}>Save each weekly pattern review as a Google Doc</Text>
                    </View>
                    <Switch
                      value={driveStatus.autoSaveWeekly}
                      onValueChange={(v) => handleDriveToggle('autoSaveWeekly', v)}
                      trackColor={{ false: Colors.border, true: '#34A853' }}
                      thumbColor={Colors.white || '#fff'}
                    />
                  </View>
                </>
              )}
            </View>
          )}

          <View ref={webhookRowRef} style={[styles.platformsList, { marginTop: 12 }]}>
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
            {telegramStatus.configured && telegramStatus.webhookHealthy !== null && (
              <View style={styles.webhookStatusRow}>
                <Ionicons
                  name={telegramStatus.webhookHealthy ? 'checkmark-circle' : 'warning'}
                  size={13}
                  color={telegramStatus.webhookHealthy ? Colors.success : '#F59E0B'}
                />
                <Text style={[styles.webhookStatusText, !telegramStatus.webhookHealthy && { color: '#F59E0B' }]}>
                  {telegramStatus.webhookHealthy
                    ? `Bot connected${telegramStatus.webhookLastChecked ? ` · verified ${new Date(telegramStatus.webhookLastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
                    : 'Bot webhook may be offline'}
                </Text>
                {!telegramStatus.webhookHealthy && (
                  webhookResetting ? (
                    <ActivityIndicator size="small" color="#229ED9" style={{ marginLeft: 8 }} />
                  ) : (
                    <Pressable onPress={handleResetWebhook} style={styles.webhookFixBtn}>
                      <Text style={styles.webhookFixBtnText}>Fix now</Text>
                    </Pressable>
                  )
                )}
              </View>
            )}
          </View>

          <View style={[styles.platformsList, { marginTop: 12 }]}>
            <View style={styles.platformRow}>
              <View style={[styles.platformIcon, { backgroundColor: '#10A37F18' }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color="#10A37F" />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>ChatGPT History</Text>
                {chatgptImporting ? (
                  <Text style={styles.platformSubtitle}>Jarvis is reading your history...</Text>
                ) : chatgptImportResult !== null ? (
                  <Text style={[styles.platformSubtitle, { color: Colors.success }]}>
                    {chatgptImportResult} insights learned from your ChatGPT history
                  </Text>
                ) : chatgptImportStatus.imported ? (
                  <Text style={styles.platformSubtitle}>
                    Last imported: {new Date(chatgptImportStatus.importedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {chatgptImportStatus.memoriesAdded} insights
                  </Text>
                ) : (
                  <Text style={styles.platformSubtitle}>Import your conversations</Text>
                )}
              </View>
              {chatgptImporting ? (
                <ActivityIndicator size="small" color="#10A37F" />
              ) : chatgptImportStatus.imported ? (
                <Pressable
                  style={[styles.connectBtn, { borderColor: '#10A37F' }]}
                  onPress={handleChatGPTImport}
                >
                  <Text style={[styles.connectBtnText, { color: '#10A37F' }]}>Re-import</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.connectBtn, { borderColor: '#10A37F' }]}
                  onPress={handleChatGPTImport}
                >
                  <Text style={[styles.connectBtnText, { color: '#10A37F' }]}>Import</Text>
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

        {/* Connected Channels (Phase 5: multi-channel + desktop daemon) */}
        <Animated.View entering={FadeInDown.duration(400).delay(450)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Connected Channels</Text>
          <View style={styles.platformsList}>
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 }}>
                Choose where Jarvis reaches you for each kind of nudge — and pair a desktop daemon so the agent can run shell commands, edit files, and pop native notifications on your computer.
              </Text>
            </View>

            {/* WhatsApp */}
            <View style={[styles.platformRow, { borderTopWidth: 1, borderTopColor: Colors.border }]}>
              <View style={[styles.platformIcon, { backgroundColor: '#25D36618' }]}>
                <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>WhatsApp</Text>
                <Text style={styles.platformSubtitle}>
                  {channelData?.connected.whatsapp
                    ? channelData.meta?.whatsapp?.phone || 'Linked'
                    : 'Get nudges + chat with Jarvis on WhatsApp'}
                </Text>
              </View>
              {channelBusy === 'whatsapp' ? (
                <ActivityIndicator size="small" color="#25D366" />
              ) : channelData?.connected.whatsapp ? (
                <Pressable style={styles.disconnectBtn} onPress={() => handleUnlinkChannel('whatsapp')}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                  <Text style={styles.disconnectBtnText}>Unlink</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.connectBtn, { borderColor: '#25D366' }]}
                  onPress={handleGenerateWhatsAppCode}
                  disabled={!channelData?.channels.find(c => c.name === 'whatsapp')?.configured}
                >
                  <Text style={[styles.connectBtnText, { color: '#25D366' }]}>
                    {channelData?.channels.find(c => c.name === 'whatsapp')?.configured ? 'Get code' : 'Not configured'}
                  </Text>
                </Pressable>
              )}
            </View>
            {whatsappCode && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Colors.background }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text, marginBottom: 6 }}>
                  Send this code from WhatsApp to {whatsappCode.twilioNumber || 'the GamePlan number'}:
                </Text>
                <Text selectable style={{ fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: 4, color: '#25D366', marginBottom: 6 }}>
                  {whatsappCode.code}
                </Text>
                <Text style={{ fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_400Regular' }}>
                  Code expires in 15 minutes.
                </Text>
              </View>
            )}

            {/* Slack */}
            <View style={[styles.platformRow, { borderTopWidth: 1, borderTopColor: Colors.border }]}>
              <View style={[styles.platformIcon, { backgroundColor: '#4A154B18' }]}>
                <Ionicons name="logo-slack" size={20} color="#4A154B" />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>Slack DM</Text>
                <Text style={styles.platformSubtitle}>
                  {channelData?.connected.slack ? 'Workspace linked — DM Jarvis or use /jarvis' : 'Connect Slack above to enable DM coaching'}
                </Text>
              </View>
              {channelData?.connected.slack && (
                <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
              )}
            </View>

            {/* Discord */}
            <View style={[styles.platformRow, { borderTopWidth: 1, borderTopColor: Colors.border }]}>
              <View style={[styles.platformIcon, { backgroundColor: '#5865F218' }]}>
                <Ionicons name="logo-discord" size={20} color="#5865F2" />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>Discord</Text>
                <Text style={styles.platformSubtitle}>
                  {channelData?.connected.discord
                    ? (channelData.meta?.discord as any)?.discordUsername
                      ? `Linked as ${(channelData.meta.discord as any).discordUsername}`
                      : 'Connected — DM Jarvis anytime'
                    : (channelData?.meta?.discord as any)?.hasBotToken
                      ? 'Bot saved — DM it to get your pairing code'
                      : (channelData?.meta?.discord as any)?.sharedBotAvailable
                        ? 'Add to Discord and start chatting'
                        : 'Chat with Jarvis via Discord'}
                </Text>
              </View>
              {channelBusy === 'discord' ? (
                <ActivityIndicator size="small" color="#5865F2" />
              ) : channelData?.connected.discord ? (
                <Pressable style={styles.disconnectBtn} onPress={() => handleUnlinkChannel('discord')}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                  <Text style={styles.disconnectBtnText}>Unlink</Text>
                </Pressable>
              ) : (channelData?.meta?.discord as any)?.hasBotToken ? (
                <Pressable style={styles.disconnectBtn} onPress={() => handleUnlinkChannel('discord')}>
                  <Text style={[styles.disconnectBtnText, { color: Colors.textSecondary }]}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
            {/* Discord setup panel */}
            {!channelData?.connected.discord && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border }}>
                {/* Pairing instructions — always visible */}
                {(() => {
                  const dm = channelData?.meta?.discord as any;
                  const hasShared = !!dm?.sharedBotAvailable;
                  const hasTok = !!dm?.hasBotToken;
                  return (
                    <>
                      <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.text, marginBottom: 4 }}>
                        {hasTok ? 'Pair your Discord account' : 'Connect Discord'}
                      </Text>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 17, marginBottom: 10 }}>
                        {hasTok
                          ? 'Send any message to your bot on Discord. It will reply with a 6-character code — enter it below.'
                          : hasShared
                            ? 'Add the Jarvis bot to your server (or DM it directly), send any message, and enter the 6-character code it replies with.'
                            : 'Set up your own Discord bot token below, then DM it to get a pairing code.'}
                      </Text>
                    </>
                  );
                })()}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    value={discordPairCode}
                    onChangeText={t => setDiscordPairCode(t.toUpperCase())}
                    placeholder="Pairing code (e.g. AB3X7Y)"
                    placeholderTextColor={Colors.textTertiary}
                    style={{
                      flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', letterSpacing: 3,
                      color: '#5865F2', borderWidth: 1, borderColor: '#5865F2',
                      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
                      backgroundColor: Colors.card, textAlign: 'center',
                    }}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={6}
                  />
                  <Pressable
                    onPress={handleDiscordPair}
                    disabled={discordPairing || discordPairCode.trim().length !== 6}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8,
                      backgroundColor: '#5865F2', opacity: discordPairing || discordPairCode.trim().length !== 6 ? 0.5 : 1,
                    }}
                  >
                    {discordPairing
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Pair</Text>}
                  </Pressable>
                </View>

                {/* "Use your own bot" disclosure toggle */}
                <Pressable
                  onPress={() => setDiscordShowOwnBot(v => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 4 }}
                >
                  <Ionicons
                    name={discordShowOwnBot ? 'chevron-down' : 'chevron-forward'}
                    size={14}
                    color={Colors.textSecondary}
                  />
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textSecondary }}>
                    Use your own bot token instead
                  </Text>
                </Pressable>

                {discordShowOwnBot && (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 17, marginBottom: 8 }}>
                      1. Go to{' '}
                      <Text style={{ color: '#5865F2' }}>discord.com/developers/applications</Text>
                      {'\n'}2. New Application → Bot → Reset Token → copy it
                      {'\n'}3. Enable <Text style={{ fontFamily: 'Inter_600SemiBold' }}>Message Content</Text> and{' '}
                      <Text style={{ fontFamily: 'Inter_600SemiBold' }}>Server Members</Text> intents
                      {'\n'}4. Invite the bot to your server (OAuth2 → URL Generator)
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput
                        value={discordBotToken}
                        onChangeText={setDiscordBotToken}
                        placeholder="Bot token…"
                        secureTextEntry={!discordBotTokenVisible}
                        placeholderTextColor={Colors.textTertiary}
                        style={{
                          flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular',
                          color: Colors.text, borderWidth: 1, borderColor: Colors.border,
                          borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
                          backgroundColor: Colors.card,
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Pressable onPress={() => setDiscordBotTokenVisible(v => !v)} style={{ padding: 6 }}>
                        <Ionicons name={discordBotTokenVisible ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.textSecondary} />
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={handleSaveDiscordToken}
                      disabled={discordSaving || !discordBotToken.trim()}
                      style={{
                        marginTop: 8, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                        backgroundColor: '#5865F2', opacity: discordSaving || !discordBotToken.trim() ? 0.5 : 1,
                      }}
                    >
                      {discordSaving
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Save token & start bot</Text>}
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {/* Discord: allowlisted server channels (when connected) */}
            {channelData?.connected.discord && (
              <View style={{ borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Colors.background }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Server channels
                  </Text>
                  <Pressable
                    onPress={() => { setDiscordShowManage(v => !v); if (!discordShowManage) handleFetchDiscordGuilds(); }}
                    style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#5865F215' }}
                  >
                    <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#5865F2' }}>
                      {discordShowManage ? 'Done' : '+ Add'}
                    </Text>
                  </Pressable>
                </View>

                {/* Existing allowlisted channels */}
                {((channelData.meta?.discord as any)?.allowlistedGuilds || []).length === 0 && !discordShowManage && (
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>
                    No server channels yet — Jarvis responds to DMs only.
                  </Text>
                )}
                {((channelData.meta?.discord as any)?.allowlistedGuilds || []).map((g: any) => (
                  <View key={`${g.guildId}-${g.channelId}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 }}>
                    <Ionicons name="hash" size={14} color={Colors.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.text }}>
                        {g.channelName} <Text style={{ color: Colors.textSecondary }}>in {g.guildName}</Text>
                      </Text>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>
                        {g.requireMention ? '@mention required' : 'Always responds'}
                      </Text>
                    </View>
                    <Pressable onPress={() => handleRemoveDiscordAllowlist(g.guildId, g.channelId)} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
                    </Pressable>
                  </View>
                ))}

                {/* Workspace setup inline banner */}
                {!(channelData.meta?.discord as any)?.workspace && !discordShowManage && (
                  <View style={{ marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: '#5865F210', borderWidth: 1, borderColor: '#5865F230' }}>
                    <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#5865F2', marginBottom: 2 }}>
                      🧠 Jarvis Workspace
                    </Text>
                    <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginBottom: 8 }}>
                      Let Jarvis organise your life in Discord — topic channels for Finance, Ideas, Business, and more.
                    </Text>
                    <Pressable
                      onPress={handleOpenWorkspaceSetup}
                      style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#5865F2' }}
                    >
                      <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>
                        {discordShowWorkspaceSetup ? 'Cancel' : 'Set up Workspace'}
                      </Text>
                    </Pressable>
                    {discordShowWorkspaceSetup && (
                      <View style={{ marginTop: 10, gap: 6 }}>
                        {discordWorkspaceBusy && discordWorkspaceGuilds.length === 0 ? (
                          <ActivityIndicator size="small" color="#5865F2" />
                        ) : discordWorkspaceGuilds.length === 0 ? (
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary }}>
                            No servers found — make sure your bot is in a server.
                          </Text>
                        ) : (
                          <>
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.textSecondary }}>
                              Pick the server for the workspace:
                            </Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                              <View style={{ flexDirection: 'row', gap: 6 }}>
                                {discordWorkspaceGuilds.map(g => (
                                  <Pressable
                                    key={g.id}
                                    onPress={() => setDiscordWorkspaceSelGuild(g.id)}
                                    style={{
                                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
                                      borderWidth: 1,
                                      borderColor: discordWorkspaceSelGuild === g.id ? '#5865F2' : Colors.border,
                                      backgroundColor: discordWorkspaceSelGuild === g.id ? '#5865F215' : Colors.card,
                                    }}
                                  >
                                    <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: discordWorkspaceSelGuild === g.id ? '#5865F2' : Colors.text }}>
                                      {g.name}
                                    </Text>
                                  </Pressable>
                                ))}
                              </View>
                            </ScrollView>
                            {discordWorkspaceSelGuild !== '' && (
                              <Pressable
                                onPress={() => handleSetupWorkspace(discordWorkspaceSelGuild)}
                                disabled={discordWorkspaceBusy}
                                style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#5865F2', opacity: discordWorkspaceBusy ? 0.5 : 1 }}
                              >
                                {discordWorkspaceBusy
                                  ? <ActivityIndicator size="small" color="#fff" />
                                  : <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Create Workspace →</Text>}
                              </Pressable>
                            )}
                          </>
                        )}
                      </View>
                    )}
                  </View>
                )}

                {/* Existing workspace info */}
                {(channelData.meta?.discord as any)?.workspace && (
                  <View style={{ marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: '#5865F210', borderWidth: 1, borderColor: '#5865F230' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#5865F2' }}>
                          🧠 Jarvis Workspace
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginTop: 2 }}>
                          Active in {(channelData.meta.discord as any).workspace.guildName}
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary, marginTop: 3 }}>
                          {Object.keys((channelData.meta.discord as any).workspace.channels || {}).map((k: string) => {
                            const emojis: Record<string, string> = { tasks: '📋', finance: '💰', ideas: '💡', business: '💼', personal: '🌱', thinking: '🧠' };
                            return (emojis[k] || '') + '#' + k;
                          }).join('  ')}
                        </Text>
                      </View>
                      <Pressable
                        onPress={handleOpenWorkspaceSetup}
                        style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#5865F215' }}
                      >
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: '#5865F2' }}>
                          {discordShowWorkspaceSetup ? 'Cancel' : 'Reconfigure'}
                        </Text>
                      </Pressable>
                    </View>
                    {discordShowWorkspaceSetup && (
                      <View style={{ marginTop: 10, gap: 6 }}>
                        {discordWorkspaceBusy && discordWorkspaceGuilds.length === 0 ? (
                          <ActivityIndicator size="small" color="#5865F2" />
                        ) : discordWorkspaceGuilds.length === 0 ? (
                          <Text style={{ fontSize: 11, color: Colors.textSecondary }}>No servers found.</Text>
                        ) : (
                          <>
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.textSecondary }}>Pick a server:</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                              <View style={{ flexDirection: 'row', gap: 6 }}>
                                {discordWorkspaceGuilds.map(g => (
                                  <Pressable key={g.id} onPress={() => setDiscordWorkspaceSelGuild(g.id)}
                                    style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1,
                                      borderColor: discordWorkspaceSelGuild === g.id ? '#5865F2' : Colors.border,
                                      backgroundColor: discordWorkspaceSelGuild === g.id ? '#5865F215' : Colors.card }}>
                                    <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: discordWorkspaceSelGuild === g.id ? '#5865F2' : Colors.text }}>{g.name}</Text>
                                  </Pressable>
                                ))}
                              </View>
                            </ScrollView>
                            {discordWorkspaceSelGuild !== '' && (
                              <Pressable onPress={() => handleSetupWorkspace(discordWorkspaceSelGuild)} disabled={discordWorkspaceBusy}
                                style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#5865F2', opacity: discordWorkspaceBusy ? 0.5 : 1 }}>
                                {discordWorkspaceBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Recreate Workspace →</Text>}
                              </Pressable>
                            )}
                          </>
                        )}
                      </View>
                    )}
                  </View>
                )}

                {/* Slash commands setup */}
                <View style={{ borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Pressable
                      onPress={handleToggleSlashSetup}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text }}>Slash commands</Text>
                          {discordSlashConfig && !discordSlashConfig.publicKeyConfigured && (
                            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(245,158,11,0.15)' }}>
                              <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#F59E0B' }}>Setup needed</Text>
                            </View>
                          )}
                          {discordSlashConfig?.publicKeyConfigured && (
                            <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
                          )}
                        </View>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginTop: 1 }}>
                          Enable /jarvis commands in your server
                        </Text>
                      </View>
                      <Ionicons
                        name={discordShowSlashSetup ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={Colors.textSecondary}
                      />
                    </Pressable>
                    {discordShowSlashSetup && (
                      <Pressable onPress={handleRefreshSlashConfig} style={{ paddingLeft: 8, paddingVertical: 10 }} hitSlop={8}>
                        <Ionicons name="refresh-outline" size={16} color={Colors.textSecondary} />
                      </Pressable>
                    )}
                  </View>

                  {discordShowSlashSetup && (
                    <View style={{ paddingBottom: 12, gap: 12 }}>
                      {/* Step 1 — Interactions URL */}
                      <View style={{ backgroundColor: Colors.card, borderRadius: 10, padding: 12, gap: 8 }}>
                        <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: Colors.text }}>
                          Step 1 — Set Interactions Endpoint URL
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 16 }}>
                          In the Discord Developer Portal → Your Application → General Information, paste this URL into the{' '}
                          <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.text }}>Interactions Endpoint URL</Text> field:
                        </Text>
                        {discordSlashConfig ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text
                              selectable
                              style={{
                                flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular',
                                color: '#5865F2', backgroundColor: '#5865F210',
                                borderRadius: 6, padding: 8, lineHeight: 16,
                              }}
                            >
                              {discordSlashConfig.interactionsUrl}
                            </Text>
                            <Pressable
                              onPress={handleCopyInteractionsUrl}
                              style={{
                                padding: 8, borderRadius: 8,
                                backgroundColor: discordUrlCopied ? '#22C55E20' : '#5865F215',
                              }}
                            >
                              <Ionicons
                                name={discordUrlCopied ? 'checkmark' : 'copy-outline'}
                                size={16}
                                color={discordUrlCopied ? '#22C55E' : '#5865F2'}
                              />
                            </Pressable>
                          </View>
                        ) : (
                          <ActivityIndicator size="small" color="#5865F2" />
                        )}
                      </View>

                      {/* Step 2 — DISCORD_PUBLIC_KEY */}
                      <View style={{ backgroundColor: Colors.card, borderRadius: 10, padding: 12, gap: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: Colors.text }}>
                            Step 2 — Add Public Key secret
                          </Text>
                          {discordSlashConfig?.publicKeyConfigured
                            ? <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
                            : <Ionicons name="alert-circle-outline" size={14} color="#F59E0B" />}
                        </View>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 16 }}>
                          In Discord Developer Portal → General Information, copy the{' '}
                          <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.text }}>Public Key</Text>{' '}
                          value. Then in Replit Secrets, add it as{' '}
                          <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.text }}>DISCORD_PUBLIC_KEY</Text>.
                        </Text>
                        {discordSlashConfig?.publicKeyConfigured ? (
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: '#22C55E' }}>
                            ✓ Public key is configured
                          </Text>
                        ) : (
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: '#F59E0B' }}>
                            Not configured — slash commands will be rejected until this is set
                          </Text>
                        )}
                      </View>

                      {/* Step 3 — Register commands */}
                      <View style={{ backgroundColor: Colors.card, borderRadius: 10, padding: 12, gap: 6 }}>
                        <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: Colors.text }}>
                          Step 3 — Done
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 16 }}>
                          Once the endpoint is saved and the public key is set, restart your server. Jarvis will register{' '}
                          <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.text }}>/jarvis chat</Text>,{' '}
                          <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.text }}>/jarvis plan</Text>,{' '}
                          <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.text }}>/jarvis status</Text>, and{' '}
                          <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.text }}>/jarvis help</Text> automatically.
                        </Text>
                      </View>
                    </View>
                  )}
                </View>

                {/* Voice replies toggle */}
                <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text }}>Voice replies</Text>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginTop: 1 }}>
                        Jarvis sends audio notes to this channel
                      </Text>
                    </View>
                    <Switch
                      value={discordTtsEnabled}
                      onValueChange={handleToggleDiscordTts}
                      trackColor={{ true: '#5865F2', false: Colors.border }}
                      thumbColor="#fff"
                    />
                  </View>

                  {/* Voice picker — always visible so users can set their preferred voice */}
                  <View style={{ marginTop: 12 }}>
                    <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginBottom: 6 }}>Voice</Text>
                    {/* OpenAI voices */}
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginBottom: 4, opacity: 0.7 }}>OpenAI</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {[
                          { id: 'nova', label: 'Nova' },
                          { id: 'alloy', label: 'Alloy' },
                          { id: 'echo', label: 'Echo' },
                          { id: 'fable', label: 'Fable' },
                          { id: 'onyx', label: 'Onyx' },
                          { id: 'shimmer', label: 'Shimmer' },
                        ].map(v => (
                          <Pressable
                            key={v.id}
                            onPress={() => handleSelectVoice(v.id)}
                            style={{
                              paddingHorizontal: 12, paddingVertical: 6,
                              borderRadius: 16, borderWidth: 1,
                              borderColor: ttsVoice === v.id ? '#5865F2' : Colors.border,
                              backgroundColor: ttsVoice === v.id ? 'rgba(88,101,242,0.15)' : 'transparent',
                            }}
                          >
                            <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: ttsVoice === v.id ? '#5865F2' : Colors.textSecondary }}>
                              {v.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                    {/* ElevenLabs voices */}
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginBottom: 4, opacity: 0.7 }}>ElevenLabs</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {[
                          { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah' },
                          { id: 'FGY2WhTYpPnrIDTdsKH5', label: 'Laura' },
                          { id: 'IKne3meq5aSn9XLyUdCD', label: 'Charlie' },
                          { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George' },
                          { id: 'N2lVS1w4EtoT3dr4eOWO', label: 'Callum' },
                          { id: 'SAz9YHcvj6GT2YYXdXww', label: 'River' },
                          { id: 'Xb7hH8MSUJpSbSDYk0k2', label: 'Alice' },
                          { id: 'XrExE9yKIg1WjnnlVkGX', label: 'Matilda' },
                          { id: 'cgSgspJ2msm6clMCkdW9', label: 'Jessica' },
                          { id: 'cjVigY5qzO86Huf0OWal', label: 'Eric' },
                          { id: 'nPczCjzI2devNBz1zQrb', label: 'Brian' },
                          { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel' },
                          { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam' },
                        ].map(v => (
                          <Pressable
                            key={v.id}
                            onPress={() => handleSelectVoice(v.id)}
                            style={{
                              paddingHorizontal: 12, paddingVertical: 6,
                              borderRadius: 16, borderWidth: 1,
                              borderColor: ttsVoice === v.id ? '#F0A500' : Colors.border,
                              backgroundColor: ttsVoice === v.id ? 'rgba(240,165,0,0.12)' : 'transparent',
                            }}
                          >
                            <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: ttsVoice === v.id ? '#F0A500' : Colors.textSecondary }}>
                              {v.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>

                  {/* ElevenLabs latency tier — only shown when an ElevenLabs voice is selected */}
                  {!['nova','alloy','echo','fable','onyx','shimmer'].includes(ttsVoice) && (
                    <View style={{ marginTop: 12 }}>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginBottom: 6 }}>Response Speed</Text>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {([
                          { tier: 4 as const, label: 'Low Latency' },
                          { tier: 2 as const, label: 'Balanced' },
                          { tier: 0 as const, label: 'High Quality' },
                        ] as { tier: 0 | 2 | 4; label: string }[]).map(({ tier, label }) => (
                          <Pressable
                            key={tier}
                            onPress={() => handleSelectLatencyTier(tier)}
                            style={{
                              flex: 1, paddingVertical: 7,
                              borderRadius: 10, borderWidth: 1, alignItems: 'center',
                              borderColor: ttsLatencyTier === tier ? '#F0A500' : Colors.border,
                              backgroundColor: ttsLatencyTier === tier ? 'rgba(240,165,0,0.12)' : 'transparent',
                            }}
                          >
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: ttsLatencyTier === tier ? '#F0A500' : Colors.textSecondary }}>
                              {label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                </View>

                {/* Add channel form */}
                {discordShowManage && (
                  <View style={{ marginTop: 8, gap: 8 }}>
                    {discordAllowlistBusy && discordGuilds.length === 0 ? (
                      <ActivityIndicator size="small" color="#5865F2" />
                    ) : discordGuilds.length === 0 ? (
                      <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary }}>
                        No servers found — invite your bot to a server first.
                      </Text>
                    ) : (
                      <>
                        {/* Guild picker */}
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.textSecondary }}>Select server:</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            {discordGuilds.map(g => (
                              <Pressable
                                key={g.id}
                                onPress={() => handleFetchDiscordChannels(g.id)}
                                style={{
                                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
                                  borderWidth: 1,
                                  borderColor: discordSelGuildId === g.id ? '#5865F2' : Colors.border,
                                  backgroundColor: discordSelGuildId === g.id ? '#5865F215' : Colors.card,
                                }}
                              >
                                <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: discordSelGuildId === g.id ? '#5865F2' : Colors.text }}>
                                  {g.name}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </ScrollView>

                        {/* Channel picker */}
                        {discordSelGuildId !== '' && discordGuildChannels.length > 0 && (
                          <>
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.textSecondary }}>Select channel:</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                              <View style={{ flexDirection: 'row', gap: 6 }}>
                                {discordGuildChannels.map(c => (
                                  <Pressable
                                    key={c.id}
                                    onPress={() => setDiscordSelChannelId(c.id)}
                                    style={{
                                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
                                      borderWidth: 1,
                                      borderColor: discordSelChannelId === c.id ? '#5865F2' : Colors.border,
                                      backgroundColor: discordSelChannelId === c.id ? '#5865F215' : Colors.card,
                                    }}
                                  >
                                    <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: discordSelChannelId === c.id ? '#5865F2' : Colors.text }}>
                                      #{c.name}
                                    </Text>
                                  </Pressable>
                                ))}
                              </View>
                            </ScrollView>
                          </>
                        )}

                        {/* requireMention + Add button */}
                        {discordSelChannelId !== '' && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Switch
                                value={discordRequireMention}
                                onValueChange={setDiscordRequireMention}
                                trackColor={{ true: '#5865F2', false: Colors.border }}
                                thumbColor="#fff"
                              />
                              <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary }}>
                                Require @mention
                              </Text>
                            </View>
                            <Pressable
                              onPress={handleAddDiscordAllowlist}
                              disabled={discordAllowlistBusy}
                              style={{
                                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
                                backgroundColor: '#5865F2', opacity: discordAllowlistBusy ? 0.5 : 1,
                              }}
                            >
                              {discordAllowlistBusy
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Add channel</Text>}
                            </Pressable>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Desktop Daemon */}
            <View style={[styles.platformRow, { borderTopWidth: 1, borderTopColor: Colors.border }]}>
              <View style={[styles.platformIcon, { backgroundColor: '#6B72FF18' }]}>
                <Ionicons name="desktop-outline" size={20} color="#6B72FF" />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>Desktop Daemon</Text>
                <Text style={styles.platformSubtitle}>
                  {channelData?.desktop_daemon_connected
                    ? `Connected${channelData.meta?.desktop_daemon?.hostname ? ` • ${channelData.meta.desktop_daemon.hostname}` : ''}`
                    : 'Run the daemon and let the agent control your computer'}
                </Text>
              </View>
              {channelBusy === 'desktop-daemon' ? (
                <ActivityIndicator size="small" color="#6B72FF" />
              ) : channelData?.desktop_daemon_connected ? (
                <Pressable style={styles.disconnectBtn} onPress={() => handleUnlinkChannel('desktop-daemon')}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                  <Text style={styles.disconnectBtnText}>Unpair</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.connectBtn, { borderColor: '#6B72FF' }]}
                  onPress={handleGenerateDaemonCode}
                >
                  <Text style={[styles.connectBtnText, { color: '#6B72FF' }]}>Pair</Text>
                </Pressable>
              )}
            </View>
            {daemonCode && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Colors.background }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text, marginBottom: 6 }}>
                  Pairing code (valid 15 min):
                </Text>
                <Text selectable style={{ fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: 4, color: '#6B72FF', marginBottom: 8 }}>
                  {daemonCode}
                </Text>
                <Text selectable style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 18 }}>
                  On your computer, install the daemon (`cd daemon && npm install`) then run:
                </Text>
                <Text selectable style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.text, backgroundColor: Colors.background, padding: 8, marginTop: 6, borderRadius: 6 }}>
                  JARVIS_SERVER={'<your-app-url>'} JARVIS_PAIR_CODE={daemonCode} node jarvis-daemon.js
                </Text>
              </View>
            )}

            {/* Daemon per-action permissions — gates what the agent can do on the user's machine */}
            {daemonPerms && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.text, marginBottom: 4 }}>
                  Daemon permissions
                </Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 17, marginBottom: 10 }}>
                  Choose exactly what the agent is allowed to do on your computer. Shell and file writes are off by default.
                </Text>
                {([
                  { key: 'notify',        label: 'Send desktop notifications',                 subtitle: undefined, warning: undefined },
                  { key: 'file_read',     label: 'Read files in the workspace',                subtitle: undefined, warning: undefined },
                  { key: 'file_list',     label: 'List files in the workspace',                subtitle: undefined, warning: undefined },
                  { key: 'file_write',    label: 'Write files in the workspace',               subtitle: undefined, warning: undefined },
                  { key: 'browser_local', label: 'Local browser control',                      subtitle: 'Let Jarvis automate your real browser with your logged-in sessions', warning: { heading: '⚠ Browser automation uses your real logged-in sessions', body: 'Jarvis will control your browser as you — it can see pages, click links, and fill forms using cookies and credentials already in your browser. Only enable on a machine you trust the agent to operate.' } },
                  { key: 'shell',         label: 'Run shell commands',                         subtitle: undefined, warning: { heading: '⚠ Shell access runs ANY command on your machine', body: 'Enabling this lets the agent execute arbitrary shell commands as your local user — install packages, delete files, exfiltrate data, anything you could type yourself. Only enable on a machine you trust the agent to operate, and review what it runs. You can disable this any time.' } },
                ] as { key: string; label: string; subtitle: string | undefined; warning: { heading: string; body: string } | undefined }[]).map((p) => p.warning ? (
                  <View key={p.key}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.text }}>{p.label}</Text>
                        {p.subtitle ? (
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginTop: 2 }}>{p.subtitle}</Text>
                        ) : null}
                      </View>
                      {daemonPermsBusy === p.key ? (
                        <ActivityIndicator size="small" color="#6B72FF" />
                      ) : (
                        <Switch
                          value={!!daemonPerms[p.key]}
                          onValueChange={() => handleToggleDaemonPerm(p.key)}
                          trackColor={{ false: Colors.border, true: '#6B72FF88' }}
                          thumbColor={daemonPerms[p.key] ? '#6B72FF' : '#f4f3f4'}
                        />
                      )}
                    </View>
                    {(p.key === 'shell' || !!daemonPerms[p.key]) && (
                      <View style={{ marginTop: 4, marginBottom: 4, padding: 10, borderRadius: 8, backgroundColor: '#FFF4E5', borderWidth: 1, borderColor: '#F0B44A' }}>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#8A5A00', marginBottom: 2 }}>
                          {p.warning.heading}
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: '#8A5A00', lineHeight: 16 }}>
                          {p.warning.body}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                    <Text style={{ flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.text }}>{p.label}</Text>
                    {daemonPermsBusy === p.key ? (
                      <ActivityIndicator size="small" color="#6B72FF" />
                    ) : (
                      <Switch
                        value={!!daemonPerms[p.key]}
                        onValueChange={() => handleToggleDaemonPerm(p.key)}
                        trackColor={{ false: Colors.border, true: '#6B72FF88' }}
                        thumbColor={daemonPerms[p.key] ? '#6B72FF' : '#f4f3f4'}
                      />
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Android Device */}
            <View style={[styles.platformRow, { borderTopWidth: 1, borderTopColor: Colors.border }]}>
              <View style={[styles.platformIcon, { backgroundColor: '#34A85318' }]}>
                <Ionicons name="phone-portrait-outline" size={20} color="#34A853" />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>Android Device</Text>
                <Text style={styles.platformSubtitle}>
                  {channelData?.android_daemon_connected
                    ? `Connected${channelData.meta?.android_daemon?.hostname ? ` • ${channelData.meta.android_daemon.hostname}` : ''}`
                    : 'Sideload the APK and let Jarvis control your Android phone'}
                </Text>
              </View>
              {channelBusy === 'android-daemon' ? (
                <ActivityIndicator size="small" color="#34A853" />
              ) : channelData?.android_daemon_connected ? (
                <Pressable style={styles.disconnectBtn} onPress={() => handleUnlinkChannel('android-daemon')}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                  <Text style={styles.disconnectBtnText}>Unpair</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.connectBtn, { borderColor: '#34A853' }]}
                  onPress={handleGenerateAndroidDaemonCode}
                >
                  <Text style={[styles.connectBtnText, { color: '#34A853' }]}>Pair</Text>
                </Pressable>
              )}
            </View>
            {!channelData?.android_daemon_connected && (() => {
              const apkUrl = `${getApiUrl()}/api/download/apk`;
              const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(apkUrl)}`;
              return (
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background }}>
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.text, marginBottom: 4 }}>
                    Step 1 — Get the app
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 18, marginBottom: 10 }}>
                    Download the Jarvis Daemon APK and install it on your Android phone. Enable "Install from unknown sources" when prompted.
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ alignItems: 'center' }}>
                      <Image
                        source={{ uri: qrUrl }}
                        style={{ width: 100, height: 100, borderRadius: 8 }}
                        resizeMode="contain"
                      />
                      <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginTop: 4 }}>
                        Scan to download
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Pressable
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#34A853', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 }}
                        onPress={() => WebBrowser.openBrowserAsync(apkUrl)}
                      >
                        <Ionicons name="download-outline" size={16} color="#fff" />
                        <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Download APK</Text>
                      </Pressable>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginTop: 6, lineHeight: 16 }}>
                        Tap "Pair" above after installing to get your connection code.
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })()}
            {androidDaemonCode && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Colors.background }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text, marginBottom: 6 }}>
                  Step 2 — Enter pairing code (valid 15 min):
                </Text>
                <Text selectable style={{ fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: 4, color: '#34A853', marginBottom: 8 }}>
                  {androidDaemonCode}
                </Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 18, marginBottom: 8 }}>
                  Open the Jarvis Daemon app on your phone, then:
                </Text>
                <View style={{ padding: 10, borderRadius: 8, backgroundColor: '#34A85312', borderWidth: 1, borderColor: '#34A853', marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: '#1a6b30', lineHeight: 20 }}>
                    1. Server URL:{'\n'}
                    <Text style={{ fontFamily: 'Inter_700Bold', letterSpacing: 0.5 }}>https://GameplanAI.replit.app</Text>{'\n\n'}
                    2. Pairing Code: enter the code above{'\n\n'}
                    3. Tap <Text style={{ fontFamily: 'Inter_700Bold' }}>Pair</Text>. The dot turns green when connected.
                  </Text>
                </View>
                <View style={{ padding: 10, borderRadius: 8, backgroundColor: '#FFF9E6', borderWidth: 1, borderColor: '#F0C040' }}>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#7A5A00', marginBottom: 3 }}>
                    Required permissions in the daemon app:
                  </Text>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: '#7A5A00', lineHeight: 16 }}>
                    • Accessibility Service — for screen reading and taps{'\n'}
                    • Storage — for file access{'\n'}
                    • (Optional) Notification Access — to forward your notifications to Jarvis
                  </Text>
                </View>
              </View>
            )}

            {/* Android daemon per-action permissions */}
            {androidDaemonPerms && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.text, marginBottom: 4 }}>
                  Android permissions
                </Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 17, marginBottom: 10 }}>
                  Choose what Jarvis can do on your Android. Tap/type and file reads are off by default.
                </Text>
                {([
                  { key: 'android_screenshot',    label: 'Take screenshots' },
                  { key: 'android_read_screen',   label: 'Read screen content (accessibility tree)' },
                  { key: 'android_open_app',      label: 'Open apps by name' },
                  { key: 'android_browse',        label: 'Open URLs in browser' },
                  { key: 'android_file_list',     label: 'List files (gallery, downloads, any folder)' },
                  { key: 'android_file_read',     label: 'Read files from device storage' },
                  { key: 'android_tap_type',      label: 'Tap, type and swipe on screen' },
                  { key: 'android_camera',        label: 'Camera (photos & video clips)' },
                  { key: 'android_location',      label: 'Location (GPS coordinates)' },
                  { key: 'android_sms',           label: 'Send SMS messages' },
                  { key: 'android_screen_record', label: 'Screen recording (up to 60s)' },
                ] as const).map((p) => {
                  const warnings: Record<string, { title: string; body: string; warn?: boolean; fixLabel?: string; fixAction?: () => void }> = {
                    android_tap_type: { title: '⚠ Tap/type gives Jarvis input control', body: 'Jarvis will always ask for confirmation before tapping or typing on your behalf. Enable only if you trust Jarvis to act on your screen.', warn: true },
                    android_sms: {
                      title: '⚠ SMS requires your explicit confirmation',
                      body: 'Jarvis will show you the exact recipient and message and ask for approval before sending any SMS. Requires SEND_SMS permission on your Android device.',
                      warn: true,
                      fixLabel: 'Open Settings',
                      fixAction: () => Linking.openSettings(),
                    },
                    android_camera: {
                      title: 'Device permission required',
                      body: 'Open the Jarvis Daemon app on your Android and tap "Grant" next to Camera. Without this, camera snaps and clips will fail.',
                      warn: false,
                      fixLabel: 'Open Settings',
                      fixAction: () => Linking.openSettings(),
                    },
                    android_location: {
                      title: 'Device permission required',
                      body: 'The first time Jarvis requests your location, Android will prompt for permission. You can also grant it in Settings → Apps → Jarvis Daemon → Permissions → Location.',
                      warn: false,
                      fixLabel: 'Open Settings',
                      fixAction: () => Linking.openSettings(),
                    },
                    android_screen_record: {
                      title: 'One-time device grant required',
                      body: 'Open the Jarvis Daemon app on your Android and tap "Allow" next to Screen Recording to grant MediaProjection access. This must be done before screen recording will work.',
                      warn: false,
                      fixLabel: 'How to fix',
                      fixAction: () => Alert.alert(
                        'Enable Screen Recording',
                        '1. Open the Jarvis Daemon app on your Android device.\n2. Tap "Allow" next to Screen Recording.\n3. Approve the system prompt that appears.\n\nAfter granting access, screen recording will be available.',
                        [{ text: 'OK' }]
                      ),
                    },
                  };
                  const hint = warnings[p.key];
                  const switchRow = (
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                      <Text style={{ flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.text }}>{p.label}</Text>
                      {androidDaemonPermsBusy === p.key ? (
                        <ActivityIndicator size="small" color="#34A853" />
                      ) : (
                        <Switch
                          value={!!androidDaemonPerms[p.key]}
                          onValueChange={() => handleToggleAndroidDaemonPerm(p.key)}
                          trackColor={{ false: Colors.border, true: '#34A85388' }}
                          thumbColor={androidDaemonPerms[p.key] ? '#34A853' : '#f4f3f4'}
                        />
                      )}
                    </View>
                  );
                  if (hint) {
                    const bgColor = hint.warn ? '#FFF4E5' : '#EAF4FF';
                    const borderColor = hint.warn ? '#F0B44A' : '#5B9BD5';
                    const textColor = hint.warn ? '#8A5A00' : '#1A4A7A';
                    return (
                      <View key={p.key}>
                        {switchRow}
                        <View style={{ marginTop: 4, marginBottom: 4, padding: 10, borderRadius: 8, backgroundColor: bgColor, borderWidth: 1, borderColor: borderColor }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                            <Text style={{ flex: 1, fontSize: 11, fontFamily: 'Inter_600SemiBold', color: textColor }}>
                              {hint.title}
                            </Text>
                            {hint.fixAction && (
                              <Pressable onPress={hint.fixAction} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: borderColor }}>
                                <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: hint.warn ? '#5A3A00' : '#fff' }}>{hint.fixLabel}</Text>
                              </Pressable>
                            )}
                          </View>
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: textColor, lineHeight: 16 }}>
                            {hint.body}
                          </Text>
                        </View>
                      </View>
                    );
                  }
                  return <View key={p.key}>{switchRow}</View>;
                })}
              </View>
            )}
          </View>

          {/* Notification routing grid */}
          {channelData && (
            <View style={[styles.platformsList, { marginTop: 12 }]}>
              <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.text, marginBottom: 4 }}>
                  Notification routing
                </Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 17 }}>
                  Choose which channels each notification type goes to. Types with no selection fall back to Telegram (if connected) or in-app.
                </Text>
              </View>
              {channelData.notificationTypes.map((nt) => {
                const prefChannels = channelData.preferences[nt] || [];
                const selected = new Set(prefChannels.length > 0 ? prefChannels : ['telegram']);
                const usingDefault = prefChannels.length === 0;

                const NICE: Record<string, { label: string; desc: string }> = {
                  morning_briefing: { label: 'Morning briefing', desc: 'Daily plan summary sent each morning' },
                  meeting_brief:    { label: 'Meeting briefs',   desc: 'Pre-meeting research sent 30–60 min ahead' },
                  email_alert:      { label: 'Email alerts',     desc: 'Urgent emails and draft queue nudges' },
                  evening_wrap:     { label: 'Evening wrap-up',  desc: 'End-of-day summary and streak update' },
                  commitment_check: { label: 'Commitment checks', desc: "Follow-ups on things you said you'd do" },
                  weekly_planning:  { label: 'Weekly planning',  desc: 'Sunday pattern insights and week preview' },
                  approval_request: { label: 'Approval requests', desc: 'Deliverables from Jarvis waiting for review' },
                  general:          { label: 'General messages', desc: 'Curiosity questions and miscellaneous nudges' },
                };

                const info = NICE[nt] || { label: nt, desc: '' };

                const hasNoActiveChannel = prefChannels.length > 0 &&
                  !prefChannels.some(ch => ch === 'in_app' || channelData.connected[ch]);

                return (
                  <View key={nt} style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text }}>
                          {info.label}
                        </Text>
                        {info.desc ? (
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary, marginTop: 1 }}>
                            {info.desc}
                          </Text>
                        ) : null}
                      </View>
                      {hasNoActiveChannel && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FEF3C7', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, marginLeft: 8 }}>
                          <Ionicons name="warning-outline" size={11} color="#D97706" />
                          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#D97706' }}>No channel</Text>
                        </View>
                      )}
                      {usingDefault && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.border, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, marginLeft: 8 }}>
                          <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>default</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {(['in_app', 'telegram', 'slack', 'discord', 'whatsapp', 'daemon'] as const).map((ch) => {
                        const connected = ch === 'in_app' ? true : !!channelData.connected[ch];
                        const isSelected = selected.has(ch) && !usingDefault;
                        const isDefaultSelected = usingDefault && (ch === 'telegram' || ch === 'in_app');
                        const LABELS: Record<string, string> = {
                          in_app: 'In-App', telegram: 'Telegram', whatsapp: 'WhatsApp', slack: 'Slack',
                          daemon: 'Desktop', discord: 'Discord',
                        };
                        return (
                          <Pressable
                            key={ch}
                            onPress={() => {
                              if (!connected) return;
                              handleTogglePreference(nt, ch);
                            }}
                            disabled={!connected}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 5,
                              borderRadius: 14,
                              borderWidth: 1,
                              borderColor: isSelected ? Colors.accent : isDefaultSelected ? Colors.accent + '66' : Colors.border,
                              backgroundColor: isSelected ? Colors.accent + '22' : isDefaultSelected ? Colors.accent + '11' : 'transparent',
                              opacity: connected ? 1 : 0.35,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {(isSelected || isDefaultSelected) && (
                              <Ionicons name="checkmark" size={11} color={Colors.accent} />
                            )}
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: isSelected || isDefaultSelected ? Colors.accent : Colors.textSecondary }}>
                              {LABELS[ch] || ch}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {usingDefault && (
                      <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: Colors.textTertiary, marginTop: 6 }}>
                        Tap a channel to set a custom preference
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </Animated.View>

        {/* My Website */}
        <Animated.View entering={FadeInDown.duration(400).delay(450)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>My Website</Text>
          <View style={styles.platformsList}>
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14 }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 }}>
                Point Jarvis at your personal or business website so it always knows who you are and what you do.
              </Text>

              {/* URL input row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <TextInput
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: Colors.border,
                    paddingHorizontal: 12,
                    fontSize: 13,
                    fontFamily: 'Inter_400Regular',
                    color: Colors.text,
                    backgroundColor: Colors.surface,
                  }}
                  placeholder="https://yoursite.com"
                  placeholderTextColor={Colors.textTertiary}
                  value={websiteUrlInput}
                  onChangeText={setWebsiteUrlInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  editable={!websiteCrawling && websiteCrawl.status !== 'crawling'}
                />
                <Pressable
                  style={{
                    height: 40,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    backgroundColor: (websiteCrawling || websiteCrawl.status === 'crawling' || !websiteUrlInput.trim()) ? Colors.border : '#6366F1',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onPress={handleCrawlWebsite}
                  disabled={websiteCrawling || websiteCrawl.status === 'crawling' || !websiteUrlInput.trim()}
                >
                  {websiteCrawling || websiteCrawl.status === 'crawling' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Crawl</Text>
                  )}
                </Pressable>
              </View>

              {/* Status badge */}
              {websiteCrawl.status === 'idle' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.textTertiary }} />
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>Not connected</Text>
                </View>
              ) : websiteCrawl.status === 'crawling' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <ActivityIndicator size="small" color="#6366F1" style={{ transform: [{ scale: 0.7 }] }} />
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6366F1' }}>Crawling website…</Text>
                </View>
              ) : websiteCrawl.status === 'error' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="alert-circle" size={13} color="#EF4444" />
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: '#EF4444' }}>Crawl failed — try again</Text>
                </View>
              ) : websiteCrawl.status === 'done' ? (
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="checkmark-circle" size={13} color={Colors.success} />
                      <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.success }}>
                        Connected — {websiteCrawl.pageCount ?? 0} pages read
                      </Text>
                    </View>
                    <Pressable onPress={handleRemoveWebsiteCrawl} hitSlop={10}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: '#EF4444' }}>Remove</Text>
                    </Pressable>
                  </View>
                  {websiteCrawl.summary ? (
                    <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border }}>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 16 }} numberOfLines={5}>
                        {websiteCrawl.summary}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        </Animated.View>

        {/* My Documents */}
        <Animated.View entering={FadeInDown.duration(400).delay(460)}>
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>My Documents</Text>
          <View style={styles.platformsList}>
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 }}>
                Upload documents so Jarvis can read them and refer back to them in every conversation. Supports PDF, Word, text files, and images.
              </Text>
              <Pressable
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  paddingVertical: 11,
                  borderRadius: 12,
                  backgroundColor: documentUploading ? '#E2E8F0' : '#6366F1',
                  opacity: documentUploading || documents.length >= 10 ? 0.6 : 1,
                }}
                onPress={handleUploadDocument}
                disabled={documentUploading || documents.length >= 10}
              >
                {documentUploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                )}
                <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>
                  {documentUploading ? 'Uploading...' : documents.length >= 10 ? 'Limit reached (10)' : 'Upload Document'}
                </Text>
              </Pressable>
            </View>

            {documentsLoading && documents.length === 0 ? (
              <View style={{ paddingHorizontal: 16, paddingBottom: 14, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={Colors.textTertiary} />
              </View>
            ) : documents.length === 0 ? (
              <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textTertiary, textAlign: 'center' }}>
                  No documents uploaded yet
                </Text>
              </View>
            ) : (
              <View style={{ paddingBottom: 8 }}>
                {documents.map((doc, idx) => (
                  <View
                    key={doc.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderTopWidth: idx === 0 ? 1 : 0,
                      borderTopColor: Colors.border,
                      borderBottomWidth: 1,
                      borderBottomColor: Colors.border,
                      gap: 10,
                    }}
                  >
                    <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#6366F115', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons
                        name={
                          doc.mimeType === 'application/pdf' ? 'document-text-outline' :
                          doc.mimeType.startsWith('image/') ? 'image-outline' :
                          'document-outline'
                        }
                        size={18}
                        color="#6366F1"
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text }} numberOfLines={1}>
                        {doc.name}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {doc.status === 'processing' ? (
                          <>
                            <ActivityIndicator size="small" color="#6366F1" style={{ transform: [{ scale: 0.7 }] }} />
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: '#6366F1' }}>Reading...</Text>
                          </>
                        ) : doc.status === 'error' ? (
                          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: '#EF4444' }}>Failed to read</Text>
                        ) : (
                          <>
                            <Ionicons name="checkmark-circle" size={12} color={Colors.success} />
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>
                              {formatFileSize(doc.sizeBytes)} · Ready
                            </Text>
                          </>
                        )}
                      </View>
                    </View>
                    <Pressable
                      onPress={() => handleDeleteDocument(doc.id, doc.name)}
                      hitSlop={10}
                      style={{ padding: 4 }}
                    >
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
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
              style={[styles.platformRow, styles.platformRowBorder]}
              onPress={handleToggleEmailAlerts}
            >
              <View style={[styles.platformIcon, { backgroundColor: '#EA433515' }]}>
                <Ionicons name="mail-outline" size={20} color="#EA4335" />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>Email Alerts</Text>
                <Text style={styles.platformStatus}>
                  {emailAlertsEnabled ? 'Jarvis pings you for urgent emails' : 'Disabled'}
                </Text>
              </View>
              <Ionicons
                name={emailAlertsEnabled ? 'toggle' : 'toggle-outline'}
                size={32}
                color={emailAlertsEnabled ? Colors.primary : Colors.border}
              />
            </Pressable>
            <Pressable
              style={[styles.platformRow, styles.platformRowBorder]}
              onPress={() => router.push('/inbox-rules')}
            >
              <View style={[styles.platformIcon, { backgroundColor: Colors.secondary + '15' }]}>
                <Ionicons name="funnel-outline" size={20} color={Colors.secondary} />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>Inbox Rules</Text>
                <Text style={styles.platformStatus}>
                  Configure what Jarvis surfaces or suppresses
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
            </Pressable>
            <Pressable
              style={[styles.platformRow, styles.platformRowBorder]}
              onPress={() => setShowTimezoneModal(true)}
            >
              <View style={[styles.platformIcon, { backgroundColor: Colors.primary + '15' }]}>
                <Ionicons name="time-outline" size={20} color={Colors.primary} />
              </View>
              <View style={styles.platformInfo}>
                <Text style={styles.platformName}>Notification Timezone</Text>
                <Text style={styles.platformStatus}>
                  {TIMEZONES.find(t => t.value === timezone)?.label || timezone}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
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
                  {authUserEmail || (authUsername ? `Signed in as ${authUsername}` : 'Sign out of your account')}
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

      <Modal
        visible={showTimezoneModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTimezoneModal(false)}
      >
        <Pressable style={styles.tzOverlay} onPress={() => setShowTimezoneModal(false)}>
          <Pressable style={styles.tzSheet} onPress={() => {}}>
            <View style={styles.tzHandle} />
            <Text style={styles.tzTitle}>Notification Timezone</Text>
            <Text style={styles.tzSubtitle}>Morning, evening & weekly messages fire at these times</Text>
            <FlatList
              data={TIMEZONES}
              keyExtractor={item => item.value}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.tzRow, item.value === timezone && styles.tzRowSelected]}
                  onPress={() => handleTimezoneChange(item.value)}
                >
                  <Text style={[styles.tzRowLabel, item.value === timezone && styles.tzRowLabelSelected]}>
                    {item.label}
                  </Text>
                  {item.value === timezone && (
                    <Ionicons name="checkmark" size={18} color={Colors.primary} />
                  )}
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
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
  webhookStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 2,
  },
  webhookStatusText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    flex: 1,
  },
  webhookFixBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#229ED918',
  },
  webhookFixBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#229ED9',
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
  tzOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  tzSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  tzHandle: {
    width: 36,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  tzTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 4,
  },
  tzSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  tzRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tzRowSelected: {
    backgroundColor: Colors.primary + '08',
  },
  tzRowLabel: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  tzRowLabelSelected: {
    color: Colors.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  morningNoteRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  morningNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moodDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  morningNoteDate: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    minWidth: 70,
  },
  morningNoteThemes: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  morningNotePill: {
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  morningNotePillText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  morningNoteMore: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
    alignSelf: 'center',
  },
  morningNoteBody: {
    marginTop: 10,
    gap: 8,
  },
  morningNoteTranscript: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  morningNoteIntentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  morningNoteIntention: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
    fontStyle: 'italic',
  },
  morningNoteSubRow: {
    flexDirection: 'row',
    gap: 6,
  },
  morningNoteSubLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
  },
  morningNoteSubText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
});
