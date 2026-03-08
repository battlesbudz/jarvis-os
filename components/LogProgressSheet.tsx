import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { Goal, Task } from '@/lib/storage';
import { getCategoryColor } from '@/lib/helpers';

interface LogProgressSheetProps {
  visible: boolean;
  task: Task | null;
  goal: Goal | null;
  onLog: (amount: number) => void;
  onSkip: () => void;
}

const CURRENCY_SYMBOLS = ['$', '£', '€'];

function isCurrency(unit: string): boolean {
  return CURRENCY_SYMBOLS.includes(unit.trim()) || ['usd', 'dollars', 'dollar'].includes(unit.trim().toLowerCase());
}

function getCurrencySymbol(unit: string): string {
  if (CURRENCY_SYMBOLS.includes(unit.trim())) return unit.trim();
  return '$';
}

function formatDisplay(value: number, unit: string): string {
  const formatted = value.toLocaleString();
  if (isCurrency(unit)) return `${getCurrencySymbol(unit)}${formatted}`;
  return `${formatted} ${unit}`;
}

function parseAmount(val: string): number {
  return parseFloat(val.replace(/,/g, '')) || 0;
}

export default function LogProgressSheet({ visible, task, goal, onLog, onSkip }: LogProgressSheetProps) {
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setAmount('');
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [visible]);

  if (!task || !goal) return null;

  const color = getCategoryColor(goal.category);
  const remaining = Math.max(0, goal.target - goal.current);
  const progressPct = goal.target > 0 ? Math.min((goal.current / goal.target) * 100, 100) : 0;
  const currency = isCurrency(goal.unit);
  const symbol = currency ? getCurrencySymbol(goal.unit) : '';

  const chip1 = Math.round(remaining * 0.01);
  const chip5 = Math.round(remaining * 0.05);
  const chip10 = Math.round(remaining * 0.1);
  const chips = [chip1, chip5, chip10].filter(c => c > 0);
  const uniqueChips = [...new Set(chips)];

  const parsedAmount = parseAmount(amount);
  const isValid = parsedAmount > 0;

  const handleLog = () => {
    if (!isValid) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onLog(parsedAmount);
  };

  const handleChip = (val: number) => {
    setAmount(val.toString());
    Haptics.selectionAsync();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onSkip}>
      <Pressable style={styles.overlay} onPress={onSkip}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <View style={styles.headerText}>
              <Text style={styles.prompt}>Log progress</Text>
              <Text style={styles.goalTitle} numberOfLines={1}>{goal.title}</Text>
            </View>
            <Pressable onPress={onSkip} hitSlop={12}>
              <Ionicons name="close" size={22} color={Colors.textTertiary} />
            </Pressable>
          </View>

          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>
              {formatDisplay(goal.current, goal.unit)} of {formatDisplay(goal.target, goal.unit)}
            </Text>
            <Text style={[styles.progressPct, { color }]}>{Math.round(progressPct)}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` as any, backgroundColor: color }]} />
          </View>

          <View style={styles.inputRow}>
            {currency && (
              <View style={styles.prefixBox}>
                <Text style={styles.prefixText}>{symbol}</Text>
              </View>
            )}
            <TextInput
              ref={inputRef}
              style={[styles.amountInput, currency && styles.amountInputWithPrefix]}
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="numeric"
              returnKeyType="done"
              onSubmitEditing={handleLog}
            />
            {!currency && (
              <View style={styles.suffixBox}>
                <Text style={styles.suffixText}>{goal.unit}</Text>
              </View>
            )}
          </View>

          {uniqueChips.length > 0 && (
            <View style={styles.chips}>
              {uniqueChips.map((val) => (
                <Pressable
                  key={val}
                  onPress={() => handleChip(val)}
                  style={[styles.chip, parsedAmount === val && { backgroundColor: color + '20', borderColor: color }]}
                >
                  <Text style={[styles.chipText, parsedAmount === val && { color }]}>
                    +{formatDisplay(val, goal.unit)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable
            onPress={handleLog}
            disabled={!isValid}
            style={({ pressed }) => [
              styles.logButton,
              { backgroundColor: isValid ? color : Colors.border },
              pressed && isValid && { opacity: 0.9 },
            ]}
            testID="log-progress-confirm"
          >
            <Ionicons name="checkmark" size={18} color={Colors.white} />
            <Text style={styles.logButtonText}>Log it</Text>
          </Pressable>

          <Pressable onPress={onSkip} style={styles.skipButton} testID="log-progress-skip">
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  headerText: {
    flex: 1,
  },
  prompt: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
  },
  goalTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  progressPct: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  prefixBox: {
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 16 : 14,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  prefixText: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
  amountInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 16 : 14,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    backgroundColor: Colors.white,
  },
  amountInputWithPrefix: {
    paddingLeft: 12,
  },
  suffixBox: {
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 16 : 14,
    backgroundColor: Colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
  suffixText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  logButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 4,
  },
  logButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
});
