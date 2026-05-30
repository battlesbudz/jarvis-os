import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import SortableList from '@/components/SortableList';

export interface DailyCommandTask {
  id: string;
  title: string;
  completed?: boolean;
  description?: string;
  notes?: string;
  priority?: string;
  category?: string;
  duration?: number | string;
  time?: string;
  goalId?: string;
  goalTaskId?: string;
  sourceTaskId?: string;
  sourceIntent?: string;
  originSurface?: string;
  dailyCommandDate?: string;
  handoffReason?: string;
  fromJarvis?: boolean;
  fromCarryover?: boolean;
}

export type DailyCommandPlanPatch =
  | { op: 'add_task'; task: Partial<DailyCommandTask> & { title: string } }
  | { op: 'update_task'; taskId: string; updates: Partial<DailyCommandTask> }
  | { op: 'complete_task'; taskId: string; completed: boolean }
  | { op: 'delete_task'; taskId: string }
  | { op: 'reorder_tasks'; taskIds: string[] }
  | { op: 'carry_over_task'; taskId: string; targetDate?: string };

interface EditorDraft {
  title: string;
  description: string;
  priority: string;
  category: string;
  duration: string;
  time: string;
}

interface DailyCommandPlanEditorProps {
  tasks: DailyCommandTask[];
  busy?: boolean;
  onPatch: (patch: DailyCommandPlanPatch | { ops: DailyCommandPlanPatch[] }) => void;
}

const PRIORITIES = ['high', 'medium', 'low'];

function makeDraft(task?: DailyCommandTask): EditorDraft {
  return {
    title: task?.title ?? '',
    description: task?.description ?? task?.notes ?? '',
    priority: task?.priority ?? 'medium',
    category: task?.category ?? '',
    duration: task?.duration == null ? '' : String(task.duration),
    time: task?.time ?? '',
  };
}

function cleanDraft(draft: EditorDraft): Partial<DailyCommandTask> & { title: string } {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || undefined,
    priority: draft.priority || 'medium',
    category: draft.category.trim() || undefined,
    duration: draft.duration.trim() || undefined,
    time: draft.time.trim() || undefined,
    originSurface: 'app_inbox',
    sourceIntent: 'daily_plan_editor',
    fromJarvis: false,
  };
}

function formatMeta(task: DailyCommandTask): string {
  const durationLabel = task.duration
    ? typeof task.duration === 'number'
      ? `${task.duration}m`
      : String(task.duration)
    : '';
  const bits = [
    task.priority,
    task.category,
    durationLabel,
    task.time,
    task.goalId || task.goalTaskId ? 'goal' : '',
    task.fromCarryover ? 'carry-over' : '',
  ].filter(Boolean);
  return bits.join(' / ');
}

