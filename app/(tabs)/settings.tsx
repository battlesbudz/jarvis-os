import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import Colors from '@/constants/colors';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';
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

interface BuildLogEntry {
  id: string;
  featureName: string;
  description: string;
  outputCode: string;
  success: boolean;
  smokeTestPassed: boolean | null;
  smokeTestArgs: Record<string, unknown> | null;
  createdAt: string;
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

interface McpServerInfo {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  url: string | null;
  enabled: boolean;
  isBuiltIn: boolean;
  connected: boolean;
  toolCount: number;
  error?: string;
  isSystem: boolean;
  credentialMode?: 'direct' | 'env-ref';
  envKey?: string | null;
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

function SectionErrorRow({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <View style={sectionStyles.errorRow}>
      <Ionicons name="alert-circle-outline" size={15} color={Colors.textTertiary} />
      <Text style={sectionStyles.errorText}>{message ?? "Couldn't load"}</Text>
      <Pressable onPress={onRetry} style={sectionStyles.retryBtn}>
        <Text style={sectionStyles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

type HealthStatus = 'healthy' | 'expiring_soon' | 'broken' | 'unconfigured' | string;

function StatusDot({ status }: { status: HealthStatus }) {
  if (!status || status === 'unconfigured') return null;
  const color =
    status === 'healthy' ? Colors.success :
    status === 'expiring_soon' ? '#F59E0B' :
    status === 'broken' ? Colors.error : Colors.textTertiary;
  return (
    <View style={{
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: color, marginLeft: 6, alignSelf: 'center',
    }} />
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
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  retryBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logout, username: authUsername } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { scrollTo } = useLocalSearchParams<{ scrollTo?: string }>();
  const scrollViewRef = useRef<ScrollView>(null);
  const [highlightedIntegration, setHighlightedIntegration] = useState<string | null>(null);

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
  const [integrationHealth, setIntegrationHealth] = useState<Record<string, string>>({});
  const [integrationErrors, setIntegrationErrors] = useState<Record<string, string | null>>({});
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [androidDaemonCode, setAndroidDaemonCode] = useState<string | null>(null);

  // ── Per-section error states ──
  const [connectionsError, setConnectionsError] = useState(false);
  const [modelsError, setModelsError] = useState(false);
  const [nervousSystemError, setNervousSystemError] = useState(false);
  const [healthError, setHealthError] = useState(false);

  // ── Wake Word ──
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [talkModeEnabled, setTalkModeEnabled] = useState(false);
  const [wakeWords, setWakeWords] = useState<string[]>(['hey jarvis', 'jarvis', 'computer']);
  const [newWakeWord, setNewWakeWord] = useState('');
  const [wakeSettingsSaving, setWakeSettingsSaving] = useState(false);

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

  // ── Model Preferences ──
  type ModelCategory = 'chat' | 'planning' | 'memory' | 'research';
  interface AvailableModel { value: string; label: string; description: string }
  const [modelPrefs, setModelPrefs] = useState<Record<ModelCategory, string>>({
    chat: 'gpt-5-mini', planning: 'gpt-5-mini', memory: 'gpt-5-mini', research: 'gpt-4o-mini',
  });
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [savingModel, setSavingModel] = useState<ModelCategory | null>(null);

  // ── Orchestrator ──
  const [orchestratorModel, setOrchestratorModel] = useState('claude-opus-4-7');
  const [availableOrchestratorModels, setAvailableOrchestratorModels] = useState<AvailableModel[]>([]);
  const [savingOrchestrator, setSavingOrchestrator] = useState(false);

  // ── MCP Servers ──
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpAddVisible, setMcpAddVisible] = useState(false);
  const [mcpAddTransport, setMcpAddTransport] = useState<'stdio' | 'http'>('stdio');
  const [mcpAddName, setMcpAddName] = useState('');
  const [mcpAddCommand, setMcpAddCommand] = useState('');
  const [mcpAddUrl, setMcpAddUrl] = useState('');
  const [mcpAddToken, setMcpAddToken] = useState('');
  const [mcpAddCredMode, setMcpAddCredMode] = useState<'direct' | 'env-ref'>('direct');
  const [mcpAddEnvKey, setMcpAddEnvKey] = useState('');
  const [mcpAddEnvPresent, setMcpAddEnvPresent] = useState<boolean | null>(null);
  const [mcpEnvGuideExpanded, setMcpEnvGuideExpanded] = useState(false);
  const [mcpAddError, setMcpAddError] = useState('');
  const [mcpAddSaving, setMcpAddSaving] = useState(false);

  // ── MCP Server (Jarvis as MCP server) ──
  interface McpKeyInfo { prefix: string; createdAt: string; lastUsedAt: string | null }
  const [mcpKeyInfo, setMcpKeyInfo] = useState<McpKeyInfo | null>(null);
  const [mcpKeyLoading, setMcpKeyLoading] = useState(false);
  const [mcpRawKey, setMcpRawKey] = useState<string | null>(null);
  const [mcpKeyRegenerating, setMcpKeyRegenerating] = useState(false);
  const [mcpSnippetExpanded, setMcpSnippetExpanded] = useState(false);
  const [mcpKeyCopied, setMcpKeyCopied] = useState(false);
  const [mcpUrlCopied, setMcpUrlCopied] = useState(false);

  // ── TTS (voice responses) ──
  const TTS_OPENAI_VOICES = [
    { id: 'alloy',   label: 'Alloy',   desc: 'Neutral' },
    { id: 'echo',    label: 'Echo',    desc: 'Male' },
    { id: 'fable',   label: 'Fable',   desc: 'Expressive' },
    { id: 'onyx',    label: 'Onyx',    desc: 'Deep' },
    { id: 'nova',    label: 'Nova',    desc: 'Warm female' },
    { id: 'shimmer', label: 'Shimmer', desc: 'Gentle female' },
  ] as const;
  type TtsVoiceId = typeof TTS_OPENAI_VOICES[number]['id'];
  const [ttsVoice, setTtsVoice] = useState<TtsVoiceId>('nova');
  const [ttsTelegramEnabled, setTtsTelegramEnabled] = useState(false);
  const [ttsWhatsAppEnabled, setTtsWhatsAppEnabled] = useState(false);
  const [ttsSaving, setTtsSaving] = useState(false);
  const [ttsPreviewing, setTtsPreviewing] = useState(false);

  const saveTtsSettings = useCallback(async (patch: { voice?: TtsVoiceId; ttsChannels?: string[] }) => {
    setTtsSaving(true);
    try {
      await apiRequest('PATCH', '/api/settings/tts', patch);
    } catch {}
    setTtsSaving(false);
  }, []);

  const toggleTtsTelegram = useCallback(async (value: boolean) => {
    setTtsTelegramEnabled(value);
    const channels: string[] = [];
    if (value) channels.push('telegram');
    if (ttsWhatsAppEnabled) channels.push('whatsapp');
    await saveTtsSettings({ ttsChannels: channels });
  }, [ttsWhatsAppEnabled, saveTtsSettings]);

  const toggleTtsWhatsApp = useCallback(async (value: boolean) => {
    setTtsWhatsAppEnabled(value);
    const channels: string[] = [];
    if (ttsTelegramEnabled) channels.push('telegram');
    if (value) channels.push('whatsapp');
    await saveTtsSettings({ ttsChannels: channels });
  }, [ttsTelegramEnabled, saveTtsSettings]);

  const changeTtsVoice = useCallback(async (voice: TtsVoiceId) => {
    setTtsVoice(voice);
    await saveTtsSettings({ voice });
  }, [saveTtsSettings]);

  const previewTtsVoice = useCallback(async () => {
    setTtsPreviewing(true);
    try {
      const res = await apiRequest('POST', '/api/coach/speak', {
        text: "Hi, I'm Jarvis. This is what I sound like with this voice.",
        voice: ttsVoice,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.audio) {
          const { Sound } = Audio;
          const { sound } = await Sound.createAsync(
            { uri: `data:audio/mp3;base64,${data.audio}` },
            { shouldPlay: true },
          );
          sound.setOnPlaybackStatusUpdate((status) => {
            if ('didJustFinish' in status && status.didJustFinish) {
              sound.unloadAsync().catch(() => {});
            }
          });
        }
      }
    } catch {}
    setTtsPreviewing(false);
  }, [ttsVoice]);

  // ── Build History ──
  const [buildHistory, setBuildHistory] = useState<BuildLogEntry[]>([]);
  const [buildHistoryExpanded, setBuildHistoryExpanded] = useState(false);
  const [expandedBuildId, setExpandedBuildId] = useState<string | null>(null);

  const loadBuildHistory = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/jarvis/builds');
      const data = await res.json();
      setBuildHistory(data.builds ?? []);
    } catch {}
  }, []);

  // ── Doctor Scan ──
  type DoctorStatus = 'pass' | 'warn' | 'fail';
  interface DoctorResult {
    id: string;
    label: string;
    status: DoctorStatus;
    message: string;
    settingsPath?: string;
  }
  interface DoctorReport {
    results: DoctorResult[];
    ranAt: string;
    summary: { pass: number; warn: number; fail: number };
    cached?: boolean;
  }
  const [doctorReport, setDoctorReport] = useState<DoctorReport | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);

