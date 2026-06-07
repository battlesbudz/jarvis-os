import type { AgentTool } from "../../agent/types";
import type { RuntimeRiskTier } from "../protocol";
import type { ToolGatewayToolDescriptor } from "./toolGatewayTypes";

export interface AgentToolDescriptorOptions {
  provider?: string;
  requiredScopes?: string[];
  riskTier?: RuntimeRiskTier;
  approvalRequired?: boolean;
}

const PROVIDER_PATTERNS: Array<{ pattern: RegExp; provider: string; scopes?: string[] }> = [
  { pattern: /gmail|email|send_email|fetch_emails/, provider: "google", scopes: ["gmail"] },
  { pattern: /calendar/, provider: "google", scopes: ["calendar"] },
  { pattern: /drive|document|presentation|pdf/, provider: "google", scopes: ["drive"] },
  { pattern: /daemon|android|browser|shell|deploy|code|project_/, provider: "runtime" },
  { pattern: /(^|_)github(_|$)|github_pr|list_github_prs|get_github_pr|merge_github_pr/, provider: "github", scopes: ["repo"] },
  { pattern: /discord/, provider: "discord", scopes: ["discord"] },
  { pattern: /telegram/, provider: "telegram", scopes: ["telegram"] },
  { pattern: /weather/, provider: "weather" },
  { pattern: /memory|brain/, provider: "memory", scopes: ["memory:read"] },
];

const APPROVAL_NAME_PARTS = [
  "send",
  "post",
  "publish",
  "delete",
  "merge_github",
  "deploy",
  "shell",
  "run_shell",
  "daemon",
  "android",
  "browser_click",
  "browser_type",
  "create_calendar",
  "schedule",
  "cron",
  "workflow_run",
  "project_write",
  "project_shell",
  "apply_code",
  "purchase",
  "pay",
];
const LOW_RISK_NAME_PARTS = ["search", "fetch", "research", "read", "list", "get", "weather", "memory"];

function inferProvider(name: string): { provider?: string; scopes: string[] } {
  const match = PROVIDER_PATTERNS.find((entry) => entry.pattern.test(name));
  return {
    provider: match?.provider,
    scopes: match?.scopes ?? [],
  };
}

function inferRiskTier(name: string, approvalRequired: boolean): RuntimeRiskTier {
  if (approvalRequired) {
    return "T3";
  }
  if (LOW_RISK_NAME_PARTS.some((part) => name.includes(part))) {
    return "T0";
  }
  return "T1";
}

function inferApprovalRequired(name: string): boolean {
  return APPROVAL_NAME_PARTS.some((part) => name.includes(part));
}

export function toolDescriptorFromAgentTool(
  tool: Pick<AgentTool, "name">,
  options: AgentToolDescriptorOptions = {},
): ToolGatewayToolDescriptor {
  const normalizedName = tool.name.toLowerCase();
  const inferredProvider = inferProvider(normalizedName);
  const provider = options.provider ?? inferredProvider.provider;
  const requiredScopes =
    options.requiredScopes ??
    (options.provider && options.provider !== inferredProvider.provider ? [] : inferredProvider.scopes);
  const approvalRequired = options.approvalRequired ?? inferApprovalRequired(normalizedName);

  return {
    name: tool.name,
    provider,
    requiredScopes,
    riskTier: options.riskTier ?? inferRiskTier(normalizedName, approvalRequired),
    approvalRequired,
  };
}

export function toolDescriptorsFromAgentTools(
  tools: Array<Pick<AgentTool, "name">>,
  overrides: Record<string, AgentToolDescriptorOptions> = {},
): ToolGatewayToolDescriptor[] {
  return tools.map((tool) => toolDescriptorFromAgentTool(tool, overrides[tool.name]));
}
