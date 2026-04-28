import type { ChannelName, NotificationType } from "@shared/schema";
import type { ToolGroup } from "../agent/tools";

export type { ChannelName, NotificationType };
export type { ToolGroup };

/** Attachment sent from the agent to a channel after a tool run. */
export type ChannelAttachment =
  | {
      kind: "document";
      filename: string;
      content: string | Buffer;
      caption?: string;
      mimeType?: string;
      mcpServerName?: string;
    }
  | {
      kind: "image";
      /** URL or base64 data URI for the image */
      url?: string;
      /** Raw base64 blob data */
      data?: string;
      mimeType?: string;
      caption?: string;
      mcpServerName?: string;
    }
  | {
      kind: "file";
      filename: string;
      url?: string;
      data?: string;
      mimeType?: string;
      caption?: string;
      /** Size in bytes (optional) */
      size?: number;
      mcpServerName?: string;
    }
  | {
      kind: "markdown";
      text: string;
      caption?: string;
      mcpServerName?: string;
    };

export interface ChannelSendOpts {
  attachments?: ChannelAttachment[];
  notificationType?: NotificationType;
  buttons?: { text: string; callbackData: string }[];
  threadKey?: string;
  /** Gate ID for approval_request notifications — included in the Review action payload. */
  gateId?: string;
  /**
   * When true, Discord delivery is skipped if the user sent a Discord message
   * within the last 3 minutes (they are actively chatting).  The notifyUser
   * fallback then delivers via in-app instead, avoiding spam during live sessions.
   * Only set this for low-urgency background notifications (e.g. Curiosity).
   */
  skipIfDiscordActive?: boolean;
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
