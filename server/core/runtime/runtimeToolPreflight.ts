import { preflightToolGateway } from "../tools";
import type {
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
