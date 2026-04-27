/**
 * ToolCallHookRegistry — composable before_tool_call hook system.
 *
 * Inspired by OpenClaw's `before_tool_call` hook. Any module can register a
 * handler that inspects an upcoming tool call and returns one of:
 *   • { block: true, blockReason? }   — cancel the call; model sees a refusal
 *   • { params: {...} }               — silently rewrite tool parameters
 *   • { requireApproval: {...} }      — pause and ask the user to approve/reject
 *   • undefined                       — pass through to the next handler
 *
 * Handlers run in descending priority order. A terminal decision (block or
 * requireApproval) stops the chain. Parameter rewrites accumulate across all
 * handlers.
 *
 * The singleton `toolCallHooks` is imported by feature modules that register
 * built-in handlers at module-load time (agentApproval.ts, agentPermissions.ts).
 * `runNamedAgent` calls `toolCallHooks.run()` in its `onBeforeTool` callback.
 */

// ── Context ────────────────────────────────────────────────────────────────────

export type ToolCallHookContext = {
  toolName: string;
  params: Record<string, unknown>;
  agentId: string;
  agentName: string;
  userId: string;
  platform?: string;
  channelId?: string;
  /** Who initiated the agent run — used for auto-approval of Jarvis-to-Jarvis calls. */
  initiatedBy?: "user" | "jarvis";
  /** AbortSignal from the parent run — approval waiter respects cancellation. */
  signal?: AbortSignal;
};

// ── Handler return types ───────────────────────────────────────────────────────

export type ToolCallHookResult = {
  block?: boolean;
  blockReason?: string;
  params?: Record<string, unknown>;
  requireApproval?: {
    title: string;
    description: string;
    severity?: "info" | "warning" | "critical";
    /** TTL in ms (default: 10 min). */
    timeoutMs?: number;
    /**
     * Fired after the user resolves the approval gate.
     * Note: "timeout" is currently not distinguished from "deny" — awaitApproval
     * returns a boolean and cannot distinguish user rejection from TTL expiry.
     * Both cases emit "deny". Distinguishing them requires an awaitApproval
     * signature change (future enhancement).
     */
    onResolution?: (decision: "allow" | "deny" | "timeout") => void;
  };
};

export type ToolCallHandler = (
  ctx: ToolCallHookContext,
) => Promise<ToolCallHookResult | undefined> | ToolCallHookResult | undefined;

// ── Run result ─────────────────────────────────────────────────────────────────

export type ToolCallRunResult = {
  /** Whether the tool call is allowed to proceed. */
  allowed: boolean;
  /** Human-readable reason when allowed=false. */
  reason?: string;
  /** Rewritten params to use instead of the original (when allowed=true). */
  params?: Record<string, unknown>;
};

// ── Registry ───────────────────────────────────────────────────────────────────

export class ToolCallHookRegistry {
  private readonly entries: Array<{ handler: ToolCallHandler; priority: number }> = [];

