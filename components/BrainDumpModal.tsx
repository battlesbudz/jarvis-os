import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
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

  useEffect(() => {
    if (visible) {
      setText('');
      setLoading(false);
    }
  }, [visible]);

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
            <Pressable onPress={loading ? undefined : onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={loading ? Colors.borderLight : Colors.textSecondary} />
            </Pressable>
          </View>

          <TextInput
            style={[styles.input, loading && styles.inputDisabled]}
            placeholder="What's on your mind? Capture it all — tasks, ideas, reminders..."
            placeholderTextColor={Colors.textTertiary}
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
