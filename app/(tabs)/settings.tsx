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

