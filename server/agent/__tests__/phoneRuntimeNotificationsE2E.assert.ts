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
  const {
    extractAndroidNotificationsFromScreenContext,
    normalizeAndroidNotifications,
    summarizeAndroidNotifications,
  } = await import("../androidNotificationSummary");

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

  const shadeScreenContext = JSON.stringify({
    package: "com.android.systemui",
    activity: "android.widget.FrameLayout",
    text: [
      "AT&T",
      "Bluetooth on.",
      "NFC on",
      "Alarm",
      "Battery 20 percent.",
      "Applications are using your location.",
      "Remote",
      "3:33 AM",
      "Codex is working",
      "Expand",
      "Life360",
      "3:16 AM",
      "Turn off Battery Optimization",
      "Jarvis app",
      "3:15 AM",
      "Connected to SM-F956U",
    ],
  });
  const shadeSummary = deterministicAndroidToolSummary("android_read_notifications", {
    result: "success",
    label: "Notification shade read",
    detail: JSON.stringify({
      source: "notification_shade_accessibility_tree",
      screenContext: shadeScreenContext,
    }),
  }, {
    deterministicToolCall: true,
  });
  assert.match(shadeSummary ?? "", /Codex|Life360|Jarvis app/);
  assert.doesNotMatch(shadeSummary ?? "", /com\.android\.systemui|"package"|\{"text"/);
  const shadeNotifications = extractAndroidNotificationsFromScreenContext(shadeScreenContext);
  assert.ok(shadeNotifications.length >= 2);
  assert.match(JSON.stringify(shadeNotifications), /Codex is working/);
  assert.doesNotMatch(JSON.stringify(shadeNotifications), /just now/);
  const shadeFollowUpSummary = resolveAndroidNotificationFollowUp("Summarize this", shadeNotifications);
  assert.equal(shadeFollowUpSummary?.kind, "summary");
  assert.match(shadeFollowUpSummary?.response ?? "", /Codex|Life360|Jarvis app/);
  const repeatedAppShadeNotifications = extractAndroidNotificationsFromScreenContext(JSON.stringify({
    text: [
      "Gmail",
      "3:16 AM",
      "Alice: First email",
      "3:15 AM",
      "Bob: Second email",
    ],
  }));
  assert.equal(repeatedAppShadeNotifications.length, 2);
  assert.equal(repeatedAppShadeNotifications[0]?.app, "Gmail");
  assert.equal(repeatedAppShadeNotifications[1]?.app, "Gmail");
  assert.doesNotMatch(JSON.stringify(repeatedAppShadeNotifications), /\"app\":\"Alice/);

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
  const partialAppNameOpen = resolveAndroidNotificationFollowUp("Open Google Maps", [
    { app: "Google Play Services", pkg: "com.google.android.gms", title: "Account action", text: "Review settings", ts: Date.now() },
  ]);
  assert.equal(partialAppNameOpen, null, "plain app opens must not match cached notifications by partial app-name terms");
  const exactAppNameOpen = resolveAndroidNotificationFollowUp("Open Google Play Services", [
    { app: "Google Play Services", pkg: "com.google.android.gms", title: "Account action", text: "Review settings", ts: Date.now() },
  ]);
  assert.equal(exactAppNameOpen?.kind, "open", "plain app opens may use cached context when the full app name matches");

  const metaQuestion = resolveAndroidNotificationFollowUp("What are notifications?", followUpNotifications);
  assert.equal(metaQuestion, null, "generic notification meta questions must not reveal current notifications");
  const ownNotificationQuestion = resolveAndroidNotificationFollowUp("What are my notifications?", followUpNotifications);
  assert.equal(ownNotificationQuestion, null, "explicit current notification requests must refresh from Android");
  const currentNotificationQuestion = resolveAndroidNotificationFollowUp("What are my current notifications?", followUpNotifications);
  assert.equal(currentNotificationQuestion, null, "current notification requests must not use stale follow-up context");
  const justReadNotificationQuestion = resolveAndroidNotificationFollowUp("What were the notifications you just read?", followUpNotifications);
  assert.equal(justReadNotificationQuestion?.kind, "summary");

  const olderVisibleNotification = resolveAndroidNotificationFollowUp("Read all of them", [
    { app: "Reddit", pkg: "com.reddit.frontpage", title: "Older thread", text: "Still visible", ts: Date.now() - 60 * 60 * 1000 },
  ]);
  assert.equal(olderVisibleNotification?.kind, "read_all", "observed notification context must not depend on post age");
  const explicitReadAllCurrentNotifications = resolveAndroidNotificationFollowUp("Read all my notifications", followUpNotifications);
  assert.equal(explicitReadAllCurrentNotifications, null, "explicit current all-notification requests must refresh from Android");
  const explicitShowAllCurrentNotifications = resolveAndroidNotificationFollowUp("Show every notification", followUpNotifications);
  assert.equal(explicitShowAllCurrentNotifications, null, "explicit all-notification requests must not use stale context");
  const pronounReadAllNotifications = resolveAndroidNotificationFollowUp("Show every one of these", followUpNotifications);
  assert.equal(pronounReadAllNotifications?.kind, "read_all", "pronoun all-notification follow-ups should still use cached context");
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
  const bareOrdinalRead = resolveAndroidNotificationFollowUp("Read the last paragraph", followUpNotifications);
  assert.equal(bareOrdinalRead, null, "bare ordinal reads must not use notification context");
  const bareOrdinalOpen = resolveAndroidNotificationFollowUp("Open the last project", followUpNotifications);
  assert.equal(bareOrdinalOpen, null, "bare ordinal opens must not use notification context");
  const ordinalNotificationRead = resolveAndroidNotificationFollowUp("Read the last one", followUpNotifications);
  assert.equal(ordinalNotificationRead?.kind, "read", "ordinal notification referents should still work when anchored by one");
  const unrelatedLastSummary = resolveAndroidNotificationFollowUp("Tell me about the last budget meeting", followUpNotifications);
  assert.equal(unrelatedLastSummary, null, "generic last/previous summary questions must not dump cached notifications");
  const unrelatedPronounQuestion = resolveAndroidNotificationFollowUp("What are those shoes?", followUpNotifications);
  assert.equal(unrelatedPronounQuestion, null, "bare pronoun questions must not dump cached notifications");
  const unrelatedItQuestion = resolveAndroidNotificationFollowUp("Tell me about it", followUpNotifications);
  assert.equal(unrelatedItQuestion, null, "generic tell-me-about-it questions must not dump cached notifications");
  const notificationSummaryAgain = resolveAndroidNotificationFollowUp("Summarize those again", followUpNotifications);
  assert.equal(notificationSummaryAgain?.kind, "summary", "pronoun-anchored notification summaries should still work");
  const spamRiskNotifications = [
    { app: "Missed call", pkg: "com.samsung.android.dialer", title: "Spam Risk", text: "", ts: Date.now() },
    { app: "Gmail", pkg: "com.google.android.gm", title: "Invoice due", text: "Invoice 123 is due tomorrow", ts: Date.now() },
  ];
  assert.equal(
    normalizeAndroidNotifications(spamRiskNotifications)[0]?.priority,
    "normal",
    "Spam Risk missed calls must not be elevated as important notifications",
  );
  const spamRiskSummary = summarizeAndroidNotifications(spamRiskNotifications);
  assert.doesNotMatch(spamRiskSummary, /important one is:\s*Missed call:\s*Spam Risk/i);
  const fullFollowUpSummary = resolveAndroidNotificationFollowUp("Can you summarize all of them?", spamRiskNotifications);
  assert.equal(fullFollowUpSummary?.kind, "summary");
  assert.match(fullFollowUpSummary?.response ?? "", /found 2/i);
  assert.match(fullFollowUpSummary?.response ?? "", /Spam Risk/);
  assert.match(fullFollowUpSummary?.response ?? "", /Gmail/);
  assert.doesNotMatch(fullFollowUpSummary?.response ?? "", /cannot summarize|restricted to/i);
  const soleNotification = [
    { app: "Calendar", pkg: "com.google.android.calendar", title: "Team sync", text: "Starts in 5 minutes", ts: Date.now() },
  ];
  const soleNotificationRead = resolveAndroidNotificationFollowUp("Read it", soleNotification);
  assert.equal(soleNotificationRead?.kind, "read", "single-notification pronoun reads should resolve deterministically");
  const soleNotificationOpen = resolveAndroidNotificationFollowUp("Open that", soleNotification);
  assert.equal(soleNotificationOpen?.kind, "open", "single-notification pronoun opens should resolve deterministically");
  const soleGenericOneAppOpen = resolveAndroidNotificationFollowUp("Open one app", soleNotification);
  assert.equal(soleGenericOneAppOpen, null, "generic one-app requests must not target the sole notification");
  const solePluralNotificationOpen = resolveAndroidNotificationFollowUp("Open my notifications", soleNotification);
  assert.equal(solePluralNotificationOpen, null, "plural notification-shade requests must not target the sole notification");
  const emptyObservedNotifications = resolveAndroidNotificationFollowUp("Read all of them", []);
  assert.equal(emptyObservedNotifications?.kind, "read_all", "empty observations must remain valid follow-up context");
  assert.match(emptyObservedNotifications?.response ?? "", /no current notifications/i);

  console.log("All Phone Runtime notification E2E contract assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
