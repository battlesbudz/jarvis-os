/**
 * harnessAndroidRevision.test.ts — integration tests for the inline Android
 * quality-check revision logic added to runAgent (harness.ts ~line 1215).
 *
 * Calls runAgent directly with a stubbed provider so the real harness turn loop
 * is exercised — no simulation layer.
 *
 * Run with: tsx server/agent/__tests__/harnessAndroidRevision.test.ts
 */

import {
  BaseProvider,
  _overrideProviderForTesting,
  _clearProviderCacheForTesting,
} from "../providers";
import type { ProviderQueryParams, ProviderChunk } from "../providers/base";
import type { AgentTool, ToolContext } from "../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Shared mock tools ────────────────────────────────────────────────────────

const androidTapTool: AgentTool = {
  name: "android_tap",
  description: "Tap at the given coordinates on the Android screen.",
  parameters: {
    type: "object",
    properties: {
      x: { type: "number" },
      y: { type: "number" },
    },
    required: ["x", "y"],
  },
  execute: async () => ({ ok: true, content: "Tapped successfully." }),
};

const genericSearchTool: AgentTool = {
  name: "web_search",
  description: "Search the web for information.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async () => ({ ok: true, content: "Search result." }),
};

// ── Minimal context (no DB required) ────────────────────────────────────────
// userId is empty so the harness skips all DB-backed injections (skills,
// integration health checks) — all of which are guarded by `if (context.userId)`.

const ctx: ToolContext = {
  userId: "" as string,
  state: {},
  channel: "test",
};

// A substantive post-action reply (> 80 words) that passes the deflection check
// (check 1b requires replyWords >= 80 when userMessage has action verbs and
// no tools were used). This simulates a realistic final status report from an
// Android agent after completing a multi-step task.
const CLEAN_FINAL_REPLY =
  "The trending tab on YouTube is now open and displaying a curated selection " +
  "of popular videos from across the platform. The page shows the most viewed " +
  "content from the past 24 hours, including music videos, gaming highlights, " +
  "entertainment clips, and trending news stories. Each video tile displays " +
  "the view count, channel name, and upload time. You can scroll vertically to " +
  "browse additional entries, or tap any thumbnail to start playback. The task " +
  "is complete and the screen is ready for your next instruction.";

const androidMessages = [
  { role: "system" as const, content: "You are an Android automation agent." },
  { role: "user" as const, content: "Open YouTube and tap the trending tab." },
];

