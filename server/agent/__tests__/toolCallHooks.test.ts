/**
 * toolCallHooks.test.ts — assertion suite for the ToolCallHookRegistry.
 *
 * Tests: priority ordering, terminal block/requireApproval behavior,
 * cumulative param rewriting, param preservation through approval path,
 * and fail-closed permission hook error handling.
 *
 * Run with: tsx server/agent/__tests__/toolCallHooks.test.ts
 */

import { ToolCallHookRegistry } from "../toolCallHooks";
import type { ToolCallHookContext } from "../toolCallHooks";

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function makeCtx(overrides: Partial<ToolCallHookContext> = {}): ToolCallHookContext {
  return {
    toolName: "test_tool",
    params: { x: 1 },
    agentId: "agent-test",
    agentName: "TestAgent",
    userId: "user-test",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

async function run() {
  // TH-1: Pass-through (no handlers) → allowed=true, original params
  {
    const reg = new ToolCallHookRegistry();
    const result = await reg.run(makeCtx());
    assert(result.allowed === true, "TH-1: no handlers → allowed");
    assert(
      JSON.stringify(result.params) === JSON.stringify({ x: 1 }),
      "TH-1: no handlers → original params returned",
    );
  }

  // TH-2: Single block handler → allowed=false, reason set
  {
    const reg = new ToolCallHookRegistry();
    reg.register(() => ({ block: true, blockReason: "denied by policy" }));
    const result = await reg.run(makeCtx());
    assert(result.allowed === false, "TH-2: block handler → not allowed");
    assert(result.reason === "denied by policy", "TH-2: block handler → reason correct");
  }

  // TH-3: Block with no reason → default reason message
  {
    const reg = new ToolCallHookRegistry();
    reg.register(() => ({ block: true }));
    const result = await reg.run(makeCtx());
    assert(result.allowed === false, "TH-3: block without reason → not allowed");
    assert(typeof result.reason === "string" && result.reason.length > 0, "TH-3: default reason is non-empty");
  }

  // TH-4: Single param-rewrite handler → allowed, params rewritten
  {
    const reg = new ToolCallHookRegistry();
    reg.register((ctx) => ({ params: { ...ctx.params, injected: true } }));
    const result = await reg.run(makeCtx({ params: { x: 1 } }));
    assert(result.allowed === true, "TH-4: param rewrite → allowed");
    assert((result.params as Record<string, unknown>)?.injected === true, "TH-4: injected param present");
    assert((result.params as Record<string, unknown>)?.x === 1, "TH-4: original param preserved");
  }

  // TH-5: Priority ordering — higher priority runs first
  {
    const order: number[] = [];
    const reg = new ToolCallHookRegistry();
    reg.register(() => { order.push(10); return undefined; }, { priority: 10 });
    reg.register(() => { order.push(50); return undefined; }, { priority: 50 });
    reg.register(() => { order.push(100); return undefined; }, { priority: 100 });
    await reg.run(makeCtx());
    assert(
      order[0] === 100 && order[1] === 50 && order[2] === 10,
      `TH-5: priority order = [${order}] (expected [100, 50, 10])`,
    );
  }

  // TH-6: Block is terminal — subsequent handlers do not run
  {
    const ran: string[] = [];
    const reg = new ToolCallHookRegistry();
    reg.register(() => { ran.push("high"); return { block: true }; }, { priority: 100 });
    reg.register(() => { ran.push("low"); return undefined; }, { priority: 10 });
    await reg.run(makeCtx());
    assert(ran.length === 1 && ran[0] === "high", "TH-6: block is terminal — low-priority handler not called");
  }

  // TH-7: Param rewrites accumulate across multiple handlers
  {
    const reg = new ToolCallHookRegistry();
    reg.register(() => ({ params: { step: "A" } }), { priority: 100 });
    reg.register((ctx) => ({ params: { ...ctx.params, step2: "B" } }), { priority: 50 });
    const result = await reg.run(makeCtx({ params: {} }));
    assert(result.allowed === true, "TH-7: cumulative rewrites → allowed");
    assert(
      (result.params as Record<string, unknown>)?.step === "A" &&
      (result.params as Record<string, unknown>)?.step2 === "B",
      "TH-7: both rewrites accumulated in params",
    );
  }

  // TH-8: Handler throwing an exception is swallowed; next handler runs (fail-open per-handler)
  {
    const ran: string[] = [];
    const reg = new ToolCallHookRegistry();
    reg.register(() => { throw new Error("handler crash"); }, { priority: 100 });
    reg.register(() => { ran.push("second"); return undefined; }, { priority: 50 });
    const result = await reg.run(makeCtx());
    assert(result.allowed === true, "TH-8: thrown handler → still allowed");
    assert(ran[0] === "second", "TH-8: next handler still runs after exception");
  }

  // TH-9: Undefined return is treated as pass-through
  {
    const reg = new ToolCallHookRegistry();
    reg.register(() => undefined);
    reg.register(async () => undefined);
    const result = await reg.run(makeCtx({ params: { orig: 42 } }));
    assert(result.allowed === true, "TH-9: undefined returns → allowed");
    assert((result.params as Record<string, unknown>)?.orig === 42, "TH-9: original params unchanged");
  }

  // TH-10: Block-before-approval — block handler at higher priority wins
  {
    let approvalAttempted = false;
    const reg = new ToolCallHookRegistry();
    reg.register(() => ({ block: true, blockReason: "pre-blocked" }), { priority: 100 });
    reg.register(() => {
      approvalAttempted = true;
      return { requireApproval: { title: "t", description: "d" } };
    }, { priority: 50 });
    const result = await reg.run(makeCtx());
    assert(result.allowed === false, "TH-10: block at p=100 wins over requireApproval at p=50");
    assert(!approvalAttempted, "TH-10: approval handler not called when blocked by higher priority");
  }

  // TH-11: Param rewrite before block — rewrite doesn't prevent block
  {
    const reg = new ToolCallHookRegistry();
    reg.register((ctx) => ({ params: { ...ctx.params, extra: true } }), { priority: 100 });
    reg.register(() => ({ block: true, blockReason: "blocked after rewrite" }), { priority: 50 });
    const result = await reg.run(makeCtx());
    assert(result.allowed === false, "TH-11: block still fires even after prior param rewrite");
  }

  // TH-12: critical=true handler — exception propagates (fail-closed)
  {
    const reg = new ToolCallHookRegistry();
    reg.register(() => { throw new Error("critical handler crash"); }, { critical: true });
    let threw = false;
    try {
      await reg.run(makeCtx());
    } catch (err) {
      threw = err instanceof Error && err.message === "critical handler crash";
    }
    assert(threw, "TH-12: critical handler exception propagates (fail-closed)");
  }

  // TH-13: critical=true handler throws — non-critical handler after it does not run
  {
    const ran: string[] = [];
    const reg = new ToolCallHookRegistry();
    reg.register(() => { throw new Error("critical crash"); }, { priority: 100, critical: true });
    reg.register(() => { ran.push("low"); return undefined; }, { priority: 10 });
    try { await reg.run(makeCtx()); } catch { /* expected */ }
    assert(ran.length === 0, "TH-13: handlers after a critical crash do not run");
  }

  // TH-14: HOOK_PRIORITY constants are exported and have correct relative ordering
  {
    const { HOOK_PRIORITY } = await import("../toolCallHooks");
    assert(
      HOOK_PRIORITY.PERMISSION > HOOK_PRIORITY.APPROVAL && HOOK_PRIORITY.APPROVAL > HOOK_PRIORITY.DEFAULT,
      `TH-14: PERMISSION(${HOOK_PRIORITY.PERMISSION}) > APPROVAL(${HOOK_PRIORITY.APPROVAL}) > DEFAULT(${HOOK_PRIORITY.DEFAULT})`,
    );
  }

  // TH-15: agentName and userId are optional — registry accepts context without them
  {
    const reg = new ToolCallHookRegistry();
    reg.register((ctx) => {
      // Handler can read optional fields without crashing
      const _ = ctx.agentName ?? "unknown";
      const __ = ctx.userId ?? "anon";
      return undefined;
    });
    const result = await reg.run({ toolName: "test", params: {}, agentId: "a1" });
    assert(result.allowed === true, "TH-15: registry works without agentName/userId in context");
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  else console.log("All hook registry assertions passed ✓");
}

run().catch((err) => {
  console.error("Test runner threw:", err);
  process.exit(1);
});
