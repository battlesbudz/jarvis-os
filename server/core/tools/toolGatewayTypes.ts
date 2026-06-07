import type { RuntimeRiskTier, ToolIntent } from "../protocol";

export type ToolPreflightStatus =
  | "ready"
  | "needs_auth"
  | "missing_scope"
  | "provider_down"
  | "blocked_by_policy"
  | "approval_required";

export interface ToolGatewayToolDescriptor {
  name: string;
  provider?: string;
  requiredScopes?: string[];
  riskTier?: RuntimeRiskTier;
  approvalRequired?: boolean;
}

export interface ToolGatewayAuthSnapshot {
  connectedProviders?: string[];
  grantedScopes?: string[];
  unavailableProviders?: string[];
}

export interface ToolGatewayPolicy {
  blockedTools?: string[];
  approvalRequiredTools?: string[];
  maxAllowedRiskTier?: RuntimeRiskTier;
}

export interface ToolPreflightInput {
  intent: ToolIntent;
  availableTools: ToolGatewayToolDescriptor[];
  auth?: ToolGatewayAuthSnapshot;
  policy?: ToolGatewayPolicy;
}

export interface ToolPreflightResult {
  intent: ToolIntent;
  status: ToolPreflightStatus;
  reason: string;
  missingScopes: string[];
  provider?: string;
}

export interface ToolGatewayPreflightInput {
  intents: ToolIntent[];
  availableTools: ToolGatewayToolDescriptor[];
  auth?: ToolGatewayAuthSnapshot;
  policy?: ToolGatewayPolicy;
}

export interface ToolGatewayPreflightResult {
  tools: ToolPreflightResult[];
  ready: ToolPreflightResult[];
  blocked: ToolPreflightResult[];
}
