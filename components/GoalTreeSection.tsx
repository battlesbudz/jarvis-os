import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';

interface TreeTask {
  id: string;
  title: string;
  description?: string;
  estimateHours?: number;
  status: 'ready' | 'in_progress' | 'blocked' | 'complete';
}

interface TreeMilestone {
  id: string;
  title: string;
  description?: string;
  status: 'ready' | 'in_progress' | 'complete';
  tasks: TreeTask[];
}

interface TreePhase {
  id: string;
  title: string;
  description?: string;
  status: 'ready' | 'in_progress' | 'complete';
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
}

interface Props {
  goalId: string;
  goalTitle: string;
}

const STATUS_COLOR: Record<string, string> = {
  ready: Colors.primary,
  in_progress: '#F59E0B',
  blocked: Colors.textTertiary,
  complete: Colors.success,
};

export default function GoalTreeSection({ goalId, goalTitle }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const jobsQuery = useQuery<JobRow[]>({
    queryKey: ['/api/agent-jobs'],
    refetchInterval: 10000,
  });

  const decomposing = (jobsQuery.data || []).some(
    (j) => j.agentType === 'goal_decompose' && (j.status === 'queued' || j.status === 'running') && j.title.includes(goalTitle),
  );

  const treeQuery = useQuery<GoalTreeRow | { hasTree: false }>({
    queryKey: [`/api/goals/${goalId}/tree`],
    retry: false,
    // While a decompose job for this goal is in flight (queued or
    // running), poll the tree endpoint so the freshly-generated tree
    // appears automatically without the user navigating away.
    refetchInterval: decomposing ? 5000 : false,
  });

  // When the in-flight job count for this goal drops to zero (i.e. the
  // decompose finished), force one immediate refetch so the tree shows
  // up the moment the worker writes it.
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
      // Poll the tree until it appears
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: [`/api/goals/${goalId}/tree`] });
      }, 2000);
    },
  });

  const onToggle = useCallback(() => {
    setExpanded((v) => !v);
    Haptics.selectionAsync();
  }, []);

  const tree = treeQuery.data && 'tree' in treeQuery.data ? treeQuery.data : null;
  const hasTree = !!tree;

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
            {decomposing ? 'Jarvis is breaking this down…' : 'Generate breakdown'}
          </Text>
        </Pressable>
      </View>
    );
  }

  const phases = tree!.tree.phases || [];
  const totalTasks = phases.reduce(
    (n, p) => n + p.milestones.reduce((m, mi) => m + mi.tasks.length, 0),
    0,
  );
  const doneTasks = phases.reduce(
    (n, p) =>
      n +
      p.milestones.reduce(
        (m, mi) => m + mi.tasks.filter((t) => t.status === 'complete').length,
        0,
      ),
    0,
  );

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.8 }]}
        testID={`toggle-tree-${goalId}`}
      >
        <Ionicons name="git-branch-outline" size={16} color={Colors.primary} />
        <Text style={styles.headerText} numberOfLines={1}>
          Plan · {phases.length} phase{phases.length === 1 ? '' : 's'} · {doneTasks}/{totalTasks} tasks done
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={Colors.textSecondary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.treeBody}>
          {tree!.tree.rationale && (
            <Text style={styles.rationale}>{tree!.tree.rationale}</Text>
          )}
          {phases.map((phase, pi) => (
            <View key={phase.id} style={styles.phase}>
              <Text style={styles.phaseTitle}>
                {pi + 1}. {phase.title}
              </Text>
              {phase.milestones.map((ms) => (
                <View key={ms.id} style={styles.milestone}>
                  <Text style={styles.milestoneTitle}>· {ms.title}</Text>
                  {ms.tasks.map((t) => (
                    <View key={t.id} style={styles.task}>
                      <View style={[styles.dot, { backgroundColor: STATUS_COLOR[t.status] || Colors.textTertiary }]} />
                      <Text
                        style={[
                          styles.taskText,
                          t.status === 'complete' && styles.taskDone,
                        ]}
                        numberOfLines={2}
                      >
                        {t.title}
                        {t.estimateHours ? `  ·  ~${t.estimateHours}h` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ))}
          <Pressable
            onPress={() => decomposeMutation.mutate()}
            disabled={decomposeMutation.isPending || decomposing}
            style={({ pressed }) => [styles.regenBtn, pressed && { opacity: 0.85 }]}
            testID={`regenerate-tree-${goalId}`}
          >
            <Ionicons name="refresh" size={14} color={Colors.textSecondary} />
            <Text style={styles.regenText}>
              {decomposing ? 'Regenerating…' : 'Regenerate'}
            </Text>
          </Pressable>
        </View>
      )}
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
  headerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  treeBody: {
    marginTop: 10,
    paddingHorizontal: 4,
    gap: 12,
  },
  rationale: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  phase: {
    gap: 6,
  },
  phaseTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  milestone: {
    paddingLeft: 8,
    gap: 4,
    marginTop: 2,
  },
  milestoneTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
  task: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingLeft: 14,
    paddingVertical: 2,
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
  taskDone: {
    textDecorationLine: 'line-through',
    color: Colors.textTertiary,
  },
  regenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  regenText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
});
