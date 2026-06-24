import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';

interface JarvisTask {
  title: string;
  category: string;
  priority: string;
  duration?: number;
  time?: string;
  description?: string;
}

interface JarvisPlanModalProps {
  visible: boolean;
  loading: boolean;
  reasoning: string;
  tasks: JarvisTask[];
  onAccept: () => void;
  onDismiss: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  fitness: '#10B981',
  finance: '#F59E0B',
  career: '#6366F1',
  personal: '#EC4899',
  social: '#8B5CF6',
  calendar: '#4285F4',
};

const PRIORITY_ICONS: Record<string, { icon: string; color: string }> = {
  high: { icon: 'flame', color: '#EF4444' },
  medium: { icon: 'remove', color: '#F59E0B' },
  low: { icon: 'chevron-down', color: '#6B7280' },
};

export default function JarvisPlanModal({
  visible,
  loading,
  reasoning,
  tasks,
  onAccept,
  onDismiss,
}: JarvisPlanModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.dismissArea} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingTitle}>Building your day...</Text>
              <Text style={styles.loadingSubtitle}>
                Reading your calendar, emails, and goals
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Ionicons name="sparkles" size={20} color={Colors.primary} />
                  <Text style={styles.headerTitle}>Jarvis&apos;s Plan for Today</Text>
                </View>
                <Pressable onPress={onDismiss} style={styles.closeBtn} hitSlop={8}>
                  <Ionicons name="close" size={22} color={Colors.textTertiary} />
                </Pressable>
              </View>

              {reasoning ? (
                <View style={styles.reasoningCard}>
                  <Text style={styles.reasoningText}>{reasoning}</Text>
                </View>
              ) : null}

              <ScrollView style={styles.taskList} showsVerticalScrollIndicator={false}>
                {tasks.map((task, index) => {
                  const catColor = CATEGORY_COLORS[task.category] || Colors.primary;
                  const pri = PRIORITY_ICONS[task.priority] || PRIORITY_ICONS.medium;
                  return (
                    <View key={index} style={styles.taskItem}>
                      <View style={styles.taskNumber}>
                        <Text style={styles.taskNumberText}>{index + 1}</Text>
                      </View>
                      <View style={styles.taskContent}>
                        <View style={styles.taskTitleRow}>
                          <Text style={styles.taskTitle} numberOfLines={2}>
                            {task.title}
                          </Text>
                          <Ionicons
                            name={pri.icon as any}
                            size={14}
                            color={pri.color}
                          />
                        </View>
                        {task.description ? (
                          <Text style={styles.taskDescription} numberOfLines={2}>
                            {task.description}
                          </Text>
                        ) : null}
                        <View style={styles.taskMeta}>
                          <View style={[styles.categoryBadge, { backgroundColor: catColor + '18' }]}>
                            <Text style={[styles.categoryText, { color: catColor }]}>
                              {task.category}
                            </Text>
                          </View>
                          {task.time ? (
                            <View style={styles.timeBadge}>
                              <Ionicons name="time-outline" size={11} color={Colors.textTertiary} />
                              <Text style={styles.timeText}>{task.time}</Text>
                            </View>
                          ) : null}
                          {task.duration ? (
                            <View style={styles.timeBadge}>
                              <Ionicons name="hourglass-outline" size={11} color={Colors.textTertiary} />
                              <Text style={styles.timeText}>{task.duration}m</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.dismissBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onDismiss();
                  }}
                >
                  <Text style={styles.dismissText}>Start Over</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.85 }]}
                  onPress={() => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    onAccept();
                  }}
                  testID="accept-jarvis-plan"
                >
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.acceptText}>Accept Plan</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  loadingTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginTop: 8,
  },
  loadingSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  closeBtn: {
    padding: 2,
  },
  reasoningCard: {
    backgroundColor: '#F5F3FF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDE9FE',
  },
  reasoningText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#4C1D95',
    lineHeight: 20,
    fontStyle: 'italic',
  },
  taskList: {
    flexGrow: 0,
    marginBottom: 16,
  },
  taskItem: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  taskNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  taskNumberText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
  },
  taskContent: {
    flex: 1,
  },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  taskTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    lineHeight: 20,
  },
  taskDescription: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 6,
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize',
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  timeText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  dismissBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  acceptText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
