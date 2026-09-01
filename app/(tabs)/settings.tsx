Warning: truncated output (original token count: 58860)
Total output lines: 5550

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
  AppState,
  TextInput,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import Colors from '@/constants/colors';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import * as Speech from 'expo-speech';
import { createAudioPlayer } from '@/lib/audio';
import * as FileSystem from 'expo-file-system/legacy';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  getStats,
  claimReward,
  getLifeContext,
  getUserName,
  type UserStats,
  type Reward,
  type LifeContext,
} from '@/lib/storage';
import { areNotificationsEnabled, setNotificationsEnabled } from '@/lib/notifications';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import { AndroidDaemonNative, getAndroidDaemonStatus, type AndroidDaemonStatus } from '@/lib/android-daemon-native';
import { useAuth, authFetch } from '@/lib/auth-context';
import RewardClaimModal from '@/components/RewardClaimModal';
import LifeContextSheet from '@/components/LifeContextSheet';
import RuntimeDiagnosticsPanel from '@/components/RuntimeDiagnosticsPanel';
import {
  SectionErrorRow,
  SectionFallback,
  SectionHeader,
  SettingsFallback,
  StatusDot,
} from '@/components/settings/SettingsSectionChrome';
import { SubsystemErrorSheet } from '@/components/settings/SubsystemErrorSheet';
import { AchievementsSection } from '@/components/settings/AchievementsSection';
import { BuildHistorySection } from '@/components/settings/BuildHistorySection';
import { WakeWordSection } from '@/components/settings/WakeWordSection';
import { EyevueConnectCard } from '@/components/eyevue/EyevueConnectCard';
import { drStyles } from '@/components/settings/diagnosticsRunStyles';
import { tlStyles } from '@/components/settings/threatLogStyles';
import type {
  BuildLogEntry,
  CatalogProvider,
  McpServerInfo,
  OpenAIProviderAuthStatus,
  TelegramStatus,
} from '@/components/settings/settingsTypes';
import {
  CONNECTION_APPS,
  getConnectionStatusLabel,
  normalizeConnectionsStatus,
  normalizeConnectionTestResult,
  type ConnectionAppId,
  type ConnectionsStatus,
} from '@/lib/connectionUx';
import { ANDROID_LOCAL_GEMMA_MODEL, MODEL_PROVIDER_CATALOG } from '@shared/modelProviderCatalog';
import {
  createPhoneGemmaUnavailableStatus,
  importPhoneGemmaModelFile,
  isPhoneGemmaGenerationReady,
  isPhoneGemmaModelFileReady,
  LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE,
  LOCAL_GEMMA_EXPECTED_FILE_NAME,
  PHONE_GEMMA_RECOMMENDED_PROFILE,
  PHONE_GEMMA_VALIDATION_PROFILES,
  phoneGemmaNeedsEngine,
  phoneGemmaProfileLabel,
  phoneGemmaRuntimeDetails,
  readPhoneGemmaStatus,
  smokeTestPhoneGemmaRuntime,
  summarizePhoneGemmaSmokeTest,
  validatePhoneGemmaRuntime,
  type LocalGemmaModelStatus,
  type PhoneGemmaValidationProfile,
} from '@/lib/phone-gemma-runtime';

// ─────────────────────────────────────────────────────────────────────────────
// Section header component
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Module-level constants
// ─────────────────────────────────────────────────────────────────────────────

const GUT_THREAT_LABEL: Record<string, string> = {
  calendar_anomaly: 'Calendar Anomaly',
  email_pattern: 'Email Manipulation',
  deep_work_erosion: 'Deep Work Erosion',
  project_drift: 'Project Drift',
  relationship_anomaly: 'Relationship Signal',
};

function formatModelSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
}

function extractApiError(error: any, fallback: string): string {
  const raw = typeof error?.message === 'string' ? error.message : '';
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (typeof parsed.error === 'string') return parsed.error;
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {}
  }
  return raw || fallback;
}

