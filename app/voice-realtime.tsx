import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Platform,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Alert,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  AudioQuality,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { authFetch } from '@/lib/auth-context';
import { cancelAndroidNativeSpeechRecognition, recognizeAndroidSpeechOnce } from '@/lib/android-daemon-native';

type SpeechModule = {
  stop: () => Promise<void>;
  speak: (text: string, options?: {
    rate?: number;
    pitch?: number;
    onDone?: () => void;
    onError?: (error: unknown) => void;
    onStopped?: () => void;
  }) => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Speech = require('expo-speech') as SpeechModule;

type SessionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'ended';

interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
}

interface CodexVoiceTurnResponse {
  transcript?: string;
  reply?: string;
  sdkSessionId?: string;
  error?: string;
  code?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read audio blob'));
    reader.onloadend = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      resolve(value.includes(',') ? value.split(',').pop() || '' : value);
    };
    reader.readAsDataURL(blob);
  });
}

// ── Waveform Bars Component ────────────────────────────────────────────────

const BAR_COUNT = 24;
const BAR_MIN_H = 3;
const BAR_MAX_H = 44;

// Deterministic per-bar multipliers so bars look natural, not uniform
const BAR_MULTIPLIERS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const pos = i / (BAR_COUNT - 1); // 0..1
  // Bell curve peaking in the middle
  const bell = Math.exp(-Math.pow((pos - 0.5) * 3, 2));
  // Add some variance
  const hash = Math.sin(i * 2.3) * 0.5 + 0.5;
  return 0.4 + bell * 0.4 + hash * 0.2;
});

interface WaveformBarsProps {
  color: string;
  ampRef: React.MutableRefObject<number>;
  state: SessionState;
}

function WaveformBars({ color, ampRef, state }: WaveformBarsProps) {
  const barAnims = useRef<Animated.Value[]>(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(BAR_MIN_H))
  ).current;

  const breatheRef = useRef<Animated.CompositeAnimation | null>(null);
  const frameRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (breatheRef.current) {
      breatheRef.current.stop();
      breatheRef.current = null;
    }
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (state === 'idle' || state === 'ended' || state === 'connecting') {
      barAnims.forEach(b => Animated.timing(b, { toValue: BAR_MIN_H, duration: 300, useNativeDriver: false }).start());
      return;
    }

    if (state === 'thinking') {
      // Gentle uniform breathe
      const breathe = () => {
        const animations = barAnims.map((b, i) =>
          Animated.sequence([
            Animated.delay(i * 30),
            Animated.timing(b, { toValue: BAR_MIN_H + 8, duration: 700, useNativeDriver: false }),
            Animated.timing(b, { toValue: BAR_MIN_H + 2, duration: 700, useNativeDriver: false }),
          ])
        );
        breatheRef.current = Animated.parallel(animations);
        breatheRef.current.start(({ finished }) => {
          if (finished && stateRef.current === 'thinking') breathe();
        });
      };
      breathe();
      return;
    }

    // Active states (listening / speaking / muted) — drive from amplitude
    let lastFrame = 0;
    const FRAME_MS = 50; // 20fps update

    const tick = (ts: number) => {
      if (ts - lastFrame >= FRAME_MS) {
        lastFrame = ts;
        const amp = ampRef.current;
        barAnims.forEach((b, i) => {
          const m = BAR_MULTIPLIERS[i];
          let target: number;
          if (state === 'muted') {
            target = BAR_MIN_H;
          } else {
            // Add per-bar jitter so wave looks natural
            const jitter = (Math.random() * 0.3 + 0.85);
            target = BAR_MIN_H + (BAR_MAX_H - BAR_MIN_H) * amp * m * jitter;
          }
          Animated.timing(b, {
            toValue: Math.max(BAR_MIN_H, Math.min(BAR_MAX_H, target)),
            duration: FRAME_MS,
            useNativeDriver: false,
          }).start();
        });
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [state]);

  return (
    <View style={waveStyles.container}>
      {barAnims.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            waveStyles.bar,
            {
              height: anim,
              backgroundColor: color,
              opacity: 0.7 + BAR_MULTIPLIERS[i] * 0.3,
            },
          ]}
        />
      ))}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: BAR_MAX_H + 8,
    marginVertical: 8,
  },
  bar: {
    width: 4,
    borderRadius: 2,
    minHeight: BAR_MIN_H,
  },
});

