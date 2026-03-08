import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
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
  { level: 1, icon: 'bed-outline' as const, label: 'Dead' },
  { level: 2, icon: 'walk-outline' as const, label: 'Low' },
  { level: 3, icon: 'bicycle-outline' as const, label: 'Okay' },
  { level: 4, icon: 'flash-outline' as const, label: 'Good' },
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

  const handleSkip = () => {
    onComplete({ energy: 3, focus: 'Medium', date: getTodayKey() });
  };

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 24);
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 16);

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.container}>
        <BlurView
          intensity={80}
          style={StyleSheet.absoluteFill}
          tint="light"
          pointerEvents="none"
        />
        <View style={[styles.header, { paddingTop: topPad }]}>
          <Text style={styles.title}>Morning Check-in</Text>
          <Text style={styles.subtitle}>How are we feeling today?</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
                    size={24}
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
                    styles.focusButton,
                    focus === item.level && styles.optionButtonActive,
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={24}
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
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: bottomPad }]}>
          <Pressable
            onPress={handleFinish}
            disabled={energy === null || focus === null}
            style={[
              styles.finishButton,
              (energy === null || focus === null) && styles.finishButtonDisabled,
            ]}
            testID="start-my-day-btn"
          >
            <Text style={styles.finishButtonText}>Start My Day</Text>
            <Ionicons name="arrow-forward" size={20} color={Colors.white} />
          </Pressable>
          <Pressable
            onPress={handleSkip}
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
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  header: {
    paddingHorizontal: 28,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  optionButton: {
    flex: 1,
    height: 72,
    backgroundColor: Colors.white,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  focusButton: {
    height: 80,
  },
  optionButtonActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  optionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  optionLabelActive: {
    color: Colors.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  footer: {
    paddingHorizontal: 28,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  finishButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 27,
    gap: 8,
  },
  finishButtonDisabled: {
    backgroundColor: Colors.border,
  },
  finishButtonText: {
    color: Colors.white,
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  skipButtonText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
});
