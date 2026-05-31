
/** Pending artifact that a tool has produced and that the calling channel
 * (e.g. Telegram) should deliver to the user after the agent finishes. */
export interface PendingAttachment {
  kind: "document" | "image" | "file" | "markdown";
  documentId?: string;
  filename?: string;
  content?: string | Buffer;
  caption?: string;
  mimeType?: string;
  /** For image kind: a URL or base64 data URI */
  url?: string;
  /** Raw base64 blob data (for image attachments from MCP) */
  data?: string;
  /** Text content for markdown kind */
  text?: string;
  /** Name of the MCP server that produced this attachment */
  mcpServerName?: string;
  /** Optional Google Drive web-view URL — used as fallback link when file exceeds channel upload size limit */
  driveLink?: string;
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
  /** Optional callback for streaming progress messages from long-running tools (e.g. MCP progress notifications). */
  onProgress?: (message: string) => void;
  /**
   * Optional callback for sending heartbeat status messages during long tool calls.
   * Edits the channel's placeholder message with an ⏳ prefix (Telegram, Discord).
   * Prefer this over onProgress for user-visible status updates — it does not
   * pollute the streaming token buffer.
   */
  onProgressMessage?: (message: string) => void;
  [k: string]: unknown;
}

export interface ToolContext {
  userId: string;
  googleAccessToken?: string | null;
  googleAccessTokens?: string[];
  state: AgentState;
  /** Optional logger label, e.g. "Telegram" or "AppChat" */
  channel?: string;
  /** Origin channel ID for callback-capable channels, e.g. Telegram chat ID. */
  originChannelId?: string;
  /** Background worker job ID, when this tool run belongs to an agent_jobs worker. */
  jobId?: string;
  /** AbortSignal that fires when the user presses Stop. Tools should propagate it to long-running operations. */
  signal?: AbortSignal;
  /** Discord guild (server) ID — set when the message originates from a Discord guild channel */
  discordGuildId?: string;
  /** Discord text channel ID — set when the message originates from a Discord channel (DM or guild) */
  discordChannelId?: string;
  /**
   * Set of tool names that are active in the current agent run.
   * Populated by the harness at run start. Tools that need to invoke other tools
   * (e.g. test_tool) MUST check this set to prevent surface-escaping.
   */
  allowedToolNames?: ReadonlySet<string>;
  /**
   * Standalone app project ID — set when the agent is operating inside an
   * isolated project workspace (app_project job type). Used by projectShellTool
   * to scope commands to the correct workspace directory.
   */
  projectId?: string;
  /**
   * When true, browser tools are allowed to navigate localhost ports 3001-3999.
   * Must only be set in app_project contexts where the agent is testing its own
   * dev server — never granted in general chat or other agent runs.
   */
  browserLocalhostException?: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** Content the model sees as the tool's reply. */
  content: string;
  /** Audit trail surfaced to the UI/logs (action card, etc.) */
  label?: string;
  detail?: string;
  /**
   * Optional machine-readable metadata emitted alongside the content string.
   * Tools can use this to give downstream consumers (the orchestrator, UI, tests)
   * a structured signal without polluting the content seen by the model.
   */
  metadata?: Record<string, unknown>;
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
