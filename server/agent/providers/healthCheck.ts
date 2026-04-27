/**
 * Provider health check — smoke-tests ClaudeProvider and OpenAIProvider at
 * startup (and on demand via the admin route) to catch broken integrations
 * before they silently fail during a real user turn.
 *
 * Strategy:
 *   Each check instantiates the real provider class (which reads env vars and
 *   creates the SDK client) then injects a lightweight mock transport so we
 *   exercise the full conversion + accumulation pipeline without making a
 *   real API call or incurring cost.
 *
 *   A real API key must still be present in the environment — if it is missing
 *   the SDK constructor will throw, which is exactly the kind of misconfiguration
 *   this check is designed to catch.
 */

import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";
import { accumulateTurn } from "./base";
import type { ProviderQueryParams, ProviderTurnResult } from "./base";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProviderHealthResult {
  provider: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  result?: Pick<ProviderTurnResult, "textContent" | "finishReason">;
}

export interface ProviderHealthReport {
  checkedAt: string;
  allOk: boolean;
  results: ProviderHealthResult[];
}

// ── Shared smoke-test params ───────────────────────────────────────────────────

const SMOKE_PARAMS: ProviderQueryParams = {
  model: "smoke-test",
  messages: [{ role: "user", content: "ping" }],
  toolChoice: "none",
  maxCompletionTokens: 16,
  stream: false,
};

// ── Individual provider checks ─────────────────────────────────────────────────

async function checkClaude(): Promise<ProviderHealthResult> {
  const providerName = "ClaudeProvider";
  const t0 = Date.now();
  try {
    const provider = new ClaudeProvider() as unknown as {
      _completeTurn(params: ProviderQueryParams): AsyncGenerator<import("./base").ProviderChunk>;
      client: {
        messages: {
          create(req: unknown, opts?: unknown): Promise<unknown>;
        };
      };
    };

    provider.client = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "pong" }],
          stop_reason: "end_turn",
        }),
      },
    };

    const result = await accumulateTurn(provider._completeTurn(SMOKE_PARAMS));

    if (!result.textContent && result.toolCallList.length === 0) {
      return {
        provider: providerName,
        ok: false,
        durationMs: Date.now() - t0,
        error: "Smoke test returned an empty ProviderTurnResult (no text, no tool calls)",
      };
    }

    return {
      provider: providerName,
      ok: true,
      durationMs: Date.now() - t0,
      result: { textContent: result.textContent, finishReason: result.finishReason },
    };
  } catch (err) {
    return {
      provider: providerName,
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

async function checkOpenAI(): Promise<ProviderHealthResult> {
  const providerName = "OpenAIProvider";
  const t0 = Date.now();
  try {
    const provider = new OpenAIProvider() as unknown as {
      _completeTurn(params: ProviderQueryParams): AsyncGenerator<import("./base").ProviderChunk>;
      client: {
        chat: {
          completions: {
            create(req: unknown, opts?: unknown): Promise<unknown>;
          };
        };
      };
    };

    provider.client = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: { role: "assistant", content: "pong" },
                finish_reason: "stop",
              },
            ],
          }),
        },
      },
    };

    const result = await accumulateTurn(provider._completeTurn(SMOKE_PARAMS));

    if (!result.textContent && result.toolCallList.length === 0) {
      return {
        provider: providerName,
        ok: false,
        durationMs: Date.now() - t0,
        error: "Smoke test returned an empty ProviderTurnResult (no text, no tool calls)",
      };
    }

    return {
      provider: providerName,
      ok: true,
      durationMs: Date.now() - t0,
      result: { textContent: result.textContent, finishReason: result.finishReason },
    };
  } catch (err) {
    return {
      provider: providerName,
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Run smoke tests against ClaudeProvider and OpenAIProvider in parallel.
 * Logs a clear warning for every provider that fails; logs confirmation when
 * all providers pass.
 *
 * Does NOT throw — failed checks are reported in the returned object so the
 * server can continue booting even if a provider is temporarily unavailable.
 */
export async function runProviderHealthChecks(): Promise<ProviderHealthReport> {
  const [claudeResult, openaiResult] = await Promise.all([
    checkClaude(),
    checkOpenAI(),
  ]);

  const results = [claudeResult, openaiResult];
  const allOk = results.every((r) => r.ok);
  const report: ProviderHealthReport = {
    checkedAt: new Date().toISOString(),
    allOk,
    results,
  };

  for (const r of results) {
    if (r.ok) {
      console.log(
        `[ProviderHealth] ${r.provider} ✓  (${r.durationMs}ms, reply="${r.result?.textContent}", finish="${r.result?.finishReason}")`
      );
    } else {
      console.warn(
        `[ProviderHealth] ⚠ ${r.provider} FAILED — ${r.error}. ` +
          "Check that the API key env var is set and the SDK version is compatible."
      );
    }
  }

  if (allOk) {
    console.log("[ProviderHealth] All providers healthy ✓");
  } else {
    console.warn(
      "[ProviderHealth] One or more providers are UNHEALTHY — Jarvis may silently fail for affected model queries."
    );
  }

  return report;
}
