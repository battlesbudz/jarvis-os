import type OpenAI from "openai";

type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface CoachContextTrace {
  clientMessageCount: number;
  recoveredSessionMessageCount: number;
  providerMessageCount: number;
  summarizedMessageCount: number;
  omittedMessageCount: number;
}

export interface AssembleCoachContextInput {
  clientMessages: unknown[];
  recoveredSessionMessages?: OAIMessage[];
  fallbackMessages?: unknown[];
  maxEstimatedTokens?: number;
}

export interface AssembledCoachContext {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  trace: CoachContextTrace;
}

const DEFAULT_MAX_ESTIMATED_TOKENS = 12_000;
const MAX_SINGLE_MESSAGE_CHARS = 32_000;
const SUMMARY_PREFIX = "UNTRUSTED CONTEXT: Prior session summary";

function normalizeVisibleMessages(messages: unknown[]): Array<{ role: "user" | "assistant"; content: string }> {
  const normalized: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const value of messages) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as { role?: unknown; content?: unknown };
    if (candidate.role !== "user" && candidate.role !== "assistant") continue;
    if (typeof candidate.content !== "string" || !candidate.content.trim()) continue;
    normalized.push({
      role: candidate.role,
      content: candidate.content.length > MAX_SINGLE_MESSAGE_CHARS
        ? candidate.content.slice(0, MAX_SINGLE_MESSAGE_CHARS)
        : candidate.content,
    });
  }
  return normalized;
}

function sameMessage(
  left: { role: "user" | "assistant"; content: string },
  right: { role: "user" | "assistant"; content: string },
): boolean {
  return left.role === right.role && left.content === right.content;
}

/** Merge an older authoritative history with the client's overlapping recent window. */
export function mergeOverlappingCoachMessages(
  older: Array<{ role: "user" | "assistant"; content: string }>,
  recent: Array<{ role: "user" | "assistant"; content: string }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const maxOverlap = Math.min(older.length, recent.length);
  let overlap = 0;
  for (let size = maxOverlap; size > 0; size--) {
    let matches = true;
    for (let i = 0; i < size; i++) {
      if (!sameMessage(older[older.length - size + i], recent[i])) {
        matches = false;
        break;
      }
    }
    if (matches) {
      overlap = size;
      break;
    }
  }
  return [...older, ...recent.slice(overlap)];
}

function estimatedTokens(message: { content: string }): number {
  return Math.ceil(message.content.length / 4) + 6;
}

function summarizedMessageCount(messages: Array<{ content: string }>): number {
  let count = 0;
  for (const message of messages) {
    if (!message.content.startsWith(SUMMARY_PREFIX)) continue;
    for (const match of message.content.matchAll(/\((\d+) compacted messages\)/g)) {
      count += Number.parseInt(match[1], 10) || 0;
    }
  }
  return count;
}

/**
 * Build the one bounded conversation window used by every app-chat provider route.
 * Session history is authoritative; the client contributes the newest, potentially
 * unsaved turn. Older session summaries are retained ahead of verbatim recent turns.
 */
export function assembleCoachContext(input: AssembleCoachContextInput): AssembledCoachContext {
  const client = normalizeVisibleMessages(input.clientMessages);
  const recovered = normalizeVisibleMessages(input.recoveredSessionMessages ?? []);
  const fallback = normalizeVisibleMessages(input.fallbackMessages ?? []);
  const authoritative = recovered.length > 0 ? recovered : fallback;
  const merged = mergeOverlappingCoachMessages(authoritative, client);
  const summaries = merged.filter((message) => message.content.startsWith(SUMMARY_PREFIX));
  const raw = merged.filter((message) => !message.content.startsWith(SUMMARY_PREFIX));
  const maxTokens = Math.max(1_000, input.maxEstimatedTokens ?? DEFAULT_MAX_ESTIMATED_TOKENS);

  const keptRecent: typeof raw = [];
  let usedTokens = summaries.reduce((total, message) => total + estimatedTokens(message), 0);
  for (let index = raw.length - 1; index >= 0; index--) {
    const cost = estimatedTokens(raw[index]);
    if (keptRecent.length > 0 && usedTokens + cost > maxTokens) break;
    keptRecent.unshift(raw[index]);
    usedTokens += cost;
  }

  // Summaries are useful only when they fit beside the current raw turn. Drop the
  // oldest summaries first instead of ever exceeding the provider budget.
  const keptSummaries = [...summaries];
  while (
    keptSummaries.length > 0 &&
    keptSummaries.reduce((total, message) => total + estimatedTokens(message), 0) +
      keptRecent.reduce((total, message) => total + estimatedTokens(message), 0) > maxTokens
  ) {
    keptSummaries.shift();
  }

  const messages = [...keptSummaries, ...keptRecent];
  return {
    messages,
    trace: {
      clientMessageCount: client.length,
      recoveredSessionMessageCount: recovered.length,
      providerMessageCount: messages.length,
      summarizedMessageCount: summarizedMessageCount(keptSummaries),
      omittedMessageCount: Math.max(0, merged.length - messages.length),
    },
  };
}
