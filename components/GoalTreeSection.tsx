import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import { goalTaskIsInPlan } from '@/lib/goalPlanStatus';
import {
  analyzeGoalTreeUi,
  getTaskDueLabel,
  getTaskUiState,
  type GoalTreeUiTaskState,
} from '@/lib/goalTreeUi';

type TaskStatus = 'ready' | 'in_progress' | 'blocked' | 'complete';
type TreeStatus = 'ready' | 'in_progress' | 'complete';

interface TreeTask {
  id: string;
  title: string;
  description?: string;
  estimateHours?: number;
  status: TaskStatus;
  dueDate?: string;
  injectedOnDates?: string[];
}

interface TreeMilestone {
  id: string;
  title: string;
  description?: string;
  status: TreeStatus;
  tasks: TreeTask[];
}

interface TreePhase {
  id: string;
  title: string;
  description?: string;
  status: TreeStatus;
  milestones: TreeMilestone[];
}

interface GoalTreeRow {
  id: string;
  goalId: string;
  title: string;
  status: string;
  tree: { phases: TreePhase[]; rationale?: string; generatedAt?: string };
}

interface JobRow {
  id: string;
  agentType: string;
  status: string;
  title: string;
  createdAt: string;
  input?: { goalId?: string } | null;
}

interface TodayPlanResponse {
  data: { tasks?: unknown[] } | null;
}

interface Props {
  goalId: string;
  goalTitle: string;
}

type EditorKind = 'phase' | 'milestone' | 'task';
type EditorMode = 'add' | 'edit';

interface EditorState {
  mode: EditorMode;
  kind: EditorKind;
  phaseId?: string;
  milestoneId?: string;
  taskId?: string;
  title: string;
  description: string;
  estimateHours: string;
  status: TaskStatus | TreeStatus;
}

const STATUS_COLOR: Record<string, string> = {
  ready: Colors.primary,
  in_progress: Colors.warning,
  blocked: Colors.textTertiary,
  complete: Colors.success,
};

const TASK_STATUSES: TaskStatus[] = ['ready', 'in_progress', 'blocked', 'complete'];
const TREE_STATUSES: TreeStatus[] = ['ready', 'in_progress', 'complete'];

function statusLabel(status: string): string {
  return status.replace('_', ' ');
}

