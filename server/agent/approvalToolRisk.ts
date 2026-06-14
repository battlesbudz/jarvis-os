const HIGH_RISK_TOOLS = new Set([
  // Email
  "send_email",
  "gmail_action",
  "create_gmail_draft",
  // Legacy alias retained for older policies/config.
  "gmail_draft",
  // Public posting / messaging
  "discord_post",
  "connect_channel",
  "sessions_send",
  "connected_accounts_execute",
  // Voice / call user
  "speak",
  // Memory clear (permanent, irreversible)
  "clear_memory",
  "agent_memory_clear",
  // Browser control
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_select",
  "browser_clear_session",
  // File / cloud storage
  "create_document",
  "drive_create_file",
  // Agent management (creating new agents)
  "setup_named_agent",
  // OS / system actions via daemon
  "daemon_action",
  // Delegating to Codex may transitively reach local MCP/CLI capabilities.
  "delegate_to_codex",
]);

/** Return true if this tool requires an approval gate before running. */
export function requiresApproval(toolName: string): boolean {
  return HIGH_RISK_TOOLS.has(toolName);
}

/**
 * Tools that must ALWAYS wait for human approval, even when Jarvis is the
 * initiator. Everything else in HIGH_RISK_TOOLS can be auto-approved when
 * `initiatedBy === "jarvis"`.
 */
export const STRICTLY_IRREVERSIBLE_TOOLS = new Set([
  "send_email",
  "gmail_action",
  "daemon_action",
  "discord_post",
  "speak",
  "sessions_send",
  "connected_accounts_execute",
]);
