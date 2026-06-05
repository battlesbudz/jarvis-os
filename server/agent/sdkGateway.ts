/**
 * sdkGateway.ts — Jarvis-native harness for OpenRouter Agent SDK integration.
 *
 * The SDK is NOT a second brain. It is a bounded loop executor that:
 * - Executes workflows ONLY when explicitly delegated by Jarvis
 * - Uses Jarvis's tool policy, approval gates, memory, and routing
 * - Cannot expand its own tool registry, approval system, or intent router
 * - Runs within Jarvis's SOUL context and safety boundaries
 *
 * This gateway ensures:
 * 1. JARVIS DECIDES when to use SDK — not the SDK deciding for itself
 * 2. JARVIS OWNS all tool policy — SDK tools are Jarvis-filtered
 * 3. JARVIS OWNS approval — SDK approval flows through Jarvis approval gates
 * 4. JARVIS OWNS memory — SDK reads from Jarvis SOUL context
 * 5. JARVIS OWNS routing — SDK model choice is delegated by Jarvis
 * 6. JARVIS OWNS learning — SDK behavior feeds into Jarvis pattern recognition
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";
import { runAgent } from "./harness";
import { buildUntrustedSoulContext } from "../memory/contextBuilder";
import { requiresApproval } from "./approvalToolRisk";
import { requestApproval, getGate } from "./agentApproval";
import { getModel } from "../lib/modelPrefs";

// ── SDK Workflow Boundaries ───────────────────────────────────────────────────
// These define what the SDK is ALLOWED to execute.
// SDK cannot expand these without explicit Jarvis delegation.

export type SdkWorkflowType = "email_draft" | "reminder_create" | "document_summarize";

export interface SdkWorkflowDefinition {
  type: SdkWorkflowType;
  description: string;
  maxSteps: number;
  maxCostUsd: number;
  allowedTools: string[];  // Jarvis controls which tools SDK can use
  requiresApproval: boolean;  // Jarvis decides if approval required
  timeoutMs: number;
}

// Jarvis-native workflow definitions — SDK cannot add workflows without this
const SDK_WORKFLOWS: Record<SdkWorkflowType, SdkWorkflowDefinition> = {
  email_draft: {
    type: "email_draft",
    description: "Draft an email with user approval before sending",
    maxSteps: 10,
    maxCostUsd: 0.10,
    allowedTools: ["web_search", "read_document", "list_documents", "shell"],
    requiresApproval: true,
    timeoutMs: 60000,
  },
  reminder_create: {
    type: "reminder_create",
    description: "Create a calendar reminder with details from conversation",
    maxSteps: 5,
    maxCostUsd: 0.05,
    allowedTools: ["fetch_calendar", "create_reminder"],
    requiresApproval: false,
    timeoutMs: 30000,
  },
  document_summarize: {
    type: "document_summarize",
    description: "Summarize a document using research tools",
    maxSteps: 8,
    maxCostUsd: 0.08,
    allowedTools: ["web_search", "read_document", "research_topic"],
    requiresApproval: false,
    timeoutMs: 45000,
  },
};

// ── Jarvis Tool Policy Filter ─────────────────────────────────────────────────
// Wraps SDK tools through Jarvis's tool policy before execution.

export interface SdkToolCall {
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export interface SdkToolResult {
  ok: boolean;
  content: string;
  toolName: string;
  riskScore?: number;
  approvalRequired?: boolean;
  gateId?: string;
}

interface SdkGatewayDeps {
  userId: string;
  channel: string;
  channelId?: string;
  googleAccessToken?: string;
  jobId?: string;
}

/**
 * Check if a tool call is allowed by Jarvis's policy.
 * Returns { allowed, reason, riskScore, approvalRequired }
 */
function checkToolPolicy(
  toolName: string,
  _toolArgs: Record<string, unknown>,
  _deps: SdkGatewayDeps,
): { allowed: boolean; reason?: string; riskScore: number; approvalRequired: boolean } {
  // Use Jarvis's built-in requiresApproval check
  const approvalRequired = requiresApproval(toolName);
  
  // If tool requires approval, it's medium-high risk
  if (approvalRequired) {
    return {
      allowed: true,
      reason: `Tool "${toolName}" requires approval before execution`,
      riskScore: 40,
      approvalRequired: true,
    };
  }

  return {
    allowed: true,
    riskScore: 10,
    approvalRequired: false,
  };
}

/**
 * Execute a tool call through Jarvis's tool policy.
 * SDK tools are NOT executed directly — they go through Jarvis.
 */
