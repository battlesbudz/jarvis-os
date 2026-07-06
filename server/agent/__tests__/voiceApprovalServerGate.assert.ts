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
  isAndroidSubmitCapableAction("android_tap_screen", { x: 540, y: 1800 }, "Tap submit on this payment form"),
  true,
  "submit/pay taps should require confirmation",
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

const preview = buildAndroidSubmitConfirmationPreview(
  "android_type_text",
  { text: "Thanks", submit: true },
  "Reply to this text",
);
assert.equal(preview.action, "android_type_text");
assert.equal(preview.text, "Thanks");
assert.match(preview.reason, /submit|send|save|pay|publish/i);

console.log("OK: server approval gate protects submit-capable Android input");
