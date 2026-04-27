/**
 * ResponseQualityChecker — before_agent_finalize hook.
 *
 * Runs after a named agent produces its first complete reply, but before the
 * result is returned to the channel. Returns `{ action: "finalize" }` to accept
 * the reply as-is, or `{ action: "revise", reason }` to trigger one additional
 * model pass (caller is responsible for the recursion guard).
 *
 * Checks (all conservative — only fires on clear quality signals):
 *
 *   1. Deflection detector  — agent was asked to perform an action (actionable
 *      verb in the message) but used no tools and replied very briefly.
 *   2. Terse response check — reply is extremely short for a detailed question.
 *   3. Apology-only check   — reply is dominated by an apology without substance.
 *
 * The checker is intentionally cheap: no LLM calls, pure string analysis.
 */

export type QualityCheckInput = {
  userMessage: string;
  agentReply: string;
  /** Names / IDs of every tool called during the agent turn. */
  toolsUsed: string[];
  agentId?: string;
  userId?: string;
};

export type QualityCheckResult =
  | { action: "finalize" }
  | { action: "revise"; reason: string };

// Action verbs that suggest the user expects the agent to call a tool.
const ACTION_VERBS = [
  "send", "create", "schedule", "search", "find", "book",
  "add", "delete", "remove", "update", "write", "draft",
  "set", "open", "fetch", "get", "show", "list", "read",
  "check", "look", "make", "build", "run", "start", "stop",
];

// Phrases that dominate an apology-only response.
const APOLOGY_PHRASES = [
  "i apologize",
  "i'm sorry",
  "i cannot",
  "i can't",
  "unfortunately i",
  "i am unable",
  "i am sorry",
];

/**
 * Synchronous quality gate — always fast, never throws.
 *
 * Callers should guard the invocation with `opts.isRevisionPass` so the check
 * only fires once per user turn (preventing infinite revision loops).
 */
export function checkResponseQuality(input: QualityCheckInput): QualityCheckResult {
  const { userMessage, agentReply, toolsUsed } = input;

  // Normalised lower-case copies for pattern matching.
  const lowerMsg = userMessage.toLowerCase();
  const lowerReply = agentReply.toLowerCase().trim();
  const replyWords = agentReply.trim().split(/\s+/).filter(Boolean).length;

  // ── Check 1: Deflection detector ─────────────────────────────────────────────
  // The user message contained an action verb, the agent made no tool calls, and
  // the reply is short (< 40 words). This is the classic "I'll look into that"
  // non-answer pattern.
  const askedForAction = ACTION_VERBS.some((v) => {
    // Word-boundary match: avoid "sender" matching "send", etc.
    const re = new RegExp(`\\b${v}\\b`);
    return re.test(lowerMsg);
  });

  if (askedForAction && toolsUsed.length === 0 && replyWords < 40) {
    return {
      action: "revise",
      reason:
        "The user asked you to perform an action but you didn't use any tools. " +
        "Either complete the task using your available tools, or explain clearly why you cannot.",
    };
  }

  // ── Check 2: Terse response on a detailed question ───────────────────────────
  // The user wrote a long message (> 100 chars) but the agent replied in fewer
  // than 20 words. This usually signals a misread or aborted response.
  if (userMessage.length > 100 && replyWords < 20) {
    return {
      action: "revise",
      reason:
        "Your response is very brief for a detailed question. Please provide a fuller, more helpful answer.",
    };
  }

  // ── Check 3: Apology-only response ───────────────────────────────────────────
  // The reply is dominated by an apology phrase and is short (< 30 words),
  // without any concrete answer or alternative.
  const isApologyDominated =
    APOLOGY_PHRASES.some((p) => lowerReply.includes(p)) && replyWords < 30;

  if (isApologyDominated) {
    return {
      action: "revise",
      reason:
        "Don't just apologise — either complete the request or give a concrete explanation " +
        "of why you can't and what the user can do instead.",
    };
  }

  return { action: "finalize" };
}