  /**
   * Register a handler. Higher priority runs first.
   * Registration order is preserved within the same priority.
   */
  register(handler: ToolCallHandler, opts?: { priority?: number }): void {
    const priority = opts?.priority ?? 0;
    this.entries.push({ handler, priority });
    this.entries.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Run all registered handlers in priority order.
   * Returns the aggregate decision: allowed/blocked and (optionally) rewritten params.
   */
  async run(ctx: ToolCallHookContext): Promise<ToolCallRunResult> {
    let rewrittenParams = ctx.params;

    for (const { handler } of this.entries) {
      let result: ToolCallHookResult | undefined;
      try {
        result = await handler({ ...ctx, params: rewrittenParams });
      } catch (err) {
        // Buggy handlers must not crash the agent turn — log and skip.
        console.error("[ToolCallHooks] handler threw:", err);
        continue;
      }

      // Handler-level exceptions above are swallowed and treated as pass-through
      // (fail-open per-handler). This is intentional: non-critical hooks (logging,
      // analytics) should not crash agent runs. Security-critical hooks (approval,
      // permission) must never rely on exception-based blocking — they catch their
      // own errors and return { block: true } explicitly so they remain fail-closed.
      if (!result) continue;

      // Terminal: block
      if (result.block) {
        return {
          allowed: false,
          reason: result.blockReason ?? "This action is not permitted",
        };
      }

      // Terminal: require approval
      // Use the accumulated rewrittenParams (not original ctx.params) so any
      // earlier param-rewrite handlers are preserved in the approval context.
      if (result.requireApproval) {
        const approvalCtx = rewrittenParams !== ctx.params
          ? { ...ctx, params: rewrittenParams }
          : ctx;
        const allowed = await runApprovalFlow(approvalCtx, result.requireApproval);
        return {
          allowed,
          reason: allowed ? undefined : "User did not approve this action",
          // Propagate rewritten params even when going through approval
          params: allowed ? rewrittenParams : undefined,
        };
      }

      // Non-terminal: param rewrite — accumulate for subsequent handlers
      if (result.params) {
        rewrittenParams = result.params;
      }
    }

    return { allowed: true, params: rewrittenParams };
  }
}

// ── Approval flow (mechanics) ──────────────────────────────────────────────────

/**
 * Handle the `requireApproval` path: create a DB gate, notify the user,
 * and await their decision. Uses dynamic imports to avoid circular deps
 * (agentApproval.ts imports toolCallHooks.ts; toolCallHooks.ts imports
 * agentApproval.ts only at runtime here).
 */
async function runApprovalFlow(
  ctx: ToolCallHookContext,
  approval: NonNullable<ToolCallHookResult["requireApproval"]>,
): Promise<boolean> {
  const { requestApproval, awaitApproval } = await import("./agentApproval");
  const { logAgentEvent } = await import("./agentLogger");

  try {
    const gate = await requestApproval({
      agentId: ctx.agentId,
      userId: ctx.userId,
      toolName: ctx.toolName,
      toolArgs: ctx.params,
      description: approval.description,
      ttlMs: approval.timeoutMs ?? 10 * 60 * 1000,
      initiatedBy: ctx.initiatedBy,
    });

    // Auto-approved (Jarvis-initiated, non-irreversible tool)
    if (gate.status === "approved") {
      logAgentEvent({
        event: "tool_approved",
        agentId: ctx.agentId,
        userId: ctx.userId,
        toolName: ctx.toolName,
        detail: `gate=${gate.id} auto-approved`,
      });
      approval.onResolution?.("allow");
      return true;
    }

    // Notify user in-app
    try {
      const { inAppChannel } = await import("../channels/inAppChannel");
      await inAppChannel.sendMessage(
        ctx.userId,
        `🔐 **Approval Required**\nAgent **${ctx.agentName}** wants to run **${ctx.toolName}**.\nApprove or reject in the Agents → Approvals tab.\n\nGate ID: \`${gate.id}\``,
        { notificationType: "approval_request" },
      );
    } catch {
      /* non-blocking: gate still exists even if notification fails */
    }

    logAgentEvent({
      event: "tool_blocked",
      agentId: ctx.agentId,
      userId: ctx.userId,
      toolName: ctx.toolName,
      detail: `gate=${gate.id} awaiting user approval`,
    });

    const approved = await awaitApproval(gate.id, approval.timeoutMs, ctx.signal);

    approval.onResolution?.(approved ? "allow" : "deny");

    if (approved) {
      logAgentEvent({
        event: "tool_approved",
        agentId: ctx.agentId,
        userId: ctx.userId,
        toolName: ctx.toolName,
        detail: `gate=${gate.id} approved by user`,
      });
    }

    return approved;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ToolCallHooks] approval gate error for ${ctx.toolName}:`, err);
    // Fail closed: if the approval machinery itself breaks, block the tool.
    approval.onResolution?.("deny");
    return false;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const toolCallHooks = new ToolCallHookRegistry();