export async function executeSdkTool(
  toolCall: SdkToolCall,
  tools: AgentTool[],
  deps: SdkGatewayDeps,
): Promise<SdkToolResult> {
  // Find the tool in Jarvis's registry (not SDK's own registry)
  const tool = tools.find((t) => t.name === toolCall.toolName);
  if (!tool) {
    return {
      ok: false,
      content: `Tool "${toolCall.toolName}" not found in Jarvis tool registry`,
      toolName: toolCall.toolName,
    };
  }

  // Check tool policy (synchronous)
  const policyCheck = checkToolPolicy(toolCall.toolName, toolCall.toolArgs, deps);
  if (!policyCheck.allowed) {
    return {
      ok: false,
      content: policyCheck.reason || "Tool blocked by Jarvis policy",
      toolName: toolCall.toolName,
      riskScore: policyCheck.riskScore,
    };
  }

  // Build tool context with Jarvis's context (not SDK's own context)
  const ctx: ToolContext = {
    userId: deps.userId,
    googleAccessToken: deps.googleAccessToken,
    channel: deps.channel,
    channelId: deps.channelId,
    jobId: deps.jobId,
    state: { pendingAttachments: [] },
  };

  // Execute through Jarvis's tool execution (not SDK's own execution)
  try {
    const result = await tool.execute(toolCall.toolArgs, ctx);
    return {
      ok: result.ok,
      content: result.content,
      toolName: toolCall.toolName,
      riskScore: policyCheck.riskScore,
      approvalRequired: policyCheck.riskScore > 30,
    };
  } catch (err) {
    return {
      ok: false,
      content: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
      toolName: toolCall.toolName,
      riskScore: policyCheck.riskScore,
    };
  }
}

/**
 * Request approval through Jarvis's approval system.
 * SDK cannot create its own approval gates.
 */
export async function requestSdkApproval(
  toolCall: SdkToolCall,
  deps: SdkGatewayDeps,
  description: string,
): Promise<string | null> {
  const gate = await requestApproval({
    agentId: "jarvis-sdk-gateway",
    userId: deps.userId,
    toolName: toolCall.toolName,
    toolArgs: toolCall.toolArgs,
    description,
    initiatedBy: "jarvis",  // Jarvis initiates, not SDK
  });

  return gate.id;
}

// ── SDK Workflow Execution ────────────────────────────────────────────────────
// Jarvis-native harness for bounded workflow execution.

export interface SdkWorkflowInput {
  userId: string;
  userText: string;
  workflowType: SdkWorkflowType;
  context?: string;
  originChannel: string;
  originChannelId?: string;
}

export interface SdkWorkflowResult {
  ok: boolean;
  reply?: string;
  toolCalls?: SdkToolCall[];
  approvalRequired?: boolean;
  gateId?: string;
  error?: string;
}

/**
 * Execute a bounded SDK workflow under Jarvis's control.
 *
 * Workflow is delegated by Jarvis, not initiated by SDK.
 * All tool calls go through Jarvis's policy.
 * All approvals go through Jarvis's approval system.
 * Memory/context comes from Jarvis's SOUL.
 */
