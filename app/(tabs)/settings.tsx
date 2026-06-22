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
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import Colors from '@/constants/colors';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { createAudioPlayer } from '@/lib/audio';
import * as FileSystem from 'expo-file-system/legacy';
import { ErrorBoundary } from '@/components/ErrorBoundary';
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
import { BuildHistorySection } from '@/components/settings/BuildHistorySection';
import { WakeWordSection } from '@/components/settings/WakeWordSection';
import { drStyles } from '@/components/settings/diagnosticsRunStyles';
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

interface TelegramStatus {
  connected: boolean;
  username: string | null;
  configured: boolean;
  botUsername?: string | null;
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

type OpenAIProviderAuthType = 'api_key' | 'oauth' | 'local';
interface OpenAIProviderAuthTypeStatus {
  connected: boolean;
  isDefault: boolean;
  email?: string;
  accountId?: string;
  expiresAt?: string;
}
interface OpenAIProviderAuthStatus {
  providerCatalog?: CatalogProvider[];
  providers?: Record<string, ProviderAuthProviderStatus>;
  openai: {
    connected: boolean;
    defaultAuthType: OpenAIProviderAuthType | null;
    fallbackEnabled: boolean;
    authTypes: Partial<Record<OpenAIProviderAuthType, OpenAIProviderAuthTypeStatus>>;
  };
}
interface ProviderAuthProviderStatus {
  connected: boolean;
  defaultAuthType: OpenAIProviderAuthType | null;
  fallbackEnabled?: boolean;
  authTypes: Partial<Record<OpenAIProviderAuthType, OpenAIProviderAuthTypeStatus>>;
}
interface CatalogProvider {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  credentialKinds: Array<'api_key' | 'oauth' | 'local'>;
  apiKeyPlaceholder?: string;
  setupHint: string;
}

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
  const diagnosticsYRef = useRef(0);
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
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [androidDaemonConnected, setAndroidDaemonConnected] = useState(false);
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
  const [coachingMode, setCoachingModeState] = useState<CoachingMode>('sharp');
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
    try {
      const res = await apiRequest('POST', '/api/coach/speak', {
        text: "Hi, I'm Jarvis. This is what I sound like with this voice.",
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
  const [synthesisHistory, setSynthesisHistory] = useState<Array<{
    id: number;
    createdAt: string;
    bulletCount: number;
    bullets: string[];
    triggeredBy: string;
    skipped: boolean;
    skipReason?: string | null;
  }>>([]);
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
    } catch (e) {
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
    const [telegramResult, integrationResult, channelsResult, connectionsResult] = await Promise.allSettled([
      apiRequest('GET', '/api/telegram/status').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      apiRequest('GET', '/api/integrations/status').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      apiRequest('GET', '/api/channels').then(r => r.ok ? r.json() : Promise.reject(r.status)),
      apiRequest('GET', '/api/connections/status').then(r => r.ok ? r.json() : Promise.reject(r.status)),
    ]);

    const telegramRes = telegramResult.status === 'fulfilled' ? telegramResult.value : null;
    const integrationRes = integrationResult.status === 'fulfilled' ? integrationResult.value : null;
    const channelsRes = channelsResult.status === 'fulfilled' ? channelsResult.value : null;
    const connectionsRes = connectionsResult.status === 'fulfilled' ? connectionsResult.value : null;

    // Show error row when any connections endpoint fails.
    const anyConnectionFailed = [telegramResult, integrationResult, channelsResult, connectionsResult]
      .some(r => r.status === 'rejected');
    setConnectionsError(anyConnectionFailed);

    if (telegramRes) setTelegramStatus({
      connected: telegramRes.connected ?? false,
      username: telegramRes.username ?? null,
      configured: telegramRes.configured ?? false,
      botUsername: telegramRes.botUsername ?? null,
    });
    const serverAndroidDaemonConnected =
      channelsRes?.meta?.android_daemon?.connected ?? channelsRes?.android_daemon_connected ?? false;
    const nativeAndroidDaemonStatus = await getAndroidDaemonStatus().catch(() => null);
    setAndroidAssistantStatus(nativeAndroidDaemonStatus);
    setAndroidDaemonConnected(serverAndroidDaemonConnected || nativeAndroidDaemonStatus?.connected === true);
    if (connectionsRes) setConnectionsStatus(normalizeConnectionsStatus(connectionsRes));
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

  const loadOpenAIProviderStatus = useCallback(async () => {
    setOpenAIAuthLoading(true);
    try {
      const res = await apiRequest('GET', '/api/auth/providers/status');
      if (res.ok) {
        const data = await res.json();
        setOpenAIProviderStatus(data);
        if (Array.isArray(data.providerCatalog)) setProviderCatalog(data.providerCatalog);
      }
    } catch {
      setOpenAIProviderStatus(null);
    } finally {
      setOpenAIAuthLoading(false);
    }
  }, []);

  // ── Local Gemma ──
  const loadLocalGemmaStatus = useCallback(async () => {
    setLocalGemmaStatusLoading(true);
    try {
      setLocalGemmaStatus(await readPhoneGemmaStatus());
    } catch (error: any) {
      setLocalGemmaStatus(createPhoneGemmaUnavailableStatus(
        extractApiError(error, `Import ${LOCAL_GEMMA_EXPECTED_FILE_NAME} from Downloads to store it inside Jarvis.`),
      ));
    } finally {
      setLocalGemmaStatusLoading(false);
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
      }
    } catch {}
    await loadModels();
    await loadOpenAIProviderStatus();
    await loadLocalGemmaStatus();
  }, [loadConnections, loadLocalGemmaStatus, loadModels, loadOpenAIProviderStatus]);

  useFocusEffect(useCallback(() => {
    loadAll();
    loadNervousSystem();
    loadThreatLog();
    loadBuildHistory();
    loadHealth();
    loadJobRunnerReport();
    loadMcpServers();
    loadMcpServerKey();
    loadWorkspaceFiles();
    loadGithubSettings();
    loadGithubOAuthAvailable();
    return () => {
      if (telegramPollRef.current) {
        clearInterval(telegramPollRef.current);
        telegramPollRef.current = null;
      }
      if (githubPollRef.current) {
        clearInterval(githubPollRef.current);
        githubPollRef.current = null;
      }
    };
  }, [loadAll, loadNervousSystem, loadThreatLog, loadBuildHistory, loadHealth, loadJobRunnerReport, loadMcpServers, loadMcpServerKey, loadWorkspaceFiles]));

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
  const scrollToDiagnostics = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    scrollViewRef.current?.scrollTo({ y: Math.max(0, diagnosticsYRef.current - 8), animated: true });
  }, []);

  useEffect(() => {
    if (!scrollTo) return;
    if (scrollTo === 'diagnostics' || scrollTo === 'runtime') {
      const timer = setTimeout(scrollToDiagnostics, 400);
      return () => clearTimeout(timer);
    }
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
  }, [scrollTo, scrollToDiagnostics]);

  // ── Helpers ──
  // Triggers an immediate server-side re-validation for the current user so
  // the DB integration_status rows are fresh before loadAll() re-reads them.
  const refreshIntegrationHealth = useCallback(async () => {
    try {
      await apiRequest('POST', '/api/integrations/refresh');
    } catch {}
  }, []);

