import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { Task } from '@/lib/storage';

interface JustOneThingModalProps {
  visible: boolean;
  task: Task | null;
  onClose: () => void;
  onComplete: (taskId: string) => void;
  onPickAnother: () => void;
}

export default function JustOneThingModal({
  visible,
  task,
  onClose,
  onComplete,
  onPickAnother,
}: JustOneThingModalProps) {
  const insets = useSafeAreaInsets();

  if (!task) return null;

  const handleComplete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onComplete(task.id);
    onClose();
  };

  const handlePickAnother = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPickAnother();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Animated.View 
          entering={FadeIn}
          style={[StyleSheet.absoluteFill, styles.blurOverlay]} 
        />
        
        <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>
          <Pressable 
            onPress={onClose} 
            style={styles.closeButton}
            hitSlop={20}
          >
            <Ionicons name="close" size={28} color={Colors.white} />
          </Pressable>

          <View style={styles.content}>
            <Animated.View entering={FadeIn.delay(200)}>
              <Text style={styles.label}>JUST ONE THING</Text>
            </Animated.View>
            
            <Animated.View 
              key={task.id}
              entering={ZoomIn.duration(400)}
              style={styles.taskContainer}
            >
              <Text style={styles.taskTitle}>{task.title}</Text>
              {task.description ? (
                <Text style={styles.taskDescription}>{task.description}</Text>
              ) : null}
            </Animated.View>

            <View style={styles.actions}>
              <Pressable
                onPress={handleComplete}
                style={({ pressed }) => [
                  styles.doneButton,
                  pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] }
                ]}
              >
                <Ionicons name="checkmark-circle" size={24} color={Colors.white} />
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>

              <Pressable
                onPress={handlePickAnother}
                style={({ pressed }) => [
                  styles.skipButton,
                  pressed && { opacity: 0.7 }
                ]}
              >
                <Text style={styles.skipButtonText}>Pick Another</Text>
                <Ionicons name="arrow-forward" size={18} color={Colors.white} />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  blurOverlay: {
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
  },
  container: {
    flex: 1,
    paddingHorizontal: 30,
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
    letterSpacing: 4,
    marginBottom: 24,
    textAlign: 'center',
  },
  taskContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 60,
  },
  taskTitle: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: Colors.white,
    textAlign: 'center',
    lineHeight: 40,
    marginBottom: 16,
  },
  taskDescription: {
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 26,
  },
  actions: {
    width: '100%',
    gap: 20,
    alignItems: 'center',
  },
  doneButton: {
    width: '100%',
    height: 64,
    backgroundColor: Colors.primary,
    borderRadius: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  doneButtonText: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.white,
  },
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  skipButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255, 255, 255, 0.6)',
  },
});
