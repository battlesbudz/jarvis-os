import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetch as expoFetch } from "expo/fetch";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { IntegrationErrorCard } from "@/components/IntegrationErrorCard";
import { getAuthToken } from "@/lib/auth-context";
import {
  CHAT_HISTORY_WINDOW_MAIN,
  CHAT_HISTORY_WINDOW_SUB,
  type ChatMessage,
  type InAppAttachment,
  clearStoredSessionId,
  loadChatHistory,
  loadStoredSessionId,
  safeAtob,
  saveChatHistory,
  saveStoredSessionId,
} from "@/lib/agents/chatStorage";
import { apiRequest, getApiUrl } from "@/lib/query-client";

export interface RunModalAgent {
  id: string;
  name: string;
  isCoreAgent: boolean;
}

export function RunModal({ agent, onClose }: { agent: RunModalAgent | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const agentId = agent?.id;
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [running, setRunning] = useState(false);
  const [integrationError, setIntegrationError] = useState<{ integration: string } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const prevAgentIdRef = useRef<string | null>(null);
  const sdkSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    if (prevAgentIdRef.current === agentId) return;
    prevAgentIdRef.current = agentId;
    sdkSessionIdRef.current = null;
    setHistoryLoading(true);

    (async () => {
      try {
        const storedSessionId = await loadStoredSessionId(agentId);
        if (storedSessionId) {
          sdkSessionIdRef.current = storedSessionId;
        }

        const token = await getAuthToken();
        const historyUrl = new URL(`/api/agents/${agentId}/history`, getApiUrl());
        const resp = await fetch(historyUrl.toString(), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            messages: { id: string; role: "user" | "assistant"; content: string; createdAt: string }[];
          };
          if (data.messages && data.messages.length > 0) {
            const serverMessages: ChatMessage[] = data.messages
              .filter((m) => m.content)
              .map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                timestamp: new Date(m.createdAt).getTime(),
              }));
            setMessages(serverMessages);
            await saveChatHistory(agentId, serverMessages);
            setStreamingContent("");
            setIntegrationError(null);
            setHistoryLoading(false);
            return;
          }
        }

        const history = await loadChatHistory(agentId);
        setMessages(history);
        setStreamingContent("");
        setIntegrationError(null);
      } catch {
        const history = await loadChatHistory(agentId);
        setMessages(history);
        setStreamingContent("");
        setIntegrationError(null);
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, [agentId]);

  function buildConversationHistory(msgs: ChatMessage[]): { role: string; content: string }[] {
    const window = agent?.isCoreAgent ? CHAT_HISTORY_WINDOW_MAIN : CHAT_HISTORY_WINDOW_SUB;
    const windowed = msgs.length > window ? msgs.slice(msgs.length - window) : msgs;
    return windowed.map((m) => ({ role: m.role, content: m.content }));
  }

  async function handleRun() {
    if (!agent || !message.trim()) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    runIdRef.current = null;

    const userMsg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role: "user",
      content: message.trim(),
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    saveChatHistory(agent.id, updatedMessages);
    setMessage("");
    setRunning(true);
    setStreamingContent("");
    setIntegrationError(null);

    try {
      const token = await getAuthToken();
      const conversationHistory = buildConversationHistory(messages);

      const url = new URL(`/api/agents/${agent.id}/chat`, getApiUrl());
      const response = await expoFetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: userMsg.content,
          conversationHistory,
          ...(sdkSessionIdRef.current ? { sdkSessionId: sdkSessionIdRef.current } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const serverRunId = response.headers.get("X-Run-Id");
      if (serverRunId) runIdRef.current = serverRunId;

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let hadToolError = false;
      const pendingAttachments: InAppAttachment[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as {
              content?: string;
              type?: string;
              integration?: string;
              message?: string;
              sdkSessionId?: string;
              tool?: string;
              kind?: string;
              url?: string;
              data?: string;
              mimeType?: string;
              caption?: string;
              filename?: string;
              text?: string;
            };
            if (parsed.type === "aborted") {
              accumulated += "\n\n[Stopped]";
              setStreamingContent(accumulated.trim());
              break;
            }
            if (parsed.type === "session_init" && parsed.sdkSessionId && agent) {
              sdkSessionIdRef.current = parsed.sdkSessionId;
              saveStoredSessionId(agent.id, parsed.sdkSessionId);
            }
            if (parsed.type === "integration_error" && parsed.integration) {
              setIntegrationError({ integration: parsed.integration });
            }
            if (parsed.type === "tool_error") {
              hadToolError = true;
            }
            if (parsed.type === "progress" && parsed.message) {
              const progressMessage = String(parsed.message);
              if (!accumulated.trim()) {
                setStreamingContent(progressMessage);
              }
              continue;
            }
            if (parsed.type === "attachment" && parsed.kind) {
              pendingAttachments.push({
                kind: parsed.kind as InAppAttachment["kind"],
                url: parsed.url,
                data: parsed.data,
                content: parsed.content,
                mimeType: parsed.mimeType,
                caption: parsed.caption,
                filename: parsed.filename,
                text: parsed.text,
              });
            } else if (!parsed.type && parsed.content) {
              accumulated += parsed.content;
              setStreamingContent(accumulated);
            }
          } catch {
            // Ignore malformed stream chunks.
          }
        }
      }

      if (accumulated || pendingAttachments.length > 0) {
        const assistantMsg: ChatMessage = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: accumulated,
          timestamp: Date.now(),
          isToolError: hadToolError || undefined,
          attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
        };
        const finalMessages = [...updatedMessages, assistantMsg];
        setMessages(finalMessages);
        saveChatHistory(agent.id, finalMessages);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Partial content is already visible for client-side aborts.
      } else {
        const errorMsg: ChatMessage = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        };
        const finalMessages = [...updatedMessages, errorMsg];
        setMessages(finalMessages);
        saveChatHistory(agent.id, finalMessages);
      }
    } finally {
      setRunning(false);
      setStreamingContent("");
      abortControllerRef.current = null;
      runIdRef.current = null;
    }
  }

  async function handleStop() {
    if (!agent) return;
    if (runIdRef.current) {
      try {
        await apiRequest("POST", `/api/agents/${agent.id}/abort`, { runId: runIdRef.current });
      } catch {
        // Best effort.
      }
    }
    abortControllerRef.current?.abort();
  }

  function handleClear() {
    if (!agent) return;
    Alert.alert("Clear conversation", "Remove all messages with this agent?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          setMessages([]);
          setStreamingContent("");
          setIntegrationError(null);
          saveChatHistory(agent.id, []);
          sdkSessionIdRef.current = null;
          clearStoredSessionId(agent.id);
        },
      },
    ]);
  }

  function handleClose() {
    handleStop();
    setMessage("");
    setStreamingContent("");
    setRunning(false);
    setIntegrationError(null);
    prevAgentIdRef.current = null;
    onClose();
  }

  function handleGoToSettings() {
    const integration = integrationError?.integration;
    handleClose();
    router.push({ pathname: "/(tabs)/settings", params: integration ? { scrollTo: integration } : {} });
  }

  const displayMessages = streamingContent
    ? [...messages, { id: "__streaming__", role: "assistant" as const, content: streamingContent, timestamp: Date.now() }]
    : messages;
  const invertedMessages = [...displayMessages].reverse();

  function renderAttachment(att: InAppAttachment, idx: number) {
    if (att.kind === "image") {
      const source = att.url
        ? { uri: att.url }
        : att.data
        ? { uri: `data:${att.mimeType ?? "image/png"};base64,${att.data}` }
        : null;
      if (!source) return null;
      return (
        <View key={idx} style={{ marginTop: 8 }}>
          <Image source={source} style={{ width: "100%", height: 200, borderRadius: 8 }} resizeMode="contain" />
          {!!att.caption && (
            <Text style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 4 }}>
              {att.caption}
            </Text>
          )}
        </View>
      );
    }

    if (att.kind === "markdown" && att.text) {
      return (
        <View key={idx} style={styles.markdownAttachment}>
          {!!att.caption && (
            <Text style={{ fontSize: 11, color: Colors.textSecondary, marginBottom: 4 }}>{att.caption}</Text>
          )}
          <Text style={{ fontSize: 13, color: Colors.text, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>
            {att.text}
          </Text>
        </View>
      );
    }

    if (att.kind === "file" || att.kind === "document") {
      const name = att.filename ?? "File";
      const hasLink = !!att.url;
      const rawPayload = att.data ?? att.content;
      const mimeType = att.mimeType ?? "";
      const isText =
        mimeType.includes("text") ||
        mimeType.includes("json") ||
        mimeType.includes("xml") ||
        mimeType.includes("csv") ||
        mimeType.includes("markdown");

      let textPreview: string | null = null;
      if (!hasLink && rawPayload && isText) {
        const decoded = safeAtob(rawPayload);
        if (decoded !== null) textPreview = decoded.slice(0, 500);
      }

      return (
        <View key={idx} style={{ marginTop: 8 }}>
          <TouchableOpacity
            activeOpacity={hasLink ? 0.7 : 1}
            onPress={
              hasLink
                ? () => {
                    const u = att.url!;
                    if (u.startsWith("https://") || u.startsWith("http://")) {
                      Linking.openURL(u);
                    }
                  }
                : undefined
            }
            style={styles.fileAttachment}
          >
            <Ionicons name="document-outline" size={20} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: Colors.text, fontWeight: "500" as const }} numberOfLines={1}>
                {name}
              </Text>
              {!!att.caption && (
                <Text style={{ fontSize: 11, color: Colors.textSecondary }} numberOfLines={1}>
                  {att.caption}
                </Text>
              )}
              {!hasLink && !!rawPayload && !isText && (
                <Text style={{ fontSize: 11, color: Colors.textTertiary }}>File content available</Text>
              )}
            </View>
            {hasLink && <Ionicons name="open-outline" size={14} color={Colors.textSecondary} />}
          </TouchableOpacity>
          {!!textPreview && (
            <View style={styles.textPreview}>
              <Text
                style={{ fontSize: 12, color: Colors.text, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
                numberOfLines={12}
              >
                {textPreview}
              </Text>
            </View>
          )}
        </View>
      );
    }

    return null;
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isUser = item.role === "user";
    const isStreaming = item.id === "__streaming__";
    const isToolError = !isUser && !!item.isToolError;
    const attachments = !isUser ? (item.attachments ?? []) : [];
    return (
      <View style={[styles.chatBubbleRow, isUser ? styles.chatBubbleRowUser : styles.chatBubbleRowAgent]}>
        {!isUser && (
          <View
            style={[
              styles.chatAvatar,
              isToolError ? { backgroundColor: Colors.warningDim } : { backgroundColor: Colors.primary + "22" },
            ]}
          >
            <Ionicons
              name={isToolError ? "warning-outline" : "flash-outline"}
              size={12}
              color={isToolError ? Colors.warning : Colors.primary}
            />
          </View>
        )}
        <View
          style={[
            styles.chatBubble,
            isUser
              ? [styles.chatBubbleUser, { backgroundColor: Colors.primary }]
              : isToolError
              ? [styles.chatBubbleAgent, { backgroundColor: Colors.surface, borderColor: Colors.warning + "80" }]
              : [styles.chatBubbleAgent, { backgroundColor: Colors.surface, borderColor: Colors.border }],
          ]}
        >
          {isToolError && (
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 4 }}>
              <Ionicons name="warning-outline" size={12} color={Colors.warning} />
              <Text style={{ fontSize: 11, color: Colors.warning, fontWeight: "600" as const }}>Tool failed</Text>
            </View>
          )}
          {(item.content || isStreaming) && (
            <Text style={[styles.chatBubbleText, { color: isUser ? Colors.white : Colors.text }]}>
              {item.content}
            </Text>
          )}
          {attachments.map((att, idx) => renderAttachment(att, idx))}
          {isStreaming && (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 4, alignSelf: "flex-start" }} />
          )}
        </View>
      </View>
    );
  }

  const bottomPad = insets.bottom;

  return (
    <Modal visible={!!agent} animationType="slide" presentationStyle="formSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={[styles.sheet, { backgroundColor: Colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.sheetHeader, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity onPress={handleClose}>
            <Text style={[styles.sheetCancel, { color: Colors.textSecondary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.sheetTitle, { color: Colors.text }]} numberOfLines={1}>
            {agent?.name ?? ""}
          </Text>
          {running ? (
            <TouchableOpacity onPress={handleStop}>
              <Text style={[styles.sheetDone, { color: Colors.error }]}>Stop</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleClear} disabled={messages.length === 0}>
              <Ionicons
                name="trash-outline"
                size={18}
                color={messages.length > 0 ? Colors.textSecondary : Colors.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>

        {historyLoading ? (
          <View style={styles.chatEmpty}>
            <ActivityIndicator size="small" color={Colors.textTertiary} />
            <Text style={[styles.chatEmptyText, { color: Colors.textTertiary }]}>Loading conversation...</Text>
          </View>
        ) : displayMessages.length === 0 && !running ? (
          <View style={styles.chatEmpty}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={Colors.textTertiary} />
            <Text style={[styles.chatEmptyText, { color: Colors.textTertiary }]}>
              Start a conversation with {agent?.name ?? "this agent"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={invertedMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            inverted
            style={{ flex: 1 }}
            contentContainerStyle={styles.chatList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListFooterComponent={(() => {
              const historyWindow = agent?.isCoreAgent ? CHAT_HISTORY_WINDOW_MAIN : CHAT_HISTORY_WINDOW_SUB;
              return messages.length > historyWindow ? (
                <View style={[styles.trimBanner, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                  <Ionicons name="information-circle-outline" size={14} color={Colors.textTertiary} />
                  <Text style={[styles.trimBannerText, { color: Colors.textTertiary }]}>
                    Conversation is long - only the most recent context is sent to the agent
                  </Text>
                </View>
              ) : null;
            })()}
          />
        )}

        {integrationError ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <IntegrationErrorCard
              integrationKey={integrationError.integration}
              cardStyle={{}}
              onDismiss={() => setIntegrationError(null)}
              onGoToSettings={handleGoToSettings}
            />
          </View>
        ) : null}

        <View
          style={[
            styles.chatInputBar,
            {
              backgroundColor: Colors.background,
              borderTopColor: Colors.border,
              paddingBottom: bottomPad > 0 ? bottomPad : 12,
            },
          ]}
        >
          <TextInput
            style={[styles.chatInput, { backgroundColor: Colors.surface, color: Colors.text, borderColor: Colors.border }]}
            value={message}
            onChangeText={setMessage}
            placeholder={`Message ${agent?.name ?? "agent"}...`}
            placeholderTextColor={Colors.textTertiary}
            multiline
            maxLength={2000}
            editable={!running}
            onSubmitEditing={handleRun}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.chatSendBtn, { backgroundColor: message.trim() && !running ? Colors.primary : Colors.border }]}
            onPress={handleRun}
            disabled={!message.trim() || running}
          >
            {running ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="arrow-up" size={18} color={Colors.white} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 16 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: "600", flex: 1, textAlign: "center", marginHorizontal: 8 },
  sheetCancel: { fontSize: 16, minWidth: 48 },
  sheetDone: { fontSize: 16, fontWeight: "600", minWidth: 48, textAlign: "right" },
  chatList: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  chatEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  chatEmptyText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  chatBubbleRow: { flexDirection: "row", marginBottom: 12, alignItems: "flex-end", gap: 8 },
  chatBubbleRowUser: { justifyContent: "flex-end" },
  chatBubbleRowAgent: { justifyContent: "flex-start" },
  chatAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chatBubble: { maxWidth: "78%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  chatBubbleUser: { borderBottomRightRadius: 4 },
  chatBubbleAgent: { borderWidth: 1, borderBottomLeftRadius: 4 },
  chatBubbleText: { fontSize: 14, lineHeight: 20 },
  chatInputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chatInput: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  chatSendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  trimBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  trimBannerText: { flex: 1, fontSize: 12, lineHeight: 16 },
  markdownAttachment: {
    marginTop: 8,
    padding: 8,
    backgroundColor: Colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fileAttachment: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  textPreview: {
    marginTop: 4,
    padding: 8,
    backgroundColor: Colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
