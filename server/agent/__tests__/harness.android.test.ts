/**
 * Harness Android integration test.
 *
 * Verifies that the harness correctly:
 *   HA-1: Raises effectiveMaxTurns to EXACTLY 25 when android_* tools are present.
 *   HA-2: Non-android sessions are capped at the default 6-turn budget.
 *   HA-3: Injects the sequential-execution rule into the first system message.
 *   HA-4: Fires onProgressMessage at turn 15 with the expected text.
 *   HA-5: Fires onProgressMessage at turn 20 with the expected text.
 *   HA-6: Streaming mode — inline quality check is skipped.
 *   HA-7: Non-streaming mode — inline quality check still fires.
 *   HA-8: daemon_action tool → effectiveMaxTurns raised to 25.
 *   HA-9: run_daemon_shell tool → effectiveMaxTurns raised to 25.
 *
 * Run with: tsx server/agent/__tests__/harness.android.test.ts
 *
 * No live database or provider is required — provider.query is stubbed via
 * _overrideProviderForTesting / _clearProviderCacheForTesting before each test.
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

// ── Mock provider factory ────────────────────────────────────────────────────
// Returns a BaseProvider instance plus a shared state object so individual
// tests can inspect call counts and captured messages without any type casts.

interface MockState {
  callCount: number;
  capturedMessages: ProviderQueryParams["messages"][];
}

function makeMockProvider(
  /**
   * Number of tool-call turns to emit before switching to a text reply.
   * On the forced-final call (toolChoice === "none") the provider always
   * returns text regardless of toolTurns.
   */
  toolTurns: number,
  /**
   * Name of the tool to return in each tool-call turn.
   * Defaults to "android_tap" so it is recognised by the android_* heuristic.
   */
  toolName = "android_tap",
): { provider: BaseProvider; state: MockState } {
  const state: MockState = { callCount: 0, capturedMessages: [] };

  class MockProviderImpl extends BaseProvider {
    async initialize(): Promise<void> {}
    async cleanup(): Promise<void> {}

    async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
      state.capturedMessages.push(params.messages);
      const turn = state.callCount++;

      if (params.toolChoice === "none" || turn >= toolTurns) {
        yield { type: "text", delta: "Task complete." };
        yield { type: "finish", reason: "stop" };
      } else {
        yield {
          type: "tool_call_start",
          index: 0,
          id: `call_${turn}`,
          name: toolName,
        };
        yield { type: "tool_call_args", index: 0, args: '{"x":100,"y":200}' };
        yield { type: "finish", reason: "tool_calls" };
      }
    }
  }

  return { provider: new MockProviderImpl(), state };
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
  name: "generic_search",
  description: "Search the web.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async () => ({ ok: true, content: "Search result." }),
};

const daemonActionTool: AgentTool = {
  name: "daemon_action",
  description: "Perform a daemon action on the device.",
  parameters: {
    type: "object",
    properties: { action: { type: "string" } },
    required: ["action"],
  },
  execute: async () => ({ ok: true, content: "Daemon action executed." }),
};

const runDaemonShellTool: AgentTool = {
  name: "run_daemon_shell",
  description: "Run a shell command via the daemon.",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  execute: async () => ({ ok: true, content: "Shell command executed." }),
};

// ── Minimal context (no DB required) ────────────────────────────────────────
// userId is empty so the harness skips all DB-backed injections (skills,
// integration health checks) — all of which are guarded by `if (context.userId)`.

const minimalContext: ToolContext = {
  userId: "" as string, // falsy → skips DB/integration lookups
  state: {},
  channel: "test",
};

