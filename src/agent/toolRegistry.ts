/**
 * toolRegistry.ts — SDK Tool Registry (Jarvis-controlled)
 *
 * ⚠️ DEPRECATED: SDK no longer has its own tool registry.
 *
 * All SDK tool execution goes through Jarvis's tool policy:
 * - SDK cannot self-register tools
 * - SDK cannot execute tools outside Jarvis's allowed list
 * - SDK tool calls go through Jarvis's toolRiskScoring
 * - SDK tool calls go through Jarvis's approval gates
 *
 * This file is kept for backwards compatibility but all tools
 * are now executed through the Jarvis SDK Gateway.
 *
 * @deprecated Use server/agent/sdkGateway.ts instead
 */

import type { AgentSdkRunStore } from "./runStore";

// ── SDK Tool Boundaries ───────────────────────────────────────────────────────
// Jarvis controls which tools the SDK can access.
// SDK cannot self-expand its tool registry.

export interface AgentSdkToolDeps {
  userId: string;
  runId: string;
  store: AgentSdkRunStore;
  // All other deps are deprecated — tools now go through Jarvis
  includeDraftEmailTool?: boolean;
  includeSendEmailTool?: boolean;
  includeReminderTool?: boolean;
  readContext?: (query: string) => Promise<string>;
  sendEmail?: (args: {
    to: string;
    subject: string;
    body: string;
    provider?: "google" | "microsoft";
  }) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
  createInternalReminder?: (args: {
    title: string;
    description?: string;
    scheduledAt: string;
    recurrence?: string;
  }) => Promise<{ ok: boolean; id?: string; scheduledAt?: string; recurrence?: string | null; deduped?: boolean; error?: string }>;
}

/**
 * @deprecated SDK tools are now executed through Jarvis's sdkGateway
 *
 * This function is kept for backwards compatibility but all tool
 * execution should go through the Jarvis SDK Gateway.
 */
export function createAgentSdkTools(_deps: AgentSdkToolDeps) {
  console.warn(
    "[SDK ToolRegistry] DEPRECATED: createAgentSdkTools is deprecated. " +
    "All SDK tool execution should go through server/agent/sdkGateway.ts. " +
    "SDK cannot have its own tool registry — Jarvis owns all tool policy."
  );

  // Return empty array — SDK no longer has independent tools
  // All tool execution goes through Jarvis's sdkGateway
  return [];
}

// ── Tool Policy Enforcement ───────────────────────────────────────────────────
// These constants are now controlled by Jarvis, not the SDK.

export const SDK_TOOL_POLICY = {
  // Tools the SDK is allowed to use (controlled by Jarvis in sdkGateway.ts)
  allowedTools: [] as string[],

  // Tools the SDK can NEVER use (blocked by Jarvis)
  blockedTools: [
    "send_email",
    "android_sms_send",
    "android_notification_reply",
    "android_camera_clip",
    "android_screen_record",
  ] as string[],

  // Message indicating SDK cannot self-expand
  selfExpandError: "SDK cannot self-expand tool registry. All tool requests must be delegated through Jarvis.",
} as const;