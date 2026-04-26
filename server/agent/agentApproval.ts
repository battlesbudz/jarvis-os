/**
 * AgentApproval — persistent approval gate system for sensitive agent actions.
 *
 * Gates are written to the `agent_approval_gates` DB table so they survive
 * server restarts. The in-memory EventEmitter is kept for the await mechanism
 * (awaitApproval blocks on event). If the server restarts while a gate is
 * pending, the gate remains visible via the API and the blocked tool call
 * receives an "expired" rejection when the TTL elapses.
 *
 * Approval flow:
 *   1. Tool detects it needs approval → calls requestApproval()
 *   2. requestApproval() inserts a DB row and returns the gate ID
 *   3. User approves/rejects via REST → approveGate() / rejectGate()
 *   4. Original tool was blocking on awaitApproval() — event fires, tool continues
 */
import { db } from "../db";
import { agentApprovalGates } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";
import { logAgentEvent } from "./agentLogger";
import { EventEmitter } from "events";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalGate {
  id: string;
  agentId: string;
  userId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  status: ApprovalStatus;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export interface ApprovalRequest {
  agentId: string;
  userId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  /** TTL in ms, default 10 minutes */
  ttlMs?: number;
}

// ── Tools that always require approval ────────────────────────────────────────

const HIGH_RISK_TOOLS = new Set([
  "send_email",
  "gmail_action",
  "daemon_action",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "setup_named_agent",
  "connect_channel",
]);

/** Return true if this tool requires an approval gate before running. */
export function requiresApproval(toolName: string): boolean {
  return HIGH_RISK_TOOLS.has(toolName);
}

// ── In-memory EventEmitter (for awaitApproval) ────────────────────────────────

const gateEmitter = new EventEmitter();
gateEmitter.setMaxListeners(200);
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Helper: DB row → ApprovalGate ─────────────────────────────────────────────

function rowToGate(row: typeof agentApprovalGates.$inferSelect): ApprovalGate {
  return {
    id: row.id,
    agentId: row.agentId,
    userId: row.userId,
    toolName: row.toolName,
    toolArgs: row.toolArgs as Record<string, unknown>,
    description: row.description,
    status: row.status as ApprovalStatus,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt ?? undefined,
    resolvedBy: row.resolvedBy ?? undefined,
  };
}

// ── Periodic cleanup ──────────────────────────────────────────────────────────

// Mark overdue pending gates as expired every 2 minutes
setInterval(async () => {
  try {
    const now = new Date();
    const expired = await db
      .update(agentApprovalGates)
      .set({ status: "expired", resolvedAt: now })
      .where(and(eq(agentApprovalGates.status, "pending"), lt(agentApprovalGates.expiresAt, now)))
      .returning({ id: agentApprovalGates.id });

    for (const row of expired) {
      gateEmitter.emit(row.id, { approved: false, reason: "expired" });
    }
  } catch {
    // silently ignore cleanup errors
  }
}, 2 * 60 * 1000).unref();

// ── requestApproval ────────────────────────────────────────────────────────────

/**
 * Register a new approval gate. Persists to the DB and returns the gate.
 * Callers should notify the user out-of-band (Discord DM, push, etc.) with
 * the gate ID so they know to approve/reject via the API or app.
 */
export async function requestApproval(req: ApprovalRequest): Promise<ApprovalGate> {
  const id = `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const ttl = req.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttl);

  await db.insert(agentApprovalGates).values({
    id,
    agentId: req.agentId,
    userId: req.userId,
    toolName: req.toolName,
    toolArgs: req.toolArgs,
    description: req.description,
    status: "pending",
    createdAt: now,
    expiresAt,
  });

  logAgentEvent({
    event: "tool_blocked",
    agentId: req.agentId,
    userId: req.userId,
    detail: `gate=${id} tool=${req.toolName}`,
  });

  return {
    id,
    agentId: req.agentId,
    userId: req.userId,
    toolName: req.toolName,
    toolArgs: req.toolArgs,
    description: req.description,
    status: "pending",
    createdAt: now,
    expiresAt,
  };
}

// ── awaitApproval ──────────────────────────────────────────────────────────────

/**
 * Block the calling async context until the gate is approved/rejected or expires.
 * Returns true if approved, false otherwise.
 */
export function awaitApproval(gateId: string, ttlMs?: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = ttlMs ?? DEFAULT_TTL_MS + 5_000;
    const timer = setTimeout(() => {
      gateEmitter.removeAllListeners(gateId);
      resolve(false);
    }, timeout);

    gateEmitter.once(gateId, (result: { approved: boolean }) => {
      clearTimeout(timer);
      resolve(result.approved);
    });
  });
}

// ── approveGate ────────────────────────────────────────────────────────────────

/**
 * Approve a pending gate. Only the gate's owner (userId) may approve.
 * Returns true if the gate was successfully resolved in the DB,
 * false if not found, already resolved, or on DB failure.
 * Events are ONLY emitted after successful durable write — not optimistically.
 */
export async function approveGate(gateId: string, resolvedBy: string): Promise<boolean> {
  const now = new Date();
  try {
    const result = await db.update(agentApprovalGates)
      .set({ status: "approved", resolvedAt: now, resolvedBy })
      .where(and(eq(agentApprovalGates.id, gateId), eq(agentApprovalGates.status, "pending")));
    const rows = result.rowCount ?? 0;
    if (rows === 0) {
      // Gate not found or already resolved — no event emitted
      return false;
    }
    // Only emit AFTER successful DB write
    gateEmitter.emit(gateId, { approved: true });
    logAgentEvent({ event: "tool_approved", agentId: "unknown", userId: resolvedBy, detail: `gate=${gateId}` });
    return true;
  } catch (err) {
    console.error("[AgentApproval] approveGate DB error:", err);
    return false;
  }
}

// ── rejectGate ─────────────────────────────────────────────────────────────────

/**
 * Reject a pending gate. Only the gate's owner (userId) may reject.
 * Returns true if the gate was successfully resolved in the DB,
 * false if not found, already resolved, or on DB failure.
 * Events are ONLY emitted after successful durable write — not optimistically.
 */
export async function rejectGate(gateId: string, resolvedBy: string): Promise<boolean> {
  const now = new Date();
  try {
    const result = await db.update(agentApprovalGates)
      .set({ status: "rejected", resolvedAt: now, resolvedBy })
      .where(and(eq(agentApprovalGates.id, gateId), eq(agentApprovalGates.status, "pending")));
    const rows = result.rowCount ?? 0;
    if (rows === 0) {
      return false;
    }
    // Only emit AFTER successful DB write
    gateEmitter.emit(gateId, { approved: false, reason: "rejected" });
    logAgentEvent({ event: "tool_blocked", agentId: "unknown", userId: resolvedBy, detail: `gate=${gateId} rejected` });
    return true;
  } catch (err) {
    console.error("[AgentApproval] rejectGate DB error:", err);
    return false;
  }
}

// ── getGate ────────────────────────────────────────────────────────────────────

/**
 * Get a gate by ID from the DB. Returns undefined if not found.
 */
export async function getGate(gateId: string): Promise<ApprovalGate | undefined> {
  const rows = await db
    .select()
    .from(agentApprovalGates)
    .where(eq(agentApprovalGates.id, gateId))
    .limit(1);

  return rows[0] ? rowToGate(rows[0]) : undefined;
}

// ── listPendingGates ────────────────────────────────────────────────────────────

/** Return all pending gates for a user (not yet expired/resolved). */
export async function listPendingGates(userId: string): Promise<ApprovalGate[]> {
  const rows = await db
    .select()
    .from(agentApprovalGates)
    .where(and(eq(agentApprovalGates.userId, userId), eq(agentApprovalGates.status, "pending")));
  return rows.map(rowToGate);
}

// ── listAllGates ───────────────────────────────────────────────────────────────

/** Return all gates for a user (any status), most recent first. */
export async function listAllGates(userId: string): Promise<ApprovalGate[]> {
  const { desc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(agentApprovalGates)
    .where(eq(agentApprovalGates.userId, userId))
    .orderBy(desc(agentApprovalGates.createdAt))
    .limit(50);
  return rows.map(rowToGate);
}