// ── Test suite ───────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const { runAgent } = await import("../harness");

  // ── AR-1: Announce phrase triggers revision; corrective turn injected ─────
  // Provider turn 1: text reply containing an ANNOUNCE_PHRASE ("I will now …").
  //   checkResponseQuality returns "revise"; harness increments inlineRevisionCount,
  //   pushes the premature assistant reply and a [QUALITY REMINDER] user turn
  //   into conversationMessages, then loops (continue).
  // Provider turn 2: substantive reply (> 80 words, no ANNOUNCE_PHRASE).
  //   checkResponseQuality returns "finalize"; harness returns this reply.
  {
    let callCount = 0;

    class TwoTurnProvider extends BaseProvider {
      async initialize(): Promise<void> {}
      async cleanup(): Promise<void> {}

      async *query(_: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
        const turn = callCount++;
        if (turn === 0) {
          // Announce phrase — quality check 1a fires.
          yield {
            type: "text",
            delta:
              "I searched for the trending tab on YouTube. I will now tap on it to open it.",
          };
        } else {
          // Post-revision substantive reply — no announce phrase, > 80 words.
          yield { type: "text", delta: CLEAN_FINAL_REPLY };
        }
        yield { type: "finish", reason: "stop" };
      }
    }

    _overrideProviderForTesting("openai", new TwoTurnProvider());

    const result = await runAgent({
      model: "gpt-4o",
      messages: androidMessages,
      tools: [androidTapTool],
      context: { ...ctx },
      maxTurns: 6,
    });

    _clearProviderCacheForTesting();

    assert(callCount === 2, "AR-1: provider called twice — one revision fired");
    assert(
      result.reply === CLEAN_FINAL_REPLY,
      "AR-1: final reply is the post-revision (clean) turn",
    );

    const reminderTurns = result.messages.filter(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.startsWith("[QUALITY REMINDER]"),
    );
    assert(
      reminderTurns.length === 1,
      "AR-1: exactly one [QUALITY REMINDER] user turn injected into conversationMessages",
    );

    const prematureAssistantTurns = result.messages.filter(
      (m) =>
        m.role === "assistant" &&
        typeof m.content === "string" &&
        (m.content as string).includes("I will now"),
    );
    assert(
      prematureAssistantTurns.length === 1,
      "AR-1: premature announce reply stored as assistant turn before [QUALITY REMINDER]",
    );
  }

  // ── AR-2: Substantive clean reply — quality check passes, no revision ────
  // Provider returns a text reply with no ANNOUNCE_PHRASE and > 80 words.
  // checkResponseQuality returns "finalize"; the harness returns immediately
  // without injecting any [QUALITY REMINDER] turn.
  {
    let callCount = 0;

    class CleanReplyProvider extends BaseProvider {
      async initialize(): Promise<void> {}
      async cleanup(): Promise<void> {}

      async *query(_: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
        callCount++;
        yield { type: "text", delta: CLEAN_FINAL_REPLY };
        yield { type: "finish", reason: "stop" };
      }
    }

    _overrideProviderForTesting("openai", new CleanReplyProvider());

    const result = await runAgent({
      model: "gpt-4o",
      messages: androidMessages,
      tools: [androidTapTool],
      context: { ...ctx },
      maxTurns: 6,
    });

    _clearProviderCacheForTesting();

    assert(callCount === 1, "AR-2: provider called once — no revision");
    const reminderTurns = result.messages.filter(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.startsWith("[QUALITY REMINDER]"),
    );
    assert(reminderTurns.length === 0, "AR-2: no [QUALITY REMINDER] turn injected");
  }

  // ── AR-3: Guard caps inline revisions at 2 ───────────────────────────────
  // Provider always returns an announce phrase reply. The guard
  // (inlineRevisionCount < 2) prevents a third revision — after two revisions
  // the third announce reply is returned as-is without further looping.
  {
    let callCount = 0;
    const announceReply =
      "I found the content on YouTube. I will now tap on the first trending video.";

    class AlwaysAnnounceProvider extends BaseProvider {
      async initialize(): Promise<void> {}
      async cleanup(): Promise<void> {}

      async *query(_: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
        callCount++;
        yield { type: "text", delta: announceReply };
        yield { type: "finish", reason: "stop" };
      }
    }

    _overrideProviderForTesting("openai", new AlwaysAnnounceProvider());

    const result = await runAgent({
      model: "gpt-4o",
      messages: androidMessages,
      tools: [androidTapTool],
      context: { ...ctx },
      maxTurns: 6,
    });

    _clearProviderCacheForTesting();

    assert(
      callCount === 3,
      `AR-3: provider called 3 times — 2 revisions then guard exhausted (got ${callCount})`,
    );
    assert(
      result.reply === announceReply,
      "AR-3: third announce reply returned as-is after guard is exhausted",
    );

    const reminderTurns = result.messages.filter(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.startsWith("[QUALITY REMINDER]"),
    );
    assert(
      reminderTurns.length === 2,
      "AR-3: exactly 2 [QUALITY REMINDER] turns — guard capped revisions at 2",
    );
  }

  // ── AR-4: hasAndroidTools=false → inline check skipped entirely ──────────
  // No android_* tool in the tool list, so hasAndroidTools is false and the
  // harness `if (hasAndroidTools && …)` block is never entered. An announce
  // phrase in the reply is not flagged; no [QUALITY REMINDER] is injected.
  {
    let callCount = 0;

    class AnnounceNonAndroidProvider extends BaseProvider {
      async initialize(): Promise<void> {}
      async cleanup(): Promise<void> {}

      async *query(_: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
        callCount++;
        // Announce phrase that would trigger revision in an Android session.
        // Substantive enough (> 80 words) to pass the deflection check so
        // this test isolates the hasAndroidTools guard specifically.
        yield {
          type: "text",
          delta:
            "I will now search for the latest AI news. Proceeding now with the query. " +
            "There are many recent developments in artificial intelligence worth noting, " +
            "including advances in large language models, multimodal systems, and autonomous " +
            "agents. Research from major labs such as Google DeepMind, OpenAI, Anthropic, " +
            "and Meta continues to push the boundaries of what models can do in domains " +
            "ranging from scientific reasoning to creative work and real-world task execution.",
        };
        yield { type: "finish", reason: "stop" };
      }
    }

    _overrideProviderForTesting("openai", new AnnounceNonAndroidProvider());

    const result = await runAgent({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a general assistant." },
        { role: "user", content: "Find the latest AI news." },
      ],
      tools: [genericSearchTool],
      context: { ...ctx },
      maxTurns: 6,
    });

    _clearProviderCacheForTesting();

    assert(
      callCount === 1,
      "AR-4: non-android session — provider called once, inline check skipped",
    );
    const reminderTurns = result.messages.filter(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.startsWith("[QUALITY REMINDER]"),
    );
    assert(
      reminderTurns.length === 0,
      "AR-4: no [QUALITY REMINDER] injected — hasAndroidTools guard prevents the check",
    );
  }

  // ── AR-5: Revision → tool call on retry → clean text finalizes ──────────
  // This is the primary requested scenario: announce text on call 1, tool-call
  // reply on call 2 (harness executes the tool and loops without a quality
  // check — tool-call turns skip the inline check), clean text on call 3.
  // Verifies the revision loop interoperates correctly with tool execution.
  {
    let callCount = 0;

    class AnnounceToolCleanProvider extends BaseProvider {
      async initialize(): Promise<void> {}
      async cleanup(): Promise<void> {}

      async *query(_: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
        const turn = callCount++;
        if (turn === 0) {
          // Turn 1: announce phrase → quality check revises.
          yield {
            type: "text",
            delta:
              "I found the trending tab. I will now tap on it to open it.",
          };
          yield { type: "finish", reason: "stop" };
        } else if (turn === 1) {
          // Turn 2 (post-[QUALITY REMINDER]): model calls the tool instead.
          yield { type: "tool_call_start", index: 0, id: "call_tap_1", name: "android_tap" };
          yield { type: "tool_call_args", index: 0, args: '{"x":540,"y":300}' };
          yield { type: "finish", reason: "tool_calls" };
        } else {
          // Turn 3 (after tool result): substantive clean text summary.
          yield { type: "text", delta: CLEAN_FINAL_REPLY };
          yield { type: "finish", reason: "stop" };
        }
      }
    }

    _overrideProviderForTesting("openai", new AnnounceToolCleanProvider());

    const result = await runAgent({
      model: "gpt-4o",
      messages: androidMessages,
      tools: [androidTapTool],
      context: { ...ctx },
      maxTurns: 6,
    });

    _clearProviderCacheForTesting();

    assert(
      callCount === 3,
      `AR-5: 3 provider calls — revise on turn 1, tool call on turn 2, finalize on turn 3 (got ${callCount})`,
    );
    assert(
      result.reply === CLEAN_FINAL_REPLY,
      "AR-5: final reply is the clean text from turn 3",
    );

    const reminderTurns = result.messages.filter(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.startsWith("[QUALITY REMINDER]"),
    );
    assert(
      reminderTurns.length === 1,
      "AR-5: exactly one [QUALITY REMINDER] from turn-1 revision (tool-call turns skip the quality check)",
    );

    const toolTurns = result.toolCalls.filter((tc) => tc.name === "android_tap");
    assert(
      toolTurns.length === 1,
      "AR-5: android_tap executed once on the post-revision turn",
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All harness Android revision assertions passed ✓");
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
