import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
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
import GoalTreeSection from '@/components/GoalTreeSection';

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);

  const loadGoals = useCallback(async () => {
    const loaded = await getGoals();
    setGoals(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  useFocusEffect(
    useCallback(() => {
      loadGoals();
    }, [loadGoals])
  );

  const handleSave = async (goal: Goal) => {
    await saveGoal({ ...goal, updatedAt: new Date().toISOString() });
    setEditGoal(null);
    await loadGoals();
  };

  const handleDelete = (goal: Goal) => {
    setDeletingGoalId(goal.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleConfirmDelete = async (goalId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setDeletingGoalId(null);
    await deleteGoal(goalId);
    await loadGoals();
  };

  const handleCancelDelete = () => {
    setDeletingGoalId(null);
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
                {deletingGoalId === goal.id ? (
                  <View style={styles.deleteConfirm} testID={`delete-confirm-${goal.id}`}>
                    <Text style={styles.deleteConfirmText} numberOfLines={1}>
                      Remove "{goal.title}"?
                    </Text>
                    <View style={styles.deleteConfirmButtons}>
                      <Pressable
                        onPress={handleCancelDelete}
                        style={({ pressed }) => [styles.deleteCancelBtn, pressed && { opacity: 0.7 }]}
                        testID={`delete-cancel-${goal.id}`}
                      >
                        <Text style={styles.deleteCancelText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleConfirmDelete(goal.id)}
                        style={({ pressed }) => [styles.deleteConfirmBtn, pressed && { opacity: 0.85 }]}
                        testID={`delete-confirm-btn-${goal.id}`}
                      >
                        <Ionicons name="trash" size={14} color={Colors.white} />
                        <Text style={styles.deleteConfirmBtnText}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View>
                    <GoalCard
                      goal={goal}
                      onPress={() => handleEdit(goal)}
                      onDelete={() => handleDelete(goal)}
                    />
                    <GoalTreeSection goalId={goal.id} goalTitle={goal.title} />
                  </View>
                )}
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
  deleteConfirm: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    gap: 12,
  },
  deleteConfirmText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    textAlign: 'center',
  },
  deleteConfirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  deleteCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  deleteCancelText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  deleteConfirmBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  deleteConfirmBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
});
