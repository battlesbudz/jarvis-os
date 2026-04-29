/**
 * Unit tests for the channel-isolation logic in notifyJobComplete.
 *
 * Uses the exported `_notifyJobCompleteCore` helper which accepts its four
 * external dependencies (getChannel, postToDiscordChannelById, sendToDiscordUser,
 * notifyUser) as injectable parameters — no Jest module mocking required.
 *
 * Run with: tsx server/agent/__tests__/jobQueue.notifyJobComplete.test.ts
 */

import { _notifyJobCompleteCore, type NotifyJobCompleteDeps } from "../notifyJobCompleteCore";
import type { Channel, ChannelSendResult } from "../../channels/types";
import { SIMPLE_ORIGIN_CHANNELS } from "@shared/schema";
import type { ChannelName, NotificationType } from "@shared/schema";

// ── Test bookkeeping ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ── Mock helpers ──────────────────────────────────────────────────────────────

/** Creates a minimal Channel mock that records sendMessage calls. */
function makeChannelMock(name: ChannelName, sendOk = true) {
  const calls: Array<{ userId: string; text: string }> = [];
  const ch: Channel = {
    name,
    toolGroups: [],
    isConfigured: () => true,
    isLinkedFor: async () => true,
    sendMessage: async (userId, text) => {
      calls.push({ userId, text });
      return { ok: sendOk } satisfies ChannelSendResult;
    },
  };
  return { ch, calls };
}

/** Builds a full deps object with controllable spy functions. */
interface SpyDeps extends NotifyJobCompleteDeps {
  _calls: {
    getChannel: Array<ChannelName>;
    postToDiscordChannelById: Array<{ userId: string; channelId: string; text: string }>;
    sendToDiscordUser: Array<{ userId: string; text: string }>;
    notifyUser: Array<{ userId: string; notificationType: NotificationType; text: string }>;
  };
  _channels: Map<ChannelName, ReturnType<typeof makeChannelMock>>;
}

function makeDeps(opts: {
  postToDiscordChannelByIdResult?: boolean;
  sendToDiscordUserResult?: boolean;
  telegramSendOk?: boolean;
  inAppSendOk?: boolean;
} = {}): SpyDeps {
  const {
    postToDiscordChannelByIdResult = true,
    sendToDiscordUserResult = true,
    telegramSendOk = true,
    inAppSendOk = true,
  } = opts;

  const channels = new Map<ChannelName, ReturnType<typeof makeChannelMock>>();
  channels.set("telegram", makeChannelMock("telegram", telegramSendOk));
  channels.set("in_app", makeChannelMock("in_app", inAppSendOk));

  const calls: SpyDeps["_calls"] = {
    getChannel: [],
    postToDiscordChannelById: [],
    sendToDiscordUser: [],
    notifyUser: [],
  };

  const deps: SpyDeps = {
    _calls: calls,
    _channels: channels,

    getChannel: (name: ChannelName) => {
      calls.getChannel.push(name);
      return channels.get(name)?.ch;
    },

    postToDiscordChannelById: async (userId: string, channelId: string, text: string) => {
      calls.postToDiscordChannelById.push({ userId, channelId, text });
      return postToDiscordChannelByIdResult;
    },

    sendToDiscordUser: async (userId: string, text: string) => {
      calls.sendToDiscordUser.push({ userId, text });
      return sendToDiscordUserResult;
    },

    notifyUser: async (userId: string, notificationType: NotificationType, text: string) => {
      calls.notifyUser.push({ userId, notificationType, text });
      return [];
    },
  };

  return deps;
}

const USER = "user-abc";
const JOB_TYPE: import("../jobClient").AgentJobType = "general";
const TITLE = "Task done";
const BODY = "Here are the results.";

// ── Test suite ────────────────────────────────────────────────────────────────

