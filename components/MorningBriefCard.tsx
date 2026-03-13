import React, { useState } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import { saveEnergyCheckin, getTodayKey, type EnergyCheckin } from '@/lib/storage';

interface AutoBuiltPlan {
  date: string;
  topTask: string;
  reasoning: string;
  taskCount: number;
}

interface MorningBriefCardProps {
  autoBuiltPlan: AutoBuiltPlan | null;
  coachNote: string | null;
  firstCalendarEvent: { title: string; time?: string } | null;
  energyCheckin: EnergyCheckin | null;
  onStartTopTask: () => void;
  onDismiss: () => void;
  onEnergySet: (checkin: EnergyCheckin) => void;
}

const ENERGY_OPTIONS = [
  { level: 1, emoji: '😴', label: '1' },
  { level: 2, emoji: '😑', label: '2' },
  { level: 3, emoji: '😐', label: '3' },
  { level: 4, emoji: '😊', label: '4' },
  { level: 5, emoji: '🔥', label: '5' },
];

export default function MorningBriefCard({
  autoBuiltPlan,
  coachNote,
  firstCalendarEvent,
  energyCheckin,
  onStartTopTask,
  onDismiss,
  onEnergySet,
}: MorningBriefCardProps) {
  const [selectedEnergy, setSelectedEnergy] = useState<number | null>(null);

  const reasoning = autoBuiltPlan?.reasoning || coachNote || null;
  const topTaskName = autoBuiltPlan?.topTask || null;
  const isAutoPlanned = !!autoBuiltPlan;
  const needsEnergy = !energyCheckin && !selectedEnergy;

  const handleEnergyTap = async (level: number) => {
    setSelectedEnergy(level);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const checkin: EnergyCheckin = {
      energy: level,
      focus: level >= 4 ? 'High' : level <= 2 ? 'Low' : 'Medium',
      date: getTodayKey(),
    };
    await saveEnergyCheckin(checkin);
    onEnergySet(checkin);
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(300)}
      style={styles.container}
      testID="morning-brief-card"
    >
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Ionicons name="flash" size={16} color={Colors.primary} />
          <Text style={styles.headerLabel}>Jarvis</Text>
          {isAutoPlanned && (
            <View style={styles.autoBadge}>
              <Ionicons name="sparkles" size={10} color={Colors.secondary} />
              <Text style={styles.autoBadgeText}>Auto-planned</Text>
            </View>
          )}
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          style={({ pressed }) => [styles.dismissBtn, pressed && { opacity: 0.6 }]}
          testID="dismiss-morning-brief"
        >
          <Ionicons name="close" size={18} color={Colors.textTertiary} />
        </Pressable>
      </View>

      {needsEnergy ? (
        <View style={styles.energySection}>
          <Text style={styles.energyPrompt}>How's your energy?</Text>
          <View style={styles.energyRow}>
            {ENERGY_OPTIONS.map((opt) => (
              <Pressable
                key={opt.level}
                onPress={() => handleEnergyTap(opt.level)}
                style={({ pressed }) => [styles.energyBtn, pressed && { opacity: 0.7 }]}
                testID={`energy-btn-${opt.level}`}
              >
                <Text style={styles.energyEmoji}>{opt.emoji}</Text>
                <Text style={styles.energyLabel}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <>
          {reasoning && (
            <Text style={styles.reasoning}>"{reasoning}"</Text>
          )}

          {topTaskName && (
            <View style={styles.topTaskSection}>
              <View style={styles.topTaskRow}>
                <Ionicons name="flag" size={14} color={Colors.primary} />
                <Text style={styles.topTaskLabel}>Top task:</Text>
                <Text style={styles.topTaskName} numberOfLines={1}>{topTaskName}</Text>
              </View>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onStartTopTask();
                }}
                style={({ pressed }) => [styles.startBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
                testID="start-focus-brief"
              >
                <Ionicons name="play" size={14} color={Colors.white} />
                <Text style={styles.startBtnText}>Start Focus</Text>
              </Pressable>
            </View>
          )}

          {firstCalendarEvent && (
            <View style={styles.calendarRow}>
              <Ionicons name="calendar-outline" size={13} color={Colors.textTertiary} />
              <Text style={styles.calendarText}>
                {firstCalendarEvent.time ? `${firstCalendarEvent.time} — ` : ''}
                {firstCalendarEvent.title}
              </Text>
            </View>
          )}
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLabel: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  autoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.secondary + '15',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
    marginLeft: 4,
  },
  autoBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.secondary,
  },
  dismissBtn: {
    padding: 4,
  },
  energySection: {
    alignItems: 'center',
    gap: 10,
  },
  energyPrompt: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  energyRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  energyBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 2,
  },
  energyEmoji: {
    fontSize: 20,
  },
  energyLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
  },
  reasoning: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  topTaskSection: {
    gap: 10,
    marginBottom: 8,
  },
  topTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topTaskLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
  topTaskName: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
  },
  startBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderLight,
  },
  calendarText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
});