  const runDoctor = useCallback(async () => {
    setDoctorLoading(true);
    try {
      const res = await apiRequest('GET', '/api/doctor');
      if (res.status === 202) {
        // Scan already in progress — leave previous report visible and
        // stop the loading spinner; the user can retry momentarily.
      } else if (res.ok) {
        const data = await res.json();
        // Guard against malformed responses before touching state.
        if (data && Array.isArray(data.results) && data.summary && data.ranAt) {
          setDoctorReport(data);
        }
      }
    } catch {}
    setDoctorLoading(false);
  }, []);

  // ── Jarvis Health ──
  interface SubsystemStatus {
    name: string;
    label: string;
    status: 'healthy' | 'degraded' | 'down' | 'unknown';
    errorCount15m: number;
    lastEvent?: string;
  }
  interface DiagEventEntry {
    id: string;
    subsystem: string;
    severity: string;
    message: string;
    createdAt: string;
  }
  interface HealthReport {
    overallStatus: 'healthy' | 'degraded' | 'down';
    subsystems: SubsystemStatus[];
    openAiReachable: boolean;
    openAiLatencyMs: number | null;
    dbReachable: boolean;
    jobQueueDepth: number;
    staleJobCount: number;
    stuckWorkflowCount: number;
    channelStatuses: Record<string, { configured: boolean; linked?: boolean }>;
    recentErrors: DiagEventEntry[];
    generatedAt: string;
  }
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [diagnosisText, setDiagnosisText] = useState<string | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(false);
    try {
      const res = await apiRequest('GET', '/api/diagnostics/health');
      if (res.ok) {
        const data = await res.json();
        // Validate the response has the expected shape before accepting it
        if (data && typeof data === 'object' && 'overallStatus' in data) {
          data.subsystems = Array.isArray(data.subsystems) ? data.subsystems : [];
          data.recentErrors = Array.isArray(data.recentErrors) ? data.recentErrors : [];
          setHealthReport(data);
          setHealthError(false);
        } else {
          setHealthReport(null);
          setHealthError(true);
        }
      } else {
        setHealthReport(null);
        setHealthError(true);
      }
    } catch {
      setHealthReport(null);
      setHealthError(true);
    }
    setHealthLoading(false);
  }, []);

  const runDiagnosis = useCallback(async () => {
    setDiagnosisLoading(true);
    setDiagnosisText(null);
    try {
      const res = await apiRequest('POST', '/api/diagnostics/run');
      if (res.ok) {
        const data = await res.json();
        setDiagnosisText(data.diagnosis ?? null);
      }
    } catch (e) {
      setDiagnosisText('Failed to run diagnosis. Please try again.');
    }
    setDiagnosisLoading(false);
  }, []);

  const saveModel = useCallback(async (category: ModelCategory, model: string) => {
    setSavingModel(category);
    try {
      await apiRequest('PATCH', '/api/settings/models', { category, model });
      setModelPrefs(prev => ({ ...prev, [category]: model }));
    } catch {}
    setSavingModel(null);
  }, []);

  const saveOrchestratorModel = useCallback(async (model: string) => {
    setSavingOrchestrator(true);
    try {
      await apiRequest('PATCH', '/api/settings/orchestrator', { model });
      setOrchestratorModel(model);
    } catch {}
    setSavingOrchestrator(false);
  }, []);

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
    const [watchResult, signalResult] = await Promise.allSettled([
      apiRequest('GET', '/api/nervous-system/watches').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      apiRequest('GET', '/api/nervous-system/signals?limit=5').then(r => r.ok ? r.json() : Promise.reject(r.status)),
    ]);

    const watchRes = watchResult.status === 'fulfilled' ? watchResult.value : null;
    const signalRes = signalResult.status === 'fulfilled' ? signalResult.value : null;

    // Show error when any nervous system call fails.
    setNervousSystemError(watchResult.status === 'rejected' || signalResult.status === 'rejected');

    if (watchRes !== null) setWatches(Array.isArray(watchRes) ? watchRes : []);
    if (signalRes !== null) setRecentSignals(Array.isArray(signalRes) ? signalRes : []);
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

  // ── Load connections (OAuth, Telegram, Discord, integrations) ──
  const loadConnections = useCallback(async () => {
    setLoadingStatus(true);
    // Each call is independent — a failure on one doesn't block others.
    // We track per-call results to detect when required data is unavailable.
    const [oauthResult, telegramResult, discordResult, integrationResult] = await Promise.allSettled([
      apiRequest('GET', '/api/oauth/status').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      apiRequest('GET', '/api/telegram/status').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      apiRequest('GET', '/api/discord/status').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      apiRequest('GET', '/api/integrations/status').then(r => r.ok ? r.json() : Promise.reject(r.status)),
    ]);

    const oauthRes = oauthResult.status === 'fulfilled' ? oauthResult.value : null;
    const telegramRes = telegramResult.status === 'fulfilled' ? telegramResult.value : null;
    const discordRes = discordResult.status === 'fulfilled' ? discordResult.value : null;
    const integrationRes = integrationResult.status === 'fulfilled' ? integrationResult.value : null;

    // Show error row when any connections endpoint fails.
    const anyConnectionFailed = [oauthResult, telegramResult, discordResult, integrationResult]
      .some(r => r.status === 'rejected');
    setConnectionsError(anyConnectionFailed);

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
    if (integrationRes && typeof integrationRes === 'object') {
      const health: Record<string, string> = {};
      const errors: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(integrationRes)) {
        const entry = v as { status?: string; errorMessage?: string | null } | null;
        health[k] = entry?.status ?? 'unconfigured';
        errors[k] = entry?.errorMessage ?? null;
      }
      setIntegrationHealth(health);
      setIntegrationErrors(errors);
    }
    setLoadingStatus(false);
  }, []);

  // ── Load AI model preferences ──
  const loadModels = useCallback(async () => {
    const [modelResult, orchResult] = await Promise.allSettled([
      apiRequest('GET', '/api/settings/models').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      apiRequest('GET', '/api/settings/orchestrator').then(r => r.ok ? r.json() : Promise.reject(r.status)),
    ]);

    const modelRes = modelResult.status === 'fulfilled' ? modelResult.value : null;
    const orchRes = orchResult.status === 'fulfilled' ? orchResult.value : null;

    // Show error row when either model preferences or orchestrator settings failed.
    setModelsError(modelResult.status === 'rejected' || orchResult.status === 'rejected');

    if (modelRes?.modelPreferences) setModelPrefs(modelRes.modelPreferences);
    if (modelRes?.availableModels) setAvailableModels(modelRes.availableModels);
    if (orchRes) {
      setOrchestratorModel(orchRes.orchestratorModel ?? 'claude-opus-4-7');
      setAvailableOrchestratorModels(orchRes.availableOrchestratorModels ?? []);
    }
  }, []);

  // ── MCP servers ──
  const loadMcpServers = useCallback(async () => {
    setMcpLoading(true);
    try {
      const res = await apiRequest('GET', '/api/mcp-servers');
      if (res.ok) {
        const data = await res.json();
        setMcpServers(data.servers ?? []);
      }
    } catch { /* non-fatal */ } finally {
      setMcpLoading(false);
    }
  }, []);

  const handleMcpDelete = useCallback(async (id: string) => {
    try {
      await apiRequest('DELETE', `/api/mcp-servers/${id}`);
      setMcpServers(prev => prev.filter(s => s.id !== id));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      Alert.alert('Error', 'Could not delete server');
    }
  }, []);

  const handleMcpAdd = useCallback(async () => {
    setMcpAddError('');
    if (!mcpAddName.trim()) { setMcpAddError('Name is required'); return; }
    if (mcpAddTransport === 'stdio' && !mcpAddCommand.trim()) { setMcpAddError('Command is required for stdio'); return; }
    if (mcpAddTransport === 'http' && !mcpAddUrl.trim()) { setMcpAddError('URL is required for HTTP'); return; }
    if (mcpAddTransport === 'http' && mcpAddCredMode === 'env-ref' && !mcpAddEnvKey.trim()) {
      setMcpAddError('Env var name is required when using env-ref mode'); return;
    }
    setMcpAddSaving(true);
    try {
      const res = await apiRequest('POST', '/api/mcp-servers', {
        name: mcpAddName.trim(),
        transport: mcpAddTransport,
        command: mcpAddTransport === 'stdio' ? mcpAddCommand.trim() : undefined,
        url: mcpAddTransport === 'http' ? mcpAddUrl.trim() : undefined,
        authToken: mcpAddTransport === 'http' && mcpAddCredMode === 'direct' ? (mcpAddToken.trim() || undefined) : undefined,
        credentialMode: mcpAddTransport === 'http' ? mcpAddCredMode : 'direct',
        envKey: mcpAddTransport === 'http' && mcpAddCredMode === 'env-ref' ? mcpAddEnvKey.trim() : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMcpAddError(err.error ?? 'Failed to add server');
      } else {
        setMcpAddVisible(false);
        setMcpAddName(''); setMcpAddCommand(''); setMcpAddUrl(''); setMcpAddToken('');
        setMcpAddCredMode('direct'); setMcpAddEnvKey(''); setMcpAddEnvPresent(null);
        await loadMcpServers();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (err) {
      setMcpAddError('Network error');
    } finally {
      setMcpAddSaving(false);
    }
  }, [mcpAddName, mcpAddTransport, mcpAddCommand, mcpAddUrl, mcpAddToken, mcpAddCredMode, mcpAddEnvKey, loadMcpServers]);

  const checkEnvVar = useCallback(async (key: string) => {
    if (!key.trim()) { setMcpAddEnvPresent(null); return; }
    try {
      const res = await apiRequest('GET', `/api/settings/env-var-check?key=${encodeURIComponent(key.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setMcpAddEnvPresent(data.present === true);
      }
    } catch {
      setMcpAddEnvPresent(null);
    }
  }, []);

  // ── MCP Server key management ──
  const loadMcpServerKey = useCallback(async () => {
    setMcpKeyLoading(true);
    try {
      const res = await apiRequest('GET', '/api/mcp-key');
      if (res.ok) {
        const data = await res.json();
        setMcpKeyInfo(data.hasKey ? data : null);
      }
    } catch { /* non-fatal */ } finally {
      setMcpKeyLoading(false);
    }
  }, []);

  const handleMcpRegenerateKey = useCallback(async () => {
    Alert.alert(
      'Regenerate API Key',
      'This will revoke your current key. Any connected MCP clients will stop working until updated. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            setMcpKeyRegenerating(true);
            try {
              const res = await apiRequest('POST', '/api/mcp-key/generate');
              if (res.ok) {
                const data = await res.json();
                setMcpRawKey(data.rawKey);
                await loadMcpServerKey();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            } catch { /* non-fatal */ } finally {
              setMcpKeyRegenerating(false);
            }
          },
        },
      ]
    );
  }, [loadMcpServerKey]);

  const getMcpServerUrl = useCallback((): string => {
    try {
      const { getApiUrl } = require('@/lib/query-client');
      const base = getApiUrl();
      return `${base.replace(/\/$/, '')}/api/mcp`;
    } catch {
      return `https://<your-domain>/api/mcp`;
    }
  }, []);

  // ── Load everything ──
  const loadAll = useCallback(async () => {
    await loadConnections();

    try {
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
    } catch {}
    try {
      const prefsRes = await apiRequest('GET', '/api/data/user-preferences').then(r => r.json()).catch(() => null);
      if (prefsRes?.data?.timezone) setTimezone(prefsRes.data.timezone);
    } catch {}
    try {
      const wakeRes = await apiRequest('GET', '/api/voice/wake-settings').then(r => r.json()).catch(() => null);
      if (wakeRes) {
        setWakeWordEnabled(wakeRes.wakeWordEnabled ?? false);
        setTalkModeEnabled(wakeRes.talkModeEnabled ?? false);
        setWakeWords(wakeRes.wakeWords ?? ['hey jarvis', 'jarvis', 'computer']);
      }
    } catch {}
    try {
      const ttsRes = await apiRequest('GET', '/api/settings/tts').then(r => r.json()).catch(() => null);
      if (ttsRes) {
        if (ttsRes.voice && ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(ttsRes.voice)) {
          setTtsVoice(ttsRes.voice as TtsVoiceId);
        }
        const channels: string[] = Array.isArray(ttsRes.ttsChannels) ? ttsRes.ttsChannels : [];
        setTtsTelegramEnabled(channels.includes('telegram'));
        setTtsWhatsAppEnabled(channels.includes('whatsapp'));
      }
    } catch {}
    await loadModels();
  }, [loadConnections, loadModels]);

  useFocusEffect(useCallback(() => {
    loadAll();
    loadNervousSystem();
    loadThreatLog();
    loadBuildHistory();
    loadHealth();
    loadMcpServers();
    loadMcpServerKey();
    return () => {
      if (telegramPollRef.current) {
        clearInterval(telegramPollRef.current);
        telegramPollRef.current = null;
      }
    };
  }, [loadAll, loadNervousSystem, loadThreatLog, loadBuildHistory, loadHealth, loadMcpServers, loadMcpServerKey]));

  useEffect(() => {
    return () => {
      if (telegramPollRef.current) {
        clearInterval(telegramPollRef.current);
        telegramPollRef.current = null;
      }
    };
  }, []);

  // Scroll to the CONNECTIONS section and highlight the integration when
  // the screen is opened with a `scrollTo` route param (e.g. from the
  // IntegrationErrorCard "Go to Settings → Connections" CTA).
  useEffect(() => {
    if (!scrollTo) return;
    setHighlightedIntegration(scrollTo);
    // CONNECTIONS is the first section, so scroll to top to reveal it.
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 400);
    // Clear the highlight after 3 s so it fades without user action.
    const clearTimer = setTimeout(() => setHighlightedIntegration(null), 3400);
    return () => {
      clearTimeout(timer);
      clearTimeout(clearTimer);
    };
  }, [scrollTo]);

  // ── Helpers ──
  // Triggers an immediate server-side re-validation for the current user so
  // the DB integration_status rows are fresh before loadAll() re-reads them.
  const refreshIntegrationHealth = useCallback(async () => {
    try {
      await apiRequest('POST', '/api/integrations/refresh');
    } catch {}
  }, []);

  // ── OAuth connect ──
  const handleConnect = useCallback(async (platform: string) => {
    setConnectingId(platform);
    try {
      const url = new URL(`/api/oauth/${platform}/connect`, getApiUrl()).toString();
      await WebBrowser.openAuthSessionAsync(url, getApiUrl().toString());
      await refreshIntegrationHealth();
      await loadAll();
    } catch {}
    setConnectingId(null);
  }, [loadAll, refreshIntegrationHealth]);

  const handleDisconnect = useCallback(async (platform: string) => {
    Alert.alert('Disconnect', `Disconnect ${platform}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          try {
            await apiRequest('DELETE', `/api/oauth/disconnect/${platform}`);
            await refreshIntegrationHealth();
            await loadAll();
          } catch {}
        },
      },
    ]);
  }, [loadAll, refreshIntegrationHealth]);

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
              // Refresh validator so health badge updates immediately after link
              await refreshIntegrationHealth();
              const healthRes = await apiRequest('GET', '/api/integrations/status').then(r => r.json()).catch(() => null);
              if (healthRes && typeof healthRes === 'object') {
                const health: Record<string, string> = {};
                const errors: Record<string, string | null> = {};
                for (const [k, v] of Object.entries(healthRes)) {
                  const entry = v as { status?: string; errorMessage?: string | null } | null;
                  health[k] = entry?.status ?? 'unconfigured';
                  errors[k] = entry?.errorMessage ?? null;
                }
                setIntegrationHealth(health);
                setIntegrationErrors(errors);
              }
            }
          } catch {}
        }, 5000);
      }
    } catch {}
  }, [refreshIntegrationHealth]);

  const handleTelegramDisconnect = useCallback(async () => {
    Alert.alert('Disconnect Telegram', 'Disconnect Telegram?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          try {
            await apiRequest('DELETE', '/api/telegram/disconnect');
            await refreshIntegrationHealth();
            setTelegramStatus({ connected: false, username: null, configured: false });
            setIntegrationHealth(prev => ({ ...prev, telegram: 'unconfigured' }));
            setIntegrationErrors(prev => ({ ...prev, telegram: null }));
          } catch {}
        },
      },
    ]);
  }, [refreshIntegrationHealth]);

  // ── Android Daemon ──
  const handleAndroidDaemon = useCallback(async () => {
    if (androidDaemonCode) { setAndroidDaemonCode(null); return; }
    try {
      const res = await apiRequest('POST', '/api/daemon/link-code');
      const data = await res.json();
      setAndroidDaemonCode(data.code ?? null);
    } catch {}
  }, [androidDaemonCode]);

  const saveWakeSettings = useCallback(async (
    updates: { wakeWordEnabled?: boolean; talkModeEnabled?: boolean; wakeWords?: string[] }
  ) => {
    setWakeSettingsSaving(true);
    try {
      await apiRequest('PUT', '/api/voice/wake-settings', updates);
    } catch {}
    setWakeSettingsSaving(false);
  }, []);

  const toggleWakeWord = useCallback(async (val: boolean) => {
    if (val && Platform.OS !== 'web') {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Microphone Required',
          'Wake Word detection needs microphone access. Please allow microphone access in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }
    }
    setWakeWordEnabled(val);
    await saveWakeSettings({ wakeWordEnabled: val });
  }, [saveWakeSettings]);

  const toggleTalkMode = useCallback(async (val: boolean) => {
    if (val && Platform.OS !== 'web') {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Microphone Required',
          'Talk Mode needs microphone access to listen for your voice. Please allow microphone access in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }
    }
    setTalkModeEnabled(val);
    await saveWakeSettings({ talkModeEnabled: val });
  }, [saveWakeSettings]);

  const addWakeWord = useCallback(async () => {
    const phrase = newWakeWord.trim().toLowerCase();
    if (!phrase || wakeWords.includes(phrase)) { setNewWakeWord(''); return; }
    const next = [...wakeWords, phrase];
    setWakeWords(next);
    setNewWakeWord('');
    await saveWakeSettings({ wakeWords: next });
  }, [newWakeWord, wakeWords, saveWakeSettings]);

  const removeWakeWord = useCallback(async (phrase: string) => {
    const next = wakeWords.filter(w => w !== phrase);
    setWakeWords(next);
    await saveWakeSettings({ wakeWords: next });
  }, [wakeWords, saveWakeSettings]);

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
        // Refresh validator so health badge updates immediately after link
        await refreshIntegrationHealth();
        const healthRes = await apiRequest('GET', '/api/integrations/status').then(r => r.json()).catch(() => null);
        if (healthRes && typeof healthRes === 'object') {
          const health: Record<string, string> = {};
          const errors: Record<string, string | null> = {};
          for (const [k, v] of Object.entries(healthRes)) {
            const entry = v as { status?: string; errorMessage?: string | null } | null;
            health[k] = entry?.status ?? 'unconfigured';
            errors[k] = entry?.errorMessage ?? null;
          }
          setIntegrationHealth(health);
          setIntegrationErrors(errors);
        }
      } else {
        Alert.alert('Pairing Failed', data.error ?? 'Could not link Discord. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not connect. Check your network and try again.');
    }
    setDiscordLinking(false);
  }, [discordPairCode, refreshIntegrationHealth]);

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
  // Maps OAuth platform id → integration_status table key
  const PLATFORM_HEALTH_KEY: Record<string, string> = {
    google: 'google',
    microsoft: 'outlook',
    slack: 'slack',
  };

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SETTINGS</Text>
        <Text style={styles.headerUser}>{userName || authUsername || 'Agent'}</Text>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── CONNECTIONS ── */}
        <SectionHeader label="CONNECTIONS" accent={Colors.cyan} />

        <View style={styles.card}>
          {connectionsError && (
            <SectionErrorRow message="Couldn't load connections" onRetry={loadConnections} />
          )}
          {/* OAuth platforms */}
          {PLATFORMS.map((p, idx) => {
            const status = oauthStatus[p.id as keyof OAuthStatus];
            const isConnecting = connectingId === p.id;
            const healthKey = PLATFORM_HEALTH_KEY[p.id];
            const health = healthKey ? integrationHealth[healthKey] : undefined;
            const isBroken = health === 'broken';
            const isExpiring = health === 'expiring_soon';
            const isHighlighted = healthKey ? highlightedIntegration === healthKey : false;
            return (
              <View key={p.id} style={[styles.connRow, idx > 0 && styles.connRowBorder, isHighlighted && { backgroundColor: '#FEF3C7' }]}>
                <View style={[styles.connIconWrap, { backgroundColor: p.color + '20' }]}>
                  <Ionicons name={p.icon} size={18} color={p.color} />
                </View>
                <View style={styles.connInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.connName}>{p.name}</Text>
                    {health && <StatusDot status={health} />}
                  </View>
                  <Text style={[styles.connSub, isBroken && { color: Colors.error }]}>
                    {isBroken
                      ? 'Connection broken — tap Reconnect'
                      : isExpiring
                        ? 'Token expiring soon'
                        : status.connected
                          ? (status.accounts?.[0]?.email ?? status.email ?? 'Connected')
                          : p.subtitle}
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.connBtn,
                    isBroken
                      ? { backgroundColor: Colors.error + '20', borderColor: Colors.error }
                      : status.connected ? styles.connBtnConnected : styles.connBtnDisconnected,
                  ]}
                  onPress={() => (isBroken || isExpiring || !status.connected) ? handleConnect(p.id) : handleDisconnect(p.id)}
                  disabled={isConnecting || loadingStatus}
                >
                  {isConnecting ? (
                    <ActivityIndicator size="small" color={Colors.cyan} />
                  ) : (
                    <Text style={[
                      styles.connBtnText,
                      isBroken ? { color: Colors.error } : status.connected && styles.connBtnTextConnected,
                    ]}>
                      {isBroken ? 'Reconnect' : isExpiring ? 'Renew' : status.connected ? 'Connected' : 'Connect'}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          })}

          {/* Telegram */}
          {(() => {
            const telegramBroken = integrationHealth['telegram'] === 'broken';
            const telegramErrMsg = integrationErrors['telegram'];
            return (
              <View style={[styles.connRow, styles.connRowBorder, highlightedIntegration === 'telegram' && { backgroundColor: '#FEF3C7' }]}>
                <View style={[styles.connIconWrap, { backgroundColor: '#0088CC20' }]}>
                  <Ionicons name="paper-plane-outline" size={18} color="#0088CC" />
                </View>
                <View style={styles.connInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.connName}>Telegram</Text>
                    <StatusDot status={integrationHealth['telegram']} />
                  </View>
                  <Text style={[styles.connSub, telegramBroken && { color: Colors.error }]}>
                    {telegramBroken
                      ? (telegramErrMsg ?? 'Connection error — tap to reconnect')
                      : telegramStatus.connected
                        ? (telegramStatus.username ? `@${telegramStatus.username}` : 'Connected')
                        : 'Chat with Jarvis via Telegram'}
                  </Text>
                </View>
                <Pressable
                  style={[styles.connBtn, (telegramBroken || !telegramStatus.connected) ? styles.connBtnDisconnected : styles.connBtnConnected,
                    telegramBroken && { borderColor: Colors.error }]}
                  onPress={telegramStatus.connected && !telegramBroken ? handleTelegramDisconnect : handleTelegramLink}
                >
                  <Text style={[styles.connBtnText, telegramBroken && { color: Colors.error },
                    !telegramBroken && telegramStatus.connected && styles.connBtnTextConnected]}>
                    {telegramBroken ? 'Reconnect' : telegramStatus.connected ? 'Connected' : telegramLinkCode ? '...' : 'Connect'}
                  </Text>
                </Pressable>
              </View>
            );
          })()}

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
          {(() => {
            const discordBroken = integrationHealth['discord'] === 'broken';
            const discordErrMsg = integrationErrors['discord'];
            return (
              <Pressable
                style={[styles.connRow, styles.connRowBorder, highlightedIntegration === 'discord' && { backgroundColor: '#FEF3C7' }]}
                onPress={() => {
                  if (discordBroken || !discordConnected) setDiscordPairExpanded(v => !v);
                }}
              >
                <View style={[styles.connIconWrap, { backgroundColor: '#5865F220' }]}>
                  <Ionicons name="logo-discord" size={18} color="#5865F2" />
                </View>
                <View style={styles.connInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.connName}>Discord</Text>
                    <StatusDot status={integrationHealth['discord']} />
                  </View>
                  <Text style={[styles.connSub, discordBroken && { color: Colors.error }]}>
                    {discordBroken
                      ? (discordErrMsg ?? 'Connection error — tap to reconnect')
                      : discordConnected
                        ? (discordUsername ? `@${discordUsername}` : 'Connected')
                        : 'Tap to link your Discord account'}
                  </Text>
                </View>
                <View style={[styles.connBtn, (discordBroken || !discordConnected) ? styles.connBtnDisconnected : styles.connBtnConnected,
                  discordBroken && { borderColor: Colors.error }]}>
                  <Text style={[styles.connBtnText, discordBroken && { color: Colors.error },
                    !discordBroken && discordConnected && styles.connBtnTextConnected]}>
                    {discordBroken ? 'Reconnect' : discordConnected ? 'Connected' : 'Connect'}
                  </Text>
                </View>
              </Pressable>
            );
          })()}
          {discordPairExpanded && (!discordConnected || integrationHealth['discord'] === 'broken') && (
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

        {/* ── CONNECTED TOOLS (MCP) ── */}
        <SectionHeader label="CONNECTED TOOLS" accent="#10B981" />
        <View style={styles.card}>
          {mcpLoading && mcpServers.length === 0 ? (
            <ActivityIndicator size="small" color="#10B981" style={{ padding: 16 }} />
          ) : mcpServers.length === 0 ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <Ionicons name="extension-puzzle-outline" size={28} color={Colors.textMuted} style={{ marginBottom: 8 }} />
              <Text style={[styles.connSub, { textAlign: 'center' }]}>
                No MCP servers connected.{'\n'}Add a server to extend Jarvis with new tools.
              </Text>
            </View>
          ) : (
            mcpServers.map((server, idx) => (
              <View key={server.id} style={[styles.connRow, idx < mcpServers.length - 1 && { borderBottomWidth: 1, borderBottomColor: Colors.border }]}>
                <View style={[styles.connIconWrap, { backgroundColor: server.connected ? '#052e16' : '#1a1a1a' }]}>
                  <Ionicons
                    name={server.transport === 'http' ? 'cloud-outline' : 'terminal-outline'}
                    size={18}
                    color={server.connected ? '#10B981' : Colors.textMuted}
                  />
                </View>
                <View style={styles.connInfo}>
                  <Text style={styles.connName}>{server.name}</Text>
                  <Text style={styles.connSub}>
                    {server.connected
                      ? `${server.toolCount} tool${server.toolCount !== 1 ? 's' : ''} available`
                      : server.error
                        ? `Error: ${server.error.slice(0, 60)}`
                        : 'Disconnected'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                    {server.isSystem && (
                      <Text style={[styles.connSub, { color: '#10B981', fontSize: 10 }]}>System</Text>
                    )}
                    {server.credentialMode === 'env-ref' && server.envKey && (
                      <Text style={{ fontSize: 10, color: server.error ? Colors.error : '#8B5CF6', fontFamily: 'Inter_500Medium' }}>
                        {`ENV: ${server.envKey}`}
                      </Text>
                    )}
                  </View>
                </View>
                {!server.isBuiltIn && !server.isSystem && (
                  <Pressable
                    onPress={() => {
                      Alert.alert('Remove Server', `Remove "${server.name}"?`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: () => handleMcpDelete(server.id) },
                      ]);
                    }}
                    style={{ padding: 8 }}
                  >
                    <Ionicons name="trash-outline" size={18} color={Colors.error} />
                  </Pressable>
                )}
              </View>
            ))
          )}

          {/* Add Server button */}
          <Pressable
            style={[styles.connRow, { justifyContent: 'center', borderTopWidth: mcpServers.length > 0 ? 1 : 0, borderTopColor: Colors.border }]}
            onPress={() => setMcpAddVisible(true)}
          >
            <Ionicons name="add-circle-outline" size={18} color="#10B981" style={{ marginRight: 8 }} />
            <Text style={{ color: '#10B981', fontSize: 14, fontWeight: '600' }}>Add MCP Server</Text>
          </Pressable>
        </View>

        {/* ── MCP Add Modal ── */}
        {mcpAddVisible && (
          <View style={[styles.card, { borderColor: '#10B981', borderWidth: 1 }]}>
            <Text style={[styles.connName, { marginBottom: 12, color: '#10B981' }]}>Add MCP Server</Text>

            {/* Transport selector */}
            <View style={{ flexDirection: 'row', marginBottom: 12, gap: 8 }}>
              {(['stdio', 'http'] as const).map(t => (
                <Pressable
                  key={t}
                  onPress={() => setMcpAddTransport(t)}
                  style={{
                    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                    backgroundColor: mcpAddTransport === t ? '#10B981' : Colors.surface,
                    borderWidth: 1, borderColor: mcpAddTransport === t ? '#10B981' : Colors.border,
                  }}
                >
                  <Text style={{ color: mcpAddTransport === t ? '#000' : Colors.text, fontWeight: '600', fontSize: 12 }}>
                    {t.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={{
                backgroundColor: Colors.surface, color: Colors.text, borderRadius: 8,
                padding: 12, fontSize: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 10,
              }}
              placeholder="Name (e.g. Filesystem)"
              placeholderTextColor={Colors.textMuted}
              value={mcpAddName}
              onChangeText={setMcpAddName}
            />

            {mcpAddTransport === 'stdio' ? (
              <TextInput
                style={[{
                  backgroundColor: Colors.surface, color: Colors.text, borderRadius: 8,
                  padding: 12, fontSize: 13, borderWidth: 1, borderColor: Colors.border, marginBottom: 10,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                }]}
                placeholder="Command (e.g. node /path/to/server.js)"
                placeholderTextColor={Colors.textMuted}
                value={mcpAddCommand}
                onChangeText={setMcpAddCommand}
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : (
              <>
                <TextInput
                  style={{
                    backgroundColor: Colors.surface, color: Colors.text, borderRadius: 8,
                    padding: 12, fontSize: 13, borderWidth: 1, borderColor: Colors.border, marginBottom: 10,
                  }}
                  placeholder="URL (https://...)"
                  placeholderTextColor={Colors.textMuted}
                  value={mcpAddUrl}
                  onChangeText={setMcpAddUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />

                {/* Credential mode toggle */}
                <View style={{ marginBottom: 8 }}>
                  <Text style={{ color: Colors.textTertiary, fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 6, letterSpacing: 0.5 }}>
                    AUTH TOKEN MODE
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {(['direct', 'env-ref'] as const).map(m => (
                      <Pressable
                        key={m}
                        onPress={() => { setMcpAddCredMode(m); setMcpAddEnvPresent(null); }}
                        style={{
                          flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center',
                          backgroundColor: mcpAddCredMode === m ? '#10B981' : Colors.surface,
                          borderWidth: 1, borderColor: mcpAddCredMode === m ? '#10B981' : Colors.border,
                        }}
                      >
                        <Text style={{ color: mcpAddCredMode === m ? '#000' : Colors.text, fontWeight: '600', fontSize: 12 }}>
                          {m === 'direct' ? 'Direct' : 'Env Ref'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {mcpAddCredMode === 'direct' ? (
                  <TextInput
                    style={{
                      backgroundColor: Colors.surface, color: Colors.text, borderRadius: 8,
                      padding: 12, fontSize: 13, borderWidth: 1, borderColor: Colors.border, marginBottom: 10,
                    }}
                    placeholder="Auth token (optional)"
                    placeholderTextColor={Colors.textMuted}
                    value={mcpAddToken}
                    onChangeText={setMcpAddToken}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                      <TextInput
                        style={{
                          flex: 1, backgroundColor: Colors.surface, color: Colors.text, borderRadius: 8,
                          padding: 12, fontSize: 13, borderWidth: 1,
                          borderColor: mcpAddEnvPresent === true ? '#10B981' : mcpAddEnvPresent === false ? Colors.error : Colors.border,
                          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                        }}
                        placeholder="ENV_VAR_NAME"
                        placeholderTextColor={Colors.textMuted}
                        value={mcpAddEnvKey}
                        onChangeText={(v) => {
                          const normalized = v.toUpperCase().replace(/[^A-Z0-9_]/g, '');
                          setMcpAddEnvKey(normalized);
                          setMcpAddEnvPresent(null);
                        }}
                        onBlur={() => checkEnvVar(mcpAddEnvKey)}
                        autoCapitalize="characters"
                        autoCorrect={false}
                      />
                      {mcpAddEnvPresent === true && <Ionicons name="checkmark-circle" size={22} color="#10B981" />}
                      {mcpAddEnvPresent === false && <Ionicons name="close-circle" size={22} color={Colors.error} />}
                    </View>
                    {mcpAddEnvPresent === false && (
                      <Text style={{ color: Colors.error, fontSize: 11, marginBottom: 8, marginTop: -4 }}>
                        Variable not found — add it to Replit Secrets first.
                      </Text>
                    )}
                    {mcpAddEnvPresent === true && (
                      <Text style={{ color: '#10B981', fontSize: 11, marginBottom: 8, marginTop: -4 }}>
                        Variable found in environment.
                      </Text>
                    )}

                    {/* How to set env vars guide */}
                    <Pressable
                      onPress={() => setMcpEnvGuideExpanded(v => !v)}
                      style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 4 }}
                    >
                      <Ionicons name={mcpEnvGuideExpanded ? 'chevron-down' : 'chevron-forward'} size={14} color={Colors.textTertiary} />
                      <Text style={{ fontSize: 12, color: Colors.textTertiary, fontFamily: 'Inter_500Medium' }}>
                        How to add an env var
                      </Text>
                    </Pressable>
                    {mcpEnvGuideExpanded && (
                      <View style={{ backgroundColor: Colors.surface, borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: Colors.border }}>
                        <Text style={{ color: Colors.text, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 }}>
                          {`1. Open your Replit project.\n2. Click the padlock icon (Secrets) in the left sidebar.\n3. Add a new secret with your chosen name (e.g. MY_API_TOKEN) and paste the value.\n4. The variable will be available in this dropdown immediately — no restart needed.\n\nUsing Secrets keeps raw keys out of your database and lets you rotate them without changing the app.`}
                        </Text>
                      </View>
                    )}
                  </>
                )}
              </>
            )}

            {!!mcpAddError && (
              <Text style={{ color: Colors.error, fontSize: 12, marginBottom: 10 }}>{mcpAddError}</Text>
            )}

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => { setMcpAddVisible(false); setMcpAddError(''); }}
                style={{ flex: 1, padding: 12, borderRadius: 8, backgroundColor: Colors.surface, alignItems: 'center', borderWidth: 1, borderColor: Colors.border }}
              >
                <Text style={{ color: Colors.text, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleMcpAdd}
                disabled={mcpAddSaving}
                style={{ flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#10B981', alignItems: 'center' }}
              >
                {mcpAddSaving
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={{ color: '#000', fontWeight: '700' }}>Connect</Text>
                }
              </Pressable>
            </View>
          </View>
        )}

        {/* ── MCP SERVER (Jarvis as MCP server) ── */}
        <SectionHeader label="MCP SERVER" accent="#8B5CF6" />
        <View style={styles.card}>
          {/* Server URL row */}
          <View style={[styles.connRow, { paddingVertical: 12 }]}>
            <View style={[styles.connIconWrap, { backgroundColor: '#2D1B69' }]}>
              <Ionicons name="server-outline" size={18} color="#8B5CF6" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Server URL</Text>
              <Text style={[styles.connSub, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10 }]} numberOfLines={1}>
                {getMcpServerUrl()}
              </Text>
            </View>
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(getMcpServerUrl());
                setMcpUrlCopied(true);
                setTimeout(() => setMcpUrlCopied(false), 2000);
              }}
              style={{ padding: 8 }}
            >
              <Ionicons
                name={mcpUrlCopied ? 'checkmark-circle' : 'copy-outline'}
                size={18}
                color={mcpUrlCopied ? '#10B981' : Colors.textSecondary}
              />
            </Pressable>
          </View>

          {/* API Key row */}
          <View style={[styles.connRow, styles.connRowBorder, { paddingVertical: 12 }]}>
            <View style={[styles.connIconWrap, { backgroundColor: '#2D1B69' }]}>
              <Ionicons name="key-outline" size={18} color="#8B5CF6" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>API Key</Text>
              {mcpKeyLoading ? (
                <ActivityIndicator size="small" color="#8B5CF6" />
              ) : mcpRawKey ? (
                <Text style={[styles.connSub, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10, color: '#10B981' }]} numberOfLines={1}>
                  {mcpRawKey}
                </Text>
              ) : mcpKeyInfo ? (
                <>
                  <Text style={[styles.connSub, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10 }]}>
                    {mcpKeyInfo.prefix}••••••••••••••••••••••••••••••••
                  </Text>
                  <Text style={{ fontSize: 10, color: Colors.textTertiary, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
                    Key is masked — regenerate to reveal a new one
                  </Text>
                </>
              ) : (
                <Text style={styles.connSub}>No key — tap Regenerate to create one</Text>
              )}
            </View>
            {(mcpRawKey || mcpKeyInfo) && (
              <Pressable
                onPress={async () => {
                  if (mcpRawKey) {
                    await Clipboard.setStringAsync(mcpRawKey);
                    setMcpKeyCopied(true);
                    setTimeout(() => setMcpKeyCopied(false), 2000);
                  }
                }}
                style={{ padding: 8 }}
                disabled={!mcpRawKey}
              >
                <Ionicons
                  name={mcpKeyCopied ? 'checkmark-circle' : 'copy-outline'}
                  size={18}
                  color={mcpKeyCopied ? '#10B981' : mcpRawKey ? Colors.textSecondary : Colors.textMuted}
                />
              </Pressable>
            )}
          </View>

          {/* Raw key one-time warning */}
          {!!mcpRawKey && (
            <View style={{ paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#8B5CF610', borderRadius: 8, marginHorizontal: 8, marginBottom: 4 }}>
              <Text style={{ fontSize: 11, color: '#8B5CF6', fontFamily: 'Inter_600SemiBold', marginTop: 8, marginBottom: 2 }}>
                Copy your key now
              </Text>
              <Text style={{ fontSize: 11, color: Colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 15 }}>
                This is shown once. Store it somewhere safe — you won't be able to see it again.
              </Text>
            </View>
          )}

          {/* Regenerate button */}
          <View style={[styles.connRow, styles.connRowBorder, { paddingVertical: 10, justifyContent: 'center' }]}>
            <Pressable
              onPress={handleMcpRegenerateKey}
              disabled={mcpKeyRegenerating}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#8B5CF6', backgroundColor: '#8B5CF610' }}
            >
              {mcpKeyRegenerating
                ? <ActivityIndicator size="small" color="#8B5CF6" />
                : <Ionicons name="refresh-outline" size={16} color="#8B5CF6" />
              }
              <Text style={{ color: '#8B5CF6', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                {mcpKeyInfo ? 'Regenerate Key' : 'Generate Key'}
              </Text>
            </Pressable>
          </View>

          {/* Claude Desktop snippet */}
          <Pressable
            style={[styles.connRow, styles.connRowBorder, { paddingVertical: 10, justifyContent: 'space-between' }]}
            onPress={() => setMcpSnippetExpanded(v => !v)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="code-slash-outline" size={16} color={Colors.textSecondary} />
              <Text style={{ fontSize: 13, color: Colors.textSecondary, fontFamily: 'Inter_500Medium' }}>
                Claude Desktop config
              </Text>
            </View>
            <Ionicons name={mcpSnippetExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textTertiary} />
          </Pressable>
          {mcpSnippetExpanded && (
            <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
              <Text style={{ fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_400Regular', lineHeight: 15, marginBottom: 8 }}>
                Add this to your <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>claude_desktop_config.json</Text>:
              </Text>
              <View style={{ backgroundColor: Colors.surface, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: Colors.border }}>
                <Text style={{ fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: Colors.textSecondary, lineHeight: 16 }}>
                  {`{\n  "mcpServers": {\n    "jarvis": {\n      "url": "${getMcpServerUrl()}",\n      "type": "http",\n      "headers": {\n        "Authorization": "Bearer <your-key>"\n      }\n    }\n  }\n}`}
                </Text>
              </View>
              <Pressable
                onPress={async () => {
                  const snippet = `{\n  "mcpServers": {\n    "jarvis": {\n      "url": "${getMcpServerUrl()}",\n      "type": "http",\n      "headers": {\n        "Authorization": "Bearer ${mcpRawKey ?? '<your-key>'} "\n      }\n    }\n  }\n}`;
                  await Clipboard.setStringAsync(snippet);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end' }}
              >
                <Ionicons name="copy-outline" size={14} color={Colors.textTertiary} />
                <Text style={{ fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_500Medium' }}>Copy snippet</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ── WAKE WORD ── */}
        <SectionHeader label="WAKE WORD" accent={Colors.primary} />
        <View style={styles.card}>
          {/* Wake Word toggle */}
          <View style={[styles.connRow, { paddingVertical: 12 }]}>
            <View style={[styles.connIconWrap, { backgroundColor: '#1E3A5F' }]}>
              <Ionicons name="mic-outline" size={18} color={Colors.primary} />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Wake Word</Text>
              <Text style={styles.connSub}>Say a phrase to activate Jarvis hands-free (Android only)</Text>
            </View>
            <Switch
              value={wakeWordEnabled}
              onValueChange={toggleWakeWord}
              disabled={wakeSettingsSaving}
              trackColor={{ false: Colors.border, true: Colors.primary }}
            />
          </View>

          {/* Talk Mode toggle */}
          <View style={[styles.connRow, styles.connRowBorder, { paddingVertical: 12 }]}>
            <View style={[styles.connIconWrap, { backgroundColor: '#0f2f1a' }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.success} />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Talk Mode</Text>
              <Text style={styles.connSub}>Auto re-arm mic after each TTS response for hands-free chat</Text>
            </View>
            <Switch
              value={talkModeEnabled}
              onValueChange={toggleTalkMode}
              disabled={wakeSettingsSaving}
              trackColor={{ false: Colors.border, true: Colors.success }}
            />
          </View>

          {/* Trigger phrase list */}
          {wakeWordEnabled && (
            <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
              <Text style={{ fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_500Medium', marginTop: 6, marginBottom: 8, letterSpacing: 0.5 }}>
                TRIGGER PHRASES
              </Text>
              {wakeWords.map(phrase => (
                <View key={phrase} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}>
                  <Ionicons name="radio-outline" size={14} color={Colors.textSecondary} style={{ marginRight: 8 }} />
                  <Text style={{ flex: 1, fontSize: 13, color: Colors.text, fontFamily: 'Inter_400Regular' }}>{phrase}</Text>
                  <Pressable onPress={() => removeWakeWord(phrase)} hitSlop={10}>
                    <Ionicons name="close-circle" size={16} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <TextInput
                  style={[styles.tzInput, { flex: 1, marginTop: 0 }]}
                  placeholder="Add phrase..."
                  placeholderTextColor={Colors.textTertiary}
                  value={newWakeWord}
                  onChangeText={setNewWakeWord}
                  onSubmitEditing={addWakeWord}
                  returnKeyType="done"
                  autoCapitalize="none"
                />
                <Pressable
                  onPress={addWakeWord}
                  style={{ backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
                >
                  <Ionicons name="add" size={16} color="#fff" />
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* ── VOICE RESPONSES (TTS) ── */}
        <SectionHeader label="VOICE RESPONSES" accent="#7C3AED" />
        <View style={styles.card}>
          {/* Telegram auto-TTS toggle */}
          <View style={[styles.connRow, { paddingVertical: 12 }]}>
            <View style={[styles.connIconWrap, { backgroundColor: '#1a1a3e' }]}>
              <Ionicons name="paper-plane-outline" size={18} color="#7C3AED" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Auto-speak on Telegram</Text>
              <Text style={styles.connSub}>Jarvis sends a voice note after every Telegram reply</Text>
            </View>
            <Switch
              value={ttsTelegramEnabled}
              onValueChange={toggleTtsTelegram}
              disabled={ttsSaving}
              trackColor={{ false: Colors.border, true: '#7C3AED' }}
            />
          </View>

          {/* WhatsApp auto-TTS toggle */}
          <View style={[styles.connRow, styles.connRowBorder, { paddingVertical: 12 }]}>
            <View style={[styles.connIconWrap, { backgroundColor: '#0f2a1a' }]}>
              <Ionicons name="logo-whatsapp" size={18} color={Colors.success} />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Auto-speak on WhatsApp</Text>
              <Text style={styles.connSub}>Jarvis sends a voice note after every WhatsApp reply</Text>
            </View>
            <Switch
              value={ttsWhatsAppEnabled}
              onValueChange={toggleTtsWhatsApp}
              disabled={ttsSaving}
              trackColor={{ false: Colors.border, true: Colors.success }}
            />
          </View>

          {/* Voice picker */}
          <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
            <Text style={{ fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_500Medium', letterSpacing: 0.5, marginBottom: 10 }}>
              JARVIS VOICE
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {TTS_OPENAI_VOICES.map(v => {
                const active = ttsVoice === v.id;
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => changeTtsVoice(v.id)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 20,
                      borderWidth: 1.5,
                      borderColor: active ? '#7C3AED' : Colors.border,
                      backgroundColor: active ? 'rgba(124,58,237,0.12)' : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_400Regular', color: active ? '#7C3AED' : Colors.text }}>
                      {v.label}
                    </Text>
                    <Text style={{ fontSize: 10, color: Colors.textTertiary, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
                      {v.desc}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Preview button */}
          <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
            <Pressable
              onPress={previewTtsVoice}
              disabled={ttsPreviewing}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: pressed ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.10)',
                borderWidth: 1,
                borderColor: 'rgba(124,58,237,0.3)',
                opacity: ttsPreviewing ? 0.6 : 1,
              })}
            >
              {ttsPreviewing
                ? <ActivityIndicator size="small" color="#7C3AED" />
                : <Ionicons name="volume-medium-outline" size={16} color="#7C3AED" />
              }
              <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: '#7C3AED' }}>
                {ttsPreviewing ? 'Sending…' : `Preview ${TTS_OPENAI_VOICES.find(v => v.id === ttsVoice)?.label ?? ttsVoice} voice on Telegram`}
              </Text>
            </Pressable>
            <Text style={{ fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 6 }}>
              You can also ask Jarvis to "read that out" or "say it as a voice message" at any time
            </Text>
          </View>
        </View>

        {/* ── BUILD HISTORY ── */}
        {buildHistory.length > 0 && (
          <>
            <SectionHeader label="BUILD HISTORY" accent="#8B5CF6" />
            <View style={styles.card}>
              <Pressable
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 }}
                onPress={() => setBuildHistoryExpanded(v => !v)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="code-slash-outline" size={14} color="#8B5CF6" />
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.text }}>
                    Build History
                  </Text>
                  <View style={{ backgroundColor: '#8B5CF620', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
                    <Text style={{ fontSize: 11, color: '#8B5CF6', fontFamily: 'Inter_600SemiBold' }}>
                      {buildHistory.length}
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={buildHistoryExpanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={Colors.textTertiary}
                />
              </Pressable>
              {buildHistoryExpanded && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
                  {buildHistory.map((build, idx) => {
                    const argsJson = build.smokeTestArgs ? JSON.stringify(build.smokeTestArgs, null, 2) : null;
                    const stableJson = (obj: Record<string, unknown> | null): string =>
                      obj ? JSON.stringify(obj, Object.keys(obj).sort()) : '';
                    const reusedArgs = build.smokeTestArgs
                      ? buildHistory.slice(idx + 1).some(
                          older => older.smokeTestPassed && older.smokeTestArgs &&
                            stableJson(older.smokeTestArgs) === stableJson(build.smokeTestArgs)
                        )
                      : false;
                    return (
                    <View key={build.id} style={ocStyles.buildCard}>
                      <Pressable
                        style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}
                        onPress={() => setExpandedBuildId(expandedBuildId === build.id ? null : build.id)}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Ionicons
                              name={!build.success ? 'close-circle' : build.smokeTestPassed ? 'checkmark-circle' : 'alert-circle'}
                              size={12}
                              color={!build.success ? Colors.error : build.smokeTestPassed ? '#10B981' : '#F59E0B'}
                            />
                            <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.text }}>
                              {build.featureName}
                            </Text>
                            {reusedArgs && (
                              <View style={{ backgroundColor: '#8B5CF620', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                <Ionicons name="refresh-outline" size={9} color="#8B5CF6" />
                                <Text style={{ fontSize: 9, color: '#8B5CF6', fontFamily: 'Inter_600SemiBold' }}>reused args</Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ fontSize: 10, fontFamily: 'Inter_500Medium', color: !build.success ? Colors.error : build.smokeTestPassed ? '#10B981' : '#F59E0B', marginBottom: 2 }}>
                            {!build.success ? 'Build failed' : build.smokeTestPassed ? 'Built and verified' : 'Built'}
                          </Text>
                          <Text style={{ fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_400Regular' }} numberOfLines={2}>
                            {build.description}
                          </Text>
                          <Text style={{ fontSize: 10, color: Colors.textTertiary, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                            {new Date(build.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                        <Ionicons
                          name={expandedBuildId === build.id ? 'chevron-up' : 'chevron-down'}
                          size={12}
                          color={Colors.textTertiary}
                        />
                      </Pressable>
                      {expandedBuildId === build.id && (
                        <>
                          {argsJson && (
                            <View style={{ marginTop: 8 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                <Ionicons name="flask-outline" size={10} color="#8B5CF6" />
                                <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#8B5CF6' }}>
                                  {reusedArgs ? 'Test Args (reused from prior build)' : 'Test Args'}
                                </Text>
                              </View>
                              <ScrollView style={ocStyles.buildCodeBlock} nestedScrollEnabled>
                                <Text style={ocStyles.buildCodeText} selectable>
                                  {argsJson}
                                </Text>
                              </ScrollView>
                            </View>
                          )}
                          <ScrollView style={[ocStyles.buildCodeBlock, { marginTop: argsJson ? 6 : 8 }]} nestedScrollEnabled>
                            <Text style={ocStyles.buildCodeText} selectable>
                              {build.outputCode || '(no code recorded)'}
                            </Text>
                          </ScrollView>
                        </>
                      )}
                    </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}

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
          ) : nervousSystemError ? (
            <SectionErrorRow message="Couldn't load Nervous System" onRetry={loadNervousSystem} />
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

        {/* ── MODEL PREFERENCES ── */}
        <SectionHeader label="AI MODELS" accent={Colors.violet} />
        <View style={styles.card}>
          {modelsError ? (
            <SectionErrorRow message="Couldn't load model settings" onRetry={loadModels} />
          ) : (
            <>
              {(
                [
                  { key: 'chat' as ModelCategory, icon: 'chatbubble-outline', label: 'Chat & Agent' },
                  { key: 'planning' as ModelCategory, icon: 'calendar-outline', label: 'Planning' },
                  { key: 'memory' as ModelCategory, icon: 'library-outline', label: 'Memory' },
                  { key: 'research' as ModelCategory, icon: 'search-outline', label: 'Research' },
                ] as { key: ModelCategory; icon: string; label: string }[]
              ).map(({ key, icon, label }, idx) => {
                const currentModel = availableModels.find(m => m.value === modelPrefs[key]);
                return (
                  <Pressable
                    key={key}
                    style={[styles.prefRow, idx > 0 && styles.prefRowBorder]}
                    onPress={() => {
                      if (savingModel) return;
                      Alert.alert(
                        label,
                        'Choose the AI model for this category',
                        [
                          ...availableModels.map(m => ({
                            text: `${m.label}  —  ${m.description}`,
                            style: (m.value === modelPrefs[key] ? 'destructive' : 'default') as 'destructive' | 'default',
                            onPress: () => saveModel(key, m.value),
                          })),
                          { text: 'Cancel', style: 'cancel' as const },
                        ]
                      );
                    }}
                  >
                    <View style={styles.prefLeft}>
                      <Ionicons name={icon as any} size={16} color={Colors.violet} />
                      <View>
                        <Text style={styles.prefTitle}>{label}</Text>
                        <Text style={styles.prefSub}>{currentModel ? `${currentModel.label} · ${currentModel.description}` : modelPrefs[key]}</Text>
                      </View>
                    </View>
                    {savingModel === key
                      ? <ActivityIndicator size="small" color={Colors.violet} />
                      : <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />}
                  </Pressable>
                );
              })}
            </>
          )}
        </View>

        {/* ── ORCHESTRATOR MODE ── */}
        <SectionHeader label="ORCHESTRATOR MODE" accent={Colors.violet} />
        <View style={styles.card}>
          {modelsError ? (
            <SectionErrorRow message="Couldn't load orchestrator settings" onRetry={loadModels} />
          ) : (
          <Pressable
            style={styles.prefRow}
            onPress={() => {
              if (savingOrchestrator || availableOrchestratorModels.length === 0) return;
              Alert.alert(
                'Orchestrator Model',
                'Choose the Claude model used for task decomposition and verification',
                [
                  ...availableOrchestratorModels.map((m: AvailableModel) => ({
                    text: `${m.label}  —  ${m.description}`,
                    style: (m.value === orchestratorModel ? 'destructive' : 'default') as 'destructive' | 'default',
                    onPress: () => saveOrchestratorModel(m.value),
                  })),
                  { text: 'Cancel', style: 'cancel' as const },
                ]
              );
            }}
          >
            <View style={styles.prefLeft}>
              <Ionicons name="git-network-outline" size={16} color={Colors.violet} />
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>Orchestrator Model</Text>
                <Text style={styles.prefSub}>Requests are decomposed, delegated and verified by Claude</Text>
              </View>
            </View>
            {savingOrchestrator
              ? <ActivityIndicator size="small" color={Colors.violet} />
              : <View style={styles.prefLeft}>
                  <Text style={[styles.prefSub, { color: Colors.violet }]}>
                    {availableOrchestratorModels.find((m: AvailableModel) => m.value === orchestratorModel)?.label ?? orchestratorModel}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                </View>
            }
          </Pressable>
          )}
        </View>

        {/* ── JARVIS INTELLIGENCE ── */}
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
          <Link href="/skills" asChild>
            <Pressable style={[styles.prefRow, styles.prefRowBorder]}>
              <View style={styles.prefLeft}>
                <Ionicons name="sparkles-outline" size={16} color={Colors.violet} />
                <View>
                  <Text style={styles.prefTitle}>Skill Store</Text>
                  <Text style={styles.prefSub}>Personalise how Jarvis thinks and acts</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </Pressable>
          </Link>
          <Link href="/code-proposals" asChild>
            <Pressable style={[styles.prefRow, styles.prefRowBorder]}>
              <View style={styles.prefLeft}>
                <Ionicons name="code-slash-outline" size={16} color={Colors.cyan} />
                <View>
                  <Text style={styles.prefTitle}>Code Proposals</Text>
                  <Text style={styles.prefSub}>Review and approve Jarvis's self-improvements</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </Pressable>
          </Link>
        </View>

        {/* ── JARVIS HEALTH ── */}
        <SectionHeader label="JARVIS HEALTH" accent="#10B981" />
        <View style={[styles.card, { gap: 0 }]}>
          {/* Health error state */}
          {!healthLoading && healthError && (
            <SectionErrorRow message="Health check unavailable" onRetry={loadHealth} />
          )}
          {/* Overall status row */}
          {!healthError && (
          <View style={healthStyles.overallRow}>
            {healthLoading ? (
              <ActivityIndicator size="small" color="#10B981" />
            ) : (
              <View style={[
                healthStyles.overallBadge,
                healthReport?.overallStatus === 'healthy' && healthStyles.badgeHealthy,
                healthReport?.overallStatus === 'degraded' && healthStyles.badgeDegraded,
                healthReport?.overallStatus === 'down' && healthStyles.badgeDown,
                !healthReport && healthStyles.badgeUnknown,
              ]}>
                <Text style={healthStyles.overallBadgeText}>
                  {(healthReport?.overallStatus ?? 'unknown').toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={healthStyles.overallTitle}>System Status</Text>
              {healthReport && (() => {
                const checkedAgo = (() => {
                  const diff = Date.now() - new Date(healthReport.generatedAt).getTime();
                  const m = Math.floor(diff / 60000);
                  if (m < 1) return 'just now';
                  if (m < 60) return `${m}m ago`;
                  return `${Math.floor(m / 60)}h ago`;
                })();
                const latencyText = healthReport.openAiLatencyMs != null
                  ? ` (${healthReport.openAiLatencyMs}ms)`
                  : '';
                return (
                  <>
                    <Text style={healthStyles.overallSub}>
                      {healthReport.openAiReachable ? `OpenAI ✓${latencyText}` : '⚠ OpenAI unreachable'} ·{' '}
                      {healthReport.dbReachable ? 'DB ✓' : '⚠ DB unreachable'} ·{' '}
                      Queue: {healthReport.jobQueueDepth}
                      {healthReport.staleJobCount > 0 ? ` (${healthReport.staleJobCount} re-queued)` : ''}
                    </Text>
                    <Text style={[healthStyles.overallSub, { fontSize: 10, color: Colors.textTertiary }]}>
                      Last checked: {checkedAgo}
                    </Text>
                  </>
                );
              })()}
            </View>
            <Pressable onPress={loadHealth} style={healthStyles.refreshBtn}>
              <Ionicons name="refresh-outline" size={16} color="#10B981" />
            </Pressable>
          </View>
          )}

          {/* Subsystem grid */}
          {healthReport && (healthReport.subsystems ?? []).length > 0 && (
            <View style={healthStyles.subsystemGrid}>
              {(healthReport.subsystems ?? []).map((s) => (
                <View key={s.name} style={healthStyles.subsystemCell}>
                  <View style={[
                    healthStyles.subsystemDot,
                    s.status === 'healthy' && { backgroundColor: '#10B981' },
                    s.status === 'degraded' && { backgroundColor: '#F59E0B' },
                    s.status === 'down' && { backgroundColor: Colors.error },
                    s.status === 'unknown' && { backgroundColor: Colors.textTertiary },
                  ]} />
                  <Text style={healthStyles.subsystemLabel} numberOfLines={1}>{s.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Recent error timeline */}
          {healthReport && healthReport.recentErrors && healthReport.recentErrors.length > 0 && (
            <View style={healthStyles.timelineSection}>
              <Text style={healthStyles.timelineHeader}>Recent Errors</Text>
              {healthReport.recentErrors.slice(0, 5).map((ev) => {
                const sevColor = ev.severity === 'critical' ? Colors.error : ev.severity === 'error' ? Colors.error : '#F59E0B';
                const timeAgo = (() => {
                  const diffMs = Date.now() - new Date(ev.createdAt).getTime();
                  const m = Math.floor(diffMs / 60000);
                  if (m < 1) return 'just now';
                  if (m < 60) return `${m}m ago`;
                  return `${Math.floor(m / 60)}h ago`;
                })();
                return (
                  <View key={ev.id} style={healthStyles.timelineRow}>
                    <View style={[healthStyles.timelineDot, { backgroundColor: sevColor }]} />
                    <View style={healthStyles.timelineContent}>
                      <View style={healthStyles.timelineMeta}>
                        <Text style={[healthStyles.timelineSub, { color: sevColor }]}>{ev.subsystem.replace('_', ' ')}</Text>
                        <Text style={healthStyles.timelineTime}>{timeAgo}</Text>
                      </View>
                      <Text style={healthStyles.timelineMsg} numberOfLines={2}>{ev.message}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Diagnosis section */}
          <View style={healthStyles.diagSection}>
            <Pressable
              style={[healthStyles.diagBtn, diagnosisLoading && { opacity: 0.6 }]}
              onPress={runDiagnosis}
              disabled={diagnosisLoading}
            >
              {diagnosisLoading ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : (
                <Ionicons name="pulse-outline" size={14} color="#10B981" />
              )}
              <Text style={healthStyles.diagBtnText}>
                {diagnosisLoading ? 'Diagnosing...' : 'Run AI Diagnosis'}
              </Text>
            </Pressable>
            {diagnosisText && (
              <View style={healthStyles.diagResult}>
                <Text style={healthStyles.diagText}>{diagnosisText}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── DIAGNOSTICS ── */}
        <SectionHeader label="DIAGNOSTICS" accent="#10B981" />
        <View style={[styles.card, { gap: 0 }]}>
          <View style={drStyles.headerRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={drStyles.title}>Configuration Health Scan</Text>
              <Text style={drStyles.subtitle}>
                {doctorReport
                  ? `${doctorReport.summary.pass} passed · ${doctorReport.summary.warn} warned · ${doctorReport.summary.fail} failed${doctorReport.cached ? ' · cached' : ''}`
                  : 'Checks credentials, tokens, env vars, and connectivity'}
              </Text>
              {doctorReport && (
                <Text style={drStyles.ranAt}>
                  Last run: {new Date(doctorReport.ranAt).toLocaleTimeString()}
                </Text>
              )}
            </View>
            <Pressable
              style={[drStyles.runBtn, doctorLoading && { opacity: 0.6 }]}
              onPress={runDoctor}
              disabled={doctorLoading}
            >
              {doctorLoading ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : (
                <>
                  <Ionicons name="medkit-outline" size={14} color="#10B981" />
                  <Text style={drStyles.runBtnText}>Run Diagnostics</Text>
                </>
              )}
            </Pressable>
          </View>

          {doctorReport && doctorReport.results.map((item, idx) => {
            const iconName: 'checkmark-circle' | 'warning' | 'close-circle' =
              item.status === 'pass' ? 'checkmark-circle' :
              item.status === 'warn' ? 'warning' : 'close-circle';
            const iconColor =
              item.status === 'pass' ? '#10B981' :
              item.status === 'warn' ? '#F59E0B' : Colors.error;
            const isActionable = item.status !== 'pass' && !!item.settingsPath;
            const inner = (
              <>
                <Ionicons name={iconName} size={16} color={iconColor} style={{ marginTop: 1 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={drStyles.resultLabel}>{item.label}</Text>
                  <Text style={drStyles.resultMsg} numberOfLines={3}>{item.message}</Text>
                </View>
                {isActionable && (
                  <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
                )}
              </>
            );
            return isActionable ? (
              <Pressable
                key={item.id}
                style={[drStyles.resultRow, idx === 0 && drStyles.resultFirst]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(item.settingsPath as Href);
                }}
              >
                {inner}
              </Pressable>
            ) : (
              <View
                key={item.id}
                style={[drStyles.resultRow, idx === 0 && drStyles.resultFirst]}
              >
                {inner}
              </View>
            );
          })}

          {!doctorReport && !doctorLoading && (
            <View style={drStyles.emptyHint}>
              <Text style={drStyles.emptyHintText}>Tap Run to check your Jarvis configuration</Text>
            </View>
          )}
        </View>

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

const drStyles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 15,
  },
  ranAt: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginTop: 2,
  },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10B981',
    backgroundColor: '#10B98115',
    minWidth: 62,
    justifyContent: 'center',
  },
  runBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#10B981',
  },
  resultFirst: {
    borderTopWidth: 0,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  resultLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  resultMsg: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 15,
  },
  emptyHint: {
    padding: 14,
    alignItems: 'center',
  },
  emptyHintText: {
    fontSize: 12,
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
  buildCard: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  buildCodeBlock: {
    marginTop: 8,
    backgroundColor: Colors.surface,
    borderRadius: 6,
    padding: 10,
    maxHeight: 300,
  },
  buildCodeText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: Colors.textSecondary,
    lineHeight: 16,
  },
});

const healthStyles = StyleSheet.create({
  overallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  overallBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeHealthy: { backgroundColor: '#10B98120' },
  badgeDegraded: { backgroundColor: '#F59E0B20' },
  badgeDown: { backgroundColor: `${Colors.error}20` },
  badgeUnknown: { backgroundColor: Colors.surfaceAlt },
  overallBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.5,
    color: Colors.textSecondary,
  },
  overallTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  overallSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    lineHeight: 15,
  },
  refreshBtn: {
    padding: 6,
  },
  subsystemGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  subsystemCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  subsystemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  subsystemLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    maxWidth: 90,
  },
  diagSection: {
    padding: 12,
    gap: 10,
  },
  diagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10B981',
    backgroundColor: '#10B98115',
    alignSelf: 'flex-start',
  },
  diagBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#10B981',
  },
  diagResult: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  diagText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  timelineSection: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  timelineHeader: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
    flexShrink: 0,
  },
  timelineContent: {
    flex: 1,
    gap: 2,
  },
  timelineMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineSub: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timelineTime: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  timelineMsg: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 15,
  },
});