async function run() {
  // ── T1: originChannel = "telegram" ────────────────────────────────────────
  console.log("\nT1: originChannel=telegram");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "telegram", undefined, deps);

    assert(
      deps._calls.notifyUser.length === 0,
      "T1-a: notifyUser is NOT called for telegram origin",
    );
    assert(
      deps._calls.postToDiscordChannelById.length === 0,
      "T1-b: postToDiscordChannelById is NOT called for telegram origin",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 0,
      "T1-c: sendToDiscordUser is NOT called for telegram origin",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 1,
      "T1-d: telegram channel sendMessage called once",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T1-e: in_app channel sendMessage called once (alongside telegram)",
    );
  }

  // ── T2: originChannel = "Telegram" (case-insensitive) ─────────────────────
  console.log("\nT2: originChannel=Telegram (mixed-case)");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "Telegram", undefined, deps);

    assert(
      deps._calls.notifyUser.length === 0,
      "T2-a: notifyUser is NOT called for mixed-case Telegram origin",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 1,
      "T2-b: telegram channel sendMessage called once for mixed-case Telegram",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T2-c: in_app channel sendMessage called once for mixed-case Telegram",
    );
  }

  // ── T3: originChannel = "Discord #general" + discordChannelId ─────────────
  console.log('\nT3: originChannel="Discord #general" with discordChannelId');
  {
    const deps = makeDeps();
    const channelId = "123456789";
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "Discord #general", channelId, deps);

    assert(
      deps._calls.notifyUser.length === 0,
      "T3-a: notifyUser is NOT called for discord origin",
    );
    assert(
      deps._calls.postToDiscordChannelById.length === 1,
      "T3-b: postToDiscordChannelById called once",
    );
    assert(
      deps._calls.postToDiscordChannelById[0]?.channelId === channelId,
      "T3-c: postToDiscordChannelById called with the correct channelId",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 0,
      "T3-d: sendToDiscordUser NOT called when channel post succeeds",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T3-e: in_app channel sendMessage called once alongside Discord channel post",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T3-f: telegram channel sendMessage NOT called for discord origin",
    );
  }

  // ── T4: Discord origin with channelId, but channel post fails → DM fallback
  console.log("\nT4: Discord origin, channel post fails → DM fallback");
  {
    const deps = makeDeps({ postToDiscordChannelByIdResult: false });
    const channelId = "987654321";
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "Discord #ops", channelId, deps);

    assert(
      deps._calls.postToDiscordChannelById.length === 1,
      "T4-a: postToDiscordChannelById attempted once",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 1,
      "T4-b: sendToDiscordUser called as DM fallback when channel post fails",
    );
    assert(
      deps._calls.notifyUser.length === 0,
      "T4-c: notifyUser still NOT called even when Discord channel post fails",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T4-d: telegram NOT called even when Discord channel post fails",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T4-e: in_app still called even when Discord channel post fails",
    );
  }

  // ── T5: Discord origin without discordChannelId → DM only ─────────────────
  console.log("\nT5: Discord origin without discordChannelId → DM directly");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "Discord", undefined, deps);

    assert(
      deps._calls.postToDiscordChannelById.length === 0,
      "T5-a: postToDiscordChannelById NOT called when no channelId provided",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 1,
      "T5-b: sendToDiscordUser called directly when no channelId provided",
    );
    assert(
      deps._calls.notifyUser.length === 0,
      "T5-c: notifyUser NOT called for discord-without-channelId origin",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T5-d: telegram NOT called for discord-without-channelId origin",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T5-e: in_app called for discord-without-channelId origin",
    );
  }

  // ── T6: originChannel = "app" ──────────────────────────────────────────────
  console.log("\nT6: originChannel=app");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "app", undefined, deps);

    assert(
      deps._calls.notifyUser.length === 0,
      "T6-a: notifyUser is NOT called for app origin",
    );
    assert(
      deps._calls.postToDiscordChannelById.length === 0,
      "T6-b: postToDiscordChannelById is NOT called for app origin",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 0,
      "T6-c: sendToDiscordUser is NOT called for app origin",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T6-d: telegram channel NOT called for app origin",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T6-e: in_app channel sendMessage called once for app origin",
    );
  }

  // ── T7: originChannel = "coach" (treated same as "app") ───────────────────
  console.log("\nT7: originChannel=coach");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "coach", undefined, deps);

    assert(
      deps._calls.notifyUser.length === 0,
      "T7-a: notifyUser is NOT called for coach origin",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T7-b: telegram channel NOT called for coach origin",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T7-c: in_app channel sendMessage called once for coach origin",
    );
  }

  // ── T8: originChannel = undefined → notifyUser called ─────────────────────
  console.log("\nT8: originChannel=undefined → notifyUser");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, undefined, undefined, deps);

    assert(
      deps._calls.notifyUser.length === 1,
      "T8-a: notifyUser called once for undefined origin",
    );
    assert(
      deps._calls.postToDiscordChannelById.length === 0,
      "T8-b: postToDiscordChannelById NOT called for undefined origin",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 0,
      "T8-c: sendToDiscordUser NOT called for undefined origin",
    );
    // When notifyUser handles routing, the individual channel mocks should NOT
    // be called directly by notifyJobComplete (the registry handles delivery).
    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T8-d: telegram channel NOT called directly for undefined origin (notifyUser owns routing)",
    );
  }

  // ── T9: originChannel = "" (empty string) → notifyUser called ─────────────
  console.log("\nT9: originChannel=empty-string → notifyUser");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "", undefined, deps);

    assert(
      deps._calls.notifyUser.length === 1,
      "T9-a: notifyUser called for empty-string origin",
    );
    assert(
      deps._calls.postToDiscordChannelById.length === 0,
      "T9-b: postToDiscordChannelById NOT called for empty-string origin",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 0,
      "T9-c: sendToDiscordUser NOT called for empty-string origin",
    );
  }

  // ── T10: notifyUser receives correct userId and notificationType ───────────
  console.log("\nT10: notifyUser called with correct arguments");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, undefined, undefined, deps);

    assert(
      deps._calls.notifyUser[0]?.userId === USER,
      "T10-a: notifyUser receives correct userId",
    );
    assert(
      deps._calls.notifyUser[0]?.notificationType === "approval_request",
      "T10-b: notifyUser receives notificationType='approval_request'",
    );
    const expectedText = `Jarvis (${JOB_TYPE}): ${TITLE}\n\n${BODY}`;
    assert(
      deps._calls.notifyUser[0]?.text === expectedText,
      "T10-c: notifyUser receives correctly formatted text",
    );
  }

  // ── T11: Discord never leaks to Telegram even when Discord post fails ───────
  console.log("\nT11: Discord origin — Telegram never receives message regardless");
  {
    const deps = makeDeps({ postToDiscordChannelByIdResult: false, sendToDiscordUserResult: false });
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "Discord #general", "ch-111", deps);

    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T11-a: telegram channel NOT called even when ALL Discord delivery fails",
    );
    assert(
      deps._calls.notifyUser.length === 0,
      "T11-b: notifyUser NOT called even when ALL Discord delivery fails",
    );
  }

  // ── T12: Telegram never leaks to Discord ──────────────────────────────────
  console.log("\nT12: Telegram origin — Discord helpers never called");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "telegram", "ch-222", deps);

    assert(
      deps._calls.postToDiscordChannelById.length === 0,
      "T12-a: postToDiscordChannelById NOT called for telegram origin",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 0,
      "T12-b: sendToDiscordUser NOT called for telegram origin",
    );
  }

  // ── T13: originChannel = "appchat" (treated same as "app") ────────────────
  console.log("\nT13: originChannel=appchat");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "appchat", undefined, deps);

    assert(
      deps._calls.notifyUser.length === 0,
      "T13-a: notifyUser is NOT called for appchat origin",
    );
    assert(
      deps._calls.postToDiscordChannelById.length === 0,
      "T13-b: postToDiscordChannelById is NOT called for appchat origin",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 0,
      "T13-c: sendToDiscordUser is NOT called for appchat origin",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T13-d: telegram channel NOT called for appchat origin",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T13-e: in_app channel sendMessage called once for appchat origin",
    );
  }

  // ── T14: originChannel = "voice" (treated same as "app") ──────────────────
  console.log("\nT14: originChannel=voice");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "voice", undefined, deps);

    assert(
      deps._calls.notifyUser.length === 0,
      "T14-a: notifyUser is NOT called for voice origin",
    );
    assert(
      deps._calls.postToDiscordChannelById.length === 0,
      "T14-b: postToDiscordChannelById is NOT called for voice origin",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 0,
      "T14-c: sendToDiscordUser is NOT called for voice origin",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T14-d: telegram channel NOT called for voice origin",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T14-e: in_app channel sendMessage called once for voice origin",
    );
  }

  // ── T15: originChannel = "webchat" (treated same as "app") ──────────────
  console.log("\nT15: originChannel=webchat");
  {
    const deps = makeDeps();
    await _notifyJobCompleteCore(USER, JOB_TYPE, TITLE, BODY, "webchat", undefined, deps);

    assert(
      deps._calls.notifyUser.length === 0,
      "T15-a: notifyUser is NOT called for webchat origin",
    );
    assert(
      deps._calls.postToDiscordChannelById.length === 0,
      "T15-b: postToDiscordChannelById is NOT called for webchat origin",
    );
    assert(
      deps._calls.sendToDiscordUser.length === 0,
      "T15-c: sendToDiscordUser is NOT called for webchat origin",
    );
    assert(
      deps._channels.get("telegram")!.calls.length === 0,
      "T15-d: telegram channel NOT called for webchat origin",
    );
    assert(
      deps._channels.get("in_app")!.calls.length === 1,
      "T15-e: in_app channel sendMessage called once for webchat origin",
    );
  }

  // ── TGUARD: every SIMPLE_ORIGIN_CHANNELS value has an explicit test case ──
  //
  // This test enumerates the canonical origin list from @shared/schema and
  // cross-checks it against a registry of tested values maintained right here.
  //
  // HOW TO UPDATE: when you add a new value to SIMPLE_ORIGIN_CHANNELS in
  // shared/schema.ts, also:
  //   1. Add a test block (Tn) for the new origin above.
  //   2. Add the new value to `testedOrigins` below.
  //
  // Failure of TGUARD-b means a value exists in SIMPLE_ORIGIN_CHANNELS that
  // has no test case yet.  Failure of TGUARD-c means a value was removed from
  // SIMPLE_ORIGIN_CHANNELS but the registry here was not trimmed — keep both
  // in sync.
  console.log("\nTGUARD: all SIMPLE_ORIGIN_CHANNELS values are explicitly tested");
  {
    // One entry per test block above that covers a simple (non-discord) origin.
    // Keep this set in sync with SIMPLE_ORIGIN_CHANNELS in shared/schema.ts.
    const testedOrigins = new Set<string>([
      "telegram", // T1, T2
      "app",      // T6
      "coach",    // T7
      "appchat",  // T13
      "voice",    // T14
      "webchat",  // T15
    ]);

    assert(
      SIMPLE_ORIGIN_CHANNELS.length > 0,
      "TGUARD-a: SIMPLE_ORIGIN_CHANNELS is non-empty (sanity check)",
    );

    for (const origin of SIMPLE_ORIGIN_CHANNELS) {
      assert(
        testedOrigins.has(origin),
        `TGUARD-b: "${origin}" has an explicit test case in this suite`,
      );
    }

    assert(
      SIMPLE_ORIGIN_CHANNELS.length === testedOrigins.size,
      `TGUARD-c: testedOrigins registry (${testedOrigins.size} entries) matches SIMPLE_ORIGIN_CHANNELS length (${SIMPLE_ORIGIN_CHANNELS.length}) — no orphaned or missing entries`,
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("All notifyJobComplete channel-isolation assertions passed ✓");
  } else {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
