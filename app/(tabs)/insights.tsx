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
  endAndroidOutsideAppVoiceSession,
  setAndroidOutsideAppVoiceSessionState,
  startAndroidOutsideAppVoiceSession,
} from '@/lib/android-daemon-native';
import {
  buildTurnDiagnosticBundle,
  getActionableDiagnosticRecords,
  inferRuntimeIntent,
  isDiagnosticCopyRequest,
  resolveDiagnosticCopyRequestTarget,
  resolveDiagnosticTargetFromText,
  resolveVoiceDiagnosticFollowupTarget,
  shouldClarifyVoiceDiagnosticTarget,
  type DiagnosticTurnRecord,
  type DiagnosticVoiceTrace,
  type TurnDiagnosticBundle,
} from '@shared/turnDiagnostics';
import {
  LOCAL_VOICE_SILENCE_POLL_MS,
  createLocalVoiceSilenceState,
  updateLocalVoiceSilenceState,
} from '@shared/localVoiceLoop';


interface EmailSuggestion {
  title: string;
  emailSubject: string;
  emailFrom: string;
  accountEmail: string;
  goalTitle: string;
  reason: string;
}

const DEFAULT_RUNTIME_MODE: CoachingMode = 'sharp';

type SendMessageOrigin =
  | { source: 'in_app' }
  | { source: 'voice'; voiceTrace: DiagnosticVoiceTrace };

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
  const preview = pendingConfirm.preview;

  return (
    <View style={styles.confirmCard}>
      <View style={styles.confirmCardHeader}>
        <Ionicons
          name={isEmail ? 'mail-outline' : isConnectedAccountAction ? 'git-network-outline' : 'terminal-outline'}
          size={15}
          color={Colors.primary}
        />
        <Text style={styles.confirmCardTitle}>
          {isEmail ? 'Send email?' : isConnectedAccountAction ? 'Approve connected account action?' : `Run terminal command?`}
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
            {isLoading ? (isEmail ? 'Sending...' : isConnectedAccountAction ? 'Approving...' : 'Running...') : isEmail ? 'Send' : isConnectedAccountAction ? 'Approve' : 'Run'}
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
  const talkModeRef = useRef(false);
  const talkModeStartSeqRef = useRef(0);
  const outsideAppVoiceStateRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
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
  const isTranscribingRef = useRef(false);
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<Blob[]>([]);
  const sendMessageRef = useRef<(text: string, origin?: SendMessageOrigin) => void>(() => {});
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
      soundRef.current?.remove();
      speakAbortRef.current?.abort();
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

  const transcribeAndSend = useCallback(async (base64: string) => {
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
      if (data.text && data.text.trim()) {
        setIsTranscribing(false);
        const transcriptText = data.text.trim();
        if (talkModeRef.current) {
          // Talk Mode: show the transcript in the normal composer, then submit it.
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
        } else {
          // Regular mic tap: drop the transcript into the input so the user
          // can review and edit before sending manually.
          setInput(prev => prev.trim() ? prev.trimEnd() + ' ' + transcriptText : transcriptText);
        }
      } else {
        setIsTranscribing(false);
        if (talkModeRef.current) {
          setInput('');
          return;
        }
        Alert.alert('Could not understand', 'No speech was detected. Please try again and speak clearly.');
      }
    } catch (error) {
      console.error('Failed to transcribe:', error);
      setIsTranscribing(false);
      Alert.alert('Transcription failed', 'Could not process your voice message. Please try again.');
    }
  }, []);

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
  }, [audioRecorder, clearSilencePoll]);

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
      return;
    }
    if (nativeVoiceStateSyncHeldRef.current) return;
    const nextState = isSpeaking
      ? 'speaking'
      : isTranscribing || isStreaming || isWorkingOnPhone
        ? 'working'
        : isRecording
          ? 'listening'
          : 'idle';
    if (outsideAppVoiceStateRef.current === nextState) return;
    outsideAppVoiceStateRef.current = nextState;
    setAndroidOutsideAppVoiceSessionState(nextState).catch((err) => {
      console.warn('[voice] outside-app state sync failed:', err);
    });
  }, [isRecording, isSpeaking, isStreaming, isTranscribing, isWorkingOnPhone, talkModeEnabled]);

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
        isStreamingRef.current ||
        isSpeakingRef.current ||
        isRecordingRef.current ||
        isTranscribingRef.current
      ) {
        return;
      }
      startRecordingRef.current();
    }, delayMs);
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
        stopRecordingSilentlyRef.current().catch(() => {});
        return;
      }
      if (action === 'end') {
        nativeVoiceStateSyncHeldRef.current = false;
        outsideAppVoiceStateRef.current = null;
        talkModeRef.current = false;
        setTalkModeEnabled(false);
        setTalkModeActive(false);
        stopSpeaking();
        stopRecordingSilentlyRef.current().catch(() => {});
        apiRequest('PUT', '/api/voice/wake-settings', { talkModeEnabled: false }).catch(() => {});
        return;
      }
      if (action === 'resume' || action === 'listening') {
        nativeVoiceStateSyncHeldRef.current = false;
        if (action === 'listening') {
          outsideAppVoiceStateRef.current = 'listening';
          return;
        }
        if (talkModeRef.current && !isSpeakingRef.current && !isRecordingRef.current) {
          scheduleTalkModeRecordingStart();
        }
      }
    });
    return () => subscription.remove();
  }, [interruptSpeakingAndListen, scheduleTalkModeRecordingStart, setTalkModeActive, stopSpeaking]);

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
      if (talkModeRef.current) {
        scheduleTalkModeRecordingStart(400);
      }
    };

    const onError = () => {
      isSpeakingRef.current = false;
      speakingTextRef.current = null;
      speakingAssistantIdRef.current = null;
      setIsSpeaking(false);
      setIsTTSLoading(false);
    };

    const trimmedText = text.slice(0, 4000);

    const uint8ToBase64 = (bytes: Uint8Array): string => {
      const chunkSize = 8192;
      let b64 = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        b64 += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
      }
      return btoa(b64);
    };

    let streamingAttempted = false;

    try {
      streamingAttempted = true;
      const streamUrl = new URL('/api/tts/stream', getApiUrl()).toString();
      const ttsToken = await getAuthToken();
      const ttsHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (ttsToken) ttsHeaders['Authorization'] = `Bearer ${ttsToken}`;
      const res = await expoFetch(streamUrl, {
        method: 'POST',
        headers: ttsHeaders,
        body: JSON.stringify({ text: trimmedText }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Stream ${res.status}`);
      if (!isSpeakingRef.current) return;

      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';

      const parseLines = (rawText: string): { type: string; data?: string; sampleRate?: number; message?: string }[] => {
        lineBuffer += rawText;
        const parsed: { type: string; data?: string; sampleRate?: number; message?: string }[] = [];
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { parsed.push(JSON.parse(trimmed)); } catch { /* skip malformed */ }
        }
        return parsed;
      };

      if (Platform.OS === 'web') {
        const WinAudioContext = (window as unknown as Record<string, unknown>).AudioContext ?? (window as unknown as Record<string, unknown>).webkitAudioContext;
        if (!WinAudioContext) throw new Error('Web Audio API not available');
        const audioCtx = new (WinAudioContext as typeof AudioContext)({ sampleRate: 24000 });
        webAudioCtxRef.current = audioCtx;
        let scheduledTime = audioCtx.currentTime + 0.1;

        // Carry-over byte to handle odd-length PCM chunks (PCM16 requires 2-byte alignment)
        let webCarryByte: number | null = null;

        // Counter-based completion tracking — avoids lastSource.onended race condition
        // where very short audio finishes before the handler is attached.
        let webScheduledCount = 0;
        let webEndedCount = 0;
        let webStreamDone = false;

        const checkWebDone = () => {
          if (webStreamDone && webEndedCount === webScheduledCount) {
            if (isSpeakingRef.current) onPlaybackEnd();
            audioCtx.close().catch(() => {});
            webAudioCtxRef.current = null;
          }
        };

        const scheduleChunk = (base64Data: string, sr = 24000) => {
          const binaryStr = atob(base64Data);
          let raw = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) raw[i] = binaryStr.charCodeAt(i);

          // Prepend any carry-over byte from the previous chunk
          let aligned: Uint8Array;
          if (webCarryByte !== null) {
            aligned = new Uint8Array(1 + raw.length);
            aligned[0] = webCarryByte;
            aligned.set(raw, 1);
            webCarryByte = null;
          } else {
            aligned = raw;
          }
          // If still odd-length, save last byte for next chunk
          if (aligned.length % 2 !== 0) {
            webCarryByte = aligned[aligned.length - 1];
            aligned = aligned.subarray(0, aligned.length - 1);
          }
          if (aligned.length === 0) return;

          const pcm16 = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2);
          const float32 = new Float32Array(pcm16.length);
          for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
          const buf = audioCtx.createBuffer(1, float32.length, sr);
          buf.getChannelData(0).set(float32);
          const src = audioCtx.createBufferSource();
          src.buffer = buf;
          src.connect(audioCtx.destination);
          const startAt = Math.max(audioCtx.currentTime + 0.001, scheduledTime);
          src.start(startAt);
          scheduledTime = startAt + buf.duration;
          webScheduledCount++;
          // Attach handler at scheduling time to avoid race on short clips
          src.onended = () => {
            webEndedCount++;
            checkWebDone();
          };
        };

        setIsTTSLoading(false);
        let done = false;
        while (!done && !abortController.signal.aborted && isSpeakingRef.current) {
          const { done: readDone, value } = await reader.read();
          if (readDone) break;
          for (const msg of parseLines(decoder.decode(value, { stream: true }))) {
            if (msg.type === 'chunk' && msg.data) {
              scheduleChunk(msg.data, msg.sampleRate ?? 24000);
            } else if (msg.type === 'done') {
              done = true;
            } else if (msg.type === 'error') {
              throw new Error(msg.message ?? 'Stream error');
            }
          }
        }

        if (webScheduledCount === 0) {
          audioCtx.close().catch(() => {});
          webAudioCtxRef.current = null;
          // Throw so the outer catch triggers the full-file fallback (matches native behavior)
          throw new Error('No audio chunks received');
        } else {
          // Mark stream complete and check if all sources already ended
          webStreamDone = true;
          checkWebDone();
        }
      } else {
        // ── Native: rolling segment pipeline ──────────────────────────────────
        // Splits the PCM16 stream into ~500ms WAV segments and plays them
        // sequentially. Playback begins as soon as the first segment is ready
        // (concurrent with streaming — audio starts before generation ends).
        //
        // Why not single WAV: expo-av requires the complete file before play.
        // Why not PCM streaming: no public React Native API for raw PCM append.
        const SEGMENT_BYTES = 24000; // 24000 hz × 2 bytes × 0.5 s = 24000 bytes ≈ 500ms

        const buildWavBytes = (chunks: Uint8Array[], totalLen: number): Uint8Array => {
          const sr = 24000;
          const h = new ArrayBuffer(44); const dv = new DataView(h);
          dv.setUint8(0,0x52);dv.setUint8(1,0x49);dv.setUint8(2,0x46);dv.setUint8(3,0x46);
          dv.setUint32(4, 36 + totalLen, true);
          dv.setUint8(8,0x57);dv.setUint8(9,0x41);dv.setUint8(10,0x56);dv.setUint8(11,0x45);
          dv.setUint8(12,0x66);dv.setUint8(13,0x6d);dv.setUint8(14,0x74);dv.setUint8(15,0x20);
          dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);
          dv.setUint32(24,sr,true);dv.setUint32(28,sr*2,true);
          dv.setUint16(32,2,true);dv.setUint16(34,16,true);
          dv.setUint8(36,0x64);dv.setUint8(37,0x61);dv.setUint8(38,0x74);dv.setUint8(39,0x61);
          dv.setUint32(40, totalLen, true);
          const wav = new Uint8Array(44 + totalLen);
          wav.set(new Uint8Array(h), 0);
          let off = 44; for (const c of chunks) { wav.set(c, off); off += c.length; }
          return wav;
        };

        // segWritePromises[i] resolves when segment i WAV is written to segUris[i]
        const segUris: string[] = [];
        const segWritePromises: Promise<void>[] = [];
        let segIdx = 0;
        let pendingBuf: Uint8Array[] = [];
        let pendingLen = 0;
        let nativeFirstChunk = false;
        let streamDone = false;
        // Carry-over byte across PCM16 chunk boundaries — same as web path
        let nativeCarryByte: number | null = null;
        // Per-utterance unique prefix to avoid cross-session segment filename collisions
        const segPrefix = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

        const cleanupSegFiles = () => {
          for (const uri of segUris) {
            FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
          }
        };

        const enqueueSegment = (chunks: Uint8Array[], len: number) => {
          const idx = segIdx++;
          const uri = `${FileSystem.cacheDirectory ?? ''}jarvis_tts_${segPrefix}_${idx}.wav`;
          segUris[idx] = uri;
          segWritePromises[idx] = (async () => {
            const wav = buildWavBytes(chunks, len);
            await FileSystem.writeAsStringAsync(uri, uint8ToBase64(wav), { encoding: FileSystem.EncodingType.Base64 });
          })();
        };

        // Playback loop runs concurrently with streaming
        const playbackDone = (async () => {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
          let playIdx = 0;
          while (!abortController.signal.aborted && isSpeakingRef.current) {
            if (playIdx < segWritePromises.length) {
              await segWritePromises[playIdx]; // Wait until this segment is written
              if (!isSpeakingRef.current || abortController.signal.aborted) break;
              const sound = createAudioPlayer({ uri: segUris[playIdx] });
              soundRef.current = sound;
              const segUri = segUris[playIdx];
              playIdx++;
              sound.play();
              await new Promise<void>((resolve) => {
                let started = false;
                sound.addListener('playbackStatusUpdate', (status) => {
                  if (status.isLoaded && status.playing) started = true;
                  if (status.didJustFinish) {
                    sound.remove();
                    FileSystem.deleteAsync(segUri, { idempotent: true }).catch(() => {});
                    resolve();
                  } else if (started && status.isLoaded && !status.playing) {
                    // Sound was stopped externally (abort/stop) — resolve to unblock loop
                    sound.remove();
                    FileSystem.deleteAsync(segUri, { idempotent: true }).catch(() => {});
                    resolve();
                  }
                });
              });
            } else if (streamDone) {
              break; // All segments played
            } else {
              await new Promise(r => setTimeout(r, 30)); // Wait for next segment
            }
          }
          // Clean up any remaining unplayed segments on abort/stop
          cleanupSegFiles();
          if (isSpeakingRef.current) onPlaybackEnd();
        })();

        // Streaming loop — enqueues segments as chunks arrive
        let done = false;
        while (!done && !abortController.signal.aborted && isSpeakingRef.current) {
          const { done: readDone, value } = await reader.read();
          if (readDone) break;
          for (const msg of parseLines(decoder.decode(value, { stream: true }))) {
            if (msg.type === 'chunk' && msg.data) {
              if (!nativeFirstChunk) { nativeFirstChunk = true; setIsTTSLoading(false); }
              const binaryStr = atob(msg.data);
              let raw = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) raw[i] = binaryStr.charCodeAt(i);

              // PCM16 byte-alignment carry-over (same logic as web path)
              let aligned: Uint8Array;
              if (nativeCarryByte !== null) {
                aligned = new Uint8Array(1 + raw.length);
                aligned[0] = nativeCarryByte;
                aligned.set(raw, 1);
                nativeCarryByte = null;
              } else {
                aligned = raw;
              }
              if (aligned.length % 2 !== 0) {
                nativeCarryByte = aligned[aligned.length - 1];
                aligned = aligned.subarray(0, aligned.length - 1);
              }
              if (aligned.length > 0) {
                pendingBuf.push(aligned);
                pendingLen += aligned.length;
              }
              if (pendingLen >= SEGMENT_BYTES) {
                enqueueSegment([...pendingBuf], pendingLen);
                pendingBuf = []; pendingLen = 0;
              }
            } else if (msg.type === 'done') {
              done = true;
            } else if (msg.type === 'error') {
              throw new Error(msg.message ?? 'Stream error');
            }
          }
        }

        // Flush any remaining PCM as final segment (PCM16-aligned via carry-over above)
        if (pendingLen > 0 && isSpeakingRef.current) {
          enqueueSegment([...pendingBuf], pendingLen);
        }
        if (!nativeFirstChunk) setIsTTSLoading(false);
        streamDone = true;

        if (!isSpeakingRef.current || abortController.signal.aborted) {
          cleanupSegFiles();
          return;
        }
        if (segIdx === 0) throw new Error('No audio data received');

        await playbackDone;
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.warn('[speakText] Streaming failed, falling back:', error);

      if (streamingAttempted && !isSpeakingRef.current) return;

      try {
        const url = new URL('/api/coach/speak', getApiUrl());
        const res = await authFetch(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmedText }),
          signal: abortController.signal,
        });
        if (!isSpeakingRef.current) return;
        const data = await res.json();
        setIsTTSLoading(false);
        if (!data.audio || !isSpeakingRef.current) { onError(); return; }

        if (Platform.OS === 'web') {
          const audioEl = new window.Audio(`data:audio/mp3;base64,${data.audio}`);
          webAudioRef.current = audioEl;
          audioEl.onended = () => { onPlaybackEnd(); };
          audioEl.onerror = () => { onError(); };
          await audioEl.play();
        } else {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
          const tmpUri = (FileSystem.cacheDirectory ?? '') + 'coach_speech.mp3';
          await FileSystem.writeAsStringAsync(tmpUri, data.audio, { encoding: FileSystem.EncodingType.Base64 });
          const sound = createAudioPlayer({ uri: tmpUri });
          soundRef.current = sound;
          sound.addListener('playbackStatusUpdate', (status) => {
            if (status.didJustFinish) { onPlaybackEnd(); }
          });
          sound.play();
        }
      } catch (fallbackErr: unknown) {
        if (fallbackErr instanceof Error && fallbackErr.name === 'AbortError') return;
        console.error('[speakText] Fallback also failed:', fallbackErr);
        onError();
      }
    }
  }, [interruptSpeakingAndListen, isSpeaking, scheduleTalkModeRecordingStart, stopSpeaking]);

  speakTextRef.current = speakText;

  const scanForTasks = useCallback(async (currentGoals: Goal[]) => {
    if (currentGoals.length === 0) return;
    setScanLoading(true);
    try {
      const url = new URL('/api/gmail/scan-for-tasks', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goals: currentGoals }),
      });
      const data = await res.json();
      if (data.suggestions && Array.isArray(data.suggestions)) {
        setEmailSuggestions(data.suggestions);
        setAddedSuggestions({});
        if (!initialScanDoneRef.current) {
          initialScanDoneRef.current = true;
          if (hasScrolledRef.current) {
            setInboxCollapsed(true);
          }
        }
      }
    } catch {}
    setScanLoading(false);
  }, []);

  const handleAddEmailSuggestion = useCallback(async (suggestion: EmailSuggestion, index: number) => {
    if (addedSuggestions[index]) return;
    setAddedSuggestions(prev => ({ ...prev, [index]: true }));
    try {
      const loadedGoals = await getGoals();
      const plan = await getTodayPlan(loadedGoals);
      const matchedGoal = loadedGoals.find(g => g.title === suggestion.goalTitle);
      const validCats = ['fitness', 'finance', 'career', 'personal', 'social'];
      const category = matchedGoal && validCats.includes(matchedGoal.category)
        ? matchedGoal.category
        : 'personal';
      const newTask = {
        id: generateId(),
        title: suggestion.title,
        category: category as any,
        completed: false,
        priority: 'medium' as any,
        description: suggestion.reason,
        goalId: matchedGoal?.id,
      };
      const updated = { ...plan, tasks: [...plan.tasks, newTask] };
      await savePlan(updated);
    } catch {}
  }, [addedSuggestions]);

  const fetchCommitments = useCallback(async () => {
    try {
      const url = new URL('/api/commitments', getApiUrl());
      const res = await authFetch(url.toString());
      const data = await res.json();
      if (data.commitments && Array.isArray(data.commitments)) {
        setCommitments(data.commitments);
      }
    } catch {}
  }, []);

  const checkAccountabilityOnMount = useCallback(async (loadedHistory: any[], loadedCommitments: Commitment[], loadedGoals: Goal[], loadedStats: UserStats, loadedLifeContext: LifeContext | null) => {
    if (proactiveCheckedRef.current) return;
    proactiveCheckedRef.current = true;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const yesterdayIncomplete = loadedHistory.filter((h: any) => !h.completed && h.date === yesterdayKey);
    const today = getTodayKey();
    const overdueCommitments = loadedCommitments.filter(c => c.dueDate && c.dueDate < today && c.status === 'pending');

    if (yesterdayIncomplete.length === 0 && overdueCommitments.length === 0) return;

    const parts: string[] = [];
    if (yesterdayIncomplete.length > 0) {
      parts.push(`User left ${yesterdayIncomplete.length} task(s) incomplete yesterday: ${yesterdayIncomplete.slice(0, 5).map((h: any) => h.title).join(', ')}.`);
    }
    if (overdueCommitments.length > 0) {
      parts.push(`User has ${overdueCommitments.length} overdue commitment(s): ${overdueCommitments.slice(0, 5).map(c => `"${c.content}" (due ${c.dueDate})`).join(', ')}.`);
    }
    const context = parts.join(' ');

    try {
      const proactiveId = generateId();
      const url = new URL('/api/coach/proactive', getApiUrl());
      const token = await getAuthToken();
      const streamHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) streamHeaders['Authorization'] = `Bearer ${token}`;

      const response = await expoFetch(url.toString(), {
        method: 'POST',
        headers: streamHeaders,
        body: JSON.stringify({
          context,
          goals: loadedGoals,
          stats: loadedStats,
          history: loadedHistory,
          lifeContext: loadedLifeContext,
          commitments: loadedCommitments,
          coachingMode: coachingModeRef.current,
        }),
      });

      if (!response.body) return;

      const proactiveMsg: ChatMessage = { id: proactiveId, role: 'assistant', content: '' };
      setMessages(prev => [proactiveMsg, ...prev]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;
                const captured = fullContent;
                setMessages(prev => {
                  const updated = [...prev];
                  const idx = updated.findIndex(m => m.id === proactiveId);
                  if (idx !== -1) updated[idx] = { ...updated[idx], content: captured };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.id === proactiveId);
        if (idx !== -1) updated[idx] = { ...updated[idx], content: fullContent };
        persistChatHistory(updated);
        return updated;
      });
    } catch {}
  }, []);

  const loadAll = useCallback(async () => {
    setIsBaseLoading(true);
    setIsEmailLoading(true);

    let loadedGoals: Goal[] = [];
    let loadedHistory: any[] = [];
    let loadedStats: UserStats = { streak: 0, totalCompleted: 0, bestStreak: 0, xp: 0, badges: [], claimedRewards: [], dailyXpEarned: { date: new Date().toISOString().slice(0, 10), xp: 0 } };
    let loadedLifeContext: LifeContext | null = null;
    let loadedCommitments: Commitment[] = [];
    try {
      const [lg, ls, lh, savedMessages, lc, savedSessionId] = await Promise.all([
        getGoals(),
        getStats(),
        getCompletionHistory(),
        getChatHistory(),
        getLifeContext(),
        getCoachSessionId(),
      ]);
      loadedGoals = lg;
      loadedStats = ls;
      loadedHistory = lh;
      loadedLifeContext = lc;
      setGoals(lg);
      setStats(ls);
      setHistory(lh);
      setMessages(savedMessages);
      setLifeContext(lc);
      coachingModeRef.current = DEFAULT_RUNTIME_MODE;
      sdkSessionIdRef.current = savedSessionId;

      // Fetch commitments
      try {
        const commUrl = new URL('/api/commitments', getApiUrl());
        const commRes = await authFetch(commUrl.toString());
        const commData = await commRes.json();
        if (commData.commitments && Array.isArray(commData.commitments)) {
          loadedCommitments = commData.commitments;
          setCommitments(commData.commitments);
        }
      } catch {}
    } finally {
      setIsBaseLoading(false);
    }

    // Schedule accountability notifications
    try {
      const todayPlan = await getTodayPlan(loadedGoals);
      scheduleEveningAccountability(todayPlan.tasks, loadedCommitments).catch(() => {});
      scheduleMidDayNudge().catch(() => {});
      scheduleCommitmentDueDateReminder(loadedCommitments).catch(() => {});
      scheduleWeeklyReview().catch(() => {});
    } catch {}

    // Morning brief — fetch the single canonical brief generated by the
    // proactive scheduler (same text already sent to Telegram + daemon).
    // Only inject it if not already present in the chat history for today.
    try {
      const today = getTodayKey();
      const briefId = `morning-brief-${today}`;
      const briefUrl = new URL('/api/coach/morning-brief', getApiUrl());
      const briefRes = await authFetch(briefUrl.toString());
      const briefData = await briefRes.json();
      if (briefData.text) {
        setMessages(prev => {
          // If the brief is already in history (e.g. from a previous app open today), skip
          if (prev.some(m => m.id === briefId)) return prev;
          const briefMsg: ChatMessage = {
            id: briefId,
            role: 'assistant',
            content: briefData.text,
          };
          // Prepend so it appears at the top of the chat (most recent)
          const updated = [briefMsg, ...prev];
          persistChatHistory(updated);
          return updated;
        });
      }
    } catch {}

    // Pending daemon response — fetch any Jarvis response that was saved server-side
    // because the SSE connection dropped while the user was in another app (e.g. camera).
    // The server stores the response in userPreferences and clears it on first fetch.
    try {
      const pendingUrl = new URL('/api/coach/pending-response', getApiUrl());
      const pendingRes = await authFetch(pendingUrl.toString());
      const pendingData = await pendingRes.json();
      if (pendingData.text && pendingData.id) {
        setMessages(prev => {
          // Already in chat? Skip
          if (prev.some(m => m.id === pendingData.id)) return prev;
          const pendingMsg: ChatMessage = {
            id: pendingData.id,
            role: 'assistant',
            content: pendingData.text,
            // If the task that triggered this pending response took a screenshot,
            // include it as an executedAction so the image renders inline.
            ...(pendingData.screenshotUrl ? {
              executedActions: [{ tool: 'daemon_action', result: 'success', label: 'Temporary screen capture', screenshotUrl: pendingData.screenshotUrl }]
            } : {}),
          };
          const updated = [pendingMsg, ...prev];
          persistChatHistory(updated);
          return updated;
        });
      }
    } catch {}

    // Check accountability on mount (proactive Jarvis message for overdue items)
    checkAccountabilityOnMount(loadedHistory, loadedCommitments, loadedGoals, loadedStats, loadedLifeContext).catch(() => {});

    let isGmailConnected = false;
    try {
      const today = getTodayKey();
      const calEvts: { title: string; time: string }[] = [];
      const base = getApiUrl();

      const fetchSource = async (source: 'google' | 'outlook') => {
        const url = new URL(`/api/calendar/${source}/events`, base);
        url.searchParams.set('date', today);
        const res = await authFetch(url.toString(), { cache: 'no-store' } as RequestInit);
        const data = await res.json();
        if (data.connected && data.events?.length) {
          data.events.forEach((e: any) => {
            calEvts.push({ title: e.title || e.summary || '', time: e.time || e.start || '' });
          });
        }
      };

      const fetchGmail = async () => {
        const url = new URL('/api/gmail/commitments', base);
        const res = await authFetch(url.toString(), { cache: 'no-store' } as RequestInit);
        const data = await res.json();
        isGmailConnected = !!data.connected;
        setGmailConnected(isGmailConnected);
        if (data.connected && data.items?.length) {
          setGmailItems(data.items);
        }
      };

      const fetchSlack = async () => {
        const url = new URL('/api/slack/messages', base);
        const res = await authFetch(url.toString(), { cache: 'no-store' } as RequestInit);
        const data = await res.json();
        setSlackConnected(!!data.connected);
        setSlackMessages(data.connected && data.messages?.length ? data.messages : []);
      };

      const fetchTelegram = async () => {
        const url = new URL('/api/telegram/messages', base);
        const res = await authFetch(url.toString(), { cache: 'no-store' } as RequestInit);
        const data = await res.json();
        setTelegramConnected(!!data.connected);
        setTelegramMessages(data.connected && data.messages?.length ? data.messages : []);
      };

      await Promise.allSettled([fetchSource('google'), fetchSource('outlook'), fetchGmail(), fetchSlack(), fetchTelegram()]);
      setCalendarEvents(calEvts);
    } catch {
    } finally {
      setIsEmailLoading(false);
    }

    if (isGmailConnected && loadedGoals.length > 0) {
      scanForTasks(loadedGoals);
    }
  }, [scanForTasks]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useFocusEffect(useCallback(() => {
    getGoals().then(setGoals);
    getStats().then(setStats);
    apiRequest('GET', '/api/voice/wake-settings').then(r => r.json()).then(d => {
      const enabled = d?.talkModeEnabled ?? false;
      setTalkModeEnabled(enabled);
      talkModeRef.current = enabled;
      if (Platform.OS === 'android' && enabled) {
        startAndroidOutsideAppVoiceSession().catch((err) => {
          console.warn('[voice] outside-app session restore failed:', err);
        });
      }
    }).catch(() => {});

    // Cleanup on blur: cancel queued Talk Mode starts and stop any active in-app capture.
    return () => {
      talkModeStartSeqRef.current += 1;
      if (silencePollRef.current) {
        clearInterval(silencePollRef.current);
        silencePollRef.current = null;
      }
      if (talkModeRef.current && isRecordingRef.current) {
        stopRecordingSilentlyRef.current().catch(() => {});
      }
    };
  }, []));

  const fetchMcpPrompts = useCallback(async () => {
    setMcpPromptsLoading(true);
    try {
      const url = new URL('/api/mcp-servers/prompts', getApiUrl());
      const res = await authFetch(url.toString());
      const data = await res.json();
      setMcpPrompts(data.prompts || []);
    } catch {
      setMcpPrompts([]);
    }
    setMcpPromptsLoading(false);
  }, []);

  const openMcpSheet = useCallback(() => {
    setShowMcpSheet(true);
    fetchMcpPrompts();
  }, [fetchMcpPrompts]);

  const selectMcpPrompt = useCallback(async (prompt: { serverId: string; name: string; arguments?: { name: string; required?: boolean }[] }) => {
    setShowMcpSheet(false);
    // If all arguments are optional or absent, try to resolve the prompt immediately
    const hasRequiredArgs = prompt.arguments?.some(a => a.required) ?? false;
    if (!hasRequiredArgs) {
      try {
        const url = new URL('/api/mcp-servers/prompts/resolve', getApiUrl());
        const res = await authFetch(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId: prompt.serverId, name: prompt.name }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.resolvedText) {
            setInput(data.resolvedText);
            return;
          }
        }
      } catch { /* fall through to name-only */ }
    }
    // For prompts with required arguments, insert the name so user can fill them in
    const argHints = prompt.arguments?.filter(a => a.required).map(a => `[${a.name}]`).join(' ') ?? '';
    setInput(prompt.name + (argHints ? ' ' + argHints : ''));
  }, []);

  const getDiagnosticRecords = useCallback((): DiagnosticTurnRecord[] => {
    const records = messagesRef.current
      .filter((message) => message.role === 'assistant' && !!message.diagnostics)
      .map((message) => {
        const bundle = message.diagnostics!;
        return {
          turnId: bundle.turnId,
          source: bundle.source,
          channel: bundle.channel ?? 'appchat',
          channelTurnId: message.id,
          createdAt: bundle.createdAt,
          bundle,
        };
      });
    return getActionableDiagnosticRecords(records);
  }, []);

  const copyDiagnosticBundleToClipboard = useCallback(async (
    bundle: TurnDiagnosticBundle,
    copyTarget: unknown,
    opts?: { alert?: boolean },
  ) => {
    const copiedPayload = {
      copiedAt: new Date().toISOString(),
      copyTarget,
      bundle,
    };
    await Clipboard.setStringAsync(JSON.stringify(copiedPayload, null, 2));
    if (opts?.alert !== false) {
      Alert.alert('Copied details', 'Diagnostic details were copied to your clipboard.');
    }
  }, []);

  const sendMessage = useCallback(async (text: string, origin: SendMessageOrigin = { source: 'in_app' }) => {
    if (!text.trim() || isStreaming) return;
    // Intercept /mcp command to open MCP prompt browser
    if (text.trim().toLowerCase().startsWith('/mcp')) {
      setInput('');
      openMcpSheet();
      return;
    }
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content: text.trim() };
    const assistantId = generateId();
    const diagnosticStartedAt = new Date();
    const diagnosticStreamEvents: { type: string; at: string; payload?: unknown }[] = [];
    const diagnosticModelErrors: unknown[] = [];
    const diagnosticRawToolCalls: unknown[] = [];
    const diagnosticWorkingEvents: { message: string; at: string }[] = [];
    hasScrolledRef.current = false;

    const normalizedVoiceText = userMsg.content.toLowerCase();
    const voiceDiagnosticFollowupTarget = origin.source === 'voice' && pendingVoiceDiagnosticCopyRef.current
      ? resolveVoiceDiagnosticFollowupTarget(normalizedVoiceText)
      : null;
    const isVoiceDiagnosticFollowup = !!voiceDiagnosticFollowupTarget;
    if (origin.source === 'voice' && pendingVoiceDiagnosticCopyRef.current && !isVoiceDiagnosticFollowup && !isDiagnosticCopyRequest(userMsg.content)) {
      pendingVoiceDiagnosticCopyRef.current = false;
    }
    if (origin.source === 'voice' && (isDiagnosticCopyRequest(userMsg.content) || isVoiceDiagnosticFollowup)) {
      const records = getDiagnosticRecords();
      let assistantText = '';
      let copiedTurnId: string | null = null;
      let copyError: string | null = null;
      let resolvedTarget = voiceDiagnosticFollowupTarget
        ?? resolveDiagnosticCopyRequestTarget(userMsg.content)
        ?? 'last turn';

      if (records.length === 0) {
        pendingVoiceDiagnosticCopyRef.current = false;
        assistantText = "I don't have any diagnostic details to copy yet.";
      } else if (!isVoiceDiagnosticFollowup && shouldClarifyVoiceDiagnosticTarget(userMsg.content, records)) {
        pendingVoiceDiagnosticCopyRef.current = true;
        assistantText = 'The last failed action, or the last turn?';
      } else {
        pendingVoiceDiagnosticCopyRef.current = false;
        const targetText = resolvedTarget === 'last failed action'
          ? 'copy last failed details'
          : 'copy last turn details';
        const resolution = resolveDiagnosticTargetFromText(records, targetText);
        if (resolution.ok) {
          try {
            copiedTurnId = resolution.record.turnId;
            await copyDiagnosticBundleToClipboard(
              resolution.record.bundle,
              { reason: 'voice_command', requestText: userMsg.content, resolvedTarget },
              { alert: false },
            );
            assistantText = resolvedTarget === 'last failed action'
              ? 'Copied the last failed action details to your clipboard.'
              : 'Copied the last turn details to your clipboard.';
          } catch (error) {
            copyError = error instanceof Error ? error.message : String(error);
            assistantText = 'I found the details, but I could not copy them to the clipboard.';
          }
        } else {
          resolvedTarget = resolvedTarget === 'last failed action' ? 'last failed action' : 'last turn';
          assistantText = resolvedTarget === 'last failed action'
            ? "I don't have a recent failed action to copy."
            : "I couldn't find recent diagnostic details to copy.";
        }
      }

      const finishedAt = new Date();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: assistantText,
        diagnostics: buildTurnDiagnosticBundle({
          turnId: assistantId,
          source: 'voice',
          channel: 'voice',
          requestText: userMsg.content,
          responseText: assistantText,
          selected: {
            mode: coachingModeRef.current,
            model: 'local-runtime',
            profile: 'diagnostic-copy',
          },
          runtimeIntent: 'diagnostic_copy',
          contextPacket: {
            command: 'voice_copy_details',
            resolvedTarget,
            copiedTurnId,
            copyError,
            availableDiagnosticTurns: records.map((record) => ({
              turnId: record.turnId,
              channelTurnId: record.channelTurnId,
              createdAt: record.createdAt,
            })),
          },
          toolResults: [{
            tool: 'clipboard.copy',
            result: copiedTurnId && !copyError ? 'success' : 'none',
            copiedTurnId,
            error: copyError,
          }],
          modelErrors: copyError ? [{ message: copyError }] : [],
          timing: {
            startedAt: diagnosticStartedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - diagnosticStartedAt.getTime(),
          },
          androidState: null,
          recentTurnHistory: messagesRef.current.slice(0, 8).map((message) => ({
            role: message.role,
            content: message.content,
          })),
          voiceTrace: origin.voiceTrace,
        }),
      };
      setMessages(prev => {
        const updated = [assistantMsg, userMsg, ...prev];
        persistChatHistory(updated);
        return updated;
      });
      setInput('');
      setIntegrationError(null);
      setConfirmClear(false);
      if (talkModeRef.current && assistantText.trim()) {
        speakTextRef.current(assistantText, assistantId);
      }
      return;
    }

    setMessages(prev => {
      const updated = [userMsg, ...prev];
      persistChatHistory(updated);
      return updated;
    });
    setInput('');
    setIntegrationError(null);
    setShowTyping(true);
    setIsStreaming(true);
    setConfirmClear(false);

    const fetchAbort = new AbortController();
    chatAbortControllerRef.current = fetchAbort;
    chatRunIdRef.current = null;

    const contextMessages = [userMsg, ...messagesRef.current].slice(0, CONTEXT_WINDOW);
    const apiMessages = contextMessages.map(m => ({ role: m.role, content: m.content })).reverse();
    const buildDiagnostics = (params: {
      responseText?: string;
      executedActions?: ExecutedAction[];
      modelErrors?: unknown[];
      androidState?: unknown;
    }): TurnDiagnosticBundle => {
      const finishedAt = new Date();
      return buildTurnDiagnosticBundle({
        turnId: assistantId,
        source: origin.source === 'voice' ? 'voice' : 'in_app',
        channel: origin.source === 'voice' ? 'voice' : 'appchat',
        requestText: userMsg.content,
        responseText: params.responseText,
        selected: {
          mode: coachingModeRef.current,
          model: 'server-selected',
          profile: 'server-selected',
        },
        runtimeIntent: inferRuntimeIntent(userMsg.content),
        contextPacket: {
          messages: apiMessages,
          sdkSessionId: sdkSessionIdRef.current,
          goals: goalsRef.current,
          stats: statsRef.current,
          commitments: commitmentsRef.current,
          coachingMode: coachingModeRef.current,
          streamEvents: diagnosticStreamEvents.slice(),
        },
        offeredTools: Array.from(new Set((params.executedActions ?? []).map((action) => action.tool))),
        rawToolCalls: diagnosticRawToolCalls.slice(),
        normalizedToolCalls: (params.executedActions ?? []).map((action) => ({
          tool: action.tool,
          result: action.result,
          label: action.label,
          detail: action.detail,
        })),
        toolResults: params.executedActions ?? [],
        modelErrors: params.modelErrors ?? diagnosticModelErrors.slice(),
        timing: {
          startedAt: diagnosticStartedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - diagnosticStartedAt.getTime(),
        },
        androidState: params.androidState ?? {
          workingEvents: diagnosticWorkingEvents.slice(),
          lastWorkingMessage: diagnosticWorkingEvents.length > 0
            ? diagnosticWorkingEvents[diagnosticWorkingEvents.length - 1].message
            : null,
        },
        recentTurnHistory: contextMessages.slice(0, 8).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        voiceTrace: origin.source === 'voice' ? origin.voiceTrace : undefined,
      });
    };

    try {
      const url = new URL('/api/coach/chat', getApiUrl());
      const token = await getAuthToken();
      const streamHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) streamHeaders['Authorization'] = `Bearer ${token}`;
      const response = await expoFetch(url.toString(), {
        method: 'POST',
        headers: streamHeaders,
        body: JSON.stringify({
          messages: apiMessages,
          goals: goalsRef.current,
          stats: statsRef.current,
          history: historyRef.current,
          calendarEvents: calendarEventsRef.current,
          lifeContext: lifeContextRef.current,
          gmailItems: gmailItemsRef.current,
          gmailConnected: gmailConnectedRef.current,
          slackMessages: slackMessagesRef.current,
          slackConnected: slackConnectedRef.current,
          telegramMessages: telegramMessagesRef.current,
          telegramConnected: telegramConnectedRef.current,
          commitments: commitmentsRef.current,
          coachingMode: coachingModeRef.current,
          sdkSessionId: sdkSessionIdRef.current || undefined,
        }),
        signal: fetchAbort.signal,
      });

      const serverRunId = response.headers.get('X-Run-Id');
      if (serverRunId) chatRunIdRef.current = serverRunId;

      if (!response.ok) {
        const rawError = await response.text().catch(() => '');
        let message = `Chat request failed (${response.status})`;
        try {
          const parsed = JSON.parse(rawError);
          if (parsed?.error) message = String(parsed.error);
        } catch {
          if (rawError.trim()) message = rawError.trim().slice(0, 240);
        }
        if (response.status === 401) {
          message = 'You are not signed in. Please sign in again, then try chat.';
        }
        throw new Error(message);
      }

      setShowTyping(false);
      const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '' };
      streamingAssistantIdRef.current = assistantId;

      setMessages(prev => {
        const updated = [assistantMsg, ...prev];
        return updated;
      });

      if (!response.body) throw new Error('No response body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      let executedActions: ExecutedAction[] = [];
      let gotConfirmRequired = false;
      let streamAborted = false;
      let streamErrorMessage = '';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              diagnosticStreamEvents.push({
                type: String(parsed.type || (parsed.content ? 'content' : 'unknown')),
                at: new Date().toISOString(),
                payload: parsed,
              });
              if (parsed.type === 'session_init' && parsed.sdkSessionId) {
                sdkSessionIdRef.current = parsed.sdkSessionId;
                saveCoachSessionId(parsed.sdkSessionId).catch(() => {});
              } else if (parsed.type === 'aborted') {
                streamAborted = true;
                break outer;
              } else if (parsed.type === 'error' || parsed.error) {
                streamErrorMessage = String(parsed.message || parsed.error || 'Jarvis hit a model provider error.');
                diagnosticModelErrors.push(parsed);
                fullContent = `Error: ${streamErrorMessage}`;
                setIsSearchingWeb(false);
                setIsWorkingOnPhone(false);
                setMessages(prev => {
                  const updated = [...prev];
                  const idx = updated.findIndex(m => m.id === assistantId);
                  if (idx !== -1) {
                    updated[idx] = {
                      ...updated[idx],
                      content: fullContent,
                      diagnostics: buildDiagnostics({
                        responseText: fullContent,
                        executedActions,
                        modelErrors: diagnosticModelErrors,
                      }),
                    };
                  }
                  persistChatHistory(updated);
                  return updated;
                });
                break outer;
              } else if (parsed.type === 'confirm_required') {
                gotConfirmRequired = true;
                const pendingConfirm: PendingConfirm = {
                  token: parsed.token,
                  tool: parsed.tool,
                  preview: parsed.preview,
                };
                setMessages(prev => {
                  const updated = [...prev];
                  const idx = updated.findIndex(m => m.id === assistantId);
                  if (idx !== -1) updated[idx] = { ...updated[idx], pendingConfirm };
                  persistChatHistory(updated);
                  return updated;
                });
              } else if (parsed.type === 'searching') {
                setIsSearchingWeb(true);
              } else if (parsed.type === 'mcp_progress') {
                const progressMsg = String(parsed.message || '');
                if (progressMsg) {
                  diagnosticWorkingEvents.push({ message: progressMsg, at: new Date().toISOString() });
                  setIsWorkingOnPhone(true);
                  setPhoneWorkingMessage(progressMsg);
                }
              } else if (parsed.type === 'progress') {
                const progressMsg = String(parsed.message || '');
                if (progressMsg) {
                  diagnosticWorkingEvents.push({ message: progressMsg, at: new Date().toISOString() });
                  setIsWorkingOnPhone(true);
                  setPhoneWorkingMessage(progressMsg);
                }
              } else if (parsed.type === 'working') {
                const progressMsg = String(parsed.message || 'Working on your phone...');
                diagnosticWorkingEvents.push({ message: progressMsg, at: new Date().toISOString() });
                setIsWorkingOnPhone(true);
                setPhoneWorkingMessage(progressMsg);
              } else if (parsed.type === 'background_job' && parsed.jobId) {
                const jobId = String(parsed.jobId);
                const agentType = String(parsed.agentType || 'background');
                const jobAction: ExecutedAction = {
                  tool: 'queue_background_job',
                  result: 'success',
                  label: `${agentType} job queued (${jobId.slice(0, 8)})`,
                  buttonLabel: 'Open Inbox',
                  url: 'app://inbox',
                };
                executedActions = [
                  ...executedActions.filter((action) => action.tool !== 'queue_background_job' || action.label !== jobAction.label),
                  jobAction,
                ];
                queryClient.invalidateQueries({ queryKey: ['/api/agent-jobs/active'] });
                setMessages(prev => {
                  const updated = [...prev];
                  const idx = updated.findIndex(m => m.id === assistantId);
                  if (idx !== -1) {
                    updated[idx] = { ...updated[idx], executedActions };
                    persistChatHistory(updated);
                  }
                  return updated;
                });
              } else if (parsed.type === 'integration_error' && parsed.integration) {
                setIntegrationError({ integration: parsed.integration });
              } else if (parsed.type === 'actions' && (Array.isArray(parsed.actions) || Array.isArray(parsed.executedActions) || Array.isArray(parsed.attachments))) {
                const nextActions = parsed.actions ?? parsed.executedActions ?? [];
                diagnosticRawToolCalls.push({ event: 'actions', actions: nextActions, attachments: parsed.attachments });
                executedActions = nextActions;
                const parsedAtts = Array.isArray(parsed.attachments) ? parsed.attachments as import('@/lib/storage').McpAttachment[] : undefined;
                setMessages(prev => {
                  const updated = [...prev];
                  const idx = updated.findIndex(m => m.id === assistantId);
                  if (idx !== -1) {
                    const update: Partial<import('@/lib/storage').ChatMessage> = { executedActions };
                    if (parsedAtts && parsedAtts.length > 0) {
                      const existing = updated[idx].mcpAttachments ?? [];
                      update.mcpAttachments = [...existing, ...parsedAtts];
                    }
                    updated[idx] = { ...updated[idx], ...update };
                    persistChatHistory(updated);
                  }
                  return updated;
                });
                queryClient.invalidateQueries({ queryKey: ['/api/data/plans'] });
                queryClient.invalidateQueries({ queryKey: ['/api/data/goals'] });
                queryClient.invalidateQueries({ queryKey: ['/api/data/brain-dump-inbox'] });
                queryClient.invalidateQueries({ queryKey: ['/api/data/life-context'] });
              } else if (parsed.content) {
                setIsSearchingWeb(false);
                setIsWorkingOnPhone(false);
                fullContent += parsed.content;
                const captured = fullContent;
                setMessages(prev => {
                  const updated = [...prev];
                  const idx = updated.findIndex(m => m.id === assistantId);
                  if (idx !== -1) updated[idx] = { ...updated[idx], content: captured };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }

      chatAbortControllerRef.current = null;
      chatRunIdRef.current = null;
      streamingAssistantIdRef.current = null;
      setIsStreaming(false);
      setIsSearchingWeb(false);
      setIsWorkingOnPhone(false);

      if (streamAborted) {
        if (fullContent.length > 0) {
          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === assistantId);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                stopped: true,
                diagnostics: buildDiagnostics({
                  responseText: fullContent,
                  executedActions,
                  modelErrors: diagnosticModelErrors,
                }),
              };
              persistChatHistory(updated);
              return updated;
            }
            return prev;
          });
        }
        return;
      }

      if (gotConfirmRequired) {
        return;
      }

      if (streamErrorMessage) {
        return;
      }

      const finalContent = fullContent.trim().length > 0
        ? fullContent
        : 'Error: Jarvis did not return a final response. Please retry; if this repeats, check the selected model provider runtime.';
      const finalActions = executedActions;
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.id === assistantId);
        if (idx !== -1) {
          updated[idx] = {
            ...updated[idx],
            content: finalContent,
            executedActions: finalActions.length > 0 ? finalActions : undefined,
            diagnostics: buildDiagnostics({
              responseText: finalContent,
              executedActions: finalActions,
              modelErrors: diagnosticModelErrors,
            }),
          };
        }
        persistChatHistory(updated);
        return updated;
      });

      // Auto-speak the reply in Talk Mode once streaming finishes.
      if (talkModeRef.current && finalContent.trim()) {
        speakTextRef.current(finalContent, assistantId);
      }

      // If Jarvis just sent a channel connect link, start polling for connection.
      // When the channel connects, a confirmation message is injected into the chat.
      const connectAction = finalActions.find(
        a => a.tool === 'connect_channel' && a.result === 'success' && a.channel
      );
      if (connectAction?.channel) {
        startChannelConnectPoll(connectAction.channel, assistantId);
      }

      try {
        const suggestUrl = new URL('/api/coach/suggestions', getApiUrl());
        const suggestRes = await authFetch(suggestUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lastAssistantMessage: finalContent,
            lastUserMessage: userMsg.content,
            goals: goalsRef.current,
            coachingMode: coachingModeRef.current,
          }),
        });
        const suggestData = await suggestRes.json();
        const actions: CoachAction[] = suggestData.actions || [];
        const followups: string[] = suggestData.followups || [];

        setMessages(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(m => m.id === assistantId);
          if (idx !== -1) updated[idx] = { ...updated[idx], actions, followups };
          persistChatHistory(updated);
          return updated;
        });
      } catch {}

      try {
        const extractUrl = new URL('/api/commitments/extract', getApiUrl());
        authFetch(extractUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text.trim() }),
        }).then(async (r) => {
          const data = await r.json();
          if (data.hasCommitment) {
            fetchCommitments();
          }
        }).catch(() => {});
      } catch {}


      const recentMessages = [userMsg, ...messagesRef.current].slice(0, 6);
      const extractMessages = recentMessages.map(m => ({ role: m.role, content: m.content })).reverse();
      authFetch(new URL('/api/memories/extract', getApiUrl()).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: extractMessages }),
      }).catch(() => {});

    } catch (error) {
      chatAbortControllerRef.current = null;
      chatRunIdRef.current = null;
      setShowTyping(false);
      setIsStreaming(false);
      setIsSearchingWeb(false);
      setIsWorkingOnPhone(false);
      if (error instanceof Error && (error.name === 'AbortError' || error.message?.includes('aborted'))) {
        streamingAssistantIdRef.current = null;
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === assistantId);
          if (idx !== -1 && prev[idx].content.length > 0) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              stopped: true,
              diagnostics: updated[idx].diagnostics ?? buildDiagnostics({
                responseText: updated[idx].content,
                modelErrors: [error instanceof Error ? { message: error.message, name: error.name } : String(error)],
              }),
            };
            persistChatHistory(updated);
            return updated;
          }
          return prev;
        });
        return;
      }
      // If Jarvis already sent partial content (e.g. a multi-step phone task that completed
      // but whose SSE stream was cut by a network hiccup), keep that content rather than
      // replacing the whole message with a generic error. Only show the error string when
      // nothing was received at all.
      setMessages(prev => {
        const existing = prev.find(m => m.id === assistantId);
        const alreadyHasContent = existing && existing.content && existing.content.length > 0;
        if (alreadyHasContent) {
          // Keep whatever partial content arrived — the task mostly worked
          const updated = prev.map((message) => message.id === assistantId
            ? {
                ...message,
                diagnostics: message.diagnostics ?? buildDiagnostics({
                  responseText: message.content,
                  modelErrors: [error instanceof Error ? { message: error.message, name: error.name } : String(error)],
                }),
              }
            : message);
          persistChatHistory(updated);
          return updated;
        }
        // If phone actions were underway when the stream dropped, the task likely
        // completed (the notification arrived) but the response text was lost when
        // you switched apps. Show a contextual message instead of a generic error.
        const errContent = isWorkingOnPhone
          ? "Your phone task finished — the connection dropped when you switched apps. If you got a notification, it completed successfully. Ask me to recap what I did and I'll tell you."
          : error instanceof Error && error.message
            ? error.message
            : 'Sorry, I had trouble connecting. Please try again.';
        const errMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content: errContent,
          diagnostics: buildDiagnostics({
            responseText: errContent,
            modelErrors: [error instanceof Error ? { message: error.message, name: error.name } : String(error)],
          }),
        };
        const updated = [errMsg, ...prev.filter(m => m.id !== assistantId)];
        persistChatHistory(updated);
        return updated;
      });
    }
  }, [copyDiagnosticBundleToClipboard, getDiagnosticRecords, isStreaming, openMcpSheet]);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const handleCopyDiagnostics = useCallback(async (
    message: ChatMessage,
    target?: { reason: 'message' | 'action'; actionIndex?: number; action?: ExecutedAction },
  ) => {
    const fallbackBundle = message.diagnostics ?? buildTurnDiagnosticBundle({
      turnId: message.id,
      source: 'in_app',
      channel: 'appchat',
      requestText: messagesRef.current.find((candidate) => candidate.role === 'user')?.content,
      responseText: message.content,
      selected: {
        mode: coachingModeRef.current,
        model: 'unknown',
        profile: 'unknown',
      },
      runtimeIntent: inferRuntimeIntent(message.content),
      contextPacket: {
        message,
        recentMessages: messagesRef.current.slice(0, 8).map((candidate) => ({
          role: candidate.role,
          content: candidate.content,
        })),
      },
      offeredTools: message.executedActions?.map((action) => action.tool) ?? [],
      normalizedToolCalls: message.executedActions ?? [],
      toolResults: message.executedActions ?? [],
      modelErrors: message.content.trim().toLowerCase().startsWith('error:') ? [{ message: message.content }] : [],
      timing: { startedAt: new Date().toISOString() },
      androidState: null,
      recentTurnHistory: messagesRef.current.slice(0, 8).map((candidate) => ({
        role: candidate.role,
        content: candidate.content,
      })),
    });
    await copyDiagnosticBundleToClipboard(fallbackBundle, target ?? { reason: 'message' });
  }, [copyDiagnosticBundleToClipboard]);

  const handleStop = useCallback(async () => {
    const runId = chatRunIdRef.current;
    if (runId) {
      try {
        await apiRequest('POST', '/api/chat/abort', { runId });
      } catch {}
    }
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    chatRunIdRef.current = null;
    setIsStreaming(false);
    setShowTyping(false);
    setIsSearchingWeb(false);
    setIsWorkingOnPhone(false);
  }, []);

  const handleConfirmAction = useCallback(async (msgId: string, confirmed: boolean) => {
    const msg = messagesRef.current.find(m => m.id === msgId);
    if (!msg?.pendingConfirm) return;
    const { token, tool } = msg.pendingConfirm;
    const confirmStartedAt = new Date();
    const buildConfirmedActionDiagnostics = (input: {
      responseText: string;
      executedActions: ExecutedAction[];
      modelErrors?: unknown[];
      apiResult?: unknown;
    }): TurnDiagnosticBundle => {
      const finishedAt = new Date();
      const recentMessages = messagesRef.current.slice(0, 8).map((candidate) => ({
        role: candidate.role,
        content: candidate.content,
      }));
      const requestText = messagesRef.current.find((candidate) => candidate.role === 'user')?.content ?? msg.content;
      return buildTurnDiagnosticBundle({
        turnId: msgId,
        source: 'in_app',
        channel: 'appchat',
        requestText,
        responseText: input.responseText,
        selected: {
          mode: coachingModeRef.current,
          model: 'server-selected',
          profile: 'confirmed-action',
        },
        runtimeIntent: inferRuntimeIntent(requestText),
        contextPacket: {
          pendingConfirm: msg.pendingConfirm,
          apiResult: input.apiResult ?? null,
          recentMessages,
        },
        offeredTools: [tool],
        rawToolCalls: [{ token, tool, preview: msg.pendingConfirm?.preview }],
        normalizedToolCalls: input.executedActions.map((action) => ({
          tool: action.tool,
          result: action.result,
          label: action.label,
          detail: action.detail,
        })),
        toolResults: input.executedActions,
        modelErrors: input.modelErrors ?? [],
        timing: {
          startedAt: confirmStartedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - confirmStartedAt.getTime(),
        },
        androidState: null,
        recentTurnHistory: recentMessages,
      });
    };

    if (!confirmed) {
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.id === msgId);
        if (idx !== -1) {
          updated[idx] = {
            ...updated[idx],
            pendingConfirm: undefined,
            content: 'Got it — I\'ll leave that for now.',
          };
        }
        persistChatHistory(updated);
        return updated;
      });
      try {
        const declineUrl = new URL('/api/coach/decline-action', getApiUrl());
        const res = await authFetch(declineUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.content) {
            setMessages(prev => {
              const updated = [...prev];
              const idx = updated.findIndex(m => m.id === msgId);
              if (idx !== -1) updated[idx] = { ...updated[idx], content: data.content };
              persistChatHistory(updated);
              return updated;
            });
          }
        }
      } catch {}
      return;
    }

    try {
      const url = new URL('/api/coach/execute-confirmed', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        const failureContent = data.error || 'Could not execute that action. The confirmation may have expired.';
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
        return;
      }
      const execAction: ExecutedAction = {
        tool,
        result: data.result || 'error',
        label: data.label || (data.result === 'success' ? 'Done' : 'Failed'),
      };
      const successContent = data.result === 'success'
        ? (tool === 'send_email' ? `Email sent successfully.` : tool === 'connected_accounts_execute' ? `Connected account action completed successfully.` : `Command executed successfully.`)
        : `Action failed: ${data.detail || data.error || 'Unknown error'}`;
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
    }
  }, []);

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
          editable={!isStreaming && !isRecording && !isTranscribing && !isBaseLoading}
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
