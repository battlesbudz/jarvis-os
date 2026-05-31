import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyTelegramWebAppInitData } from "../../auth.ts";

function signedInitData(botToken: string, values: Record<string, string>): string {
  const pairs = Object.entries(values).map(([key, value]) => `${key}=${value}`).sort();
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

function run() {
  const botToken = "12345:test-token";
  const nowSeconds = 1_800_000_000;
  const user = JSON.stringify({ id: 5189332548, first_name: "Battles" });
  const valid = signedInitData(botToken, {
    auth_date: String(nowSeconds),
    query_id: "query-1",
    user,
  });

  assert.deepEqual(
    verifyTelegramWebAppInitData(valid, botToken, nowSeconds * 1000),
    { telegramUserId: "5189332548" },
  );

  assert.equal(
    verifyTelegramWebAppInitData(valid.replace("query-1", "query-2"), botToken, nowSeconds * 1000),
    null,
  );

  assert.equal(
    verifyTelegramWebAppInitData(valid, botToken, (nowSeconds + 25 * 60 * 60) * 1000),
    null,
  );

  console.log("telegramWebAppAuth tests passed");
}

run();
