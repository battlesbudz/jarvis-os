import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import GoalCard from '@/components/GoalCard';
import AddGoalSheet from '@/components/AddGoalSheet';
import { getGoals, saveGoal, deleteGoal, type Goal } from '@/lib/storage';

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);

  const loadGoals = useCallback(async () => {
    const loaded = await getGoals();
    setGoals(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  const handleSave = async (goal: Goal) => {
    await saveGoal(goal);
    setEditGoal(null);
    await loadGoals();
  };

  const handleDelete = (goal: Goal) => {
    Alert.alert(
      'Delete Goal',
      `Remove "${goal.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await deleteGoal(goal.id);
            await loadGoals();
          },
        },
      ],
    );
  };

  const handleEdit = (goal: Goal) => {
    setEditGoal(goal);
    setShowAdd(true);
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <View style={styles.shimmer} />
        <View style={[styles.shimmer, { height: 100, marginTop: 20 }]} />
        <View style={[styles.shimmer, { height: 100, marginTop: 12 }]} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 16 + (Platform.OS === 'web' ? 67 : 0),
            paddingBottom: Platform.OS === 'web' ? 34 + 100 : 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.header}>
          <View>
            <Text style={styles.title}>Goals</Text>
            <Text style={styles.subtitle}>{goals.length} active goal{goals.length !== 1 ? 's' : ''}</Text>
          </View>
          <Pressable
            onPress={() => {
              setEditGoal(null);
              setShowAdd(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
            style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="add" size={22} color={Colors.white} />
          </Pressable>
        </Animated.View>

        {goals.length === 0 ? (
          <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.emptyState}>
            <Ionicons name="flag-outline" size={48} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No goals yet</Text>
            <Text style={styles.emptySubtitle}>
              Set goals to personalize your daily game plan
            </Text>
            <Pressable
              onPress={() => {
                setEditGoal(null);
                setShowAdd(true);
              }}
              style={({ pressed }) => [styles.emptyButton, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.emptyButtonText}>Add your first goal</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <View style={styles.goalsList}>
            {goals.map((goal, index) => (
              <Animated.View key={goal.id} entering={FadeInDown.duration(400).delay(200 + index * 80)}>
                <GoalCard
                  goal={goal}
                  onPress={() => handleEdit(goal)}
                  onDelete={() => handleDelete(goal)}
                />
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>

      <AddGoalSheet
        visible={showAdd}
        onClose={() => {
          setShowAdd(false);
          setEditGoal(null);
        }}
        onSave={handleSave}
        editGoal={editGoal}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
  },
  shimmer: {
    height: 28,
    backgroundColor: Colors.border,
    borderRadius: 8,
    marginBottom: 8,
    width: '60%',
    opacity: 0.5,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  emptyButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 16,
  },
  emptyButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
  goalsList: {
    marginTop: 0,
  },
});
