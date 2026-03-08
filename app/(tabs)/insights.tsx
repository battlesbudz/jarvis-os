import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { fetch } from 'expo/fetch';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import { getGoals, getStats, getCompletionHistory, type Goal, type UserStats } from '@/lib/storage';
import { getApiUrl } from '@/lib/query-client';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_PROMPTS = [
  "How am I doing overall?",
  "What should I focus on this week?",
  "Help me with my financial goals",
  "I'm struggling to stay consistent",
];

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function TypingDots() {
  return (
    <View style={styles.typingBubble}>
      <View style={styles.typingDots}>
        <Animated.View entering={FadeIn.duration(300).delay(0)} style={styles.dot} />
        <Animated.View entering={FadeIn.duration(300).delay(150)} style={styles.dot} />
        <Animated.View entering={FadeIn.duration(300).delay(300)} style={styles.dot} />
      </View>
    </View>
  );
}

function MessageBubble({ message, isFirst }: { message: ChatMessage; isFirst: boolean }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
      {!isUser && isFirst && (
        <View style={styles.coachLabel}>
          <Ionicons name="sparkles-outline" size={12} color={Colors.secondary} />
          <Text style={styles.coachLabelText}>GamePlan Coach</Text>
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
          {message.content}
        </Text>
      </View>
    </View>
  );
}

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stats, setStats] = useState<UserStats>({ streak: 0, totalCompleted: 0, bestStreak: 0 });
  const [history, setHistory] = useState<any[]>([]);
  const flatListRef = useRef<FlatList>(null);

  const loadContext = useCallback(async () => {
    const [g, s, h] = await Promise.all([getGoals(), getStats(), getCompletionHistory()]);
    setGoals(g);
    setStats(s);
    setHistory(h);
  }, []);

  useFocusEffect(useCallback(() => {
    loadContext();
  }, [loadContext]));

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = { id: generateId(), role: 'user', content: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setShowTyping(true);
    setIsStreaming(true);

    const assistantId = generateId();
    let fullContent = '';
    let assistantAdded = false;

    try {
      const baseUrl = getApiUrl();
      const response = await fetch(`${baseUrl}api/coach/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          goals,
          stats,
          history,
        }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullContent += parsed.content;

              if (!assistantAdded) {
                setShowTyping(false);
                setMessages(prev => [...prev, {
                  id: assistantId,
                  role: 'assistant',
                  content: fullContent,
                }]);
                assistantAdded = true;
              } else {
                setMessages(prev => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (updated[lastIdx]?.id === assistantId) {
                    updated[lastIdx] = { ...updated[lastIdx], content: fullContent };
                  }
                  return updated;
                });
              }
            }
          } catch {}
        }
      }
    } catch {
      setShowTyping(false);
      if (!assistantAdded) {
        setMessages(prev => [...prev, {
          id: assistantId,
          role: 'assistant',
          content: "Sorry, I couldn't connect right now. Please try again.",
        }]);
      }
    } finally {
      setIsStreaming(false);
      setShowTyping(false);
    }
  }, [messages, isStreaming, goals, stats, history]);

  const handleSend = useCallback(() => {
    sendMessage(input);
  }, [input, sendMessage]);

  const handleSuggestedPrompt = useCallback((prompt: string) => {
    sendMessage(prompt);
  }, [sendMessage]);

  const reversedMessages = [...messages].reverse();
  const canSend = input.trim().length > 0 && !isStreaming;

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={styles.headerTitle}>Coach</Text>
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Ionicons name="flame-outline" size={13} color={Colors.error} />
            <Text style={styles.statPillText}>{stats.streak} day streak</Text>
          </View>
          <View style={styles.statPill}>
            <Ionicons name="checkmark-circle-outline" size={13} color={Colors.success} />
            <Text style={styles.statPillText}>{stats.totalCompleted} done</Text>
          </View>
          <View style={styles.statPill}>
            <Ionicons name="star-outline" size={13} color={Colors.warning} />
            <Text style={styles.statPillText}>{stats.xp || 0} XP</Text>
          </View>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={reversedMessages}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <MessageBubble
            message={item}
            isFirst={item.role === 'assistant' && (index === reversedMessages.length - 1 || reversedMessages[index + 1]?.role === 'user')}
          />
        )}
        inverted={messages.length > 0}
        ListHeaderComponent={showTyping ? <TypingDots /> : null}
        ListEmptyComponent={
          <Animated.View entering={FadeInDown.duration(400)} style={styles.welcomeContainer}>
            <View style={styles.welcomeIcon}>
              <Ionicons name="sparkles" size={32} color={Colors.secondary} />
            </View>
            <Text style={styles.welcomeTitle}>Your Personal Coach</Text>
            <Text style={styles.welcomeSubtitle}>
              I know your goals and how you've been doing. Ask me anything.
            </Text>
            <View style={styles.suggestedContainer}>
              {SUGGESTED_PROMPTS.map((prompt) => (
                <Pressable
                  key={prompt}
                  style={({ pressed }) => [styles.suggestedChip, pressed && styles.suggestedChipPressed]}
                  onPress={() => handleSuggestedPrompt(prompt)}
                >
                  <Text style={styles.suggestedChipText}>{prompt}</Text>
                  <Ionicons name="arrow-forward-outline" size={14} color={Colors.primary} />
                </Pressable>
              ))}
            </View>
          </Animated.View>
        }
        contentContainerStyle={messages.length === 0 ? styles.emptyContent : styles.chatContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.inputContainer, { paddingBottom: bottomPad + 8 }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask your coach anything..."
          placeholderTextColor={Colors.textTertiary}
          multiline
          maxLength={1000}
          returnKeyType="default"
          onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
        />
        <Pressable
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!canSend}
        >
          {isStreaming ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Ionicons name="arrow-up" size={20} color={Colors.white} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statPillText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  chatContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  emptyContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
  },
  welcomeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingBottom: 24,
  },
  welcomeIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.secondary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  welcomeTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 20,
    marginBottom: 28,
  },
  suggestedContainer: {
    width: '100%',
    gap: 10,
  },
  suggestedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestedChipPressed: {
    backgroundColor: Colors.primary + '08',
    borderColor: Colors.primary + '40',
  },
  suggestedChipText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  messageRow: {
    marginBottom: 12,
    maxWidth: '85%',
  },
  messageRowUser: {
    alignSelf: 'flex-end',
  },
  messageRowAssistant: {
    alignSelf: 'flex-start',
  },
  coachLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    marginLeft: 4,
  },
  coachLabelText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.secondary,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTextUser: {
    fontFamily: 'Inter_400Regular',
    color: Colors.white,
  },
  bubbleTextAssistant: {
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
  },
  typingBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.white,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  typingDots: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.textTertiary,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    maxHeight: 120,
    minHeight: 42,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.border,
  },
});
