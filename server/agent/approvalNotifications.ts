export type ApprovalNotificationOrigin = "telegram" | "discord" | "in_app" | "unknown";

export interface ApprovalNotificationPayload {
  gateId: string;
  agentId: string;
  agentName: string;
  userId: string;
  toolName: string;
  description: string;
  originChannel?: string;
  originChannelId?: string;
}

export interface ApprovalNotificationDelivery {
  target: "telegram" | "discord_channel" | "discord_dm" | "in_app";
  ok: boolean;
  error?: string;
}

export type TelegramApprovalDecision = "approve" | "reject";

export interface TelegramApprovalButton {
  text: string;
  callback_data: string;
}

export function buildTelegramApprovalKeyboard(gateId: string): TelegramApprovalButton[] {
  return [
    { text: "Approve", callback_data: `ag:ok:${gateId}` },
    { text: "Decline", callback_data: `ag:no:${gateId}` },
  ];
}

export function parseTelegramApprovalCallback(
  data: string,
): { decision: TelegramApprovalDecision; gateId: string } | null {
  const match = /^ag:(ok|no):(.+)$/.exec(data.trim());
  if (!match) return null;
  return {
    decision: match[1] === "ok" ? "approve" : "reject",
    gateId: match[2],
  };
}

export interface ApprovalNotificationDeps {
  sendInApp?: (userId: string, text: string, gateId: string) => Promise<unknown>;
  sendTelegramChat?: (chatId: string, text: string) => Promise<unknown>;
  sendTelegramApprovalCard?: (chatId: string, text: string, gateId: string) => Promise<unknown>;
  sendTelegramUser?: (userId: string, text: string, gateId: string) => Promise<unknown>;
  sendDiscordChannel?: (userId: string, channelId: string, text: string) => Promise<boolean>;
  sendDiscordApprovalCard?: (userId: string, channelId: string, text: string, gateId: string) => Promise<boolean>;
  sendDiscordDm?: (userId: string, text: string) => Promise<boolean>;
  sendDiscordApprovalDm?: (userId: string, text: string, gateId: string) => Promise<boolean>;
  warn?: (message: string, error?: unknown) => void;
}

