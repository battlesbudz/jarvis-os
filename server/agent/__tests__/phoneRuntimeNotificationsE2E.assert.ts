import assert from "node:assert/strict";
import type OpenAI from "openai";

process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";

function chatTool(name: string): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description: `${name} test tool`,
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
}

async function main() {
  const {
    deterministicAndroidToolSummary,
    deterministicPhoneRuntimeToolCallFromRequest,
    isPhoneRuntimeCoveredRequest,
  } = await import("../phoneRuntimeRouting");
  const { resolveAndroidNotificationFollowUp } = await import("../androidNotificationFollowups");

  const phoneTools = [
    chatTool("android_open_app"),
    chatTool("android_capture_screen"),
    chatTool("android_read_notifications"),
  ];
  const connectedPhoneRuntime = { androidActive: true, phoneRuntimeCoveredRequest: true };

  for (const requestText of [
    "Read my notifications",
    "What are my notifications?",
    "android_read _notifications and tell me what they are",
  ]) {
    assert.equal(
      isPhoneRuntimeCoveredRequest(requestText),
      true,
      `${requestText} should enter the deterministic Phone Runtime route`,
    );
    const toolCall = deterministicPhoneRuntimeToolCallFromRequest(requestText, phoneTools, connectedPhoneRuntime);
    assert.equal(toolCall?.function.name, "android_read_notifications");
  }

  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications", phoneTools, {
      androidActive: false,
      phoneRuntimeCoveredRequest: false,
    }),
    null,
    "offline Android Device Control must not use the deterministic notification shortcut",
  );

  assert.equal(
    isPhoneRuntimeCoveredRequest("Summarize how Android notifications work."),
    false,
    "informational notification questions should not force phone-control routing",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Do not read my notifications.", phoneTools, connectedPhoneRuntime),
    null,
    "negated notification requests must not run phone control",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications and then open Gmail.", phoneTools, connectedPhoneRuntime),
    null,
    "compound phone requests must stay in the multi-tool loop",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications and open Gmail.", phoneTools, connectedPhoneRuntime),
    null,
    "plain-and compound phone requests must stay in the multi-tool loop",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Do I have any Gmail notifications?", phoneTools, connectedPhoneRuntime),
    null,
    "filtered notification requests must let the normal loop apply the filter",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications but only give me the count.", phoneTools, connectedPhoneRuntime),
    null,
    "count-only notification requests must not stream the broad notification list",
  );

  const finalText = deterministicAndroidToolSummary("android_read_notifications", {
    result: "success",
    label: "2 notifications",
    detail: JSON.stringify({
      notifications: [
        { app: "Life360", title: "Justin arrived Home", text: "", ts: Date.now() },
        { app: "Codex", title: "PR review finished", text: "No major issues found", ts: Date.now() },
      ],
      source: "notification_listener",
    }),
  }, {
    deterministicToolCall: true,
  });

  assert.match(finalText ?? "", /Life360/);
  assert.match(finalText ?? "", /Codex/);
  assert.doesNotMatch(finalText ?? "", /cannot|do not have access|language model/i);
  assert.equal(
    deterministicAndroidToolSummary("android_read_notifications", {
      result: "success",
      label: "2 notifications",
      detail: JSON.stringify({
        notifications: [
          { app: "Life360", title: "Justin arrived Home", text: "", ts: Date.now() },
          { app: "Codex", title: "PR review finished", text: "No major issues found", ts: Date.now() },
        ],
      }),
    }),
    null,
    "model-selected notification tool calls must not short-circuit the multi-tool loop",
  );

  const followUpNotifications = [
    { app: "Gmail", pkg: "com.google.android.gm", title: "Reddit digest", text: "Trending posts from Reddit", ts: Date.now() },
    { app: "Reddit", pkg: "com.reddit.frontpage", title: "vivecoding thread", text: "New replies", ts: Date.now() },
  ];
  const referencedOpen = resolveAndroidNotificationFollowUp("Open the Reddit one", followUpNotifications);
  assert.equal(referencedOpen?.kind, "open");
  assert.equal(referencedOpen?.notification.app, "Reddit");

  const plainOpen = resolveAndroidNotificationFollowUp("Open Reddit", [
    { app: "Gmail", pkg: "com.google.android.gm", title: "Reddit digest", text: "Trending posts from Reddit", ts: Date.now() },
  ]);
  assert.equal(plainOpen, null, "plain app opens must fall through to app control instead of notification context");

  const messagesOpen = resolveAndroidNotificationFollowUp("Open Messages", [
    { app: "Gmail", pkg: "com.google.android.gm", title: "New messages", text: "Unread messages are waiting", ts: Date.now() },
  ]);
  assert.equal(messagesOpen, null, "Messages app opens must not be treated as notification-message references");

  const metaQuestion = resolveAndroidNotificationFollowUp("What are notifications?", followUpNotifications);
  assert.equal(metaQuestion, null, "generic notification meta questions must not reveal current notifications");
  const ownNotificationQuestion = resolveAndroidNotificationFollowUp("What are my notifications?", followUpNotifications);
  assert.equal(ownNotificationQuestion?.kind, "summary");

  const olderVisibleNotification = resolveAndroidNotificationFollowUp("Read all of them", [
    { app: "Reddit", pkg: "com.reddit.frontpage", title: "Older thread", text: "Still visible", ts: Date.now() - 60 * 60 * 1000 },
  ]);
  assert.equal(olderVisibleNotification?.kind, "read_all", "observed notification context must not depend on post age");
  const allHandsSpecificRead = resolveAndroidNotificationFollowUp("Read the All Hands notification", [
    { app: "Calendar", pkg: "com.google.android.calendar", title: "All Hands", text: "Starts at 3 PM", ts: Date.now() },
    { app: "Reddit", pkg: "com.reddit.frontpage", title: "Local models thread", text: "New replies", ts: Date.now() },
  ]);
  assert.equal(allHandsSpecificRead?.kind, "read", "specific notification titles containing All must not trigger read-all");
  assert.match(allHandsSpecificRead?.response ?? "", /Calendar: All Hands/);
  const bareAllNotificationsQuestion = resolveAndroidNotificationFollowUp("Are all notifications enabled?", followUpNotifications);
  assert.equal(bareAllNotificationsQuestion, null, "bare all-notifications questions must not dump cached notifications");
  const latestNewsRequest = resolveAndroidNotificationFollowUp("Read me the latest news", [
    { app: "News", pkg: "com.google.android.apps.magazines", title: "Markets rally", text: "Stocks rose today", ts: Date.now() },
  ]);
  assert.equal(latestNewsRequest, null, "content requests without a notification referent must fall through");
  const newsNotificationRequest = resolveAndroidNotificationFollowUp("Read the News notification", [
    { app: "News", pkg: "com.google.android.apps.magazines", title: "Markets rally", text: "Stocks rose today", ts: Date.now() },
  ]);
  assert.equal(newsNotificationRequest?.kind, "read", "explicit notification reads should still use cached context");
  const emptyObservedNotifications = resolveAndroidNotificationFollowUp("Read all of them", []);
  assert.equal(emptyObservedNotifications?.kind, "read_all", "empty observations must remain valid follow-up context");
  assert.match(emptyObservedNotifications?.response ?? "", /no current notifications/i);

  console.log("All Phone Runtime notification E2E contract assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
