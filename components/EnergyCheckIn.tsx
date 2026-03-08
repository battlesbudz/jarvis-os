import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Colors from '@/constants/colors';
import { saveEnergyCheckin, getTodayKey, type EnergyCheckin } from '@/lib/storage';

interface EnergyCheckInProps {
  visible: boolean;
  onComplete: (checkin: EnergyCheckin) => void;
}

const ENERGY_LEVELS = [
  { level: 1, icon: 'bed-outline' as const, label: 'Very Low' },
  { level: 2, icon: 'walk-outline' as const, label: 'Low' },
  { level: 3, icon: 'bicycle-outline' as const, label: 'Medium' },
  { level: 4, icon: 'flash-outline' as const, label: 'High' },
  { level: 5, icon: 'rocket-outline' as const, label: 'On Fire' },
];

const FOCUS_LEVELS = [
  { level: 'Low', icon: 'cloud-outline' as const, label: 'Foggy' },
  { level: 'Medium', icon: 'eye-outline' as const, label: 'Steady' },
  { level: 'High', icon: 'analytics-outline' as const, label: 'Sharp' },
];

export default function EnergyCheckIn({ visible, onComplete }: EnergyCheckInProps) {
  const insets = useSafeAreaInsets();
  const [energy, setEnergy] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const handleFinish = async () => {
    if (energy !== null && focus !== null) {
      const checkin: EnergyCheckin = {
        energy,
        focus,
        date: getTodayKey(),
      };
      await saveEnergyCheckin(checkin);
      onComplete(checkin);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.container}>
        <BlurView intensity={80} style={StyleSheet.absoluteFill} tint="light" pointerEvents="none" />
        <View style={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>
          <Text style={styles.title}>Morning Check-in</Text>
          <Text style={styles.subtitle}>How are we feeling today?</Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Energy Level</Text>
            <View style={styles.optionsRow}>
              {ENERGY_LEVELS.map((item) => (
                <Pressable
                  key={item.level}
                  onPress={() => setEnergy(item.level)}
                  style={[
                    styles.optionButton,
                    energy === item.level && styles.optionButtonActive,
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={28}
                    color={energy === item.level ? Colors.primary : Colors.textSecondary}
                  />
                  <Text style={[
                    styles.optionLabel,
                    energy === item.level && styles.optionLabelActive
                  ]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Focus Quality</Text>
            <View style={styles.optionsRow}>
              {FOCUS_LEVELS.map((item) => (
                <Pressable
                  key={item.level}
                  onPress={() => setFocus(item.level)}
                  style={[
                    styles.optionButton,
                    focus === item.level && styles.optionButtonActive,
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={28}
                    color={focus === item.level ? Colors.primary : Colors.textSecondary}
                  />
                  <Text style={[
                    styles.optionLabel,
                    focus === item.level && styles.optionLabelActive
                  ]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ flex: 1 }} />

          <Pressable
            onPress={handleFinish}
            disabled={energy === null || focus === null}
            style={[
              styles.finishButton,
              (energy === null || focus === null) && styles.finishButtonDisabled
            ]}
            testID="start-my-day-btn"
          >
            <Text style={styles.finishButtonText}>Start My Day</Text>
            <Ionicons name="arrow-forward" size={20} color={Colors.white} />
          </Pressable>

          <Pressable
            onPress={() => onComplete({ energy: 3, focus: 'Medium', date: getTodayKey() })}
            style={styles.skipButton}
            testID="skip-checkin-btn"
          >
            <Text style={styles.skipButtonText}>Skip for today</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  content: {
    flex: 1,
    paddingHorizontal: 30,
  },
  title: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginBottom: 48,
  },
  section: {
    marginBottom: 40,
  },
  sectionLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 20,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  optionButton: {
    flex: 1,
    minWidth: '30%',
    aspectRatio: 1,
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 12,
    margin: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  optionButtonActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  optionLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  optionLabelActive: {
    color: Colors.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  finishButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 28,
    gap: 8,
  },
  finishButtonDisabled: {
    backgroundColor: Colors.border,
    opacity: 0.5,
  },
  finishButtonText: {
    color: Colors.white,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  skipButton: {
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 12,
  },
  skipButtonText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
});
