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
  /** Human-readable agent name — optional so the registry works outside named-agent scope. */
  agentName?: string;
  /** User that owns this run — optional for testing and non-user-bound runs. */
  userId?: string;
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

/**
 * Built-in hook priority constants.
 *
 * Execution order: permission check first (200) → approval gate second (100).
 * This intentionally deviates from the original task spec (which suggested
 * approval=100, permission=50) to ensure a disallowed-flagged tool is always
 * hard-blocked before the approval prompt is triggered.
 *
 * Custom handlers should use priority values between 0–99 to run after both
 * built-ins, or values > 200 to run before them.
 */
export const HOOK_PRIORITY = {
  /** Permission check (agentPermissions.ts) — always runs first. */
  PERMISSION: 200,
  /** Approval gate (agentApproval.ts) — runs after permission. */
  APPROVAL: 100,
  /** Default for custom hooks — runs after all built-ins. */
  DEFAULT: 0,
} as const;

export class ToolCallHookRegistry {
  private readonly entries: Array<{
    handler: ToolCallHandler;
    priority: number;
    /** If true, exceptions from this handler are re-thrown (fail-closed). */
    critical: boolean;
  }> = [];

  /**
   * Register a handler. Higher priority runs first.
   * Registration order is preserved within the same priority.
   *
   * @param opts.priority  Execution order — higher runs first. Default: 0.
   * @param opts.critical  If true, unhandled exceptions from this handler are
   *   re-thrown rather than swallowed. Use for security-critical handlers that
   *   cannot tolerate fail-open behavior. Built-in hooks (approval, permission)
   *   manage their own error handling internally and do NOT need this flag.
   */
  register(handler: ToolCallHandler, opts?: { priority?: number; critical?: boolean }): void {
    const priority = opts?.priority ?? 0;
    const critical = opts?.critical ?? false;
    this.entries.push({ handler, priority, critical });
    this.entries.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Run all registered handlers in priority order.
   * Returns the aggregate decision: allowed/blocked and (optionally) rewritten params.
   *
   * Exception policy:
   *   - Non-critical handlers: exceptions are swallowed and the chain continues.
   *     Use this default for logging, analytics, and non-blocking hooks.
   *   - Critical handlers: exceptions are re-thrown and propagate to the caller
   *     (harness.ts), which treats unhandled errors as fail-closed blocks.
   *   - Built-in security hooks (approval, permission): catch their own errors
   *     and return `{ block: true }` explicitly — they do not rely on the
   *     critical flag for their fail-closed behavior.
   */
  async run(ctx: ToolCallHookContext): Promise<ToolCallRunResult> {
    let rewrittenParams = ctx.params;

    for (const { handler, critical } of this.entries) {
      let result: ToolCallHookResult | undefined;
      try {
        result = await handler({ ...ctx, params: rewrittenParams });
      } catch (err) {
        if (critical) {
          // Re-throw: caller (harness.ts) treats unhandled exceptions as fail-closed.
          throw err;
        }
        // Non-critical: log and continue to next handler.
        console.error("[ToolCallHooks] handler threw:", err);
        continue;
      }
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

  // userId is required for the approval DB gate; return false (deny) if absent.
  if (!ctx.userId) {
    console.warn(`[ToolCallHooks] requireApproval: no userId in context for tool=${ctx.toolName} — denying`);
    approval.onResolution?.("deny");
    return false;
  }
  const userId = ctx.userId;
  const agentName = ctx.agentName ?? ctx.agentId;

  try {
    const gate = await requestApproval({
      agentId: ctx.agentId,
      userId,
      toolName: ctx.toolName,
      toolArgs: ctx.params,
      description: approval.description,
      ttlMs: approval.timeoutMs,
      initiatedBy: ctx.initiatedBy,
    });

    // Auto-approved (Jarvis-initiated, non-irreversible tool)
    if (gate.status === "approved") {
      logAgentEvent({
        event: "tool_approved",
        agentId: ctx.agentId,
        userId,
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
        userId,
        `🔐 **Approval Required**\nAgent **${agentName}** wants to run **${ctx.toolName}**.\nTap **Review →** below to approve or decline in your inbox.\n\nGate ID: \`${gate.id}\``,
        { notificationType: "approval_request", gateId: gate.id },
      );
    } catch {
      /* non-blocking: gate still exists even if notification fails */
    }

    logAgentEvent({
      event: "tool_blocked",
      agentId: ctx.agentId,
      userId,
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
