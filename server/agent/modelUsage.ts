import type OpenAI from "openai";
import { pool } from "../db";

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

  try {
    await pool.query(
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
  } catch (err) {
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
    ),
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
    ),
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
    ),
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
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
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
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  }));

  return {
    days: safeDays,
    totals,
    byModel,
    recent,
  };
}
