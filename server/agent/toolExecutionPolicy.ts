import type { ToolAwareRoutePlan } from "./toolAwareRouting";

export type ToolChoicePolicy = "auto" | "required" | "none";

export interface ToolExecutionPolicy<TTool> {
  tools: TTool[];
  toolChoice: ToolChoicePolicy;
  maxTurns: number;
  requiredToolNames: string[];
}

export interface BuildToolExecutionPolicyOptions<TTool> {
  route: ToolAwareRoutePlan;
  tools: TTool[];
  maxTurns: number;
  getToolName: (tool: TTool) => string;
  forceRequired?: boolean;
}

/**
 * Converts router output into an enforceable runtime policy.
 *
 * If the router says tools are needed and named tools are available, the
 * runtime must narrow the visible tools and require a first-turn tool call.
 * Optional/conversational turns stay on auto.
 */
export function buildToolExecutionPolicy<TTool>({
  route,
  tools,
  maxTurns,
  getToolName,
  forceRequired = false,
}: BuildToolExecutionPolicyOptions<TTool>): ToolExecutionPolicy<TTool> {
  const requiredToolNames = new Set(route.priorityToolNames);
  const shouldRequireTool = forceRequired || (route.shouldPreferTool && requiredToolNames.size > 0);

  if (!shouldRequireTool) {
    return {
      tools,
      toolChoice: "auto",
      maxTurns,
      requiredToolNames: [],
    };
  }

  const narrowedTools = tools.filter((tool) => requiredToolNames.has(getToolName(tool)));
  const effectiveTools = narrowedTools.length > 0 ? narrowedTools : tools;

  return {
    tools: effectiveTools,
    toolChoice: effectiveTools.length > 0 ? "required" : "auto",
    maxTurns: Math.max(maxTurns, 3),
    requiredToolNames: [...requiredToolNames],
  };
}
