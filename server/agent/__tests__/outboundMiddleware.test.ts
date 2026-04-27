/**
 * Unit tests for the OutboundMiddlewareRegistry (message_sending hook).
 *
 * Run with: tsx server/agent/__tests__/outboundMiddleware.test.ts
 */

import { outboundMiddleware, OutboundMiddlewareRegistry } from "../../channels/outboundMiddleware";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

async function run() {
  // ── Built-in middleware (via singleton) ──────────────────────────────────────

  // Whitespace cleaner — trims outer whitespace, collapses 3+ newlines to 2
  // Interior whitespace (between words) is intentionally preserved.
  const cleanResult = await outboundMiddleware.run({
    text: "  Hello world  \n\n\n\nSecond paragraph  ",
    platform: "in_app",
    userId: "u1",
  });
  assert(
    cleanResult !== null && cleanResult.startsWith("Hello world"),
    "OM-1a: whitespace cleaner removes leading whitespace",
  );
  assert(
    cleanResult !== null && cleanResult.endsWith("Second paragraph"),
    "OM-1b: whitespace cleaner removes trailing whitespace",
  );
  assert(
    cleanResult !== null && !cleanResult.includes("\n\n\n"),
    "OM-1c: whitespace cleaner collapses 3+ newlines to 2",
  );

  // Empty reply guard
  const emptyResult = await outboundMiddleware.run({
    text: "   \n  ",
    platform: "in_app",
    userId: "u1",
  });
  assert(
    emptyResult !== null && emptyResult.includes("couldn't generate"),
    "OM-2: empty reply guard substitutes fallback",
  );

  // Length limiter — Discord (1900 char limit)
  const longText = "A".repeat(2000);
  const discordLimited = await outboundMiddleware.run({
    text: longText,
    platform: "discord",
    userId: "u1",
  });
  assert(
    discordLimited !== null && discordLimited.length <= 1900,
    "OM-3: Discord length limiter caps at 1900",
  );
  assert(
    discordLimited !== null && discordLimited.includes("truncated"),
    "OM-3: Discord truncated notice appended",
  );

  // Length limiter — Telegram (4000 char limit)
  const longTelegramText = "B".repeat(4100);
  const telegramLimited = await outboundMiddleware.run({
    text: longTelegramText,
    platform: "telegram",
    userId: "u1",
  });
  assert(
    telegramLimited !== null && telegramLimited.length <= 4000,
    "OM-4: Telegram length limiter caps at 4000",
  );

  // Agent-name prefix — Discord (bold format)
  const discordWithAgent = await outboundMiddleware.run({
    text: "Hello there!",
    platform: "discord",
    userId: "u1",
    agentName: "Aria",
  });
  assert(
    discordWithAgent === "**Aria:** Hello there!",
    "OM-5: Discord agent-name prefix uses bold format",
  );

  // Agent-name prefix — Telegram (plain format)
  const telegramWithAgent = await outboundMiddleware.run({
    text: "Hello there!",
    platform: "telegram",
    userId: "u1",
    agentName: "Aria",
  });
  assert(
    telegramWithAgent === "Aria: Hello there!",
    "OM-6: Telegram agent-name prefix uses plain format",
  );

  // Agent-name prefix — in_app (no prefix)
  const inAppWithAgent = await outboundMiddleware.run({
    text: "Hello there!",
    platform: "in_app",
    userId: "u1",
    agentName: "Aria",
  });
  assert(
    inAppWithAgent === "Hello there!",
    "OM-7: in_app platform skips agent-name prefix",
  );

  // No agentName → no prefix added
  const noAgentName = await outboundMiddleware.run({
    text: "Reply text",
    platform: "discord",
    userId: "u1",
  });
  assert(noAgentName === "Reply text", "OM-8: no agentName → text unchanged by prefix handler");

  // ── Custom registry (isolated from singleton) ──────────────────────────────

  // Cancel handler short-circuits chain
  const fresh = new OutboundMiddlewareRegistry();
  fresh.use(() => ({ cancel: true }), { priority: 100 });
  fresh.use(() => ({ text: "should not appear" }), { priority: 50 });
  const cancelResult = await fresh.run({ text: "anything", platform: "discord", userId: "u1" });
  assert(cancelResult === null, "OM-9: cancel handler returns null and short-circuits chain");

  // Rewrite chain — higher priority runs first
  const rewrite = new OutboundMiddlewareRegistry();
  rewrite.use((ctx) => ({ text: ctx.text + " [A]" }), { priority: 200 });
  rewrite.use((ctx) => ({ text: ctx.text + " [B]" }), { priority: 100 });
  const rewriteResult = await rewrite.run({ text: "base", platform: "discord", userId: "u1" });
  assert(rewriteResult === "base [A] [B]", "OM-10: higher priority runs first, rewrites chain in order");

  // Throwing handler is skipped, chain continues
  const throwing = new OutboundMiddlewareRegistry();
  throwing.use(() => { throw new Error("boom"); }, { priority: 200 });
  throwing.use(() => ({ text: "recovered" }), { priority: 100 });
  const throwResult = await throwing.run({ text: "original", platform: "discord", userId: "u1" });
  assert(throwResult === "recovered", "OM-11: throwing handler skipped, chain continues");

  // Void / undefined return passes text through unchanged
  const voidHandler = new OutboundMiddlewareRegistry();
  voidHandler.use(() => undefined, { priority: 100 });
  const voidResult = await voidHandler.run({ text: "intact", platform: "discord", userId: "u1" });
  assert(voidResult === "intact", "OM-12: void return passes text through unchanged");

  // Priority ordering — lower-priority handler cannot override higher-priority output
  const priority = new OutboundMiddlewareRegistry();
  priority.use(() => ({ text: "from-high" }), { priority: 300 });
  priority.use(() => ({ text: "from-low" }), { priority: 100 });
  const priorityResult = await priority.run({ text: "start", platform: "discord", userId: "u1" });
  assert(priorityResult === "from-low", "OM-13: both handlers run in priority order (high rewrites first, low rewrites last)");

  // ── Print summary ────────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("All outbound middleware assertions passed ✓");
  } else {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
