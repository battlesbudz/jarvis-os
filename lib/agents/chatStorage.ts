import AsyncStorage from "@react-native-async-storage/async-storage";

export interface InAppAttachment {
  kind: "image" | "file" | "document" | "markdown";
  url?: string;
  /** Base64 payload for image/file attachments */
  data?: string;
  /** Base64 payload for document attachments (converted from Buffer server-side) */
  content?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
  text?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** True when the assistant reply was shaped by a non-integration tool failure. */
  isToolError?: boolean;
  /** Attachments (images, files, markdown) produced by the agent during this turn. */
  attachments?: InAppAttachment[];
}

const CHAT_STORAGE_KEY = (agentId: string) => `agent_chat_history_${agentId}`;
const CHAT_SESSION_KEY = (agentId: string) => `agent_chat_session_${agentId}`;

// Sliding-window limits for messages sent to the API per request.
// Full history is still stored locally for display.
export const CHAT_HISTORY_WINDOW_MAIN = 50;   // core/main agents (Telegram Bot, Discord Bot, etc.)
export const CHAT_HISTORY_WINDOW_SUB  = 25;   // custom / sub-agents

export async function loadChatHistory(agentId: string): Promise<ChatMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(CHAT_STORAGE_KEY(agentId));
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

/**
 * Cross-runtime base64 decode. React Native 0.71+ exposes `atob` globally via JSI;
 * older runtimes may not. We fall back to `Buffer` when the runtime provides it via
 * the `buffer` polyfill) and finally return `null` so callers can degrade gracefully.
 */
export function safeAtob(base64: string): string | null {
  try {
    if (typeof atob === "function") return atob(base64);
    if (typeof Buffer !== "undefined") return Buffer.from(base64, "base64").toString("utf8");
    return null;
  } catch {
    return null;
  }
}

// Strip oversized base64 payloads before persisting to AsyncStorage to avoid
// exhausting the local storage quota on devices with many agent conversations.
const MAX_ATTACHMENT_BASE64_CHARS = 100 * 1024; // ~75 KB binary

export function sanitizeAttachmentsForStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (!msg.attachments?.length) return msg;
    return {
      ...msg,
      attachments: msg.attachments.map((att) => {
        const a = { ...att };
        if (a.data && a.data.length > MAX_ATTACHMENT_BASE64_CHARS) {
          delete a.data;
        }
        if (a.content && a.content.length > MAX_ATTACHMENT_BASE64_CHARS) {
          delete a.content;
        }
        return a;
      }),
    };
  });
}

export async function saveChatHistory(agentId: string, messages: ChatMessage[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAT_STORAGE_KEY(agentId), JSON.stringify(sanitizeAttachmentsForStorage(messages)));
  } catch { /* best-effort */ }
}

export async function loadStoredSessionId(agentId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CHAT_SESSION_KEY(agentId));
  } catch {
    return null;
  }
}

export async function saveStoredSessionId(agentId: string, sessionId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAT_SESSION_KEY(agentId), sessionId);
  } catch { /* best-effort */ }
}

export async function clearStoredSessionId(agentId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(CHAT_SESSION_KEY(agentId));
  } catch { /* best-effort */ }
}
