import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import Animated, { useSharedValue, withRepeat, withTiming, Easing, useAnimatedStyle } from 'react-native-reanimated';
import { getApiUrl } from '@/lib/query-client';
import { authFetch } from '@/lib/auth-context';
import Colors from '@/constants/colors';

interface BrainDumpModalProps {
  visible: boolean;
  onClose: () => void;
  onSaveToToday: (text: string) => Promise<void>;
  onSaveToInbox: (text: string) => Promise<void>;
}

export default function BrainDumpModal({
  visible,
  onClose,
  onSaveToToday,
  onSaveToInbox,
}: BrainDumpModalProps) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<Blob[]>([]);
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

  const cleanupRecording = useCallback(() => {
    if (Platform.OS === 'web') {
      const recorder = webRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
          recorder.stream.getTracks().forEach(t => t.stop());
        } catch {}
      }
      webRecorderRef.current = null;
    } else {
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    setIsRecording(false);
  }, []);

  useEffect(() => {
    if (!visible) {
      cleanupRecording();
      setIsTranscribing(false);
    }
  }, [visible, cleanupRecording]);

  useEffect(() => {
    return () => {
      cleanupRecording();
    };
  }, [cleanupRecording]);

  useEffect(() => {
    if (visible) {
      setText('');
      setLoading(false);
    }
  }, [visible]);

  const transcribeAudio = useCallback(async (base64: string) => {
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
        setText(prev => {
          if (prev.trim()) {
            return prev.trimEnd() + '\n' + data.text.trim();
          }
          return data.text.trim();
        });
      }
    } catch (error) {
      console.error('Failed to transcribe:', error);
    } finally {
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.error('Failed to start recording:', error);
      if (Platform.OS === 'web') {
        Alert.alert('Permission Required', 'Microphone access is needed to use voice input.');
      }
    }
  }, []);

  const stopRecordingAndTranscribe = useCallback(async () => {
    setIsRecording(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

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
      transcribeAudio(base64);
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
        transcribeAudio(base64);
      } catch (error) {
        console.error('Failed to process recording:', error);
        setIsTranscribing(false);
      }
    }
  }, [transcribeAudio]);

  const handleMicPress = useCallback(() => {
    if (isRecording) {
      stopRecordingAndTranscribe();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecordingAndTranscribe]);

  const handleSaveToToday = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      await onSaveToToday(text.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setText('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToInbox = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      await onSaveToInbox(text.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setText('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const renderMicButton = () => {
    if (isTranscribing) {
      return (
        <Pressable style={styles.micButton} disabled>
          <ActivityIndicator size="small" color={Colors.primary} />
        </Pressable>
      );
    }

    if (isRecording) {
      return (
        <Pressable onPress={handleMicPress} style={styles.micButton} testID="mic-button">
          <Animated.View style={micPulseStyle}>
            <Ionicons name="radio-button-on" size={24} color="#EF4444" />
          </Animated.View>
        </Pressable>
      );
    }

    return (
      <Pressable
        onPress={handleMicPress}
        style={styles.micButton}
        disabled={loading}
        testID="mic-button"
      >
        <Ionicons name="mic-outline" size={24} color={loading ? Colors.borderLight : Colors.textSecondary} />
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.dismissArea} onPress={loading ? undefined : onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.content}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Brain Dump</Text>
              {loading && (
                <Text style={styles.analyzingText}>Analyzing your thoughts...</Text>
              )}
            </View>
            <View style={styles.headerButtons}>
              {renderMicButton()}
              <Pressable onPress={loading ? undefined : onClose} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={loading ? Colors.borderLight : Colors.textSecondary} />
              </Pressable>
            </View>
          </View>

          <TextInput
            style={[styles.input, loading && styles.inputDisabled]}
            placeholder={isRecording ? "Listening..." : "What's on your mind? Capture it all — tasks, ideas, reminders..."}
            placeholderTextColor={isRecording ? '#EF4444' : Colors.textTertiary}
            multiline
            autoFocus
            value={text}
            onChangeText={setText}
            textAlignVertical="top"
            editable={!loading}
          />

          <View style={styles.footer}>
            <Pressable
              onPress={handleSaveToInbox}
              style={[styles.button, styles.inboxButton, (!text.trim() || loading) && styles.disabledButton]}
              disabled={!text.trim() || loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color={Colors.text} />
              ) : (
                <Ionicons name="archive-outline" size={20} color={Colors.text} />
              )}
              <Text style={styles.buttonText}>Save for Later</Text>
            </Pressable>

            <Pressable
              onPress={handleSaveToToday}
              style={[styles.button, styles.todayButton, (!text.trim() || loading) && styles.disabledButton]}
              disabled={!text.trim() || loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Ionicons name="flash-outline" size={20} color={Colors.white} />
              )}
              <Text style={[styles.buttonText, styles.todayButtonText]}>Add to Today</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  content: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: 300,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  analyzingText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.primary,
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  micButton: {
    padding: 4,
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    minHeight: 120,
    marginBottom: 24,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: Platform.OS === 'ios' ? 20 : 0,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    gap: 8,
  },
  inboxButton: {
    backgroundColor: Colors.borderLight,
  },
  todayButton: {
    backgroundColor: Colors.primary,
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  todayButtonText: {
    color: Colors.white,
  },
});
