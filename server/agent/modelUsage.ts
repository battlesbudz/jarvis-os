import type OpenAI from "openai";
import { ensureModelUsageEventsTable, pool } from "../db";

interface UsageEstimateParams {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  textContent?: string | null;
  toolCallList?: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[];
}

export interface ModelUsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  failedCalls: number;
}

export interface ModelUsageByModel extends ModelUsageTotals {
  provider: string;
  model: string;
  estimatedCalls: number;
  lastUsedAt: string | null;
  sources: string[];
}

export interface ModelUsageRecentEvent {
  id: string;
  provider: string;
  model: string;
  source: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  success: boolean;
  estimated: boolean;
  createdAt: string;
}

export interface ModelUsageRecordInput {
  userId: string;
  provider: string;
  model: string;
  source: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs?: number;
  success?: boolean;
  estimated?: boolean;
  metadata?: Record<string, unknown>;
}

interface ModelUsageTotalsRow {
  calls?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  duration_ms?: unknown;
  failed_calls?: unknown;
}

interface ModelUsageByModelRow extends ModelUsageTotalsRow {
  provider?: unknown;
  model?: unknown;
  estimated_calls?: unknown;
  last_used_at?: unknown;
  sources?: unknown;
}

interface ModelUsageRecentRow {
  id?: unknown;
  provider?: unknown;
  model?: unknown;
  source?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  duration_ms?: unknown;
  success?: unknown;
  estimated?: unknown;
  created_at?: unknown;
}

function jsonStringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

function estimateTextTokens(value: unknown): number {
  const text = typeof value === "string" ? value : jsonStringifySafe(value);
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function contentToText(content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return jsonStringifySafe(part);
      })
      .join("\n");
  }
  return jsonStringifySafe(content);
}

function numberFromDb(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isoStringFromDb(value: unknown, fallback?: string): string | null {
  if (value == null) return fallback ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : (fallback ?? null);
  }
  return fallback ?? null;
}

export function estimateModelUsage(params: UsageEstimateParams): Omit<ModelUsageRecordInput, "userId" | "provider" | "model" | "source"> {
  const promptText = params.messages
    .map((message) => `${message.role}: ${contentToText(message.content)}`)
    .join("\n");
  const toolText = params.tools ? jsonStringifySafe(params.tools) : "";
  const toolCallText = params.toolCallList
    ?.map((toolCall) => `${toolCall.function.name}: ${toolCall.function.arguments}`)
    .join("\n") ?? "";

  const promptTokens = estimateTextTokens(promptText) + estimateTextTokens(toolText);
  const completionTokens = estimateTextTokens(params.textContent ?? "") + estimateTextTokens(toolCallText);
  const totalTokens = promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimated: true,
  };
}

