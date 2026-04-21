// Agent tool-calling types — adapted from OpenClaw patterns
// (MIT-licensed concepts: typed tool registry + permissioned execution)
// Original: Copyright (c) 2025 Peter Steinberger

export interface ToolContext {
  userId: string;
  googleAccessToken?: string | null;
  googleAccessTokens?: string[];
  // Mutable shared state across tool calls in a single agent run.
  // Tools may read/write here so later tools see the effects of earlier ones.
  state: Record<string, any>;
  // Optional logger label, e.g. "Telegram" or "AppChat"
  channel?: string;
}

export interface ToolResult {
  ok: boolean;
  // Content the model sees as the tool's reply.
  content: string;
  // Audit trail surfaced to the UI/logs (action card, etc.)
  label?: string;
  detail?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON schema
  execute: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

export interface AgentToolCallRecord {
  name: string;
  args: any;
  result: ToolResult;
  durationMs: number;
}
