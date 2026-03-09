import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { Task, generateId } from '@/lib/storage';
import { getCategoryColor, getCategoryLabel } from '@/lib/helpers';

const CATEGORIES: Task['category'][] = ['personal', 'fitness', 'finance', 'career', 'social'];
const PRIORITIES: Task['priority'][] = ['low', 'medium', 'high'];

interface TaskEditSheetProps {
  task: Task | null;
  visible: boolean;
  onClose: () => void;
  onSave: (task: Task, subtasksToDelete: string[]) => void;
  onDelete: (taskId: string) => void;
}

export default function TaskEditSheet({ task, visible, onClose, onSave, onDelete }: TaskEditSheetProps) {
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [category, setCategory] = useState<Task['category']>('personal');
  const [time, setTime] = useState('');
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [deletedSubtaskIds, setDeletedSubtaskIds] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const subtaskInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (task && visible) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setCategory(task.category);
      setTime(task.time || '');
      setSubtasks(task.subtasks ? [...task.subtasks] : []);
      setNewSubtaskText('');
      setDeletedSubtaskIds([]);
      setConfirmingDelete(false);
    }
  }, [task, visible]);

  const handleAddSubtask = () => {
    const trimmed = newSubtaskText.trim();
    if (!trimmed) return;
    const newSub: Task = {
      id: generateId(),
      title: trimmed,
      category: category,
      completed: false,
      priority: priority,
      isSubtask: true,
      parentId: task?.id,
    };
    setSubtasks(prev => [...prev, newSub]);
    setNewSubtaskText('');
    subtaskInputRef.current?.focus();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks(prev => prev.filter(s => s.id !== id));
    setDeletedSubtaskIds(prev => [...prev, id]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSave = () => {
    if (!task || !title.trim()) return;
    const updated: Task = {
      ...task,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      category,
      time: time.trim() || undefined,
      subtasks: subtasks.length > 0 ? subtasks : undefined,
    };
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave(updated, deletedSubtaskIds);
  };

  const handleDeletePress = () => {
    setConfirmingDelete(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleConfirmDelete = () => {
    if (!task) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDelete(task.id);
  };

  const priorityColor = (p: Task['priority']) =>
    p === 'high' ? Colors.error : p === 'medium' ? Colors.warning : Colors.textTertiary;

  const priorityLabel = (p: Task['priority']) =>
    p === 'high' ? 'High' : p === 'medium' ? 'Medium' : 'Low';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 20 : 0 }]}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.headerBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.headerTitle}>Edit Task</Text>
            <Pressable onPress={handleSave} hitSlop={8} style={styles.headerBtn}>
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 16) }
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.section}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.titleInput}
                value={title}
                onChangeText={setTitle}
                placeholder="Task title"
                placeholderTextColor={Colors.textTertiary}
                autoFocus={false}
                returnKeyType="next"
                testID="edit-title-input"
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.titleInput, styles.descInput]}
                value={description}
                onChangeText={setDescription}
                placeholder="Add a description…"
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
                returnKeyType="done"
                testID="edit-desc-input"
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Priority</Text>
              <View style={styles.chipRow}>
                {PRIORITIES.map(p => (
                  <Pressable
                    key={p}
                    onPress={() => setPriority(p)}
                    style={[
                      styles.chip,
                      priority === p && { backgroundColor: priorityColor(p) + '20', borderColor: priorityColor(p) },
                    ]}
                    testID={`priority-${p}`}
                  >
                    <View style={[styles.priorityDot, { backgroundColor: priorityColor(p) }]} />
                    <Text style={[styles.chipText, priority === p && { color: priorityColor(p), fontFamily: 'Inter_600SemiBold' }]}>
                      {priorityLabel(p)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Category</Text>
              <View style={styles.chipRow}>
                {CATEGORIES.map(c => {
                  const color = getCategoryColor(c);
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setCategory(c)}
                      style={[
                        styles.chip,
                        category === c && { backgroundColor: color + '20', borderColor: color },
                      ]}
                      testID={`category-${c}`}
                    >
                      <Text style={[styles.chipText, category === c && { color, fontFamily: 'Inter_600SemiBold' }]}>
                        {getCategoryLabel(c)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Time</Text>
              <TextInput
                style={styles.titleInput}
                value={time}
                onChangeText={setTime}
                placeholder="e.g. 9:00 AM"
                placeholderTextColor={Colors.textTertiary}
                returnKeyType="done"
                testID="edit-time-input"
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Sub-tasks</Text>
              {subtasks.map(sub => (
                <View key={sub.id} style={styles.subtaskRow}>
                  <View style={[styles.subtaskBullet, sub.completed && styles.subtaskBulletDone]} />
                  <Text style={[styles.subtaskText, sub.completed && styles.subtaskTextDone]} numberOfLines={1}>
                    {sub.title}
                  </Text>
                  <Pressable
                    onPress={() => handleRemoveSubtask(sub.id)}
                    hitSlop={8}
                    style={styles.subtaskRemove}
                    testID={`remove-subtask-${sub.id}`}
                  >
                    <Ionicons name="close" size={16} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              ))}
              <View style={styles.addSubtaskRow}>
                <Ionicons name="add" size={18} color={Colors.primary} />
                <TextInput
                  ref={subtaskInputRef}
                  style={styles.addSubtaskInput}
                  value={newSubtaskText}
                  onChangeText={setNewSubtaskText}
                  placeholder="Add a sub-task…"
                  placeholderTextColor={Colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={handleAddSubtask}
                  blurOnSubmit={false}
                  testID="add-subtask-input"
                />
                {newSubtaskText.trim().length > 0 && (
                  <Pressable onPress={handleAddSubtask} hitSlop={8} testID="add-subtask-btn">
                    <Text style={styles.addSubtaskBtn}>Add</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {confirmingDelete ? (
              <View style={styles.deleteConfirmRow}>
                <Text style={styles.deleteConfirmText}>Delete this task?</Text>
                <View style={styles.deleteConfirmButtons}>
                  <Pressable
                    onPress={() => setConfirmingDelete(false)}
                    style={({ pressed }) => [styles.deleteConfirmCancel, pressed && { opacity: 0.75 }]}
                    testID="delete-cancel-btn"
                  >
                    <Text style={styles.deleteConfirmCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleConfirmDelete}
                    style={({ pressed }) => [styles.deleteConfirmGo, pressed && { opacity: 0.75 }]}
                    testID="delete-confirm-btn"
                  >
                    <Ionicons name="trash-outline" size={14} color={Colors.white} />
                    <Text style={styles.deleteConfirmGoText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={handleDeletePress}
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.75 }]}
                testID="delete-task-btn"
              >
                <Ionicons name="trash-outline" size={16} color={Colors.error} />
                <Text style={styles.deleteBtnText}>Delete Task</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBtn: {
    minWidth: 60,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  cancelText: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  saveText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
    textAlign: 'right',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  section: {
    marginBottom: 20,
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  titleInput: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  descInput: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  subtaskBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  subtaskBulletDone: {
    backgroundColor: Colors.textTertiary,
  },
  subtaskText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  subtaskTextDone: {
    textDecorationLine: 'line-through',
    color: Colors.textTertiary,
  },
  subtaskRemove: {
    padding: 2,
  },
  addSubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  addSubtaskInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    paddingVertical: 0,
  },
  addSubtaskBtn: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.error + '40',
    backgroundColor: Colors.error + '08',
    marginTop: 8,
    marginBottom: 8,
  },
  deleteBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.error,
  },
  deleteConfirmRow: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.error + '40',
    backgroundColor: Colors.error + '08',
    padding: 14,
    marginTop: 8,
    marginBottom: 8,
  },
  deleteConfirmText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.error,
    marginBottom: 12,
    textAlign: 'center',
  },
  deleteConfirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  deleteConfirmCancel: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  deleteConfirmCancelText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  deleteConfirmGo: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  deleteConfirmGoText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
});
