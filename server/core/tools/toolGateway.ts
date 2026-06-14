import { ToolIntentSchema, type RuntimeRiskTier, type ToolIntent } from "../protocol";
import type {
  ToolGatewayPreflightInput,
  ToolGatewayPreflightResult,
  ToolGatewayToolDescriptor,
  ToolPreflightInput,
  ToolPreflightResult,
  ToolPreflightStatus,
} from "./toolGatewayTypes";

const RISK_ORDER: RuntimeRiskTier[] = ["T0", "T1", "T2", "T3", "T4", "T5"];
const VIRTUAL_RUNTIME_TOOLS = new Set([
  "read_context",
  "draft_only",
  "search",
  "queue_job",
  "approval_gated_action",
  "local_patch",
  "run_checks",
]);

function riskExceeds(value: RuntimeRiskTier, max: RuntimeRiskTier): boolean {
  return RISK_ORDER.indexOf(value) > RISK_ORDER.indexOf(max);
}

function findDescriptor(toolName: string, availableTools: ToolGatewayToolDescriptor[]): ToolGatewayToolDescriptor | undefined {
  return availableTools.find((tool) => tool.name === toolName);
}

function setHas(value: string | undefined, items: string[] | undefined): boolean {
  return Boolean(value && items?.includes(value));
}

function missingScopes(requiredScopes: string[] | undefined, grantedScopes: string[] | undefined): string[] {
  if (!requiredScopes || requiredScopes.length === 0) {
    return [];
  }
  const granted = new Set(grantedScopes ?? []);
  return requiredScopes.filter((scope) => !granted.has(scope));
}

function withStatus(
  intent: ToolIntent,
  status: ToolPreflightStatus,
  reason: string,
  descriptor?: ToolGatewayToolDescriptor,
  missing: string[] = [],
): ToolPreflightResult {
  return {
    intent: {
      ...intent,
      status,
      approvalRequired: status === "approval_required" ? true : intent.approvalRequired,
      reason,
    },
    status,
    reason,
    missingScopes: missing,
    provider: descriptor?.provider,
  };
}

function knownToolOrVirtual(toolName: string, descriptor: ToolGatewayToolDescriptor | undefined): boolean {
  return Boolean(descriptor || VIRTUAL_RUNTIME_TOOLS.has(toolName));
}

function normalizedIntent(intent: ToolIntent): ToolIntent {
  return ToolIntentSchema.parse(intent);
}

export function preflightToolIntent(input: ToolPreflightInput): ToolPreflightResult {
  const intent = normalizedIntent(input.intent);
  const descriptor = findDescriptor(intent.toolName, input.availableTools);
  const policy = input.policy ?? {};
  const auth = input.auth ?? {};

  if (!knownToolOrVirtual(intent.toolName, descriptor)) {
    return withStatus(intent, "blocked_by_policy", "Tool is not registered or approved for the current runtime surface.");
  }

  if (policy.blockedTools?.includes(intent.toolName)) {
    return withStatus(intent, "blocked_by_policy", "Tool is blocked by runtime policy.", descriptor);
  }

  const effectiveRisk = descriptor?.riskTier ?? intent.riskTier;
  if (policy.maxAllowedRiskTier && riskExceeds(effectiveRisk, policy.maxAllowedRiskTier)) {
    return withStatus(intent, "blocked_by_policy", "Tool risk exceeds the current runtime policy ceiling.", descriptor);
  }

  if (descriptor?.provider && setHas(descriptor.provider, auth.unavailableProviders)) {
    return withStatus(intent, "provider_down", "Tool provider is currently unavailable.", descriptor);
  }

  if (descriptor?.provider && !setHas(descriptor.provider, auth.connectedProviders)) {
    return withStatus(intent, "needs_auth", "Tool provider is not connected for this user.", descriptor);
  }

  const missing = missingScopes(descriptor?.requiredScopes, auth.grantedScopes);
  if (missing.length > 0) {
    return withStatus(intent, "missing_scope", "Connected provider is missing required tool scopes.", descriptor, missing);
  }

  if (
    intent.approvalRequired ||
    descriptor?.approvalRequired ||
    policy.approvalRequiredTools?.includes(intent.toolName) ||
    RISK_ORDER.indexOf(effectiveRisk) >= RISK_ORDER.indexOf("T3")
  ) {
    return withStatus(intent, "approval_required", "Tool requires human approval before execution.", descriptor);
  }

  return withStatus(intent, "ready", "Tool passed preflight checks and may be executed by the existing tool owner.", descriptor);
}

export function preflightToolGateway(input: ToolGatewayPreflightInput): ToolGatewayPreflightResult {
  const tools = input.intents.map((intent) =>
    preflightToolIntent({
      intent,
      availableTools: input.availableTools,
      auth: input.auth,
      policy: input.policy,
    }),
  );

  return {
    tools,
    ready: tools.filter((tool) => tool.status === "ready"),
    blocked: tools.filter((tool) => tool.status !== "ready"),
  };
}
