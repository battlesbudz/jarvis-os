/**
 * AgentLogger — structured JSON event logging for the multi-agent ego system.
 *
 * Writes one log line per event, tagged [AgentManager], to stdout.
 * Avoids logging full message content for privacy.
 */

export type AgentEventType =
  | "agent_created"
  | "agent_invoked"
  | "tool_used"
  | "tool_permission_denied"
  | "task_delegated"
  | "task_completed"
  | "task_failed"
  | "memory_written"
  | "memory_summarized"
  | "council_started"
  | "council_completed"
  | "heartbeat_check"
  | "agent_disabled_stuck"
  | "approval_gate_triggered";

export interface AgentLogEvent {
  event: AgentEventType;
  agentId?: string;
  userId?: string;
  toolName?: string;
  taskId?: string;
  durationMs?: number;
  detail?: string;
}

/**
 * Log a structured agent lifecycle event.
 * Format: [AgentManager] {"event":"...","agentId":"...","userId":"...","detail":"..."}
 */
export function logAgentEvent(e: AgentLogEvent): void {
  try {
    const payload: Record<string, unknown> = { event: e.event };
    if (e.agentId) payload.agentId = e.agentId;
    if (e.userId) payload.userId = e.userId;
    if (e.toolName) payload.toolName = e.toolName;
    if (e.taskId) payload.taskId = e.taskId;
    if (e.durationMs !== undefined) payload.durationMs = e.durationMs;
    if (e.detail) payload.detail = e.detail;
    console.log(`[AgentManager] ${JSON.stringify(payload)}`);
  } catch {
    // Never throw from logging
  }
}
