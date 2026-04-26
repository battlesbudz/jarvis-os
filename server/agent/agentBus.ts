/**
 * AgentBus — async agent-to-agent message passing.
 *
 * Agents post messages to the bus; the bus delivers them to the target agent.
 * All messages are persisted to `agent_messages` for audit + retry.
 *
 * Message lifecycle:
 *   pending → processing → completed | failed
 *
 * The bus is intentionally simple and synchronous for v1 — no background
 * queue workers. Messages are processed on-demand when `deliverPending` is called
 * or immediately via `sendToAgent` when the caller awaits delivery.
 */
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { agentMessages, discordAgents } from "@shared/schema";
import type { AgentMessage } from "@shared/schema";
import { runNamedAgent } from "./runNamedAgent";
import { getAgent } from "./agentManager";
import { logAgentEvent } from "./agentLogger";

/**
 * Valid message types — must match AGENT_MESSAGE_TYPES in shared/schema.ts.
 * "query" and "notification" are aliases that map to schema-supported types.
 */
export type MessageType =
  | "task_request"
  | "task_result"
  | "clarification_needed"
  | "error"
  | "memory_update_request"
  | "tool_request_denied"
  | "final_answer";

export interface AgentBusPayload {
  text: string;
  metadata?: Record<string, unknown>;
  replyTo?: string; // messageId to reply to
}

export interface SendMessageOptions {
  fromAgentId: string | null;
  toAgentId: string;
  userId: string;
  messageType: MessageType;
  payload: AgentBusPayload;
  delegationDepth?: number;
  taskId?: string;
}

export interface BusDeliveryResult {
  messageId: string;
  reply?: string;
  status: "completed" | "failed";
  error?: string;
}

const MAX_DELEGATION_DEPTH = 5; // spec requires max depth 5 (was incorrectly set to 3)

// ── sendToAgent ────────────────────────────────────────────────────────────────

/**
 * Send a message from one agent to another and await the reply.
 *
 * @throws if delegation depth exceeds MAX_DELEGATION_DEPTH
 * @throws if the target agent is not found or disabled
 */
export async function sendToAgent(opts: SendMessageOptions): Promise<BusDeliveryResult> {
  const { fromAgentId, toAgentId, userId, messageType, payload, taskId } = opts;
  const depth = opts.delegationDepth ?? 0;

  if (depth >= MAX_DELEGATION_DEPTH) {
    throw new Error(
      `Delegation depth limit reached (${MAX_DELEGATION_DEPTH}). ` +
      `Chain: …→ ${toAgentId}`,
    );
  }

  // Validate target agent
  const target = await getAgent(toAgentId);
  if (!target) throw new Error(`Target agent ${toAgentId} not found`);
  if (!target.isActive) throw new Error(`Target agent ${toAgentId} is disabled`);

  // Persist the message
  const [msgRow] = await db
    .insert(agentMessages)
    .values({
      fromAgentId: fromAgentId ?? undefined,
      toAgentId,
      userId,
      messageType,
      payload: payload as unknown as Record<string, unknown>,
      status: "pending",
      delegationDepth: depth,
      taskId,
    })
    .returning({ id: agentMessages.id });

  const messageId = msgRow.id;
  logAgentEvent({
    event: "task_delegated",
    agentId: toAgentId,
    userId,
    taskId,
    detail: `from=${fromAgentId ?? "user"} type=${messageType} depth=${depth}`,
  });

  // Deliver synchronously
  try {
    const result = await runNamedAgent({
      agentId: toAgentId,
      userId,
      userMessage: payload.text,
      platform: "agent_bus",
    });

    await db
      .update(agentMessages)
      .set({ status: "processed" })
      .where(eq(agentMessages.id, messageId));

    return { messageId, reply: result.reply, status: "completed" };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(agentMessages)
      .set({
        status: "failed",
        payload: { ...payload as object, _error: errMsg } as Record<string, unknown>,
      })
      .where(eq(agentMessages.id, messageId));

    return { messageId, status: "failed", error: errMsg };
  }
}

