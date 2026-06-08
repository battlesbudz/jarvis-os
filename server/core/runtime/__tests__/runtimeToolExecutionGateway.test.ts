import assert from "node:assert/strict";
import { parseRuntimeDecision, type ToolIntent } from "../../protocol";
import {
  executeRuntimeDecisionToolsThroughGateway,
  executeRuntimeToolThroughGateway,
} from "../index";

const now = new Date("2026-06-08T19:00:00.000Z");

function tool(overrides: Partial<ToolIntent> = {}): ToolIntent {
  return {
    toolName: "search",
    status: "proposed",
    riskTier: "T0",
    approvalRequired: false,
    reason: "Search context for a runtime answer.",
    ...overrides,
  };
}

function decision(tools: ToolIntent[]) {
  return parseRuntimeDecision({
    decisionId: "decision-tool-execution-gateway",
    eventId: "event-tool-execution-gateway",
    userId: "user-tool-execution-gateway",
    intent: "research",
    confidence: 0.84,
    riskTier: "T1",
    responseMode: "queue",
    tools,
    approval: {
      required: false,
      status: "not_required",
    },
    modelRoute: {
      provider: "runtime-gate",
      model: "deterministic-test",
      reason: "Tool execution gateway test.",
      fallbackAllowed: false,
    },
    trace: {
      traceId: "trace-tool-execution-gateway",
      source: "runtime",
      routeChosen: "research",
      taskTypeDetected: "research",
    },
    createdAt: now.toISOString(),
  });
}

async function run(): Promise<void> {
  {
  const calls: ToolIntent[] = [];
  const result = await executeRuntimeToolThroughGateway({
    intent: tool(),
    executeTool: async (intent) => {
      calls.push(intent);
      return { ok: true, toolName: intent.toolName };
    },
  });

  assert.equal(result.status, "executed");
  assert.equal(result.preflightStatus, "ready");
  assert.equal(result.executedByRuntime, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(result.result, { ok: true, toolName: "search" });
  console.log("OK: Runtime tool execution gateway executes only after ready preflight");
  }

  {
  let called = false;
  const result = await executeRuntimeToolThroughGateway({
    intent: tool({
      toolName: "send_email",
      riskTier: "T4",
      approvalRequired: true,
    }),
    availableTools: [
      {
        name: "send_email",
        provider: "gmail",
        riskTier: "T4",
        approvalRequired: true,
      },
    ],
    auth: {
      connectedProviders: ["gmail"],
    },
    executeTool: async () => {
      called = true;
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.preflightStatus, "approval_required");
  assert.equal(result.approvalRequired, true);
  assert.equal(called, false);
  console.log("OK: Runtime tool execution gateway never executes approval-required tools");
  }

  {
  let called = false;
  const result = await executeRuntimeToolThroughGateway({
    intent: tool({ toolName: "search" }),
    policy: {
      blockedTools: ["search"],
    },
    executeTool: async () => {
      called = true;
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.preflightStatus, "blocked_by_policy");
  assert.equal(called, false);
  console.log("OK: Runtime tool execution gateway respects policy blocks before execution");
  }

  {
  const calls: string[] = [];
  const result = await executeRuntimeDecisionToolsThroughGateway({
    decision: decision([
      tool({ toolName: "search" }),
      tool({
        toolName: "send_email",
        riskTier: "T4",
        approvalRequired: true,
      }),
    ]),
    availableTools: [
      {
        name: "send_email",
        provider: "gmail",
        riskTier: "T4",
        approvalRequired: true,
      },
    ],
    auth: {
      connectedProviders: ["gmail"],
    },
    executeTool: async (intent) => {
      calls.push(intent.toolName);
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.preflight.blocked.length, 1);
  assert.equal(result.executions.every((execution) => execution.status === "blocked"), true);
  assert.deepEqual(calls, []);
  console.log("OK: Runtime decision tool execution gateway is all-or-nothing when any intent is blocked");
  }

  {
  const calls: string[] = [];
  const result = await executeRuntimeDecisionToolsThroughGateway({
    decision: decision([
      tool({ toolName: "search" }),
      tool({ toolName: "draft_only" }),
    ]),
    executeTool: async (intent) => {
      calls.push(intent.toolName);
      return `executed:${intent.toolName}`;
    },
  });

  assert.equal(result.status, "executed");
  assert.equal(result.executions.length, 2);
  assert.deepEqual(calls, ["search", "draft_only"]);
  assert.deepEqual(result.executions.map((execution) => execution.result), ["executed:search", "executed:draft_only"]);
  console.log("OK: Runtime decision tool execution gateway executes all ready intents through existing owner");
  }

  console.log("\nAll Runtime Tool Execution Gateway assertions passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
