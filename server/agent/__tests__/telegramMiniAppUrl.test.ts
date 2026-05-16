import { strict as assert } from "node:assert";
import { getExpectedMiniAppUrl } from "../../integrations/telegram";

const originalMiniAppUrl = process.env.TELEGRAM_MINI_APP_URL;
const originalWebAppUrl = process.env.TELEGRAM_WEB_APP_URL;
const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
const originalNodeEnv = process.env.NODE_ENV;

try {
  process.env.NODE_ENV = "production";
  delete process.env.TELEGRAM_MINI_APP_URL;
  delete process.env.TELEGRAM_WEB_APP_URL;
  process.env.PUBLIC_BASE_URL = "https://app.example.com/some/path";
  assert.equal(
    getExpectedMiniAppUrl(),
    "https://app.example.com",
    "PUBLIC_BASE_URL is the default Mini App origin",
  );

  process.env.TELEGRAM_MINI_APP_URL = "https://jarvis.example.com/inside-telegram";
  assert.equal(
    getExpectedMiniAppUrl(),
    "https://jarvis.example.com",
    "TELEGRAM_MINI_APP_URL overrides the public app origin",
  );

  delete process.env.TELEGRAM_MINI_APP_URL;
  process.env.TELEGRAM_WEB_APP_URL = "https://legacy.example.com/app";
  assert.equal(
    getExpectedMiniAppUrl(),
    "https://legacy.example.com",
    "TELEGRAM_WEB_APP_URL remains a backward-compatible override",
  );

  console.log("telegramMiniAppUrl tests passed");
} finally {
  if (originalMiniAppUrl === undefined) delete process.env.TELEGRAM_MINI_APP_URL;
  else process.env.TELEGRAM_MINI_APP_URL = originalMiniAppUrl;

  if (originalWebAppUrl === undefined) delete process.env.TELEGRAM_WEB_APP_URL;
  else process.env.TELEGRAM_WEB_APP_URL = originalWebAppUrl;

  if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;

  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}