// ── Test suite ───────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const { runAgent } = await import("../harness");

  // ── HA-1: Android tools raise effectiveMaxTurns to EXACTLY 25 ───────────
  // Strategy: supply 25 consecutive tool-call turns (indices 0–24).
  //   • If effectiveMaxTurns = 25: the loop runs turns 0–24 (25 iterations),
  //     all return tool calls, the loop exhausts without breaking, and the
  //     harness makes one more forced-final call with toolChoice:"none".
  //     Total provider calls = 26.
  //   • If effectiveMaxTurns were 24: forced-final at call 25 (not 26).
  //   • If effectiveMaxTurns were 26: forced-final at call 27 (not 26).
  // Asserting callCount === 26 pins the budget to exactly 25 turns.
  {
    const { provider, state } = makeMockProvider(25);
    _overrideProviderForTesting("openai", provider);

    await runAgent({
      model: "gpt-4o",
      messages: [{ role: "system", content: "You are a helpful assistant." }],
      tools: [androidTapTool],
      context: { ...minimalContext },
      maxTurns: 6, // would cap at 6 without the android-tools override
    });

    assert(
      state.callCount === 26,
      `HA-1: android session made exactly 26 provider calls (25 tool turns + 1 forced-final), proving effectiveMaxTurns === 25 (got ${state.callCount})`,
    );

    _clearProviderCacheForTesting();
  }

  // ── HA-2: Non-android tools use the default 6-turn budget ───────────────
  // Without android_* tools the budget stays at maxTurns=6. The mock returns
  // tool calls for 25 turns, but the loop stops after 6 and the harness
  // issues one forced-final call (toolChoice:"none"). Total calls: 7.
  {
    const { provider, state } = makeMockProvider(25, "generic_search");
    _overrideProviderForTesting("openai", provider);

    await runAgent({
      model: "gpt-4o",
      messages: [{ role: "system", content: "You are a helpful assistant." }],
      tools: [genericSearchTool],
      context: { ...minimalContext },
      maxTurns: 6,
    });

    assert(
      state.callCount === 7,
      `HA-2: non-android session made exactly 7 provider calls (6 turns + 1 forced-final), proving effectiveMaxTurns === 6 (got ${state.callCount})`,
    );

    _clearProviderCacheForTesting();
  }

  // ── HA-3: Sequential-execution rule injected into system message ─────────
  // When android_* tools are present the harness appends the Android Task
  // Execution Rule block to the first system message before the first provider
  // call. We capture that message and check for key strings.
  {
    let capturedSystemContent: string | null = null;

    class CapturingMockProvider extends BaseProvider {
      async initialize(): Promise<void> {}
      async cleanup(): Promise<void> {}

      async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
        if (capturedSystemContent === null) {
          const sysMsg = params.messages.find((m) => m.role === "system");
          if (sysMsg && typeof sysMsg.content === "string") {
            capturedSystemContent = sysMsg.content;
          }
        }
        yield { type: "text", delta: "Done." };
        yield { type: "finish", reason: "stop" };
      }
    }

    _overrideProviderForTesting("openai", new CapturingMockProvider());

    await runAgent({
      model: "gpt-4o",
      messages: [{ role: "system", content: "Base prompt." }],
      tools: [androidTapTool],
      context: { ...minimalContext },
    });

    assert(
      capturedSystemContent?.includes("Android Task Execution Rule") ?? false,
      "HA-3: first system message contains 'Android Task Execution Rule' heading",
    );
    assert(
      !(capturedSystemContent?.includes("Immediately call the appropriate tool") ?? false),
      "HA-3: conflicting phrase 'Immediately call the appropriate tool' is NOT present",
    );
    assert(
      capturedSystemContent?.includes("Chain tool calls directly") ?? false,
      "HA-3: new sequential-execution rule body present ('Chain tool calls directly')",
    );
    assert(
      capturedSystemContent?.includes("android_read_screen after every navigation") ?? false,
      "HA-3: screen-reading carve-out present ('android_read_screen after every navigation')",
    );
    assert(
      capturedSystemContent?.includes("When the user provides a direct URL to a specific video or page") ?? false,
      "HA-3: direct-URL instruction present ('When the user provides a direct URL to a specific video or page')",
    );
    assert(
      capturedSystemContent?.includes("do not open the app manually and search for it") ?? false,
      "HA-3: direct-URL instruction forbids manual search ('do not open the app manually and search for it')",
    );

    _clearProviderCacheForTesting();
  }

  // ── HA-4 & HA-5: Heartbeat fires at turns 15 and 20 ────────────────────
  // The harness fires onProgressMessage when:
  //   hasAndroidTools && turn >= 15 && (turn - 15) % 5 === 0
  // Turn 15 → "Still working — on step 16 of the plan"
  // Turn 20 → "Still working — on step 21 of the plan"
  // We run 22 tool-call turns so the agent crosses both thresholds before
  // finishing on turn 22.
  {
    const progressMessages: string[] = [];
    const { provider, state } = makeMockProvider(22);
    _overrideProviderForTesting("openai", provider);

    await runAgent({
      model: "gpt-4o",
      messages: [{ role: "system", content: "You are an android agent." }],
      tools: [androidTapTool],
      context: { ...minimalContext },
      maxTurns: 6, // overridden to 25 by android detection
      onProgressMessage: (msg) => progressMessages.push(msg),
    });

    assert(
      progressMessages.includes("Still working — on step 16 of the plan"),
      "HA-4: onProgressMessage fired at turn 15 — 'Still working — on step 16 of the plan'",
    );
    assert(
      progressMessages.includes("Still working — on step 21 of the plan"),
      "HA-5: onProgressMessage fired at turn 20 — 'Still working — on step 21 of the plan'",
    );

    // Sanity-check: agent ran past turn 20 so both heartbeat thresholds were reachable.
    assert(
      state.callCount >= 23,
      `HA-4/5 sanity: agent ran ≥23 provider calls so both heartbeat thresholds were crossed (got ${state.callCount})`,
    );

    _clearProviderCacheForTesting();
  }

  // ── HA-6: Streaming mode — post-stream quality check fires for announce phrases ──
  // When onToken is provided the harness runs a post-stream quality check AFTER
  // the streamed chunks are delivered (introduced in task #1049). If the text
  // reply contains an announce phrase, checkResponseQuality returns action:"revise"
  // and the harness pushes a corrective turn without re-streaming it to the caller.
  //
  // The harness allows at most 2 inline revisions (inlineRevisionCount guard < 2).
  // With a provider that always returns the same announce-phrase reply the sequence is:
  //   turn 0 → announce reply streamed → post-stream check → revise (count: 0→1)
  //   turn 1 → announce reply (not re-streamed) → post-stream check → revise (count: 1→2)
  //   turn 2 → announce reply (not re-streamed) → guard fails (2 < 2 = false) → finalize
  // Total provider calls: 3.
  // We also verify that onToken received the chunks from the initial streamed turn, and
  // crucially that it received ONLY those chunks — the corrective revision turns must
  // NOT be re-streamed (HA-6c). If suppressNextStream logic regresses, receivedTokens
  // would contain 3 entries instead of 1, catching the bug immediately.
  {
    let callCount = 0;
    const announceReply = "I found the results. I will now tap on the first video.";

    class StreamingAnnounceMockProvider extends BaseProvider {
      async initialize(): Promise<void> {}
      async cleanup(): Promise<void> {}

      async *query(_params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
        callCount++;
        yield { type: "text", delta: announceReply };
        yield { type: "finish", reason: "stop" };
      }
    }

    _overrideProviderForTesting("openai", new StreamingAnnounceMockProvider());

    const receivedTokens: string[] = [];

    await runAgent({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an android agent." },
        { role: "user", content: "Open YouTube and tap the first trending video." },
      ],
      tools: [androidTapTool],
      context: { ...minimalContext },
      onToken: (chunk) => receivedTokens.push(chunk),
    });

    assert(
      callCount === 3,
      `HA-6: streaming mode with announce phrase — provider called 3 times (initial stream + 2 post-stream revisions) (got ${callCount})`,
    );
    assert(
      receivedTokens.includes(announceReply),
      "HA-6: streaming mode — onToken received the streamed chunk from the initial turn",
    );
    assert(
      receivedTokens.length === 1,
      `HA-6c: corrective revision turns were suppressed — onToken received exactly 1 chunk, not ${receivedTokens.length} (suppressNextStream regression guard)`,
    );

    _clearProviderCacheForTesting();
  }

  // ── HA-6b: Streaming mode — post-stream quality check is a no-op for clean replies ──
  // A streaming Android session whose reply contains no announce phrase and has
  // substantive content (> 80 words) should pass checkResponseQuality on the first
  // attempt with action:"finalize". The provider must be called exactly once —
  // confirming the post-stream check adds zero overhead for well-formed replies.
  {
    let callCount = 0;
    // >= 80 words, no announce phrase, no deflection language.
    // Must be >= 80 words to clear Check 1b (deflection detector fires when
    // askedForAction=true, toolsUsed=0, AND replyWords<80). The user message
    // contains action verbs ("open", "tap") and the test makes no tool calls,
    // so only the word-count guard prevents a false deflection signal.
    const cleanReply =
      "The YouTube app is now open and showing the trending videos section on the home screen. " +
      "The first trending video in the list has been tapped and playback has started successfully. " +
      "The video title is displayed prominently at the top of the player along with the channel name, " +
      "subscriber count, and total view count below it. The standard playback controls including " +
      "play, pause, seek bar, and fullscreen toggle are all visible and responsive at the bottom of " +
      "the screen. The task has been completed successfully and the video is now playing.";

    class StreamingCleanMockProvider extends BaseProvider {
      async initialize(): Promise<void> {}
      async cleanup(): Promise<void> {}

      async *query(_params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
        callCount++;
        yield { type: "text", delta: cleanReply };
        yield { type: "finish", reason: "stop" };
      }
    }

    _overrideProviderForTesting("openai", new StreamingCleanMockProvider());

    const receivedTokens: string[] = [];

    await runAgent({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an android agent." },
        { role: "user", content: "Open YouTube and tap the first trending video." },
      ],
      tools: [androidTapTool],
      context: { ...minimalContext },
      onToken: (chunk) => receivedTokens.push(chunk),
    });

    assert(
      callCount === 1,
      `HA-6b: streaming mode with clean reply — provider called exactly once (post-stream check is a no-op) (got ${callCount})`,
    );
    assert(
      receivedTokens.includes(cleanReply),
      "HA-6b: streaming mode with clean reply — onToken received the clean streamed chunk",
    );

    _clearProviderCacheForTesting();
  }

  // ── HA-7: Non-streaming mode — inline quality check still fires ──────────
  // Regression test: without onToken the quality check should still run in
  // Android sessions. When a text reply (after at least one tool call) contains
  // an announce phrase the harness loops and calls the provider again.
  //
  // Provider sequence:
  //   turn 0 → tool call (android_tap)   — toolsUsed becomes ["android_tap"]
  //   turn 1 → announce text reply        — quality check fires (pass 1, revise)
  //   turn 2 → clean text reply           — quality check passes (finalize)
  // Total provider calls: 3.
  {
    let callCount = 0;
    const announceReply = "I found the results. I will now tap on the first video.";
    // After toolsUsed=["android_tap"] the deflection check (1b) is suppressed;
    // this reply has no announce phrase so it passes the quality check.
    const cleanReply = "The trending video is now playing.";

    class NonStreamingAnnounceMockProvider extends BaseProvider {
      async initialize(): Promise<void> {}
      async cleanup(): Promise<void> {}

      async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
        const turn = callCount++;

        if (turn === 0 && params.toolChoice !== "none") {
          // First turn: emit a tool call so android_tap is recorded in toolsUsed.
          yield { type: "tool_call_start", index: 0, id: `call_${turn}`, name: "android_tap" };
          yield { type: "tool_call_args", index: 0, args: '{"x":100,"y":200}' };
          yield { type: "finish", reason: "tool_calls" };
        } else if (turn === 1) {
          // Second turn: text reply with announce phrase — triggers quality revision.
          yield { type: "text", delta: announceReply };
          yield { type: "finish", reason: "stop" };
        } else {
          // Third turn: clean reply — passes quality check.
          yield { type: "text", delta: cleanReply };
          yield { type: "finish", reason: "stop" };
        }
      }
    }

    _overrideProviderForTesting("openai", new NonStreamingAnnounceMockProvider());

    const result = await runAgent({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an android agent." },
        { role: "user", content: "Open YouTube and tap the first trending video." },
      ],
      tools: [androidTapTool],
      context: { ...minimalContext },
      // No onToken — non-streaming session
    });

    assert(
      callCount === 3,
      `HA-7: non-streaming mode — provider called 3 times (1 tool turn + 1 announce + 1 clean after revision) (got ${callCount})`,
    );
    assert(
      result.reply === cleanReply,
      "HA-7: non-streaming mode — harness returns the clean revised reply",
    );

    _clearProviderCacheForTesting();
  }

  // ── HA-8: daemon_action tool raises effectiveMaxTurns to EXACTLY 25 ─────
  // Same strategy as HA-1: supply 25 consecutive tool-call turns. If the
  // budget is 25 the forced-final call is #26 (callCount === 26).
  {
    const { provider, state } = makeMockProvider(25, "daemon_action");
    _overrideProviderForTesting("openai", provider);

    await runAgent({
      model: "gpt-4o",
      messages: [{ role: "system", content: "You are a helpful assistant." }],
      tools: [daemonActionTool],
      context: { ...minimalContext },
      maxTurns: 6,
    });

    assert(
      state.callCount === 26,
      `HA-8: daemon_action session made exactly 26 provider calls (25 tool turns + 1 forced-final), proving effectiveMaxTurns === 25 (got ${state.callCount})`,
    );

    _clearProviderCacheForTesting();
  }

  // ── HA-9: run_daemon_shell tool raises effectiveMaxTurns to EXACTLY 25 ──
  // Same strategy as HA-1: supply 25 consecutive tool-call turns. If the
  // budget is 25 the forced-final call is #26 (callCount === 26).
  {
    const { provider, state } = makeMockProvider(25, "run_daemon_shell");
    _overrideProviderForTesting("openai", provider);

    await runAgent({
      model: "gpt-4o",
      messages: [{ role: "system", content: "You are a helpful assistant." }],
      tools: [runDaemonShellTool],
      context: { ...minimalContext },
      maxTurns: 6,
    });

    assert(
      state.callCount === 26,
      `HA-9: run_daemon_shell session made exactly 26 provider calls (25 tool turns + 1 forced-final), proving effectiveMaxTurns === 25 (got ${state.callCount})`,
    );

    _clearProviderCacheForTesting();
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All harness Android assertions passed ✓");
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