  // ── Telegram link ──
  const handleTelegramLink = useCallback(async () => {
    try {
      const res = await apiRequest('POST', '/api/telegram/link-code');
      const data = await res.json();
      if (data.code) {
        setTelegramLinkCode(data.code);
        setTelegramStatus(prev => ({ ...prev, botUsername: data.botUsername ?? prev.botUsername ?? null }));
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
              setTelegramStatus({
                connected: true,
                username: status.username ?? null,
                configured: true,
                botUsername: status.botUsername ?? data.botUsername ?? null,
              });
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
            setTelegramStatus(prev => ({ connected: false, username: null, configured: false, botUsername: prev.botUsername ?? null }));
            setIntegrationHealth(prev => ({ ...prev, telegram: 'unconfigured' }));
            setIntegrationErrors(prev => ({ ...prev, telegram: null }));
          } catch {}
        },
      },
    ]);
  }, [refreshIntegrationHealth]);

  // ── Android Daemon ──
  const handleAndroidDaemon = useCallback(async () => {
    if (androidDaemonConnected || androidDaemonBusy) return;
    setAndroidDaemonBusy(true);
    setAndroidDaemonError(null);
    try {
      if (Platform.OS !== 'android' || !AndroidDaemonNative) {
        const baseUrl = getApiUrl().replace(/\/+$/, '');
        await Linking.openURL(`${baseUrl}/api/download/android`);
        return;
      }
      const res = await apiRequest('POST', '/api/channels/android-daemon/bootstrap');
      const data = await res.json();
      const bootstrapToken = String(data.bootstrapToken ?? '');
      if (!bootstrapToken) throw new Error('Android device bootstrap token was not returned.');
      const status = await AndroidDaemonNative.enable(getApiUrl(), bootstrapToken);
      setAndroidDaemonConnected(status.connected);
      setAndroidAssistantStatus(status);
      await loadConnections();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to enable Android device control.';
      setAndroidDaemonError(message);
      Alert.alert('Android Device Control', message);
    } finally {
      setAndroidDaemonBusy(false);
    }
  }, [androidDaemonBusy, androidDaemonConnected, loadConnections]);

  const openAndroidAccessibilitySettings = useCallback(async () => {
    if (Platform.OS !== 'android' || !AndroidDaemonNative?.openAccessibilitySettings) return;
    setAndroidDaemonBusy(true);
    setAndroidDaemonError(null);
    try {
      await AndroidDaemonNative.openAccessibilitySettings();
      setTimeout(() => {
        getAndroidDaemonStatus()
          .then((next) => {
            setAndroidAssistantStatus(next);
            setAndroidDaemonConnected(next.connected);
          })
          .catch(() => {});
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Open Android Accessibility settings and enable Jarvis Device Control.';
      setAndroidDaemonError(message);
      Alert.alert('Android Accessibility', message);
    } finally {
      setAndroidDaemonBusy(false);
    }
  }, []);

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
    setWakeWordEnabled(val);
    await saveWakeSettings({ wakeWordEnabled: val });
  }, [saveWakeSettings]);

  const toggleTalkMode = useCallback(async (val: boolean) => {
    setTalkModeEnabled(val);
    await saveWakeSettings({ talkModeEnabled: val });
  }, [saveWakeSettings]);

  const refreshAndroidAssistantStatus = useCallback(async () => {
    const next = await getAndroidDaemonStatus();
    setAndroidAssistantStatus(next);
    return next;
  }, []);

  const openAndroidAssistantSettings = useCallback(async () => {
    if (Platform.OS !== 'android' || !AndroidDaemonNative?.openAssistantSettings) return;
    try {
      await AndroidDaemonNative.openAssistantSettings();
      setTimeout(() => {
        refreshAndroidAssistantStatus().catch(() => {});
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to open Android assistant settings.';
      Alert.alert('Android Assistant', message);
    }
  }, [refreshAndroidAssistantStatus]);

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

  const openHostedConnectionLink = useCallback(async (url: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.assign(url);
      return;
    }
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
    }).catch(() => {
      void Linking.openURL(url);
    });
  }, []);

  const startOpenAIChatGPTOAuth = useCallback(async () => {
    setOpenAIAuthBusy(true);
    setOpenAIAuthMessage(null);
    try {
      const res = await authFetch(new URL('/api/auth/openai-oauth/start', getApiUrl()).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'OpenAI OAuth is not configured yet.');
      }
      if (typeof data.loginUrl !== 'string' || !data.loginUrl) {
        throw new Error(data.message || 'OpenAI OAuth is not configured yet.');
      }
      setOpenAILoginUrl(data.loginUrl);
      setOpenAIAuthMessage(data.instructions ?? 'Open the login URL. Paste the callback URL here if localhost cannot load.');
      if (Platform.OS !== 'web') {
        await openHostedConnectionLink(data.loginUrl);
      }
    } catch (error: any) {
      const message = error?.message || 'Jarvis could not start OpenAI OAuth.';
      setOpenAIAuthMessage(message);
      Alert.alert('Connect ChatGPT Subscription', message);
    } finally {
      setOpenAIAuthBusy(false);
    }
  }, [openHostedConnectionLink]);

  const openOpenAILoginUrl = useCallback(async () => {
    if (!openAILoginUrl) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(openAILoginUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    await openHostedConnectionLink(openAILoginUrl);
  }, [openAILoginUrl, openHostedConnectionLink]);

  const saveOpenAIApiKey = useCallback(async () => {
    const apiKey = openAIApiKeyInput.trim();
    if (!apiKey) return;
    setOpenAIAuthBusy(true);
    try {
      const res = await apiRequest('POST', '/api/auth/openai-api-key', { apiKey });
      const data = await res.json().catch(() => ({}));
      if (data.selectedModel) applySelectedModel(String(data.selectedModel), data.modelPreferences);
      setOpenAIApiKeyInput('');
      setOpenAIApiKeyVisible(false);
      setOpenAIAuthMessage('OpenAI API key saved and selected for this Jarvis account.');
      await loadOpenAIProviderStatus();
    } catch (error: any) {
      Alert.alert('Use OpenAI API Key', error?.message || 'Jarvis could not save the API key.');
    } finally {
      setOpenAIAuthBusy(false);
    }
  }, [applySelectedModel, loadOpenAIProviderStatus, openAIApiKeyInput]);

  const setProviderMessage = useCallback((providerId: string, message: string) => {
    setProviderAuthMessages((prev) => ({ ...prev, [providerId]: message }));
  }, []);

  const validateAndroidLocalGemma = useCallback(async (profile: PhoneGemmaValidationProfile = PHONE_GEMMA_RECOMMENDED_PROFILE): Promise<LocalGemmaModelStatus | null> => {
    setLocalGemmaValidating(true);
    setLocalGemmaActiveProfileId(profile.id);
    setProviderMessage('android-local-gemma', `Validating Phone Gemma with ${profile.label}...`);
    try {
      const status = await validatePhoneGemmaRuntime(profile);
      setLocalGemmaStatus(status);
      const size = formatModelSize(status.sizeBytes);
      const details = phoneGemmaRuntimeDetails(status);
      const message = status.generationReady
        ? `Phone Gemma validated${details ? ` via ${details}` : ''}${size ? ` (${size})` : ''}.`
        : `${status.message || LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE}${size ? ` (${size})` : ''}`;
      setProviderMessage('android-local-gemma', message);
      return status;
    } catch (error: any) {
      const message = extractApiError(error, 'Phone Gemma could not validate the LiteRT-LM engine on this device.');
      setProviderMessage('android-local-gemma', message);
      Alert.alert('Validate Phone Gemma', message);
      await loadLocalGemmaStatus();
      return null;
    } finally {
      setLocalGemmaValidating(false);
      setLocalGemmaActiveProfileId(null);
    }
  }, [loadLocalGemmaStatus, setProviderMessage]);

  const runAndroidLocalGemmaSmokeTest = useCallback(async () => {
    setLocalGemmaSmokeTesting(true);
    setProviderMessage('android-local-gemma', 'Running Phone Gemma local smoke test...');
    try {
      const result = await smokeTestPhoneGemmaRuntime();
      const message = summarizePhoneGemmaSmokeTest(result);
      setProviderMessage('android-local-gemma', message);
      Alert.alert('Phone Gemma smoke test', message);
      await loadLocalGemmaStatus();
    } catch (error: any) {
      const message = extractApiError(error, 'Phone Gemma smoke test could not run.');
      setProviderMessage('android-local-gemma', message);
      Alert.alert('Phone Gemma smoke test', message);
      await loadLocalGemmaStatus();
    } finally {
      setLocalGemmaSmokeTesting(false);
    }
  }, [loadLocalGemmaStatus, setProviderMessage]);

  const selectAndroidLocalGemma = useCallback(async () => {
    let status = localGemmaStatus;
    const localGemmaModelFileReady = isPhoneGemmaModelFileReady(status);
    if (localGemmaModelFileReady && !isPhoneGemmaGenerationReady(status)) {
      const validated = await validateAndroidLocalGemma();
      if (isPhoneGemmaGenerationReady(validated)) {
        status = validated;
      } else {
        return;
      }
    }

    const localGemmaGenerationReady = isPhoneGemmaGenerationReady(status);
    if (!localGemmaGenerationReady) {
      const message = localGemmaModelFileReady
        ? status?.message || LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE
        : `Import ${LOCAL_GEMMA_EXPECTED_FILE_NAME} before using Phone Gemma for Jarvis chat.`;
      setProviderMessage('android-local-gemma', message);
      Alert.alert('Use Phone Gemma', message);
      return;
    }

    setOpenAIAuthBusy(true);
    try {
      const res = await apiRequest('PATCH', '/api/settings/models', {
        category: 'chat',
        model: ANDROID_LOCAL_GEMMA_MODEL,
      });
      const data = await res.json().catch(() => ({}));
      applySelectedModel(String(data.selectedModel || ANDROID_LOCAL_GEMMA_MODEL), data.modelPreferences);
      setProviderMessage('android-local-gemma', 'Phone Gemma is selected for Jarvis model routing.');
    } catch (error: any) {
      const message = extractApiError(error, 'Jarvis could not select Phone Gemma.');
      setProviderMessage('android-local-gemma', message);
      Alert.alert('Use Phone Gemma', message);
    } finally {
      setOpenAIAuthBusy(false);
    }
  }, [applySelectedModel, localGemmaStatus, setProviderMessage, validateAndroidLocalGemma]);

  const importAndroidLocalGemma = useCallback(async () => {
    setLocalGemmaImporting(true);
    setProviderMessage('android-local-gemma', `Opening Android file picker for ${LOCAL_GEMMA_EXPECTED_FILE_NAME}.`);
    try {
      const status = await importPhoneGemmaModelFile();
      if (!status) {
        setProviderMessage('android-local-gemma', 'Model import cancelled.');
        return;
      }
      setLocalGemmaStatus(status);
      const size = formatModelSize(status.sizeBytes);
      setProviderMessage('android-local-gemma', status.generationReady
        ? `Imported ${status.sourceName || LOCAL_GEMMA_EXPECTED_FILE_NAME}${size ? ` (${size})` : ''} into Jarvis app storage.`
        : `${status.message || LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE}${size ? ` (${size})` : ''}`);
      await loadLocalGemmaStatus();
    } catch (error: any) {
      const message = extractApiError(error, 'Jarvis could not import the selected model file.');
      setProviderMessage('android-local-gemma', message);
      Alert.alert('Import model file', message);
    } finally {
      setLocalGemmaImporting(false);
    }
  }, [loadLocalGemmaStatus, setProviderMessage]);

  const saveProviderApiKey = useCallback(async (providerId: string) => {
    const apiKey = (providerApiKeyInputs[providerId] ?? '').trim();
    if (!apiKey) return;
    setOpenAIAuthBusy(true);
    try {
      const res = await apiRequest('POST', '/api/auth/model-provider-api-key', { provider: providerId, apiKey });
      const data = await res.json().catch(() => ({}));
      if (data.selectedModel) applySelectedModel(String(data.selectedModel), data.modelPreferences);
      setProviderApiKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      setProviderApiKeyVisible((prev) => ({ ...prev, [providerId]: false }));
      setProviderMessage(providerId, 'Provider API key saved and selected for this Jarvis account.');
      await loadOpenAIProviderStatus();
    } catch (error: any) {
      const message = error?.message || 'Jarvis could not save this provider key.';
      setProviderMessage(providerId, message);
      Alert.alert('Save Provider Key', message);
    } finally {
      setOpenAIAuthBusy(false);
    }
  }, [applySelectedModel, loadOpenAIProviderStatus, providerApiKeyInputs, setProviderMessage]);

  const disconnectProvider = useCallback((providerId: string, label: string) => {
    Alert.alert(
      `Disconnect ${label}`,
      `Remove stored credentials for ${label} from this Jarvis account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setOpenAIAuthBusy(true);
            try {
              const res = await apiRequest('DELETE', `/api/auth/providers/${encodeURIComponent(providerId)}`);
              const data = await res.json().catch(() => ({}));
              if (data.selectedModel) applySelectedModel(String(data.selectedModel), data.modelPreferences);
              setProviderMessage(providerId, `${label} credentials removed.`);
              await loadOpenAIProviderStatus();
            } catch (error: any) {
              const message = error?.message || `Jarvis could not disconnect ${label}.`;
              setProviderMessage(providerId, message);
              Alert.alert(`Disconnect ${label}`, message);
            } finally {
              setOpenAIAuthBusy(false);
            }
          },
        },
      ],
    );
  }, [applySelectedModel, loadOpenAIProviderStatus, setProviderMessage]);

  const submitOpenAICallbackUrl = useCallback(async () => {
    const callbackUrl = openAICallbackUrl.trim();
    if (!callbackUrl) return;
    setOpenAIAuthBusy(true);
    try {
      const res = await apiRequest('POST', '/api/auth/openai-oauth/callback-url', { callbackUrl });
      const data = await res.json().catch(() => ({}));
      if (data.selectedModel) applySelectedModel(String(data.selectedModel), data.modelPreferences);
      setOpenAICallbackUrl('');
      setOpenAIAuthMessage('ChatGPT subscription connected and selected for this Jarvis account.');
      await loadOpenAIProviderStatus();
    } catch (error: any) {
      Alert.alert('Finish OpenAI Login', error?.message || 'Jarvis could not complete OpenAI OAuth.');
    } finally {
      setOpenAIAuthBusy(false);
    }
  }, [applySelectedModel, loadOpenAIProviderStatus, openAICallbackUrl]);

  const useJarvisDefaultModel = useCallback(() => {
    Alert.alert(
      'Use Jarvis Default Model',
      'This removes stored OpenAI API-key and OAuth profiles from this Jarvis account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Use Default',
          style: 'destructive',
          onPress: async () => {
            setOpenAIAuthBusy(true);
            try {
              const res = await apiRequest('DELETE', '/api/auth/providers/openai?resetSelectedModel=1');
              const data = await res.json().catch(() => ({}));
              if (data.selectedModel) applySelectedModel(String(data.selectedModel), data.modelPreferences);
              setOpenAIAuthMessage('Jarvis default model route is active.');
              await loadOpenAIProviderStatus();
            } catch (error: any) {
              Alert.alert('Use Jarvis Default Model', error?.message || 'Jarvis could not reset the OpenAI provider.');
            } finally {
              setOpenAIAuthBusy(false);
            }
          },
        },
      ],
    );
  }, [applySelectedModel, loadOpenAIProviderStatus]);

  const connectExternalApp = useCallback(async (appId: ConnectionAppId) => {
    const app = CONNECTION_APPS.find((item) => item.id === appId);
    setConnectionBusyApp(`connect:${appId}`);
    try {
      const res = await apiRequest('POST', '/api/connections/connect-link', { appId, app: appId });
      const data = await res.json();
      const url = data?.url ?? data?.connectUrl ?? data?.connectLink ?? data?.oauthUrl ?? data?.authUrl ?? data?.link;
      if (typeof url !== 'string' || !url) {
        throw new Error('Jarvis could not create a hosted connection link.');
      }
      await openHostedConnectionLink(url);
      setConnectionTestSummary(`${app?.label ?? 'App'} connection opened in your browser.`);
      await loadConnections();
    } catch (error: any) {
      Alert.alert('Connect app', error?.message || `Jarvis could not start ${app?.label ?? 'that app'} connection.`);
    } finally {
      setConnectionBusyApp(null);
    }
  }, [loadConnections, openHostedConnectionLink]);

  const disconnectExternalApp = useCallback((appId: ConnectionAppId) => {
    const app = CONNECTION_APPS.find((item) => item.id === appId);
    Alert.alert('Disconnect app', `Disconnect ${app?.label ?? 'this app'} from Jarvis?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          setConnectionBusyApp(`disconnect:${appId}`);
          try {
            await apiRequest('POST', '/api/connections/disconnect', { appId, app: appId });
            setConnectionTestSummary(`${app?.label ?? 'App'} disconnected.`);
            await loadConnections();
          } catch (error: any) {
            Alert.alert('Disconnect app', error?.message || `Jarvis could not disconnect ${app?.label ?? 'that app'}.`);
          } finally {
            setConnectionBusyApp(null);
          }
        },
      },
    ]);
  }, [loadConnections]);

  const testExternalApp = useCallback(async (appId: ConnectionAppId) => {
    const app = CONNECTION_APPS.find((item) => item.id === appId);
    setConnectionBusyApp(`test:${appId}`);
    try {
      const res = await apiRequest('POST', '/api/connections/test', { appId, app: appId });
      const data = await res.json();
      const result = normalizeConnectionTestResult(data);
      setConnectionTestSummary(`${app?.label ?? 'App'}: ${result.summary}`);
      if (data?.connections || data?.apps || data?.statuses) {
        setConnectionsStatus(normalizeConnectionsStatus(data));
      } else {
        await loadConnections();
      }
      if (result.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setConnectionTestSummary(`Jarvis could not test ${app?.label ?? 'that app'} right now.`);
    } finally {
      setConnectionBusyApp(null);
    }
  }, [loadConnections]);

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
  const openAIStatus = openAIProviderStatus?.providers?.openai ?? openAIProviderStatus?.openai;
  const openAIApiKeyStatus = openAIStatus?.authTypes.api_key;
  const openAIOAuthStatus = openAIStatus?.authTypes.oauth;
  const openAIDefaultLabel =
    openAIStatus?.defaultAuthType === 'oauth'
      ? 'ChatGPT subscription'
      : openAIStatus?.defaultAuthType === 'api_key'
        ? 'OpenAI API key'
        : 'Jarvis default model';
  const modelProviderCards = (providerCatalog.length > 0 ? providerCatalog : MODEL_PROVIDER_CATALOG)
    .filter((provider) => provider.id !== 'openai');
  const androidDaemonNativeAvailable = Platform.OS === 'android' && !!AndroidDaemonNative && androidAssistantStatus?.available !== false;
  const androidDaemonNeedsAccessibility = androidDaemonNativeAvailable && androidDaemonConnected && androidAssistantStatus?.accessibilityEnabled === false;
  const androidDaemonCheckingAccessibility = androidDaemonNativeAvailable && androidDaemonConnected && androidAssistantStatus?.accessibilityEnabled === undefined;
  const androidDaemonReady = androidDaemonConnected && !androidDaemonNeedsAccessibility && !androidDaemonCheckingAccessibility;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SETTINGS</Text>
        <Text style={styles.headerUser}>{userName || authUsername || 'Agent'}</Text>
      </View>

      <ErrorBoundary FallbackComponent={SettingsFallback}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90 }]}
        showsVerticalScrollIndicator={false}
      >

        <View style={styles.quickNavCard}>
          <View style={styles.quickNavHeader}>
            <View style={[styles.quickNavIconWrap, { backgroundColor: '#10B98120' }]}>
              <Ionicons name="pulse-outline" size={18} color="#10B981" />
            </View>
            <View style={styles.quickNavCopy}>
              <Text style={styles.quickNavTitle}>Runtime checks</Text>
              <Text style={styles.quickNavSubtitle}>Jump to Runtime Preview and configuration diagnostics.</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to Runtime Preview diagnostics"
            testID="settings-runtime-diagnostics-jump"
            style={styles.quickNavButton}
            onPress={scrollToDiagnostics}
          >
            <Text style={styles.quickNavButtonText}>Runtime Preview</Text>
            <Ionicons name="arrow-down-outline" size={15} color="#10B981" />
          </Pressable>
        </View>

        <ErrorBoundary FallbackComponent={SectionFallback}>
        {/* ── CONNECTIONS ── */}
        <SectionHeader label="CONNECTIONS" accent={Colors.cyan} />

        <View style={styles.card}>
          {connectionsError && (
            <SectionErrorRow message="Couldn't load connections" onRetry={loadConnections} />
          )}
          <View style={styles.connRow}>
            <View style={[styles.connIconWrap, { backgroundColor: '#6366F120' }]}>
              <Ionicons name="git-network-outline" size={18} color="#6366F1" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>App Connections</Text>
              <Text style={styles.connSub}>
                Use hosted sign-in links for mail, calendars, team chat, files, and tasks. No secrets to paste.
              </Text>
              {connectionsStatus?.error ? (
                <Text style={[styles.connSub, { color: Colors.warning }]}>{connectionsStatus.error}</Text>
              ) : null}
            </View>
            <Pressable
              style={[styles.connBtn, styles.connBtnDisconnected, { borderColor: '#6366F1' }]}
              onPress={loadConnections}
            >
              <Text style={[styles.connBtnText, { color: '#6366F1' }]}>Refresh</Text>
            </Pressable>
          </View>

          {CONNECTION_APPS.map((app) => {
            const appStatus = connectionsStatus?.apps[app.id];
            const connected = appStatus?.connected ?? false;
            const statusLabel = appStatus ? getConnectionStatusLabel(appStatus) : 'Connect';
            const connectBusy = connectionBusyApp === `connect:${app.id}`;
            const disconnectBusy = connectionBusyApp === `disconnect:${app.id}`;
            const testBusy = connectionBusyApp === `test:${app.id}`;
            const statusText = connected
              ? appStatus?.accountLabel || 'Connected'
              : appStatus?.error || (statusLabel === 'Reconnect' ? 'Needs reconnect' : app.description);
            return (
              <View key={app.id} style={[styles.connRow, styles.connRowBorder]}>
                <View style={[styles.connIconWrap, { backgroundColor: app.color + '20' }]}>
                  <Ionicons name={app.icon as keyof typeof Ionicons.glyphMap} size={18} color={app.color} />
                </View>
                <View style={styles.connInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={styles.connName}>{app.label}</Text>
                    <StatusDot status={connected ? 'healthy' : statusLabel === 'Reconnect' ? 'broken' : 'unconfigured'} />
                  </View>
                  <Text style={[styles.connSub, appStatus?.error && { color: Colors.warning }]}>{statusText}</Text>
                  <View style={styles.connectionActionsRow}>
                    <Pressable
                      style={[styles.connBtn, { borderColor: app.color, opacity: connectBusy ? 0.65 : 1 }]}
                      onPress={() => connectExternalApp(app.id)}
                      disabled={connectBusy || disconnectBusy || testBusy}
                    >
                      <Text style={[styles.connBtnText, { color: app.color }]}>
                        {connectBusy ? 'Opening' : connected ? 'Reconnect' : statusLabel}
                      </Text>
                    </Pressable>
                    {connected ? (
                      <Pressable
                        style={[styles.connBtn, { borderColor: Colors.border, opacity: disconnectBusy ? 0.65 : 1 }]}
                        onPress={() => disconnectExternalApp(app.id)}
                        disabled={connectBusy || disconnectBusy || testBusy}
                      >
                        <Text style={[styles.connBtnText, { color: Colors.textTertiary }]}>
                          {disconnectBusy ? 'Disconnecting' : 'Disconnect'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={[styles.connectionSecondaryButton, { opacity: testBusy ? 0.65 : 1 }]}
                      onPress={() => testExternalApp(app.id)}
                      disabled={connectBusy || disconnectBusy || testBusy}
                    >
                      {testBusy ? (
                        <ActivityIndicator size="small" color={Colors.textSecondary} />
                      ) : (
                        <Ionicons name="pulse-outline" size={15} color={Colors.textSecondary} />
                      )}
                      <Text style={styles.connectionSecondaryButtonText}>{testBusy ? 'Testing' : 'Test'}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}

          {connectionTestSummary ? <Text style={styles.connectionTestText}>{connectionTestSummary}</Text> : null}
          {connectionsStatus?.nextSteps?.length ? (
            <View style={styles.connectionSteps}>
              {connectionsStatus.nextSteps.slice(0, 3).map((step, idx) => (
                <View key={`${step}-${idx}`} style={styles.connectionStepRow}>
                  <Text style={styles.connectionStepNumber}>{idx + 1}</Text>
                  <Text style={styles.connectionStepText}>{step}</Text>
                </View>
              ))}
            </View>
          ) : null}


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
              <Text style={styles.linkCodeLabel}>
                Send this code to {telegramStatus.botUsername ? `@${telegramStatus.botUsername}` : 'the Jarvis Telegram bot'}:
              </Text>
              <Text style={styles.linkCode}>{telegramLinkCode}</Text>
              {telegramPolling && (
                <View style={styles.linkCodeWait}>
                  <ActivityIndicator size="small" color={Colors.cyan} />
                  <Text style={styles.linkCodeWaitText}>Waiting for connection...</Text>
                </View>
              )}
            </View>
          )}



          {/* Android Device Control */}
          <View style={[styles.connRow, styles.connRowBorder]}>
            <View style={[styles.connIconWrap, { backgroundColor: Colors.successDim }]}>
              <Ionicons name="phone-portrait-outline" size={18} color={Colors.success} />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Jarvis OS Device Control</Text>
              <Text style={styles.connSub}>
                {androidDaemonNeedsAccessibility
                  ? 'Connected - enable Accessibility for app control'
                  : androidDaemonCheckingAccessibility
                    ? 'Connected - checking Accessibility setup'
                  : androidDaemonReady
                  ? 'Connected'
                  : Platform.OS === 'android'
                    ? 'Enable phone control in this app'
                    : 'Open Jarvis OS on Android to enable'}
              </Text>
            </View>
            <Pressable
              style={[
                styles.connBtn,
                androidDaemonReady ? styles.connBtnConnected : styles.connBtnDisconnected,
                androidDaemonNeedsAccessibility && styles.connBtnWarning,
              ]}
              onPress={androidDaemonNeedsAccessibility ? openAndroidAccessibilitySettings : handleAndroidDaemon}
              disabled={(androidDaemonConnected && !androidDaemonNeedsAccessibility) || androidDaemonBusy}
            >
              <Text style={[
                styles.connBtnText,
                androidDaemonReady && styles.connBtnTextConnected,
                androidDaemonNeedsAccessibility && styles.connBtnTextWarning,
              ]}>
                {androidDaemonBusy
                  ? '...'
                  : androidDaemonNeedsAccessibility
                    ? 'Accessibility'
                    : androidDaemonReady
                      ? 'Ready'
                      : androidDaemonCheckingAccessibility
                        ? 'Checking'
                        : Platform.OS === 'android' ? 'Enable' : 'Install'}
              </Text>
            </Pressable>
          </View>
          {androidDaemonNeedsAccessibility && (
            <View style={styles.linkCodeBlock}>
              <Text style={styles.linkCodeLabel}>
                Device Control is connected, but opening apps, screenshots, taps, typing, and screen reading require the Jarvis Accessibility Service.
              </Text>
              <Pressable style={[styles.connBtn, styles.connBtnWarning, { alignSelf: 'flex-start', marginTop: 10 }]} onPress={openAndroidAccessibilitySettings}>
                <Text style={[styles.connBtnText, styles.connBtnTextWarning]}>Open Accessibility</Text>
              </Pressable>
            </View>
          )}
          {androidDaemonError && (
            <View style={styles.linkCodeBlock}>
              <Text style={styles.linkCodeLabel}>{androidDaemonError}</Text>
            </View>
          )}
        </View>
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
        {/* ── GITHUB ── */}
        <SectionHeader label="GITHUB" accent="#6e40c9" />
        <View style={styles.card}>
          <Pressable
            onPress={() => setGithubExpanded(e => !e)}
            style={styles.connRow}
          >
            <View style={[styles.connIconWrap, { backgroundColor: '#6e40c920' }]}>
              <Ionicons name="git-branch-outline" size={18} color="#6e40c9" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>GitHub</Text>
              <Text style={styles.connSub}>
                {githubConnected
                  ? `${githubUsername ? `@${githubUsername}` : `Via ${githubTokenType === 'oauth' ? 'OAuth' : 'PAT'}`} · ${githubRepos.length} repo${githubRepos.length !== 1 ? 's' : ''} tracked`
                  : 'Connect to enable PR tools and CI monitoring'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {githubConnected && (
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success }} />
              )}
              <Ionicons
                name={githubExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                size={16}
                color={Colors.textSecondary}
              />
            </View>
          </Pressable>

          {githubExpanded && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>

              {/* ── Connected state ── */}
              {githubConnected ? (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.border }}>
                      <Text style={{ color: Colors.success, fontFamily: 'Inter_500Medium', fontSize: 13 }}>
                        ✓ {githubUsername ? `Connected as @${githubUsername}` : githubTokenType === 'oauth' ? 'Connected via GitHub OAuth' : 'Personal Access Token saved'}
                      </Text>
                    </View>
                    <Pressable
                      onPress={removeGithubPat}
                      style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: Colors.error + '20', borderRadius: 8, borderWidth: 1, borderColor: Colors.error + '40' }}
                    >
                      <Text style={{ color: Colors.error, fontFamily: 'Inter_500Medium', fontSize: 13 }}>Disconnect</Text>
                    </Pressable>
                  </View>
                </View>
              ) : githubOAuthFlowing ? (
                /* ── Device Flow in progress ── */
                <View style={{ marginTop: 12, gap: 12 }}>
                  <View style={{ padding: 14, backgroundColor: '#6e40c910', borderRadius: 10, borderWidth: 1, borderColor: '#6e40c930', gap: 10 }}>
                    <Text style={{ color: Colors.text, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>
                      Authorize on GitHub
                    </Text>
                    <Text style={{ color: Colors.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
                      1. Go to{' '}
                      <Text
                        style={{ color: '#6e40c9', fontFamily: 'Inter_600SemiBold' }}
                        onPress={() => githubVerificationUri && WebBrowser.openBrowserAsync(githubVerificationUri)}
                      >
                        {githubVerificationUri ?? 'github.com/login/device'}
                      </Text>
                    </Text>
                    <Text style={{ color: Colors.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
                      2. Enter this code:
                    </Text>
                    <Pressable
                      onPress={copyGithubUserCode}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.border }}
                    >
                      <Text style={{ color: '#6e40c9', fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: 4 }}>
                        {githubUserCode ?? '—'}
                      </Text>
                      <Ionicons
                        name={githubCodeCopied ? 'checkmark-outline' : 'copy-outline'}
                        size={18}
                        color={githubCodeCopied ? Colors.success : Colors.textSecondary}
                      />
                    </Pressable>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {githubOAuthPolling && <ActivityIndicator size="small" color="#6e40c9" />}
                      <Text style={{ flex: 1, color: Colors.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                        {githubOAuthPolling ? 'Waiting for authorization…' : 'Starting…'}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={cancelGithubOAuth}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: Colors.border }}
                  >
                    <Text style={{ color: Colors.textSecondary, fontFamily: 'Inter_500Medium', fontSize: 13 }}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                /* ── Not connected: show connect options ── */
                <View style={{ marginTop: 12, gap: 8 }}>
                  {githubOAuthAvailable ? (
                    <View style={{ gap: 6 }}>
                      <Pressable
                        onPress={startGithubOAuth}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, backgroundColor: '#6e40c9', borderRadius: 8 }}
                      >
                        <Ionicons name="logo-github" size={16} color="#fff" />
                        <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>Connect with GitHub</Text>
                      </Pressable>
                      <Text style={{ color: Colors.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
                        Requests access: repo, read:user
                      </Text>
                    </View>
                  ) : (
                    <View style={{ padding: 12, backgroundColor: '#6e40c910', borderRadius: 10, borderWidth: 1, borderColor: '#6e40c930', gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="information-circle-outline" size={15} color="#6e40c9" />
                        <Text style={{ color: '#6e40c9', fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>
                          OAuth not configured
                        </Text>
                      </View>
                      <Text style={{ color: Colors.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 }}>
                        To enable one-tap GitHub login, an admin must create a GitHub OAuth App and set the{' '}
                        <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.text }}>GITHUB_CLIENT_ID</Text>
                        {' '}secret in the Railway environment.
                      </Text>
                      <Text style={{ color: Colors.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 }}>
                        Setup steps:{'\n'}
                        {'1. '}Go to{' '}
                        <Text
                          style={{ color: '#6e40c9', fontFamily: 'Inter_600SemiBold' }}
                          onPress={() => WebBrowser.openBrowserAsync('https://github.com/settings/developers')}
                        >
                          github.com/settings/developers
                        </Text>
                        {'\n'}
                        {'2. Click "New OAuth App" and fill in any name and homepage URL.\n'}
                        {'3. '}Set Authorization callback URL to any valid URL (Device Flow does not use it).{'\n'}
                        {'4. Enable "Device Flow" in the app settings.\n'}
                        {'5. '}Copy the Client ID and add it as the{' '}
                        <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.text }}>GITHUB_CLIENT_ID</Text>
                        {' '}variable in Railway.{'\n'}
                        {'   '}(No client secret needed for Device Flow.)
                      </Text>
                      <Text style={{ color: Colors.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                        Requested scopes: repo, read:user
                      </Text>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 2 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
                    <Text style={{ color: Colors.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular' }}>or use a Personal Access Token</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
                  </View>

                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.surface, overflow: 'hidden' }}>
                      <TextInput
                        style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, color: Colors.text, fontFamily: 'Inter_400Regular', fontSize: 13 }}
                        placeholder="ghp_xxxxxxxxxxxx"
                        placeholderTextColor={Colors.textTertiary}
                        value={githubPatInput}
                        onChangeText={setGithubPatInput}
                        secureTextEntry={!githubPatVisible}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Pressable onPress={() => setGithubPatVisible(v => !v)} style={{ padding: 10 }}>
                        <Ionicons name={githubPatVisible ? 'eye-off-outline' : 'eye-outline'} size={16} color={Colors.textSecondary} />
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={saveGithubPat}
                      disabled={githubSaving || !githubPatInput.trim()}
                      style={{ paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#6e40c9', borderRadius: 8, alignItems: 'center', opacity: githubSaving || !githubPatInput.trim() ? 0.5 : 1 }}
                    >
                      {githubSaving
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>Save Token</Text>}
                    </Pressable>
                    <Text style={{ color: Colors.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                      Generate a token at github.com/settings/tokens with repo + read:user scope.
                    </Text>
                  </View>
                </View>
              )}

              {/* Repos section */}
              <Text style={[styles.connSub, { marginTop: 16, marginBottom: 6, color: Colors.textSecondary }]}>
                Tracked Repositories
              </Text>
              {githubRepos.length > 0 && (
                <View style={{ gap: 6, marginBottom: 8 }}>
                  {githubRepos.map((repo) => (
                    <View key={repo} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.border }}>
                      <Ionicons name="git-branch-outline" size={14} color="#6e40c9" style={{ marginRight: 8 }} />
                      <Text style={{ flex: 1, color: Colors.text, fontFamily: 'Inter_400Regular', fontSize: 13 }}>{repo}</Text>
                      <Pressable onPress={() => removeGithubRepo(repo)} hitSlop={8}>
                        <Ionicons name="close-outline" size={18} color={Colors.textTertiary} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, color: Colors.text, fontFamily: 'Inter_400Regular', fontSize: 13, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.surface }}
                  placeholder="owner/repo (e.g. acme/backend)"
                  placeholderTextColor={Colors.textTertiary}
                  value={githubRepoInput}
                  onChangeText={setGithubRepoInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={addGithubRepo}
                />
                <Pressable
                  onPress={addGithubRepo}
                  disabled={!githubRepoInput.trim()}
                  style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#6e40c920', borderRadius: 8, borderWidth: 1, borderColor: '#6e40c940', justifyContent: 'center', opacity: githubRepoInput.trim() ? 1 : 0.4 }}
                >
                  <Ionicons name="add-outline" size={18} color="#6e40c9" />
                </Pressable>
              </View>
              {githubConnected && (
                <Text style={{ color: Colors.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 8 }}>
                  {'Ask Jarvis "what are my open PRs?" or use /pr on Telegram.'}
                </Text>
              )}
            </View>
          )}
        </View>
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
        {/* ── CONNECTED TOOLS (MCP) ── */}
        <SectionHeader label="CONNECTED TOOLS" accent="#10B981" />
        <View style={styles.card}>
          {mcpLoading && mcpServers.length === 0 ? (
            <ActivityIndicator size="small" color="#10B981" style={{ padding: 16 }} />
          ) : mcpServers.length === 0 ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <Ionicons name="extension-puzzle-outline" size={28} color={Colors.textTertiary} style={{ marginBottom: 8 }} />
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
                    color={server.connected ? '#10B981' : Colors.textTertiary}
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
              placeholderTextColor={Colors.textTertiary}
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
                placeholderTextColor={Colors.textTertiary}
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
                  placeholderTextColor={Colors.textTertiary}
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
                    placeholderTextColor={Colors.textTertiary}
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
                        placeholderTextColor={Colors.textTertiary}
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
                        Variable not found — add it to Railway Variables first.
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
                          {`1. Open your Railway project.\n2. Go to the service's Variables tab.\n3. Add a variable with your chosen name (e.g. MY_API_TOKEN) and paste the value.\n4. Redeploy the service so the server receives the new variable.\n\nUsing Railway Variables keeps raw keys out of your database and lets you rotate them without changing the app.`}
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
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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
                  color={mcpKeyCopied ? '#10B981' : mcpRawKey ? Colors.textSecondary : Colors.textTertiary}
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
                {'This is shown once. Store it somewhere safe - you won\'t be able to see it again.'}
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
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
        {/* ── MODEL PROVIDER ── */}
        <SectionHeader label="MODEL SETUP" accent="#2563EB" />
        <View style={styles.card}>
          <View style={[styles.connRow, { paddingVertical: 12 }]}>
            <View style={[styles.connIconWrap, { backgroundColor: '#2563EB20' }]}>
              <Ionicons name="sparkles-outline" size={18} color="#2563EB" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>Choose a provider</Text>
              <Text style={styles.connSub}>
                Claude, Gemini, Local Llama, or Phone Gemma. OpenAI account and API-key setup lives in the OpenAI section below.
              </Text>
            </View>
            <Pressable onPress={loadOpenAIProviderStatus} style={{ padding: 8 }}>
              {openAIAuthLoading ? (
                <ActivityIndicator size="small" color="#2563EB" />
              ) : (
                <Ionicons name="refresh-outline" size={18} color={Colors.textSecondary} />
              )}
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>
            {modelProviderCards.map((provider, idx) => {
              const providerStatus = openAIProviderStatus?.providers?.[provider.id] ?? (provider.id === 'openai' ? openAIStatus : undefined);
              const apiStatus = providerStatus?.authTypes?.api_key;
              const oauthStatus = providerStatus?.authTypes?.oauth;
              const isLocal = provider.id === 'local-llama';
              const isAndroidLocalGemma = provider.id === 'android-local-gemma';
              const isLocalProvider = isLocal || isAndroidLocalGemma;
              const apiVisible = Boolean(providerApiKeyVisible[provider.id]);
              const apiInput = providerApiKeyInputs[provider.id] ?? '';
              const providerMessage = providerAuthMessages[provider.id];
              const localGemmaModelFileReady = isPhoneGemmaModelFileReady(localGemmaStatus);
              const localGemmaGenerationReady = isPhoneGemmaGenerationReady(localGemmaStatus);
              const localGemmaNeedsEngine = phoneGemmaNeedsEngine(localGemmaStatus);
              const localGemmaSize = formatModelSize(localGemmaStatus?.sizeBytes);
              const localGemmaDetails = phoneGemmaRuntimeDetails(localGemmaStatus);
              const localGemmaSelected = modelPrefs.chat === ANDROID_LOCAL_GEMMA_MODEL;
              const localGemmaStatusText = localGemmaStatusLoading
                ? 'Checking local model storage...'
                : localGemmaValidating
                  ? `Validating ${phoneGemmaProfileLabel(localGemmaActiveProfileId) || 'LiteRT-LM engine'}...`
                : localGemmaGenerationReady
                  ? `Ready${localGemmaDetails ? ` - ${localGemmaDetails}` : ''}${localGemmaSize ? ` - ${localGemmaSize}` : ''}${localGemmaStatus?.sourceName ? ` - ${localGemmaStatus.sourceName}` : ''}`
                  : localGemmaNeedsEngine
                    ? `${localGemmaStatus?.message || LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE}${localGemmaSize ? ` - ${localGemmaSize}` : ''}${localGemmaStatus?.sourceName ? ` - ${localGemmaStatus.sourceName}` : ''}`
                  : localGemmaStatus?.message || `Download ${LOCAL_GEMMA_EXPECTED_FILE_NAME}, then import it from Downloads.`;
              const activeLabel =
                providerStatus?.defaultAuthType === 'oauth'
                  ? `${provider.shortLabel} OAuth connected`
                  : providerStatus?.defaultAuthType === 'api_key'
                    ? 'API key connected'
                    : isAndroidLocalGemma
                      ? localGemmaSelected
                        ? localGemmaGenerationReady ? 'Selected and ready' : localGemmaNeedsEngine ? 'Selected but engine not ready' : 'Selected but model file missing'
                        : localGemmaGenerationReady ? 'Ready to generate' : localGemmaNeedsEngine ? 'Model imported, engine not ready' : 'Model file not imported'
                      : isLocal
                        ? 'Ready when your local runtime is running'
                        : 'Not connected';
              const iconName =
                provider.id === 'anthropic' ? 'cube-outline' :
                provider.id === 'google' ? 'logo-google' :
                isLocalProvider ? 'hardware-chip-outline' :
                'sparkles-outline';

              return (
                <View key={provider.id} style={[providerAuthStyles.providerCard, idx > 0 && providerAuthStyles.providerCardBorder]}>
                  <View style={providerAuthStyles.providerHeader}>
                    <View style={[styles.connIconWrap, { backgroundColor: providerStatus?.connected ? '#052e16' : '#1a1a1a' }]}>
                      <Ionicons name={iconName as any} size={18} color={providerStatus?.connected ? '#10B981' : '#2563EB'} />
                    </View>
                    <View style={styles.connInfo}>
                      <Text style={styles.connName}>{provider.label}</Text>
                      <Text style={styles.connSub}>{activeLabel}</Text>
                      {oauthStatus?.connected && oauthStatus.email ? <Text style={styles.connSub}>{oauthStatus.email}</Text> : null}
                      <Text style={providerAuthStyles.providerHint}>{provider.setupHint}</Text>
                    </View>
                  </View>

                  <View style={providerAuthStyles.actionGrid}>
                    {provider.credentialKinds.includes('api_key') ? (
                      <Pressable
                        onPress={() => {
                          setProviderApiKeyVisible((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }));
                        }}
                        disabled={openAIAuthBusy}
                        style={[
                          providerAuthStyles.primaryAction,
                          apiStatus?.isDefault && providerAuthStyles.apiKeyActionActive,
                          openAIAuthBusy && providerAuthStyles.disabledAction,
                        ]}
                      >
                        <Ionicons name="key-outline" size={16} color={apiStatus?.isDefault ? '#fff' : '#0F766E'} />
                        <Text style={[providerAuthStyles.primaryActionText, apiStatus?.isDefault && providerAuthStyles.activeActionText]}>
                          {isLocal ? 'Use Local Runtime Key' : `Use ${provider.shortLabel} API Key`}
                        </Text>
                      </Pressable>
                    ) : null}

                    {isLocalProvider ? (
                      <Pressable
                        onPress={isAndroidLocalGemma
                          ? selectAndroidLocalGemma
                          : () => setProviderMessage(provider.id, 'Local Llama is selected from AI Models. Start Ollama, LM Studio, vLLM, or the Jarvis model relay before chatting.')}
                        disabled={openAIAuthBusy || (isAndroidLocalGemma && (localGemmaValidating || localGemmaSmokeTesting))}
                        style={[providerAuthStyles.primaryAction, (openAIAuthBusy || (isAndroidLocalGemma && (localGemmaValidating || localGemmaSmokeTesting))) && providerAuthStyles.disabledAction]}
                      >
                        {isAndroidLocalGemma && localGemmaValidating ? (
                          <ActivityIndicator size="small" color="#2563EB" />
                        ) : (
                          <Ionicons name="hardware-chip-outline" size={16} color="#2563EB" />
                        )}
                        <Text style={providerAuthStyles.primaryActionText}>{isAndroidLocalGemma ? 'Use Phone Gemma' : 'Use Local Llama'}</Text>
                      </Pressable>
                    ) : null}

                    {isAndroidLocalGemma ? (
                      <Pressable
                        onPress={importAndroidLocalGemma}
                        disabled={localGemmaImporting || localGemmaValidating || localGemmaSmokeTesting}
                        style={[providerAuthStyles.primaryAction, (localGemmaImporting || localGemmaValidating || localGemmaSmokeTesting) && providerAuthStyles.disabledAction]}
                      >
                        {localGemmaImporting ? (
                          <ActivityIndicator size="small" color="#2563EB" />
                        ) : (
                          <Ionicons name="download-outline" size={16} color="#2563EB" />
                        )}
                        <Text style={providerAuthStyles.primaryActionText}>
                          {localGemmaImporting ? 'Importing model file' : 'Import model file'}
                        </Text>
                      </Pressable>
                    ) : null}

                    {isAndroidLocalGemma && localGemmaModelFileReady ? (
                      <Pressable
                        onPress={() => validateAndroidLocalGemma()}
                        disabled={localGemmaValidating || localGemmaImporting || localGemmaSmokeTesting}
                        style={[providerAuthStyles.primaryAction, (localGemmaValidating || localGemmaImporting || localGemmaSmokeTesting) && providerAuthStyles.disabledAction]}
                      >
                        {localGemmaValidating ? (
                          <ActivityIndicator size="small" color="#2563EB" />
                        ) : (
                          <Ionicons name="pulse-outline" size={16} color="#2563EB" />
                        )}
                        <Text style={providerAuthStyles.primaryActionText}>
                          {localGemmaValidating ? 'Validating engine' : 'Validate engine'}
                        </Text>
                      </Pressable>
                    ) : null}

                    {isAndroidLocalGemma && localGemmaModelFileReady ? (
                      <View style={providerAuthStyles.profileGrid}>
                        {PHONE_GEMMA_VALIDATION_PROFILES.map((profile) => {
                          const activeProfile = localGemmaActiveProfileId === profile.id;
                          const validatedProfile = localGemmaStatus?.engineValidatedProfileId === profile.id;
                          return (
                            <Pressable
                              key={profile.id}
                              onPress={() => {
                                if (profile.highMemoryRisk) {
                                  Alert.alert(
                                    'CPU Phone Gemma',
                                    'CPU validation can make Android close Jarvis and other recent apps on large E4B models. Try a GPU profile first; continue only for diagnostics.',
                                    [
                                      { text: 'Cancel', style: 'cancel' },
                                      {
                                        text: 'Try CPU',
                                        style: 'destructive',
                                        onPress: () => validateAndroidLocalGemma(profile),
                                      },
                                    ],
                                  );
                                  return;
                                }
                                validateAndroidLocalGemma(profile);
                              }}
                              disabled={localGemmaValidating || localGemmaImporting || localGemmaSmokeTesting}
                              style={[
                                providerAuthStyles.profileAction,
                                validatedProfile && providerAuthStyles.profileActionActive,
                                (localGemmaValidating || localGemmaImporting || localGemmaSmokeTesting) && providerAuthStyles.disabledAction,
                              ]}
                            >
                              {activeProfile && localGemmaValidating ? (
                                <ActivityIndicator size="small" color="#2563EB" />
                              ) : (
                                <Ionicons
                                  name={profile.backend === 'cpu' ? 'server-outline' : 'hardware-chip-outline'}
                                  size={14}
                                  color={validatedProfile ? '#fff' : '#2563EB'}
                                />
                              )}
                              <Text style={[providerAuthStyles.profileActionText, validatedProfile && providerAuthStyles.profileActionTextActive]}>
                                {profile.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}

                    {isAndroidLocalGemma && localGemmaGenerationReady ? (
                      <Pressable
                        onPress={runAndroidLocalGemmaSmokeTest}
                        disabled={localGemmaSmokeTesting || localGemmaValidating || localGemmaImporting}
                        style={[providerAuthStyles.primaryAction, (localGemmaSmokeTesting || localGemmaValidating || localGemmaImporting) && providerAuthStyles.disabledAction]}
                      >
                        {localGemmaSmokeTesting ? (
                          <ActivityIndicator size="small" color="#2563EB" />
                        ) : (
                          <Ionicons name="checkmark-done-outline" size={16} color="#2563EB" />
                        )}
                        <Text style={providerAuthStyles.primaryActionText}>
                          {localGemmaSmokeTesting ? 'Testing Phone Gemma' : 'Run smoke test'}
                        </Text>
                      </Pressable>
                    ) : null}

                    {providerStatus?.connected ? (
                      <Pressable
                        onPress={() => disconnectProvider(provider.id, provider.shortLabel)}
                        disabled={openAIAuthBusy}
                        style={[providerAuthStyles.primaryAction, openAIAuthBusy && providerAuthStyles.disabledAction]}
                      >
                        <Ionicons name="close-circle-outline" size={16} color={Colors.error} />
                        <Text style={providerAuthStyles.primaryActionText}>Disconnect</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  {isAndroidLocalGemma ? (
                    <View style={providerAuthStyles.localModelStatusRow}>
                      <Ionicons
                        name={localGemmaGenerationReady ? 'checkmark-circle-outline' : localGemmaModelFileReady ? 'warning-outline' : 'alert-circle-outline'}
                        size={16}
                        color={localGemmaGenerationReady ? '#10B981' : '#F59E0B'}
                      />
                      <Text style={providerAuthStyles.localModelStatusText}>{localGemmaStatusText}</Text>
                      <Pressable onPress={loadLocalGemmaStatus} disabled={localGemmaStatusLoading || localGemmaValidating || localGemmaSmokeTesting} style={providerAuthStyles.localModelRefresh}>
                        {localGemmaStatusLoading || localGemmaValidating || localGemmaSmokeTesting ? (
                          <ActivityIndicator size="small" color={Colors.textSecondary} />
                        ) : (
                          <Ionicons name="refresh-outline" size={15} color={Colors.textSecondary} />
                        )}
                      </Pressable>
                    </View>
                  ) : null}

                  {apiVisible ? (
                    <View style={providerAuthStyles.inputBlock}>
                      <TextInput
                        style={providerAuthStyles.secretInput}
                        value={apiInput}
                        onChangeText={(value) => {
                          setProviderApiKeyInputs((prev) => ({ ...prev, [provider.id]: value }));
                        }}
                        placeholder={provider.apiKeyPlaceholder ?? 'API key'}
                        placeholderTextColor={Colors.textTertiary}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Pressable
                        onPress={() => saveProviderApiKey(provider.id)}
                        disabled={openAIAuthBusy || !apiInput.trim()}
                        style={[providerAuthStyles.saveButton, (!apiInput.trim() || openAIAuthBusy) && providerAuthStyles.disabledAction]}
                      >
                        {openAIAuthBusy ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Ionicons name="checkmark-outline" size={15} color="#fff" />
                        )}
                        <Text style={providerAuthStyles.saveButtonText}>Save</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {providerMessage ? <Text style={providerAuthStyles.statusText}>{providerMessage}</Text> : null}
                </View>
              );
            })}
          </View>
        </View>

        <SectionHeader label="OPENAI DIRECT SETUP" accent="#2563EB" />
        <View style={styles.card}>
          <View style={[styles.connRow, { paddingVertical: 12 }]}>
            <View style={[styles.connIconWrap, { backgroundColor: '#2563EB20' }]}>
              <Ionicons name="sparkles-outline" size={18} color="#2563EB" />
            </View>
            <View style={styles.connInfo}>
              <Text style={styles.connName}>OpenAI</Text>
              <Text style={styles.connSub}>
                {openAIAuthLoading ? 'Checking provider status...' : openAIDefaultLabel}
              </Text>
              {openAIOAuthStatus?.connected && openAIOAuthStatus.email ? (
                <Text style={styles.connSub}>{openAIOAuthStatus.email}</Text>
              ) : null}
            </View>
            <Pressable onPress={loadOpenAIProviderStatus} style={{ padding: 8 }}>
              {openAIAuthLoading ? (
                <ActivityIndicator size="small" color="#2563EB" />
              ) : (
                <Ionicons name="refresh-outline" size={18} color={Colors.textSecondary} />
              )}
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
            <Text style={{ color: Colors.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 }}>
              Uses your ChatGPT/Codex account instead of an API key. If login ends on a localhost error page, copy the URL and paste it back into Jarvis to complete setup.
            </Text>

            <View style={providerAuthStyles.actionGrid}>
              <Pressable
                onPress={startOpenAIChatGPTOAuth}
                disabled={openAIAuthBusy}
                style={[
                  providerAuthStyles.primaryAction,
                  openAIOAuthStatus?.isDefault && providerAuthStyles.oauthActionActive,
                  openAIAuthBusy && providerAuthStyles.disabledAction,
                ]}
              >
                <Ionicons name="person-circle-outline" size={16} color={openAIOAuthStatus?.isDefault ? '#fff' : '#2563EB'} />
                <Text style={[providerAuthStyles.primaryActionText, openAIOAuthStatus?.isDefault && providerAuthStyles.activeActionText]}>
                  Connect ChatGPT Subscription
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setOpenAIApiKeyVisible((visible) => !visible)}
                disabled={openAIAuthBusy}
                style={[
                  providerAuthStyles.primaryAction,
                  openAIApiKeyStatus?.isDefault && providerAuthStyles.apiKeyActionActive,
                  openAIAuthBusy && providerAuthStyles.disabledAction,
                ]}
              >
                <Ionicons name="key-outline" size={16} color={openAIApiKeyStatus?.isDefault ? '#fff' : '#0F766E'} />
                <Text style={[providerAuthStyles.primaryActionText, openAIApiKeyStatus?.isDefault && providerAuthStyles.activeActionText]}>
                  Use OpenAI API Key
                </Text>
              </Pressable>

              <Pressable
                onPress={useJarvisDefaultModel}
                disabled={openAIAuthBusy}
                style={[
                  providerAuthStyles.primaryAction,
                  !openAIStatus?.connected && providerAuthStyles.defaultActionActive,
                  openAIAuthBusy && providerAuthStyles.disabledAction,
                ]}
              >
                <Ionicons name="radio-outline" size={16} color={!openAIStatus?.connected ? '#fff' : Colors.textSecondary} />
                <Text style={[providerAuthStyles.primaryActionText, !openAIStatus?.connected && providerAuthStyles.activeActionText]}>
                  Use Jarvis Default Model
                </Text>
              </Pressable>
            </View>

            {openAIApiKeyVisible ? (
              <View style={providerAuthStyles.inputBlock}>
                <TextInput
                  style={providerAuthStyles.secretInput}
                  value={openAIApiKeyInput}
                  onChangeText={setOpenAIApiKeyInput}
                  placeholder="OPENAI_API_KEY"
                  placeholderTextColor={Colors.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  onPress={saveOpenAIApiKey}
                  disabled={openAIAuthBusy || !openAIApiKeyInput.trim()}
                  style={[providerAuthStyles.saveButton, (!openAIApiKeyInput.trim() || openAIAuthBusy) && providerAuthStyles.disabledAction]}
                >
                  {openAIAuthBusy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark-outline" size={15} color="#fff" />
                  )}
                  <Text style={providerAuthStyles.saveButtonText}>Save</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={providerAuthStyles.inputBlock}>
              <TextInput
                style={providerAuthStyles.callbackInput}
                value={openAICallbackUrl}
                onChangeText={setOpenAICallbackUrl}
                placeholder="http://127.0.0.1:1455/auth/callback?code=abc123&state=xyz"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={submitOpenAICallbackUrl}
                disabled={openAIAuthBusy || !openAICallbackUrl.trim()}
                style={[providerAuthStyles.saveButton, (!openAICallbackUrl.trim() || openAIAuthBusy) && providerAuthStyles.disabledAction]}
              >
                <Ionicons name="log-in-outline" size={15} color="#fff" />
                <Text style={providerAuthStyles.saveButtonText}>Finish</Text>
              </Pressable>
            </View>

            {openAILoginUrl ? (
              <View style={providerAuthStyles.loginLinkActions}>
                {Platform.OS === 'web' ? (
                  <Pressable
                    onPress={openOpenAILoginUrl}
                    style={providerAuthStyles.copyLoginRow}
                  >
                    <Ionicons name="open-outline" size={14} color="#2563EB" />
                    <Text style={providerAuthStyles.copyLoginText}>Open login URL</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={async () => {
                    await Clipboard.setStringAsync(openAILoginUrl);
                    setOpenAIAuthMessage('OpenAI login URL copied.');
                  }}
                  style={providerAuthStyles.copyLoginRow}
                >
                  <Ionicons name="copy-outline" size={14} color="#2563EB" />
                  <Text style={providerAuthStyles.copyLoginText}>Copy login URL</Text>
                </Pressable>
              </View>
            ) : null}

            {openAIAuthMessage ? (
              <Text style={providerAuthStyles.statusText}>{openAIAuthMessage}</Text>
            ) : null}

            {openAIStatus?.fallbackEnabled ? (
              <Text style={[providerAuthStyles.statusText, { color: '#F59E0B' }]}>
                Explicit OpenAI auth fallback is enabled.
              </Text>
            ) : null}
          </View>
        </View>
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
        <WakeWordSection
          wakeWordEnabled={wakeWordEnabled}
          talkModeEnabled={talkModeEnabled}
          wakeWords={wakeWords}
          newWakeWord={newWakeWord}
          saving={wakeSettingsSaving}
          assistantActive={androidAssistantStatus?.assistantActive}
          assistantStatus={androidAssistantStatus?.assistantStatus}
          hotwordPhrase={androidAssistantStatus?.hotwordPhrase}
          hotwordAvailability={androidAssistantStatus?.hotwordAvailability}
          hotwordDetail={androidAssistantStatus?.hotwordDetail}
          hotwordRecognitionActive={androidAssistantStatus?.hotwordRecognitionActive}
          onToggleWakeWord={toggleWakeWord}
          onToggleTalkMode={toggleTalkMode}
          onChangeNewWakeWord={setNewWakeWord}
          onAddWakeWord={addWakeWord}
          onRemoveWakeWord={removeWakeWord}
          onOpenAssistantSettings={openAndroidAssistantSettings}
          onRefreshAssistantStatus={refreshAndroidAssistantStatus}
        />
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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

          {/* Preview button — audio playback unavailable on web */}
          {Platform.OS !== 'web' && <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
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
                {ttsPreviewing ? 'Loading…' : `Preview ${TTS_OPENAI_VOICES.find(v => v.id === ttsVoice)?.label ?? ttsVoice} voice`}
              </Text>
            </Pressable>
            <Text style={{ fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 6 }}>
              {'You can also ask Jarvis to "read that out" or "say it as a voice message" at any time'}
            </Text>
          </View>}
        </View>
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
        {/* ── BUILD HISTORY ── */}
        <BuildHistorySection
          builds={buildHistory}
          expanded={buildHistoryExpanded}
          expandedBuildId={expandedBuildId}
          onToggleExpanded={() => setBuildHistoryExpanded(v => !v)}
          onToggleBuild={(buildId) => setExpandedBuildId(expandedBuildId === buildId ? null : buildId)}
        />
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
        {/* ── JARVIS GUT — THREAT LOG ── */}
        <SectionHeader label="THREAT LOG" accent="#F59E0B" />
        <View style={styles.card}>
          <View style={tlStyles.header}>
            <Ionicons name="eye-outline" size={16} color="#F59E0B" />
            <Text style={tlStyles.headerText}>ANOMALY DETECTION</Text>
            <Text style={tlStyles.headerSub}>{"Patterns flagged by Jarvis's reflexive gut layer"}</Text>
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
                      : new Date(signal.createdAt ?? '').toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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
                const categoryModels = availableModels.filter(m => !m.categories || m.categories.includes(key));
                const currentModel = categoryModels.find(m => m.value === modelPrefs[key]) ?? availableModels.find(m => m.value === modelPrefs[key]);
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
                          ...categoryModels.map(m => ({
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
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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
                  ...availableOrchestratorModels.filter((m: AvailableModel) => !m.categories || m.categories.includes('orchestrator')).map((m: AvailableModel) => ({
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
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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
            <Pressable style={styles.prefRowBordered}>
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
            <Pressable style={styles.prefRowBordered}>
              <View style={styles.prefLeft}>
                <Ionicons name="code-slash-outline" size={16} color={Colors.cyan} />
                <View>
                  <Text style={styles.prefTitle}>Code Proposals</Text>
                  <Text style={styles.prefSub}>{"Review and approve Jarvis's self-improvements"}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </Pressable>
          </Link>
          <Link href="/self-repair-history" asChild>
            <Pressable style={styles.prefRowBordered}>
              <View style={styles.prefLeft}>
                <Ionicons name="construct-outline" size={16} color={Colors.violet} />
                <View>
                  <Text style={styles.prefTitle}>Self-Repair Log</Text>
                  <Text style={styles.prefSub}>Autonomous code changes Jarvis applied</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </Pressable>
          </Link>
          <Link href="/capability-gaps" asChild>
            <Pressable style={styles.prefRowBordered}>
              <View style={styles.prefLeft}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.warning} />
                <View>
                  <Text style={styles.prefTitle}>Capability Gaps</Text>
                  <Text style={styles.prefSub}>{"What Jarvis couldn't do this week"}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
            </Pressable>
          </Link>
        </View>
        </ErrorBoundary>

        {/* Scan Capability Gaps — own ErrorBoundary so a crash in the JARVIS INTELLIGENCE
            navigation links above does not hide this interactive row */}
        <ErrorBoundary FallbackComponent={SectionFallback}>
        <View style={[styles.card, { gap: 0 }]}>
          <Pressable
            style={styles.prefRow}
            onPress={() => { void runGapScan(); }}
            disabled={gapScanRunning}
            testID="scan-capability-gaps-button"
          >
            <View style={styles.prefLeft}>
              <Ionicons name="search-outline" size={16} color={Colors.cyan} />
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>Scan Capability Gaps</Text>
                <Text style={styles.prefSub}>
                  {gapScanRunning
                    ? 'Analysing recent gaps…'
                    : gapScanResult
                      ? gapScanResult.total === -1
                        ? 'Scan failed — tap to retry'
                        : gapScanResult.total === 0
                          ? 'No gaps found — all caught up'
                          : `Found ${gapScanResult.total} gap${gapScanResult.total !== 1 ? 's' : ''}: ${gapScanResult.submitted} auto-building, ${gapScanResult.queued} in inbox`
                      : 'Run the weekly gap scan right now'}
                </Text>
              </View>
            </View>
            {gapScanRunning
              ? <ActivityIndicator size="small" color={Colors.cyan} />
              : gapScanResult && gapScanResult.total !== -1
                ? <Ionicons name="checkmark-circle-outline" size={16} color="#10B981" />
                : gapScanResult && gapScanResult.total === -1
                  ? <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
                  : <Ionicons name="play-circle-outline" size={16} color={Colors.cyan} />}
          </Pressable>
        </View>
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
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
                  const diff = Date.now() - new Date(healthReport.generatedAt ?? '').getTime();
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
                      {healthReport.openAiReachable ? `AI provider ✓${latencyText}` : '⚠ AI provider unreachable'} ·{' '}
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
            <Pressable
              onPress={() => {
                loadHealth();
                loadJobRunnerReport();
              }}
              style={healthStyles.refreshBtn}
            >
              <Ionicons name="refresh-outline" size={16} color="#10B981" />
            </Pressable>
          </View>
          )}

          {/* Subsystem grid */}
          {healthReport && (healthReport.subsystems ?? []).length > 0 && (
            <View style={healthStyles.subsystemGrid}>
              {(healthReport.subsystems ?? []).map((s) => {
                const isActionable = s.status === 'degraded' || s.status === 'down';
                const dotColor = s.status === 'healthy' ? '#10B981'
                  : s.status === 'degraded' ? '#F59E0B'
                  : s.status === 'down' ? Colors.error
                  : Colors.textTertiary;
                return isActionable ? (
                  <Pressable
                    key={s.name}
                    style={({ pressed }) => [healthStyles.subsystemCell, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => openSubsystemErrorSheet(s.name, s.label)}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${s.label} error details`}
                  >
                    <View style={[healthStyles.subsystemDot, { backgroundColor: dotColor }]} />
                    <Text style={healthStyles.subsystemLabel} numberOfLines={1}>{s.label}</Text>
                    <Ionicons name="chevron-forward" size={10} color={dotColor} style={{ marginLeft: 1, opacity: 0.8 }} />
                  </Pressable>
                ) : (
                  <View key={s.name} style={healthStyles.subsystemCell}>
                    <View style={[healthStyles.subsystemDot, { backgroundColor: dotColor }]} />
                    <Text style={healthStyles.subsystemLabel} numberOfLines={1}>{s.label}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Memory pipeline health banner — shown whenever write or read errors are non-zero.
              Tapping opens the memory error detail sheet. */}
          {healthReport && (() => {
            const writeErr = healthReport.memoryWriteErrors15m ?? 0;
            const readErr = healthReport.memoryReadErrors15m ?? 0;
            if (writeErr === 0 && readErr === 0) return null;

            const showWrite = writeErr > 0;
            const showRead = readErr > 0;

            return (
              <View style={healthStyles.memoryBannerSection}>
                {showWrite && (
                  <Pressable
                    style={({ pressed }) => [healthStyles.memoryBanner, { borderLeftColor: '#F59E0B', opacity: pressed ? 0.75 : 1 }]}
                    onPress={() => openSubsystemErrorSheet('memory', 'Memory')}
                    accessibilityRole="button"
                    accessibilityLabel="View memory learning error details"
                  >
                    <Ionicons name="cloud-offline-outline" size={14} color="#F59E0B" style={{ marginTop: 1 }} />
                    <Text style={[healthStyles.memoryBannerText, { color: '#F59E0B', flex: 1 }]}>
                      {`Memory learning paused — ${writeErr} error${writeErr === 1 ? '' : 's'} in the last 15 minutes`}
                    </Text>
                    <Ionicons name="chevron-forward" size={12} color="#F59E0B" style={{ marginTop: 1, opacity: 0.7 }} />
                  </Pressable>
                )}
                {showRead && (
                  <Pressable
                    style={({ pressed }) => [healthStyles.memoryBanner, { borderLeftColor: Colors.error, opacity: pressed ? 0.75 : 1 }]}
                    onPress={() => openSubsystemErrorSheet('memory', 'Memory')}
                    accessibilityRole="button"
                    accessibilityLabel="View memory recall error details"
                  >
                    <Ionicons name="search-outline" size={14} color={Colors.error} style={{ marginTop: 1 }} />
                    <Text style={[healthStyles.memoryBannerText, { color: Colors.error, flex: 1 }]}>
                      {`Memory recall degraded — ${readErr} error${readErr === 1 ? '' : 's'} in the last 15 minutes`}
                    </Text>
                    <Ionicons name="chevron-forward" size={12} color={Colors.error} style={{ marginTop: 1, opacity: 0.7 }} />
                  </Pressable>
                )}
              </View>
            );
          })()}

          {/* Job runner observability */}
          <View style={healthStyles.jobRunnerSection}>
            <View style={healthStyles.jobRunnerHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={healthStyles.timelineHeader}>Job Runner</Text>
                {jobRunnerReport && (() => {
                  const q = jobRunnerReport.summary.byStatus.queued ?? 0;
                  const r = jobRunnerReport.summary.byStatus.running ?? 0;
                  const f = jobRunnerReport.summary.recentFailureCount ?? 0;
                  const oldest = jobRunnerReport.summary.oldestQueuedAgeMs;
                  const oldestText = oldest == null
                    ? 'no queued wait'
                    : oldest < 60000
                      ? '<1m oldest queued'
                      : `${Math.floor(oldest / 60000)}m oldest queued`;
                  return (
                    <Text style={healthStyles.overallSub}>
                      {`${q} queued - ${r} running - ${f} failed recently - ${oldestText}`}
                    </Text>
                  );
                })()}
              </View>
              {jobRunnerLoading ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : (
                <Pressable onPress={loadJobRunnerReport} style={healthStyles.refreshBtn}>
                  <Ionicons name="refresh-outline" size={15} color="#10B981" />
                </Pressable>
              )}
            </View>
            {jobRunnerReport && jobRunnerReport.activeJobs.slice(0, 3).map((job) => {
              const runtime = job.runtimeMs == null ? null : Math.max(0, Math.floor(job.runtimeMs / 1000));
              const ageMin = Math.max(0, Math.floor(job.ageMs / 60000));
              const meta = `${job.agentType} - ${job.status}${job.retryCount > 0 ? ` - retry ${job.retryCount}` : ''}${runtime != null ? ` - ${runtime}s runtime` : ` - ${ageMin}m old`}`;
              return (
                <View key={job.id} style={healthStyles.jobRunnerRow}>
                  <View style={[healthStyles.timelineDot, { backgroundColor: job.status === 'running' ? '#10B981' : '#F59E0B' }]} />
                  <View style={healthStyles.timelineContent}>
                    <Text style={healthStyles.timelineMsg} numberOfLines={1}>{job.title}</Text>
                    <Text style={healthStyles.timelineSub} numberOfLines={1}>{meta}</Text>
                    {job.lastError && <Text style={healthStyles.timelineTime} numberOfLines={1}>{job.lastError}</Text>}
                  </View>
                </View>
              );
            })}
            {jobRunnerReport && jobRunnerReport.activeJobs.length === 0 && (
              <Text style={healthStyles.overallSub}>No active jobs.</Text>
            )}
            {jobRunnerReport && jobRunnerReport.diagnosticEvents.length > 0 && (
              <Text style={healthStyles.jobRunnerEvent} numberOfLines={2}>
                {jobRunnerReport.diagnosticEvents[0]?.message}
              </Text>
            )}
            {!jobRunnerReport && !jobRunnerLoading && (
              <Text style={healthStyles.overallSub}>Job runner details unavailable.</Text>
            )}
          </View>

          {/* Recent error timeline */}
          {healthReport && healthReport.recentErrors && healthReport.recentErrors.length > 0 && (
            <View style={healthStyles.timelineSection}>
              <Text style={healthStyles.timelineHeader}>Recent Errors</Text>
              {healthReport.recentErrors.slice(0, 5).map((ev) => {
                const sevColor = ev.severity === 'critical' ? Colors.error : ev.severity === 'error' ? Colors.error : '#F59E0B';
                const timeAgo = (() => {
                  const diffMs = Date.now() - new Date(ev.createdAt ?? '').getTime();
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
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={SectionFallback}>
        {/* ── DIAGNOSTICS ── */}
        <View
          testID="settings-diagnostics-section"
          onLayout={(event) => {
            diagnosticsYRef.current = event.nativeEvent.layout.y;
          }}
        >
        <SectionHeader label="DIAGNOSTICS" accent="#10B981" />
        <View style={[styles.card, { marginBottom: 12 }]}>
          <RuntimeDiagnosticsPanel />
        </View>
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
