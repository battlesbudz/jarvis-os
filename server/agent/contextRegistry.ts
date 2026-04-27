/**
 * ContextRegistry — before_prompt_build hook system.
 *
 * Inspired by OpenClaw's `before_prompt_build` hook. Any module can register a
 * "context provider" that contributes text to the agent prompt before each model
 * call. Providers run in descending priority order and each has a 2-second
 * individual timeout so a slow provider can never block the whole turn.
 *
 * Provider output shapes:
 *   systemContext   — appended to the system prompt body.
 *   prependContext  — prepended before the user message.
 *   appendContext   — appended after the user message.
 *
 * Built-in providers (registered at the bottom of this file):
 *   Priority 200 — Date/time header ("Today is Monday, April 27 2026.")
 *
 * External providers (registered from their own modules on import):
 *   Priority 150 — Calendar context   (server/agent/providers/calendarContext.ts)
 *   Priority 100 — Workspace topic     (server/agent/providers/topicContext.ts)
 *
 * Usage (in runCoachAgent / runNamedAgent):
 *   import { contextRegistry } from "./contextRegistry";
 *   const ctx = await contextRegistry.build({ userId, platform, channelId, agentId, userMessage });
 *   // Inject ctx.systemContext into the system prompt.
 *   // Prepend ctx.prependContext + append ctx.appendContext to userMessage.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type ContextProviderInput = {
  userId: string;
  /** Normalised platform identifier — e.g. "discord", "telegram", "in_app". */
  platform: string;
  channelId?: string;
  agentId?: string;
  userMessage: string;
};

export type ContextProviderOutput = {
  /** Injected into the system prompt body (between persona and user message). */
  systemContext?: string;
  /** Prepended before the user message string. */
  prependContext?: string;
  /** Appended after the user message string. */
  appendContext?: string;
};

export type ContextProvider = (
  input: ContextProviderInput,
) => Promise<ContextProviderOutput | void> | ContextProviderOutput | void;

// Per-provider timeout in milliseconds. Slow providers are silently skipped.
const PROVIDER_TIMEOUT_MS = 2_000;

// ── Registry ───────────────────────────────────────────────────────────────────

class ContextRegistry {
  private readonly providers: Array<{
    provider: ContextProvider;
    priority: number;
  }> = [];

  /**
   * Register a context provider. Higher priority runs first.
   * Registration order is stable within the same priority level.
   */
  register(provider: ContextProvider, opts?: { priority?: number }): void {
    this.providers.push({ provider, priority: opts?.priority ?? 0 });
    this.providers.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Run all registered providers and assemble their output into three context blocks.
   *
   * Each provider has an individual 2-second timeout. Providers that throw or
   * time out are skipped silently — they must never crash the agent turn.
   */
  async build(input: ContextProviderInput): Promise<{
    systemContext: string;
    prependContext: string;
    appendContext: string;
  }> {
    const parts = {
      systemContext: [] as string[],
      prependContext: [] as string[],
      appendContext: [] as string[],
    };

    for (const { provider } of this.providers) {
      try {
        const timeout = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("context provider timeout")), PROVIDER_TIMEOUT_MS),
        );
        const result = await Promise.race([
          Promise.resolve(provider(input)),
          timeout,
        ]) as ContextProviderOutput | void;

        if (!result) continue;
        if (result.systemContext?.trim()) parts.systemContext.push(result.systemContext.trim());
        if (result.prependContext?.trim()) parts.prependContext.push(result.prependContext.trim());
        if (result.appendContext?.trim()) parts.appendContext.push(result.appendContext.trim());
      } catch (err) {
        // Timeout or provider error — skip silently.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "context provider timeout") {
          console.warn("[ContextRegistry] provider skipped due to error:", msg);
        }
      }
    }

    return {
      systemContext: parts.systemContext.join("\n\n"),
      prependContext: parts.prependContext.join("\n"),
      appendContext: parts.appendContext.join("\n"),
    };
  }
}

export const contextRegistry = new ContextRegistry();

// ── Built-in providers ─────────────────────────────────────────────────────────

// ── Priority 200: Date/time header ─────────────────────────────────────────────
// Injects a concise "Today is…" line into every system prompt so agents always
// have the current date regardless of which channel they are running on.
// Note: runCoachAgent already injects a richer date header (with timezone and
// day-of-week). This provider exists as a fallback for named agents that do not
// go through the coach pipeline.
contextRegistry.register(
  () => ({
    systemContext: `Today is ${new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}.`,
  }),
  { priority: 200 },
);
