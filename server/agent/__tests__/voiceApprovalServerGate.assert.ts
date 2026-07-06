import assert from "node:assert/strict";
import {
  buildAndroidSubmitConfirmationPreview,
  isAndroidSubmitCapableAction,
} from "../voiceApprovalServerGate";

assert.equal(
  isAndroidSubmitCapableAction("daemon_action", { action: "android_type", text: "hello", submit: true }, "Send this message"),
  true,
  "raw android_type submit should require confirmation",
);

assert.equal(
  isAndroidSubmitCapableAction("android_type_text", { text: "ai videos", submit: false }, "Search YouTube for ai videos"),
  false,
  "ordinary focused-field typing should remain low risk",
);

assert.equal(
  isAndroidSubmitCapableAction("android_type_text", { text: "Thanks", submit: true }, "Reply to this text"),
  true,
  "high-level android_type_text submit should require confirmation",
);

assert.equal(
  isAndroidSubmitCapableAction("android_type_text", { text: "On my way", submit: true }, "Text Bob that I am on my way"),
  true,
  "typed text-message sends should require confirmation",
);

assert.equal(
  isAndroidSubmitCapableAction(
    "android_type_text",
    { text: "On my way", submit: true },
    "Use Messages to tell Bob I'm on my way",
  ),
  true,
  "tell-style typed message sends should require confirmation",
);

assert.equal(
  isAndroidSubmitCapableAction("android_press_phone_key", { key: "enter" }, "Message Sarah hello"),
  true,
  "message submit keys should require confirmation",
);

assert.equal(
  isAndroidSubmitCapableAction("android_type_text", { text: "recipes", submit: true }, "Search Instagram for recipes"),
  false,
  "typed search submissions should remain low risk",
);

assert.equal(
  isAndroidSubmitCapableAction(
    "daemon_action",
    { action: "android_operator_action", operatorAction: { type: "type_text", text: "Ship it", submit: true } },
    "Reply to this text",
  ),
  true,
  "nested operator type_text submit should require confirmation",
);

assert.equal(
  isAndroidSubmitCapableAction(
    "daemon_action",
    { action: "android_operator_action", operatorAction: { type: "type_text", text: "recipes", submit: true } },
    "Search Instagram for recipes",
  ),
  false,
  "nested operator typed searches should remain low risk",
);

assert.equal(
  isAndroidSubmitCapableAction("android_tap_screen", { x: 540, y: 1800 }, "Tap submit on this payment form"),
  true,
  "submit/pay taps should require confirmation",
);

assert.equal(
  isAndroidSubmitCapableAction("android_tap_screen", { x: 540, y: 1800 }, "Complete checkout"),
  true,
  "checkout taps should require confirmation",
);

assert.equal(
  isAndroidSubmitCapableAction("android_press_phone_key", { key: "enter" }, "Check out now"),
  true,
  "checkout submit keys should require confirmation",
);

assert.equal(
  isAndroidSubmitCapableAction("android_tap_screen", { x: 120, y: 340 }, "Tap the search field"),
  false,
  "ordinary navigation taps should remain low risk",
);

assert.equal(
  isAndroidSubmitCapableAction("android_press_phone_key", { key: "enter" }, "Search YouTube for workout videos"),
  false,
  "enter key used for search should not be over-gated",
);

assert.equal(
  isAndroidSubmitCapableAction("android_press_phone_key", { key: "enter" }, "Send this message"),
  true,
  "enter key used at an external send boundary should require confirmation",
);

for (const [action, args] of [
  ["android_sms_send", { action: "android_sms_send", to: "+15551234567", message: "On my way", approved: true }],
  ["android_notification_reply", { action: "android_notification_reply", notificationKey: "notif-1", replyText: "Yes", approved: true }],
  ["android_camera_clip", { action: "android_camera_clip", durationMs: 5000, approved: true }],
  ["android_screen_record", { action: "android_screen_record", durationMs: 10000, approved: true }],
] as const) {
  assert.equal(
    isAndroidSubmitCapableAction("daemon_action", args, "Do this phone action"),
    true,
    `${action} should require server-side confirmation even when model args already include approval`,
  );
}

const preview = buildAndroidSubmitConfirmationPreview(
  "android_type_text",
  { text: "Thanks", submit: true },
  "Reply to this text",
);
assert.equal(preview.action, "android_type_text");
assert.equal(preview.text, "Thanks");
assert.match(preview.reason, /submit|send|save|pay|publish/i);

const nestedOperatorPreview = buildAndroidSubmitConfirmationPreview(
  "daemon_action",
  { action: "android_operator_action", operatorAction: { type: "type_text", text: "Ship it", submit: true } },
  "Reply to this text",
);
assert.equal(nestedOperatorPreview.tool, "daemon_action");
assert.equal(nestedOperatorPreview.action, "android_operator_action");
assert.equal(nestedOperatorPreview.operatorActionType, "type_text");
assert.equal(nestedOperatorPreview.text, "Ship it");

const smsPreview = buildAndroidSubmitConfirmationPreview(
  "daemon_action",
  { action: "android_sms_send", to: "+15551234567", message: "On my way", approved: true },
  "Text them back",
);
assert.equal(smsPreview.tool, "daemon_action");
assert.equal(smsPreview.action, "android_sms_send");
assert.equal(smsPreview.to, "+15551234567");
assert.equal(smsPreview.message, "On my way");

console.log("OK: server approval gate protects submit-capable Android input");
