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
import { toolCallHooks, HOOK_PRIORITY } from "./toolCallHooks";
import { evaluatePolicyForTool } from "./agentPolicyManager";

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
  /** Whether this action was initiated by the user or by Jarvis autonomously */
  initiatedBy?: 'user' | 'jarvis';
}

// ── Tools that always require approval ────────────────────────────────────────
// Any tool in this set triggers a user approval gate before execution.
// Categories covered:
//   EMAIL          — any outbound email action or draft creation
//   PUBLIC POSTING — Discord/Slack/Telegram posts, general messaging
//   VOICE / CALL   — TTS speech or direct call to user
//   MEMORY CLEAR   — permanent deletion of agent or global memories
//   BROWSER        — headless browser actions (navigate, click, fill, submit)
//   FILESYSTEM     — creating/uploading/deleting files or Drive documents
//   AGENT MGMT     — creating new sub-agents or assigning channels
//   DAEMON         — any OS-level system action via the daemon bridge

const HIGH_RISK_TOOLS = new Set([
  // Email
  "send_email",
  "gmail_action",
  "gmail_draft",
  // Public posting / messaging
  "discord_post",
  "connect_channel",
  "sessions_send",
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
]);

/** Return true if this tool requires an approval gate before running. */
export function requiresApproval(toolName: string): boolean {
  return HIGH_RISK_TOOLS.has(toolName);
}

/**
 * Tools that must ALWAYS wait for human approval, even when Jarvis is the
 * initiator.  Everything else in HIGH_RISK_TOOLS can be auto-approved when
 * `initiatedBy === 'jarvis'`.
 *
 * Criteria: external side-effects that cannot be undone (sending messages /
 * emails to other people, OS-level actions, live voice calls).
 */
export const STRICTLY_IRREVERSIBLE_TOOLS = new Set([
  "send_email",
  "gmail_action",
  "daemon_action",
  "discord_post",
  "speak",
  "sessions_send",
]);

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
const _cleanupTimer = setInterval(async () => {
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
}, 2 * 60 * 1000);
if (typeof (_cleanupTimer as unknown as { unref?: () => void }).unref === "function") {
  (_cleanupTimer as unknown as { unref: () => void }).unref();
}

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

  const isJarvisInitiated = req.initiatedBy === 'jarvis';
  const isStrictlyIrreversible = STRICTLY_IRREVERSIBLE_TOOLS.has(req.toolName);

  // ── Per-agent policy check ────────────────────────────────────────────────
  // Evaluate custom policy BEFORE applying global defaults. The policy can
  // force auto-approve (permissive, allowlist hit) or force require-approval
  // (strict) regardless of the global Jarvis-initiated logic.
  let autoApprove = isJarvisInitiated && !isStrictlyIrreversible;
  let policyApplied = "global";
  try {
    const decision = await evaluatePolicyForTool(req.agentId, req.toolName, isStrictlyIrreversible);
    if (decision.action === "auto_approve") {
      autoApprove = true;
      policyApplied = decision.reason;
    } else if (decision.action === "require_approval") {
      autoApprove = false;
      policyApplied = decision.reason;
    }
    // "use_global" → leave autoApprove as computed above
  } catch {
    // Policy check failure is non-blocking — fall through to global logic
  }

  await db.insert(agentApprovalGates).values({
    id,
    agentId: req.agentId,
    userId: req.userId,
    toolName: req.toolName,
    toolArgs: req.toolArgs,
    description: req.description,
    status: autoApprove ? "approved" : "pending",
    initiatedBy: req.initiatedBy ?? "user",
    createdAt: now,
    expiresAt,
    ...(autoApprove ? { resolvedAt: now, resolvedBy: autoApprove && policyApplied !== "global" ? `policy:${policyApplied}` : "jarvis_triage" } : {}),
  });

  // Only create a deliverable for gates that require user review.
  // Auto-approved (Jarvis-initiated) gates are silently resolved — no inbox item created.
  if (!autoApprove) {
    try {
      const schema = await import("@shared/schema");
      await db.insert(schema.deliverables).values({
        userId: req.userId,
        agentType: "named_agent",
        type: "approval_gate",
        title: `Approve: ${req.toolName}`,
        summary: req.description,
        body: req.description,
        meta: {
          gateId: id,
          agentId: req.agentId,
          toolName: req.toolName,
          toolArgs: req.toolArgs as Record<string, unknown>,
          initiatedBy: req.initiatedBy ?? "user",
          policyApplied,
        },
        status: "pending_approval",
        triageStatus: "needs_attention",
      });
    } catch (delivErr) {
      // Non-fatal: gate still exists and is visible via /api/agents/approvals
      console.warn("[AgentApproval] failed to create deliverable for gate:", delivErr);
    }
  }

  if (autoApprove) {
    logAgentEvent({
      event: "tool_approved",
      agentId: req.agentId,
      userId: req.userId,
      detail: `gate=${id} tool=${req.toolName} auto-approved policy=${policyApplied}`,
    });
    // Fire approval event after current call stack unwinds so awaitApproval()
    // has time to register its listener first.
    setImmediate(() => {
      gateEmitter.emit(id, { approved: true });
    });
  } else {
    logAgentEvent({
      event: "tool_blocked",
      agentId: req.agentId,
      userId: req.userId,
      detail: `gate=${id} tool=${req.toolName}`,
    });
  }

  return {
    id,
    agentId: req.agentId,
    userId: req.userId,
    toolName: req.toolName,
    toolArgs: req.toolArgs,
    description: req.description,
    status: autoApprove ? "approved" : "pending",
    createdAt: now,
    expiresAt,
  };
}