function formatGeneratedAt(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function taskStateLabel(state: GoalTreeUiTaskState): string | null {
  if (state === 'overdue') return 'Overdue';
  if (state === 'due_today') return 'Due today';
  if (state === 'current') return 'Current';
  if (state === 'next') return 'Next';
  return null;
}

function taskStateColor(state: GoalTreeUiTaskState): string {
  if (state === 'overdue') return Colors.error;
  if (state === 'due_today') return Colors.warning;
  if (state === 'current') return Colors.primary;
  if (state === 'next') return Colors.cyan;
  if (state === 'complete') return Colors.success;
  return Colors.textSecondary;
}

export default function GoalTreeSection({ goalId, goalTitle }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [handoffTaskId, setHandoffTaskId] = useState<string | null>(null);
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<string>>(() => new Set());
  const [reviewVisible, setReviewVisible] = useState(false);

  const jobsQuery = useQuery<JobRow[]>({
    queryKey: ['/api/agent-jobs'],
    refetchInterval: 10000,
  });

  const decomposing = (jobsQuery.data || []).some(
    (j) =>
      j.agentType === 'goal_decompose' &&
      (j.status === 'queued' || j.status === 'running') &&
      j.input?.goalId === goalId,
  );

  const treeQuery = useQuery<GoalTreeRow | { hasTree: false }>({
    queryKey: [`/api/goals/${goalId}/tree`],
    retry: false,
    refetchInterval: decomposing ? 5000 : false,
  });
  const tree = treeQuery.data && 'tree' in treeQuery.data ? treeQuery.data : null;
  const hasTree = !!tree;
  const todayKey = React.useMemo(() => new Date().toISOString().slice(0, 10), []);

  const todayPlanQuery = useQuery<TodayPlanResponse>({
    queryKey: [`/api/data/plans/${todayKey}`],
    enabled: hasTree,
  });

  const previousDecomposingRef = React.useRef(decomposing);
  React.useEffect(() => {
    if (previousDecomposingRef.current && !decomposing) {
      qc.invalidateQueries({ queryKey: [`/api/goals/${goalId}/tree`] });
    }
    previousDecomposingRef.current = decomposing;
  }, [decomposing, goalId, qc]);

  const decomposeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/goals/${goalId}/decompose`, {});
      return res.json();
    },
    onSuccess: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      qc.invalidateQueries({ queryKey: ['/api/agent-jobs'] });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: [`/api/goals/${goalId}/tree`] });
      }, 2000);
    },
  });

  const editMutation = useMutation({
    mutationFn: async (action: Record<string, unknown>) => {
      const res = await apiRequest('PATCH', `/api/goals/${goalId}/tree`, { action });
      return res.json();
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditor(null);
      qc.invalidateQueries({ queryKey: [`/api/goals/${goalId}/tree`] });
    },
  });

  const addToTodayMutation = useMutation({
    mutationFn: async (taskId: string) => {
      setHandoffTaskId(taskId);
      const res = await apiRequest('POST', `/api/goals/${goalId}/tree/tasks/${taskId}/add-to-today`, {});
      return res.json();
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: [`/api/goals/${goalId}/tree`] });
      qc.invalidateQueries({ queryKey: ['/api/data/plans'] });
      qc.invalidateQueries({ queryKey: [`/api/data/plans/${todayKey}`] });
    },
    onSettled: () => setHandoffTaskId(null),
  });

  const onToggle = useCallback(() => {
    setExpanded((v) => !v);
    Haptics.selectionAsync();
  }, []);

  const togglePhase = useCallback((phaseId: string) => {
    setCollapsedPhaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
    Haptics.selectionAsync();
  }, []);

  const phases = tree?.tree.phases || [];
  const analysis = analyzeGoalTreeUi(phases, todayKey);
  const summary = analysis.summary;
  const generatedAtLabel = formatGeneratedAt(tree?.tree.generatedAt);
  const canAddToToday = (task: TreeTask): boolean => task.status === 'ready' || task.status === 'in_progress';
  const isTaskInToday = (task: TreeTask): boolean => {
    if (!tree) return false;
    return goalTaskIsInPlan(todayPlanQuery.data?.data, tree.id, task.id);
  };
  const addTaskToToday = (task: TreeTask) => {
    if (!canAddToToday(task) || isTaskInToday(task) || addToTodayMutation.isPending) return;
    addToTodayMutation.mutate(task.id);
  };
  const movePhase = (phaseId: string, direction: 'up' | 'down') => {
    editMutation.mutate({ type: 'move_phase', phaseId, direction });
  };
  const moveMilestone = (phaseId: string, milestoneId: string, direction: 'up' | 'down') => {
    editMutation.mutate({ type: 'move_milestone', phaseId, milestoneId, direction });
  };
  const moveTask = (phaseId: string, milestoneId: string, taskId: string, direction: 'up' | 'down') => {
    editMutation.mutate({ type: 'move_task', phaseId, milestoneId, taskId, direction });
  };

  const openAddPhase = () => {
    setEditor({
      mode: 'add',
      kind: 'phase',
      title: '',
      description: '',
      estimateHours: '',
      status: 'ready',
    });
  };

  const openEditPhase = (phase: TreePhase) => {
    setEditor({
      mode: 'edit',
      kind: 'phase',
      phaseId: phase.id,
      title: phase.title,
      description: phase.description || '',
      estimateHours: '',
      status: phase.status,
    });
  };

  const openAddMilestone = (phaseId: string) => {
    setEditor({
      mode: 'add',
      kind: 'milestone',
      phaseId,
      title: '',
      description: '',
      estimateHours: '',
      status: 'ready',
    });
  };

  const openEditMilestone = (phaseId: string, milestone: TreeMilestone) => {
    setEditor({
      mode: 'edit',
      kind: 'milestone',
      phaseId,
      milestoneId: milestone.id,
      title: milestone.title,
      description: milestone.description || '',
      estimateHours: '',
      status: milestone.status,
    });
  };

  const openAddTask = (phaseId: string, milestoneId: string) => {
    setEditor({
      mode: 'add',
      kind: 'task',
      phaseId,
      milestoneId,
      title: '',
      description: '',
      estimateHours: '1',
      status: 'ready',
    });
  };

  const openEditTask = (phaseId: string, milestoneId: string, task: TreeTask) => {
    setEditor({
      mode: 'edit',
      kind: 'task',
      phaseId,
      milestoneId,
      taskId: task.id,
      title: task.title,
      description: task.description || '',
      estimateHours: task.estimateHours ? String(task.estimateHours) : '',
      status: task.status,
    });
  };

  const saveEditor = () => {
    if (!editor || !editor.title.trim()) return;

    if (editor.mode === 'add' && editor.kind === 'phase') {
      editMutation.mutate({
        type: 'add_phase',
        phase: { title: editor.title, description: editor.description },
      });
      return;
    }

    if (editor.mode === 'edit' && editor.kind === 'phase') {
      editMutation.mutate({
        type: 'update_phase',
        phaseId: editor.phaseId,
        patch: {
          title: editor.title,
          description: editor.description,
          status: editor.status,
        },
      });
      return;
    }

    if (editor.mode === 'add' && editor.kind === 'milestone') {
      editMutation.mutate({
        type: 'add_milestone',
        phaseId: editor.phaseId,
        milestone: { title: editor.title, description: editor.description },
      });
      return;
    }

    if (editor.mode === 'edit' && editor.kind === 'milestone') {
      editMutation.mutate({
        type: 'update_milestone',
        phaseId: editor.phaseId,
        milestoneId: editor.milestoneId,
        patch: {
          title: editor.title,
          description: editor.description,
          status: editor.status,
        },
      });
      return;
    }

    if (editor.mode === 'add' && editor.kind === 'task') {
      editMutation.mutate({
        type: 'add_task',
        phaseId: editor.phaseId,
        milestoneId: editor.milestoneId,
        task: {
          title: editor.title,
          description: editor.description,
          estimateHours: editor.estimateHours,
        },
      });
      return;
    }

    editMutation.mutate({
      type: 'update_task',
      phaseId: editor.phaseId,
      milestoneId: editor.milestoneId,
      taskId: editor.taskId,
      patch: {
        title: editor.title,
        description: editor.description,
        estimateHours: editor.estimateHours,
        status: editor.status,
      },
    });
  };

  const deleteEditorTarget = () => {
    if (!editor || editor.mode !== 'edit') return;
    if (editor.kind === 'phase') {
      editMutation.mutate({ type: 'delete_phase', phaseId: editor.phaseId });
    } else if (editor.kind === 'milestone') {
      editMutation.mutate({
        type: 'delete_milestone',
        phaseId: editor.phaseId,
        milestoneId: editor.milestoneId,
      });
    } else {
      editMutation.mutate({
        type: 'delete_task',
        phaseId: editor.phaseId,
        milestoneId: editor.milestoneId,
        taskId: editor.taskId,
      });
    }
  };

  if (treeQuery.isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={Colors.primary} size="small" />
      </View>
    );
  }

  if (!hasTree) {
    return (
      <View style={styles.container}>
        <Pressable
          onPress={() => decomposeMutation.mutate()}
          disabled={decomposeMutation.isPending || decomposing}
          style={({ pressed }) => [styles.generateBtn, pressed && { opacity: 0.85 }]}
          testID={`generate-tree-${goalId}`}
        >
          <Ionicons
            name={decomposing ? 'hourglass-outline' : 'git-branch-outline'}
            size={16}
            color={Colors.primary}
          />
          <Text style={styles.generateBtnText}>
            {decomposing ? 'Jarvis is breaking this down...' : 'Generate breakdown'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.8 }]}
        testID={`toggle-tree-${goalId}`}
      >
        <Ionicons name="git-branch-outline" size={16} color={Colors.primary} />
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerText} numberOfLines={1}>
            Plan: {summary.percent}% complete
          </Text>
          <Text style={styles.headerSubtext} numberOfLines={1}>
            {phases.length} phase{phases.length === 1 ? '' : 's'} / {summary.done}/{summary.total} tasks done
            {summary.overdue > 0 ? ` / ${summary.overdue} overdue` : ''}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={Colors.textSecondary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.treeBody}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${summary.percent}%` }]} />
          </View>
          <View style={styles.reviewStrip}>
            <View style={styles.reviewStat}>
              <Text style={styles.reviewValue}>{summary.active + summary.ready}</Text>
              <Text style={styles.reviewLabel}>open</Text>
            </View>
            <View style={styles.reviewStat}>
              <Text style={[styles.reviewValue, summary.overdue > 0 && styles.reviewValueWarning]}>
                {summary.overdue}
              </Text>
              <Text style={styles.reviewLabel}>overdue</Text>
            </View>
            <View style={styles.reviewStat}>
              <Text style={styles.reviewValue}>{analysis.handoffHistory.length}</Text>
              <Text style={styles.reviewLabel}>handed off</Text>
            </View>
            {!!generatedAtLabel && (
              <View style={styles.reviewStat}>
                <Text style={styles.reviewValueSmall}>{generatedAtLabel}</Text>
                <Text style={styles.reviewLabel}>generated</Text>
              </View>
            )}
          </View>

          {analysis.nextTask && (
            <View style={styles.nextTaskBox}>
              <Ionicons name="navigate-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.nextTaskText} numberOfLines={2}>
                Next: {analysis.nextTask.title}
              </Text>
              <Pressable
                onPress={() => addTaskToToday(analysis.nextTask!)}
                disabled={isTaskInToday(analysis.nextTask) || addToTodayMutation.isPending}
                style={({ pressed }) => [
                  styles.todayBtn,
                  isTaskInToday(analysis.nextTask!) && styles.todayBtnActive,
                  pressed && { opacity: 0.75 },
                  addToTodayMutation.isPending && styles.disabledBtn,
                ]}
                testID={`add-next-task-today-${goalId}`}
              >
                {handoffTaskId === analysis.nextTask.id ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : isTaskInToday(analysis.nextTask) ? (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={13} color={Colors.success} />
                    <Text style={[styles.todayBtnText, styles.todayBtnTextActive]}>In today</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="calendar-outline" size={13} color={Colors.primary} />
                    <Text style={styles.todayBtnText}>Today</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
          {addToTodayMutation.isError && (
            <Text style={styles.errorText}>Could not add that task to today.</Text>
          )}
          {analysis.handoffHistory.length > 0 && (
            <View style={styles.handoffHistory}>
              <Text style={styles.handoffHistoryTitle}>Recent daily handoffs</Text>
              {analysis.handoffHistory.slice(0, 3).map((item) => (
                <View key={`${item.taskId}-${item.date}`} style={styles.handoffHistoryRow}>
                  <Ionicons name="calendar-outline" size={13} color={Colors.textSecondary} />
                  <Text style={styles.handoffHistoryText} numberOfLines={1}>
                    {item.date}: {item.taskTitle}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {tree!.tree.rationale && <Text style={styles.rationale}>{tree!.tree.rationale}</Text>}

          {phases.map((phase, pi) => {
            const phaseCollapsed = collapsedPhaseIds.has(phase.id);
            const phaseIsCurrent = analysis.currentPhaseId === phase.id;
            const phaseOpenTasks = phase.milestones.reduce(
              (count, milestone) => count + milestone.tasks.filter((task) => task.status !== 'complete').length,
              0,
            );
            return (
              <View key={phase.id} style={[styles.phase, phaseIsCurrent && styles.phaseCurrent]}>
                <View style={styles.phaseHeader}>
                  <Pressable
                    onPress={() => togglePhase(phase.id)}
                    style={({ pressed }) => [styles.phaseToggle, pressed && styles.pressedRow]}
                    testID={`toggle-phase-${phase.id}`}
                  >
                    <Ionicons
                      name={phaseCollapsed ? 'chevron-forward' : 'chevron-down'}
                      size={14}
                      color={Colors.textSecondary}
                    />
                    <View style={[styles.statusPill, { borderColor: STATUS_COLOR[phase.status] }]}>
                      <Text style={[styles.statusPillText, { color: STATUS_COLOR[phase.status] }]}>
                        {phaseIsCurrent ? 'current' : statusLabel(phase.status)}
                      </Text>
                    </View>
                    <View style={styles.phaseTitleWrap}>
                      <Text style={styles.phaseTitle} numberOfLines={2}>
                        {pi + 1}. {phase.title}
                      </Text>
                      <Text style={styles.phaseMeta} numberOfLines={1}>
                        {phaseOpenTasks} open task{phaseOpenTasks === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => openEditPhase(phase)}
                    style={({ pressed }) => [styles.rowIconBtn, pressed && { opacity: 0.75 }]}
                    testID={`edit-phase-${phase.id}`}
                  >
                    <Ionicons name="create-outline" size={15} color={Colors.textSecondary} />
                  </Pressable>
                  <View style={styles.reorderButtons}>
                    <Pressable
                      onPress={() => movePhase(phase.id, 'up')}
                      disabled={pi === 0 || editMutation.isPending}
                      style={({ pressed }) => [
                        styles.reorderBtn,
                        (pi === 0 || editMutation.isPending) && styles.disabledBtn,
                        pressed && { opacity: 0.75 },
                      ]}
                      testID={`move-phase-up-${phase.id}`}
                    >
                      <Ionicons name="arrow-up" size={12} color={Colors.textSecondary} />
                    </Pressable>
                    <Pressable
                      onPress={() => movePhase(phase.id, 'down')}
                      disabled={pi === phases.length - 1 || editMutation.isPending}
                      style={({ pressed }) => [
                        styles.reorderBtn,
                        (pi === phases.length - 1 || editMutation.isPending) && styles.disabledBtn,
                        pressed && { opacity: 0.75 },
                      ]}
                      testID={`move-phase-down-${phase.id}`}
                    >
                      <Ionicons name="arrow-down" size={12} color={Colors.textSecondary} />
                    </Pressable>
                  </View>
                </View>

                {!phaseCollapsed && (
                  <>
                    {phase.milestones.map((milestone, mi) => (
                      <View key={milestone.id} style={styles.milestone}>
                        <View style={styles.milestoneHeader}>
                          <Pressable
                            onPress={() => openEditMilestone(phase.id, milestone)}
                            style={({ pressed }) => [styles.milestoneTitleBtn, pressed && styles.pressedRow]}
                            testID={`edit-milestone-${milestone.id}`}
                          >
                            <View style={[styles.dot, { backgroundColor: STATUS_COLOR[milestone.status] || Colors.textTertiary }]} />
                            <Text style={styles.milestoneTitle} numberOfLines={2}>
                              {milestone.title}
                            </Text>
                            {analysis.currentMilestoneId === milestone.id && (
                              <View style={styles.miniStateChip}>
                                <Text style={styles.miniStateChipText}>Current</Text>
                              </View>
                            )}
                          </Pressable>
                          <Pressable
                            onPress={() => openEditMilestone(phase.id, milestone)}
                            style={({ pressed }) => [styles.rowIconBtn, pressed && { opacity: 0.75 }]}
                            testID={`edit-milestone-icon-${milestone.id}`}
                          >
                            <Ionicons name="create-outline" size={14} color={Colors.textSecondary} />
                          </Pressable>
                          <View style={styles.reorderButtons}>
                            <Pressable
                              onPress={() => moveMilestone(phase.id, milestone.id, 'up')}
                              disabled={mi === 0 || editMutation.isPending}
                              style={({ pressed }) => [
                                styles.reorderBtn,
                                (mi === 0 || editMutation.isPending) && styles.disabledBtn,
                                pressed && { opacity: 0.75 },
                              ]}
                              testID={`move-milestone-up-${milestone.id}`}
                            >
                              <Ionicons name="arrow-up" size={12} color={Colors.textSecondary} />
                            </Pressable>
                            <Pressable
                              onPress={() => moveMilestone(phase.id, milestone.id, 'down')}
                              disabled={mi === phase.milestones.length - 1 || editMutation.isPending}
                              style={({ pressed }) => [
                                styles.reorderBtn,
                                (mi === phase.milestones.length - 1 || editMutation.isPending) && styles.disabledBtn,
                                pressed && { opacity: 0.75 },
                              ]}
                              testID={`move-milestone-down-${milestone.id}`}
                            >
                              <Ionicons name="arrow-down" size={12} color={Colors.textSecondary} />
                            </Pressable>
                          </View>
                        </View>

                        {milestone.tasks.map((task, ti) => {
                          const taskState = getTaskUiState(task, todayKey, analysis.nextTask?.id === task.id);
                          const taskChipLabel = taskStateLabel(taskState) || getTaskDueLabel(task.dueDate, todayKey);
                          const chipColor = taskStateColor(taskState);
                          return (
                            <Pressable
                              key={task.id}
                              onPress={() => openEditTask(phase.id, milestone.id, task)}
                              style={({ pressed }) => [styles.task, pressed && styles.pressedRow]}
                              testID={`edit-task-${task.id}`}
                            >
                              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[task.status] || Colors.textTertiary }]} />
                              <Text
                                style={[styles.taskText, task.status === 'complete' && styles.taskDone]}
                                numberOfLines={2}
                              >
                                {task.title}
                                {task.estimateHours ? `  /  ~${task.estimateHours}h` : ''}
                              </Text>
                              {!!taskChipLabel && (
                                <View style={[styles.taskStateChip, { borderColor: chipColor + '66', backgroundColor: chipColor + '12' }]}>
                                  <Text style={[styles.taskStateChipText, { color: chipColor }]}>
                                    {taskChipLabel}
                                  </Text>
                                </View>
                              )}
                              <View style={styles.reorderButtons}>
                                <Pressable
                                  onPress={(event) => {
                                    event.stopPropagation();
                                    moveTask(phase.id, milestone.id, task.id, 'up');
                                  }}
                                  disabled={ti === 0 || editMutation.isPending}
                                  style={({ pressed }) => [
                                    styles.reorderBtn,
                                    (ti === 0 || editMutation.isPending) && styles.disabledBtn,
                                    pressed && { opacity: 0.75 },
                                  ]}
                                  testID={`move-task-up-${task.id}`}
                                >
                                  <Ionicons name="arrow-up" size={12} color={Colors.textSecondary} />
                                </Pressable>
                                <Pressable
                                  onPress={(event) => {
                                    event.stopPropagation();
                                    moveTask(phase.id, milestone.id, task.id, 'down');
                                  }}
                                  disabled={ti === milestone.tasks.length - 1 || editMutation.isPending}
                                  style={({ pressed }) => [
                                    styles.reorderBtn,
                                    (ti === milestone.tasks.length - 1 || editMutation.isPending) && styles.disabledBtn,
                                    pressed && { opacity: 0.75 },
                                  ]}
                                  testID={`move-task-down-${task.id}`}
                                >
                                  <Ionicons name="arrow-down" size={12} color={Colors.textSecondary} />
                                </Pressable>
                              </View>
                              {canAddToToday(task) && (
                                <Pressable
                                  onPress={(event) => {
                                    event.stopPropagation();
                                    addTaskToToday(task);
                                  }}
                                  disabled={isTaskInToday(task) || addToTodayMutation.isPending}
                                  style={({ pressed }) => [
                                    styles.taskTodayChip,
                                    isTaskInToday(task) && styles.taskTodayChipActive,
                                    pressed && { opacity: 0.75 },
                                    addToTodayMutation.isPending && styles.disabledBtn,
                                  ]}
                                  testID={`add-task-today-${task.id}`}
                                >
                                  {handoffTaskId === task.id ? (
                                    <ActivityIndicator size="small" color={Colors.primary} />
                                  ) : isTaskInToday(task) ? (
                                    <>
                                      <Ionicons name="checkmark-circle-outline" size={13} color={Colors.success} />
                                      <Text style={[styles.taskTodayChipText, styles.taskTodayChipTextActive]}>
                                        In today
                                      </Text>
                                    </>
                                  ) : (
                                    <>
                                      <Ionicons name="calendar-outline" size={13} color={Colors.primary} />
                                      <Text style={styles.taskTodayChipText}>Today</Text>
                                    </>
                                  )}
                                </Pressable>
                              )}
                              <Ionicons name="create-outline" size={13} color={Colors.textTertiary} />
                            </Pressable>
                          );
                        })}

                        <Pressable
                          onPress={() => openAddTask(phase.id, milestone.id)}
                          style={({ pressed }) => [styles.inlineAddBtn, pressed && { opacity: 0.75 }]}
                          testID={`add-task-${milestone.id}`}
                        >
                          <Ionicons name="add" size={14} color={Colors.primary} />
                          <Text style={styles.inlineAddText}>Task</Text>
                        </Pressable>
                      </View>
                    ))}

                    <Pressable
                      onPress={() => openAddMilestone(phase.id)}
                      style={({ pressed }) => [styles.inlineAddBtn, pressed && { opacity: 0.75 }]}
                      testID={`add-milestone-${phase.id}`}
                    >
                      <Ionicons name="add-circle-outline" size={14} color={Colors.primary} />
                      <Text style={styles.inlineAddText}>Milestone</Text>
                    </Pressable>
                  </>
                )}
              </View>
            );
          })}

          <View style={styles.footerActions}>
            <Pressable
              onPress={() => setReviewVisible(true)}
              style={({ pressed }) => [styles.footerBtn, pressed && { opacity: 0.85 }]}
              testID={`review-tree-${goalId}`}
            >
              <Ionicons name="reader-outline" size={14} color={Colors.primary} />
              <Text style={styles.footerBtnText}>Review plan</Text>
            </Pressable>
            <Pressable
              onPress={openAddPhase}
              style={({ pressed }) => [styles.footerBtn, pressed && { opacity: 0.85 }]}
              testID={`add-phase-${goalId}`}
            >
              <Ionicons name="layers-outline" size={14} color={Colors.primary} />
              <Text style={styles.footerBtnText}>Add phase</Text>
            </Pressable>
            <Pressable
              onPress={() => decomposeMutation.mutate()}
              disabled={decomposeMutation.isPending || decomposing}
              style={({ pressed }) => [styles.footerBtn, pressed && { opacity: 0.85 }]}
              testID={`regenerate-tree-${goalId}`}
            >
              <Ionicons name="refresh" size={14} color={Colors.textSecondary} />
              <Text style={styles.regenText}>{decomposing ? 'Regenerating...' : 'Regenerate'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Modal
        visible={reviewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReviewVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalEyebrow}>{goalTitle}</Text>
                <Text style={styles.modalTitle}>Review generated plan</Text>
              </View>
              <Pressable
                onPress={() => setReviewVisible(false)}
                style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="close" size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody}>
              <View style={styles.reviewModalGrid}>
                <View style={styles.reviewModalStat}>
                  <Text style={styles.reviewValue}>{summary.percent}%</Text>
                  <Text style={styles.reviewLabel}>complete</Text>
                </View>
                <View style={styles.reviewModalStat}>
                  <Text style={styles.reviewValue}>{summary.active + summary.ready}</Text>
                  <Text style={styles.reviewLabel}>open</Text>
                </View>
                <View style={styles.reviewModalStat}>
                  <Text style={[styles.reviewValue, summary.overdue > 0 && styles.reviewValueWarning]}>
                    {summary.overdue}
                  </Text>
                  <Text style={styles.reviewLabel}>overdue</Text>
                </View>
              </View>

              {!!analysis.nextTask && (
                <View style={styles.reviewModalSection}>
                  <Text style={styles.reviewModalTitle}>Next useful action</Text>
                  <Text style={styles.reviewModalText}>{analysis.nextTask.title}</Text>
                </View>
              )}

              {!!tree!.tree.rationale && (
                <View style={styles.reviewModalSection}>
                  <Text style={styles.reviewModalTitle}>Plan rationale</Text>
                  <Text style={styles.reviewModalText}>{tree!.tree.rationale}</Text>
                </View>
              )}

              <View style={styles.reviewModalSection}>
                <Text style={styles.reviewModalTitle}>Recent handoffs</Text>
                {analysis.handoffHistory.length > 0 ? (
                  analysis.handoffHistory.slice(0, 5).map((item) => (
                    <Text key={`${item.taskId}-${item.date}`} style={styles.reviewModalText}>
                      {item.date}: {item.taskTitle}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.reviewModalText}>No goal tasks have been handed off yet.</Text>
                )}
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setReviewVisible(false)}
                style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.saveBtnText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!editor}
        transparent
        animationType="fade"
        onRequestClose={() => setEditor(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalEyebrow}>{goalTitle}</Text>
                <Text style={styles.modalTitle}>
                  {editor?.mode === 'add' ? 'Add' : 'Edit'} {editor?.kind}
                </Text>
              </View>
              <Pressable
                onPress={() => setEditor(null)}
                style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="close" size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>Title</Text>
              <TextInput
                value={editor?.title || ''}
                onChangeText={(title) => setEditor((v) => (v ? { ...v, title } : v))}
                placeholder="Name this step"
                placeholderTextColor={Colors.textTertiary}
                style={styles.input}
              />

              <Text style={styles.inputLabel}>Description</Text>
              <TextInput
                value={editor?.description || ''}
                onChangeText={(description) => setEditor((v) => (v ? { ...v, description } : v))}
                placeholder="What done looks like"
                placeholderTextColor={Colors.textTertiary}
                style={[styles.input, styles.textArea]}
                multiline
              />

              {editor?.kind === 'task' && (
                <>
                  <Text style={styles.inputLabel}>Estimate hours</Text>
                  <TextInput
                    value={editor.estimateHours}
                    onChangeText={(estimateHours) => setEditor((v) => (v ? { ...v, estimateHours } : v))}
                    placeholder="1"
                    placeholderTextColor={Colors.textTertiary}
                    style={styles.input}
                    keyboardType="decimal-pad"
                  />
                </>
              )}

              {editor?.mode === 'edit' && (
                <>
                  <Text style={styles.inputLabel}>Status</Text>
                  <View style={styles.statusRow}>
                    {(editor.kind === 'task' ? TASK_STATUSES : TREE_STATUSES).map((status) => (
                      <Pressable
                        key={status}
                        onPress={() => setEditor((v) => (v ? { ...v, status } : v))}
                        style={[
                          styles.statusChip,
                          editor.status === status && {
                            borderColor: STATUS_COLOR[status],
                            backgroundColor: `${STATUS_COLOR[status]}22`,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusChipText,
                            editor.status === status && { color: STATUS_COLOR[status] },
                          ]}
                        >
                          {statusLabel(status)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>

            {editMutation.isError && (
              <Text style={styles.errorText}>
                {editMutation.error instanceof Error ? editMutation.error.message : 'Could not save change'}
              </Text>
            )}

            <View style={styles.modalActions}>
              {editor?.mode === 'edit' && (
                <Pressable
                  onPress={deleteEditorTarget}
                  disabled={editMutation.isPending}
                  style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="trash-outline" size={15} color={Colors.error} />
                </Pressable>
              )}
              <Pressable
                onPress={() => setEditor(null)}
                style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveEditor}
                disabled={editMutation.isPending || !editor?.title.trim()}
                style={({ pressed }) => [
                  styles.saveBtn,
                  (editMutation.isPending || !editor?.title.trim()) && styles.disabledBtn,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.saveBtnText}>{editMutation.isPending ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: -8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '12',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  generateBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '0F',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  headerSubtext: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
  },
  treeBody: {
    marginTop: 10,
    paddingHorizontal: 4,
    gap: 12,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: Colors.border,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  reviewStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reviewStat: {
    minWidth: 70,
    flexGrow: 1,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    paddingVertical: 8,
    paddingHorizontal: 9,
  },
  reviewValue: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  reviewValueWarning: {
    color: Colors.error,
  },
  reviewValueSmall: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  reviewLabel: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
  },
  reviewModalGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  reviewModalStat: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    padding: 10,
  },
  reviewModalSection: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
    marginTop: 12,
  },
  reviewModalTitle: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    textTransform: 'uppercase',
  },
  reviewModalText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  nextTaskBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
  },
  nextTaskText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    lineHeight: 17,
  },
  todayBtn: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '55',
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  todayBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
  },
  todayBtnActive: {
    borderColor: Colors.success + '55',
    backgroundColor: Colors.success + '12',
  },
  todayBtnTextActive: {
    color: Colors.success,
  },
  rationale: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  handoffHistory: {
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    padding: 10,
  },
  handoffHistoryTitle: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    textTransform: 'uppercase',
  },
  handoffHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  handoffHistoryText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  phase: {
    gap: 6,
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
    paddingLeft: 10,
  },
  phaseCurrent: {
    borderLeftColor: Colors.primary,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  phaseToggle: {
    flex: 1,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
  },
  phaseTitleWrap: {
    flex: 1,
  },
  phaseTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    lineHeight: 19,
  },
  phaseMeta: {
    marginTop: 1,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  rowIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  reorderButtons: {
    flexDirection: 'row',
    gap: 3,
  },
  reorderBtn: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  statusPillText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
  },
  milestone: {
    paddingLeft: 8,
    gap: 4,
    marginTop: 2,
  },
  milestoneHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 3,
  },
  milestoneTitleBtn: {
    flex: 1,
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 8,
  },
  milestoneTitle: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  miniStateChip: {
    borderRadius: 999,
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  miniStateChipText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
    textTransform: 'uppercase',
  },
  task: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingLeft: 14,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pressedRow: {
    backgroundColor: Colors.surfaceHover,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  taskText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 17,
  },
  taskStateChip: {
    minHeight: 24,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
  },
  taskStateChipText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
  },
  taskDone: {
    textDecorationLine: 'line-through',
    color: Colors.textTertiary,
  },
  taskTodayChip: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 7,
  },
  taskTodayChipActive: {
    backgroundColor: Colors.success + '12',
  },
  taskTodayChipText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
  },
  taskTodayChipTextActive: {
    color: Colors.success,
  },
  inlineAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  inlineAddText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  footerBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  regenText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
    backgroundColor: Colors.overlay,
  },
  modalCard: {
    maxHeight: Platform.OS === 'web' ? '86%' : '82%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalEyebrow: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
  },
  modalTitle: {
    marginTop: 3,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  modalBody: {
    padding: 16,
  },
  inputLabel: {
    marginBottom: 7,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  textArea: {
    minHeight: 86,
    textAlignVertical: 'top',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  statusChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusChipText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
    textTransform: 'capitalize',
  },
  errorText: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.error,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  deleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.errorDim,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
  },
  saveBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  disabledBtn: {
    opacity: 0.45,
  },
  saveBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.black,
  },
});
