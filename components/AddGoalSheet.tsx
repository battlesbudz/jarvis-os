import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { Goal, generateId } from '@/lib/storage';
import { getCategoryColor, getCategoryLabel } from '@/lib/helpers';

interface AddGoalSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave: (goal: Goal) => void;
  editGoal?: Goal | null;
}

type GoalCategory = 'fitness' | 'finance' | 'career' | 'personal' | 'social';
const CATEGORIES: GoalCategory[] = ['fitness', 'finance', 'career', 'personal', 'social'];

export default function AddGoalSheet({ visible, onClose, onSave, editGoal }: AddGoalSheetProps) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<GoalCategory>('fitness');
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('0');
  const [unit, setUnit] = useState('');

  useEffect(() => {
    if (visible) {
      setTitle(editGoal?.title || '');
      setCategory(editGoal?.category || 'fitness');
      setTarget(editGoal?.target?.toString() || '');
      setCurrent(editGoal?.current?.toString() || '0');
      setUnit(editGoal?.unit || '');
    }
  }, [visible, editGoal]);

  const handleSave = () => {
    if (!title.trim() || !target.trim() || !unit.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({
      id: editGoal?.id || generateId(),
      title: title.trim(),
      category,
      target: parseInt(target, 10) || 0,
      current: parseInt(current, 10) || 0,
      unit: unit.trim(),
      createdAt: editGoal?.createdAt || new Date().toISOString(),
    });
    setTitle('');
    setCategory('fitness');
    setTarget('');
    setCurrent('0');
    setUnit('');
    onClose();
  };

  const isValid = title.trim() && target.trim() && unit.trim();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{editGoal ? 'Edit Goal' : 'New Goal'}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Run 100 miles this month"
              placeholderTextColor={Colors.textTertiary}
            />

            <Text style={styles.label}>Category</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map((cat) => {
                const color = getCategoryColor(cat);
                const isSelected = category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => {
                      setCategory(cat);
                      Haptics.selectionAsync();
                    }}
                    style={[
                      styles.categoryChip,
                      isSelected && { backgroundColor: color + '20', borderColor: color },
                    ]}
                  >
                    <Text style={[styles.categoryChipText, isSelected && { color }]}>
                      {getCategoryLabel(cat)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.row}>
              <View style={styles.halfInput}>
                <Text style={styles.label}>Target</Text>
                <TextInput
                  style={styles.input}
                  value={target}
                  onChangeText={setTarget}
                  placeholder="100"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.halfInput}>
                <Text style={styles.label}>Unit</Text>
                <TextInput
                  style={styles.input}
                  value={unit}
                  onChangeText={setUnit}
                  placeholder="miles"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
            </View>

            <Text style={styles.label}>Current Progress</Text>
            <TextInput
              style={styles.input}
              value={current}
              onChangeText={setCurrent}
              placeholder="0"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
            />

            <Pressable
              onPress={handleSave}
              disabled={!isValid}
              style={({ pressed }) => [
                styles.saveButton,
                !isValid && styles.saveButtonDisabled,
                pressed && isValid && { opacity: 0.9 },
              ]}
            >
              <Text style={[styles.saveButtonText, !isValid && { opacity: 0.5 }]}>
                {editGoal ? 'Update Goal' : 'Add Goal'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
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
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  label: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  categoryChipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  saveButtonDisabled: {
    backgroundColor: Colors.border,
  },
  saveButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
});
