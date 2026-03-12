import React, { useState, useCallback, useRef, useEffect, useContext } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import Colors from '@/constants/colors';
import MarkdownText from '@/components/MarkdownText';
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
  getLifeContext,
  type Goal,
  type UserStats,
  type ChatMessage,
  type CoachAction,
  type LifeContext,
} from '@/lib/storage';
import { getApiUrl } from '@/lib/query-client';
import { authFetch, getAuthToken } from '@/lib/auth-context';
import { Linking } from 'react-native';

interface EmailSuggestion {
  title: string;
  emailSubject: string;
  emailFrom: string;
  accountEmail: string;
  goalTitle: string;
  reason: string;
}

const SUGGESTED_PROMPTS = [
  "How am I doing overall?",
  "What should I focus on this week?",
  "Help me with my financial goals",
  "I'm struggling to stay consistent",
];

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

interface MessageBubbleProps {
  message: ChatMessage;
  isFirst: boolean;
  isLastAssistant: boolean;
  goals: Goal[];
  onFollowup: (text: string) => void;
  onSpeak?: (text: string) => void;
  isSpeaking?: boolean;
  isStreaming?: boolean;
}

function MessageBubble({ message, isFirst, isLastAssistant, goals, onFollowup, onSpeak, isSpeaking, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [addedMap, setAddedMap] = useState<Record<string, boolean>>({});
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'reconnect'>('idle');
  const [gmailUrl, setGmailUrl] = useState<string | null>(null);

  const parsedDraft = !isUser ? parseEmailDraft(message.content) : null;

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
    setAddedMap(prev => ({ ...prev, [key]: true }));
    try {
      if (action.type === 'task') {
        const loadedGoals = await getGoals();
        const plan = await getTodayPlan(loadedGoals);
        const newTask = {
          id: generateId(),
          title: action.title,
          category: action.category as any,
          completed: false,
          priority: (action.priority || 'medium') as any,
          description: action.description,
          goalId: undefined,
        };
        const updated = { ...plan, tasks: [...plan.tasks, newTask] };
        await savePlan(updated);
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
    } catch {}
  }, [addedMap]);

  return (
    <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
      {!isUser && isFirst && (
        <View style={styles.coachLabel}>
          <Ionicons name="sparkles-outline" size={12} color={Colors.secondary} />
          <Text style={styles.coachLabelText}>GamePlan Coach</Text>
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <MarkdownText
          text={message.content}
          isUser={isUser}
        />
      </View>

      {!isUser && isLastAssistant && !isStreaming && message.content.length > 0 && onSpeak && (
        <Pressable
          style={styles.speakBtn}
          onPress={() => onSpeak(message.content)}
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
            return (
              <Pressable
                key={key}
                style={[styles.actionPill, added && styles.actionPillAdded]}
                onPress={() => handleAddAction(action, key)}
              >
                <Ionicons
                  name={added ? 'checkmark' : (action.type === 'task' ? 'add-circle-outline' : 'flag-outline')}
                  size={13}
                  color={added ? Colors.success : Colors.primary}
                />
                <Text style={[styles.actionPillText, added && styles.actionPillTextAdded]}>
                  {added ? 'Added!' : (action.type === 'task' ? `Add: ${action.title}` : `Set goal: ${action.title}`)}
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stats, setStats] = useState<UserStats>({ streak: 0, totalCompleted: 0, bestStreak: 0 });
  const [history, setHistory] = useState<any[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<{ title: string; time: string }[]>([]);
  const [lifeContext, setLifeContext] = useState<LifeContext | null>(null);
  const [gmailItems, setGmailItems] = useState<{ subject: string; snippet: string; date: string; from?: string }[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [slackMessages, setSlackMessages] = useState<any[]>([]);
  const [slackConnected, setSlackConnected] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [emailSuggestions, setEmailSuggestions] = useState<EmailSuggestion[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [addedSuggestions, setAddedSuggestions] = useState<Record<number, boolean>>({});
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isTTSLoading, setIsTTSLoading] = useState(false);
  const speakingTextRef = useRef<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const webAudioRef = useRef<HTMLAudioElement | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const isSpeakingRef = useRef(false);
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<Blob[]>([]);
  const sendMessageRef = useRef<(text: string) => void>(() => {});
  const messagesRef = useRef<ChatMessage[]>([]);
  const hasScrolledRef = useRef(false);
  const initialScanDoneRef = useRef(false);
  const [isBaseLoading, setIsBaseLoading] = useState(true);
  const [isEmailLoading, setIsEmailLoading] = useState(true);
  const gmailItemsRef = useRef<typeof gmailItems>([]);
  const gmailConnectedRef = useRef(false);
  const slackMessagesRef = useRef<any[]>([]);
  const slackConnectedRef = useRef(false);
  const calendarEventsRef = useRef<typeof calendarEvents>([]);
  const goalsRef = useRef<typeof goals>([]);
  const statsRef = useRef<typeof stats>({ streak: 0, totalCompleted: 0, bestStreak: 0 });
  const historyRef = useRef<typeof history>([]);
  const lifeContextRef = useRef<typeof lifeContext>(null);
  const flatListRef = useRef<FlatList>(null);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const tabBarCtx = useContext(BottomTabBarHeightContext);
  const tabBarHeight = tabBarCtx ?? (Platform.OS === 'web' ? 84 : 50 + insets.bottom);
  const micPulse = useSharedValue(1);

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

  const micPulseStyle = useAnimatedStyle(() => ({
    opacity: micPulse.value,
  }));

  useEffect(() => { gmailItemsRef.current = gmailItems; }, [gmailItems]);
  useEffect(() => { gmailConnectedRef.current = gmailConnected; }, [gmailConnected]);
  useEffect(() => { slackMessagesRef.current = slackMessages; }, [slackMessages]);
  useEffect(() => { slackConnectedRef.current = slackConnected; }, [slackConnected]);
  useEffect(() => { calendarEventsRef.current = calendarEvents; }, [calendarEvents]);
  useEffect(() => { goalsRef.current = goals; }, [goals]);
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { lifeContextRef.current = lifeContext; }, [lifeContext]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
      speakAbortRef.current?.abort();
      if (Platform.OS === 'web') {
        webAudioRef.current?.pause();
        webAudioRef.current = null;
      }
    };
  }, []);

  const transcribeAndSend = useCallback(async (base64: string) => {
    setIsTranscribing(true);
    try {
      const url = new URL('/api/coach/transcribe', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64 }),
      });
      const data = await res.json();
      if (data.text && data.text.trim()) {
        setIsTranscribing(false);
        setInput(data.text);
        sendMessageRef.current(data.text);
      } else {
        setIsTranscribing(false);
      }
    } catch (error) {
      console.error('Failed to transcribe:', error);
      setIsTranscribing(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        webChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) webChunksRef.current.push(e.data);
        };
        recorder.start();
        webRecorderRef.current = recorder;
        setIsRecording(true);
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Microphone access is needed to use voice input.');
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        recordingRef.current = recording;
        setIsRecording(true);
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      if (Platform.OS === 'web') {
        Alert.alert('Permission Required', 'Microphone access is needed to use voice input.');
      }
    }
  }, []);

  const stopRecordingAndSend = useCallback(async () => {
    setIsRecording(false);

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
      transcribeAndSend(base64);
    } else {
      const recording = recordingRef.current;
      if (!recording) return;
      recordingRef.current = null;

      try {
        await recording.stopAndUnloadAsync();
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const uri = recording.getURI();
        if (!uri) throw new Error('No recording URI');
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        transcribeAndSend(base64);
      } catch (error) {
        console.error('Failed to process recording:', error);
        setIsTranscribing(false);
      }
    }
  }, [transcribeAndSend]);

  const stopSpeaking = useCallback(() => {
    speakAbortRef.current?.abort();
    speakAbortRef.current = null;
    isSpeakingRef.current = false;
    speakingTextRef.current = null;
    if (Platform.OS === 'web') {
      webAudioRef.current?.pause();
      webAudioRef.current = null;
    } else {
      soundRef.current?.stopAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setIsSpeaking(false);
    setIsTTSLoading(false);
  }, []);

  const speakText = useCallback(async (text: string) => {
    if (isSpeaking && speakingTextRef.current === text) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    isSpeakingRef.current = true;
    speakingTextRef.current = text;
    setIsSpeaking(true);
    setIsTTSLoading(true);
    try {
      const abortController = new AbortController();
      speakAbortRef.current = abortController;
      const url = new URL('/api/coach/speak', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 4000) }),
        signal: abortController.signal,
      });
      if (!isSpeakingRef.current) return;
      const data = await res.json();
      setIsTTSLoading(false);
      if (!data.audio || !isSpeakingRef.current) {
        isSpeakingRef.current = false;
        speakingTextRef.current = null;
        setIsSpeaking(false);
        return;
      }

      if (Platform.OS === 'web') {
        const audioEl = new window.Audio(`data:audio/mp3;base64,${data.audio}`);
        webAudioRef.current = audioEl;
        audioEl.onended = () => {
          isSpeakingRef.current = false;
          speakingTextRef.current = null;
          setIsSpeaking(false);
        };
        audioEl.onerror = () => {
          isSpeakingRef.current = false;
          speakingTextRef.current = null;
          setIsSpeaking(false);
        };
        await audioEl.play();
      } else {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const tmpUri = FileSystem.cacheDirectory + 'coach_speech.mp3';
        await FileSystem.writeAsStringAsync(tmpUri, data.audio, { encoding: FileSystem.EncodingType.Base64 });
        const { sound } = await Audio.Sound.createAsync(
          { uri: tmpUri },
          { shouldPlay: true }
        );
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if ('didJustFinish' in status && status.didJustFinish) {
            isSpeakingRef.current = false;
            speakingTextRef.current = null;
            setIsSpeaking(false);
          }
        });
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Failed to speak:', error);
      isSpeakingRef.current = false;
      speakingTextRef.current = null;
      setIsSpeaking(false);
      setIsTTSLoading(false);
    }
  }, [isSpeaking, stopSpeaking]);

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

  const loadAll = useCallback(async () => {
    setIsBaseLoading(true);
    setIsEmailLoading(true);

    let loadedGoals: Goal[] = [];
    try {
      const [lg, loadedStats, loadedHistory, savedMessages, lc] = await Promise.all([
        getGoals(),
        getStats(),
        getCompletionHistory(),
        getChatHistory(),
        getLifeContext(),
      ]);
      loadedGoals = lg;
      setGoals(lg);
      setStats(loadedStats);
      setHistory(loadedHistory);
      setMessages(savedMessages);
      setLifeContext(lc);
    } finally {
      setIsBaseLoading(false);
    }

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

      await Promise.allSettled([fetchSource('google'), fetchSource('outlook'), fetchGmail(), fetchSlack()]);
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
  }, []));

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content: text.trim() };
    const assistantId = generateId();

    setMessages(prev => {
      const updated = [userMsg, ...prev];
      saveChatHistory(updated);
      return updated;
    });
    setInput('');
    setShowTyping(true);
    setIsStreaming(true);
    setConfirmClear(false);

    try {
      const contextMessages = [userMsg, ...messagesRef.current].slice(0, CONTEXT_WINDOW);
      const apiMessages = contextMessages.map(m => ({ role: m.role, content: m.content })).reverse();

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
        }),
      });

      setShowTyping(false);
      const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '' };

      setMessages(prev => {
        const updated = [assistantMsg, ...prev];
        return updated;
      });

      if (!response.body) throw new Error('No response body');
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
                  const idx = updated.findIndex(m => m.id === assistantId);
                  if (idx !== -1) updated[idx] = { ...updated[idx], content: captured };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }

      setIsStreaming(false);

      const finalContent = fullContent;
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.id === assistantId);
        if (idx !== -1) updated[idx] = { ...updated[idx], content: finalContent };
        saveChatHistory(updated);
        return updated;
      });

      try {
        const suggestUrl = new URL('/api/coach/suggestions', getApiUrl());
        const suggestRes = await authFetch(suggestUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastAssistantMessage: finalContent, goals: goalsRef.current }),
        });
        const suggestData = await suggestRes.json();
        const actions: CoachAction[] = suggestData.actions || [];
        const followups: string[] = suggestData.followups || [];

        setMessages(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(m => m.id === assistantId);
          if (idx !== -1) updated[idx] = { ...updated[idx], actions, followups };
          saveChatHistory(updated);
          return updated;
        });
      } catch {}

    } catch (error) {
      setShowTyping(false);
      setIsStreaming(false);
      const errMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: 'Sorry, I had trouble connecting. Please try again.',
      };
      setMessages(prev => {
        const updated = [errMsg, ...prev.filter(m => m.id !== assistantId)];
        saveChatHistory(updated);
        return updated;
      });
    }
  }, [isStreaming]);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const handleClearChat = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await clearChatHistory();
    setMessages([]);
    setConfirmClear(false);
  }, [confirmClear]);

  const lastAssistantId = messages.find(m => m.role === 'assistant')?.id;
  const totalMessages = messages.length;
  const showDivider = totalMessages > CONTEXT_WINDOW;

  const listData: (ChatMessage | { type: 'divider'; id: string })[] = showDivider
    ? [
        ...messages.slice(0, CONTEXT_WINDOW),
        { type: 'divider' as const, id: 'divider' },
        ...messages.slice(CONTEXT_WINDOW),
      ]
    : messages;

  const renderItem = useCallback(({ item, index }: { item: ChatMessage | { type: 'divider'; id: string }; index: number }) => {
    if ('type' in item && item.type === 'divider') {
      return (
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>Earlier messages not sent to coach</Text>
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
      />
    );
  }, [listData, lastAssistantId, goals, sendMessage, speakText, isSpeaking, isStreaming]);

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
            <Text style={styles.scanLoadingText}>No task suggestions found. Tap "Scan again" to retry.</Text>
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
          <Text style={styles.headerTitle}>Coach</Text>
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
            <Text style={styles.emptyTitle}>Your AI Coach</Text>
            <Text style={styles.emptySubtitle}>Ask anything about your goals, habits, and progress.</Text>
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
            ListHeaderComponent={showTyping ? <TypingDots /> : null}
            ListFooterComponent={gmailConnected ? renderInboxSection() : null}
          />
        )}
      </View>

      <View style={[styles.inputContainer, { paddingBottom: tabBarHeight + 8 }]}>
        <Pressable
          style={[styles.micBtn, isRecording && styles.micBtnRecording, isBaseLoading && { opacity: 0.4 }]}
          onPress={isSpeaking ? stopSpeaking : isRecording ? stopRecordingAndSend : startRecording}
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
          placeholder={isBaseLoading ? "Loading your context\u2026" : isRecording ? "Listening..." : isTranscribing ? "Transcribing..." : "Message your coach..."}
          placeholderTextColor={isRecording ? '#EF4444' : Colors.textSecondary}
          multiline
          maxLength={1000}
          editable={!isStreaming && !isRecording && !isTranscribing && !isBaseLoading}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={() => sendMessage(input)}
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || isStreaming || isBaseLoading) && styles.sendBtnDisabled]}
          onPress={() => sendMessage(input)}
          disabled={!input.trim() || isStreaming || isBaseLoading}
        >
          {isStreaming ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="arrow-up" size={18} color="#fff" />
          )}
        </Pressable>
      </View>
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
  actionPillText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  actionPillTextAdded: {
    color: Colors.success,
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
  speakBtn: {
    marginTop: 4,
    padding: 6,
    alignSelf: 'flex-start',
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
});
