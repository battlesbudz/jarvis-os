import type { RuntimeDecision, ToolIntent } from "../protocol";
import { preflightToolGateway, preflightToolIntent } from "../tools";
import type {
  ToolGatewayAuthSnapshot,
  ToolGatewayPolicy,
  ToolGatewayToolDescriptor,
  ToolPreflightResult,
} from "../tools";

export type RuntimeToolExecutionStatus = "executed" | "blocked";

export interface RuntimeToolExecutionRecord {
  toolName: string;
  status: RuntimeToolExecutionStatus;
  preflightStatus: ToolPreflightResult["status"];
  approvalRequired: boolean;
  reason: string;
  executedByRuntime: false;
  executedBy: "existing_tool_owner";
  result?: unknown;
}

export type RuntimeToolExecutor = (intent: ToolIntent) => Promise<unknown> | unknown;

export interface RuntimeToolExecutionGatewayInput {
  intent: ToolIntent;
  availableTools?: ToolGatewayToolDescriptor[];
  auth?: ToolGatewayAuthSnapshot;
  policy?: ToolGatewayPolicy;
  executeTool: RuntimeToolExecutor;
}

export interface RuntimeDecisionToolExecutionGatewayInput {
  decision: RuntimeDecision;
  availableTools?: ToolGatewayToolDescriptor[];
  auth?: ToolGatewayAuthSnapshot;
  policy?: ToolGatewayPolicy;
  executeTool: RuntimeToolExecutor;
}

export interface RuntimeDecisionToolExecutionGatewayResult {
  decisionId: string;
  eventId: string;
  status: RuntimeToolExecutionStatus;
  reason: string;
  preflight: ReturnType<typeof preflightToolGateway>;
  executions: RuntimeToolExecutionRecord[];
}

function blockedRecord(preflight: ToolPreflightResult): RuntimeToolExecutionRecord {
  return {
    toolName: preflight.intent.toolName,
    status: "blocked",
    preflightStatus: preflight.status,
    approvalRequired: preflight.intent.approvalRequired || preflight.status === "approval_required",
    reason: preflight.reason,
    executedByRuntime: false,
    executedBy: "existing_tool_owner",
  };
}

export async function executeRuntimeToolThroughGateway(
  input: RuntimeToolExecutionGatewayInput,
): Promise<RuntimeToolExecutionRecord> {
  const preflight = preflightToolIntent({
    intent: input.intent,
    availableTools: input.availableTools ?? [],
    auth: input.auth,
    policy: input.policy,
  });

  if (preflight.status !== "ready") {
    return blockedRecord(preflight);
  }

  const result = await input.executeTool(preflight.intent);
  return {
    toolName: preflight.intent.toolName,
    status: "executed",
    preflightStatus: preflight.status,
    approvalRequired: false,
    reason: preflight.reason,
    executedByRuntime: false,
    executedBy: "existing_tool_owner",
    result,
  };
}

export async function executeRuntimeDecisionToolsThroughGateway(
  input: RuntimeDecisionToolExecutionGatewayInput,
): Promise<RuntimeDecisionToolExecutionGatewayResult> {
  const preflight = preflightToolGateway({
    intents: input.decision.tools,
    availableTools: input.availableTools ?? [],
    auth: input.auth,
    policy: input.policy,
  });

  if (preflight.blocked.length > 0) {
    return {
      decisionId: input.decision.decisionId,
      eventId: input.decision.eventId,
      status: "blocked",
      reason: "Runtime tool execution blocked because one or more tool intents failed preflight.",
      preflight,
      executions: preflight.tools.map(blockedRecord),
    };
  }

  const executions: RuntimeToolExecutionRecord[] = [];
  for (const tool of preflight.ready) {
    const result = await input.executeTool(tool.intent);
    executions.push({
      toolName: tool.intent.toolName,
      status: "executed",
      preflightStatus: tool.status,
      approvalRequired: false,
      reason: tool.reason,
      executedByRuntime: false,
      executedBy: "existing_tool_owner",
      result,
    });
  }

  return {
    decisionId: input.decision.decisionId,
    eventId: input.decision.eventId,
    status: "executed",
    reason: "All runtime tool intents passed preflight and were handed to the existing tool owner.",
    preflight,
    executions,
  };
}
