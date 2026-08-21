Warning: truncated output (original token count: 60470)
Total output lines: 6178

import React, { useState, useCallback, useRef, useEffect, useContext } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  Modal,
  Linking,
  Image,
} from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useRouter } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import {
  useAudioRecorder,
  RecordingPresets,
  createAudioPlayer,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system/legacy';
import Colors from '@/constants/colors';
import MarkdownText from '@/components/MarkdownText';
import { IntegrationErrorCard } from '@/components/IntegrationErrorCard';
import {
  getGoals,
  getStats,
  getCompletionHistory,
  getTodayPlan,
  savePlan,
  saveGoal,
  getTodayKey,
  getChatHistory,
  saveChatHistory,
  clearChatHistory,
  getCoachSessionId,
  saveCoachSessionId,
  getLifeContext,
  type Goal,
  type UserStats,
  type ChatMessage,
  type CoachAction,
  type LifeContext,
  type Commitment,
  type CoachingMode,
  type ExecutedAction,
  type PendingConfirm,
  type PendingVoiceRestore,
} from '@/lib/storage';
import {
  scheduleEveningAccountability,
  scheduleMidDayNudge,
  scheduleCommitmentDueDateReminder,
  scheduleWeeklyReview,
} from '@/lib/notifications';
import { getApiUrl, queryClient, apiRequest } from '@/lib/query-client';
import { authFetch, getAuthToken } from '@/lib/auth-context';
import { useWakeWord } from '@/lib/wake-word-context';
import {
  addAndroidOutsideAppVoiceControlListener,
  acquireAndroidNativeVoicePlaybackRoute,
  cancelAndroidNativeSpeechRecognition,
  endAndroidOutsideAppVoiceSession,
  getAndroidDaemonStatus,
  handoffAndroidOutsideAppVoiceCapture,
  recognizeAndroidSpeechOnce,
  releaseAndroidNativeVoicePlaybackRoute,
  setAndroidOutsideAppVoiceApproval,
  setAndroidOutsideAppVoiceSessionState,
  startAndroidOutsideAppVoiceSession,
  stopAndroidNativeSpeechRecognition,
} from '@/lib/android-daemon-native';
import {
  buildDiagnosticConversationMessages,
  buildTurnDiagnosticBundle,
  getActionableDiagnosticRecords,
  inferRuntimeIntent,
  isDiagnosticCopyRequest,
  normalizeServerContextTrace,
  resolveDiagnosticCopyRequestTarget,
  resolveDiagnosticTargetFromText,
  resolveVoiceDiagnosticFollowupTarget,
  shouldClarifyVoiceDiagnosticTarget,
  type DiagnosticTurnRecord,
  type DiagnosticVoiceTrace,
  type ServerContextTrace,
  type TurnDiagnosticBundle,
} from '@shared/turnDiagnostics';
import {
  addLocalVoiceTranscriptSegment,
  createLocalVoiceContinuationState,
  LOCAL_VOICE_SILENCE_POLL_MS,
  createLocalVoiceSilenceState,
  updateLocalVoiceSilenceState,
} from '@shared/localVoiceLoop';
import {
  buildVoiceApprovalPrompt,
  classifyVoiceApprovalRisk,
  normalizeVoiceApprovalReply,
  normalizeVoiceRestoreReply,
  voiceApprovalClarificationPrompt,
} from '@shared/voiceApprovalGates';


interface EmailSuggestion {
  title: string;
  emailSubject: string;
  emailFrom: string;
  accountEmail: string;
  goalTitle: string;
  reason: string;
}

const DEFAULT_RUNTIME_MODE: CoachingMode = 'sharp';
const VOICE_RESTORE_FRESH_MS = 60 * 60 * 1000;

function isPendingVoiceRestoreFresh(voiceRestore?: PendingVoiceRestore, now = Date.now()): boolean {
  const createdAt = voiceRestore?.createdAt;
  return typeof createdAt === 'number' && Number.isFinite(createdAt) && now - createdAt < VOICE_RESTORE_FRESH_MS;
}

type SendMessageOrigin =
  | { source: 'in_app' }
  | { source: 'voice'; voiceTrace: DiagnosticVoiceTrace };

type VoiceConfirmAction = (msgId: string, confirmed: boolean, origin?: SendMessageOrigin) => Promise<void>;

const SUGGESTED_PROMPTS = [
  "How am I doing overall?",
  "What should I focus on this week?",
  "Help me with my financial goals",
  "I'm struggling to stay consistent",
];


function isNoisyChatFailure(message: ChatMessage, index: number): boolean {
  if (message.role !== 'assistant' || index < 6) return false;
  const content = message.content.toLowerCase();
  return content.includes('failed to get coach response')
    || content.includes('failed to get response')
    || content.includes('something went wrong while talking to jarvis');
}

const CONTEXT_WINDOW = 12;

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

interface ParsedDraft {
  to: string;
  subject: string;
  body: string;
}

function parseEmailDraft(content: string): ParsedDraft | null {
  const draftMatch = content.match(/---EMAIL DRAFT---\s*\n([\s\S]*?)---END DRAFT---/);
  if (!draftMatch) return null;
  const block = draftMatch[1];
  const toMatch = block.match(/^To:\s*(.+)$/m);
  const subjectMatch = block.match(/^Subject:\s*(.+)$/m);
  const bodyMatch = block.match(/^Body:\s*\n([\s\S]*?)$/m);
  if (!toMatch || !subjectMatch) return null;
  return {
    to: toMatch[1].trim(),
    subject: subjectMatch[1].trim(),
    body: bodyMatch ? bodyMatch[1].trim() : '',
  };
}


function TypingDots() {
  return (
    <View style={styles.typingBubble}>
      <View style={styles.typingDots}>
        <Animated.View entering={FadeIn.duration(300).delay(0)} style={styles.dot} />
        <Animated.View entering={FadeIn.duration(300).delay(150)} style={styles.dot} />
        <Animated.View entering={FadeIn.duration(300).delay(300)} style={styles.dot} />
      </View>
    </View>
  );
}

function SearchingIndicator() {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.searchingBubble}>
      <Ionicons name="search" size={13} color={Colors.textSecondary} />
      <Text style={styles.searchingText}>Searching the web...</Text>
    </Animated.View>
  );
}

function PhoneWorkingIndicator({ message }: { message: string }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.searchingBubble}>
      <Ionicons name="phone-portrait-outline" size={13} color={Colors.primary} />
      <Text style={[styles.searchingText, { color: Colors.primary }]}>{message}</Text>
    </Animated.View>
  );
}

interface ConfirmCardProps {
  pendingConfirm: PendingConfirm;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function ConfirmCard({ pendingConfirm, onConfirm, onCancel, isLoading }: ConfirmCardProps) {
  const isEmail = pendingConfirm.tool === 'send_email';
  const isConnectedAccountAction = pendingConfirm.tool === 'connected_accounts_execute';
  const isCodexDelegation = pendingConfirm.tool === 'delegate_to_codex';
  const preview = pendingConfirm.preview;
  const previewAction = String(preview.action || '');
  const isAndroidAction = pendingConfirm.tool.startsWith('android_') || previewAction.startsWith('android_');

  return (
    <View style={styles.confirmCard}>
      <View style={styles.confirmCardHeader}>
        <Ionicons
          name={isEmail ? 'mail-outline' : isConnectedAccountAction ? 'git-network-outline' : isCodexDelegation ? 'code-slash-outline' : isAndroidAction ? 'phone-portrait-outline' : 'terminal-outline'}
          size={15}
          color={Colors.primary}
        />
        <Text style={styles.confirmCardTitle}>
          {isEmail ? 'Send email?' : isConnectedAccountAction ? 'Approve connected account action?' : isCodexDelegation ? 'Approve Codex delegation?' : isAndroidAction ? 'Approve phone action?' : `Run terminal command?`}
        </Text>
      </View>

      {isEmail ? (
        <View style={styles.confirmPreview}>
          <Text style={styles.confirmPreviewLabel}>To</Text>
          <Text style={styles.confirmPreviewValue} numberOfLines={1}>{preview.to}</Text>
          <Text style={styles.confirmPreviewLabel}>Subject</Text>
          <Text style={styles.confirmPreviewValue} numberOfLines={1}>{preview.subject}</Text>
          {!!preview.body && (
            <>
              <Text style={styles.confirmPreviewLabel}>Body</Text>
              <Text style={styles.confirmPreviewValue} numberOfLines={4}>{preview.body}</Text>
            </>
          )}
        </View>
      ) : isConnectedAccountAction ? (
        <View style={styles.confirmPreview}>
          <Text style={styles.confirmPreviewLabel}>Platform</Text>
          <Text style={styles.confirmPreviewValue} numberOfLines={1}>{preview.platform}</Text>
          <Text style={styles.confirmPreviewLabel}>Action</Text>
          <Text style={styles.confirmPreviewCode} numberOfLines={2}>{preview.action}</Text>
          {!!preview.reason && (
            <>
              <Text style={styles.confirmPreviewLabel}>Reason</Text>
              <Text style={styles.confirmPreviewValue} numberOfLines={3}>{preview.reason}</Text>
            </>
          )}
          {!!preview.data && (
            <>
              <Text style={styles.confirmPreviewLabel}>Data</Text>
              <Text style={styles.confirmPreviewCode} numberOfLines={4}>{preview.data}</Text>
            </>
          )}
        </View>
      ) : isCodexDelegation ? (
        <View style={styles.confirmPreview}>
          <Text style={styles.confirmPreviewLabel}>Task</Text>
          <Text style={styles.confirmPreviewCode}>{preview.task}</Text>
          {!!preview.context && (
            <>
              <Text style={styles.confirmPreviewLabel}>Context</Text>
              <Text style={styles.confirmPreviewValue}>{preview.context}</Text>
            </>
          )}
          <Text style={styles.confirmPreviewLabel}>Working directory</Text>
          <Text style={styles.confirmPreviewCode}>{preview.workingDirectory}</Text>
          <Text style={styles.confirmPreviewLabel}>Workspace access</Text>
          <Text style={styles.confirmPreviewValue}>{preview.access}</Text>
          <Text style={styles.confirmPreviewLabel}>External side effects</Text>
          <Text style={styles.confirmPreviewValue}>{preview.externalSideEffects || 'Not allowed'}</Text>
          {!!preview.timeoutSeconds && (
            <>
              <Text style={styles.confirmPreviewLabel}>Timeout</Text>
              <Text style={styles.confirmPreviewValue}>{preview.timeoutSeconds} seconds</Text>
            </>
          )}
          {!!preview.reason && (
            <>
              <Text style={styles.confirmPreviewLabel}>Why approval is required</Text>
              <Text style={styles.confirmPreviewValue}>{preview.reason}</Text>
            </>
          )}
        </View>
      ) : isAndroidAction ? (
        <View style={styles.confirmPreview}>
          <Text style={styles.confirmPreviewLabel}>Action</Text>
          <Text style={styles.confirmPreviewValue}>{previewAction || pendingConfirm.tool}</Text>
          {!!preview.to && (
            <>
              <Text style={styles.confirmPreviewLabel}>To</Text>
              <Text style={styles.confirmPreviewValue} numberOfLines={1}>{preview.to}</Text>
            </>
          )}
          {!!preview.message && (
            <>
              <Text style={styles.confirmPreviewLabel}>Message</Text>
              <Text style={styles.confirmPreviewCode} numberOfLines={4}>{preview.message}</Text>
            </>
          )}
          {!!preview.replyText && (
            <>
              <Text style={styles.confirmPreviewLabel}>Reply</Text>
              <Text style={styles.confirmPreviewCode} numberOfLines={4}>{preview.replyText}</Text>
            </>
          )}
          {!!preview.text && (
            <>
              <Text style={styles.confirmPreviewLabel}>Text</Text>
              <Text style={styles.confirmPreviewCode} numberOfLines={3}>{preview.text}</Text>
            </>
          )}
          {!!preview.notificationKey && (
            <>
              <Text style={styles.confirmPreviewLabel}>Notification</Text>
              <Text style={styles.confirmPreviewValue} numberOfLines={1}>{preview.notificationKey}</Text>
            </>
          )}
          {!!preview.durationMs && (
            <>
              <Text style={styles.confirmPreviewLabel}>Duration</Text>
              <Text style={styles.confirmPreviewValue}>{preview.durationMs} ms</Text>
            </>
          )}
          {!!preview.key && (
            <>
              <Text style={styles.confirmPreviewLabel}>Key</Text>
              <Text style={styles.confirmPreviewValue}>{preview.key}</Text>
            </>
          )}
          {!!preview.target && (
            <>
              <Text style={styles.confirmPreviewLabel}>Target</Text>
              <Text style={styles.confirmPreviewValue}>{preview.target}</Text>
            </>
          )}
          {!!preview.reason && (
            <>
              <Text style={styles.confirmPreviewLabel}>Reason</Text>
              <Text style={styles.confirmPreviewValue} numberOfLines={3}>{preview.reason}</Text>
            </>
          )}
          {!!preview.request && (
            <>
              <Text style={styles.confirmPreviewLabel}>Request</Text>
              <Text style={styles.confirmPreviewValue} numberOfLines={3}>{preview.request}</Text>
            </>
          )}
        </View>
      ) : (
        <View style={styles.confirmPreview}>
          <Text style={styles.confirmPreviewLabel}>Action</Text>
          <Text style={styles.confirmPreviewValue}>{preview.action}</Text>
          {!!preview.cmd && (
            <>
              <Text style={styles.confirmPreviewLabel}>Command</Text>
              <Text style={styles.confirmPreviewCode}>{preview.cmd}</Text>
            </>
          )}
          {!!preview.path && (
            <>
              <Text style={styles.confirmPreviewLabel}>Path</Text>
              <Text style={styles.confirmPreviewCode}>{preview.path}</Text>
            </>
          )}
        </View>
      )}

      <View style={styles.confirmBtnRow}>
        <Pressable
          style={[styles.confirmBtn, styles.confirmBtnCancel]}
          onPress={onCancel}
          disabled={isLoading}
        >
          <Ionicons name="close" size={14} color={Colors.textSecondary} />
          <Text style={styles.confirmBtnCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmBtn, styles.confirmBtnConfirm, isLoading && { opacity: 0.7 }]}
          onPress={onConfirm}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="checkmark" size={14} color="#fff" />
          )}
          <Text style={styles.confirmBtnConfirmText}>
            {isLoading
              ? (isEmail ? 'Sending...' : isConnectedAccountAction || isAndroidAction ? 'Approving...' : 'Running...')
              : isEmail ? 'Send' : isConnectedAccountAction || isAndroidAction ? 'Approve' : 'Run'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isFirst: boolean;
  isLastAssistant: boolean;
  goals: Goal[];
  onFollowup: (text: string) => void;
  onSpeak?: (text: string, assistantId?: string) => void;
  isSpeaking?: boolean;
  isStreaming?: boolean;
  onConfirmAction?: (msgId: string, confirmed: boolean) => void;
  onDiscordConnect?: () => void;
  onCopyDiagnostics?: (
    message: ChatMessage,
    target?: { reason: 'message' | 'action'; actionIndex?: number; action?: ExecutedAction },
  ) => void;
}

