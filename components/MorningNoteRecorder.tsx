import React, { useState, useRef, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useAudioRecorder,
  AudioQuality,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { File as ExpoFile } from 'expo-file-system';
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { authFetch } from '@/lib/auth-context';

interface MorningNoteRecorderProps {
  onComplete: (result: {
    transcript: string;
    moodSignal: string;
    themes: string[];
    blockers: string[];
    wins: string[];
    intention: string | null;
  }) => void;
  onSkip: () => void;
}

const MAX_DURATION = 30;

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  let result = '';
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < len ? BASE64_CHARS[b2 & 63] : '=';
  }
  return result;
}

export default function MorningNoteRecorder({ onComplete, onSkip }: MorningNoteRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(MAX_DURATION);
  const [transcribing, setTranscribing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [extractedData, setExtractedData] = useState<{
    moodSignal: string;
    themes: string[];
    blockers: string[];
    wins: string[];
    intention: string | null;
  } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const audioRecorder = useAudioRecorder({
    extension: '.m4a',
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
    android: {
      outputFormat: 'mpeg4',
      audioEncoder: 'aac',
    },
    ios: {
      audioQuality: AudioQuality.MAX,
      linearPCMBitDepth: 16 as const,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {
      mimeType: 'audio/webm',
      bitsPerSecond: 128000,
    },
  });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    if (recording) {
      pulseScale.value = withRepeat(
        withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      pulseScale.value = withTiming(1, { duration: 200 });
    }
  }, [recording]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const startTimer = useCallback((onTimeout: () => void) => {
    setSecondsLeft(MAX_DURATION);
    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          onTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startNativeRecording = useCallback(async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        console.error('Microphone permission not granted');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      startTimer(() => stopNativeRecording());
    } catch (err) {
      console.error('Failed to start native recording:', err);
    }
  }, [audioRecorder]);

  const stopNativeRecording = useCallback(async () => {
    clearTimer();
    setRecording(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!audioRecorder.isRecording) return;

    try {
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = audioRecorder.uri;
      if (!uri) {
        setTranscript('');
        return;
      }

      setTranscribing(true);

      const file = new ExpoFile(uri);
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const url = new URL('/api/morning-voice-notes/transcribe', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: base64, mimeType: 'audio/mp4' }),
      });
      const data = await res.json();
      const text = data.transcript || '';
      setTranscript(text);
      if (text.trim()) {
        await extractSignals(text.trim());
      }
    } catch (err) {
      console.error('Native transcription failed:', err);
      setTranscript('');
    } finally {
      setTranscribing(false);
    }
  }, [audioRecorder]);

  const startWebRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        await handleWebTranscribe(blob, mediaRecorder.mimeType);
      };

      mediaRecorder.start(100);
      setRecording(true);
      setSecondsLeft(MAX_DURATION);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      startTimer(() => stopWebRecording());
    } catch (err) {
      console.error('Failed to start web recording:', err);
    }
  }, []);

  const stopWebRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (Platform.OS === 'web') {
      await startWebRecording();
    } else {
      await startNativeRecording();
    }
  }, [startWebRecording, startNativeRecording]);

  const stopRecording = useCallback(() => {
    if (Platform.OS === 'web') {
      stopWebRecording();
    } else {
      stopNativeRecording();
    }
  }, [stopWebRecording, stopNativeRecording]);

  const extractSignals = async (text: string) => {
    setExtracting(true);
    try {
      const url = new URL('/api/morning-voice-notes/extract', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text }),
      });
      const data = await res.json();
      if (data.extracted) {
        setExtractedData(data.extracted);
      }
    } catch (err) {
      console.error('Extraction failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  const handleWebTranscribe = async (blob: Blob, mimeType: string) => {
    setTranscribing(true);
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      const url = new URL('/api/morning-voice-notes/transcribe', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: base64, mimeType }),
      });
      const data = await res.json();
      const text = data.transcript || '';
      setTranscript(text);
      if (text.trim()) {
        await extractSignals(text.trim());
      }
    } catch (err) {
      console.error('Transcription failed:', err);
      setTranscript('');
    } finally {
      setTranscribing(false);
    }
  };

  const handleSubmit = async () => {
    if (!transcript?.trim()) return;
    setSubmitting(true);
    try {
      const url = new URL('/api/morning-voice-notes', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcript.trim(),
          extracted: extractedData,
        }),
      });
      const data = await res.json();
      const finalExtracted = data.extracted || extractedData;
      if (finalExtracted) {
        setExtractedData(finalExtracted);
        setSubmitted(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => {
          onComplete({
            transcript: transcript.trim(),
            ...finalExtracted,
          });
        }, 2000);
      }
    } catch (err) {
      console.error('Submit failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    return () => {
      clearTimer();
      if (audioRecorder.isRecording) {
        audioRecorder.stop().catch(() => {});
      }
    };
  }, [audioRecorder]);

  if (submitted && extractedData) {
    return (
      <Animated.View entering={FadeInDown.duration(300)} style={styles.container}>
        <View style={styles.confirmHeader}>
          <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
          <Text style={styles.confirmTitle}>
            Jarvis heard: {extractedData.themes.length} theme{extractedData.themes.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <View style={styles.pillRow}>
          {extractedData.themes.slice(0, 5).map((theme, i) => (
            <View key={i} style={styles.themePill}>
              <Text style={styles.themePillText}>{theme}</Text>
            </View>
          ))}
        </View>
        {extractedData.intention && (
          <Text style={styles.intentionText} numberOfLines={2}>{extractedData.intention}</Text>
        )}
      </Animated.View>
    );
  }

  if (transcript !== null && !recording) {
    return (
      <Animated.View entering={FadeInDown.duration(300)} style={styles.container}>
        <Text style={styles.sectionLabel}>Your morning note</Text>
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptText}>{transcript || '(no speech detected)'}</Text>
        </View>
        {extracting && (
          <View style={styles.transcribingRow}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.transcribingText}>Analyzing themes...</Text>
          </View>
        )}
        {extractedData && !extracting && (
          <View style={styles.extractedPreview}>
            <View style={styles.pillRow}>
              {extractedData.themes.slice(0, 5).map((theme, i) => (
                <View key={i} style={styles.themePill}>
                  <Text style={styles.themePillText}>{theme}</Text>
                </View>
              ))}
            </View>
            {extractedData.intention && (
              <Text style={styles.intentionText} numberOfLines={2}>{extractedData.intention}</Text>
            )}
          </View>
        )}
        <View style={styles.actionRow}>
          <Pressable
            style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.7 }]}
            onPress={onSkip}
          >
            <Text style={styles.skipBtnText}>Skip</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.85 }]}
            onPress={handleSubmit}
            disabled={submitting || extracting || !transcript?.trim()}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color={Colors.white} />
                <Text style={styles.submitBtnText}>Submit</Text>
              </>
            )}
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  if (transcribing) {
    return (
      <View style={styles.container}>
        <View style={styles.transcribingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.transcribingText}>Transcribing...</Text>
        </View>
      </View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(300)} style={styles.container}>
      <Text style={styles.sectionLabel}>Record your morning note</Text>
      <Text style={styles.hint}>Tap to start recording (up to 30s)</Text>
      <View style={styles.micRow}>
        <Animated.View style={pulseStyle}>
          <Pressable
            onPress={recording ? stopRecording : startRecording}
            style={({ pressed }) => [
              styles.micBtn,
              recording && styles.micBtnRecording,
              pressed && { opacity: 0.85 },
            ]}
            testID="morning-note-mic"
          >
            <Ionicons
              name={recording ? 'stop' : 'mic'}
              size={28}
              color={Colors.white}
            />
          </Pressable>
        </Animated.View>
        {recording && (
          <View style={styles.countdownRow}>
            <View style={styles.countdownRing}>
              <Text style={styles.countdownText}>{secondsLeft}s</Text>
            </View>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingLabel}>Recording</Text>
          </View>
        )}
      </View>
      {!recording && (
        <Pressable onPress={onSkip} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <Text style={styles.skipLink}>Skip</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    paddingTop: 4,
  },
  sectionLabel: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  hint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  micRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  micBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  micBtnRecording: {
    backgroundColor: Colors.error,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countdownRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: Colors.error + '60',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.error,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error,
  },
  recordingLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.error,
  },
  skipLink: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  transcribingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    justifyContent: 'center',
  },
  transcribingText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  transcriptBox: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  transcriptText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  skipBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  skipBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  submitBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  themePill: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  themePillText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  intentionText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
  extractedPreview: {
    gap: 6,
    paddingVertical: 4,
  },
});