function androidDaemonServerConnectedFromChannels(channelsRes: any): boolean {
  return channelsRes?.meta?.android_daemon?.connected ?? channelsRes?.android_daemon_connected ?? false;
}

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
  const appStateRef = useRef(AppState.currentState);
  const diagnosticsYRef = useRef(0);
  const androidAccessibilityRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedIntegration, setHighlightedIntegration] = useState<string | null>(null);

  // ── Auth state ──
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>({
    connected: false, username: null, configured: false,
  });
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [telegramPolling, setTelegramPolling] = useState(false);
  const telegramPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [integrationHealth, setIntegrationHealth] = useState<Record<string, string>>({});
  const [integrationErrors, setIntegrationErrors] = useState<Record<string, string | null>>({});
  const [, setLoadingStatus] = useState(true);
  const [androidDaemonConnected, setAndroidDaemonConnected] = useState(false);
  const [androidDaemonServerConnected, setAndroidDaemonServerConnected] = useState(false);
  const [androidDaemonBusy, setAndroidDaemonBusy] = useState(false);
  const [androidDaemonError, setAndroidDaemonError] = useState<string | null>(null);
  const [androidAssistantStatus, setAndroidAssistantStatus] = useState<AndroidDaemonStatus | null>(null);
  const [connectionsStatus, setConnectionsStatus] = useState<ConnectionsStatus | null>(null);
  const [connectionBusyApp, setConnectionBusyApp] = useState<string | null>(null);
  const [connectionTestSummary, setConnectionTestSummary] = useState<string | null>(null);

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
  const [timezone, setTimezone] = useState('America/New_York');

  // ── Model Preferences ──
  type ModelCategory = 'chat' | 'planning' | 'memory' | 'research';
  type ModelCategoryWithOrchestrator = ModelCategory | 'orchestrator';
  interface AvailableModel { value: string; label: string; description: string; provider?: string; categories?: ModelCategoryWithOrchestrator[] }
  const [modelPrefs, setModelPrefs] = useState<Record<ModelCategory, string>>({
    chat: 'chatgpt-codex-oauth/auto',
    planning: 'chatgpt-codex-oauth/auto',
    memory: 'chatgpt-codex-oauth/auto',
    research: 'chatgpt-codex-oauth/auto',
  });
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [savingModel, setSavingModel] = useState<ModelCategory | null>(null);

  // ── OpenAI provider auth ──
  const [openAIProviderStatus, setOpenAIProviderStatus] = useState<OpenAIProviderAuthStatus | null>(null);
  const [providerCatalog, setProviderCatalog] = useState<CatalogProvider[]>([]);
  const [providerApiKeyVisible, setProviderApiKeyVisible] = useState<Record<string, boolean>>({});
  const [providerApiKeyInputs, setProviderApiKeyInputs] = useState<Record<string, string>>({});
  const [providerAuthMessages, setProviderAuthMessages] = useState<Record<string, string>>({});
  const [localGemmaStatus, setLocalGemmaStatus] = useState<LocalGemmaModelStatus | null>(null);
  const [localGemmaStatusLoading, setLocalGemmaStatusLoading] = useState(false);
  const [localGemmaImporting, setLocalGemmaImporting] = useState(false);
  const [localGemmaValidating, setLocalGemmaValidating] = useState(false);
  const [localGemmaSmokeTesting, setLocalGemmaSmokeTesting] = useState(false);
  const [localGemmaActiveProfileId, setLocalGemmaActiveProfileId] = useState<string | null>(null);
  const [openAIAuthLoading, setOpenAIAuthLoading] = useState(false);
  const [openAIAuthBusy, setOpenAIAuthBusy] = useState(false);
  const [openAIApiKeyVisible, setOpenAIApiKeyVisible] = useState(false);
  const [openAIApiKeyInput, setOpenAIApiKeyInput] = useState('');
  const [openAICallbackUrl, setOpenAICallbackUrl] = useState('');
  const [openAILoginUrl, setOpenAILoginUrl] = useState<string | null>(null);
  const [openAIAuthMessage, setOpenAIAuthMessage] = useState<string | null>(null);

  // ── Orchestrator ──
  const [orchestratorModel, setOrchestratorModel] = useState('chatgpt-codex-oauth/auto');
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
    await saveTtsSettings({ ttsChannels: channels });
  }, [saveTtsSettings]);

  const changeTtsVoice = useCallback(async (voice: TtsVoiceId) => {
    setTtsVoice(voice);
    await saveTtsSettings({ voice });
  }, [saveTtsSettings]);

  const previewTtsVoice = useCallback(async () => {
    setTtsPreviewing(true);
    let tempUri: string | null = null;
    const previewText = Platform.OS === 'android'
      ? "Hi, I'm Jarvis. This is your Android device text-to-speech voice."
      : "Hi, I'm Jarvis. This is what I sound like with this voice.";
    try {
      if (Platform.OS === 'android') {
        await Speech.stop().catch(() => {});
        await new Promise<void>((resolve) => {
          Speech.speak(previewText, {
            rate: 0.96,
            pitch: 1,
            onDone: resolve,
            onStopped: resolve,
            onError: () => resolve(),
          });
        });
        return;
      }

      const res = await apiRequest('POST', '/api/coach/speak', {
        text: previewText,
        voice: ttsVoice,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.audio && Platform.OS !== 'web' && FileSystem.documentDirectory) {
          tempUri = `${FileSystem.documentDirectory}tts_preview_${Date.now()}.mp3`;
          await FileSystem.writeAsStringAsync(tempUri, data.audio, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const playUri = tempUri;
          tempUri = null;
          const player = createAudioPlayer({ uri: playUri });
          player.addListener('playbackStatusUpdate', (status) => {
            if (status.didJustFinish) {
              player.remove();
              FileSystem.deleteAsync(playUri, { idempotent: true }).catch(() => {});
            }
          });
          player.play();
        }
      }
    } catch (err) {
      console.warn('[settings] TTS preview failed:', err);
    } finally {
      if (tempUri) FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
      setTtsPreviewing(false);
    }
  }, [ttsVoice]);

  // ── GitHub ──
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubTokenType, setGithubTokenType] = useState<'pat' | 'oauth' | null>(null);
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [githubRepos, setGithubRepos] = useState<string[]>([]);
  const [githubPatInput, setGithubPatInput] = useState('');
  const [githubRepoInput, setGithubRepoInput] = useState('');
  const [githubSaving, setGithubSaving] = useState(false);
  const [githubExpanded, setGithubExpanded] = useState(false);
  const [githubPatVisible, setGithubPatVisible] = useState(false);
  const [githubOAuthAvailable, setGithubOAuthAvailable] = useState(false);
  const [githubOAuthFlowing, setGithubOAuthFlowing] = useState(false);
  const [githubUserCode, setGithubUserCode] = useState<string | null>(null);
  const [githubVerificationUri, setGithubVerificationUri] = useState<string | null>(null);
  const [githubOAuthPolling, setGithubOAuthPolling] = useState(false);
  const [githubCodeCopied, setGithubCodeCopied] = useState(false);
  const githubPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadGithubSettings = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/github/settings');
      if (!res.ok) return;
      const data = await res.json();
      setGithubConnected(!!data.connected);
      setGithubTokenType(data.tokenType ?? null);
      setGithubUsername(data.username ?? null);
      setGithubRepos(Array.isArray(data.repos) ? data.repos : []);
    } catch {}
  }, []);

  const loadGithubOAuthAvailable = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/github/oauth-available');
      if (!res.ok) return;
      const data = await res.json();
      setGithubOAuthAvailable(!!data.available);
    } catch {}
  }, []);

  const cancelGithubOAuth = useCallback(() => {
    if (githubPollRef.current) {
      clearInterval(githubPollRef.current);
      githubPollRef.current = null;
    }
    setGithubOAuthFlowing(false);
    setGithubOAuthPolling(false);
    setGithubUserCode(null);
    setGithubVerificationUri(null);
    setGithubCodeCopied(false);
  }, []);

  const startGithubOAuth = useCallback(async () => {
    try {
      setGithubOAuthFlowing(true);
      const res = await apiRequest('POST', '/api/github/device/start', {});
      if (!res.ok) {
        Alert.alert('Error', 'Could not start GitHub login. Please try again.');
        setGithubOAuthFlowing(false);
        return;
      }
      const data = await res.json();
      setGithubUserCode(data.user_code);
      setGithubVerificationUri(data.verification_uri);
      const pollInterval = Math.max((data.interval ?? 5) * 1000, 5000);
      const expiresAt = Date.now() + (data.expires_in ?? 900) * 1000;
      setGithubOAuthPolling(true);
      githubPollRef.current = setInterval(async () => {
        if (Date.now() > expiresAt) {
          cancelGithubOAuth();
          Alert.alert('Expired', 'The authorization window expired. Please try again.');
          return;
        }
        try {
          const pollRes = await apiRequest('POST', '/api/github/device/poll', { device_code: data.device_code });
          if (!pollRes.ok) return;
          const pollData = await pollRes.json();
          if (pollData.status === 'authorized') {
            cancelGithubOAuth();
            setGithubConnected(true);
            setGithubTokenType('oauth');
            await loadGithubSettings();
          } else if (pollData.status === 'error') {
            cancelGithubOAuth();
            Alert.alert('Authorization failed', pollData.message ?? 'GitHub denied the request.');
          }
        } catch {}
      }, pollInterval);
    } catch {
      setGithubOAuthFlowing(false);
    }
  }, [cancelGithubOAuth, loadGithubSettings]);

  const copyGithubUserCode = useCallback(async () => {
    if (!githubUserCode) return;
    await Clipboard.setStringAsync(githubUserCode);
    setGithubCodeCopied(true);
    setTimeout(() => setGithubCodeCopied(false), 2000);
  }, [githubUserCode]);

  const saveGithubPat = useCallback(async () => {
    if (!githubPatInput.trim()) return;
    setGithubSaving(true);
    try {
      await apiRequest('PATCH', '/api/github/settings', { pat: githubPatInput.trim() });
      setGithubConnected(true);
      setGithubPatInput('');
      await loadGithubSettings();
    } catch {}
    setGithubSaving(false);
  }, [githubPatInput, loadGithubSettings]);

  const removeGithubPat = useCallback(async () => {
    Alert.alert('Remove GitHub Token', 'This will disconnect GitHub. Your repos list will be preserved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await apiRequest('DELETE', '/api/github/pat');
            setGithubConnected(false);
            setGithubUsername(null);
            setGithubTokenType(null);
          } catch {}
        },
      },
    ]);
  }, []);

  const addGithubRepo = useCallback(async () => {
    const repo = githubRepoInput.trim();
    if (!repo || !repo.includes('/')) {
      Alert.alert('Invalid format', 'Enter a repo as "owner/repo" e.g. acme/backend');
      return;
    }
    if (githubRepos.includes(repo)) return;
    const updated = [...githubRepos, repo];
    try {
      await apiRequest('PATCH', '/api/github/settings', { repos: updated });
      setGithubRepos(updated);
      setGithubRepoInput('');
    } catch {}
  }, [githubRepoInput, githubRepos]);

  const removeGithubRepo = useCallback(async (repo: string) => {
    const updated = githubRepos.filter(r => r !== repo);
    try {
      await apiRequest('PATCH', '/api/github/settings', { repos: updated });
      setGithubRepos(updated);
    } catch {}
  }, [githubRepos]);

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
  interface MemoryDiagEvent {
    id: string;
    subsystem: string;
    severity: string;
    message: string;
    metadata: Record<string, unknown>;
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
    memoryWriteErrors15m: number;
    memoryReadErrors15m: number;
  }
  interface JobRunnerJob {
    id: string;
    agentType: string;
    title: string;
    status: string;
    ageMs: number;
    runtimeMs: number | null;
    retryCount: number;
    lastError: string | null;
    resultPreview: string | null;
  }
  interface JobRunnerObservability {
    generatedAt: string;
    summary: {
      total: number;
      byStatus: Record<string, number>;
      activeCount: number;
      recentFailureCount: number;
      oldestQueuedAgeMs: number | null;
    };
    activeJobs: JobRunnerJob[];
    recentJobs: JobRunnerJob[];
    diagnosticEvents: MemoryDiagEvent[];
  }
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [jobRunnerReport, setJobRunnerReport] = useState<JobRunnerObservability | null>(null);
  const [jobRunnerLoading, setJobRunnerLoading] = useState(false);
  const [diagnosisText, setDiagnosisText] = useState<string | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [gapScanRunning, setGapScanRunning] = useState(false);
  const [gapScanResult, setGapScanResult] = useState<{ submitted: number; queued: number; total: number } | null>(null);
  const [subsystemSheetVisible, setSubsystemSheetVisible] = useState(false);
  const [subsystemSheetName, setSubsystemSheetName] = useState<string>('memory');
  const [subsystemSheetLabel, setSubsystemSheetLabel] = useState<string>('Memory');
  const [subsystemEvents, setSubsystemEvents] = useState<MemoryDiagEvent[]>([]);
  const [subsystemEventsLoading, setSubsystemEventsLoading] = useState(false);
  const subsystemRequestSeqRef = useRef(0);
  const [subsystemEventsLastUpdated, setSubsystemEventsLastUpdated] = useState<Date | null>(null);

  // ── Workspace Files ──
  const [workspaceSoul, setWorkspaceSoul] = useState('');
  const [workspaceAgents, setWorkspaceAgents] = useState('');
  const [workspaceMemory, setWorkspaceMemory] = useState('');
  const [workspaceExpanded, setWorkspaceExpanded] = useState<Record<string, boolean>>({});
  const [workspaceSaving, setWorkspaceSaving] = useState<Record<string, boolean>>({});
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceIsOwner, setWorkspaceIsOwner] = useState(false);
  const [synthesising, setSynthesising] = useState(false);
  const [synthesisHistory, setSynthesisHistory] = useState<{
    id: number;
    createdAt: string;
    bulletCount: number;
    bullets: string[];
    triggeredBy: string;
    skipped: boolean;
    skipReason?: string | null;
  }[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [archiveAfterSynth, setArchiveAfterSynth] = useState(false);

  const loadSynthesisHistory = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/workspace/synthesise-history');
      if (res.ok) {
        const data = await res.json() as { runs: typeof synthesisHistory };
        setSynthesisHistory(data.runs ?? []);
      }
    } catch {}
  }, []);

  const loadWorkspaceFiles = useCallback(async () => {
    setWorkspaceLoading(true);
    try {
      const [soulRes, agentsRes, memoryRes] = await Promise.all([
        apiRequest('GET', '/api/workspace/soul'),
        apiRequest('GET', '/api/workspace/agents'),
        apiRequest('GET', '/api/workspace/memory'),
      ]);
      if (soulRes.status === 403 || agentsRes.status === 403 || memoryRes.status === 403) {
        setWorkspaceIsOwner(false);
      } else {
        setWorkspaceIsOwner(true);
        if (soulRes.ok) { const d = await soulRes.json(); setWorkspaceSoul(d.content ?? ''); }
        if (agentsRes.ok) { const d = await agentsRes.json(); setWorkspaceAgents(d.content ?? ''); }
        if (memoryRes.ok) { const d = await memoryRes.json(); setWorkspaceMemory(d.content ?? ''); }
        loadSynthesisHistory();
      }
    } catch {}
    setWorkspaceLoading(false);
  }, [loadSynthesisHistory]);

  const saveWorkspaceFile = useCallback(async (key: string, content: string) => {
    setWorkspaceSaving(prev => ({ ...prev, [key]: true }));
    try {
      await apiRequest('POST', `/api/workspace/${key}`, { content, mode: 'overwrite' });
      if (key === 'soul') setWorkspaceSoul(content);
      if (key === 'agents') setWorkspaceAgents(content);
      if (key === 'memory') setWorkspaceMemory(content);
    } catch {}
    setWorkspaceSaving(prev => ({ ...prev, [key]: false }));
  }, []);

  const runSynthesis = useCallback(async (archiveAfter: boolean) => {
    setSynthesising(true);
    try {
      const res = await apiRequest('POST', '/api/workspace/synthesise', { archiveAfter });
      if (!res.ok) {
        Alert.alert('Synthesis failed', 'Could not synthesise learnings. Please try again.');
        return;
      }
      const data = await res.json() as {
        skipped?: boolean;
        skipReason?: string;
        bullets?: string[];
        appendedToMemory?: boolean;
        archived?: boolean;
        correctionLines?: number;
        errorLines?: number;
      };
      if (data.skipped) {
        Alert.alert('Nothing to synthesise', data.skipReason ?? 'No correction or error data found yet.');
      } else {
        const count = data.bullets?.length ?? 0;
        const archiveNote = data.archived
          ? '\n\nCorrection and error logs have been cleared — only new entries will accumulate from here.'
          : '';
        Alert.alert(
          'Learnings synthesised',
          `${count} lesson${count === 1 ? '' : 's'} distilled from your correction and error logs and appended to MEMORY.md.\n\nJarvis will apply these in all future sessions.${archiveNote}`,
          [{ text: 'View MEMORY.md', onPress: () => { setWorkspaceExpanded(prev => ({ ...prev, memory: true })); loadWorkspaceFiles(); } }, { text: 'Done', style: 'cancel' }],
        );
      }
      loadSynthesisHistory();
    } catch {
      Alert.alert('Error', 'Failed to synthesise learnings.');
    } finally {
      setSynthesising(false);
    }
  }, [loadWorkspaceFiles, loadSynthesisHistory]);

  const synthesiseLearnings = useCallback(() => {
    if (archiveAfterSynth) {
      Alert.alert(
        'Clear logs after synthesis?',
        'Jarvis will distil your correction and error logs into MEMORY.md, then reset both log files. New entries will accumulate from scratch.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Synthesise & Clear', style: 'destructive', onPress: () => runSynthesis(true) },
        ],
      );
    } else {
      runSynthesis(false);
    }
  }, [archiveAfterSynth, runSynthesis]);

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

  const loadJobRunnerReport = useCallback(async () => {
    setJobRunnerLoading(true);
    try {
      const res = await apiRequest('GET', '/api/agent-jobs/observability');
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object' && data.summary) {
          setJobRunnerReport({
            ...data,
            activeJobs: Array.isArray(data.activeJobs) ? data.activeJobs : [],
            recentJobs: Array.isArray(data.recentJobs) ? data.recentJobs : [],
            diagnosticEvents: Array.isArray(data.diagnosticEvents) ? data.diagnosticEvents : [],
          });
        } else {
          setJobRunnerReport(null);
        }
      } else {
        setJobRunnerReport(null);
      }
    } catch {
      setJobRunnerReport(null);
    }
    setJobRunnerLoading(false);
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
    } catch {
      setDiagnosisText('Failed to run diagnosis. Please try again.');
    }
    setDiagnosisLoading(false);
  }, []);

  const runGapScan = useCallback(async () => {
    setGapScanRunning(true);
    setGapScanResult(null);
    try {
      const res = await apiRequest('POST', '/api/gap-analysis/run');
      if (res.ok) {
        const data = await res.json();
        setGapScanResult({ submitted: data.submitted ?? 0, queued: data.queued ?? 0, total: data.total ?? 0 });
      } else {
        setGapScanResult({ submitted: 0, queued: 0, total: -1 });
      }
    } catch {
      setGapScanResult({ submitted: 0, queued: 0, total: -1 });
    }
    setGapScanRunning(false);
  }, []);

  const openSubsystemErrorSheet = useCallback(async (name: string, label: string) => {
    subsystemRequestSeqRef.current += 1;
    const mySeq = subsystemRequestSeqRef.current;
    setSubsystemSheetName(name);
    setSubsystemSheetLabel(label);
    setSubsystemSheetVisible(true);
    setSubsystemEventsLoading(true);
    setSubsystemEventsLastUpdated(null);
    try {
      const res = await apiRequest('GET', `/api/diagnostics/events?subsystem=${encodeURIComponent(name)}`);
      if (mySeq !== subsystemRequestSeqRef.current) return;
      if (res.ok) {
        const data = await res.json();
        setSubsystemEvents(Array.isArray(data) ? data : []);
        setSubsystemEventsLastUpdated(new Date());
      } else {
        setSubsystemEvents([]);
      }
    } catch {
      if (mySeq !== subsystemRequestSeqRef.current) return;
      setSubsystemEvents([]);
    }
    if (mySeq === subsystemRequestSeqRef.current) setSubsystemEventsLoading(false);
  }, []);

  const fetchSubsystemEventsBackground = useCallback(async (name: string) => {
    try {
      const res = await apiRequest('GET', `/api/diagnostics/events?subsystem=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        setSubsystemEvents(Array.isArray(data) ? data : []);
        setSubsystemEventsLastUpdated(new Date());
      }
    } catch {
      // leave timestamp unchanged on failure so label doesn't mislead
    }
  }, []);

  useEffect(() => {
    if (!subsystemSheetVisible) return;
    const id = setInterval(() => {
      fetchSubsystemEventsBackground(subsystemSheetName);
    }, 20000);
    return () => clearInterval(id);
  }, [subsystemSheetVisible, subsystemSheetName, fetchSubsystemEventsBackground]);

  const applySelectedModel = useCallback((model: string, responsePrefs?: Record<string, unknown>) => {
    const nextPrefs = (['chat', 'planning', 'memory', 'research'] as ModelCategory[]).reduce((acc, key) => {
      const value = responsePrefs?.[key];
      acc[key] = typeof value === 'string' ? value : model;
      return acc;
    }, {} as Record<ModelCategory, string>);
    setModelPrefs(nextPrefs);
    setOrchestratorModel(model);
  }, []);

  const saveModel = useCallback(async (category: ModelCategory, model: string) => {
    setSavingModel(category);
    try {
      const res = await apiRequest('PATCH', '/api/settings/models', { category, model });
      const data = await res.json().catch(() => ({}));
      applySelectedModel(String(data.selectedModel || model), data.modelPreferences);
    } catch {}
    setSavingModel(null);
  }, [applySelectedModel]);

  const saveOrchestratorModel = useCallback(async (model: string) => {
    setSavingOrchestrator(true);
    try {
      const res = await apiRequest('PATCH', '/api/settings/orchestrator', { model });
      const data = await res.json().catch(() => ({}));
      applySelectedModel(String(data.selectedModel || model), data.modelPreferences);
    } catch {}
    setSavingOrchestrator(false);
  }, [applySelectedModel]);

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
    …38860 tokens truncated…          {doctorReport
                  ? `${doctorReport.summary.pass} passed · ${doctorReport.summary.warn} warned · ${doctorReport.summary.fail} failed${doctorReport.cached ? ' · cached' : ''}`
                  : 'Checks credentials, tokens, env vars, and connectivity'}
              </Text>
              {doctorReport && (
                <Text style={drStyles.ranAt}>
                  Last run: {new Date(doctorReport.ranAt ?? '').toLocaleTimeString()}
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
        </View>

        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
        <SectionHeader label="WORKSPACE FILES" accent="#8B5CF6" />
        <View style={[styles.card, { gap: 0 }]}>
          {workspaceLoading ? (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#8B5CF6" />
            </View>
          ) : !workspaceIsOwner ? (
            <View style={{ padding: 16 }}>
              <Text style={{ color: Colors.textSecondary, fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
                Workspace files are only accessible to the account owner.
              </Text>
            </View>
          ) : (
            <>
              <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 17 }}>
                  Plain-text files that compound over time — injected into every Jarvis session.
                </Text>
              </View>
              {([
                { key: 'soul', label: 'SOUL.md', icon: 'sparkles-outline' as const, desc: 'Persona & standing character instructions', value: workspaceSoul, setter: setWorkspaceSoul },
                { key: 'agents', label: 'AGENTS.md', icon: 'git-branch-outline' as const, desc: 'Operating principles & agent behaviour rules', value: workspaceAgents, setter: setWorkspaceAgents },
                { key: 'memory', label: 'MEMORY.md', icon: 'flash-outline' as const, desc: 'HOT memory — always loaded, auto-updated by agent', value: workspaceMemory, setter: setWorkspaceMemory },
              ] as const).map(({ key, label, icon, desc, value, setter }) => {
                const expanded = !!workspaceExpanded[key];
                const saving = !!workspaceSaving[key];
                return (
                  <View key={key} style={{ borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                    <Pressable
                      style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setWorkspaceExpanded(prev => ({ ...prev, [key]: !prev[key] }));
                      }}
                    >
                      <Ionicons name={icon} size={16} color="#8B5CF6" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.text }}>{label}</Text>
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>{desc}</Text>
                      </View>
                      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textTertiary} />
                    </Pressable>
                    {expanded && (
                      <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
                        <TextInput
                          value={value}
                          onChangeText={setter}
                          multiline
                          style={{
                            backgroundColor: Colors.surfaceAlt,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: Colors.border,
                            padding: 10,
                            fontSize: 12,
                            fontFamily: 'Inter_400Regular',
                            color: Colors.text,
                            minHeight: 120,
                            textAlignVertical: 'top',
                          }}
                          placeholderTextColor={Colors.textTertiary}
                          placeholder={`Edit ${label}...`}
                        />
                        <Pressable
                          style={[{
                            backgroundColor: '#8B5CF6',
                            borderRadius: 8,
                            paddingVertical: 9,
                            paddingHorizontal: 16,
                            alignSelf: 'flex-end',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                          }, saving && { opacity: 0.6 }]}
                          onPress={() => saveWorkspaceFile(key, value)}
                          disabled={saving}
                        >
                          {saving ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Ionicons name="checkmark" size={14} color="#fff" />
                          )}
                          <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                            {saving ? 'Saving…' : 'Save'}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
              <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexShrink: 1 }}>
                  <Ionicons name="trash-outline" size={13} color={archiveAfterSynth ? '#EF4444' : Colors.textTertiary} />
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: archiveAfterSynth ? '#EF4444' : Colors.textSecondary, flexShrink: 1 }}>
                    Clear logs after synthesis
                  </Text>
                </View>
                <Switch
                  value={archiveAfterSynth}
                  onValueChange={(v) => { Haptics.selectionAsync(); setArchiveAfterSynth(v); }}
                  trackColor={{ false: Colors.border, true: '#EF444460' }}
                  thumbColor={archiveAfterSynth ? '#EF4444' : Colors.textTertiary}
                  ios_backgroundColor={Colors.border}
                />
              </View>
              <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); synthesiseLearnings(); }}
                  disabled={synthesising}
                  style={[{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    backgroundColor: '#1E1B4B',
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: '#8B5CF6',
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                  }, synthesising && { opacity: 0.6 }]}
                >
                  {synthesising ? (
                    <ActivityIndicator size="small" color="#8B5CF6" />
                  ) : (
                    <Ionicons name="sparkles-outline" size={14} color="#8B5CF6" />
                  )}
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#8B5CF6' }}>
                    {synthesising ? 'Synthesising…' : 'Synthesise learnings'}
                  </Text>
                </Pressable>
              </View>
              {synthesisHistory.length > 0 && (
                <View style={{ borderTopWidth: 1, borderTopColor: Colors.border }}>
                  <Pressable
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setHistoryExpanded(prev => !prev); }}
                  >
                    <Ionicons name="time-outline" size={14} color={Colors.textTertiary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textSecondary }}>
                        Last synthesised{' '}
                        {(() => {
                          const latest = synthesisHistory[0];
                          if (!latest) return '';
                          const d = new Date(latest.createdAt);
                          return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                        })()}
                      </Text>
                      {synthesisHistory[0] && !synthesisHistory[0].skipped && (
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>
                          {synthesisHistory[0].bulletCount} lesson{synthesisHistory[0].bulletCount === 1 ? '' : 's'} · {synthesisHistory[0].triggeredBy}
                        </Text>
                      )}
                      {synthesisHistory[0]?.skipped && (
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>
                          Skipped — {synthesisHistory[0].skipReason ?? 'nothing to synthesise'}
                        </Text>
                      )}
                    </View>
                    <Ionicons name={historyExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={Colors.textTertiary} />
                  </Pressable>
                  {historyExpanded && (
                    <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 10 }}>
                      {synthesisHistory.map((run, idx) => {
                        const d = new Date(run.createdAt);
                        const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                        return (
                          <View key={run.id} style={{ gap: 4 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary }}>
                                {idx === 0 ? 'Latest — ' : ''}{label}
                              </Text>
                              <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>
                                · {run.triggeredBy}
                              </Text>
                            </View>
                            {run.skipped ? (
                              <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary, fontStyle: 'italic' }}>
                                Skipped — {run.skipReason ?? 'nothing to synthesise'}
                              </Text>
                            ) : (
                              run.bullets.map((bullet, bi) => (
                                <View key={bi} style={{ flexDirection: 'row', gap: 6, paddingLeft: 4 }}>
                                  <Text style={{ fontSize: 11, color: '#8B5CF6', fontFamily: 'Inter_400Regular' }}>•</Text>
                                  <Text style={{ flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 16 }}>
                                    {bullet.replace(/^- /, '')}
                                  </Text>
                                </View>
                              ))
                            )}
                            {idx < synthesisHistory.length - 1 && (
                              <View style={{ height: 1, backgroundColor: Colors.border, marginTop: 4 }} />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}
            </>
          )}
        </View>
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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
        </ErrorBoundary>

      </ScrollView>
      </ErrorBoundary>

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

      <SubsystemErrorSheet
        visible={subsystemSheetVisible}
        subsystemName={subsystemSheetName}
        subsystemLabel={subsystemSheetLabel}
        events={subsystemEvents}
        loading={subsystemEventsLoading}
        lastUpdated={subsystemEventsLastUpdated}
        styles={memSheetStyles}
        onClose={() => setSubsystemSheetVisible(false)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const providerAuthStyles = StyleSheet.create({
  providerCard: {
    gap: 10,
    paddingTop: 10,
  },
  providerCardBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 14,
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  providerHint: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    lineHeight: 15,
    marginTop: 4,
  },
  actionGrid: {
    gap: 8,
  },
  profileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  profileAction: {
    minHeight: 38,
    minWidth: '47%',
    flexGrow: 1,
    flexBasis: '47%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  profileActionActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  profileActionText: {
    color: Colors.text,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    flexShrink: 1,
  },
  profileActionTextActive: {
    color: '#fff',
  },
  primaryAction: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  oauthActionActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  apiKeyActionActive: {
    backgroundColor: '#0F766E',
    borderColor: '#0F766E',
  },
  defaultActionActive: {
    backgroundColor: Colors.textSecondary,
    borderColor: Colors.textSecondary,
  },
  disabledAction: {
    opacity: 0.55,
  },
  primaryActionText: {
    color: Colors.text,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    flexShrink: 1,
  },
  activeActionText: {
    color: '#fff',
  },
  localModelStatusRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  localModelStatusText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 16,
  },
  localModelRefresh: {
    minWidth: 26,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secretInput: {
    flex: 1,
    minHeight: 42,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    color: Colors.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  callbackInput: {
    flex: 1,
    minHeight: 42,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
  },
  saveButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  copyLoginRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  loginLinkActions: {
    alignItems: 'flex-start',
    gap: 4,
  },
  copyLoginText: {
    color: '#2563EB',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  statusText: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: 'Inter_400Regular',
  },
});

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
  quickNavCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  quickNavHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quickNavIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickNavCopy: {
    flex: 1,
    gap: 2,
  },
  quickNavTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  quickNavSubtitle: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  quickNavButton: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#10B98155',
    backgroundColor: '#10B98114',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  quickNavButtonText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: '#10B981',
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
  connBtnWarning: {
    borderColor: Colors.warning + '70',
    backgroundColor: Colors.warning + '18',
  },
  connBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.cyan,
  },
  connBtnTextConnected: {
    color: Colors.success,
  },
  connBtnTextWarning: {
    color: Colors.warning,
  },
  connectionActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  connectionSecondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  connectionSecondaryButtonText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
  connectionTestText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  connectionSteps: {
    gap: 5,
    marginTop: 2,
  },
  connectionStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  connectionStepNumber: {
    width: 18,
    height: 18,
    borderRadius: 9,
    textAlign: 'center',
    lineHeight: 18,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#C7D2FE',
    backgroundColor: '#6366F120',
  },
  connectionStepText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
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
  prefRowBordered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    gap: 12,
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
  memoryBannerSection: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 2,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  memoryBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: 4,
  },
  memoryBannerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    lineHeight: 17,
  },
  jobRunnerSection: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  jobRunnerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  jobRunnerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 2,
  },
  jobRunnerEvent: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    lineHeight: 16,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
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

const memSheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    maxHeight: '70%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 4,
    lineHeight: 17,
  },
  lastUpdated: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginBottom: 12,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  emptyRow: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 28,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  eventList: {
    flexGrow: 0,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    flexShrink: 0,
  },
  eventContent: {
    flex: 1,
    gap: 3,
  },
  eventMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  operationTag: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  eventTime: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  eventMessage: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
  },
});