export function normalizeApprovalOrigin(originChannel?: string): ApprovalNotificationOrigin {
  const normalized = (originChannel ?? "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.startsWith("telegram")) return "telegram";
  if (normalized.startsWith("discord")) return "discord";

  const appOrigins = new Set([
    "app",
    "app chat",
    "app_chat",
    "appchat",
    "coach",
    "gateway",
    "in_app",
    "in-app",
    "voice",
    "web",
    "webchat",
  ]);
  return appOrigins.has(normalized) ? "in_app" : "unknown";
}

export function buildApprovalNotificationText(payload: ApprovalNotificationPayload): string {
  const origin = normalizeApprovalOrigin(payload.originChannel);
  const originLine = origin === "telegram" || origin === "discord"
    ? `This request started in ${payload.originChannel ?? "this channel"}, so I am notifying you here.`
    : "This request is waiting in Jarvis.";

  return [
    "Approval required",
    "",
    originLine,
    `Agent: ${payload.agentName}`,
    `Action: ${payload.toolName}`,
    `Gate ID: ${payload.gateId}`,
    "",
    payload.description,
    "",
    "Approve or decline in the Jarvis app Inbox. The in-app approval gate is the canonical control for this action.",
  ].join("\n");
}

async function defaultSendInApp(userId: string, text: string, gateId: string): Promise<void> {
  const { inAppChannel } = await import("../channels/inAppChannel");
  await inAppChannel.sendMessage(userId, text, {
    notificationType: "approval_request",
    gateId,
  });
}

async function defaultSendTelegramChat(chatId: string, text: string): Promise<void> {
  const { sendLongMessage } = await import("../integrations/telegram");
  await sendLongMessage(chatId, text);
}

async function defaultSendTelegramApprovalCard(chatId: string, text: string, gateId: string): Promise<void> {
  const { sendMessageWithButtons } = await import("../integrations/telegram");
  await sendMessageWithButtons(chatId, text, buildTelegramApprovalKeyboard(gateId));
}

async function defaultSendTelegramUser(userId: string, text: string, gateId: string): Promise<void> {
  const { telegramChannel } = await import("../channels/telegramChannel");
  await telegramChannel.sendMessage(userId, text, {
    notificationType: "approval_request",
    gateId,
  });
}

async function defaultSendDiscordChannel(
  userId: string,
  channelId: string,
  text: string,
): Promise<boolean> {
  const { postToDiscordChannelById } = await import("../discord/manager");
  return postToDiscordChannelById(userId, channelId, text);
}

async function defaultSendDiscordApprovalCard(
  userId: string,
  channelId: string,
  text: string,
  gateId: string,
): Promise<boolean> {
  const { postApprovalRequestToDiscordChannel } = await import("../discord/manager");
  return postApprovalRequestToDiscordChannel(userId, channelId, text, gateId);
}

async function defaultSendDiscordDm(userId: string, text: string): Promise<boolean> {
  const { sendToDiscordUser } = await import("../discord/manager");
  return sendToDiscordUser(userId, text);
}

async function defaultSendDiscordApprovalDm(userId: string, text: string, gateId: string): Promise<boolean> {
  const { postApprovalRequestToDiscordDm } = await import("../discord/manager");
  return postApprovalRequestToDiscordDm(userId, text, gateId);
}

async function safeDelivery(
  target: ApprovalNotificationDelivery["target"],
  send: () => Promise<boolean | unknown>,
  warn: (message: string, error?: unknown) => void,
): Promise<ApprovalNotificationDelivery> {
  try {
    const result = await send();
    if (result === false) {
      return { target, ok: false, error: "send returned false" };
    }
    return { target, ok: true };
  } catch (error) {
    warn(`[approvalNotifications] ${target} delivery failed`, error);
    return { target, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function notifyApprovalRequest(
  payload: ApprovalNotificationPayload,
  deps: ApprovalNotificationDeps = {},
): Promise<ApprovalNotificationDelivery[]> {
  const sendInApp = deps.sendInApp ?? defaultSendInApp;
  const sendTelegramChat = deps.sendTelegramChat ?? defaultSendTelegramChat;
  const sendTelegramApprovalCard = deps.sendTelegramApprovalCard ?? defaultSendTelegramApprovalCard;
  const sendTelegramUser = deps.sendTelegramUser ?? defaultSendTelegramUser;
  const sendDiscordChannel = deps.sendDiscordChannel ?? defaultSendDiscordChannel;
  const sendDiscordApprovalCard = deps.sendDiscordApprovalCard ?? defaultSendDiscordApprovalCard;
  const sendDiscordDm = deps.sendDiscordDm ?? defaultSendDiscordDm;
  const sendDiscordApprovalDm = deps.sendDiscordApprovalDm ?? defaultSendDiscordApprovalDm;
  const warn = deps.warn ?? ((message, error) => console.warn(message, error));

  const text = buildApprovalNotificationText(payload);
  const origin = normalizeApprovalOrigin(payload.originChannel);
  const deliveries: ApprovalNotificationDelivery[] = [];

  if (origin === "telegram") {
    if (payload.originChannelId) {
      deliveries.push(await safeDelivery(
        "telegram",
        () => sendTelegramApprovalCard(payload.originChannelId!, text, payload.gateId),
        warn,
      ));
    } else {
      deliveries.push(await safeDelivery("telegram", () => sendTelegramUser(payload.userId, text, payload.gateId), warn));
    }
  } else if (origin === "discord") {
    const discordText = `${text}\n\nReact ✅ to approve or ❌ to decline.`;
    if (payload.originChannelId) {
      const channelResult = await safeDelivery(
        "discord_channel",
        () => sendDiscordApprovalCard(payload.userId, payload.originChannelId!, discordText, payload.gateId),
        warn,
      );
      deliveries.push(channelResult);

      if (!channelResult.ok) {
        deliveries.push(await safeDelivery(
          "discord_dm",
          () => sendDiscordApprovalDm(payload.userId, discordText, payload.gateId),
          warn,
        ));
      }
    } else {
      deliveries.push(await safeDelivery(
        "discord_dm",
        () => sendDiscordApprovalDm(payload.userId, discordText, payload.gateId),
        warn,
      ));
    }
  }

  deliveries.push(await safeDelivery("in_app", () => sendInApp(payload.userId, text, payload.gateId), warn));
  return deliveries;
}