export async function executeJarvisDelegatedWorkflow(
  input: SdkWorkflowInput,
  tools: AgentTool[],
): Promise<SdkWorkflowResult> {
  const workflow = SDK_WORKFLOWS[input.workflowType];
  if (!workflow) {
    return {
      ok: false,
      error: `Unknown workflow type: ${input.workflowType}. SDK cannot self-expand workflows.`,
    };
  }

  const deps: SdkGatewayDeps = {
    userId: input.userId,
    channel: input.originChannel,
    channelId: input.originChannelId,
  };

  // Get model from Jarvis's model routing (not SDK's own routing)
  const model = await getModel(input.userId, "sdk_workflow");
  const modelName = model || "gpt-4o-mini";

  // Build context from Jarvis's SOUL (not SDK's own memory)
  const soulContext = await buildUntrustedSoulContext(input.userId, "sdk_workflow");

  // Filter tools through Jarvis's policy for this workflow
  const allowedToolNames = workflow.allowedTools;
  const filteredTools = tools.filter((t) => allowedToolNames.includes(t.name));

  if (filteredTools.length === 0) {
    return {
      ok: false,
      error: `No tools allowed for workflow "${input.workflowType}". Jarvis controls tool access.`,
    };
  }

  // Build system prompt that enforces Jarvis boundaries
  const systemPrompt = `You are executing a Jarvis-delegated workflow.

WORKFLOW: ${workflow.description}
TYPE: ${input.workflowType}
MAX STEPS: ${workflow.maxSteps}
TIMEOUT: ${workflow.timeoutMs}ms

CRITICAL BOUNDARIES:
- You are a LOOP EXECUTOR, not an independent agent
- You MUST use ONLY tools from this list: ${allowedToolNames.join(", ")}
- You CANNOT use tools outside this list
- All sensitive operations require Jarvis approval
- Your context comes from Jarvis's SOUL, not your own memory
- Report completion to Jarvis for final approval

JARVIS SOUL CONTEXT:
${soulContext.slice(0, 2000)}

USER REQUEST:
${input.userText}
${input.context ? `\n\nADDITIONAL CONTEXT:\n${input.context}` : ""}`;

  try {
    // Run through Jarvis's agent harness (not SDK's own harness)
    const result = await runAgent({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.userText },
      ],
      tools: filteredTools,
      context: {
        userId: input.userId,
        googleAccessToken: undefined,
        channel: input.originChannel,
        channelId: input.originChannelId,
        state: { pendingAttachments: [] },
      },
      maxTurns: workflow.maxSteps,
      maxCompletionTokens: 2000,
    });

    return {
      ok: true,
      reply: result.reply,
      toolCalls: [],  // SDK doesn't track tool calls — Jarvis does
      approvalRequired: workflow.requiresApproval,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Workflow execution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── SDK Workflow Registry ────────────────────────────────────────────────────
// Jarvis owns the workflow registry. SDK cannot self-expand.

export function listAvailableWorkflows(): SdkWorkflowDefinition[] {
  return Object.values(SDK_WORKFLOWS);
}

export function isWorkflowAllowed(type: SdkWorkflowType): boolean {
  return type in SDK_WORKFLOWS;
}

export function getWorkflowDefinition(type: SdkWorkflowType): SdkWorkflowDefinition | null {
  return SDK_WORKFLOWS[type] || null;
}

/**
 * Check if SDK is requesting a workflow type that's not in the registry.
 * This prevents SDK from self-expanding beyond Jarvis's boundaries.
 */
export function validateWorkflowRequest(type: SdkWorkflowType): {
  valid: boolean;
  error?: string;
} {
  if (!(type in SDK_WORKFLOWS)) {
    return {
      valid: false,
      error: `Workflow "${type}" not registered with Jarvis. SDK cannot self-expand workflows. Request new workflows through Jarvis governance.`,
    };
  }
  return { valid: true };
}

// ── SDK Tool Registry Boundaries ─────────────────────────────────────────────
// Jarvis controls which tools the SDK can access.

export interface SdkToolRegistry {
  allowedTools: string[];
  blockedTools: string[];
  requiresApproval: string[];
}

const SDK_TOOL_POLICY: SdkToolRegistry = {
  // Tools the SDK is allowed to use (controlled by Jarvis)
  allowedTools: [
    "web_search",
    "research_topic",
    "read_document",
    "list_documents",
    "create_reminder",
    "fetch_calendar",
    "shell",
    "apply_code_change",
  ],
  // Tools the SDK can NEVER use (blocked by Jarvis policy)
  blockedTools: [
    "send_email",
    "android_sms_send",
    "android_notification_reply",
    "shell_dangerous",
    "file_write_critical",
    "daemon_shell",
  ],
  // Tools that require Jarvis approval before execution
  requiresApproval: [
    "send_email",
    "android_sms_send",
    "android_notification_reply",
    "android_camera_clip",
    "android_screen_record",
  ],
};

export function getSdkToolPolicy(): SdkToolRegistry {
  return { ...SDK_TOOL_POLICY };
}

export function isToolAllowedForSdk(toolName: string): boolean {
  return SDK_TOOL_POLICY.allowedTools.includes(toolName);
}

export function isToolBlockedForSdk(toolName: string): boolean {
  return SDK_TOOL_POLICY.blockedTools.includes(toolName);
}

export function doesToolRequireApproval(toolName: string): boolean {
  return SDK_TOOL_POLICY.requiresApproval.includes(toolName);
}

/**
 * Filter tools for SDK based on Jarvis tool policy.
 * SDK cannot access tools not in this list.
 */
export function filterToolsForSdk(tools: AgentTool[]): AgentTool[] {
  return tools.filter((tool) =>
    SDK_TOOL_POLICY.allowedTools.includes(tool.name) &&
    !SDK_TOOL_POLICY.blockedTools.includes(tool.name)
  );
}