export default function DailyCommandPlanEditor({
  tasks,
  busy = false,
  onPatch,
}: DailyCommandPlanEditorProps) {
  const [addDraft, setAddDraft] = useState<EditorDraft>(() => makeDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditorDraft>(() => makeDraft());

  const orderedTasks = useMemo(() => tasks ?? [], [tasks]);

  const addTask = () => {
    const cleaned = cleanDraft(addDraft);
    if (!cleaned.title) return;
    onPatch({ op: 'add_task', task: cleaned });
    setAddDraft(makeDraft());
  };

  const startEdit = (task: DailyCommandTask) => {
    setEditingId(task.id);
    setEditDraft(makeDraft(task));
  };

  const saveEdit = (taskId: string) => {
    const cleaned = cleanDraft(editDraft);
    if (!cleaned.title) return;
    onPatch({ op: 'update_task', taskId, updates: cleaned });
    setEditingId(null);
  };

  const deleteTask = (task: DailyCommandTask) => {
    Alert.alert('Delete task?', task.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => onPatch({ op: 'delete_task', taskId: task.id }),
      },
    ]);
  };

  const renderDraftFields = (
    draft: EditorDraft,
    setDraft: React.Dispatch<React.SetStateAction<EditorDraft>>,
    action: React.ReactNode,
    onSubmit?: () => void,
  ) => (
    <View style={styles.draftBox}>
      <View style={styles.inputRow}>
        <TextInput
          value={draft.title}
          onChangeText={(title) => setDraft((prev) => ({ ...prev, title }))}
          placeholder="Add a task"
          placeholderTextColor={Colors.textTertiary}
          style={styles.titleInput}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (draft.title.trim()) onSubmit?.();
          }}
        />
        {action}
      </View>
      <TextInput
        value={draft.description}
        onChangeText={(description) => setDraft((prev) => ({ ...prev, description }))}
        placeholder="Notes, constraint, or outcome"
        placeholderTextColor={Colors.textTertiary}
        style={styles.descriptionInput}
        multiline
      />
      <View style={styles.fieldGrid}>
        <View style={styles.priorityRow}>
          {PRIORITIES.map((priority) => (
            <Pressable
              key={priority}
              style={[styles.priorityChip, draft.priority === priority && styles.priorityChipActive]}
              onPress={() => setDraft((prev) => ({ ...prev, priority }))}
            >
              <Text style={[styles.priorityChipText, draft.priority === priority && styles.priorityChipTextActive]}>
                {priority}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={draft.category}
          onChangeText={(category) => setDraft((prev) => ({ ...prev, category }))}
          placeholder="Category"
          placeholderTextColor={Colors.textTertiary}
          style={styles.smallInput}
        />
        <TextInput
          value={draft.duration}
          onChangeText={(duration) => setDraft((prev) => ({ ...prev, duration }))}
          placeholder="Min"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="numeric"
          style={styles.smallInput}
        />
        <TextInput
          value={draft.time}
          onChangeText={(time) => setDraft((prev) => ({ ...prev, time }))}
          placeholder="Time"
          placeholderTextColor={Colors.textTertiary}
          style={styles.smallInput}
        />
      </View>
    </View>
  );

  const renderTask = ({ item, isActive }: { item: DailyCommandTask; isActive: boolean }) => {
    const isEditing = editingId === item.id;
    const meta = formatMeta(item);
    const completed = item.completed === true;

    if (isEditing) {
      return (
        <View style={[styles.taskRow, styles.taskRowEditing]}>
          {renderDraftFields(
            editDraft,
            setEditDraft,
            <View style={styles.editActionRow}>
              <Pressable style={styles.iconButton} onPress={() => saveEdit(item.id)} disabled={busy}>
                <Ionicons name="checkmark" size={17} color={Colors.success} />
              </Pressable>
              <Pressable style={styles.iconButton} onPress={() => setEditingId(null)} disabled={busy}>
                <Ionicons name="close" size={17} color={Colors.textSecondary} />
              </Pressable>
            </View>,
            () => saveEdit(item.id),
          )}
        </View>
      );
    }

    return (
      <View style={[styles.taskRow, isActive && styles.taskRowActive]}>
        <Pressable
          style={[styles.checkButton, completed && styles.checkButtonDone]}
          onPress={() => onPatch({ op: 'complete_task', taskId: item.id, completed: !completed })}
          disabled={busy}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
        >
          {completed && <Ionicons name="checkmark" size={13} color={Colors.bg} />}
        </Pressable>
        <View style={styles.taskText}>
          <Text style={[styles.taskTitle, completed && styles.taskTitleDone]} numberOfLines={2}>
            {item.title}
          </Text>
          {(item.description || item.notes) && (
            <Text style={styles.taskDescription} numberOfLines={2}>
              {item.description || item.notes}
            </Text>
          )}
          {meta.length > 0 && (
            <Text style={styles.taskMeta} numberOfLines={1}>
              {meta}
            </Text>
          )}
        </View>
        <View style={styles.taskActions}>
          <Pressable style={styles.iconButton} onPress={() => startEdit(item)} disabled={busy}>
            <Ionicons name="create-outline" size={16} color={Colors.textSecondary} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => onPatch({ op: 'carry_over_task', taskId: item.id })}
            disabled={busy}
          >
            <Ionicons name="arrow-forward-circle-outline" size={16} color={Colors.textSecondary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => deleteTask(item)} disabled={busy}>
            <Ionicons name="trash-outline" size={16} color={Colors.error} />
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.sectionTitle}>Today Plan Editor</Text>
          <Text style={styles.sectionSubtitle}>{orderedTasks.length} task{orderedTasks.length === 1 ? '' : 's'} - drag to reorder</Text>
        </View>
        {busy && <ActivityIndicator size="small" color={Colors.primary} />}
      </View>

      {renderDraftFields(
        addDraft,
        setAddDraft,
        <Pressable
          style={[styles.addButton, !addDraft.title.trim() && styles.addButtonDisabled]}
          onPress={addTask}
          disabled={busy || !addDraft.title.trim()}
        >
          <Ionicons name="add" size={18} color={addDraft.title.trim() ? Colors.bg : Colors.textTertiary} />
        </Pressable>,
        addTask,
      )}

      {orderedTasks.length > 0 ? (
        <SortableList
          data={orderedTasks}
          keyExtractor={(task) => task.id}
          onReorder={(nextTasks) => onPatch({ op: 'reorder_tasks', taskIds: nextTasks.map((task) => task.id) })}
          renderItem={renderTask}
        />
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="calendar-clear-outline" size={18} color={Colors.textTertiary} />
          <Text style={styles.emptyText}>No plan tasks yet.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 14,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  draftBox: {
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
    minHeight: 36,
    borderRadius: 6,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
  },
  descriptionInput: {
    color: Colors.text,
    fontSize: 13,
    minHeight: 54,
    textAlignVertical: 'top',
    borderRadius: 6,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingTop: 9,
  },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 6,
  },
  priorityChip: {
    minHeight: 32,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 6,
    paddingHorizontal: 9,
  },
  priorityChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.greenDim,
  },
  priorityChipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  priorityChipTextActive: {
    color: Colors.primaryLight,
  },
  smallInput: {
    minWidth: 74,
    flexGrow: 1,
    color: Colors.text,
    fontSize: 12,
    minHeight: 32,
    borderRadius: 6,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 9,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  addButtonDisabled: {
    backgroundColor: Colors.surfaceHover,
  },
  editActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    marginVertical: 4,
  },
  taskRowActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceHover,
  },
  taskRowEditing: {
    padding: 0,
    borderColor: Colors.primary,
    backgroundColor: 'transparent',
  },
  checkButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkButtonDone: {
    borderColor: Colors.success,
    backgroundColor: Colors.success,
  },
  taskText: {
    flex: 1,
    minWidth: 0,
  },
  taskTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  taskTitleDone: {
    color: Colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  taskDescription: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  taskMeta: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 5,
  },
  taskActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyState: {
    minHeight: 54,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
});
