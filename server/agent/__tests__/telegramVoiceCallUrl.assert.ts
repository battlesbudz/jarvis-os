import { strict as assert } from "node:assert";
import {
  buildTelegramQuickActionKeyboard,
  buildVoiceCallKeyboard,
  getExpectedVoiceCallUrl,
  getExpectedVoiceMiniAppUrl,
} from "../../integrations/telegram";

const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
const originalNodeEnv = process.env.NODE_ENV;

try {
  process.env.NODE_ENV = "production";
  process.env.PUBLIC_BASE_URL = "https://app.example.com/some/path";

  assert.equal(
    getExpectedVoiceCallUrl(),
    "https://app.example.com/go/voice-call",
    "Telegram voice call button must use a public HTTPS redirect URL",
  );
  assert.equal(
    getExpectedVoiceMiniAppUrl(),
    "https://app.example.com/voice-realtime",
    "Telegram voice call Mini App button should open the voice route inside Telegram",
  );

  assert.deepEqual(buildVoiceCallKeyboard({ includeTextReplyButton: true }), {
    inline_keyboard: [[
      { text: "Open voice call", web_app: { url: "https://app.example.com/voice-realtime" } },
    ]],
  });

  assert.deepEqual(buildTelegramQuickActionKeyboard(), {
    keyboard: [[{ text: "Add to triage" }, { text: "Stop" }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Tap a quick action...",
  });

  console.log("telegramVoiceCallUrl assertions passed");
} finally {
  if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;

  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}
