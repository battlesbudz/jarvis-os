
/** Pending artifact that a tool has produced and that the calling channel
 * (e.g. Telegram) should deliver to the user after the agent finishes. */
export interface PendingAttachment {
  kind: "document";
  documentId: string;
  filename: string;
  content: string;
  caption?: string;
  mimeType: string;
}

/** Plan stored on the daily `plans` row (loose shape — owned by telegramRoutes). */
export interface AgentPlan {
  tasks: Array<{ id: string; title: string; completed: boolean; [k: string]: unknown }>;
  [k: string]: unknown;
}

/** Mutable shared state passed to every tool in a single agent run. */
export interface AgentState {
  dateKey?: string;
  todayPlan?: AgentPlan | null;
  gmailMessageIds?: string[];
  pendingAttachments?: PendingAttachment[];
  lastCalendarFetch?: { startDate: string; days: number; totalEvents: number; fetchedAt: number };
  [k: string]: unknown;
}

export interface ToolContext {
  userId: string;
  googleAccessToken?: string | null;
  googleAccessTokens?: string[];
  state: AgentState;
  /** Optional logger label, e.g. "Telegram" or "AppChat" */
  channel?: string;
  /** Discord guild (server) ID — set when the message originates from a Discord guild channel */
  discordGuildId?: string;
}

export interface ToolResult {
  ok: boolean;
  /** Content the model sees as the tool's reply. */
  content: string;
  /** Audit trail surfaced to the UI/logs (action card, etc.) */
  label?: string;
  detail?: string;
}

/** JSON-Schema (draft-7 subset) for tool parameters. */
export type JsonSchema = {
  type?: string;
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
  [k: string]: unknown;
};

export type ToolArgs = Record<string, unknown>;

export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (args: ToolArgs, ctx: ToolContext) => Promise<ToolResult>;
}

export interface AgentToolCallRecord {
  name: string;
  args: ToolArgs;
  result: ToolResult;
  durationMs: number;
}