export async function recordModelUsage(input: ModelUsageRecordInput): Promise<void> {
  if (!input.userId || !input.model || !input.provider) return;

  const insertUsage = () => pool.query(
    `
      INSERT INTO model_usage_events (
        user_id,
        provider,
        model,
        source,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        duration_ms,
        success,
        estimated,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    `,
    [
      input.userId,
      input.provider,
      input.model,
      input.source || "unknown",
      Math.max(0, Math.round(input.promptTokens || 0)),
      Math.max(0, Math.round(input.completionTokens || 0)),
      Math.max(0, Math.round(input.totalTokens || 0)),
      Math.max(0, Math.round(input.durationMs || 0)),
      input.success ?? true,
      input.estimated ?? true,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  try {
    await insertUsage();
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
    if (code === "42P01") {
      try {
        await ensureModelUsageEventsTable();
        await insertUsage();
        console.log("[model-usage] repaired missing model_usage_events table and recorded usage");
        return;
      } catch (repairErr) {
        const repairMsg = repairErr instanceof Error ? repairErr.message : String(repairErr);
        console.warn(`[model-usage] failed after table repair attempt: ${repairMsg.slice(0, 200)}`);
        return;
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[model-usage] failed to record usage: ${msg.slice(0, 200)}`);
  }
}

export async function getModelUsageSummary(userId: string, days: number) {
  const safeDays = Math.min(90, Math.max(1, Math.floor(days || 7)));

  const [totalsResult, byModelResult, recentResult] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS calls,
          COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
          COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
          COALESCE(SUM(duration_ms), 0)::bigint AS duration_ms,
          COALESCE(SUM(CASE WHEN success THEN 0 ELSE 1 END), 0)::bigint AS failed_calls
        FROM model_usage_events
        WHERE user_id = $1
          AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
      `,
      [userId, safeDays],
    ) as Promise<{ rows: ModelUsageTotalsRow[] }>,
    pool.query(
      `
        SELECT
          provider,
          model,
          COUNT(*)::int AS calls,
          COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
          COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
          COALESCE(SUM(duration_ms), 0)::bigint AS duration_ms,
          COALESCE(SUM(CASE WHEN success THEN 0 ELSE 1 END), 0)::bigint AS failed_calls,
          COALESCE(SUM(CASE WHEN estimated THEN 1 ELSE 0 END), 0)::bigint AS estimated_calls,
          MAX(created_at) AS last_used_at,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT source), NULL) AS sources
        FROM model_usage_events
        WHERE user_id = $1
          AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
        GROUP BY provider, model
        ORDER BY total_tokens DESC, calls DESC
      `,
      [userId, safeDays],
    ) as Promise<{ rows: ModelUsageByModelRow[] }>,
    pool.query(
      `
        SELECT
          id,
          provider,
          model,
          source,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          duration_ms,
          success,
          estimated,
          created_at
        FROM model_usage_events
        WHERE user_id = $1
          AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [userId, safeDays],
    ) as Promise<{ rows: ModelUsageRecentRow[] }>,
  ]);

  const totalRow = totalsResult.rows[0] ?? {};
  const totals: ModelUsageTotals = {
    calls: numberFromDb(totalRow.calls),
    promptTokens: numberFromDb(totalRow.prompt_tokens),
    completionTokens: numberFromDb(totalRow.completion_tokens),
    totalTokens: numberFromDb(totalRow.total_tokens),
    durationMs: numberFromDb(totalRow.duration_ms),
    failedCalls: numberFromDb(totalRow.failed_calls),
  };

  const byModel: ModelUsageByModel[] = byModelResult.rows.map((row) => ({
    provider: String(row.provider ?? "unknown"),
    model: String(row.model ?? "unknown"),
    calls: numberFromDb(row.calls),
    promptTokens: numberFromDb(row.prompt_tokens),
    completionTokens: numberFromDb(row.completion_tokens),
    totalTokens: numberFromDb(row.total_tokens),
    durationMs: numberFromDb(row.duration_ms),
    failedCalls: numberFromDb(row.failed_calls),
    estimatedCalls: numberFromDb(row.estimated_calls),
    lastUsedAt: isoStringFromDb(row.last_used_at),
    sources: Array.isArray(row.sources) ? row.sources.map(String) : [],
  }));

  const recent: ModelUsageRecentEvent[] = recentResult.rows.map((row) => ({
    id: String(row.id),
    provider: String(row.provider ?? "unknown"),
    model: String(row.model ?? "unknown"),
    source: String(row.source ?? "unknown"),
    promptTokens: numberFromDb(row.prompt_tokens),
    completionTokens: numberFromDb(row.completion_tokens),
    totalTokens: numberFromDb(row.total_tokens),
    durationMs: numberFromDb(row.duration_ms),
    success: Boolean(row.success),
    estimated: Boolean(row.estimated),
    createdAt: isoStringFromDb(row.created_at, new Date().toISOString()) ?? new Date().toISOString(),
  }));

  return {
    days: safeDays,
    totals,
    byModel,
    recent,
  };
}
