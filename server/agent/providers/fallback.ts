/**
 * Provider fallback chain - automatic retry on a backup model when the
 * primary provider returns a retriable error (5xx, 429, timeout, etc.).
 *
 * Usage (harness):
 *   const result = await queryWithFallback(
 *     [
 *       { providerName: "claude", model: "claude-opus-4-7" },   // primary (orchestrator)
 *       { providerName: "openai", model: "gpt-4.1-mini" }, // backup (subagent tier)
 *     ],
 *     queryParams,
 *     "[Discord/Agent]",   // log prefix for observability
 *   );
 *
 * Configuration:
 *   - Per-run: pass `providerFallbackChain` + optional `providerFallbackModels`
 *              in RunAgentOptions.
 *   - Global:  set PROVIDER_FALLBACK_CHAIN env var (comma-separated, e.g.
 *              "openai,claude" or with explicit models "openai:gpt-4o,claude:claude-3-5-sonnet-20241022")
 *              When set, every runAgent call implicitly uses this chain unless
 *              the caller provides its own.
 *
 * The feature is opt-in and off by default - if neither the env var nor the
 * per-run option is set the harness behaves exactly as before.
 */

import type { ProviderQueryParams, ProviderTurnResult } from "./base";
import { accumulateTurn } from "./base";
import { getProvider } from "./index";
import type { ProviderName } from "./index";

/**
 * Default model string used when a fallback chain entry does not specify one.
 * These are conservative, broadly-capable models that are safe defaults for
 * cross-provider fallback scenarios.
 */
export const DEFAULT_PROVIDER_MODELS: Record<ProviderName, string> = {
  claude: "claude-opus-4-7",
  openai: "gpt-4.1-mini",
  "openai-compatible": "modelrelay/auto-fastest",
};

/**
 * A single entry in the provider fallback chain.
 * Each entry carries both the provider name and the model string to use
 * with that provider, since model namespaces are provider-specific
 * (e.g. "gpt-4o" is only valid for OpenAI, "claude-*" only for Anthropic).
 */
export interface FallbackChainEntry {
  providerName: ProviderName;
  /** Model string forwarded to this provider's query() call. */
  model: string;
}

/**
 * Returns true for errors that warrant trying a backup provider:
 *   - HTTP 5xx (provider-side outage / maintenance)
 *   - HTTP 429 (rate-limit / quota exceeded)
 *   - Network-level timeouts and connection failures
 *
 * 4xx client errors (400 Bad Request, 401 Unauthorized, etc.) are NOT
 * retriable - a different provider would see the same failure.
 */
export function isRetriableProviderError(err: unknown): boolean {
  // Check numeric `.status` property emitted by OpenAI / Anthropic SDKs
  const anyErr = err as Record<string, unknown>;
  if (typeof anyErr.status === "number") {
    const s = anyErr.status as number;
    if (s === 429 || (s >= 500 && s < 600)) return true;
  }

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Numeric status codes embedded in the error message
  if (/\b(500|502|503|504|529)\b/.test(msg)) return true;
  if (/\b429\b/.test(msg)) return true;

  // Textual signals common across provider SDKs
  const retriableTerms = [
    "rate limit",
    "rate_limit",
    "ratelimit",
    "quota exceeded",
    "exceeded your current quota",
    "insufficient_quota",
    "too many requests",
    "timeout",
    "timed out",
    "econnrefused",
    "econnreset",
    "network error",
    "service unavailable",
    "overloaded",
    "bad gateway",
    "internal server error",
    "upstream error",
  ];
  if (retriableTerms.some((t) => lower.includes(t))) return true;

  return false;
}

const KNOWN_PROVIDERS: ProviderName[] = ["openai", "claude", "openai-compatible"];

