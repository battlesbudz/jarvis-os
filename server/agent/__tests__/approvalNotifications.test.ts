import assert from "node:assert/strict";

import {
  buildTelegramApprovalKeyboard,
  notifyApprovalRequest,
  parseTelegramApprovalCallback,
} from "../approvalNotifications";

type Sent = {
  target: string;
  userId?: string;
  channelId?: string;
  text: string;
  gateId?: string;
  buttons?: Array<{ text: string; callback_data?: string }>;
};

function makePayload(overrides: Partial<Parameters<typeof notifyApprovalRequest>[0]> = {}) {
  return {
    userId: "user_1",
    gateId: "gate_123",
    agentId: "coach_app:user_1",
    agentName: "Jarvis App Coach",
    toolName: "send_email",
    description: "Jarvis wants to send an email",
    originChannel: "Gateway",
    ...overrides,
  };
}

function makeDeps(sent: Sent[]) {
  return {
    sendInApp: async (userId: string, text: string, gateId: string) => {
      sent.push({ target: "in_app", userId, text, gateId });
    },
    sendTelegramChat: async (channelId: string, text: string) => {
      sent.push({ target: "telegram_chat", channelId, text });
    },
    sendTelegramApprovalCard: async (channelId: string, text: string, gateId: string) => {
      sent.push({
        target: "telegram_approval_card",
        channelId,
        text,
        gateId,
        buttons: buildTelegramApprovalKeyboard(gateId),
      });
    },
    sendTelegramUser: async (userId: string, text: string, gateId: string) => {
      sent.push({
        target: "telegram_user_approval_card",
        userId,
        text,
        gateId,
        buttons: buildTelegramApprovalKeyboard(gateId),
      });
    },
    sendDiscordChannel: async (userId: string, channelId: string, text: string) => {
      sent.push({ target: "discord_channel", userId, channelId, text });
      return true;
    },
    sendDiscordApprovalCard: async (userId: string, channelId: string, text: string, gateId: string) => {
      sent.push({ target: "discord_approval_card", userId, channelId, text, gateId });
      return true;
    },
    sendDiscordDm: async (userId: string, text: string) => {
      sent.push({ target: "discord_dm", userId, text });
      return true;
    },
    sendDiscordApprovalDm: async (userId: string, text: string, gateId: string) => {
      sent.push({ target: "discord_approval_dm", userId, text, gateId });
      return true;
    },
  };
}

async function main(): Promise<void> {
  {
    const sent: Sent[] = [];
    await notifyApprovalRequest(
      makePayload({ originChannel: "Telegram", originChannelId: "12345" }),
      makeDeps(sent),
    );

    assert.deepEqual(sent.map((entry) => entry.target), ["telegram_approval_card", "in_app"]);
    assert.equal(sent[0].channelId, "12345");
    assert.match(sent[0].text, /gate_123/);
    assert.match(sent[0].text, /Use the buttons below to approve or decline/i);
    assert.deepEqual(sent[0].buttons, [
      { text: "Approve", callback_data: "ag:ok:gate_123" },
      { text: "Decline", callback_data: "ag:no:gate_123" },
    ]);
    assert.equal(sent[1].gateId, "gate_123");
  }

  {
    const sent: Sent[] = [];
    await notifyApprovalRequest(
      makePayload({ originChannel: "Telegram" }),
      makeDeps(sent),
    );

    assert.deepEqual(sent.map((entry) => entry.target), ["telegram_user_approval_card", "in_app"]);
    assert.equal(sent[0].userId, "user_1");
    assert.deepEqual(sent[0].buttons, [
      { text: "Approve", callback_data: "ag:ok:gate_123" },
      { text: "Decline", callback_data: "ag:no:gate_123" },
    ]);
    assert.equal(sent[1].gateId, "gate_123");
  }

  {
    const sent: Sent[] = [];
    await notifyApprovalRequest(
      makePayload({ originChannel: "Discord #ops", originChannelId: "discord-channel-1" }),
      makeDeps(sent),
    );

    assert.deepEqual(sent.map((entry) => entry.target), ["discord_approval_card", "in_app"]);
    assert.equal(sent[0].channelId, "discord-channel-1");
    assert.match(sent[0].text, /React ✅ to approve or ❌ to decline/i);
    assert.equal(sent[0].gateId, "gate_123");
    assert.equal(sent[1].gateId, "gate_123");
  }

  {
    const sent: Sent[] = [];
    await notifyApprovalRequest(
      makePayload({ originChannel: "discord" }),
      makeDeps(sent),
    );

    assert.deepEqual(sent.map((entry) => entry.target), ["discord_approval_dm", "in_app"]);
    assert.equal(sent[0].gateId, "gate_123");
  }

  {
    const sent: Sent[] = [];
    await notifyApprovalRequest(
      makePayload({ originChannel: "Gateway", originChannelId: "gateway-chat" }),
      makeDeps(sent),
    );

    assert.deepEqual(sent.map((entry) => entry.target), ["in_app"]);
    assert.equal(sent[0].gateId, "gate_123");
  }

  {
    const sent: Sent[] = [];
    await notifyApprovalRequest(
      makePayload({ originChannel: "webchat" }),
      makeDeps(sent),
    );

    assert.deepEqual(sent.map((entry) => entry.target), ["in_app"]);
  }

  assert.deepEqual(parseTelegramApprovalCallback("ag:ok:gate_123"), {
    decision: "approve",
    gateId: "gate_123",
  });
  assert.deepEqual(parseTelegramApprovalCallback("ag:no:gate_123"), {
    decision: "reject",
    gateId: "gate_123",
  });
  assert.equal(parseTelegramApprovalCallback("voice_dismiss"), null);

  console.log("approval notification routing assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
