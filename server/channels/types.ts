import type { ChannelName, NotificationType } from "@shared/schema";
import type { ToolGroup } from "../agent/tools";

export type { ChannelName, NotificationType };
export type { ToolGroup };

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
  /**
   * Tool groups this channel requires. The agent call-site filters ALL_TOOLS
   * to only include tools belonging to these groups before building the session
   * context, keeping the model's tool surface lean per channel.
   */
  toolGroups: ToolGroup[];
  isConfigured(): boolean;
  isLinkedFor(userId: string): Promise<boolean>;
  sendMessage(userId: string, text: string, opts?: ChannelSendOpts): Promise<ChannelSendResult>;
}
