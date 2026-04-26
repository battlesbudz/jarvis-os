/**
 * AgentApproval — approval gate system for destructive / sensitive agent actions.
 *
 * When a tool execution is flagged as requiring approval (based on the agent's
 * permissions AND the risk level of the tool), it is paused and an approval
 * request is surfaced to the user (via Discord DM, Telegram, or mobile push).
 *
 * Approval flow:
 *   1. Tool detects it needs approval → calls requestApproval()
 *   2. requestApproval() returns a token (pending gate)
 *   3. User approves/rejects → approveGate() / rejectGate()
 *   4. Original tool waits on the gate with awaitApproval()
 *
 * Gates are stored in memory (Map) — no DB persistence for now because they are
 * short-lived (TTL: 10 min). If the server restarts the gate is lost and the
 * tool should handle the rejection gracefully.
 */
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
  "daemon_action",     // screen control / app opening
  "browser_navigate",
  "browser_click",
  "browser_type",
  "setup_named_agent", // creating other agents
  "connect_channel",   // new channel connections
]);

/** Return true if this tool requires an approval gate before running. */
export function requiresApproval(toolName: string): boolean {
  return HIGH_RISK_TOOLS.has(toolName);
}

// ── In-memory gate store ───────────────────────────────────────────────────────

const gates = new Map<string, ApprovalGate>();
const gateEmitter = new EventEmitter();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of expired gates (runs every 2 min)
setInterval(() => {
  const now = new Date();
  for (const [id, gate] of gates) {
    if (gate.expiresAt < now && gate.status === "pending") {
      gate.status = "expired";
      gateEmitter.emit(id, { approved: false, reason: "expired" });
    }
    // Remove resolved/expired gates older than 30 min
    if (gate.status !== "pending" && now.getTime() - gate.createdAt.getTime() > 30 * 60 * 1000) {
      gates.delete(id);
    }
  }
}, 2 * 60 * 1000).unref();

// ── requestApproval ────────────────────────────────────────────────────────────

/**
 * Register a new approval gate and return the gate ID.
 * The caller should notify the user out-of-band (Discord DM, push, etc.) with
 * the gate ID and a approve/reject link or command.
 */
export function requestApproval(req: ApprovalRequest): ApprovalGate {
  const id = `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const ttl = req.ttlMs ?? DEFAULT_TTL_MS;

  const gate: ApprovalGate = {
    id,
    agentId: req.agentId,
    userId: req.userId,
    toolName: req.toolName,
    toolArgs: req.toolArgs,
    description: req.description,
    status: "pending",
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttl),
  };

  gates.set(id, gate);
  logAgentEvent({
    event: "approval_gate_triggered",
    agentId: req.agentId,
    userId: req.userId,
    toolName: req.toolName,
    detail: `gateId=${id} tool=${req.toolName}`,
  });

  console.log(`[ApprovalGate] requested: ${id} | agent=${req.agentId} tool=${req.toolName}`);
  return gate;
}

// ── awaitApproval ──────────────────────────────────────────────────────────────

/**
 * Wait for an approval gate to be resolved. Returns true if approved.
 * Rejects the promise if the gate expires or is explicitly rejected.
 *
 * @param gateId - the gate ID from requestApproval()
 * @param timeoutMs - how long to wait (default: gate TTL)
 */
export function awaitApproval(gateId: string, timeoutMs?: number): Promise<boolean> {
  const gate = gates.get(gateId);
  if (!gate) return Promise.reject(new Error(`Gate ${gateId} not found`));

  if (gate.status === "approved") return Promise.resolve(true);
  if (gate.status === "rejected" || gate.status === "expired")
    return Promise.resolve(false);

  const ttl = timeoutMs ?? (gate.expiresAt.getTime() - Date.now());

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      gateEmitter.removeAllListeners(gateId);
      resolve(false);
    }, ttl);

    gateEmitter.once(gateId, ({ approved }: { approved: boolean }) => {
      clearTimeout(timeout);
      resolve(approved);
    });
  });
}

// ── approveGate ────────────────────────────────────────────────────────────────

export function approveGate(gateId: string, resolvedBy: string): boolean {
  const gate = gates.get(gateId);
  if (!gate || gate.status !== "pending") return false;

  gate.status = "approved";
  gate.resolvedAt = new Date();
  gate.resolvedBy = resolvedBy;
  gateEmitter.emit(gateId, { approved: true });
  console.log(`[ApprovalGate] approved: ${gateId} by ${resolvedBy}`);
  return true;
}

// ── rejectGate ─────────────────────────────────────────────────────────────────

export function rejectGate(gateId: string, resolvedBy: string): boolean {
  const gate = gates.get(gateId);
  if (!gate || gate.status !== "pending") return false;

  gate.status = "rejected";
  gate.resolvedAt = new Date();
  gate.resolvedBy = resolvedBy;
  gateEmitter.emit(gateId, { approved: false });
  console.log(`[ApprovalGate] rejected: ${gateId} by ${resolvedBy}`);
  return true;
}

// ── getGate / listPendingGates ─────────────────────────────────────────────────

export function getGate(gateId: string): ApprovalGate | undefined {
  return gates.get(gateId);
}

export function listPendingGates(userId: string): ApprovalGate[] {
  const results: ApprovalGate[] = [];
  for (const gate of gates.values()) {
    if (gate.userId === userId && gate.status === "pending") {
      results.push(gate);
    }
  }
  return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function listAllGates(userId: string, limit = 50): ApprovalGate[] {
  const results: ApprovalGate[] = [];
  for (const gate of gates.values()) {
    if (gate.userId === userId) results.push(gate);
  }
  return results
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}
