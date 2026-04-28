/**
 * buildDirectNotification.assert.ts — unit assertions for the
 * notification-routing classifier that decides whether to send a human-readable
 * reconnect message or hand off to an LLM auto-debug session.
 *
 * Run with:  npx tsx server/intelligence/__tests__/buildDirectNotification.assert.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 *
 * Covers the four requirements from task #693:
 *   E. Expired-token error strings → non-null return containing reconnect guidance.
 *   F. Revoked / unauthorized token error strings → non-null return containing reconnect guidance.
 *   G. Missing / invalid bot-token error strings → non-null return containing bot-token guidance.
 *   H. Unrecognised error string → null return (→ LLM auto-debug path).
 */

// DATABASE_URL must be set because integrationValidator.ts imports db.ts,
// which creates a pg.Pool at import time.  The pool is never actually used
// during these tests, but the Pool constructor requires a valid connection string.
if (!process.env.DATABASE_URL) {
  console.error(
    "buildDirectNotification.assert.ts: DATABASE_URL not set — please run in the Replit environment.",
  );
  process.exit(1);
}

import assert from "node:assert/strict";
import { _buildDirectNotificationForTest as buildDirectNotification } from "../integrationValidator";

(async () => {
  // ── Test E: Expired OAuth token ────────────────────────────────────────────
  // Both "token expired" and "please reconnect" trigger the expired-token branch.
  {
    const resultTokenExpired = buildDirectNotification("google", "OAuth token expired — please reconnect");
    assert.notEqual(
      resultTokenExpired,
      null,
      "E1: 'token expired' error → non-null (direct notification, not LLM)",
    );
    assert.ok(
      typeof resultTokenExpired === "string" && resultTokenExpired.length > 0,
      "E1: return value is a non-empty string",
    );
    assert.ok(
      resultTokenExpired!.toLowerCase().includes("reconnect"),
      "E1: message contains reconnect guidance",
    );
    assert.ok(
      resultTokenExpired!.includes("Google (Gmail + Calendar)"),
      "E1: google integration gets the friendly label 'Google (Gmail + Calendar)'",
    );

    const resultPleaseReconnect = buildDirectNotification("outlook", "The session is no longer valid, please reconnect");
    assert.notEqual(
      resultPleaseReconnect,
      null,
      "E2: 'please reconnect' phrase → non-null (direct notification, not LLM)",
    );
    assert.ok(
      resultPleaseReconnect!.toLowerCase().includes("reconnect"),
      "E2: message contains reconnect guidance",
    );
    assert.ok(
      resultPleaseReconnect!.includes("Outlook"),
      "E2: integration name is capitalised in the message",
    );

    console.log("✓ E: expired-token errors → non-null direct notification with reconnect guidance");
  }

  // ── Test F: Revoked / unauthorized token ───────────────────────────────────
  // HTTP 401, HTTP 403, token invalid, token revoked, access denied, unauthorized
  // all map to the revoked-access branch.
  {
    const cases: Array<[string, string]> = [
      ["slack",   "Request failed: http 401 unauthorized"],
      ["discord", "Proxy returned http 403 forbidden"],
      ["google",  "Token invalid — reauth required"],
      ["slack",   "Token revoked by user"],
      ["outlook", "Access denied to resource"],
      ["discord", "Unauthorized request"],
    ];

    for (const [integration, errorMessage] of cases) {
      const result = buildDirectNotification(integration, errorMessage);
      assert.notEqual(
        result,
        null,
        `F: "${errorMessage}" for ${integration} → non-null (direct notification, not LLM)`,
      );
      assert.ok(
        result!.toLowerCase().includes("reconnect"),
        `F: "${errorMessage}" → message contains reconnect guidance`,
      );
      const expectedLabel =
        integration.charAt(0).toUpperCase() + integration.slice(1);
      assert.ok(
        result!.includes(expectedLabel),
        `F: integration label "${expectedLabel}" appears in message`,
      );
    }

    console.log("✓ F: revoked/unauthorized token errors → non-null direct notification with reconnect guidance");
  }

  // ── Test G: Missing / invalid bot token ────────────────────────────────────
  // "bot token missing" and "bot token … invalid" both trigger the bot-token branch.
  {
    const resultMissing = buildDirectNotification("discord", "Bot token missing from environment");
    assert.notEqual(
      resultMissing,
      null,
      "G1: 'bot token missing' → non-null (direct notification, not LLM)",
    );
    assert.ok(
      resultMissing!.toLowerCase().includes("bot token"),
      "G1: message mentions bot token",
    );
    assert.ok(
      resultMissing!.includes("Discord"),
      "G1: integration name is capitalised in the message",
    );

    const resultInvalid = buildDirectNotification("slack", "The provided bot token is invalid");
    assert.notEqual(
      resultInvalid,
      null,
      "G2: 'bot token … invalid' → non-null (direct notification, not LLM)",
    );
    assert.ok(
      resultInvalid!.toLowerCase().includes("bot token"),
      "G2: message mentions bot token",
    );

    console.log("✓ G: missing/invalid bot-token errors → non-null direct notification with bot-token guidance");
  }

  // ── Test H: Unrecognised error string → null (→ LLM auto-debug path) ───────
  {
    const unknownErrors = [
      "Unexpected upstream timeout after 30 s",
      "ECONNRESET while reading response",
      "Internal server error 500",
      "Rate limit exceeded — retry after 60 s",
      "JSON parse error in response body",
    ];

    for (const errorMessage of unknownErrors) {
      const result = buildDirectNotification("google", errorMessage);
      assert.equal(
        result,
        null,
        `H: unrecognised error "${errorMessage}" → null (hands off to LLM auto-debug)`,
      );
    }

    console.log("✓ H: unrecognised errors → null return (LLM auto-debug path)");
  }

  console.log("\nAll buildDirectNotification assertions passed. ✓");
})().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
