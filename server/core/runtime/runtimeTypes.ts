import type { ContextPackDecision } from "../../agent/contextPacks";
import type { ContextPacket, JarvisEvent, RuntimeDecision } from "../protocol";

export type RuntimeGateOutcome =
  | "inline_answer"
  | "tool_candidate"
  | "needs_approval"
  | "queue_job"
  | "blocked"
  | "degraded";

export interface RuntimeGateResult {
  outcome: RuntimeGateOutcome;
  route: string;
  taskType: ContextPackDecision["taskType"] | "invalid_event";
  reasons: string[];
}

export interface ExecuteRuntimeEventInput {
  event: unknown;
  now?: Date;
}

export interface ExecuteRuntimeEventResult {
  event: JarvisEvent;
  contextPacket: ContextPacket;
  decision: RuntimeDecision;
  gateResult: RuntimeGateResult;
}
