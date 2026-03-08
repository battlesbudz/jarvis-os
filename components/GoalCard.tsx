import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { Goal } from '@/lib/storage';
import { getCategoryColor, getCategoryLabel, getProgressPercentage } from '@/lib/helpers';
import ProgressRing from './ProgressRing';

interface GoalCardProps {
  goal: Goal;
  onPress?: () => void;
  onDelete?: () => void;
}

const CURRENCY_UNITS = ['$', '£', '€', 'usd', 'dollars', 'dollar'];

function isCurrency(unit: string): boolean {
  return CURRENCY_UNITS.includes(unit.trim().toLowerCase());
}

function formatValue(value: number, unit: string): string {
  const formatted = value.toLocaleString();
  if (isCurrency(unit)) {
    const symbol = ['$', '£', '€'].includes(unit.trim()) ? unit.trim() : '$';
    return `${symbol}${formatted}`;
  }
  return formatted;
}

export default function GoalCard({ goal, onPress, onDelete }: GoalCardProps) {
  const color = getCategoryColor(goal.category);
  const progress = getProgressPercentage(goal.current, goal.target);
  const currency = isCurrency(goal.unit);

  const currentDisplay = formatValue(goal.current, goal.unit);
  const targetDisplay = formatValue(goal.target, goal.unit);
  const unitSuffix = currency ? '' : ` ${goal.unit}`;

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.container,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
      testID={`goal-${goal.id}`}
    >
      <View style={styles.leftSection}>
        <View style={styles.header}>
          <View style={[styles.categoryBadge, { backgroundColor: color + '15' }]}>
            <Text style={[styles.categoryText, { color }]}>{getCategoryLabel(goal.category)}</Text>
          </View>
          {onDelete && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onDelete();
              }}
              hitSlop={12}
              testID={`delete-${goal.id}`}
            >
              <Ionicons name="trash-outline" size={18} color={Colors.textTertiary} />
            </Pressable>
          )}
        </View>
        <Text style={styles.title} numberOfLines={2}>{goal.title}</Text>
        <Text style={styles.progressText}>
          {currentDisplay} / {targetDisplay}{unitSuffix}
        </Text>
      </View>
      <ProgressRing progress={progress} size={56} strokeWidth={4} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  leftSection: {
    flex: 1,
    marginRight: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  title: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 4,
  },
  progressText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
});
