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
  createAudioPlayer,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  AudioQuality,
} from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { authFetch } from '@/lib/auth-context';

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pcm16ToWav(pcmBytes: Uint8Array, sampleRate: number = 24000): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const dataSize = pcmBytes.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true);
  v.setUint16(32, (numChannels * bitsPerSample) / 8, true);
  v.setUint16(34, bitsPerSample, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  new Uint8Array(buf, 44).set(pcmBytes);
  return new Uint8Array(buf);
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < len ? chars[b2 & 63] : '=';
  }
  return result;
}

/** Sample max PCM16 amplitude from a base64 audio chunk (returns 0–1). */
function samplePcmAmplitude(base64Chunk: string): number {
  try {
    const bytes = base64ToUint8Array(base64Chunk);
    let max = 0;
    // PCM16 = 2 bytes per sample
    const step = Math.max(2, Math.floor(bytes.length / 128) * 2);
    for (let i = 0; i < bytes.length - 1; i += step) {
      // Little-endian signed int16
      let sample = bytes[i] | (bytes[i + 1] << 8);
      if (sample > 32767) sample -= 65536;
      const abs = Math.abs(sample);
      if (abs > max) max = abs;
    }
    return Math.min(1, max / 32767);
  } catch {
    return 0;
  }
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
  idle:       { label: 'Tap to start',   color: Colors.textTertiary },
  connecting: { label: 'Connecting…',    color: Colors.textSecondary },
  listening:  { label: 'Listening',      color: Colors.cyan },
  thinking:   { label: 'Thinking…',      color: Colors.violet },
  speaking:   { label: 'Speaking',       color: Colors.violet },
  muted:      { label: 'Muted',          color: Colors.warning },
  ended:      { label: 'Session ended',  color: Colors.textTertiary },
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function VoiceRealtimeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [state, setState] = useState<SessionState>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentSpeech, setCurrentSpeech] = useState('');
  const [muted, setMuted] = useState(false);
  const [savingTranscript, setSavingTranscript] = useState(false);

  // Amplitude ref — written at ~20fps, read by WaveformBars
  const ampRef = useRef(0);

  // ── WebRTC refs (web only) ───────────────────────────────────────────────
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const webAnalyserRef = useRef<AnalyserNode | null>(null);
  const webAmpFrameRef = useRef<number | null>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const endSessionRef = useRef<(() => Promise<void>) | null>(null);

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
  const nativeSoundRef = useRef<AudioPlayer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioPcmChunksRef = useRef<string[]>([]);
  const currentUserTextRef = useRef('');
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

  // ── Fetch ephemeral token (web WebRTC only) ───────────────────────────────
  const fetchEphemeralToken = useCallback(async (): Promise<{ clientSecret: string; sessionId: string } | null> => {
    try {
      const url = new URL('/api/voice/realtime-session', getApiUrl());
      const res = await authFetch(url.toString(), { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { clientSecret: data.client_secret?.value ?? data.client_secret, sessionId: data.session_id };
    } catch (err) {
      console.error('[voice] Failed to fetch token:', err);
      return null;
    }
  }, []);

  // ── Execute tool call on server ───────────────────────────────────────────
  const executeToolCall = useCallback(async (toolName: string, toolArgs: unknown): Promise<string> => {
    try {
      const url = new URL('/api/voice/tool-call', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_name: toolName, arguments: toolArgs }),
      });
      const data = await res.json();
      return data.result ?? JSON.stringify({ error: 'No result' });
    } catch {
      return JSON.stringify({ error: 'Tool execution failed' });
    }
  }, []);

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

  // ── WebRTC session (web) ──────────────────────────────────────────────────
  const startWebSession = useCallback(async () => {
    setState('connecting');

    const tokenData = await fetchEphemeralToken();
    if (!tokenData) {
      Alert.alert('Connection failed', 'Could not create a voice session. Check your connection and try again.');
      setState('idle');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      startWebAmpMeter(stream);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        if (!audioElRef.current) {
          const el = document.createElement('audio');
          el.autoplay = true;
          document.body.appendChild(el);
          audioElRef.current = el;
        }
        audioElRef.current.srcObject = event.streams[0];
      };

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        setState('listening');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      };

      dc.onmessage = (e) => {
        try {
          const evt = JSON.parse(e.data);
          handleRealtimeEvent(evt, tokenData.clientSecret, dc);
        } catch {}
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenData.clientSecret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) {
        throw new Error(`OpenAI SDP error: ${sdpRes.status}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (err) {
      console.error('[voice] WebRTC setup failed:', err);
      Alert.alert('Connection failed', 'Could not connect to Jarvis voice. Please try again.');
      cleanupWebSession();
      setState('idle');
    }
  }, [fetchEphemeralToken, startWebAmpMeter]);

  const handleRealtimeEvent = useCallback(
    (evt: Record<string, unknown>, clientSecret: string, dc: RTCDataChannel) => {
      const type = evt.type as string;

      if (type === 'input_audio_buffer.speech_started') {
        setState('listening');
      } else if (type === 'input_audio_buffer.speech_stopped') {
        setState('thinking');
        ampRef.current = 0;
      } else if (type === 'response.created') {
        setState('thinking');
        currentAssistantTextRef.current = '';
        ampRef.current = 0;
      } else if (type === 'response.audio.delta') {
        setState('speaking');
        const delta = (evt.delta as string) || '';
        if (delta) ampRef.current = samplePcmAmplitude(delta);
      } else if (type === 'response.audio_transcript.delta') {
        const delta = (evt.delta as string) || '';
        currentAssistantTextRef.current += delta;
        setCurrentSpeech(currentAssistantTextRef.current);
      } else if (type === 'response.audio_transcript.done') {
        const text = currentAssistantTextRef.current.trim();
        if (text) {
          setTranscript(prev => [...prev, { role: 'assistant', text }]);
        }
        currentAssistantTextRef.current = '';
        setCurrentSpeech('');
        ampRef.current = 0;
        setState('listening');
      } else if (type === 'conversation.item.input_audio_transcription.completed') {
        const text = ((evt.transcript as string) || '').trim();
        if (text) {
          setTranscript(prev => [...prev, { role: 'user', text }]);
        }
      } else if (type === 'response.function_call_arguments.done') {
        const callId = evt.call_id as string;
        const toolName = evt.name as string;
        let args: unknown = {};
        try { args = JSON.parse((evt.arguments as string) || '{}'); } catch {}

        executeToolCall(toolName, args).then(result => {
          dc.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: result,
            },
          }));
          dc.send(JSON.stringify({ type: 'response.create' }));
        });
      } else if (type === 'response.cancelled' || type === 'response.done') {
        ampRef.current = 0;
        setState('listening');
      } else if (type === 'error') {
        console.error('[voice] Realtime error:', evt);
      }
    },
    [executeToolCall]
  );

  const cleanupWebSession = useCallback(() => {
    stopWebAmpMeter();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }
    ampRef.current = 0;
  }, [stopWebAmpMeter]);

  // ── Native metering (mic amplitude while recording) ───────────────────────
  const startNativeMeterLoop = useCallback(() => {
    if (meterLoopRef.current) clearInterval(meterLoopRef.current);
    meterLoopRef.current = setInterval(() => {
      // Only drive waveform from mic while listening — speaking state uses PCM delta amplitude
      if (stateRef.current !== 'listening') return;
      if (!nativeRecorder.isRecording) return;
      try {
        // Poll metering from the recorder status (isMeteringEnabled=true provides dBFS)
        const status = nativeRecorder.getStatus();
        const metering = status.metering;
        if (typeof metering === 'number') {
          // metering is in dBFS (-160 to 0). Map to 0..1 using -60dBFS floor
          const clamped = Math.max(-60, Math.min(0, metering));
          ampRef.current = (clamped + 60) / 60;
        } else {
          // No metering value yet — quiet idle signal
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

  // ── Native WebSocket session via server relay ─────────────────────────────
  const startNativeSession = useCallback(async () => {
    setState('connecting');

    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone needed', 'Please grant microphone access to use voice mode.');
      setState('idle');
      return;
    }

    // Obtain a short-lived single-use relay ticket (30s TTL).
    // This avoids embedding the long-lived JWT in the WebSocket URL.
    let relayTicket: string | null = null;
    try {
      const ticketUrl = new URL('/api/voice/relay-ticket', getApiUrl());
      const ticketRes = await authFetch(ticketUrl.toString(), { method: 'POST' });
      if (!ticketRes.ok) throw new Error(`Ticket fetch failed: ${ticketRes.status}`);
      const ticketData = await ticketRes.json();
      relayTicket = ticketData.ticket;
    } catch (err) {
      console.error('[voice] Failed to get relay ticket:', err);
      Alert.alert('Connection failed', 'Could not start a voice session. Please try again.');
      setState('idle');
      return;
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    // Build relay URL — replace https/http with wss/ws
    const apiBase = getApiUrl();
    const relayUrl = apiBase
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      .replace(/\/+$/, '');
    const wsUrl = `${relayUrl}/api/voice/ws?ticket=${encodeURIComponent(relayTicket!)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    audioPcmChunksRef.current = [];

    ws.onopen = () => {
      setState('listening');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      startNativeRecordingLoop();
    };

    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data as string);
        handleNativeRealtimeEvent(evt);
      } catch {}
    };

    ws.onerror = () => {
      Alert.alert('Connection error', 'Voice session disconnected. Please try again.');
      endSessionRef.current?.();
    };

    ws.onclose = () => {
      if (stateRef.current !== 'ended') endSessionRef.current?.();
    };
  }, []);

  const nativeRecordLoopRef = useRef(false);

  const startNativeRecordingLoop = useCallback(async () => {
    nativeRecordLoopRef.current = true;
    startNativeMeterLoop();

    while (nativeRecordLoopRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        await nativeRecorder.prepareToRecordAsync();
        nativeRecorder.record();
        await new Promise<void>(r => setTimeout(r, 250));

        if (!nativeRecordLoopRef.current) {
          if (nativeRecorder.isRecording) await nativeRecorder.stop();
          break;
        }

        if (nativeRecorder.isRecording) await nativeRecorder.stop();

        const uri = nativeRecorder.uri;
        if (!uri || wsRef.current?.readyState !== WebSocket.OPEN) break;

        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (!fileInfo.exists) continue;

        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});

        // Strip the 44-byte WAV header before sending raw PCM16 to OpenAI.
        const binaryStr = atob(base64);
        const wavBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) wavBytes[i] = binaryStr.charCodeAt(i);
        const WAV_HEADER_BYTES = 44;
        const pcmBytes = wavBytes.length > WAV_HEADER_BYTES ? wavBytes.subarray(WAV_HEADER_BYTES) : wavBytes;
        if (pcmBytes.length === 0) continue;
        const chunkSize = 8192;
        let pcmBase64 = '';
        for (let i = 0; i < pcmBytes.length; i += chunkSize) {
          pcmBase64 += String.fromCharCode(...pcmBytes.subarray(i, Math.min(i + chunkSize, pcmBytes.length)));
        }
        const pcmAudio = btoa(pcmBase64);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: pcmAudio,
          }));
        }
      } catch (err) {
        console.warn('[voice] recording loop error:', err);
        await new Promise<void>(r => setTimeout(r, 100));
      }
    }
    stopNativeMeterLoop();
  }, [nativeRecorder, startNativeMeterLoop, stopNativeMeterLoop]);

  const handleNativeRealtimeEvent = useCallback(
    (evt: Record<string, unknown>) => {
      const type = evt.type as string;

      if (type === 'input_audio_buffer.speech_started') {
        setState('listening');
        audioPcmChunksRef.current = [];
        nativeSoundRef.current?.pause();
      } else if (type === 'input_audio_buffer.speech_stopped') {
        setState('thinking');
        ampRef.current = 0;
      } else if (type === 'response.created') {
        setState('thinking');
        currentAssistantTextRef.current = '';
        audioPcmChunksRef.current = [];
        ampRef.current = 0;
      } else if (type === 'response.audio.delta') {
        const delta = (evt.delta as string) || '';
        if (delta) {
          audioPcmChunksRef.current.push(delta);
          ampRef.current = samplePcmAmplitude(delta);
        }
        setState('speaking');
      } else if (type === 'response.audio.done') {
        playNativeAudio();
      } else if (type === 'response.audio_transcript.delta') {
        const delta = (evt.delta as string) || '';
        currentAssistantTextRef.current += delta;
        setCurrentSpeech(currentAssistantTextRef.current);
      } else if (type === 'response.audio_transcript.done') {
        const text = currentAssistantTextRef.current.trim();
        if (text) setTranscript(prev => [...prev, { role: 'assistant', text }]);
        currentAssistantTextRef.current = '';
        setCurrentSpeech('');
        ampRef.current = 0;
      } else if (type === 'conversation.item.input_audio_transcription.completed') {
        const text = ((evt.transcript as string) || '').trim();
        if (text) setTranscript(prev => [...prev, { role: 'user', text }]);
      } else if (type === 'response.function_call_arguments.done') {
        const callId = evt.call_id as string;
        const toolName = evt.name as string;
        let args: unknown = {};
        try { args = JSON.parse((evt.arguments as string) || '{}'); } catch {}

        executeToolCall(toolName, args).then(result => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'conversation.item.create',
              item: { type: 'function_call_output', call_id: callId, output: result },
            }));
            wsRef.current.send(JSON.stringify({ type: 'response.create' }));
          }
        });
      } else if (type === 'response.cancelled') {
        audioPcmChunksRef.current = [];
        ampRef.current = 0;
        setState('listening');
      } else if (type === 'response.done') {
        ampRef.current = 0;
        setState('listening');
      }
    },
    [executeToolCall]
  );

  const playNativeAudio = useCallback(async () => {
    const chunks = audioPcmChunksRef.current;
    audioPcmChunksRef.current = [];
    if (!chunks.length || !FileSystem.documentDirectory) return;

    try {
      const allPcm: number[] = [];
      for (const chunk of chunks) {
        const decoded = base64ToUint8Array(chunk);
        allPcm.push(...decoded);
      }
      const pcmBytes = new Uint8Array(allPcm);
      const wavBytes = pcm16ToWav(pcmBytes);
      const wavBase64 = uint8ToBase64(wavBytes);
      const uri = FileSystem.documentDirectory + `voice_response_${Date.now()}.wav`;
      await FileSystem.writeAsStringAsync(uri, wavBase64, { encoding: FileSystem.EncodingType.Base64 });

      if (nativeSoundRef.current) {
        nativeSoundRef.current.remove();
        nativeSoundRef.current = null;
      }

      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const sound = createAudioPlayer({ uri });
      nativeSoundRef.current = sound;
      sound.play();

      sound.addListener('playbackStatusUpdate', async (status) => {
        if (status.didJustFinish) {
          sound.remove();
          nativeSoundRef.current = null;
          FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          ampRef.current = 0;
          setState('listening');
        }
      });
    } catch (err) {
      console.error('[voice] native audio playback failed:', err);
      setState('listening');
    }
  }, []);

  const cleanupNativeSession = useCallback(async () => {
    nativeRecordLoopRef.current = false;
    stopNativeMeterLoop();
    if (nativeRecorder.isRecording) {
      await nativeRecorder.stop().catch(() => {});
    }
    wsRef.current?.close();
    wsRef.current = null;
    if (nativeSoundRef.current) {
      nativeSoundRef.current.remove();
      nativeSoundRef.current = null;
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: false }).catch(() => {});
    ampRef.current = 0;
  }, [nativeRecorder, stopNativeMeterLoop]);

  // ── Interrupt (while Jarvis speaks) ──────────────────────────────────────
  const interruptJarvis = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (Platform.OS === 'web') {
      dcRef.current?.send(JSON.stringify({ type: 'response.cancel' }));
      // Stop web audio element
      if (audioElRef.current) {
        audioElRef.current.pause();
      }
    } else {
      wsRef.current?.send(JSON.stringify({ type: 'response.cancel' }));
      // Immediately stop any currently-playing native audio
      if (nativeSoundRef.current) {
        nativeSoundRef.current.pause();
        nativeSoundRef.current.remove();
        nativeSoundRef.current = null;
      }
    }
    audioPcmChunksRef.current = [];
    ampRef.current = 0;
    setState('listening');
  }, []);

  // ── Mute toggle ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const newMuted = !muted;
    setMuted(newMuted);
    if (Platform.OS === 'web') {
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
    } else {
      if (newMuted) {
        nativeRecordLoopRef.current = false;
        stopNativeMeterLoop();
        if (nativeRecorder.isRecording) nativeRecorder.stop().catch(() => {});
        setState('muted');
      } else {
        startNativeRecordingLoop();
        setState('listening');
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [muted, nativeRecorder, startNativeRecordingLoop, stopNativeMeterLoop]);

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
  // Keep ref current so WS handlers with [] deps always call the latest version
  endSessionRef.current = endSession;

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (Platform.OS === 'web') {
        cleanupWebSession();
      } else {
        nativeRecordLoopRef.current = false;
        stopNativeMeterLoop();
        if (nativeRecorder.isRecording) nativeRecorder.stop().catch(() => {});
        wsRef.current?.close();
        nativeSoundRef.current?.remove();
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
    if (Platform.OS === 'web') {
      startWebSession();
    } else {
      startNativeSession();
    }
  }, [startWebSession, startNativeSession]);

  const cfg = STATE_CONFIG[state];
  const isActive = state !== 'idle' && state !== 'ended';
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
            <Text style={styles.emptyText}>Real-time voice conversation with Jarvis</Text>
            <Text style={styles.emptySubtext}>Tap the orb below to start</Text>
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
              ? 'Speak naturally — Jarvis will respond in real time'
              : 'Tap the orb to start a real-time voice session'}
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
