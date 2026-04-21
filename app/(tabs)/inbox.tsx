import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { getApiUrl, apiRequest } from '@/lib/query-client';

interface InboxItem {
  id: string;
  sourceType: string;
  sourceId: string;
  subject: string | null;
  sender: string | null;
  snippet: string | null;
  jarvisReason: string | null;
  suggestedActions: { label: string; actionType: string }[] | null;
  status: string;
  surfacedAt: string;
}

interface Deliverable {
  id: string;
  agentType: string;
  type: string;
  title: string;
  summary: string | null;
  body: string;
  meta: Record<string, unknown> | null;
  status: string;
  createdAt: string;
}

const DELIVERABLE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  research: 'search',
  document: 'document-text',
  plan: 'list',
  email_draft: 'mail',
};

const DELIVERABLE_LABEL: Record<string, string> = {
  research: 'Research brief',
  document: 'Document',
  plan: 'Plan',
  email_draft: 'Email draft',
};

interface EmailDraft {
  id: string;
  fromSender: string | null;
  originalSubject: string | null;
  draftSubject: string;
  draftBody: string;
  jarvisReason: string | null;
  status: string;
  createdAt: string;
}

function getSenderName(sender: string | null): string {
  if (!sender) return 'Unknown';
  return sender.replace(/<.*>/, '').trim() || sender;
}

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const queryClient = useQueryClient();

  const { data: items = [], isLoading, refetch } = useQuery<InboxItem[]>({
    queryKey: ['/api/inbox/items'],
  });

  const { data: drafts = [], refetch: refetchDrafts } = useQuery<EmailDraft[]>({
    queryKey: ['/api/email-drafts'],
  });

  const { data: deliverables = [], refetch: refetchDeliverables } = useQuery<Deliverable[]>({
    queryKey: ['/api/deliverables'],
    refetchInterval: 30000,
  });

  const approveDeliverableMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/deliverables/${id}/approve`, {});
      return res.json() as Promise<{ ok: boolean; gmailDraftUrl?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables'] });
      Alert.alert(
        'Approved',
        data?.gmailDraftUrl
          ? 'Email saved to Gmail drafts.'
          : 'Saved to your Documents library.',
      );
    },
    onError: () => {
      Alert.alert('Error', 'Could not approve this item.');
    },
  });

  const discardDeliverableMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/deliverables/${id}/discard`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deliverables'] });
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ itemId, actionType }: { itemId: string; actionType: string }) => {
      const res = await apiRequest('POST', `/api/inbox/items/${itemId}/action`, { actionType });
      return res.json();
    },
    onSuccess: (data: { message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/inbox/items'] });
      if (data?.message) {
        Alert.alert('Done', data.message);
      }
    },
    onError: () => {
      Alert.alert('Error', 'Action failed. Please try again.');
    },
  });

  const approveDraftMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await apiRequest('POST', `/api/email-drafts/${draftId}/approve`, {});
      return res.json() as Promise<{ success: boolean; gmailDraftUrl?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-drafts'] });
      Alert.alert(
        'Draft saved to Gmail',
        data?.gmailDraftUrl
          ? 'Open Gmail to review and send.'
          : 'The reply is now in your Gmail drafts.',
      );
    },
    onError: () => {
      Alert.alert('Error', 'Could not save the draft to Gmail.');
    },
  });

  const discardDraftMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await apiRequest('POST', `/api/email-drafts/${draftId}/discard`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-drafts'] });
    },
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
      refetchDrafts();
      refetchDeliverables();
    }, [refetch, refetchDrafts, refetchDeliverables])
  );

  const handleAction = (itemId: string, actionType: string) => {
    if (actionType === 'never_again') {
      Alert.alert(
        'Never show again?',
        'This will create a rule to suppress similar items in the future.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes, suppress', onPress: () => actionMutation.mutate({ itemId, actionType }) },
        ]
      );
      return;
    }
    actionMutation.mutate({ itemId, actionType });
  };

  const renderItem = ({ item, index }: { item: InboxItem; index: number }) => {
    const senderName = getSenderName(item.sender);
    const isEmail = item.sourceType === 'email';
    const actions = item.suggestedActions || [];

    return (
      <Animated.View entering={FadeInDown.duration(300).delay(index * 60)}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.sourceIcon, { backgroundColor: isEmail ? '#EA433515' : Colors.primary + '15' }]}>
              <Ionicons
                name={isEmail ? 'mail' : 'calendar'}
                size={18}
                color={isEmail ? '#EA4335' : Colors.primary}
              />
            </View>
            <View style={styles.cardHeaderText}>
              <Text style={styles.senderName} numberOfLines={1}>{senderName}</Text>
              <Text style={styles.timestamp}>
                {new Date(item.surfacedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
          </View>

          <Text style={styles.subject} numberOfLines={2}>{item.subject || 'No subject'}</Text>

          {item.snippet && (
            <Text style={styles.snippet} numberOfLines={2}>{item.snippet}</Text>
          )}

          {item.jarvisReason && (
            <View style={styles.reasonContainer}>
              <Ionicons name="sparkles" size={12} color={Colors.primary} />
              <Text style={styles.reasonText}>{item.jarvisReason}</Text>
            </View>
          )}

          <View style={styles.actionsRow}>
            {actions.slice(0, 3).map((action, i) => {
              const isDismiss = action.actionType === 'dismiss';
              return (
                <Pressable
                  key={i}
                  style={[styles.actionButton, isDismiss && styles.actionButtonDismiss]}
                  onPress={() => handleAction(item.id, action.actionType)}
                  disabled={actionMutation.isPending}
                >
                  <Text style={[styles.actionText, isDismiss && styles.actionTextDismiss]}>
                    {action.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={styles.neverButton}
              onPress={() => handleAction(item.id, 'never_again')}
              disabled={actionMutation.isPending}
            >
              <Ionicons name="ban" size={14} color={Colors.error} />
            </Pressable>
          </View>
        </View>
      </Animated.View>
    );
  };

  const renderDeliverables = () => {
    if (deliverables.length === 0) return null;
    return (
      <View style={styles.draftSection}>
        <View style={styles.draftHeader}>
          <Ionicons name="sparkles" size={16} color={Colors.primary} />
          <Text style={styles.draftHeaderText}>
            Deliverables · {deliverables.length} ready for review
          </Text>
        </View>
        {deliverables.map((d, index) => {
          const icon = DELIVERABLE_ICON[d.type] || 'document-text';
          const typeLabel = DELIVERABLE_LABEL[d.type] || d.type;
          const busy =
            (approveDeliverableMutation.isPending && approveDeliverableMutation.variables === d.id) ||
            (discardDeliverableMutation.isPending && discardDeliverableMutation.variables === d.id);
          const meta = d.meta as { to?: string; subject?: string } | null;
          return (
            <Animated.View key={d.id} entering={FadeInDown.duration(300).delay(index * 60)}>
              <View style={styles.draftCard}>
                <View style={styles.cardHeader}>
                  <View style={[styles.sourceIcon, { backgroundColor: Colors.primary + '15' }]}>
                    <Ionicons name={icon} size={18} color={Colors.primary} />
                  </View>
                  <View style={styles.cardHeaderText}>
                    <Text style={styles.senderName} numberOfLines={1}>{typeLabel}</Text>
                    <Text style={styles.timestamp}>
                      {new Date(d.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>

                <Text style={styles.subject} numberOfLines={2}>{d.title}</Text>

                {d.type === 'email_draft' && meta?.to && (
                  <View style={styles.reasonContainer}>
                    <Ionicons name="arrow-forward-outline" size={12} color={Colors.primary} />
                    <Text style={styles.reasonText} numberOfLines={1}>To: {meta.to}</Text>
                  </View>
                )}

                <View style={styles.draftBodyBox}>
                  <Text style={styles.draftBodyText} numberOfLines={8}>
                    {d.summary || d.body}
                  </Text>
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => approveDeliverableMutation.mutate(d.id)}
                    disabled={busy}
                    testID={`deliverable-approve-${d.id}`}
                  >
                    <Text style={styles.actionText}>
                      {d.type === 'email_draft' ? 'Save to Gmail' : 'Save to Documents'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionButton, styles.actionButtonDismiss]}
                    onPress={() => discardDeliverableMutation.mutate(d.id)}
                    disabled={busy}
                    testID={`deliverable-discard-${d.id}`}
                  >
                    <Text style={[styles.actionText, styles.actionTextDismiss]}>Discard</Text>
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  const renderListHeader = () => (
    <View>
      {renderDeliverables()}
      {renderDraftQueue()}
    </View>
  );

  const renderDraftQueue = () => {
    if (drafts.length === 0) return null;
    return (
      <View style={styles.draftSection}>
        <View style={styles.draftHeader}>
          <Ionicons name="create-outline" size={16} color={Colors.primary} />
          <Text style={styles.draftHeaderText}>
            Draft Queue · {drafts.length} reply{drafts.length === 1 ? '' : 'ies'} ready
          </Text>
        </View>
        {drafts.map((draft, index) => {
          const sender = getSenderName(draft.fromSender);
          const busy =
            (approveDraftMutation.isPending && approveDraftMutation.variables === draft.id) ||
            (discardDraftMutation.isPending && discardDraftMutation.variables === draft.id);
          return (
            <Animated.View key={draft.id} entering={FadeInDown.duration(300).delay(index * 60)}>
              <View style={styles.draftCard}>
                <View style={styles.cardHeader}>
                  <View style={[styles.sourceIcon, { backgroundColor: Colors.primary + '15' }]}>
                    <Ionicons name="sparkles" size={18} color={Colors.primary} />
                  </View>
                  <View style={styles.cardHeaderText}>
                    <Text style={styles.senderName} numberOfLines={1}>To: {sender}</Text>
                    <Text style={styles.timestamp}>
                      {new Date(draft.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>

                <Text style={styles.subject} numberOfLines={2}>{draft.draftSubject}</Text>

                {draft.jarvisReason && (
                  <View style={styles.reasonContainer}>
                    <Ionicons name="alert-circle-outline" size={12} color={Colors.primary} />
                    <Text style={styles.reasonText} numberOfLines={2}>{draft.jarvisReason}</Text>
                  </View>
                )}

                <View style={styles.draftBodyBox}>
                  <Text style={styles.draftBodyText} numberOfLines={6}>{draft.draftBody}</Text>
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => approveDraftMutation.mutate(draft.id)}
                    disabled={busy}
                  >
                    <Text style={styles.actionText}>Save to Gmail</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionButton, styles.actionButtonDismiss]}
                    onPress={() => discardDraftMutation.mutate(draft.id)}
                    disabled={busy}
                  >
                    <Text style={[styles.actionText, styles.actionTextDismiss]}>Discard</Text>
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    if (drafts.length > 0) return null;
    if (deliverables.length > 0) return null;
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIcon}>
          <Ionicons name="checkmark-circle" size={48} color={Colors.success} />
        </View>
        <Text style={styles.emptyTitle}>All clear</Text>
        <Text style={styles.emptySubtitle}>
          Jarvis is watching — nothing needs your attention right now
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: isWeb ? 67 : insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inbox</Text>
        {items.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{items.length}</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 : insets.bottom + 90 }]}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.primary} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  badge: {
    backgroundColor: Colors.error,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 10,
  },
  badgeText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  list: {
    paddingHorizontal: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sourceIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeaderText: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginLeft: 10,
  },
  senderName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    flex: 1,
  },
  timestamp: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    marginLeft: 8,
  },
  subject: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 4,
  },
  snippet: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  reasonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  reasonText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.primary,
    fontStyle: 'italic' as const,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  actionButton: {
    backgroundColor: Colors.primary + '12',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionButtonDismiss: {
    backgroundColor: Colors.surfaceAlt,
  },
  actionText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
  },
  actionTextDismiss: {
    color: Colors.textSecondary,
  },
  neverButton: {
    marginLeft: 'auto' as const,
    padding: 8,
  },
  draftSection: {
    marginBottom: 8,
  },
  draftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  draftHeaderText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  draftCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  draftBodyBox: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  draftBodyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    lineHeight: 18,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
});
