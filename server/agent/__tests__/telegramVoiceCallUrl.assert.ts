import { strict as assert } from "node:assert";
import { getExpectedVoiceCallUrl } from "../../integrations/telegram";

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

  console.log("telegramVoiceCallUrl assertions passed");
} finally {
  if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;

  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}
