/**
 * Quality Loop — pre-think and post-check bookends for every chat turn.
 *
 * preThink  : asks Claude Opus for a 1-2 sentence approach note before the
 *             OpenAI agent runs, so the system prompt carries a clear directive.
 * postCheck : asks Claude Opus whether the agent reply addressed the request;
 *             returns { passed, feedback }.  Errors are fail-open (passed=true)
 *             so a broken Anthropic call never silently drops a user reply.
 *
 * Both calls are capped at 80 output tokens and enforced with a 4-second hard
 * timeout so they never become a bottleneck on the hot path.
 */

import { anthropic } from "../lib/anthropicClient";

const MAX_TOKENS = 80;
const TIMEOUT_MS = 4000;

/**
 * Wrap a promise with a hard timeout.  Resolves to `fallback` when the timeout
 * fires — the original promise is not cancelled (fire-and-forget).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Ask the orchestrator model for a 1-2 sentence strategy note for this turn.
 * Returns "" on timeout or any error so callers can use it as a no-op.
 */
export async function preThink(
  userMessage: string,
  briefContext: string,
  orchestratorModel: string,
): Promise<string> {
  const run = async (): Promise<string> => {
    const msg = await anthropic.messages.create({
      model: orchestratorModel,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content:
            `Context: ${briefContext}\n\nUser message: ${userMessage}\n\n` +
            `In 1-2 sentences, describe the best approach to answering this message. ` +
            `Be concise and specific — this note will guide the AI agent's reply.`,
        },
      ],
    });
    const block = msg.content[0];
    return block.type === "text" ? block.text.trim() : "";
  };

  try {
    return await withTimeout(run(), TIMEOUT_MS, "");
  } catch {
    return "";
  }
}

export interface PostCheckResult {
  passed: boolean;
  feedback: string;
}

/**
 * Ask the orchestrator model whether the agent reply fully addressed the user's
 * request.  Returns { passed: true, feedback: "" } on timeout or any error so
 * a broken Anthropic call never blocks or drops a reply.
 */
export async function postCheck(
  userMessage: string,
  agentReply: string,
  orchestratorModel: string,
): Promise<PostCheckResult> {
  const run = async (): Promise<PostCheckResult> => {
    const msg = await anthropic.messages.create({
      model: orchestratorModel,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content:
            `User asked: "${userMessage}"\n\nAgent replied: "${agentReply}"\n\n` +
            `Did the agent fully address the user's request? ` +
            `Reply with exactly one line: PASS or FAIL: <one-sentence reason>.`,
        },
      ],
    });
    const block = msg.content[0];
    if (block.type !== "text") return { passed: true, feedback: "" };
    const text = block.text.trim();
    if (text.toUpperCase().startsWith("PASS")) {
      return { passed: true, feedback: "" };
    }
    const colonIdx = text.indexOf(":");
    const feedback = colonIdx !== -1 ? text.slice(colonIdx + 1).trim() : text;
    return { passed: false, feedback };
  };

  try {
    return await withTimeout(run(), TIMEOUT_MS, { passed: true, feedback: "" });
  } catch {
    return { passed: true, feedback: "" };
  }
}
