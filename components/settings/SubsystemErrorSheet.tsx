import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export interface SubsystemErrorEvent {
  id: string;
  subsystem: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface SubsystemErrorSheetProps {
  visible: boolean;
  subsystemName: string;
  subsystemLabel: string;
  events: SubsystemErrorEvent[];
  loading: boolean;
  lastUpdated: Date | null;
  styles: Record<string, any>;
  onClose: () => void;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function SubsystemErrorSheet({
  visible,
  subsystemName,
  subsystemLabel,
  events,
  loading,
  lastUpdated,
  styles,
  onClose,
}: SubsystemErrorSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Ionicons name="warning-outline" size={16} color="#F59E0B" />
          <Text style={styles.title}>{subsystemLabel} Error Details</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={20} color={Colors.textSecondary} />
          </Pressable>
        </View>
        <Text style={styles.subtitle}>Recent errors from the {subsystemLabel.toLowerCase()} subsystem (last 60 minutes)</Text>
        {lastUpdated != null && (
          <Text style={styles.lastUpdated}>Updated {formatRelativeTime(lastUpdated)}</Text>
        )}
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={Colors.textSecondary} />
            <Text style={styles.loadingText}>Loading events...</Text>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyRow}>
            <Ionicons name="checkmark-circle-outline" size={24} color="#10B981" />
            <Text style={styles.emptyText}>No {subsystemLabel.toLowerCase()} errors in the last hour</Text>
          </View>
        ) : (
          <ScrollView style={styles.eventList} showsVerticalScrollIndicator={false}>
            {events.map((event) => {
              const severityColor = event.severity === 'critical' || event.severity === 'error' ? Colors.error : '#F59E0B';
              const operation = typeof event.metadata?.operation === 'string' ? event.metadata.operation : null;
              const timeAgo = formatRelativeTime(new Date(event.createdAt ?? ''));
              return (
                <View key={event.id} style={styles.eventRow}>
                  <View style={[styles.severityDot, { backgroundColor: severityColor }]} />
                  <View style={styles.eventContent}>
                    <View style={styles.eventMeta}>
                      {operation ? (
                        <Text style={[styles.operationTag, { color: severityColor }]}>{operation}</Text>
                      ) : (
                        <Text style={[styles.operationTag, { color: Colors.textTertiary }]}>{subsystemName}</Text>
                      )}
                      <Text style={styles.eventTime}>{timeAgo}</Text>
                    </View>
                    <Text style={styles.eventMessage}>{event.message}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