// ── awaitApproval ──────────────────────────────────────────────────────────────

/**
 * Block the calling async context until the gate is approved/rejected or expires.
 * Returns true if approved, false otherwise.
 *
 * When an AbortSignal is provided, the gate resolves immediately with false
 * (denied) as soon as the signal fires — e.g. when the user stops the run.
 */
export function awaitApproval(gateId: string, ttlMs?: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const timeout = ttlMs ?? DEFAULT_TTL_MS + 5_000;

    const cleanup = (result: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      gateEmitter.removeAllListeners(gateId);
      resolve(result);
    };

    const timer = setTimeout(() => cleanup(false), timeout);

    const onAbort = () => cleanup(false);
    signal?.addEventListener("abort", onAbort, { once: true });

    gateEmitter.once(gateId, (result: { approved: boolean }) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
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
    // Enforce owner-only at the data layer: WHERE id=? AND user_id=? AND status='pending'
    // This makes the function safe for internal callers too, not just the route layer.
    const result = await db.update(agentApprovalGates)
      .set({ status: "approved", resolvedAt: now, resolvedBy })
      .where(
        and(
          eq(agentApprovalGates.id, gateId),
          eq(agentApprovalGates.userId, resolvedBy),
          eq(agentApprovalGates.status, "pending"),
        ),
      );
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
    // Enforce owner-only at the data layer: WHERE id=? AND user_id=? AND status='pending'
    const result = await db.update(agentApprovalGates)
      .set({ status: "rejected", resolvedAt: now, resolvedBy })
      .where(
        and(
          eq(agentApprovalGates.id, gateId),
          eq(agentApprovalGates.userId, resolvedBy),
          eq(agentApprovalGates.status, "pending"),
        ),
      );
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

// ── Built-in hook: approval gate (priority 100) ────────────────────────────────
//
// Registers the existing HIGH_RISK_TOOLS check as a `toolCallHooks` handler so
// the approval gate is part of the composable hook chain. The hook returns
// `requireApproval` for any tool in HIGH_RISK_TOOLS; the registry's
// `runApprovalFlow` then handles the DB gate, user notification, and await.
//
// PRIORITY NOTE: Priority 100 is intentionally below the permission hook (200)
// in agentPermissions.ts. Execution order: permission check first (200) → approval
// gate second (100). This ensures a tool blocked by permission flags never
// generates a spurious approval prompt — the permission hook short-circuits first.
// The task spec originally suggested priority 100 for approval and 50 for
// permission; those numbers were deliberately swapped to enforce this invariant.
//
// Note: `toolCallHooks.ts` calls `requestApproval` / `awaitApproval` from this
// file via dynamic import, intentionally breaking the circular dependency at
// module-load time.

toolCallHooks.register(
  (ctx) => {
    if (!requiresApproval(ctx.toolName)) return undefined;
    return {
      requireApproval: {
        title: `Approve: ${ctx.toolName}`,
        description: `Agent "${ctx.agentName}" wants to run tool: ${ctx.toolName}`,
        severity: "info" as const,
        timeoutMs: 10 * 60 * 1000,
      },
    };
  },
  { priority: HOOK_PRIORITY.APPROVAL },
);
