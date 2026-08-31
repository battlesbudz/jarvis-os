import { isCloudBackgroundApprovalReady } from "./cloudBackgroundEscalation";
import { codexDelegationRequiresConfirmation } from "./codexDelegationPolicy";
import { ANDROID_PHONE_RUNTIME_TOOL_NAMES } from "./androidPhoneRuntimeToolNames";

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

const EYEVUE_CAPTURE_COMMANDS = new Set(["photo", "video_start", "audio_start"]);

/** Wearable capture must have a durable human approval before daemon dispatch. */
export function isEyevueCaptureAction(toolName: string, toolArgs?: Record<string, unknown>): boolean {
  return eyevueCaptureApprovalText(toolName, toolArgs) !== undefined;
}

/** Stable receipt scope for one exact wearable capture operation. */
export function eyevueCaptureApprovalText(toolName: string, toolArgs?: Record<string, unknown>): string | undefined {
  if (toolName !== "daemon_action") return undefined;
  const action = String(toolArgs?.action || "");
  if (action === "android_eyevue_look" && toolArgs?.lookAgain === true) return `${action}:lookAgain`;
  const command = String(toolArgs?.command || "");
  if (action === "android_eyevue_command" && EYEVUE_CAPTURE_COMMANDS.has(command)) return `${action}:${command}`;
  return undefined;
}

/** Return true if this tool requires an approval gate before running. */
export function requiresApproval(toolName: string, toolArgs?: Record<string, unknown>): boolean {
  if (ANDROID_PHONE_RUNTIME_TOOL_NAMES.includes(toolName as typeof ANDROID_PHONE_RUNTIME_TOOL_NAMES[number])) {
    return false;
  }
  if (toolName === "daemon_action") {
    if (isEyevueCaptureAction(toolName, toolArgs)) return true;
    if (String(toolArgs?.action || "").startsWith("android_")) return false;
  }
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

export function requiresHumanApproval(toolName: string, toolArgs?: Record<string, unknown>): boolean {
  if (toolName === "queue_background_job" && toolArgs?.task_scoped_cloud === true) {
    return isCloudBackgroundApprovalReady(toolArgs);
  }
  if (toolName === "delegate_to_codex") {
    return codexDelegationRequiresConfirmation(toolArgs ?? {});
  }
  if (ANDROID_PHONE_RUNTIME_TOOL_NAMES.includes(toolName as typeof ANDROID_PHONE_RUNTIME_TOOL_NAMES[number])) {
    return false;
  }
  if (toolName === "daemon_action") {
    if (isEyevueCaptureAction(toolName, toolArgs)) return true;
    if (String(toolArgs?.action || "").startsWith("android_")) return false;
  }
  return STRICTLY_IRREVERSIBLE_TOOLS.has(toolName);
}