function persistChatHistory(messages: ChatMessage[]) {
  saveChatHistory(messages.map(({ diagnostics: _diagnostics, ...message }) => message));
}

function MessageBubble({ message, isFirst, isLastAssistant, goals, onFollowup, onSpeak, isSpeaking, isStreaming, onConfirmAction, onDiscordConnect, onCopyDiagnostics }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const router = useRouter();
  const [addedMap, setAddedMap] = useState<Record<string, boolean>>({});
  const [actionStatusMap, setActionStatusMap] = useState<Record<string, 'saving' | 'error'>>({});
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'reconnect'>('idle');
  const [gmailUrl, setGmailUrl] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!onConfirmAction || !message.pendingConfirm || confirmLoading) return;
    setConfirmLoading(true);
    try {
      await onConfirmAction(message.id, true);
    } finally {
      setConfirmLoading(false);
    }
  }, [onConfirmAction, message.id, message.pendingConfirm, confirmLoading]);

  const handleCancelConfirm = useCallback(async () => {
    if (!onConfirmAction || !message.pendingConfirm) return;
    await onConfirmAction(message.id, false);
  }, [onConfirmAction, message.id, message.pendingConfirm]);

  const parsedDraft = !isUser ? parseEmailDraft(message.content) : null;
  const hasDiagnostics = !isUser && !!message.diagnostics;
  const hasFailedDiagnostics = hasDiagnostics && (
    message.content.trim().toLowerCase().startsWith('error:') ||
    !!message.executedActions?.some((action) => action.result === 'error')
  );

  const handleSaveDraft = useCallback(async () => {
    if (!parsedDraft || draftStatus === 'saving' || draftStatus === 'saved') return;
    setDraftStatus('saving');
    try {
      const url = new URL('/api/gmail/create-draft', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: parsedDraft.to,
          subject: parsedDraft.subject,
          body: parsedDraft.body,
        }),
      });
      const data = await res.json();
      if (data.error === 'reconnect_required') {
        setDraftStatus('reconnect');
      } else if (data.draftId) {
        setDraftStatus('saved');
        setGmailUrl(data.gmailUrl);
      } else {
        setDraftStatus('error');
      }
    } catch {
      setDraftStatus('error');
    }
  }, [parsedDraft, draftStatus]);

  const handleAddAction = useCallback(async (action: CoachAction, key: string) => {
    if (addedMap[key]) return;
    if (actionStatusMap[key] === 'saving') return;
    if (action.type === 'link') {
      if (action.url) {
        if (action.url === 'profile://discord') {
          onDiscordConnect?.();
        } else if (action.url.startsWith('profile://')) {
          router.push('/(tabs)/profile');
        } else {
          Linking.openURL(action.url);
        }
      }
      return;
    }
    setActionStatusMap(prev => ({ ...prev, [key]: 'saving' }));
    try {
      if (action.type === 'reminder') {
        if (!action.scheduledAt) {
          throw new Error('No reminder time was provided.');
        }
        const res = await apiRequest('POST', '/api/jarvis/scheduled-tasks', {
          title: action.title,
          description: action.description || action.title,
          scheduledAt: action.scheduledAt,
          recurrence: action.recurrence,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Could not schedule reminder.');
        }
        queryClient.invalidateQueries({ queryKey: ['/api/jarvis/scheduled-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
      } else if (action.type === 'task') {
        const task = {
          id: generateId(),
          title: action.title,
          category: action.category as any,
          completed: false,
          priority: (action.priority || 'medium') as any,
          description: action.description,
          goalId: undefined,
          createdBy: 'coach_suggestion',
          originSurface: 'coach_chat',
          sourceIntent: 'suggestion_add',
          createdAt: Date.now(),
        };
        const res = await apiRequest('PATCH', '/api/daily-command/plan', {
          op: 'add_task',
          task,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Could not add task to today.');
        }
        queryClient.invalidateQueries({ queryKey: ['/api/daily-command/today'] });
      } else {
        const validCats = ['fitness', 'finance', 'career', 'personal', 'social'];
        const cat = validCats.includes(action.category) ? action.category : 'personal';
        const newGoal: Goal = {
          id: generateId(),
          title: action.title,
          category: cat as Goal['category'],
          target: 100,
          current: 0,
          unit: '',
          createdAt: new Date().toISOString(),
        };
        await saveGoal(newGoal);
      }
      setAddedMap(prev => ({ ...prev, [key]: true }));
      setActionStatusMap(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (error) {
      setActionStatusMap(prev => ({ ...prev, [key]: 'error' }));
      Alert.alert('Could not add this', error instanceof Error ? error.message : 'Please try again.');
    }
  }, [addedMap, actionStatusMap, onDiscordConnect, router]);

  return (
    <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
      {!isUser && isFirst && (
        <View style={styles.coachLabel}>
          <Ionicons name="sparkles-outline" size={12} color={Colors.secondary} />
          <Text style={styles.coachLabelText}>JARVIS</Text>
        </View>
      )}
      {!isUser && message.pendingConfirm ? (
        <ConfirmCard
          pendingConfirm={message.pendingConfirm}
          onConfirm={handleConfirm}
          onCancel={handleCancelConfirm}
          isLoading={confirmLoading}
        />
      ) : (
        <Pressable
          disabled={!hasDiagnostics}
          onLongPress={() => onCopyDiagnostics?.(message, { reason: 'message' })}
          style={({ pressed }) => [
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleAssistant,
            hasDiagnostics && pressed && styles.diagnosticPressActive,
          ]}
        >
          <MarkdownText
            text={message.content}
            isUser={isUser}
          />
        </Pressable>
      )}

      {!isUser && message.stopped && (
        <View style={styles.stoppedPill}>
          <Ionicons name="stop-circle-outline" size={12} color={Colors.textSecondary} />
          <Text style={styles.stoppedPillText}>stopped</Text>
        </View>
      )}

      {hasFailedDiagnostics && (
        <Pressable
          style={({ pressed }) => [styles.diagnosticCopyButton, pressed && { opacity: 0.75 }]}
          onPress={() => onCopyDiagnostics?.(message, { reason: 'message' })}
        >
          <Ionicons name="copy-outline" size={12} color={Colors.warning} />
          <Text style={styles.diagnosticCopyButtonText}>Copy details</Text>
        </Pressable>
      )}

      {!isUser && message.executedActions && message.executedActions.length > 0 && (() => {
        const urlActions = message.executedActions!.filter(ea => ea.url);
        const screenshotActions = message.executedActions!.filter(ea => !ea.url && ea.screenshotUrl);
        const imageActions = message.executedActions!.filter(ea => !ea.url && !ea.screenshotUrl && ea.imageUrl);
        const videoActions = message.executedActions!.filter(ea => !ea.url && !ea.screenshotUrl && !ea.imageUrl && ea.videoUrl);
        // MCP-attributed plain actions (server badge only — no rich attachments)
        const mcpPlainActions = message.executedActions!.filter(ea => ea.mcpServerName);
        const nonUrlActions = message.executedActions!.filter(ea => !ea.url && !ea.screenshotUrl && !ea.imageUrl && !ea.videoUrl && !ea.mcpServerName);
        return (
          <>
            {urlActions.map((ea, idx) => (
              <View key={`link-${idx}`}>
                <Pressable
                  style={({ pressed }) => [styles.executedActionButton, pressed && { opacity: 0.8 }]}
                  onPress={() => {
                    if (ea.url === 'profile://discord') {
                      onDiscordConnect?.();
                    } else if (ea.url === 'app://inbox') {
                      router.push('/(tabs)/inbox');
                    } else if (ea.url!.startsWith('profile://')) {
                      router.push('/(tabs)/profile');
                    } else {
                      Linking.openURL(ea.url!);
                    }
                  }}
                >
                  <Ionicons name="open-outline" size={15} color="#fff" />
                  <Text style={styles.executedActionButtonText}>{ea.buttonLabel || ea.label}</Text>
                </Pressable>
                {ea.code && (
                  <Pressable
                    style={styles.connectCodeBlock}
                    onPress={() => {
                      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                        navigator.clipboard.writeText(ea.code!);
                      }
                    }}
                  >
                    <Text style={styles.connectCodeLabel}>Your code — send this to the bot:</Text>
                    <View style={styles.connectCodeRow}>
                      <Text selectable style={styles.connectCodeText}>{ea.code}</Text>
                      {Platform.OS === 'web' && (
                        <Ionicons name="copy-outline" size={14} color={Colors.textSecondary} />
                      )}
                    </View>
                    {Platform.OS !== 'web' && (
                      <Text style={styles.connectCodeHint}>Long-press the code to copy</Text>
                    )}
                  </Pressable>
                )}
              </View>
            ))}
            {nonUrlActions.length > 0 && (
              <View style={styles.executedActionsRow}>
                {nonUrlActions.map((ea, idx) => (
                  <Pressable
                    key={`badge-${idx}`}
                    onLongPress={() => onCopyDiagnostics?.(message, { reason: 'action', actionIndex: idx, action: ea })}
                    style={({ pressed }) => [
                      styles.executedActionBadge,
                      ea.result === 'error' && styles.executedActionBadgeError,
                      hasDiagnostics && pressed && styles.diagnosticPressActive,
                    ]}
                  >
                    <Ionicons
                      name={ea.result === 'success' ? 'checkmark-circle' : 'alert-circle'}
                      size={12}
                      color={ea.result === 'success' ? Colors.success : '#EF4444'}
                    />
                    <Text style={[styles.executedActionText, ea.result === 'error' && styles.executedActionTextError]}>
                      {ea.buttonLabel || ea.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {screenshotActions.map((ea, idx) => (
              <View key={`screenshot-${idx}`} style={styles.screenshotContainer}>
                <View style={styles.screenshotBadgeRow}>
                  <Ionicons name="phone-portrait-outline" size={12} color={Colors.success} />
                  <View style={styles.screenshotLabelBlock}>
                    <Text style={styles.screenshotLabel}>{ea.label && ea.label !== 'Screenshot captured' ? ea.label : 'Temporary screen capture'}</Text>
                    <Text style={styles.screenshotHint}>Attached to chat; Gallery save not intended</Text>
                  </View>
                </View>
                <Image
                  source={{ uri: `${getApiUrl().replace(/\/$/, '')}${ea.screenshotUrl}` }}
                  style={styles.screenshotImage}
                  resizeMode="contain"
                />
              </View>
            ))}
            {imageActions.map((ea, idx) => (
              <View key={`image-${idx}`} style={styles.generatedImageContainer}>
                <Image
                  source={{ uri: ea.imageUrl! }}
                  style={styles.generatedImage}
                  resizeMode="cover"
                />
                {!!ea.imageCaption && (
                  <Text style={styles.generatedImageCaption}>{ea.imageCaption}</Text>
                )}
              </View>
            ))}
            {videoActions.map((ea, idx) => (
              <Pressable
                key={`video-${idx}`}
                style={({ pressed }) => [styles.generatedVideoCard, pressed && { opacity: 0.85 }]}
                onPress={() => Linking.openURL(ea.videoUrl!)}
              >
                <View style={styles.generatedVideoThumb}>
                  <Ionicons name="play-circle" size={44} color="rgba(255,255,255,0.9)" />
                </View>
                <View style={styles.generatedVideoFooter}>
                  <Ionicons name="videocam-outline" size={13} color={Colors.textSecondary} />
                  <Text style={styles.generatedVideoLabel} numberOfLines={1}>
                    {ea.videoCaption || ea.label || 'Generated video — tap to play'}
                  </Text>
                </View>
              </Pressable>
            ))}
            {/* MCP server attribution badges (plain results) */}
            {mcpPlainActions.length > 0 && (() => {
              const uniqueServers = Array.from(new Set(mcpPlainActions.map(ea => ea.mcpServerName!)));
              return (
                <View style={styles.mcpAttributionRow}>
                  {uniqueServers.map((srv, idx) => (
                    <View key={idx} style={styles.mcpAttributionBadge}>
                      <Ionicons name="server-outline" size={10} color={Colors.primary} />
                      <Text style={styles.mcpAttributionText}>via {srv}</Text>
                    </View>
                  ))}
                </View>
              );
            })()}
          </>
        );
      })()}

      {/* MCP rich content from mcp_attachments SSE events — ChannelAttachment-compatible contract */}
      {!isUser && (message.mcpAttachments?.length ?? 0) > 0 && (() => {
        const atts = message.mcpAttachments!;
        const serverNames = Array.from(new Set(atts.map(a => a.mcpServerName).filter(Boolean)));
        return (
          <>
            {serverNames.length > 0 && (
              <View style={styles.mcpAttributionRow}>
                {serverNames.map((srv, idx) => (
                  <View key={idx} style={styles.mcpAttributionBadge}>
                    <Ionicons name="server-outline" size={10} color={Colors.primary} />
                    <Text style={styles.mcpAttributionText}>via {srv}</Text>
                  </View>
                ))}
              </View>
            )}
            {atts.map((att, attIdx) => {
              if (att.kind === 'image' && att.data) {
                return (
                  <View key={attIdx} style={styles.mcpImageContainer}>
                    <Image
                      source={{ uri: `data:${att.mimeType ?? 'image/png'};base64,${att.data}` }}
                      style={styles.mcpImage}
                      resizeMode="contain"
                    />
                  </View>
                );
              }
              if (att.kind === 'markdown' && att.text) {
                return (
                  <View key={attIdx} style={styles.mcpMarkdownContainer}>
                    <MarkdownText text={att.text} />
                  </View>
                );
              }
              if ((att.kind === 'file' || att.kind === 'document') && att.filename) {
                const content = att.text ?? att.data;
                const isText = !att.mimeType || att.mimeType.startsWith('text/') || att.mimeType === 'application/json' || att.mimeType === 'application/xml';
                return (
                  <Pressable
                    key={attIdx}
                    style={({ pressed }) => [styles.mcpFileCard, pressed && { opacity: 0.8 }]}
                    onPress={() => {
                      if (content && isText) {
                        if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                          navigator.clipboard.writeText(content);
                          Alert.alert('Copied', `${att.filename} content copied to clipboard.`);
                        } else {
                          Alert.alert(att.filename!, content.slice(0, 500) + (content.length > 500 ? '\n…' : ''));
                        }
                      } else {
                        Alert.alert('File returned', `${att.filename} was returned by ${att.mcpServerName ?? 'MCP'}. ${att.mimeType ? `Type: ${att.mimeType}` : ''}`);
                      }
                    }}
                  >
                    <Ionicons name="document-outline" size={20} color={Colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mcpFileName} numberOfLines={1}>{att.filename}</Text>
                      <Text style={styles.mcpFileMime}>
                        {[att.mimeType, att.size != null ? (att.size >= 1024 ? `${Math.round(att.size / 1024)} KB` : `${att.size} B`) : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Ionicons name="copy-outline" size={14} color={Colors.textSecondary} />
                  </Pressable>
                );
              }
              return null;
            })}
          </>
        );
      })()}
      {!isUser && isLastAssistant && !isStreaming && message.content.length > 0 && onSpeak && (
        <Pressable
          style={styles.speakBtn}
          onPress={() => onSpeak(message.content, message.id)}
        >
          <Ionicons
            name={isSpeaking ? "volume-high" : "volume-medium-outline"}
            size={16}
            color={isSpeaking ? Colors.primary : Colors.textSecondary}
          />
        </Pressable>
      )}

      {!isUser && parsedDraft && (
        <View style={styles.draftRow}>
          {draftStatus === 'idle' && (
            <Pressable style={styles.draftBtn} onPress={handleSaveDraft}>
              <Ionicons name="mail-outline" size={14} color="#fff" />
              <Text style={styles.draftBtnText}>Save to Drafts</Text>
            </Pressable>
          )}
          {draftStatus === 'saving' && (
            <View style={styles.draftBtn}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.draftBtnText}>Saving...</Text>
            </View>
          )}
          {draftStatus === 'saved' && (
            <View style={styles.draftSavedRow}>
              <View style={styles.draftSavedPill}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                <Text style={styles.draftSavedText}>Draft saved</Text>
              </View>
              {gmailUrl && (
                <Pressable onPress={() => Linking.openURL(gmailUrl)}>
                  <Text style={styles.draftOpenLink}>Open in Gmail</Text>
                </Pressable>
              )}
            </View>
          )}
          {draftStatus === 'error' && (
            <Pressable style={[styles.draftBtn, styles.draftBtnError]} onPress={handleSaveDraft}>
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.draftBtnText}>Retry</Text>
            </Pressable>
          )}
          {draftStatus === 'reconnect' && (
            <View style={styles.draftReconnectPill}>
              <Ionicons name="warning-outline" size={14} color="#D97706" />
              <Text style={styles.draftReconnectText}>Reconnect Google in Profile to enable drafting</Text>
            </View>
          )}
        </View>
      )}

      {!isUser && message.actions && message.actions.length > 0 && (
        <View style={styles.actionRow}>
          {message.actions.map((action, idx) => {
            const key = `${action.type}-${idx}`;
            const added = addedMap[key];
            const status = actionStatusMap[key];
            const saving = status === 'saving';
            const failed = status === 'error';
            const actionIcon = action.type === 'link'
              ? 'link-outline'
              : saving
                ? 'time-outline'
                : added
                  ? 'checkmark'
                  : failed
                    ? 'alert-circle-outline'
                    : action.type === 'reminder'
                      ? 'alarm-outline'
                      : action.type === 'task'
                        ? 'add-circle-outline'
                        : 'flag-outline';
            const actionLabel = action.type === 'link'
              ? (action.buttonLabel || action.title)
              : saving
                ? 'Adding...'
                : added
                  ? (action.type === 'reminder' ? 'Reminder set' : 'Added!')
                  : failed
                    ? 'Retry add'
                    : action.type === 'reminder'
                      ? `Remind: ${action.title}`
                      : action.type === 'task'
                        ? `Add: ${action.title}`
                        : `Set goal: ${action.title}`;
            return (
              <Pressable
                key={key}
                style={[
                  styles.actionPill,
                  added && styles.actionPillAdded,
                  failed && styles.actionPillError,
                  action.type === 'link' && styles.actionPillLink,
                  action.type === 'reminder' && !added && !failed && styles.actionPillReminder,
                ]}
                onPress={() => handleAddAction(action, key)}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Ionicons
                    name={actionIcon as any}
                    size={13}
                    color={action.type === 'link' ? '#818CF8' : failed ? Colors.error : added ? Colors.success : Colors.primary}
                  />
                )}
                <Text style={[
                  styles.actionPillText,
                  added && styles.actionPillTextAdded,
                  failed && styles.actionPillTextError,
                  action.type === 'link' && styles.actionPillTextLink,
                ]}>
                  {actionLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {!isUser && isLastAssistant && message.followups && message.followups.length > 0 && (
        <View style={styles.followupRow}>
          {message.followups.map((fup, idx) => (
            <Pressable key={idx} style={styles.followupChip} onPress={() => onFollowup(fup)}>
              <Text style={styles.followupChipText}>{fup}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [isSearchingWeb, setIsSearchingWeb] = useState(false);
  const [isWorkingOnPhone, setIsWorkingOnPhone] = useState(false);
  const [phoneWorkingMessage, setPhoneWorkingMessage] = useState('Working on your phone...');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stats, setStats] = useState<UserStats>({ streak: 0, totalCompleted: 0, bestStreak: 0, xp: 0, badges: [], claimedRewards: [], dailyXpEarned: { date: new Date().toISOString().slice(0, 10), xp: 0 } });
  const [history, setHistory] = useState<any[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<{ title: string; time: string }[]>([]);
  const [lifeContext, setLifeContext] = useState<LifeContext | null>(null);
  const [gmailItems, setGmailItems] = useState<{ subject: string; snippet: string; date: string; from?: string }[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [slackMessages, setSlackMessages] = useState<any[]>([]);
  const [slackConnected, setSlackConnected] = useState(false);
  const [telegramMessages, setTelegramMessages] = useState<any[]>([]);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [integrationError, setIntegrationError] = useState<{ integration: string } | null>(null);
  const [discordConnectVisible, setDiscordConnectVisible] = useState(false);
  const [discordPhase, setDiscordPhase] = useState<'loading' | 'setup_bot' | 'pair' | 'done' | 'discord_os'>('loading');
  const [discordPairInput, setDiscordPairInput] = useState('');
  const [discordConnecting, setDiscordConnecting] = useState(false);
  const [discordConnectError, setDiscordConnectError] = useState('');
  const [discordBotTokenInput, setDiscordBotTokenInput] = useState('');
  const [discordTokenSaving, setDiscordTokenSaving] = useState(false);
  const [discordTokenError, setDiscordTokenError] = useState('');
  const [discordGuilds, setDiscordGuilds] = useState<{ id: string; name: string; icon: string | null }[]>([]);
  const [discordWorkspaceLoading, setDiscordWorkspaceLoading] = useState(false);
  const [discordWorkspaceDone, setDiscordWorkspaceDone] = useState(false);
  const [discordWorkspaceError, setDiscordWorkspaceError] = useState('');
  // Discord OS Dashboard state
  const [discordOsSchedules, setDiscordOsSchedules] = useState<any[]>([]);
  const [discordOsApprovals, setDiscordOsApprovals] = useState<any[]>([]);
  const [discordOsAgents, setDiscordOsAgents] = useState<any[]>([]);
  const [discordOsActivity, setDiscordOsActivity] = useState<any[]>([]);
  const [discordOsLoading, setDiscordOsLoading] = useState(false);
  const [discordOsToggling, setDiscordOsToggling] = useState<Record<string, boolean>>({});
  const [emailSuggestions, setEmailSuggestions] = useState<EmailSuggestion[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [addedSuggestions, setAddedSuggestions] = useState<Record<number, boolean>>({});
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const coachingModeRef = useRef<CoachingMode>(DEFAULT_RUNTIME_MODE);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [talkModeEnabled, setTalkModeEnabled] = useState(false);
  const [voiceApprovalPrompt, setVoiceApprovalPrompt] = useState<string | null>(null);
  const [voiceApprovalToken, setVoiceApprovalToken] = useState<string | null>(null);
  const [voiceConfirmationExecuting, setVoiceConfirmationExecuting] = useState(false);
  const talkModeRef = useRef(false);
  const talkModeStartSeqRef = useRef(0);
  const outsideAppVoiceStateRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  const nativeSpeechActiveRef = useRef(false);
  const nativeSpeechManualFinishRef = useRef(false);
  const nativeSpeechCancelledRef = useRef(false);
  const startRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const stopRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const stopRecordingSilentlyRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const speakTextRef = useRef<(text: string, assistantId?: string) => void>(() => {});
  const isRecordingRef = useRef(false);
  const [isTTSLoading, setIsTTSLoading] = useState(false);
  const speakingTextRef = useRef<string | null>(null);
  const speakingAssistantIdRef = useRef<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const audioRecorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const silencePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<AudioPlayer | null>(null);
  const webAudioRef = useRef<HTMLAudioElement | null>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const chatRunIdRef = useRef<string | null>(null);
  const sdkSessionIdRef = useRef<string | null>(null);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const isSpeakingRef = useRef(false);
  const nativeVoiceStateSyncHeldRef = useRef(false);
  const nativeVoiceStateSyncReadyRef = useRef(Platform.OS !== 'android');
  const initialLoadCompleteRef = useRef(false);
  const [nativeVoiceStateSyncReady, setNativeVoiceStateSyncReady] = useState(Platform.OS !== 'android');
  const voiceConfirmationExecutingRef = useRef(false);
  const isTranscribingRef = useRef(false);
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<Blob[]>([]);
  const sendMessageRef = useRef<(text: string, origin?: SendMessageOrigin) => void>(() => {});
  const confirmActionRef = useRef<VoiceConfirmAction>(() => Promise.resolve());
  const inputRef = useRef('');
  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingVoiceDiagnosticCopyRef = useRef(false);
  const hasScrolledRef = useRef(false);
  const initialScanDoneRef = useRef(false);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  // MCP prompt browser state
  interface McpPromptEntry {
    serverName: string;
    serverId: string;
    name: string;
    description?: string;
    arguments?: { name: string; description?: string; required?: boolean }[];
  }
  const [showMcpSheet, setShowMcpSheet] = useState(false);
  const [mcpPrompts, setMcpPrompts] = useState<McpPromptEntry[]>([]);
  const [mcpPromptsLoading, setMcpPromptsLoading] = useState(false);

  const [isBaseLoading, setIsBaseLoading] = useState(true);
  const [isEmailLoading, setIsEmailLoading] = useState(true);
  const commitmentsRef = useRef<Commitment[]>([]);
  const proactiveCheckedRef = useRef(false);
  const gmailItemsRef = useRef<typeof gmailItems>([]);
  const gmailConnectedRef = useRef(false);
  const slackMessagesRef = useRef<any[]>([]);
  const slackConnectedRef = useRef(false);
  const telegramMessagesRef = useRef<any[]>([]);
  const telegramConnectedRef = useRef(false);
  // Polls for channel connection after Jarvis sends a connect link via the agent.
  const channelConnectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const calendarEventsRef = useRef<typeof calendarEvents>([]);
  const goalsRef = useRef<typeof goals>([]);
  const statsRef = useRef<typeof stats>({ streak: 0, totalCompleted: 0, bestStreak: 0, xp: 0, badges: [], claimedRewards: [], dailyXpEarned: { date: new Date().toISOString().slice(0, 10), xp: 0 } });
  const historyRef = useRef<typeof history>([]);
  const lifeContextRef = useRef<typeof lifeContext>(null);
  const flatListRef = useRef<FlatList>(null);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const tabBarCtx = useContext(BottomTabBarHeightContext);
  const tabBarHeight = tabBarCtx ?? (Platform.OS === 'web' ? 84 : 50 + insets.bottom);
  const micPulse = useSharedValue(1);
  const waveBar1 = useSharedValue(0.3);
  const waveBar2 = useSharedValue(0.3);
  const waveBar3 = useSharedValue(0.3);
  const waveBar4 = useSharedValue(0.3);

  useEffect(() => {
    if (isRecording) {
      micPulse.value = withRepeat(
        withTiming(0.4, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      micPulse.value = withTiming(1, { duration: 200 });
    }
  }, [isRecording, micPulse]);


  useEffect(() => {
    if (!messages[0]?.id || messages.length === 0) return;
    if (hasScrolledRef.current && messages[0]?.role !== 'user') return;
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, [messages]);

  useEffect(() => {
    if (isSpeaking) {
      waveBar1.value = withRepeat(withTiming(1, { duration: 400, easing: Easing.inOut(Easing.ease) }), -1, true);
      waveBar2.value = withRepeat(withTiming(1, { duration: 550, easing: Easing.inOut(Easing.ease) }), -1, true);
      waveBar3.value = withRepeat(withTiming(1, { duration: 350, easing: Easing.inOut(Easing.ease) }), -1, true);
      waveBar4.value = withRepeat(withTiming(1, { duration: 480, easing: Easing.inOut(Easing.ease) }), -1, true);
    } else {
      waveBar1.value = withTiming(0.3, { duration: 200 });
      waveBar2.value = withTiming(0.3, { duration: 200 });
      waveBar3.value = withTiming(0.3, { duration: 200 });
      waveBar4.value = withTiming(0.3, { duration: 200 });
    }
  }, [isSpeaking]);

  const waveBarStyle1 = useAnimatedStyle(() => ({ transform: [{ scaleY: waveBar1.value }] }));
  const waveBarStyle2 = useAnimatedStyle(() => ({ transform: [{ scaleY: waveBar2.value }] }));
  const waveBarStyle3 = useAnimatedStyle(() => ({ transform: [{ scaleY: waveBar3.value }] }));
  const waveBarStyle4 = useAnimatedStyle(() => ({ transform: [{ scaleY: waveBar4.value }] }));

  const micPulseStyle = useAnimatedStyle(() => ({
    opacity: micPulse.value,
  }));

  useEffect(() => { commitmentsRef.current = commitments; }, [commitments]);
  useEffect(() => { gmailItemsRef.current = gmailItems; }, [gmailItems]);
  useEffect(() => { gmailConnectedRef.current = gmailConnected; }, [gmailConnected]);
  useEffect(() => { slackMessagesRef.current = slackMessages; }, [slackMessages]);
  useEffect(() => { slackConnectedRef.current = slackConnected; }, [slackConnected]);
  useEffect(() => { telegramMessagesRef.current = telegramMessages; }, [telegramMessages]);
  useEffect(() => { telegramConnectedRef.current = telegramConnected; }, [telegramConnected]);
  useEffect(() => { calendarEventsRef.current = calendarEvents; }, [calendarEvents]);
  useEffect(() => { goalsRef.current = goals; }, [goals]);
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { lifeContextRef.current = lifeContext; }, [lifeContext]);
  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    return () => {
      if (audioRecorder.isRecording) {
        audioRecorder.stop().catch(() => {});
        // Always release exclusive audio focus so other apps can use the mic
        if (Platform.OS !== 'web') {
          setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
        }
      }
      if (Platform.OS === 'android' && nativeSpeechActiveRef.current) {
        nativeSpeechCancelledRef.current = true;
        cancelAndroidNativeSpeechRecognition().catch(() => {});
        nativeSpeechActiveRef.current = false;
      }
      soundRef.current?.remove();
      speakAbortRef.current?.abort();
      if (Platform.OS === 'android') {
        Speech.stop().catch(() => {});
      }
      if (Platform.OS === 'web') {
        webAudioRef.current?.pause();
        webAudioRef.current = null;
      }
      if (channelConnectPollRef.current) {
        clearInterval(channelConnectPollRef.current);
        channelConnectPollRef.current = null;
      }
    };
  }, []);

  const clearSilencePoll = useCallback(() => {
    if (silencePollRef.current) {
      clearInterval(silencePollRef.current);
      silencePollRef.current = null;
    }
  }, []);

  const stopRecordingSilently = useCallback(async () => {
    setIsRecording(false);
    clearSilencePoll();

    if (Platform.OS === 'web') {
      const recorder = webRecorderRef.current;
      webRecorderRef.current = null;
      webChunksRef.current = [];
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
        recorder.stream.getTracks().forEach(t => t.stop());
      }
      return;
    }

    if (Platform.OS === 'android' && nativeSpeechActiveRef.current) {
      nativeSpeechCancelledRef.current = true;
      nativeSpeechActiveRef.current = false;
      await cancelAndroidNativeSpeechRecognition().catch(() => {});
      setIsTranscribing(false);
      return;
    }

    try {
      if (audioRecorder.isRecording) {
        await audioRecorder.stop().catch(() => {});
      }
      const uri = audioRecorder.uri;
      if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    } finally {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      setIsTranscribing(false);
    }
  }, [audioRecorder, clearSilencePoll]);

  stopRecordingSilentlyRef.current = stopRecordingSilently;

  const submitVoiceTranscript = useCallback((rawTranscript: string) => {
    const transcriptText = rawTranscript.trim();
    if (!transcriptText) {
      setIsTranscribing(false);
      if (talkModeRef.current) {
        setInput('');
        return;
      }
      Alert.alert('Could not understand', 'No speech was detected. Please try again and speak clearly.');
      return;
    }

    setIsTranscribing(false);
    if (talkModeRef.current) {
      setInput(transcriptText);
      const now = new Date().toISOString();
      setTimeout(() => {
        if (!talkModeRef.current) return;
        sendMessageRef.current(transcriptText, {
          source: 'voice',
          voiceTrace: {
            finalTranscript: transcriptText,
            finishedAt: now,
            stateTransitions: [
              { state: 'transcription_complete', at: now, detail: 'Talk Mode transcript auto-sent' },
            ],
          },
        });
      }, 80);
      return;
    }

    const draftText = inputRef.current.trim();
    const messageText = draftText ? `${draftText} ${transcriptText}` : transcriptText;
    if (isStreamingRef.current) {
      setInput(messageText);
      return;
    }
    const now = new Date().toISOString();
    sendMessageRef.current(messageText, {
      source: 'voice',
      voiceTrace: {
        finalTranscript: transcriptText,
        finishedAt: now,
        stateTransitions: [
          {
            state: 'transcription_complete',
            at: now,
            detail: draftText
              ? 'Chat mic transcript auto-sent with typed draft'
              : 'Chat mic transcript auto-sent',
          },
        ],
      },
    });
  }, []);

  const transcribeAndSend = useCallback(async (base64: string) => {
    const transcribeSeq = talkModeStartSeqRef.current;
    setIsTranscribing(true);
    try {
      const url = new URL('/api/coach/transcribe', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64 }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      if (
        talkModeRef.current &&
        (talkModeStartSeqRef.current !== transcribeSeq || outsideAppVoiceStateRef.current === 'paused')
      ) {
        setIsTranscribing(false);
        return;
      }
      submitVoiceTranscript(typeof data.text === 'string' ? data.text : '');
    } catch (error) {
      console.error('Failed to transcribe:', error);
      setIsTranscribing(false);
      Alert.alert('Transcription failed', 'Could not process your voice message. Please try again.');
    }
  }, [submitVoiceTranscript]);

  const startRecording = useCallback(async () => {
    const startedForTalkMode = talkModeRef.current;
    const talkModeStartSeq = talkModeStartSeqRef.current;
    const shouldCancelTalkModeStart = () =>
      startedForTalkMode && (
        !talkModeRef.current ||
        talkModeStartSeqRef.current !== talkModeStartSeq ||
        isStreamingRef.current ||
        isSpeakingRef.current ||
        isTranscribingRef.current
      );

    try {
      if (Platform.OS === 'web') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (shouldCancelTalkModeStart()) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        const recorder = new MediaRecorder(stream);
        webChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) webChunksRef.current.push(e.data);
        };
        recorder.start();
        webRecorderRef.current = recorder;
        setIsRecording(true);

        // Web Talk Mode: use Web Audio API to detect silence and auto-submit
        if (talkModeRef.current) {
          const audioCtx = new AudioContext();
          const analyser = audioCtx.createAnalyser();
          audioCtx.createMediaStreamSource(stream).connect(analyser);
          const data = new Float32Array(analyser.fftSize);
          let silenceState = createLocalVoiceSilenceState();
          silencePollRef.current = setInterval(() => {
            if (!talkModeRef.current || !webRecorderRef.current) {
              clearInterval(silencePollRef.current!);
              audioCtx.close().catch(() => {});
              return;
            }
            analyser.getFloatTimeDomainData(data);
            const maxAmp = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
            const db = maxAmp > 0 ? 20 * Math.log10(maxAmp) : -Infinity;
            silenceState = updateLocalVoiceSilenceState(silenceState, {
              decibels: db,
              pollMs: LOCAL_VOICE_SILENCE_POLL_MS,
            });
            if (silenceState.shouldSubmit || silenceState.shouldPause) {
              clearSilencePoll();
              audioCtx.close().catch(() => {});
              if (silenceState.shouldSubmit) {
                stopRecordingRef.current().catch(() => {});
              } else {
                stopRecordingSilentlyRef.current().catch(() => {});
              }
            }
          }, LOCAL_VOICE_SILENCE_POLL_MS);
        }
      } else if (Platform.OS === 'android') {
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          Alert.alert('Permission Required', 'Microphone access is needed to use voice input.');
          return;
        }
        if (shouldCancelTalkModeStart()) return;
        if (soundRef.current) {
          soundRef.current.pause();
          soundRef.current.remove();
          soundRef.current = null;
        }

        nativeSpeechActiveRef.current = true;
        nativeSpeechManualFinishRef.current = false;
        nativeSpeechCancelledRef.current = false;
        setIsRecording(true);
        try {
          let continuationState = createLocalVoiceContinuationState();
          let listeningForContinuation = false;

          while (
            !nativeSpeechCancelledRef.current &&
            !(nativeSpeechManualFinishRef.current && continuationState.transcript)
          ) {
            let continuationTimer: ReturnType<typeof setTimeout> | null = null;
            let continuationSpeechDetected = false;
            const clearContinuationTimer = () => {
              if (!continuationTimer) return;
              clearTimeout(continuationTimer);
              continuationTimer = null;
            };
            const armContinuationTimer = (delayMs: number) => {
              clearContinuationTimer();
              continuationTimer = setTimeout(() => {
                if (continuationSpeechDetected || nativeSpeechManualFinishRef.current) return;
                cancelAndroidNativeSpeechRecognition().catch(() => {});
              }, delayMs);
            };

            if (listeningForContinuation) {
              // Include a small startup allowance; the ready event resets this to the exact window.
              armContinuationTimer(continuationState.continuationWindowMs + 1_000);
            }

            try {
              const result = await recognizeAndroidSpeechOnce({
                // Jarvis Talk Mode currently supports English only; avoid inheriting arbitrary device locales.
                locale: 'en-US',
                interimResults: true,
                timeoutMs: 60_000,
                onEvent: (event) => {
                  if (!listeningForContinuation) return;
                  if (event.type === 'ready' && nativeSpeechManualFinishRef.current) {
                    stopAndroidNativeSpeechRecognition().catch(() => {});
                    return;
                  }
                  if (event.type === 'ready' && !continuationSpeechDetected) {
                    armContinuationTimer(continuationState.continuationWindowMs);
                  }
                  if (event.type === 'speech_start' || event.type === 'partial') {
                    continuationSpeechDetected = true;
                    clearContinuationTimer();
                  }
                },
              });
              clearContinuationTimer();
              if (!result.text.trim() && continuationState.transcript) {
                break;
              }
              continuationState = addLocalVoiceTranscriptSegment(continuationState, result.text, {
                manualFinish: nativeSpeechManualFinishRef.current,
              });
            } catch (error) {
              clearContinuationTimer();
              const message = error instanceof Error ? error.message : String(error);
              const endedEmptyContinuation = continuationState.transcript.length > 0 && (
                /cancelled|no speech|did not hear|no.match|speech.timeout|timed out/i.test(message)
              );
              if (endedEmptyContinuation) break;
              throw error;
            }

            if (
              nativeSpeechManualFinishRef.current ||
              !continuationState.shouldListenForContinuation
            ) {
              break;
            }
            listeningForContinuation = true;
          }

          if (
            startedForTalkMode &&
            (talkModeStartSeqRef.current !== talkModeStartSeq || outsideAppVoiceStateRef.current === 'paused')
          ) {
            return;
          }
          if (!nativeSpeechCancelledRef.current) {
            submitVoiceTranscript(continuationState.transcript);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/cancelled/i.test(message)) return;
          Alert.alert('Voice input failed', message || 'Android on-device speech recognition could not start.');
        } finally {
          nativeSpeechActiveRef.current = false;
          setIsRecording(false);
          setIsTranscribing(false);
        }
      } else {
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          Alert.alert('Permission Required', 'Microphone access is needed to use voice input.');
          return;
        }
        if (shouldCancelTalkModeStart()) return;
        if (soundRef.current) {
          soundRef.current.pause();
          soundRef.current.remove();
          soundRef.current = null;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (shouldCancelTalkModeStart()) {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
          return;
        }
        await audioRecorder.prepareToRecordAsync();
        if (shouldCancelTalkModeStart()) {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
          return;
        }
        audioRecorder.record();
        if (shouldCancelTalkModeStart()) {
          stopRecordingSilentlyRef.current().catch(() => {});
          return;
        }
        setIsRecording(true);

        // Native Talk Mode: poll metering and auto-submit after sustained silence
        if (talkModeRef.current) {
          let silenceState = createLocalVoiceSilenceState();
          silencePollRef.current = setInterval(() => {
            if (!talkModeRef.current || !audioRecorder.isRecording) {
              clearInterval(silencePollRef.current!);
              silencePollRef.current = null;
              return;
            }
            try {
              const status = audioRecorder.getStatus();
              if (typeof status.metering !== 'number') {
                return;
              }
              const db = status.metering;
              silenceState = updateLocalVoiceSilenceState(silenceState, {
                decibels: db,
                pollMs: LOCAL_VOICE_SILENCE_POLL_MS,
              });
              if (silenceState.shouldSubmit) {
                clearSilencePoll();
                stopRecordingRef.current().catch(() => {});
              } else if (silenceState.shouldPause) {
                clearSilencePoll();
                stopRecordingSilentlyRef.current().catch(() => {});
              }
            } catch { /* recording may have been stopped externally */ }
          }, LOCAL_VOICE_SILENCE_POLL_MS);
        }
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Recording Failed', 'Could not start recording. Please check microphone permissions and try again.');
    }
  }, [audioRecorder, clearSilencePoll, submitVoiceTranscript]);

  startRecordingRef.current = startRecording;


  const stopRecordingAndSend = useCallback(async () => {
    setIsRecording(false);
    clearSilencePoll();

    if (Platform.OS === 'web') {
      const recorder = webRecorderRef.current;
      if (!recorder) return;
      webRecorderRef.current = null;

      const base64 = await new Promise<string>((resolve, reject) => {
        recorder.onstop = () => {
          const blob = new Blob(webChunksRef.current, { type: recorder.mimeType });
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        };
        recorder.stop();
        recorder.stream.getTracks().forEach(t => t.stop());
      });
      webChunksRef.current = [];
      transcribeAndSend(base64);
    } else if (Platform.OS === 'android' && nativeSpeechActiveRef.current) {
      setIsTranscribing(true);
      nativeSpeechManualFinishRef.current = true;
      await stopAndroidNativeSpeechRecognition().catch((error) => {
        console.error('Failed to stop Android speech recognition:', error);
        nativeSpeechActiveRef.current = false;
        setIsTranscribing(false);
      });
    } else {
      if (!audioRecorder.isRecording) {
        Alert.alert('Recording Error', 'No active recording found. Please try again.');
        return;
      }
      setIsTranscribing(true);
      let uri: string | null = null;

      try {
        await audioRecorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        uri = audioRecorder.uri;
        if (!uri) {
          throw new Error('Recording produced no audio file');
        }
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        if (!base64 || base64.length < 100) {
          throw new Error('Recording was too short or empty');
        }
        setIsTranscribing(false);
        transcribeAndSend(base64);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Failed to process recording:', msg);
        setIsTranscribing(false);
        // Release audio focus even on error so other apps can use the mic
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
        Alert.alert('Recording Error', `Could not process your recording: ${msg}. Please try again.`);
      } finally {
        if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    }
  }, [audioRecorder, clearSilencePoll, transcribeAndSend]);

  stopRecordingRef.current = stopRecordingAndSend;
  useEffect(() => { talkModeRef.current = talkModeEnabled; }, [talkModeEnabled]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { isTranscribingRef.current = isTranscribing; }, [isTranscribing]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!talkModeEnabled) {
      outsideAppVoiceStateRef.current = null;
      nativeVoiceStateSyncHeldRef.current = false;
      nativeVoiceStateSyncReadyRef.current = true;
      setNativeVoiceStateSyncReady(true);
      return;
    }
    let cancelled = false;
    nativeVoiceStateSyncReadyRef.current = false;
    setNativeVoiceStateSyncReady(false);

    getAndroidDaemonStatus()
      .then((status) => {
        if (cancelled || !talkModeRef.current) return;
        const nativeState = status.voiceSessionState;
        if (!nativeState) return;
        outsideAppVoiceStateRef.current = nativeState;
        nativeVoiceStateSyncHeldRef.current = nativeState === 'paused';
      })
      .catch((err) => {
        console.warn('[voice] outside-app state init failed:', err);
      })
      .finally(() => {
        if (cancelled) return;
        nativeVoiceStateSyncReadyRef.current = true;
        setNativeVoiceStateSyncReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [talkModeEnabled]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!talkModeEnabled) {
      outsideAppVoiceStateRef.current = null;
      nativeVoiceStateSyncHeldRef.current = false;
      setVoiceApprovalPrompt(null);
      setVoiceApprovalToken(null);
      return;
    }
    if (!nativeVoiceStateSyncReady || !nativeVoiceStateSyncReadyRef.current) return;
    if (nativeVoiceStateSyncHeldRef.current) return;
    const nextState = voiceApprovalPrompt
      ? 'approval'
      : isSpeaking
      ? 'speaking'
      : voiceConfirmationExecuting || isTranscribing || isStreaming || isWorkingOnPhone
        ? 'working'
        : isRecording
          ? 'listening'
          : 'listening';
    const nextStateKey = nextState === 'approval'
      ? `${nextState}:${voiceApprovalPrompt ?? ''}:${voiceApprovalToken ?? ''}`
      : nextState;
    if (outsideAppVoiceStateRef.current === nextStateKey) return;
    outsideAppVoiceStateRef.current = nextStateKey;
    const syncVoiceState = nextState === 'approval' && voiceApprovalPrompt
      ? setAndroidOutsideAppVoiceApproval(voiceApprovalPrompt, voiceApprovalToken ?? '')
      : setAndroidOutsideAppVoiceSessionState(nextState);
    syncVoiceState.catch((err) => {
      console.warn('[voice] outside-app state sync failed:', err);
    });
  }, [isRecording, isSpeaking, isStreaming, isTranscribing, isWorkingOnPhone, nativeVoiceStateSyncReady, talkModeEnabled, voiceApprovalPrompt, voiceApprovalToken, voiceConfirmationExecuting]);

  // App-level wake word events — fired by WakeWordContext even when insights is not focused
  const { pendingWakeEvent, clearWakeEvent, setTalkModeActive } = useWakeWord();

  // Keep the WakeWordProvider informed of the current Talk Mode state so it can
  // route wake events to the right UX path (insights recording vs voice-realtime).
  useEffect(() => {
    setTalkModeActive(talkModeEnabled);
  }, [talkModeEnabled, setTalkModeActive]);

  useEffect(() => {
    if (!pendingWakeEvent) return;
    clearWakeEvent();
    // When the daemon is handling the voice turn end-to-end (Talk Mode active),
    // do NOT start the app-side mic session — only the daemon captures and processes
    // the utterance to prevent dual-capture pipeline conflicts.
    if (pendingWakeEvent.daemonHandling) return;
    startRecordingRef.current();
  }, [pendingWakeEvent, clearWakeEvent]);

  const markAssistantSpeechStopped = useCallback((assistantId?: string | null) => {
    if (!assistantId) return;
    setMessages(prev => {
      const idx = prev.findIndex(message => message.id === assistantId && message.role === 'assistant');
      if (idx === -1 || prev[idx].stopped) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], stopped: true };
      persistChatHistory(updated);
      return updated;
    });
  }, []);

  const stopSpeaking = useCallback(() => {
    speakAbortRef.current?.abort();
    speakAbortRef.current = null;
    isSpeakingRef.current = false;
    speakingTextRef.current = null;
    speakingAssistantIdRef.current = null;
    if (Platform.OS === 'web') {
      webAudioRef.current?.pause();
      webAudioRef.current = null;
      webAudioCtxRef.current?.close().catch(() => {});
      webAudioCtxRef.current = null;
    } else if (Platform.OS === 'android') {
      Speech.stop().catch(() => {});
      soundRef.current?.pause();
      soundRef.current?.remove();
      soundRef.current = null;
    } else {
      soundRef.current?.pause();
      soundRef.current?.remove();
      soundRef.current = null;
    }
    setIsSpeaking(false);
    setIsTTSLoading(false);
  }, []);

  const scheduleTalkModeRecordingStart = useCallback((delayMs = 0) => {
    const startSeq = talkModeStartSeqRef.current;
    setTimeout(() => {
      if (
        !talkModeRef.current ||
        talkModeStartSeqRef.current !== startSeq ||
        outsideAppVoiceStateRef.current === 'paused' ||
        isStreamingRef.current ||
        isSpeakingRef.current ||
        isRecordingRef.current ||
        isTranscribingRef.current ||
        voiceConfirmationExecutingRef.current
      ) {
        return;
      }
      startRecordingRef.current();
    }, delayMs);
  }, []);

  const abortActiveChatTurn = useCallback(async () => {
    const runId = chatRunIdRef.current;
    if (runId) {
      try {
        await apiRequest('POST', '/api/chat/abort', { runId });
      } catch {}
    }
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    chatRunIdRef.current = null;
    streamingAssistantIdRef.current = null;
    isStreamingRef.current = false;
    isTranscribingRef.current = false;
    setIsStreaming(false);
    setShowTyping(false);
    setIsSearchingWeb(false);
    setIsWorkingOnPhone(false);
    setIsTranscribing(false);
  }, []);

  const interruptSpeakingAndListen = useCallback(() => {
    const shouldResumeTalkMode = talkModeRef.current;
    if (shouldResumeTalkMode) {
      markAssistantSpeechStopped(speakingAssistantIdRef.current);
    }
    stopSpeaking();
    if (shouldResumeTalkMode) {
      scheduleTalkModeRecordingStart();
    }
  }, [markAssistantSpeechStopped, scheduleTalkModeRecordingStart, stopSpeaking]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = addAndroidOutsideAppVoiceControlListener((event) => {
      const action = String(event?.action ?? '').toLowerCase();
      if (action === 'interrupt') {
        nativeVoiceStateSyncHeldRef.current = false;
        if (isSpeakingRef.current) {
          interruptSpeakingAndListen();
        }
        return;
      }
      if (action === 'pause' || action === 'paused') {
        nativeVoiceStateSyncHeldRef.current = true;
        talkModeStartSeqRef.current += 1;
        outsideAppVoiceStateRef.current = 'paused';
        stopSpeaking();
        abortActiveChatTurn().catch(() => {});
        stopRecordingSilentlyRef.current().catch(() => {});
        return;
      }
      if (action === 'end' || action === 'crash' || action === 'unexpected_end') {
        nativeVoiceStateSyncHeldRef.current = false;
        outsideAppVoiceStateRef.current = null;
        talkModeRef.current = false;
        setTalkModeEnabled(false);
        setTalkModeActive(false);
        stopSpeaking();
        abortActiveChatTurn().catch(() => {});
        stopRecordingSilentlyRef.current().catch(() => {});
        apiRequest('PUT', '/api/voice/wake-settings', { talkModeEnabled: false }).catch(() => {});
        return;
      }
      if (action === 'approval_approve' || action === 'approval_deny') {
        const confirmationToken = typeof event.confirmationToken === 'string' ? event.confirmationToken : '';
        const pendingVoiceConfirmMessage = confirmationToken
          ? messagesRef.current.find((message) => message.role === 'assistant' && message.pendingConfirm?.token === confirmationToken)
          : messagesRef.current.find((message) => message.role === 'assistant' && !!message.pendingConfirm);
        if (!pendingVoiceConfirmMessage?.pendingConfirm) return;
        const approved = action === 'approval_approve';
        const now = new Date().toISOString();
        nativeVoiceStateSyncHeldRef.current = false;
        setVoiceApprovalPrompt(null);
        setVoiceApprovalToken(null);
        apiRequest('POST', '/api/coach/ack-voice-approval', {
          token: pendingVoiceConfirmMessage.pendingConfirm.token,
        }).catch((err) => {
          console.warn('[voice] outside-app approval ack failed:', err);
        });
        confirmActionRef.current(pendingVoiceConfirmMessage.id, approved, {
          source: 'voice',
          voiceTrace: {
            finalTranscript: approved ? 'Overlay approve' : 'Overlay deny',
            finishedAt: now,
            stateTransitions: [
              { state: action, at: now, detail: 'Outside-app overlay approval action' },
            ],
          },
        }).catch((err) => {
          console.warn('[voice] outside-app approval action failed:', err);
        });
        return;
      }
      if (action === 'listening') {
        nativeVoiceStateSyncHeldRef.current = false;
        outsideAppVoiceStateRef.current = 'listening';
        return;
      }
      if (action === 'resume') {
        nativeVoiceStateSyncHeldRef.current = false;
        outsideAppVoiceStateRef.current = 'listening';
        if (
          talkModeRef.current &&
          !isSpeakingRef.current &&
          !isRecordingRef.current &&
          !isStreamingRef.current &&
          !isTranscribingRef.current
        ) {
          scheduleTalkModeRecordingStart();
        }
      }
    });
    return () => subscription.remove();
  }, [abortActiveChatTurn, interruptSpeakingAndListen, scheduleTalkModeRecordingStart, setTalkModeActive, stopSpeaking]);

  const speakText = useCallback(async (text: string, assistantId?: string) => {
    if (isSpeaking && speakingTextRef.current === text) {
      if (talkModeRef.current) {
        interruptSpeakingAndListen();
      } else {
        stopSpeaking();
      }
      return;
    }
    stopSpeaking();
    isSpeakingRef.current = true;
    speakingTextRef.current = text;
    speakingAssistantIdRef.current = assistantId ?? null;
    setIsSpeaking(true);
    setIsTTSLoading(true);

    const abortController = new AbortController();
    speakAbortRef.current = abortController;

    const onPlaybackEnd = () => {
      isSpeakingRef.current = false;
      speakingTextRef.current = null;
      speakingAssistantIdRef.current = null;
      setIsSpeaking(false);
      setIsTTSLoading(false);
      apiRequest('POST', '/api/voice/tts-done').catch(() => {});
      if (talkModeRef.current && outsideAppVoiceStateRef.current !== 'paused'…20470 tokens truncated…ave expired.';
        const execAction: ExecutedAction = {
          tool,
          result: 'error',
          label: data.label || 'Failed',
          detail: data.detail || data.error,
        };
        setMessages(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(m => m.id === msgId);
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              pendingConfirm: undefined,
              content: failureContent,
              executedActions: [execAction],
              diagnostics: buildConfirmedActionDiagnostics({
                responseText: failureContent,
                executedActions: [execAction],
                modelErrors: [{ message: failureContent }],
                apiResult: data,
              }),
            };
          }
          persistChatHistory(updated);
          return updated;
        });
        speakConfirmationResult(failureContent);
        return;
      }
      const execAction: ExecutedAction = {
        tool,
        result: data.result || 'error',
        label: data.label || (data.result === 'success' ? 'Done' : 'Failed'),
        detail: data.detail || data.error,
      };
      const successContent = data.result === 'success'
        ? (tool === 'send_email'
          ? `Email sent successfully.`
          : tool === 'connected_accounts_execute'
            ? `Connected account action completed successfully.`
            : tool === 'delegate_to_codex'
              ? (data.detail || data.label || 'Codex delegation completed successfully.')
              : `Command executed successfully.`)
        : `Action failed: ${data.detail || data.error || 'Unknown error'}`;
      const spokenSuccessContent = data.result === 'success' && tool === 'delegate_to_codex'
        ? (data.label || 'Codex delegation completed successfully.')
        : successContent;
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.id === msgId);
        if (idx !== -1) {
          updated[idx] = {
            ...updated[idx],
            pendingConfirm: undefined,
            content: successContent,
            executedActions: [execAction],
            diagnostics: buildConfirmedActionDiagnostics({
              responseText: successContent,
              executedActions: [execAction],
              modelErrors: execAction.result === 'error' ? [{ message: successContent }] : [],
              apiResult: data,
            }),
          };
        }
        persistChatHistory(updated);
        return updated;
      });
      speakConfirmationResult(spokenSuccessContent);
    } catch (error) {
      const failureContent = 'Something went wrong while executing that action.';
      const execAction: ExecutedAction = {
        tool,
        result: 'error',
        label: 'Failed',
        detail: error instanceof Error ? error.message : String(error),
      };
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.id === msgId);
        if (idx !== -1) {
          updated[idx] = {
            ...updated[idx],
            pendingConfirm: undefined,
            content: failureContent,
            executedActions: [execAction],
            diagnostics: buildConfirmedActionDiagnostics({
              responseText: failureContent,
              executedActions: [execAction],
              modelErrors: [error instanceof Error ? { message: error.message, name: error.name } : String(error)],
            }),
          };
        }
        persistChatHistory(updated);
        return updated;
      });
      speakConfirmationResult(failureContent);
    } finally {
      setVoiceConfirmationExecutionState(false);
    }
  }, [setVoiceConfirmationExecutionState]);

  useEffect(() => {
    confirmActionRef.current = handleConfirmAction;
  }, [handleConfirmAction]);

  // After Jarvis sends a connect_channel link, poll /api/channels until the
  // channel flips to connected, then inject a confirmation message in the chat.
  const startChannelConnectPoll = useCallback((channelName: string, assistantMsgId: string) => {
    if (channelConnectPollRef.current) clearInterval(channelConnectPollRef.current);
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes at 5s intervals
    const channelLabels: Record<string, string> = {
      telegram: 'Telegram',
      whatsapp: 'WhatsApp',
      slack: 'Slack',
      discord: 'Discord',
    };
    const displayName = channelLabels[channelName] ?? channelName;
    channelConnectPollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(channelConnectPollRef.current!);
        channelConnectPollRef.current = null;
        return;
      }
      try {
        const res = await authFetch(new URL('/api/channels', getApiUrl()).toString());
        if (!res.ok) return;
        const data = await res.json();
        if (data.connected?.[channelName]) {
          clearInterval(channelConnectPollRef.current!);
          channelConnectPollRef.current = null;
          // Inject a confirmation follow-up message right after the Jarvis message
          // that contained the connect link.
          const confirmId = `connect-confirm-${channelName}-${Date.now()}`;
          const confirmMsg: ChatMessage = {
            id: confirmId,
            role: 'assistant',
            content: `✅ ${displayName} is now connected! I can send you updates and reminders there going forward.`,
          };
          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === assistantMsgId);
            // Insert confirmMsg BEFORE the connect-link message so it appears
            // after it visually (the FlatList is inverted: index 0 = newest).
            const updated = [...prev];
            if (idx !== -1) {
              updated.splice(idx, 0, confirmMsg);
            } else {
              updated.unshift(confirmMsg);
            }
            persistChatHistory(updated);
            return updated;
          });
        }
      } catch {}
    }, 5000);
  }, []);

  const handleClearChat = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await Promise.all([clearChatHistory(), saveCoachSessionId(null)]);
    sdkSessionIdRef.current = null;
    setMessages([]);
    setConfirmClear(false);
  }, [confirmClear]);

  const lastAssistantId = messages.find(m => m.role === 'assistant')?.id;
  const visibleMessages = messages.filter((m, index) => !isNoisyChatFailure(m, index));
  const hiddenFailureCount = messages.length - visibleMessages.length;
  const totalMessages = visibleMessages.length;
  const showDivider = totalMessages > CONTEXT_WINDOW;

  const listData: (ChatMessage | { type: 'divider'; id: string; label?: string })[] = showDivider
    ? [
        ...visibleMessages.slice(0, CONTEXT_WINDOW),
        { type: 'divider' as const, id: 'divider' },
        ...visibleMessages.slice(CONTEXT_WINDOW),
      ]
    : visibleMessages;

  if (hiddenFailureCount > 0) {
    listData.push({
      type: 'divider' as const,
      id: 'hidden-failures',
      label: `${hiddenFailureCount} older failed ${hiddenFailureCount === 1 ? 'reply' : 'replies'} hidden`,
    });
  }

  const handleDiscordConnect = useCallback(async () => {
    setDiscordPairInput('');
    setDiscordConnectError('');
    setDiscordBotTokenInput('');
    setDiscordTokenError('');
    setDiscordPhase('loading');
    setDiscordConnectVisible(true);
    try {
      const url = new URL('/api/channels', getApiUrl());
      const res = await authFetch(url.toString());
      const data = await res.json();
      const discordMeta = data.meta?.discord as { hasBotToken?: boolean; isPaired?: boolean } | undefined;
      if (data.connected?.discord) {
        setDiscordPhase('done');
      } else if (discordMeta?.hasBotToken) {
        setDiscordPhase('pair');
      } else {
        setDiscordPhase('setup_bot');
      }
    } catch {
      setDiscordPhase('setup_bot');
    }
  }, []);

  const loadDiscordOsData = useCallback(async () => {
    setDiscordOsLoading(true);
    try {
      const base = getApiUrl();
      const [schedRes, approvalRes, agentRes, activityRes] = await Promise.allSettled([
        authFetch(new URL('/api/discord/schedules', base).toString()),
        authFetch(new URL('/api/discord/approvals', base).toString()),
        authFetch(new URL('/api/discord/agents', base).toString()),
        authFetch(new URL('/api/discord/activity', base).toString()),
      ]);
      if (schedRes.status === 'fulfilled') {
        const d = await schedRes.value.json().catch(() => ({}));
        setDiscordOsSchedules(d.schedules || []);
      }
      if (approvalRes.status === 'fulfilled') {
        const d = await approvalRes.value.json().catch(() => ({}));
        setDiscordOsApprovals(d.approvals || []);
      }
      if (agentRes.status === 'fulfilled') {
        const d = await agentRes.value.json().catch(() => ({}));
        setDiscordOsAgents(d.agents || []);
      }
      if (activityRes.status === 'fulfilled') {
        const d = await activityRes.value.json().catch(() => ({}));
        setDiscordOsActivity(d.activity || []);
      }
    } catch { }
    setDiscordOsLoading(false);
  }, []);

  useEffect(() => {
    if (discordPhase !== 'done' || !discordConnectVisible) return;
    (async () => {
      try {
        const url = new URL('/api/channels/discord/guilds', getApiUrl());
        const res = await authFetch(url.toString());
        const data = await res.json();
        setDiscordGuilds(data.guilds || []);
      } catch {}
    })();
  }, [discordPhase, discordConnectVisible]);

  const renderItem = useCallback(({ item, index }: { item: ChatMessage | { type: 'divider'; id: string; label?: string }; index: number }) => {
    if ('type' in item && item.type === 'divider') {
      return (
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{item.label ?? 'Earlier messages not sent to coach'}</Text>
          <View style={styles.dividerLine} />
        </View>
      );
    }
    const msg = item as ChatMessage;
    const prevItem = index > 0 ? listData[index - 1] : null;
    const prevRole = prevItem && !('type' in prevItem) ? (prevItem as ChatMessage).role : null;
    const isFirst = msg.role === 'assistant' && prevRole !== 'assistant';
    return (
      <MessageBubble
        message={msg}
        isFirst={isFirst}
        isLastAssistant={msg.role === 'assistant' && msg.id === lastAssistantId}
        goals={goals}
        onFollowup={sendMessage}
        onSpeak={speakText}
        isSpeaking={isSpeaking}
        isStreaming={isStreaming}
        onConfirmAction={handleConfirmAction}
        onDiscordConnect={handleDiscordConnect}
        onCopyDiagnostics={handleCopyDiagnostics}
      />
    );
  }, [listData, lastAssistantId, goals, sendMessage, speakText, isSpeaking, isStreaming, handleConfirmAction, handleDiscordConnect, handleCopyDiagnostics]);

  const isEmpty = messages.length === 0 && !isStreaming;

  const renderInboxSection = (extraStyle?: any) => (
    <View style={[styles.inboxSection, extraStyle]}>
      <Pressable style={styles.inboxHeader} onPress={() => setInboxCollapsed(prev => !prev)}>
        <View style={styles.inboxHeaderLeft}>
          <Ionicons name="mail-outline" size={16} color={Colors.primary} />
          <Text style={styles.inboxHeaderTitle}>From Your Inbox</Text>
        </View>
        <View style={styles.inboxHeaderRight}>
          <Pressable
            style={styles.scanAgainBtn}
            onPress={(e) => {
              e.stopPropagation();
              scanForTasks(goals);
            }}
            disabled={scanLoading}
          >
            <Ionicons name="refresh-outline" size={14} color={Colors.primary} />
            <Text style={styles.scanAgainText}>Scan again</Text>
          </Pressable>
          <Ionicons
            name={inboxCollapsed ? 'chevron-down' : 'chevron-up'}
            size={16}
            color={Colors.textSecondary}
          />
        </View>
      </Pressable>
      {!inboxCollapsed && (
        scanLoading ? (
          <View style={styles.scanLoadingWrap}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.scanLoadingText}>Scanning emails...</Text>
          </View>
        ) : emailSuggestions.length === 0 ? (
          <View style={styles.scanLoadingWrap}>
            <Text style={styles.scanLoadingText}>No task suggestions found. Tap &quot;Scan again&quot; to retry.</Text>
          </View>
        ) : (
          emailSuggestions.map((suggestion, idx) => (
            <View key={idx} style={styles.suggestionCard}>
              <View style={styles.suggestionContent}>
                <Text style={styles.suggestionTitle}>{suggestion.title}</Text>
                <Text style={styles.suggestionEmail} numberOfLines={1}>
                  {'\\u{1F4E7}'} {suggestion.emailSubject} · {suggestion.accountEmail || suggestion.emailFrom}
                </Text>
                <Text style={styles.suggestionGoal} numberOfLines={1}>
                  {'\\u{1F3AF}'} {suggestion.goalTitle} · {suggestion.reason}
                </Text>
              </View>
              <Pressable
                style={[styles.addSuggestionBtn, addedSuggestions[idx] && styles.addSuggestionBtnAdded]}
                onPress={() => handleAddEmailSuggestion(suggestion, idx)}
                disabled={!!addedSuggestions[idx]}
              >
                <Ionicons
                  name={addedSuggestions[idx] ? 'checkmark' : 'add'}
                  size={16}
                  color={addedSuggestions[idx] ? Colors.success : Colors.primary}
                />
                {addedSuggestions[idx] && (
                  <Text style={styles.addedText}>Added</Text>
                )}
              </Pressable>
            </View>
          ))
        )
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={tabBarHeight}
    >
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View style={styles.headerLeft}>
          <Ionicons name="sparkles-outline" size={20} color={Colors.primary} />
          <Text style={styles.headerTitle}>JARVIS</Text>
        </View>
        <Pressable
          style={styles.clearBtn}
          onPress={handleClearChat}
        >
          {confirmClear ? (
            <Text style={styles.clearConfirmText}>Clear?</Text>
          ) : (
            <Ionicons name="create-outline" size={20} color={Colors.textSecondary} />
          )}
        </Pressable>
      </View>

      {isEmailLoading && (
        <View style={styles.emailLoadingBanner}>
          <ActivityIndicator size="small" color={Colors.textSecondary} />
          <Text style={styles.emailLoadingText}>Loading email & Slack context…</Text>
        </View>
      )}

      <View style={styles.chatArea}>
        {gmailConnected && isEmpty && renderInboxSection({ paddingHorizontal: 16 })}
        {isEmpty ? (
          <Animated.View entering={FadeInDown.duration(400)} style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="sparkles-outline" size={32} color={Colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>JARVIS is ready</Text>
            <Text style={styles.emptySubtitle}>Ask anything about your tasks, devices, memory, and plans.</Text>
            <View style={styles.suggestedGrid}>
              {SUGGESTED_PROMPTS.map((prompt, i) => (
                <Pressable
                  key={i}
                  style={[styles.suggestedPill, isBaseLoading && { opacity: 0.4 }]}
                  onPress={() => sendMessage(prompt)}
                  disabled={isBaseLoading}
                >
                  <Text style={styles.suggestedText}>{prompt}</Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={listData}
            keyExtractor={(item) => ('id' in item ? item.id : 'divider')}
            renderItem={renderItem}
            inverted
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => {
              hasScrolledRef.current = true;
              if (initialScanDoneRef.current && !inboxCollapsed) {
                setInboxCollapsed(true);
              }
            }}
            ListHeaderComponent={isWorkingOnPhone ? <PhoneWorkingIndicator message={phoneWorkingMessage} /> : isSearchingWeb ? <SearchingIndicator /> : showTyping ? <TypingDots /> : null}
            ListFooterComponent={gmailConnected ? renderInboxSection() : null}
          />
        )}
      </View>

      {integrationError ? (
        <IntegrationErrorCard
          integrationKey={integrationError.integration}
          cardStyle={{ marginHorizontal: 12, marginBottom: 8 }}
          onDismiss={() => setIntegrationError(null)}
          onGoToSettings={() => {
            const integration = integrationError.integration;
            setIntegrationError(null);
            router.push({ pathname: '/(tabs)/settings', params: { scrollTo: integration } });
          }}
        />
      ) : null}

      <View style={[styles.inputContainer, { paddingBottom: tabBarHeight + 8 }]}>
        <Pressable
          style={{ position: 'absolute', top: -24, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10, backgroundColor: talkModeEnabled ? 'rgba(34,197,94,0.12)' : 'transparent' }}
          onPress={async () => {
            const next = !talkModeEnabled;
            if (next) {
              // Enabling Talk Mode — request mic permission first
              if (Platform.OS !== 'web') {
                const { granted } = await requestRecordingPermissionsAsync();
                if (!granted) {
                  Alert.alert(
                    'Microphone Required',
                    'Talk Mode needs microphone access to listen for your voice. Please allow microphone access in Settings.',
                    [{ text: 'OK' }]
                  );
                  return;
                }
              }
            }
            setTalkModeEnabled(next);
            talkModeRef.current = next;
            talkModeStartSeqRef.current += 1;
            if (Platform.OS === 'android') {
              const action = next ? startAndroidOutsideAppVoiceSession : endAndroidOutsideAppVoiceSession;
              action().catch((err) => {
                console.warn('[voice] outside-app session toggle failed:', err);
              });
            }
            if (!next) {
              clearSilencePoll();
            }
            if (!next && isRecordingRef.current) {
              // Immediately disarm the active loop
              stopRecordingSilentlyRef.current().catch(() => {});
            }
            if (next && !isRecordingRef.current && !isSpeakingRef.current && !isStreamingRef.current && !isTranscribing) {
              // Starting Talk Mode should begin the in-app voice loop without a second mic tap.
              const startSeq = talkModeStartSeqRef.current;
              setTimeout(() => {
                if (!talkModeRef.current || talkModeStartSeqRef.current !== startSeq || isStreamingRef.current) return;
                startRecordingRef.current();
              }, 0);
            }
            apiRequest('PUT', '/api/voice/wake-settings', { talkModeEnabled: next }).catch(() => {});
          }}
        >
          <Ionicons name="chatbubbles" size={10} color={talkModeEnabled ? Colors.success : Colors.textSecondary} />
          <Text style={{ fontSize: 10, color: talkModeEnabled ? Colors.success : Colors.textSecondary, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 }}>
            Talk Mode
          </Text>
          <Ionicons name={talkModeEnabled ? 'toggle' : 'toggle-outline'} size={14} color={talkModeEnabled ? Colors.success : Colors.textSecondary} />
        </Pressable>
        <Pressable
          style={[styles.micBtn, isRecording && styles.micBtnRecording, isBaseLoading && { opacity: 0.4 }]}
          onPress={isSpeaking ? interruptSpeakingAndListen : isRecording ? stopRecordingAndSend : startRecording}
          disabled={isTranscribing || isBaseLoading}
        >
          {isTranscribing ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : isTTSLoading ? (
            <View style={styles.micLoadingWrap}>
              <Ionicons name="stop" size={16} color={Colors.primary} />
              <ActivityIndicator size="small" color={Colors.primary} style={styles.micLoadingSpinner} />
            </View>
          ) : isSpeaking ? (
            <Ionicons name="stop" size={20} color={Colors.primary} />
          ) : isRecording ? (
            <Animated.View style={micPulseStyle}>
              <Ionicons name="radio-button-on" size={20} color="#EF4444" />
            </Animated.View>
          ) : (
            <Ionicons name="mic" size={20} color={Colors.textSecondary} />
          )}
        </Pressable>
        <TextInput
          style={[styles.input, isBaseLoading && { opacity: 0.5 }]}
          value={input}
          onChangeText={setInput}
          placeholder={isBaseLoading ? "Loading your context\u2026" : isRecording ? "Listening..." : isTranscribing ? "Transcribing..." : "Message JARVIS..."}
          placeholderTextColor={isRecording ? '#EF4444' : Colors.textSecondary}
          multiline
          maxLength={1000}
          editable={!isRecording && !isTranscribing && !isBaseLoading}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={() => {
            if (Platform.OS !== 'web') sendMessage(input);
          }}
          onKeyPress={(event) => {
            const nativeEvent = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean };
            if (Platform.OS === 'web' && nativeEvent.key === 'Enter' && !nativeEvent.shiftKey && input.trim()) {
              (event as unknown as { preventDefault?: () => void }).preventDefault?.();
              sendMessage(input);
            }
          }}
        />
        {isStreaming ? (
          <Pressable style={styles.stopBtn} onPress={handleStop}>
            <Ionicons name="stop" size={16} color="#fff" />
          </Pressable>
        ) : isSpeaking ? (
          <View style={styles.speakingRow}>
            <View style={styles.waveform}>
              <Animated.View style={[styles.waveBar, waveBarStyle1]} />
              <Animated.View style={[styles.waveBar, styles.waveBarTall, waveBarStyle2]} />
              <Animated.View style={[styles.waveBar, waveBarStyle3]} />
              <Animated.View style={[styles.waveBar, styles.waveBarTall, waveBarStyle4]} />
            </View>
            <Pressable style={styles.stopBtn} onPress={interruptSpeakingAndListen}>
              <Ionicons name="stop" size={16} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={[styles.sendBtn, (!input.trim() || isBaseLoading) && styles.sendBtnDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || isBaseLoading}
          >
            <Ionicons name="arrow-up" size={18} color="#fff" />
          </Pressable>
        )}
      </View>
      {/* MCP Prompt Browser Sheet */}
      <Modal
        visible={showMcpSheet}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowMcpSheet(false)}
      >
        <View style={styles.mcpModal}>
          <View style={styles.mcpModalHeader}>
            <Pressable onPress={() => setShowMcpSheet(false)} style={styles.mcpModalClose}>
              <Ionicons name="close" size={22} color={Colors.text} />
            </Pressable>
            <Text style={styles.mcpModalTitle}>MCP Prompt Templates</Text>
            <View style={{ width: 44 }} />
          </View>
          {mcpPromptsLoading ? (
            <View style={styles.mcpModalLoading}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.mcpModalLoadingText}>Loading templates…</Text>
            </View>
          ) : mcpPrompts.length === 0 ? (
            <View style={styles.mcpModalEmpty}>
              <Ionicons name="server-outline" size={40} color={Colors.textSecondary} />
              <Text style={styles.mcpModalEmptyTitle}>No prompt templates</Text>
              <Text style={styles.mcpModalEmptyText}>Connect MCP servers in Settings to access their prompt templates here.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.mcpModalList} keyboardShouldPersistTaps="handled">
              {mcpPrompts.map((prompt, idx) => (
                <Pressable
                  key={`${prompt.serverId}-${prompt.name}-${idx}`}
                  style={({ pressed }) => [styles.mcpPromptCard, pressed && { opacity: 0.8 }]}
                  onPress={() => selectMcpPrompt({ serverId: prompt.serverId, name: prompt.name, arguments: prompt.arguments })}
                >
                  <View style={styles.mcpPromptCardTop}>
                    <View style={styles.mcpPromptServerBadge}>
                      <Ionicons name="server-outline" size={10} color={Colors.primary} />
                      <Text style={styles.mcpPromptServerName}>{prompt.serverName}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={Colors.textSecondary} />
                  </View>
                  <Text style={styles.mcpPromptName}>{prompt.name}</Text>
                  {!!prompt.description && (
                    <Text style={styles.mcpPromptDesc} numberOfLines={2}>{prompt.description}</Text>
                  )}
                  {prompt.arguments && prompt.arguments.length > 0 && (
                    <View style={styles.mcpPromptArgsRow}>
                      {prompt.arguments.slice(0, 3).map((arg, ai) => (
                        <View key={ai} style={styles.mcpPromptArgChip}>
                          <Text style={styles.mcpPromptArgText}>{arg.name}{arg.required ? '*' : ''}</Text>
                        </View>
                      ))}
                      {prompt.arguments.length > 3 && (
                        <Text style={styles.mcpPromptArgMore}>+{prompt.arguments.length - 3} more</Text>
                      )}
                    </View>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>

      <Modal
        visible={discordConnectVisible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setDiscordConnectVisible(false)}
      >
        <View style={styles.discordModal}>
          <View style={styles.discordModalHeader}>
            <Pressable onPress={() => setDiscordConnectVisible(false)} style={styles.discordModalBack}>
              <Ionicons name="chevron-back" size={20} color={Colors.text} />
              <Text style={styles.discordModalBackText}>Back</Text>
            </Pressable>
            <Text style={styles.discordModalTitle}>Connect Discord</Text>
            <View style={{ minWidth: 64 }} />
          </View>

          <ScrollView contentContainerStyle={styles.discordModalBody} keyboardShouldPersistTaps="handled">
            <View style={styles.discordIconRow}>
              <Ionicons name="logo-discord" size={40} color="#5865F2" />
            </View>

            {discordPhase === 'loading' && (
              <View style={styles.discordSuccessBox}>
                <ActivityIndicator size="large" color="#5865F2" />
              </View>
            )}

            {discordPhase === 'done' && (
              <View style={{ gap: 16 }}>
                <View style={styles.discordSuccessBox}>
                  <Ionicons name="checkmark-circle" size={28} color={Colors.success} />
                  <Text style={styles.discordSuccessText}>Discord is linked. @mention Jarvis in any server channel to chat.</Text>
                </View>

                <Pressable
                  style={[styles.discordGuildRow, { backgroundColor: '#5865F215', borderColor: '#5865F2', borderWidth: 1 }]}
                  onPress={() => {
                    setDiscordPhase('discord_os');
                    loadDiscordOsData();
                  }}
                >
                  <Ionicons name="grid-outline" size={18} color="#5865F2" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.discordGuildName, { color: '#5865F2', fontWeight: '600' }]}>Discord OS Dashboard</Text>
                    <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>Manage schedules, approvals, and agents</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#5865F2" />
                </Pressable>

                <View style={styles.discordSectionBox}>
                  <Text style={styles.discordSectionTitle}>🧠 Jarvis Workspace</Text>
                  <Text style={styles.discordSectionSub}>
                    Let Jarvis create its own organised channels in your server — one for tasks, finance, ideas, business, personal, and thinking. Once set up, Jarvis will route conversations and updates into the right channel automatically.
                  </Text>

                  {discordWorkspaceDone ? (
                    <View style={[styles.discordSuccessBox, { marginTop: 8 }]}>
                      <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
                      <Text style={styles.discordSuccessText}>Workspace channels created! Check your server.</Text>
                    </View>
                  ) : (
                    <>
                      {discordGuilds.length === 0 ? (
                        <Text style={styles.discordSectionSub}>No servers detected yet — make sure the bot has been invited to your server.</Text>
                      ) : discordGuilds.map((guild) => (
                        <Pressable
                          key={guild.id}
                          style={[styles.discordGuildRow, discordWorkspaceLoading && { opacity: 0.5 }]}
                          disabled={discordWorkspaceLoading}
                          onPress={async () => {
                            setDiscordWorkspaceLoading(true);
                            setDiscordWorkspaceError('');
                            try {
                              const url = new URL('/api/channels/discord/workspace/setup', getApiUrl());
                              const res = await authFetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guildId: guild.id }) });
                              const data = await res.json();
                              if (data.ok) {
                                setDiscordWorkspaceDone(true);
                              } else {
                                setDiscordWorkspaceError(data.error || 'Setup failed — make sure the bot has Manage Channels permission.');
                              }
                            } catch {
                              setDiscordWorkspaceError('Network error — please try again.');
                            } finally {
                              setDiscordWorkspaceLoading(false);
                            }
                          }}
                        >
                          {discordWorkspaceLoading ? (
                            <ActivityIndicator size="small" color="#5865F2" />
                          ) : (
                            <Ionicons name="add-circle-outline" size={18} color="#5865F2" />
                          )}
                          <Text style={styles.discordGuildName}>
                            {discordWorkspaceLoading ? 'Creating channels…' : `Set up in ${guild.name}`}
                          </Text>
                        </Pressable>
                      ))}
                      {!!discordWorkspaceError && (
                        <Text style={styles.discordErrorText}>{discordWorkspaceError}</Text>
                      )}
                    </>
                  )}
                </View>
              </View>
            )}

            {discordPhase === 'discord_os' && (
              <View style={{ gap: 16 }}>
                <Pressable
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
                  onPress={() => setDiscordPhase('done')}
                >
                  <Ionicons name="chevron-back" size={18} color="#5865F2" />
                  <Text style={{ color: '#5865F2', fontSize: 14, fontWeight: '600' }}>Back to Discord Setup</Text>
                </Pressable>

                <Text style={[styles.discordModalTitle, { fontSize: 18 }]}>Discord OS Dashboard</Text>

                {discordOsLoading ? (
                  <ActivityIndicator size="large" color="#5865F2" />
                ) : (
                  <>
                    {/* Active Schedules */}
                    <View style={styles.discordSectionBox}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={styles.discordSectionTitle}>📅 Active Schedules</Text>
                        <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>{discordOsSchedules.length}</Text>
                      </View>
                      {discordOsSchedules.length === 0 ? (
                        <Text style={styles.discordSectionSub}>No schedules yet. Ask Jarvis to set up automated reports.</Text>
                      ) : discordOsSchedules.map((s: any) => (
                        <View key={s.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ color: Colors.text, fontWeight: '600', fontSize: 13, flex: 1 }}>{s.label}</Text>
                            <Pressable
                              style={{ backgroundColor: s.enabled ? '#5865F220' : '#FF000020', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}
                              disabled={!!discordOsToggling[s.id]}
                              onPress={async () => {
                                setDiscordOsToggling(t => ({ ...t, [s.id]: true }));
                                try {
                                  await authFetch(new URL(`/api/discord/schedules/${s.id}/toggle`, getApiUrl()).toString(), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ enabled: !s.enabled }),
                                  });
                                  setDiscordOsSchedules(prev => prev.map(x => x.id === s.id ? { ...x, enabled: !x.enabled } : x));
                                } catch { }
                                setDiscordOsToggling(t => ({ ...t, [s.id]: false }));
                              }}
                            >
                              <Text style={{ color: s.enabled ? '#5865F2' : '#FF5555', fontSize: 11 }}>{s.enabled ? 'Active' : 'Paused'}</Text>
                            </Pressable>
                          </View>
                          <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                            #{s.channelName} • {s.cronExpression}
                          </Text>
                          {s.nextRun && (
                            <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>
                              Next: {new Date(s.nextRun).toLocaleString()}
                            </Text>
                          )}
                          {s.lastOutput && (
                            <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }} numberOfLines={2}>
                              Last: {s.lastOutput.slice(0, 80)}…
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>

                    {/* Pending Approvals */}
                    <View style={styles.discordSectionBox}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={styles.discordSectionTitle}>⏳ Pending Approvals</Text>
                        <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>{discordOsApprovals.length}</Text>
                      </View>
                      {discordOsApprovals.length === 0 ? (
                        <Text style={styles.discordSectionSub}>Nothing pending right now.</Text>
                      ) : discordOsApprovals.map((a: any) => (
                        <View key={a.messageId} style={{ marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                          <Text style={{ color: Colors.text, fontWeight: '600', fontSize: 13 }}>{a.type}</Text>
                          <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={3}>{a.content}</Text>
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                            <Pressable
                              style={{ backgroundColor: '#43B58120', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, flex: 1, alignItems: 'center' }}
                              disabled={!!discordOsToggling[a.messageId]}
                              onPress={async () => {
                                setDiscordOsToggling(t => ({ ...t, [a.messageId]: true }));
                                try {
                                  await authFetch(new URL(`/api/discord/approvals/${a.messageId}/resolve`, getApiUrl()).toString(), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'approve' }),
                                  });
                                  setDiscordOsApprovals(prev => prev.filter(x => x.messageId !== a.messageId));
                                } catch { }
                                setDiscordOsToggling(t => ({ ...t, [a.messageId]: false }));
                              }}
                            >
                              <Text style={{ color: '#43B581', fontWeight: '600', fontSize: 13 }}>✅ Approve</Text>
                            </Pressable>
                            <Pressable
                              style={{ backgroundColor: '#F04747'  + '20', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, flex: 1, alignItems: 'center' }}
                              disabled={!!discordOsToggling[a.messageId]}
                              onPress={async () => {
                                setDiscordOsToggling(t => ({ ...t, [a.messageId]: true }));
                                try {
                                  await authFetch(new URL(`/api/discord/approvals/${a.messageId}/resolve`, getApiUrl()).toString(), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'reject' }),
                                  });
                                  setDiscordOsApprovals(prev => prev.filter(x => x.messageId !== a.messageId));
                                } catch { }
                                setDiscordOsToggling(t => ({ ...t, [a.messageId]: false }));
                              }}
                            >
                              <Text style={{ color: '#F04747', fontWeight: '600', fontSize: 13 }}>❌ Skip</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>

                    {/* Named Agents */}
                    <View style={styles.discordSectionBox}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={styles.discordSectionTitle}>🤖 Agents</Text>
                        <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>{discordOsAgents.length}</Text>
                      </View>
                      {discordOsAgents.length === 0 ? (
                        <Text style={styles.discordSectionSub}>No named agents yet. Ask Jarvis to set up Charlie, Echo, Quill, or Pixel.</Text>
                      ) : discordOsAgents.map((ag: any) => (
                        <View key={ag.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: Colors.text, fontWeight: '600', fontSize: 13 }}>{ag.name} <Text style={{ color: Colors.textSecondary, fontWeight: '400' }}>({ag.role})</Text></Text>
                            <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>
                              #{ag.channelName ?? 'no channel'} • {ag.loopEnabled ? `loop every ${ag.loopIntervalMinutes}min` : 'on-demand'}
                            </Text>
                          </View>
                          <Pressable
                            style={{ backgroundColor: ag.loopEnabled ? '#5865F220' : Colors.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}
                            disabled={!!discordOsToggling[ag.id]}
                            onPress={async () => {
                              setDiscordOsToggling(t => ({ ...t, [ag.id]: true }));
                              try {
                                await authFetch(new URL(`/api/discord/agents/${ag.id}/toggle`, getApiUrl()).toString(), {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ loopEnabled: !ag.loopEnabled }),
                                });
                                setDiscordOsAgents(prev => prev.map(x => x.id === ag.id ? { ...x, loopEnabled: !x.loopEnabled } : x));
                              } catch { }
                              setDiscordOsToggling(t => ({ ...t, [ag.id]: false }));
                            }}
                          >
                            <Text style={{ color: ag.loopEnabled ? '#5865F2' : Colors.textSecondary, fontSize: 11 }}>
                              {ag.loopEnabled ? 'Loop ON' : 'Loop OFF'}
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>

                    {/* Recent Activity */}
                    <View style={styles.discordSectionBox}>
                      <Text style={[styles.discordSectionTitle, { marginBottom: 8 }]}>📡 Recent Activity</Text>
                      {discordOsActivity.length === 0 ? (
                        <Text style={styles.discordSectionSub}>No recent Discord activity.</Text>
                      ) : discordOsActivity.slice(0, 10).map((item: any) => (
                        <View key={item.id} style={{ marginBottom: 8 }}>
                          <Text style={{ color: Colors.textSecondary, fontSize: 10 }}>
                            {new Date(item.createdAt).toLocaleString()} • {item.direction}
                          </Text>
                          <Text style={{ color: Colors.text, fontSize: 12 }} numberOfLines={2}>{item.content}</Text>
                        </View>
                      ))}
                    </View>

                    <Pressable
                      style={styles.discordGuildRow}
                      onPress={loadDiscordOsData}
                    >
                      <Ionicons name="refresh-outline" size={16} color={Colors.textSecondary} />
                      <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>Refresh</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}

            {discordPhase === 'setup_bot' && (
              <>
                <View style={styles.discordPhasePill}>
                  <Text style={styles.discordPhasePillText}>Step 1 of 2 — Create a Discord Bot</Text>
                </View>
                <Text style={styles.discordInstructTitle}>Set up your Jarvis bot</Text>
                <Text style={styles.discordInstructSub}>
                  Jarvis runs as your own private Discord bot. You&apos;ll create it once in about 2 minutes — no coding needed.
                </Text>

                <View style={styles.discordStep}>
                  <Text style={styles.discordStepNum}>1</Text>
                  <Text style={styles.discordStepText}>
                    Go to{' '}
                    <Text style={styles.discordLink} onPress={() => Linking.openURL('https://discord.com/developers/applications')}>
                      discord.com/developers/applications
                    </Text>
                    {' '}and tap <Text style={styles.discordBold}>New Application</Text>. Name it &quot;Jarvis&quot; (or whatever you like).
                  </Text>
                </View>
                <View style={styles.discordStep}>
                  <Text style={styles.discordStepNum}>2</Text>
                  <Text style={styles.discordStepText}>
                    Open the <Text style={styles.discordBold}>Bot</Text> tab on the left. Scroll down to <Text style={styles.discordBold}>Privileged Gateway Intents</Text> and enable both <Text style={styles.discordBold}>Server Members Intent</Text> and <Text style={styles.discordBold}>Message Content Intent</Text>.
                  </Text>
                </View>
                <View style={styles.discordStep}>
                  <Text style={styles.discordStepNum}>3</Text>
                  <Text style={styles.discordStepText}>
                    Still on the Bot tab, tap <Text style={styles.discordBold}>Reset Token</Text> → confirm → copy the token shown.
                  </Text>
                </View>
                <View style={styles.discordStep}>
                  <Text style={styles.discordStepNum}>4</Text>
                  <Text style={styles.discordStepText}>
                    To add the bot to your server, go to <Text style={styles.discordBold}>OAuth2 → URL Generator</Text>, check <Text style={styles.discordBold}>bot</Text>, then check these permissions: <Text style={styles.discordBold}>View Channels</Text>, <Text style={styles.discordBold}>Send Messages</Text>, <Text style={styles.discordBold}>Read Message History</Text>, and <Text style={styles.discordBold}>Manage Channels</Text> (needed for Jarvis to create its own workspace channels). Open the generated URL and invite the bot to your server.
                  </Text>
                </View>
                <View style={styles.discordStep}>
                  <Text style={styles.discordStepNum}>5</Text>
                  <Text style={styles.discordStepText}>Paste the bot token below.</Text>
                </View>

                <TextInput
                  style={styles.discordTokenInput}
                  placeholder="Paste bot token here"
                  placeholderTextColor={Colors.textSecondary}
                  value={discordBotTokenInput}
                  onChangeText={t => { setDiscordBotTokenInput(t); setDiscordTokenError(''); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />

                {discordTokenError ? (
                  <Text style={styles.discordErrorText}>{discordTokenError}</Text>
                ) : null}

                <Pressable
                  style={[styles.discordConnectBtn, (!discordBotTokenInput.trim() || discordTokenSaving) && { opacity: 0.5 }]}
                  disabled={!discordBotTokenInput.trim() || discordTokenSaving}
                  onPress={async () => {
                    setDiscordTokenSaving(true);
                    setDiscordTokenError('');
                    try {
                      const url = new URL('/api/channels/discord/token', getApiUrl());
                      const res = await authFetch(url.toString(), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ botToken: discordBotTokenInput.trim() }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setDiscordBotTokenInput('');
                        setDiscordPhase('pair');
                      } else {
                        setDiscordTokenError(data.error || 'Invalid token — make sure you copied it fully and enabled Message Content + Server Members intents.');
                      }
                    } catch {
                      setDiscordTokenError('Connection error. Please try again.');
                    } finally {
                      setDiscordTokenSaving(false);
                    }
                  }}
                >
                  {discordTokenSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.discordConnectBtnText}>Save & Start Bot</Text>
                  )}
                </Pressable>
              </>
            )}

            {discordPhase === 'pair' && (
              <>
                <View style={styles.discordPhasePill}>
                  <Text style={styles.discordPhasePillText}>Step 2 of 2 — Link Your Account</Text>
                </View>
                <Text style={styles.discordInstructTitle}>Pair your Discord account</Text>
                <Text style={styles.discordInstructSub}>Your bot is running. Now link your personal Discord account so Jarvis knows it&apos;s you.</Text>

                <View style={styles.discordStep}>
                  <Text style={styles.discordStepNum}>1</Text>
                  <Text style={styles.discordStepText}>Open Discord and send any message to your Jarvis bot — DM it directly or @mention it in your server.</Text>
                </View>
                <View style={styles.discordStep}>
                  <Text style={styles.discordStepNum}>2</Text>
                  <Text style={styles.discordStepText}>The bot will reply with a 6-character pairing code.</Text>
                </View>
                <View style={styles.discordStep}>
                  <Text style={styles.discordStepNum}>3</Text>
                  <Text style={styles.discordStepText}>Enter that code below.</Text>
                </View>

                <TextInput
                  style={styles.discordCodeInput}
                  placeholder="Enter pairing code (e.g. ABC123)"
                  placeholderTextColor={Colors.textSecondary}
                  value={discordPairInput}
                  onChangeText={t => { setDiscordPairInput(t.toUpperCase()); setDiscordConnectError(''); }}
                  autoCapitalize="characters"
                  maxLength={8}
                />

                {discordConnectError ? (
                  <Text style={styles.discordErrorText}>{discordConnectError}</Text>
                ) : null}

                <Pressable
                  style={[styles.discordConnectBtn, (!discordPairInput.trim() || discordConnecting) && { opacity: 0.5 }]}
                  disabled={!discordPairInput.trim() || discordConnecting}
                  onPress={async () => {
                    setDiscordConnecting(true);
                    setDiscordConnectError('');
                    try {
                      const url = new URL('/api/channels/discord/pair', getApiUrl());
                      const res = await authFetch(url.toString(), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: discordPairInput.trim() }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setDiscordPhase('done');
                      } else {
                        setDiscordConnectError(data.error || 'Invalid code — make sure you copied it exactly from the bot.');
                      }
                    } catch {
                      setDiscordConnectError('Connection error. Please try again.');
                    } finally {
                      setDiscordConnecting(false);
                    }
                  }}
                >
                  {discordConnecting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.discordConnectBtnText}>Link Discord Account</Text>
                  )}
                </Pressable>

                <Pressable onPress={() => setDiscordPhase('setup_bot')} style={styles.discordSecondaryBtn}>
                  <Text style={styles.discordSecondaryBtnText}>← Back to bot setup</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  clearBtn: {
    padding: 6,
    minWidth: 44,
    alignItems: 'flex-end',
  },
  clearConfirmText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#EF4444',
  },
  emailLoadingBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: Colors.background,
  },
  emailLoadingText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  chatArea: {
    flex: 1,
    overflow: 'hidden',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexGrow: 1,
  },
  messageRow: {
    marginBottom: 10,
  },
  messageRowUser: {
    alignItems: 'flex-end',
  },
  messageRowAssistant: {
    alignItems: 'flex-start',
  },
  coachLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  coachLabelText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: Colors.card,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  diagnosticPressActive: {
    opacity: 0.82,
  },
  diagnosticCopyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.26)',
  },
  diagnosticCopyButtonText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.warning,
  },
  executedActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  executedActionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  connectCodeBlock: {
    marginTop: 8,
    backgroundColor: 'rgba(30, 41, 59, 0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    alignSelf: 'flex-start',
    minWidth: 180,
  },
  connectCodeLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  connectCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectCodeText: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    letterSpacing: 4,
  },
  connectCodeHint: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 4,
  },
  executedActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  executedActionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  executedActionBadgeError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  executedActionText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.success,
  },
  executedActionTextError: {
    color: '#EF4444',
  },
  screenshotContainer: {
    marginTop: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 280,
  },
  screenshotBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  screenshotLabelBlock: {
    flex: 1,
  },
  screenshotLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.success,
  },
  screenshotHint: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  screenshotImage: {
    width: 280,
    height: 497,
    backgroundColor: '#000',
  },
  generatedImageContainer: {
    marginTop: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 280,
  },
  generatedImage: {
    width: 280,
    height: 280,
    backgroundColor: Colors.surface,
  },
  generatedImageCaption: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    paddingHorizontal: 10,
    paddingVertical: 7,
    lineHeight: 17,
  },
  generatedVideoCard: {
    marginTop: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 280,
  },
  generatedVideoThumb: {
    width: 280,
    height: 158,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatedVideoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
  },
  generatedVideoLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  // MCP styles
  mcpAttributionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  mcpAttributionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: `${Colors.primary}15`,
    borderWidth: 1,
    borderColor: `${Colors.primary}30`,
  },
  mcpAttributionText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
    letterSpacing: 0.2,
  },
  mcpImageContainer: {
    marginTop: 8,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 280,
  },
  mcpImage: {
    width: 280,
    height: 200,
  },
  mcpMarkdownContainer: {
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 300,
  },
  mcpFileCard: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 280,
  },
  mcpFileName: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  mcpFileMime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  // MCP modal styles
  mcpModal: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  mcpModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  mcpModalClose: {
    padding: 6,
    minWidth: 44,
    alignItems: 'flex-start',
  },
  mcpModalTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    flex: 1,
    textAlign: 'center',
  },
  mcpModalLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  mcpModalLoadingText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  mcpModalEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  mcpModalEmptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    textAlign: 'center',
  },
  mcpModalEmptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  mcpModalList: {
    padding: 16,
    gap: 12,
  },
  mcpPromptCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  mcpPromptCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mcpPromptServerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: `${Colors.primary}15`,
  },
  mcpPromptServerName: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  mcpPromptName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  mcpPromptDesc: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  mcpPromptArgsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  mcpPromptArgChip: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: Colors.border,
  },
  mcpPromptArgText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  mcpPromptArgMore: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    alignSelf: 'center',
  },
  confirmCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginTop: 2,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 300,
  },
  confirmCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  confirmCardTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  confirmPreview: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    marginBottom: 12,
  },
  confirmPreviewLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginTop: 4,
  },
  confirmPreviewValue: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 18,
  },
  confirmPreviewCode: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    backgroundColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  confirmBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
  },
  confirmBtnCancel: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmBtnConfirm: {
    backgroundColor: Colors.primary,
  },
  confirmBtnCancelText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  confirmBtnConfirmText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    paddingLeft: 2,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EEF2FF',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  actionPillAdded: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  actionPillError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  actionPillLink: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderColor: 'rgba(99, 102, 241, 0.4)',
  },
  actionPillReminder: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  actionPillText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  actionPillTextAdded: {
    color: Colors.success,
  },
  actionPillTextError: {
    color: Colors.error,
  },
  actionPillTextLink: {
    color: '#818CF8',
    fontWeight: '600' as const,
  },
  followupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    paddingLeft: 2,
  },
  followupChip: {
    backgroundColor: Colors.background,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  followupChipText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    gap: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  typingBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.card,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typingDots: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.textSecondary,
  },
  searchingBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.card,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
  },
  suggestedGrid: {
    width: '100%',
    gap: 8,
  },
  suggestedPill: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestedText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: 100,
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micLoadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  micLoadingSpinner: {
    position: 'absolute',
  },
  micBtnRecording: {
    backgroundColor: '#FEE2E2',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.border,
  },
  stopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
  },
  waveBar: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  waveBarTall: {
    height: 22,
  },
  speakBtn: {
    marginTop: 4,
    padding: 6,
    alignSelf: 'flex-start',
  },
  stoppedPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    alignSelf: 'flex-start' as const,
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stoppedPillText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  inboxSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
  },
  inboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  inboxHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inboxHeaderTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  inboxHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scanAgainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  scanAgainText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  scanLoadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  scanLoadingText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestionContent: {
    flex: 1,
    marginRight: 10,
  },
  suggestionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 4,
  },
  suggestionEmail: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  suggestionGoal: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    opacity: 0.8,
  },
  addSuggestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  addSuggestionBtnAdded: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  addedText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.success,
  },
  draftRow: {
    marginTop: 8,
    paddingLeft: 2,
  },
  draftBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start' as const,
  },
  draftBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  draftBtnError: {
    backgroundColor: '#EF4444',
  },
  draftSavedRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  draftSavedPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: '#ECFDF5',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  draftSavedText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.success,
  },
  draftOpenLink: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
    textDecorationLine: 'underline' as const,
  },
  draftReconnectPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  draftReconnectText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: '#92400E',
    flex: 1,
  },
  discordModal: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  discordModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  discordModalBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 64,
  },
  discordModalBackText: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  discordModalTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  discordModalBody: {
    padding: 24,
    gap: 16,
  },
  discordIconRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  discordPhasePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#5865F220',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 4,
  },
  discordPhasePillText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#5865F2',
  },
  discordInstructTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 4,
  },
  discordInstructSub: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 4,
  },
  discordLink: {
    color: '#5865F2',
    textDecorationLine: 'underline' as const,
    fontFamily: 'Inter_500Medium',
  },
  discordBold: {
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  discordSecondaryBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  discordSecondaryBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  discordStep: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  discordStepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#5865F2',
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    overflow: 'hidden',
  },
  discordStepText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  discordCodeInput: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    textAlign: 'center',
    letterSpacing: 4,
    marginTop: 8,
  },
  discordTokenInput: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    marginTop: 8,
  },
  discordErrorText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#EF4444',
    textAlign: 'center',
  },
  discordConnectBtn: {
    backgroundColor: '#5865F2',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  discordConnectBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  discordSuccessBox: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  discordSuccessText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 22,
  },
  discordSectionBox: {
    backgroundColor: Colors.bg,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  discordSectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  discordSectionSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  discordGuildRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#5865F220',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  discordGuildName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#5865F2',
    flex: 1,
  },
});