/**
 * Reads PROVIDER_FALLBACK_CHAIN from the environment and returns an ordered
 * list of FallbackChainEntry values, or null when the variable is absent or
 * results in fewer than 2 valid entries.
 *
 * Formats accepted:
 *   "openai,claude"
 *      -> uses DEFAULT_PROVIDER_MODELS for model strings
 *   "claude:claude-opus-4-7,openai:gpt-4.1-mini"
 *      -> uses explicit model strings
 *   Mixed: "claude,openai:gpt-4o-mini"
 *      -> first entry uses the default, second uses the explicit model
 *
 * Unknown provider names are silently dropped so a misconfigured env var
 * does not crash the server.
 */
export function getGlobalFallbackChain(): FallbackChainEntry[] | null {
  const raw = process.env.PROVIDER_FALLBACK_CHAIN;
  if (!raw || raw.trim() === "") return null;

  const entries: FallbackChainEntry[] = [];
  for (const segment of raw.split(",")) {
    const [providerRaw, modelRaw] = segment.trim().split(":");
    const providerName = providerRaw?.trim().toLowerCase();
    if (!KNOWN_PROVIDERS.includes(providerName as ProviderName)) continue;
    const model =
      modelRaw?.trim() || DEFAULT_PROVIDER_MODELS[providerName as ProviderName];
    entries.push({ providerName: providerName as ProviderName, model });
  }

  return entries.length >= 2 ? entries : null;
}

/**
 * Runs a provider query using the first entry in `chain`.
 * On a retriable error, falls back to the next entry in the chain and
 * logs the event for observability.
 *
 * Each chain entry carries its own model string so cross-provider fallback
 * always sends a model ID that the receiving provider understands
 * (e.g. the OpenAI primary uses "gpt-4o"; the Claude backup uses
 * "claude-3-5-sonnet-20241022", not "gpt-4o").
 *
 * Non-retriable errors (client 4xx, AbortError, etc.) propagate immediately
 * without trying further providers - they would fail on any provider.
 *
 * @param chain      Ordered provider entries to try (primary first).
 * @param params     Base query parameters. `model` is overridden per entry.
 * @param logPrefix  Prefix for console output (e.g. "[Discord/Agent]").
 */
export async function queryWithFallback(
  chain: FallbackChainEntry[],
  params: ProviderQueryParams,
  logPrefix: string,
): Promise<ProviderTurnResult> {
  if (chain.length === 0) {
    throw new Error(`${logPrefix} provider fallback chain is empty`);
  }

  let lastError: unknown;

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const isFallback = i > 0;

    if (isFallback) {
      const prev = chain[i - 1];
      const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
      console.warn(
        `${logPrefix} provider_fallback: primary=${prev.providerName}(${prev.model}) failed ` +
          `with retriable error - retrying on fallback=${entry.providerName}(${entry.model}). ` +
          `Error: ${errMsg.slice(0, 200)}`,
      );
    } else {
      console.log(`${logPrefix} provider=${entry.providerName} model=${entry.model}`);
    }

    try {
      const provider = getProvider(entry.providerName);
      // Override `params.model` with the model string for this specific provider.
      // Model namespaces are provider-specific: OpenAI accepts "gpt-*",
      // Anthropic accepts "claude-*". Cross-provider fallback MUST remap the model.
      const result = await accumulateTurn(provider.query({ ...params, model: entry.model }));

      if (isFallback) {
        console.log(
          `${logPrefix} provider_fallback: fallback=${entry.providerName}(${entry.model}) succeeded`,
        );
      }

      return result;
    } catch (err) {
      lastError = err;

      // AbortError - caller cancelled the run; do not try further providers.
      if (err instanceof Error && err.name === "AbortError") {
        throw err;
      }

      const hasMore = i < chain.length - 1;
      if (hasMore && isRetriableProviderError(err)) {
        // Retriable - try the next provider in the chain.
        continue;
      }

      // Last provider or non-retriable error - propagate.
      throw err;
    }
  }

  // Should be unreachable, but TypeScript needs a return path.
  throw lastError;
}
