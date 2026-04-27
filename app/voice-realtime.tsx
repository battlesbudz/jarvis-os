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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
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

// ── State label config ────────────────────────────────────────────────────────
const STATE_CONFIG: Record<SessionState, { label: string; color: string; glow: string }> = {
  idle:       { label: 'Tap to start', color: Colors.textTertiary, glow: Colors.textTertiary },
  connecting: { label: 'Connecting…',  color: Colors.textSecondary, glow: Colors.textSecondary },
  listening:  { label: 'Listening',    color: Colors.cyan, glow: Colors.cyan },
  thinking:   { label: 'Thinking…',   color: Colors.violet, glow: Colors.violet },
  speaking:   { label: 'Speaking',     color: Colors.violet, glow: Colors.violet },
  muted:      { label: 'Muted',        color: Colors.warning, glow: Colors.warning },
  ended:      { label: 'Session ended', color: Colors.textTertiary, glow: Colors.textTertiary },
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

  // ── WebRTC refs (web only) ───────────────────────────────────────────────
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // ── Native refs ──────────────────────────────────────────────────────────
  const nativeRecorder = useAudioRecorder({
    extension: '.wav',
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 384000,
    android: { outputFormat: 'default', audioEncoder: 'default' },
    ios: { audioQuality: AudioQuality.LOW, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
    web: { mimeType: 'audio/webm', bitsPerSecond: 48000 },
  });
  const nativeSoundRef = useRef<AudioPlayer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioPcmChunksRef = useRef<string[]>([]);
  const currentUserTextRef = useRef('');
  const currentAssistantTextRef = useRef('');

  // ── Animation ────────────────────────────────────────────────────────────
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.5);
  const ring1Scale = useSharedValue(1);
  const ring2Scale = useSharedValue(1);
  const ring1Opacity = useSharedValue(0);
  const ring2Opacity = useSharedValue(0);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const cfg = STATE_CONFIG[state];
    cancelAnimation(pulseScale);
    cancelAnimation(ring1Scale);
    cancelAnimation(ring2Scale);

    if (state === 'listening') {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 600, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        ), -1
      );
      pulseOpacity.value = withTiming(1);
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
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.12, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.04, { duration: 400, easing: Easing.inOut(Easing.ease) }),
        ), -1
      );
      pulseOpacity.value = withTiming(1);
      ring1Opacity.value = withRepeat(
        withSequence(withTiming(0.25, { duration: 0 }), withTiming(0, { duration: 800 })),
        -1, false
      );
      ring1Scale.value = withRepeat(
        withSequence(withTiming(1, { duration: 0 }), withTiming(1.5, { duration: 800, easing: Easing.out(Easing.ease) })),
        -1, false
      );
      ring2Opacity.value = withTiming(0, { duration: 300 });
    } else if (state === 'thinking') {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.05, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.97, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        ), -1
      );
      pulseOpacity.value = withTiming(0.7);
      ring1Opacity.value = withTiming(0, { duration: 300 });
      ring2Opacity.value = withTiming(0, { duration: 300 });
    } else if (state === 'connecting') {
      pulseScale.value = withRepeat(
        withTiming(1.06, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        -1, true
      );
      pulseOpacity.value = withTiming(0.6);
      ring1Opacity.value = withTiming(0);
      ring2Opacity.value = withTiming(0);
    } else {
      pulseScale.value = withTiming(1, { duration: 300 });
      pulseOpacity.value = withTiming(0.4, { duration: 300 });
      ring1Opacity.value = withTiming(0, { duration: 300 });
      ring2Opacity.value = withTiming(0, { duration: 300 });
    }
  }, [state]);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));
  const ring1Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring1Scale.value }],
    opacity: ring1Opacity.value,
  }));
  const ring2Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring2Scale.value }],
    opacity: ring2Opacity.value,
  }));

  // ── Fetch ephemeral token ─────────────────────────────────────────────────
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
  }, [fetchEphemeralToken]);

  const handleRealtimeEvent = useCallback(
    (evt: Record<string, unknown>, clientSecret: string, dc: RTCDataChannel) => {
      const type = evt.type as string;

      if (type === 'input_audio_buffer.speech_started') {
        setState('listening');
      } else if (type === 'input_audio_buffer.speech_stopped') {
        setState('thinking');
      } else if (type === 'response.created') {
        setState('thinking');
        currentAssistantTextRef.current = '';
      } else if (type === 'response.audio.delta') {
        setState('speaking');
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
        setState('listening');
      } else if (type === 'error') {
        console.error('[voice] Realtime error:', evt);
      }
    },
    [executeToolCall]
  );

  const cleanupWebSession = useCallback(() => {
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
  }, []);

  // ── Native WebSocket session ──────────────────────────────────────────────
  const startNativeSession = useCallback(async () => {
    setState('connecting');

    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone needed', 'Please grant microphone access to use voice mode.');
      setState('idle');
      return;
    }

    const tokenData = await fetchEphemeralToken();
    if (!tokenData) {
      Alert.alert('Connection failed', 'Could not create a voice session.');
      setState('idle');
      return;
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    const ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`,
      ['realtime', `openai-insecure-api-key.${tokenData.clientSecret}`, 'openai-beta.realtime-v1']
    );
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
      Alert.alert('Connection error', 'Voice session disconnected.');
      endSession();
    };

    ws.onclose = () => {
      if (state !== 'ended') endSession();
    };
  }, [fetchEphemeralToken, state]);

  const nativeRecordLoopRef = useRef(false);

  const startNativeRecordingLoop = useCallback(async () => {
    nativeRecordLoopRef.current = true;

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
        // iOS linearPCM .wav files have a fixed 44-byte RIFF header;
        // Android default .wav output also uses a 44-byte header.
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
  }, []);

  const handleNativeRealtimeEvent = useCallback(
    (evt: Record<string, unknown>) => {
      const type = evt.type as string;

      if (type === 'input_audio_buffer.speech_started') {
        setState('listening');
        audioPcmChunksRef.current = [];
        nativeSoundRef.current?.pause();
      } else if (type === 'input_audio_buffer.speech_stopped') {
        setState('thinking');
      } else if (type === 'response.created') {
        setState('thinking');
        currentAssistantTextRef.current = '';
        audioPcmChunksRef.current = [];
      } else if (type === 'response.audio.delta') {
        const delta = (evt.delta as string) || '';
        if (delta) audioPcmChunksRef.current.push(delta);
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
  }, [nativeRecorder]);

  // ── Mute toggle ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const newMuted = !muted;
    setMuted(newMuted);
    if (Platform.OS === 'web') {
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
    } else {
      if (newMuted) {
        nativeRecordLoopRef.current = false;
        if (nativeRecorder.isRecording) nativeRecorder.stop().catch(() => {});
        setState('muted');
      } else {
        startNativeRecordingLoop();
        setState('listening');
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [muted, nativeRecorder, startNativeRecordingLoop]);

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
        nativeRecordLoopRef.current = false;
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
          {isActive && (
            <Pressable onPress={toggleMute} style={styles.muteBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons
                name={muted ? 'mic-off' : 'mic'}
                size={18}
                color={muted ? Colors.warning : Colors.textSecondary}
              />
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
          <Animated.View entering={FadeIn} style={styles.emptyState}>
            <Ionicons name="mic-circle-outline" size={36} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>Real-time voice conversation with Jarvis</Text>
            <Text style={styles.emptySubtext}>Tap the orb below to start</Text>
          </Animated.View>
        )}
        {transcript.map((entry, i) => (
          <Animated.View
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
          </Animated.View>
        ))}
        {currentSpeech ? (
          <Animated.View entering={FadeIn} style={[styles.transcriptRow, styles.transcriptRowAssistant]}>
            <View style={[styles.transcriptBubble, styles.bubbleAssistant, styles.bubbleLive]}>
              <Text style={[styles.transcriptText, styles.transcriptTextAssistant]}>
                {currentSpeech}
                <Text style={styles.cursor}>▌</Text>
              </Text>
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>

      {/* ── Orb ── */}
      <View style={styles.orbContainer}>
        <Animated.View style={[styles.orbRing, ring1Style, { borderColor: cfg.color + '50' }]} />
        <Animated.View style={[styles.orbRing2, ring2Style, { borderColor: cfg.color + '30' }]} />
        <Pressable onPress={state === 'idle' ? startSession : undefined} disabled={state === 'connecting'}>
          <Animated.View style={[styles.orb, orbStyle, { backgroundColor: cfg.color + '22', borderColor: cfg.color + '55' }]}>
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
          </Animated.View>
        </Pressable>
        <Text style={[styles.stateLabel, { color: cfg.color }]}>{cfg.label}</Text>
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
          <Animated.View entering={FadeIn} style={styles.doneRow}>
            <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
            <Text style={styles.doneText}>Session saved</Text>
          </Animated.View>
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

const ORB_SIZE = 140;
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
    marginHorizontal: 0,
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
    paddingVertical: 32,
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
    marginTop: 20,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
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