// ── State label config ────────────────────────────────────────────────────────
const STATE_CONFIG: Record<SessionState, { label: string; color: string }> = {
  idle:       { label: 'Tap to speak',   color: Colors.textTertiary },
  connecting: { label: 'Connecting…',    color: Colors.textSecondary },
  listening:  { label: 'Listening',      color: Colors.cyan },
  thinking:   { label: 'Thinking…',      color: Colors.violet },
  speaking:   { label: 'Speaking',       color: Colors.violet },
  muted:      { label: 'Muted',          color: Colors.warning },
  ended:      { label: 'Session ended',  color: Colors.textTertiary },
};

const CODEX_VOICE_TURN_RECORDING_MS = 5000;

// ── Main Component ────────────────────────────────────────────────────────────

export default function VoiceRealtimeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [state, setState] = useState<SessionState>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentSpeech, setCurrentSpeech] = useState('');
  const [muted, setMuted] = useState(false);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [codexSessionId, setCodexSessionId] = useState<string | null>(null);

  // Amplitude ref — written at ~20fps, read by WaveformBars
  const ampRef = useRef(0);

  // ── Web recording refs ───────────────────────────────────────────────────
  const localStreamRef = useRef<MediaStream | null>(null);
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<Blob[]>([]);
  const webAnalyserRef = useRef<AnalyserNode | null>(null);
  const webAmpFrameRef = useRef<number | null>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  // ── Native refs ──────────────────────────────────────────────────────────
  const nativeRecorder = useAudioRecorder({
    extension: '.wav',
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 384000,
    isMeteringEnabled: true,
    android: { outputFormat: 'default', audioEncoder: 'default' },
    ios: { audioQuality: AudioQuality.LOW, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
    web: { mimeType: 'audio/webm', bitsPerSecond: 48000 },
  });
  const currentAssistantTextRef = useRef('');

  // Metering loop for native mic amplitude
  const meterLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Reanimated (orb ring pulse only) ─────────────────────────────────────
  const ring1Scale = useSharedValue(1);
  const ring2Scale = useSharedValue(1);
  const ring1Opacity = useSharedValue(0);
  const ring2Opacity = useSharedValue(0);

  const scrollRef = useRef<ScrollView>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const codexSessionIdRef = useRef(codexSessionId);
  codexSessionIdRef.current = codexSessionId;

  useEffect(() => {
    cancelAnimation(ring1Scale);
    cancelAnimation(ring2Scale);

    if (state === 'listening') {
      ring1Opacity.value = withRepeat(
        withSequence(withTiming(0.4, { duration: 0 }), withTiming(0, { duration: 1200 })),
        -1, false
      );
      ring1Scale.value = withRepeat(
        withSequence(withTiming(1, { duration: 0 }), withTiming(1.6, { duration: 1200, easing: Easing.out(Easing.ease) })),
        -1, false
      );
      ring2Opacity.value = withRepeat(
        withSequence(withTiming(0, { duration: 600 }), withTiming(0.3, { duration: 0 }), withTiming(0, { duration: 1200 })),
        -1, false
      );
      ring2Scale.value = withRepeat(
        withSequence(withTiming(1, { duration: 600 }), withTiming(1, { duration: 0 }), withTiming(1.8, { duration: 1200, easing: Easing.out(Easing.ease) })),
        -1, false
      );
    } else if (state === 'speaking') {
      ring1Opacity.value = withRepeat(
        withSequence(withTiming(0.25, { duration: 0 }), withTiming(0, { duration: 800 })),
        -1, false
      );
      ring1Scale.value = withRepeat(
        withSequence(withTiming(1, { duration: 0 }), withTiming(1.5, { duration: 800, easing: Easing.out(Easing.ease) })),
        -1, false
      );
      ring2Opacity.value = withTiming(0, { duration: 300 });
    } else {
      ring1Opacity.value = withTiming(0, { duration: 300 });
      ring2Opacity.value = withTiming(0, { duration: 300 });
    }
  }, [state]);

  const ring1Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring1Scale.value }],
    opacity: ring1Opacity.value,
  }));
  const ring2Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring2Scale.value }],
    opacity: ring2Opacity.value,
  }));

  // ── Web amplitude metering via AnalyserNode ───────────────────────────────
  const startWebAmpMeter = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      webAudioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      webAnalyserRef.current = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        // Only drive waveform from mic while listening — speaking uses PCM delta amplitude
        if (stateRef.current === 'listening') {
          analyser.getByteFrequencyData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i];
          ampRef.current = Math.min(1, (sum / buf.length) / 128);
        }
        webAmpFrameRef.current = requestAnimationFrame(tick);
      };
      webAmpFrameRef.current = requestAnimationFrame(tick);
    } catch {
      // non-fatal
    }
  }, []);

  const stopWebAmpMeter = useCallback(() => {
    if (webAmpFrameRef.current) {
      cancelAnimationFrame(webAmpFrameRef.current);
      webAmpFrameRef.current = null;
    }
    webAnalyserRef.current = null;
    if (webAudioCtxRef.current) {
      webAudioCtxRef.current.close().catch(() => {});
      webAudioCtxRef.current = null;
    }
    ampRef.current = 0;
  }, []);

  // ── Native metering (mic amplitude while recording) ───────────────────────
  const startNativeMeterLoop = useCallback(() => {
    if (meterLoopRef.current) clearInterval(meterLoopRef.current);
    meterLoopRef.current = setInterval(() => {
      if (stateRef.current !== 'listening') return;
      if (!nativeRecorder.isRecording) return;
      try {
        const status = nativeRecorder.getStatus();
        const metering = status.metering;
        if (typeof metering === 'number') {
          const clamped = Math.max(-60, Math.min(0, metering));
          ampRef.current = (clamped + 60) / 60;
        } else {
          ampRef.current = 0.05;
        }
      } catch {
        ampRef.current = 0.05;
      }
    }, 50);
  }, [nativeRecorder]);

  const stopNativeMeterLoop = useCallback(() => {
    if (meterLoopRef.current) {
      clearInterval(meterLoopRef.current);
      meterLoopRef.current = null;
    }
    ampRef.current = 0;
  }, []);

  const speakCodexReply = useCallback(async (text: string) => {
    if (muted || !text.trim()) return;
    ampRef.current = 0.35;

    if (Platform.OS === 'web') {
      const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : null;
      if (!synthesis) return;
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.96;
        utterance.pitch = 1;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        synthesis.cancel();
        synthesis.speak(utterance);
      });
      return;
    }

    await new Promise<void>((resolve) => {
      Speech.stop();
      Speech.speak(text, {
        rate: 0.96,
        pitch: 1,
        onDone: resolve,
        onError: () => resolve(),
        onStopped: resolve,
      });
    });
  }, [muted]);

  const sendCodexVoiceTurn = useCallback(async (payload: { audioBase64?: string; mimeType?: string; text?: string }) => {
    const url = new URL('/api/voice/codex-turn', getApiUrl());
    const res = await authFetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        sdkSessionId: codexSessionIdRef.current,
      }),
    });
    const data = await res.json().catch(() => ({})) as CodexVoiceTurnResponse;
    if (!res.ok) {
      throw new Error(data.error || data.code || `Voice turn failed: ${res.status}`);
    }

    const userText = (data.transcript || '').trim();
    const reply = (data.reply || '').trim();
    if (!reply) throw new Error('Jarvis returned an empty voice reply.');

    if (data.sdkSessionId) setCodexSessionId(data.sdkSessionId);
    if (userText) setTranscript(prev => [...prev, { role: 'user', text: userText }]);

    currentAssistantTextRef.current = reply;
    setCurrentSpeech(reply);
    setState('speaking');
    try {
      await speakCodexReply(reply);
    } finally {
      setTranscript(prev => [...prev, { role: 'assistant', text: reply }]);
      currentAssistantTextRef.current = '';
      setCurrentSpeech('');
      ampRef.current = 0;
      setState('idle');
    }
  }, [speakCodexReply]);

  const recordWebCodexTurn = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    startWebAmpMeter(stream);

    const recorder = new MediaRecorder(stream);
    webRecorderRef.current = recorder;
    webChunksRef.current = [];

    const stopped = new Promise<Blob>((resolve) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) webChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        resolve(new Blob(webChunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
      };
    });

    recorder.start();
    setState('listening');
    await sleep(CODEX_VOICE_TURN_RECORDING_MS);
    if (recorder.state !== 'inactive') recorder.stop();
    const blob = await stopped;

    stream.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    stopWebAmpMeter();
    webRecorderRef.current = null;

    const audioBase64 = await blobToBase64(blob);
    setState('thinking');
    await sendCodexVoiceTurn({ audioBase64, mimeType: blob.type || 'audio/webm' });
  }, [sendCodexVoiceTurn, startWebAmpMeter, stopWebAmpMeter]);

  const recordNativeCodexTurn = useCallback(async () => {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone needed', 'Please grant microphone access to use voice mode.');
      setState('idle');
      return;
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    await nativeRecorder.prepareToRecordAsync();
    nativeRecorder.record();
    startNativeMeterLoop();
    setState('listening');

    await sleep(CODEX_VOICE_TURN_RECORDING_MS);
    if (nativeRecorder.isRecording) await nativeRecorder.stop();
    stopNativeMeterLoop();

    const uri = nativeRecorder.uri;
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (!uri) throw new Error('No voice recording was captured.');

    const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    setState('thinking');
    await sendCodexVoiceTurn({ audioBase64, mimeType: 'audio/wav' });
  }, [nativeRecorder, sendCodexVoiceTurn, startNativeMeterLoop, stopNativeMeterLoop]);

  const recognizeAndroidCodexTurn = useCallback(async () => {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone needed', 'Please grant microphone access to use voice mode.');
      setState('idle');
      return;
    }

    setState('listening');
    const result = await recognizeAndroidSpeechOnce({
      interimResults: true,
      timeoutMs: CODEX_VOICE_TURN_RECORDING_MS + 20_000,
    });
    const text = result.text.trim();
    if (!text) {
      throw new Error('No speech was detected. Please try again and speak clearly.');
    }

    setState('thinking');
    await sendCodexVoiceTurn({ text });
  }, [sendCodexVoiceTurn]);

  const startCodexTurn = useCallback(async () => {
    if (
      stateRef.current === 'connecting' ||
      stateRef.current === 'listening' ||
      stateRef.current === 'thinking' ||
      stateRef.current === 'muted'
    ) return;
    setState('connecting');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (Platform.OS === 'web') {
        await recordWebCodexTurn();
      } else if (Platform.OS === 'android') {
        await recognizeAndroidCodexTurn();
      } else {
        await recordNativeCodexTurn();
      }
    } catch (error) {
      console.error('[voice] Codex turn failed:', error);
      Alert.alert('Voice turn failed', error instanceof Error ? error.message : 'Could not complete the voice turn.');
      currentAssistantTextRef.current = '';
      setCurrentSpeech('');
      ampRef.current = 0;
      setState('idle');
    }
  }, [recognizeAndroidCodexTurn, recordNativeCodexTurn, recordWebCodexTurn]);

  const cleanupWebSession = useCallback(() => {
    stopWebAmpMeter();
    if (webRecorderRef.current?.state && webRecorderRef.current.state !== 'inactive') {
      webRecorderRef.current.stop();
    }
    webRecorderRef.current = null;
    webChunksRef.current = [];
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    ampRef.current = 0;
  }, [stopWebAmpMeter]);

  const cleanupNativeSession = useCallback(async () => {
    stopNativeMeterLoop();
    if (Platform.OS === 'android') {
      await cancelAndroidNativeSpeechRecognition().catch(() => {});
    }
    if (nativeRecorder.isRecording) {
      await nativeRecorder.stop().catch(() => {});
    }
    Speech.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: false }).catch(() => {});
    ampRef.current = 0;
  }, [nativeRecorder, stopNativeMeterLoop]);

  // ── Interrupt (while Jarvis speaks) ──────────────────────────────────────
  const interruptJarvis = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    } else {
      Speech.stop();
    }
    currentAssistantTextRef.current = '';
    setCurrentSpeech('');
    ampRef.current = 0;
    setState('idle');
  }, []);

  // ── Mute toggle ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const newMuted = !muted;
    setMuted(newMuted);
    if (Platform.OS === 'web') {
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
    } else if (Platform.OS === 'android' && newMuted) {
      cancelAndroidNativeSpeechRecognition().catch(() => {});
    } else if (newMuted && nativeRecorder.isRecording) {
      stopNativeMeterLoop();
      nativeRecorder.stop().catch(() => {});
    }
    if (stateRef.current === 'idle' || stateRef.current === 'muted' || stateRef.current === 'listening') {
      setState(newMuted ? 'muted' : 'idle');
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [muted, nativeRecorder, stopNativeMeterLoop]);

  // ── Session end ───────────────────────────────────────────────────────────
  const saveTranscript = useCallback(async (entries: TranscriptEntry[]) => {
    if (!entries.length) return;
    setSavingTranscript(true);
    try {
      const url = new URL('/api/conversations', getApiUrl());
      const convRes = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Voice Session ${new Date().toLocaleString()}` }),
      });
      const conv = await convRes.json();
      if (!conv.id) return;

      const msgUrl = new URL(`/api/conversations/${conv.id}/voice-transcript`, getApiUrl());
      await authFetch(msgUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      }).catch(() => {});
    } catch (err) {
      console.error('[voice] transcript save failed:', err);
    } finally {
      setSavingTranscript(false);
    }
  }, []);

  const endSession = useCallback(async () => {
    setState('ended');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (Platform.OS === 'web') {
      cleanupWebSession();
    } else {
      await cleanupNativeSession();
    }

    const entries = [...transcript];
    if (currentAssistantTextRef.current.trim()) {
      entries.push({ role: 'assistant', text: currentAssistantTextRef.current.trim() });
    }
    await saveTranscript(entries);

    setTimeout(() => router.back(), 2000);
  }, [transcript, cleanupWebSession, cleanupNativeSession, saveTranscript, router]);
  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (Platform.OS === 'web') {
        cleanupWebSession();
      } else {
        stopNativeMeterLoop();
        if (nativeRecorder.isRecording) nativeRecorder.stop().catch(() => {});
        Speech.stop();
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: false }).catch(() => {});
      }
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  useEffect(() => {
    if (transcript.length > 0) scrollToBottom();
  }, [transcript]);

  // ── Start session ─────────────────────────────────────────────────────────
  const startSession = useCallback(() => {
    startCodexTurn();
  }, [startCodexTurn]);

  const cfg = STATE_CONFIG[state];
  const isActive = (state !== 'idle' && state !== 'ended') || transcript.length > 0;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const isSpeaking = state === 'speaking';

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <StatusBar barStyle="light-content" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => { if (isActive) { endSession(); } else { router.back(); } }} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.textSecondary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={[styles.headerDot, { backgroundColor: isActive ? cfg.color : Colors.textTertiary }]} />
          <Text style={styles.headerTitle}>JARVIS VOICE</Text>
        </View>
        <View style={styles.headerRight}>
          {isActive ? (
            <Pressable onPress={toggleMute} style={styles.muteBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons
                name={muted ? 'mic-off' : 'mic'}
                size={18}
                color={muted ? Colors.warning : Colors.textSecondary}
              />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push('/(tabs)/settings')}
              style={styles.muteBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="settings-outline" size={18} color={Colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Transcript area ── */}
      <ScrollView
        ref={scrollRef}
        style={styles.transcriptScroll}
        contentContainerStyle={styles.transcriptContent}
        showsVerticalScrollIndicator={false}
      >
        {transcript.length === 0 && state === 'idle' && (
          <RAnimated.View entering={FadeIn} style={styles.emptyState}>
            <Ionicons name="mic-circle-outline" size={36} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>Codex voice turns with Jarvis</Text>
            <Text style={styles.emptySubtext}>Tap the orb and speak</Text>
          </RAnimated.View>
        )}
        {transcript.map((entry, i) => (
          <RAnimated.View
            key={i}
            entering={FadeIn.duration(300)}
            style={[
              styles.transcriptRow,
              entry.role === 'user' ? styles.transcriptRowUser : styles.transcriptRowAssistant,
            ]}
          >
            <View style={[
              styles.transcriptBubble,
              entry.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
            ]}>
              <Text style={[
                styles.transcriptText,
                entry.role === 'user' ? styles.transcriptTextUser : styles.transcriptTextAssistant,
              ]}>
                {entry.text}
              </Text>
            </View>
          </RAnimated.View>
        ))}
        {currentSpeech ? (
          <RAnimated.View entering={FadeIn} style={[styles.transcriptRow, styles.transcriptRowAssistant]}>
            <View style={[styles.transcriptBubble, styles.bubbleAssistant, styles.bubbleLive]}>
              <Text style={[styles.transcriptText, styles.transcriptTextAssistant]}>
                {currentSpeech}
                <Text style={styles.cursor}>▌</Text>
              </Text>
            </View>
          </RAnimated.View>
        ) : null}
      </ScrollView>

      {/* ── Waveform + Orb area ── */}
      <View style={styles.orbContainer}>
        {/* Waveform bars — visible when active */}
        {isActive && (
          <WaveformBars
            color={cfg.color}
            ampRef={ampRef}
            state={state}
          />
        )}

        {/* Orb with ripple rings */}
        <View style={styles.orbWrapper}>
          <RAnimated.View style={[styles.orbRing, ring1Style, { borderColor: cfg.color + '50' }]} />
          <RAnimated.View style={[styles.orbRing2, ring2Style, { borderColor: cfg.color + '30' }]} />
          <Pressable onPress={state === 'idle' ? startSession : undefined} disabled={state === 'connecting'}>
            <View style={[styles.orb, { backgroundColor: cfg.color + '22', borderColor: cfg.color + '55' }]}>
              {state === 'connecting' ? (
                <ActivityIndicator size="large" color={cfg.color} />
              ) : state === 'ended' ? (
                <Ionicons name="checkmark" size={40} color={cfg.color} />
              ) : (
                <Ionicons
                  name={state === 'idle' ? 'mic' : state === 'muted' ? 'mic-off' : state === 'speaking' ? 'volume-high' : 'radio'}
                  size={40}
                  color={cfg.color}
                />
              )}
            </View>
          </Pressable>
        </View>

        <Text style={[styles.stateLabel, { color: cfg.color }]}>{cfg.label}</Text>

        {/* Interrupt button — large tap target while Jarvis speaks */}
        {isSpeaking && (
          <RAnimated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
            <Pressable onPress={interruptJarvis} style={styles.interruptBtn}>
              <Ionicons name="stop-circle" size={18} color={Colors.violet} />
              <Text style={styles.interruptText}>Interrupt</Text>
            </Pressable>
          </RAnimated.View>
        )}
      </View>

      {/* ── Bottom Controls ── */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 20) + (Platform.OS === 'web' ? 34 : 0) }]}>
        {isActive && !savingTranscript ? (
          <Pressable onPress={endSession} style={styles.endBtn}>
            <Ionicons name="stop-circle" size={20} color={Colors.error} />
            <Text style={styles.endBtnText}>End Session</Text>
          </Pressable>
        ) : savingTranscript ? (
          <View style={styles.savingRow}>
            <ActivityIndicator size="small" color={Colors.textSecondary} />
            <Text style={styles.savingText}>Saving transcript…</Text>
          </View>
        ) : state === 'ended' ? (
          <RAnimated.View entering={FadeIn} style={styles.doneRow}>
            <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
            <Text style={styles.doneText}>Session saved</Text>
          </RAnimated.View>
        ) : (
          <Text style={styles.hintText}>
            {Platform.OS === 'web'
              ? 'Speak after tapping the orb; Jarvis will answer aloud'
              : 'Tap the orb to record a Codex voice turn'}
          </Text>
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ORB_SIZE = 120;
const RING_SIZE = ORB_SIZE + 40;
const RING2_SIZE = ORB_SIZE + 80;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    padding: 4,
    minWidth: 36,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerTitle: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
    letterSpacing: 2.5,
  },
  headerRight: {
    minWidth: 36,
    alignItems: 'flex-end',
  },
  muteBtn: {
    padding: 4,
  },
  transcriptScroll: {
    flex: 1,
  },
  transcriptContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  transcriptRow: {
    flexDirection: 'row',
  },
  transcriptRowUser: {
    justifyContent: 'flex-end',
  },
  transcriptRowAssistant: {
    justifyContent: 'flex-start',
  },
  transcriptBubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: Colors.cyanDim,
    borderWidth: 1,
    borderColor: Colors.cyan + '30',
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleLive: {
    borderColor: Colors.violet + '40',
    backgroundColor: Colors.violetDim,
  },
  transcriptText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
  },
  transcriptTextUser: {
    color: Colors.text,
  },
  transcriptTextAssistant: {
    color: Colors.text,
  },
  cursor: {
    color: Colors.violet,
  },
  orbContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 4,
  },
  orbWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: RING2_SIZE,
    height: RING2_SIZE,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbRing: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1,
  },
  orbRing2: {
    position: 'absolute',
    width: RING2_SIZE,
    height: RING2_SIZE,
    borderRadius: RING2_SIZE / 2,
    borderWidth: 1,
  },
  stateLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  interruptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.violetDim,
    borderWidth: 1,
    borderColor: Colors.violet + '50',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 8,
  },
  interruptText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.violet,
  },
  bottomBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    alignItems: 'center',
  },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.errorDim,
    borderWidth: 1,
    borderColor: Colors.error + '40',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  endBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.error,
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  savingText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  doneText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.success,
  },
  hintText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
    paddingBottom: 4,
  },
});
