import type { RuntimeRiskTier } from "../protocol";
import type { ToolGatewayToolDescriptor } from "./toolGatewayTypes";

export interface ToolCapabilitySummary {
  totalTools: number;
  providers: string[];
  requiredScopes: string[];
  approvalRequiredToolCount: number;
  maxRiskTier: RuntimeRiskTier | null;
}

const RISK_ORDER: RuntimeRiskTier[] = ["T0", "T1", "T2", "T3", "T4", "T5"];

function maxRisk(current: RuntimeRiskTier | null, next: RuntimeRiskTier | undefined): RuntimeRiskTier | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return RISK_ORDER.indexOf(next) > RISK_ORDER.indexOf(current) ? next : current;
}

export function summarizeToolCapabilities(tools: ToolGatewayToolDescriptor[]): ToolCapabilitySummary {
  const providers = new Set<string>();
  const requiredScopes = new Set<string>();
  let maxRiskTier: RuntimeRiskTier | null = null;

  for (const tool of tools) {
    if (tool.provider) {
      providers.add(tool.provider);
    }
    for (const scope of tool.requiredScopes ?? []) {
      requiredScopes.add(scope);
    }
    maxRiskTier = maxRisk(maxRiskTier, tool.riskTier);
  }

  return {
    totalTools: tools.length,
    providers: [...providers].sort(),
    requiredScopes: [...requiredScopes].sort(),
    approvalRequiredToolCount: tools.filter((tool) => tool.approvalRequired).length,
    maxRiskTier,
  };
}
