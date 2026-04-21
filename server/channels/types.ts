import type { ChannelName, NotificationType } from "@shared/schema";

export type { ChannelName, NotificationType };

export interface ChannelAttachment {
  kind: "document";
  filename: string;
  content: string | Buffer;
  caption?: string;
  mimeType?: string;
}

export interface ChannelSendOpts {
  attachments?: ChannelAttachment[];
  notificationType?: NotificationType;
  buttons?: { text: string; callbackData: string }[];
  threadKey?: string;
}

export interface ChannelSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface Channel {
  name: ChannelName;
  isConfigured(): boolean;
  isLinkedFor(userId: string): Promise<boolean>;
  sendMessage(userId: string, text: string, opts?: ChannelSendOpts): Promise<ChannelSendResult>;
}
