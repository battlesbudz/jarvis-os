import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import ProgressRing from '@/components/ProgressRing';
import { getTimerSettings } from '@/lib/storage';
import { scheduleNudge, scheduleTimerNotification, requestNotificationPermissions } from '@/lib/notifications';

type TimerMode = 'work' | 'break';

export default function FocusTimerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { taskTitle } = useLocalSearchParams<{ taskTitle?: string }>();

  const [mode, setMode] = useState<TimerMode>('work');
  const [isActive, setIsActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [totalTime, setTotalTime] = useState(25 * 60);
  const [workDuration, setWorkDuration] = useState(25);
  const [breakDuration, setBreakDuration] = useState(5);

  const timerRef = useRef<any>(null);

  useEffect(() => {
    const loadSettings = async () => {
      const settings = await getTimerSettings();
      setWorkDuration(settings.workDuration);
      setBreakDuration(settings.breakDuration);
      const initialTime = mode === 'work' ? settings.workDuration * 60 : settings.breakDuration * 60;
      setTimeLeft(initialTime);
      setTotalTime(initialTime);
    };
    loadSettings();

    // Request notification permissions
    requestNotificationPermissions();
  }, []);

  const handleTimerComplete = useCallback(async () => {
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const title = mode === 'work' ? 'Focus session complete!' : 'Break over.';
    const body = mode === 'work' ? 'Take a break.' : 'Ready to focus again?';

    if (mode === 'work' && taskTitle) {
      await scheduleNudge(taskTitle);
    } else {
      await scheduleTimerNotification(title, body);
    }

    // Automatically switch mode
    const nextMode = mode === 'work' ? 'break' : 'work';
    setMode(nextMode);
    const nextDuration = nextMode === 'work' ? workDuration : breakDuration;
    setTimeLeft(nextDuration * 60);
    setTotalTime(nextDuration * 60);
  }, [mode, workDuration, breakDuration]);

  useEffect(() => {
    if (isActive && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      handleTimerComplete();
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive, timeLeft, handleTimerComplete]);

  const toggleTimer = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsActive(!isActive);
  };

  const resetTimer = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsActive(false);
    const duration = mode === 'work' ? workDuration : breakDuration;
    setTimeLeft(duration * 60);
  };

  const switchMode = (newMode: TimerMode) => {
    if (mode === newMode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsActive(false);
    setMode(newMode);
    const duration = newMode === 'work' ? workDuration : breakDuration;
    setTimeLeft(duration * 60);
    setTotalTime(duration * 60);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = (timeLeft / totalTime) * 100;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable 
          onPress={() => router.back()} 
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="close" size={28} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Focus Timer</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.content}>
        {taskTitle && (
          <View style={styles.taskBadge}>
            <Text style={styles.taskLabel}>FOCUSING ON</Text>
            <Text style={styles.taskTitle} numberOfLines={2}>{taskTitle}</Text>
          </View>
        )}

        <View style={styles.modeTabs}>
          <Pressable 
            onPress={() => switchMode('work')}
            style={[styles.modeTab, mode === 'work' && styles.activeModeTab]}
          >
            <Text style={[styles.modeTabText, mode === 'work' && styles.activeModeTabText]}>Work</Text>
          </Pressable>
          <Pressable 
            onPress={() => switchMode('break')}
            style={[styles.modeTab, mode === 'break' && styles.activeModeTab]}
          >
            <Text style={[styles.modeTabText, mode === 'break' && styles.activeModeTabText]}>Break</Text>
          </Pressable>
        </View>

        <View style={styles.timerContainer}>
          <ProgressRing 
            progress={progress} 
            size={280} 
            strokeWidth={12} 
            color={mode === 'work' ? Colors.primary : Colors.secondary}
            showLabel={false}
          />
          <View style={styles.timeLabelContainer}>
            <Text style={styles.timeText}>{formatTime(timeLeft)}</Text>
            <Text style={styles.modeLabel}>{mode === 'work' ? 'STAY FOCUSED' : 'TAKE A BREAK'}</Text>
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable 
            onPress={resetTimer}
            style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="refresh" size={32} color={Colors.textSecondary} />
          </Pressable>
          
          <Pressable 
            onPress={toggleTimer}
            style={({ pressed }) => [
              styles.playButton, 
              { backgroundColor: mode === 'work' ? Colors.primary : Colors.secondary },
              pressed && { opacity: 0.9, transform: [{ scale: 0.95 }] }
            ]}
          >
            <Ionicons name={isActive ? "pause" : "play"} size={40} color={Colors.white} />
          </Pressable>

          <Pressable 
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="checkmark-done" size={32} color={Colors.success} />
          </Pressable>
        </View>
      </View>

      {/* Web Inset Handling */}
      {Platform.OS === 'web' && <View style={{ height: 34 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 60,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    gap: 40,
  },
  taskBadge: {
    alignItems: 'center',
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    width: '100%',
  },
  taskLabel: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: Colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  taskTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    textAlign: 'center',
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.borderLight,
    padding: 4,
    borderRadius: 12,
    width: 200,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeModeTab: {
    backgroundColor: Colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  modeTabText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  activeModeTabText: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
  },
  timerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeLabelContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 64,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  modeLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    letterSpacing: 2,
    marginTop: -4,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 40,
  },
  playButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  iconButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
