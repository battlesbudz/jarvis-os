/**
 * Provider registry — factory + instance cache for model providers.
 *
 * Usage:
 *   const provider = getProvider("openai");
 *   const result  = await accumulateTurn(provider.query({ ... }));
 *
 * Adding a new provider:
 *   1. Implement BaseProvider in a new file (e.g. providers/gemini.ts)
 *   2. Add an entry to PROVIDER_FACTORIES below.
 *   No changes to harness.ts or any other caller are required.
 */

import { BaseProvider, accumulateTurn } from "./base";
import { OpenAIProvider } from "./openai";
import { ClaudeProvider } from "./claude";

export type ProviderName = "openai" | "claude";

type ProviderFactory = () => BaseProvider;

const PROVIDER_FACTORIES: Record<ProviderName, ProviderFactory> = {
  openai: () => new OpenAIProvider(),
  claude: () => new ClaudeProvider(),
};

// Singleton instance cache — one instance per provider name per process.
const instanceCache = new Map<ProviderName, BaseProvider>();

/**
 * Returns a cached provider instance for the given name.
 *
 * @throws if `name` is not a known provider.
 */
export function getProvider(name: ProviderName): BaseProvider {
  if (instanceCache.has(name)) {
    return instanceCache.get(name)!;
  }

  const factory = PROVIDER_FACTORIES[name];
  if (!factory) {
    throw new Error(
      `Unknown provider: "${name}". Available: ${Object.keys(PROVIDER_FACTORIES).join(", ")}`,
    );
  }

  const instance = factory();
  instanceCache.set(name, instance);
  return instance;
}

export { BaseProvider, accumulateTurn };
export type { ProviderQueryParams, ProviderTurnResult, ProviderChunk } from "./base";
export {
  queryWithFallback,
  isRetriableProviderError,
  getGlobalFallbackChain,
  DEFAULT_PROVIDER_MODELS,
} from "./fallback";
export type { FallbackChainEntry } from "./fallback";