// ── postNotification ──────────────────────────────────────────────────────────

/**
 * Post a one-way notification to an agent (fire-and-forget).
 * The message is persisted but not executed — used for audit trails.
 */
export async function postNotification(
  fromAgentId: string | null,
  toAgentId: string,
  userId: string,
  text: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const [row] = await db
    .insert(agentMessages)
    .values({
      fromAgentId: fromAgentId ?? undefined,
      toAgentId,
      userId,
      messageType: "final_answer",
      payload: { text, ...metadata },
      status: "processed",
    })
    .returning({ id: agentMessages.id });
  return row.id;
}

// ── getAgentMessages ──────────────────────────────────────────────────────────

/** Get message history between two agents. */
export async function getAgentMessages(
  toAgentId: string,
  userId: string,
  limit = 20,
): Promise<AgentMessage[]> {
  return db
    .select()
    .from(agentMessages)
    .where(and(eq(agentMessages.toAgentId, toAgentId), eq(agentMessages.userId, userId)))
    .orderBy(desc(agentMessages.createdAt))
    .limit(limit);
}

// ── getPendingMessages ─────────────────────────────────────────────────────────

export async function getPendingMessages(toAgentId: string): Promise<AgentMessage[]> {
  return db
    .select()
    .from(agentMessages)
    .where(and(
      eq(agentMessages.toAgentId, toAgentId),
      eq(agentMessages.status, "pending"),
    ))
    .orderBy(agentMessages.createdAt)
    .limit(10);
}

// ── retryFailedMessages ────────────────────────────────────────────────────────

/**
 * Retry up to `limit` failed messages for a given agent.
 * Updates status to "processing", re-runs the agent, marks completed/failed.
 */
export async function retryFailedMessages(agentId: string, userId: string, limit = 5): Promise<void> {
  const failed = await db
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.toAgentId, agentId),
        eq(agentMessages.userId, userId),
        eq(agentMessages.status, "failed"),
      ),
    )
    .orderBy(agentMessages.createdAt)
    .limit(limit);

  for (const msg of failed) {
    const payload = msg.payload as AgentBusPayload;
    await sendToAgent({
      fromAgentId: msg.fromAgentId ?? null,
      toAgentId: agentId,
      userId,
      messageType: msg.messageType as MessageType,
      payload,
      delegationDepth: msg.delegationDepth,
      taskId: msg.taskId ?? undefined,
    });
  }
}

// ── broadcastToAgents ─────────────────────────────────────────────────────────

/**
 * Send the same message to multiple agents in parallel.
 * Used by council mode and multi-agent broadcasts.
 */
export async function broadcastToAgents(
  fromAgentId: string | null,
  toAgentIds: string[],
  userId: string,
  messageType: MessageType,
  text: string,
): Promise<BusDeliveryResult[]> {
  const results = await Promise.allSettled(
    toAgentIds.map((toId) =>
      sendToAgent({
        fromAgentId,
        toAgentId: toId,
        userId,
        messageType,
        payload: { text },
      }),
    ),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      messageId: `err-${toAgentIds[i]}`,
      status: "failed" as const,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

// ── getMessageStats ───────────────────────────────────────────────────────────

export async function getMessageStats(agentId: string, userId: string): Promise<{
  total: number;
  pending: number;
  completed: number;
  failed: number;
}> {
  const result = await db.execute<{ status: string; count: string }>(sql`
    SELECT status, COUNT(*) AS count
    FROM agent_messages
    WHERE to_agent_id = ${agentId} AND user_id = ${userId}
    GROUP BY status
  `);
  const stats = { total: 0, pending: 0, completed: 0, failed: 0 };
  for (const row of result.rows) {
    const n = parseInt(row.count, 10);
    stats.total += n;
    if (row.status === "pending") stats.pending = n;
    else if (row.status === "processed") stats.completed = n; // expose as "completed" to callers
    else if (row.status === "failed") stats.failed = n;
  }
  return stats;
}
