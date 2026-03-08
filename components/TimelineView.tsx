import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { Task } from '@/lib/storage';
import { getCategoryColor } from '@/lib/helpers';

interface TimelineViewProps {
  tasks: Task[];
  onToggle: (id: string, completed: boolean) => void;
}

const HOUR_HEIGHT = 80;
const START_HOUR = 6;
const END_HOUR = 22;
const TASK_DURATION_MIN = 60;
const LEFT_MARGIN = 10;

interface ScheduledItem {
  task: Task;
  hour: number;
  minute: number;
  column: number;
  totalColumns: number;
}

function assignColumns(
  items: { task: Task; hour: number; minute: number }[]
): ScheduledItem[] {
  const result: ScheduledItem[] = items.map(item => ({
    ...item,
    column: 0,
    totalColumns: 1,
  }));

  for (let i = 0; i < result.length; i++) {
    const startI = result[i].hour * 60 + result[i].minute;
    const endI = startI + TASK_DURATION_MIN;

    const group: number[] = [i];
    for (let j = 0; j < result.length; j++) {
      if (i === j) continue;
      const startJ = result[j].hour * 60 + result[j].minute;
      const endJ = startJ + TASK_DURATION_MIN;
      if (startJ < endI && endJ > startI) {
        group.push(j);
      }
    }

    if (group.length > 1) {
      group.sort((a, b) => a - b);
      group.forEach((idx, col) => {
        result[idx].column = col;
        result[idx].totalColumns = group.length;
      });
    }
  }

  return result;
}

export default function TimelineView({ tasks, onToggle }: TimelineViewProps) {
  const [gridWidth, setGridWidth] = useState(0);

  const { scheduledTasks, unscheduledTasks } = useMemo(() => {
    const scheduled: { task: Task; hour: number; minute: number }[] = [];
    const unscheduled: Task[] = [];

    tasks.forEach((task) => {
      if (task.time) {
        const timeMatch = task.time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (timeMatch) {
          let hour = parseInt(timeMatch[1], 10);
          const minute = parseInt(timeMatch[2], 10);
          const ampm = timeMatch[3]?.toUpperCase();

          if (ampm === 'PM' && hour < 12) hour += 12;
          if (ampm === 'AM' && hour === 12) hour = 0;

          scheduled.push({ task, hour, minute });
        } else {
          unscheduled.push(task);
        }
      } else {
        unscheduled.push(task);
      }
    });

    return { scheduledTasks: assignColumns(scheduled), unscheduledTasks: unscheduled };
  }, [tasks]);

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  const handleGridLayout = (e: LayoutChangeEvent) => {
    setGridWidth(e.nativeEvent.layout.width);
  };

  return (
    <View style={styles.container}>
      {unscheduledTasks.length > 0 && (
        <View style={styles.unscheduledSection}>
          <Text style={styles.sectionTitle}>Unscheduled</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unscheduledScroll}>
            {unscheduledTasks.map((task) => (
              <Pressable
                key={task.id}
                onPress={() => onToggle(task.id, !task.completed)}
                style={[
                  styles.unscheduledCard,
                  { borderLeftColor: getCategoryColor(task.category) },
                  task.completed && styles.completedTask
                ]}
              >
                <Ionicons
                  name={task.completed ? "checkmark-circle" : "ellipse-outline"}
                  size={16}
                  color={task.completed ? Colors.success : getCategoryColor(task.category)}
                />
                <Text style={[styles.unscheduledText, task.completed && styles.completedText]} numberOfLines={1}>
                  {task.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.timelineScroll}>
        <View style={styles.timelineContainer}>
          <View style={styles.timeLabelsColumn}>
            {hours.map((hour) => (
              <View key={hour} style={styles.hourLabelContainer}>
                <Text style={styles.hourLabel}>
                  {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.gridColumn} onLayout={handleGridLayout}>
            {hours.map((hour, index) => (
              <View
                key={hour}
                style={[
                  styles.hourGridLine,
                  { top: index * HOUR_HEIGHT + HOUR_HEIGHT / 2 },
                ]}
              />
            ))}

            {gridWidth > 0 && scheduledTasks.map(({ task, hour, minute, column, totalColumns }) => {
              if (hour < START_HOUR || hour > END_HOUR) return null;

              const top = (hour - START_HOUR) * HOUR_HEIGHT + (minute / 60) * HOUR_HEIGHT;
              const categoryColor = getCategoryColor(task.category);
              const availableWidth = gridWidth - LEFT_MARGIN;
              const colWidth = availableWidth / totalColumns;
              const blockLeft = LEFT_MARGIN + column * colWidth;
              const blockWidth = colWidth - (totalColumns > 1 ? 4 : 0);

              return (
                <Pressable
                  key={task.id}
                  onPress={() => onToggle(task.id, !task.completed)}
                  style={[
                    styles.taskBlock,
                    {
                      top,
                      left: blockLeft,
                      width: blockWidth,
                      borderLeftColor: categoryColor,
                      backgroundColor: categoryColor + '10',
                    },
                    task.completed && styles.completedTask,
                  ]}
                >
                  <View style={styles.taskHeader}>
                    <Ionicons
                      name={task.completed ? "checkmark-circle" : "ellipse-outline"}
                      size={16}
                      color={task.completed ? Colors.success : categoryColor}
                    />
                    <Text style={[styles.taskTitle, task.completed && styles.completedText]} numberOfLines={2}>
                      {task.title}
                    </Text>
                  </View>
                  <Text style={styles.taskTime}>{task.time}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  unscheduledSection: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.white,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    marginLeft: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  unscheduledScroll: {
    paddingHorizontal: 20,
    gap: 10,
  },
  unscheduledCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    minWidth: 140,
    maxWidth: 200,
    gap: 8,
  },
  unscheduledText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
    flex: 1,
  },
  timelineScroll: {
    paddingBottom: 40,
  },
  timelineContainer: {
    flexDirection: 'row',
    paddingRight: 20,
  },
  timeLabelsColumn: {
    width: 60,
    alignItems: 'center',
    paddingTop: HOUR_HEIGHT / 2 - 10,
  },
  hourLabelContainer: {
    height: HOUR_HEIGHT,
  },
  hourLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textTertiary,
  },
  gridColumn: {
    flex: 1,
    paddingTop: HOUR_HEIGHT / 2,
    position: 'relative',
    minHeight: (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT,
  },
  hourGridLine: {
    height: 1,
    backgroundColor: Colors.border,
    position: 'absolute',
    left: 0,
    right: 0,
  },
  taskBlock: {
    position: 'absolute',
    minHeight: 50,
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    zIndex: 1,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  taskTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    flex: 1,
    lineHeight: 17,
  },
  taskTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 3,
    marginLeft: 22,
  },
  completedTask: {
    opacity: 0.6,
    backgroundColor: Colors.surface,
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: Colors.textTertiary,
  },
});
