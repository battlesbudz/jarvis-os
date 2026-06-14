import type { AgentTool } from "../../agent/types";
import { preflightToolGateway, toolDescriptorsFromAgentTools } from "../tools";
import type {
  AgentToolDescriptorOptions,
  ToolGatewayAuthSnapshot,
  ToolGatewayPolicy,
  ToolGatewayPreflightResult,
  ToolGatewayToolDescriptor,
} from "../tools";
import { executeRuntimeEvent } from "./executeRuntimeEvent";
import type { ExecuteRuntimeEventInput, ExecuteRuntimeEventResult } from "./runtimeTypes";

export interface RuntimeToolPreflightInput extends ExecuteRuntimeEventInput {
  availableTools?: ToolGatewayToolDescriptor[];
  auth?: ToolGatewayAuthSnapshot;
  policy?: ToolGatewayPolicy;
}

export interface RuntimeToolPreflightResult extends ExecuteRuntimeEventResult {
  toolPreflight: ToolGatewayPreflightResult;
}

export interface RuntimeAgentToolPreflightInput extends Omit<RuntimeToolPreflightInput, "availableTools"> {
  agentTools: Array<Pick<AgentTool, "name">>;
  descriptorOverrides?: Record<string, AgentToolDescriptorOptions>;
}

export function previewRuntimeToolPreflight(input: RuntimeToolPreflightInput): RuntimeToolPreflightResult {
  const runtime = executeRuntimeEvent(input);
  const toolPreflight = preflightToolGateway({
    intents: runtime.decision.tools,
    availableTools: input.availableTools ?? [],
    auth: input.auth,
    policy: input.policy,
  });

  return {
    ...runtime,
    toolPreflight,
  };
}

export function previewRuntimePreflightFromAgentTools(input: RuntimeAgentToolPreflightInput): RuntimeToolPreflightResult {
  return previewRuntimeToolPreflight({
    ...input,
    availableTools: toolDescriptorsFromAgentTools(input.agentTools, input.descriptorOverrides),
  });
}
