/**
 * Quality Loop — pre-think and post-check bookends for every chat turn.
 *
 * preThink  : asks the orchestrator model for a 1-2 sentence approach note
 *             before the agent runs, so the system prompt carries a clear
 *             directive.
 * postCheck : asks the orchestrator model whether the agent reply addressed the request;
 *             returns { passed, feedback }.  Errors are fail-open (passed=true)
 *             so a provider hiccup never silently drops a user reply.
 *
 * Both calls are capped at 80 output tokens and enforced with a 4-second hard
 * timeout so they never become a bottleneck on the hot path.
 *
 * Codex OAuth models are bypassed here because these checks are optional and
 * daemon-backed Codex turns are a shared foreground runtime; aborting a
 * 4-second quality probe can cancel the runtime the real orchestrator needs.
 */

import { routeModelTurn } from "./modelRouter";
import { isCodexOAuthModel } from "./runtimeModel";

const MAX_TOKENS = 80;
const TIMEOUT_MS = 4000;

export function shouldBypassQualityLoopForModel(model: string | undefined | null): boolean {
  return isCodexOAuthModel(model);
}

/**
 * Run with a linked AbortSignal. Resolves to `fallback` on timeout, abort, or
 * provider error, while cancelling the underlying model request.
 */
function abortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

async function withAbortableTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) return fallback;

  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason ?? abortError("Quality loop aborted by caller"));
  const timeout = setTimeout(() => controller.abort(abortError("Quality loop timed out")), ms);
  timeout.unref?.();
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    return await run(controller.signal);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

/**
 * Ask the orchestrator model for a 1-2 sentence strategy note for this turn.
 * Returns "" on timeout or any error so callers can use it as a no-op.
 */
export async function preThink(
  userMessage: string,
  briefContext: string,
  orchestratorModel: string,
  userId?: string,
  signal?: AbortSignal,
): Promise<string> {
  if (shouldBypassQualityLoopForModel(orchestratorModel)) return "";

  const run = async (runSignal: AbortSignal): Promise<string> => {
    const response = await routeModelTurn({
      tier: "smart",
      requestedModel: orchestratorModel,
      maxCompletionTokens: MAX_TOKENS,
      stream: false,
      toolChoice: "none",
      userId,
      signal: runSignal,
      logPrefix: "[QualityLoop/preThink]",
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
    return (response.textContent ?? "").trim();
  };

  return withAbortableTimeout(run, TIMEOUT_MS, "", signal);
}

export interface PostCheckResult {
  passed: boolean;
  feedback: string;
}

/**
 * Ask the orchestrator model whether the agent reply fully addressed the user's
 * request.  Returns { passed: true, feedback: "" } on timeout or any error so
 * a provider failure never blocks or drops a reply.
 */
export async function postCheck(
  userMessage: string,
  agentReply: string,
  orchestratorModel: string,
  userId?: string,
  signal?: AbortSignal,
): Promise<PostCheckResult> {
  if (shouldBypassQualityLoopForModel(orchestratorModel)) return { passed: true, feedback: "" };

  const run = async (runSignal: AbortSignal): Promise<PostCheckResult> => {
    const response = await routeModelTurn({
      tier: "smart",
      requestedModel: orchestratorModel,
      maxCompletionTokens: MAX_TOKENS,
      stream: false,
      toolChoice: "none",
      userId,
      signal: runSignal,
      logPrefix: "[QualityLoop/postCheck]",
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
    const text = (response.textContent ?? "").trim();
    if (!text) return { passed: true, feedback: "" };
    if (text.toUpperCase().startsWith("PASS")) {
      return { passed: true, feedback: "" };
    }
    const colonIdx = text.indexOf(":");
    const feedback = colonIdx !== -1 ? text.slice(colonIdx + 1).trim() : text;
    return { passed: false, feedback };
  };

  return withAbortableTimeout(run, TIMEOUT_MS, { passed: true, feedback: "" }, signal);
}
