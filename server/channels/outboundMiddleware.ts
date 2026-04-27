/**
 * OutboundMiddlewareRegistry — composable message_sending middleware.
 *
 * Inspired by OpenClaw's `message_sending` hook. Any module can register a
 * handler that transforms or cancels an outbound reply before it reaches the
 * channel. Handlers run in descending priority order and receive a mutable
 * context object (platform, text, agentName…). A handler may:
 *
 *   • Return `{ text: string }` — rewrite the message text; chain continues.
 *   • Return `{ cancel: true }` — suppress delivery entirely.
 *   • Return void / undefined — pass through unchanged.
 *
 * Built-in handlers (registered at the bottom of this file):
 *
 *   Priority 300 — Agent-name prefix (prepends "**AgentName:**" on Discord,
 *                  "AgentName:" on Telegram, only when ctx.agentName is set)
 *   Priority 200 — Length limiter (platform-specific hard caps + truncation notice)
 *   Priority 100 — Trailing-whitespace / excess-newline cleaner
 *   Priority  50 — Empty-reply guard (substitutes a fallback when text is blank)
 *
 * Usage:
 *   import { outboundMiddleware } from "@/channels/outboundMiddleware";
 *   const final = await outboundMiddleware.run({ text, platform, userId, agentId, agentName });
 *   if (final === null) return; // cancelled
 *   await send(final);
 */

// ── Context / Result types ─────────────────────────────────────────────────────

export type OutboundContext = {
  text: string;
  /** Channel platform identifier. */
  platform: "discord" | "telegram" | "in_app" | string;
  userId: string;
  channelId?: string;
  agentId?: string;
  /** When set, the agent-name prefix handler prepends this to the text. */
  agentName?: string;
};

export type OutboundMiddlewareResult =
  | { text: string; cancel?: false }
  | { cancel: true };

export type OutboundMiddlewareHandler = (
  ctx: OutboundContext,
) => Promise<OutboundMiddlewareResult | void> | OutboundMiddlewareResult | void;

// ── Registry ───────────────────────────────────────────────────────────────────

export class OutboundMiddlewareRegistry {
  private readonly handlers: Array<{
    handler: OutboundMiddlewareHandler;
    priority: number;
  }> = [];

  /**
   * Register a middleware handler.
   * Higher priority runs first. Registration order is preserved within priority.
   */
  use(handler: OutboundMiddlewareHandler, opts?: { priority?: number }): void {
    this.handlers.push({ handler, priority: opts?.priority ?? 0 });
    this.handlers.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Run all registered middleware handlers in priority order.
   *
   * Returns the final (possibly rewritten) text, or null if a handler cancelled delivery.
   */
  async run(ctx: OutboundContext): Promise<string | null> {
    let current = ctx.text;
    for (const { handler } of this.handlers) {
      let result: OutboundMiddlewareResult | void;
      try {
        result = await handler({ ...ctx, text: current });
      } catch (err) {
        // Buggy handlers must never crash channel delivery — log and skip.
        console.error("[OutboundMiddleware] handler threw:", err);
        continue;
      }
      if (!result) continue;
      if ("cancel" in result && result.cancel) return null;
      if ("text" in result) current = result.text;
    }
    return current;
  }
}

export const outboundMiddleware = new OutboundMiddlewareRegistry();

// ── Built-in middleware ────────────────────────────────────────────────────────

// Platform hard caps. These reflect single-message limits (Discord 2000 chars,
// Telegram 4096 chars, in-app 8000). We leave a small buffer so appended notices
// fit within the limit comfortably.
const PLATFORM_CHAR_LIMIT: Record<string, number> = {
  discord: 1900,
  telegram: 4000,
  in_app: 8000,
};

// ── Priority 300: Agent-name prefix ────────────────────────────────────────────
// When agentName is provided, prefix it to the reply so multi-agent conversations
// are clearly attributed. Format is platform-specific:
//   Discord: **AgentName:** text  (bold markdown)
//   Telegram: AgentName: text     (plain — Telegram's markdown parsing is unreliable)
//   Others: no prefix
outboundMiddleware.use(
  (ctx) => {
    if (!ctx.agentName || !ctx.text.trim()) return;
    let prefix: string;
    if (ctx.platform === "discord") {
      prefix = `**${ctx.agentName}:** `;
    } else if (ctx.platform === "telegram") {
      prefix = `${ctx.agentName}: `;
    } else {
      return; // in-app and others: no prefix
    }
    return { text: prefix + ctx.text };
  },
  { priority: 300 },
);

// ── Priority 200: Length limiter ────────────────────────────────────────────────
// Hard-caps text at platform limits and appends a truncation notice. This is a
// safety net for platforms with strict character limits; channel-level chunkers
// (sendLong, sendLongMessage) handle graceful multipart delivery within the limit.
outboundMiddleware.use(
  (ctx) => {
    const limit = PLATFORM_CHAR_LIMIT[ctx.platform] ?? 4000;
    if (ctx.text.length <= limit) return;
    const notice = "\n… *(truncated)*";
    return { text: ctx.text.slice(0, limit - notice.length) + notice };
  },
  { priority: 200 },
);

// ── Priority 100: Whitespace cleaner ───────────────────────────────────────────
// Trims leading/trailing whitespace and collapses three or more consecutive
// newlines into two (preserves intentional blank lines without runaway spacing).
outboundMiddleware.use(
  (ctx) => {
    const cleaned = ctx.text.trim().replace(/\n{3,}/g, "\n\n");
    if (cleaned === ctx.text) return;
    return { text: cleaned };
  },
  { priority: 100 },
);

// ── Priority 50: Empty-reply guard ─────────────────────────────────────────────
// If the text is empty after all prior processing, substitute a polite fallback
// rather than sending an empty or whitespace-only message.
outboundMiddleware.use(
  (ctx) => {
    if (ctx.text.trim().length > 0) return;
    return { text: "Sorry, I couldn't generate a response right now." };
  },
  { priority: 50 },
);
