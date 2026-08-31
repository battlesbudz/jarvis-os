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
  latestUserContext?: string;
  maxEstimatedTokens?: number;
}

export interface AssembledCoachContext {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  trace: CoachContextTrace;
}

const DEFAULT_MAX_ESTIMATED_TOKENS = 12_000;
const MAX_SINGLE_MESSAGE_CHARS = 32_000;
const SUMMARY_PREFIX = "UNTRUSTED CONTEXT: Prior session summary";
const OVERSIZED_MESSAGE_NOTICE = "\n\n[... middle of oversized message omitted ...]\n\n";
const USER_ATTACHMENT_BLOCK = { start: "\n\n<user_attachments>\n", end: "\n\n</user_attachments>" };
const SERVER_CONTEXT_BLOCKS = [
  USER_ATTACHMENT_BLOCK,
  { start: "\n\n<youtube_transcripts>\n", end: "\n\n</youtube_transcripts>" },
];

function stripTrailingServerBlocks(
  content: string,
  blocks: ReadonlyArray<{ start: string; end: string }>,
): string {
  let identity = content;
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const block of blocks) {
      if (!identity.endsWith(block.end)) continue;
      // Server wrappers are appended outside user-controlled content. Start at
      // the outermost marker so legacy unescaped nested delimiters fail closed.
      const start = identity.indexOf(block.start);
      if (start === -1) continue;
      identity = identity.slice(0, start);
      stripped = true;
      break;
    }
  }
  return identity;
}

/**
 * Attachment extraction/capability belongs to the turn that submitted the bytes.
 * Recovered session/chat history may contain the server-generated attachment block
 * for that older turn, but retaining that marker would make a later ordinary voice
 * turn look like it currently requires an attachment/vision provider. YouTube
 * transcript context is deliberately left intact because transcript follow-ups are
 * an explicit cross-turn feature.
 */
export function stripRecoveredAttachmentContext(content: string): string {
  return stripTrailingServerBlocks(content, [USER_ATTACHMENT_BLOCK]);
}

function boundRawMessageContent(content: string, maxChars = MAX_SINGLE_MESSAGE_CHARS): string {
  if (content.length <= maxChars) return content;
  if (maxChars <= OVERSIZED_MESSAGE_NOTICE.length) return content.slice(-maxChars);
  // Preserve substantially more of the tail because pasted documents commonly
  // put the user's actual question or instruction after the source material.
  const availableChars = maxChars - OVERSIZED_MESSAGE_NOTICE.length;
  const tailChars = Math.min(20_000, Math.ceil(availableChars * 0.625));
  const headChars = availableChars - tailChars;
  return content.slice(0, headChars) + OVERSIZED_MESSAGE_NOTICE + content.slice(-tailChars);
}

function boundContextMessageContent(content: string, maxChars: number): string {
  const identity = stripServerContext(content);
  const serverContext = content.slice(identity.length);
  if (!serverContext) return boundRawMessageContent(content, maxChars);
  if (serverContext.length >= maxChars) {
    const identityChars = Math.min(identity.length, Math.max(1, Math.floor(maxChars * 0.25)));
    const serverContextChars = maxChars - identityChars;
    return boundRawMessageContent(identity, identityChars) +
      (serverContextChars > 0 ? boundRawMessageContent(serverContext, serverContextChars) : "");
  }
  return boundRawMessageContent(identity, maxChars - serverContext.length) + serverContext;
}

export function boundMessageContent(content: string, preserveServerContext = false): string {
  return preserveServerContext ? content : boundRawMessageContent(content);
}

function normalizeVisibleMessages(
  messages: unknown[],
  preserveServerContext = false,
  stripRecoveredAttachments = false,
): Array<{ role: "user" | "assistant"; content: string }> {
  const normalized: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const value of messages) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as { role?: unknown; content?: unknown };
    if (candidate.role !== "user" && candidate.role !== "assistant") continue;
    if (typeof candidate.content !== "string" || !candidate.content.trim()) continue;
    const content = stripRecoveredAttachments
      ? stripRecoveredAttachmentContext(candidate.content)
      : candidate.content;
    normalized.push({
      role: candidate.role,
      content: boundMessageContent(content, preserveServerContext),
    });
  }
  return normalized;
}

export function stripServerContext(content: string): string {
  return stripTrailingServerBlocks(content, SERVER_CONTEXT_BLOCKS);
}

function messageComparisonKey(message: { role: "user" | "assistant"; content: string }): string {
  return `${message.role}\u0000${boundMessageContent(stripServerContext(message.content))}`;
}

function sameMessage(
  left: { role: "user" | "assistant"; content: string },
  right: { role: "user" | "assistant"; content: string },
): boolean {
  if (left.role !== right.role) return false;
  return boundMessageContent(stripServerContext(left.content)) === boundMessageContent(stripServerContext(right.content));
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

const MAX_RECONCILE_MESSAGES = 500;

/** Reconcile a complete app transcript with a provider log that may omit runtime-only turns. */
export function reconcileCoachMessages(
  completeMessages: unknown[],
  providerMessages: unknown[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const complete = normalizeVisibleMessages(completeMessages.slice(-MAX_RECONCILE_MESSAGES), true)
    .map((message) => ({ ...message, content: boundContextMessageContent(message.content, MAX_SINGLE_MESSAGE_CHARS) }));
  const provider = normalizeVisibleMessages(providerMessages.slice(-MAX_RECONCILE_MESSAGES), true)
    .map((message) => ({ ...message, content: boundContextMessageContent(message.content, MAX_SINGLE_MESSAGE_CHARS) }));
  const completeKeys = complete.map(messageComparisonKey);
  const providerKeys = provider.map(messageComparisonKey);
  const remainingMatches = Array.from(
    { length: complete.length + 1 },
    () => Array<number>(provider.length + 1).fill(0),
  );
  for (let completeIndex = complete.length - 1; completeIndex >= 0; completeIndex--) {
    for (let providerIndex = provider.length - 1; providerIndex >= 0; providerIndex--) {
      remainingMatches[completeIndex][providerIndex] = completeKeys[completeIndex] === providerKeys[providerIndex]
        ? remainingMatches[completeIndex + 1][providerIndex + 1] + 1
        : Math.max(
            remainingMatches[completeIndex + 1][providerIndex],
            remainingMatches[completeIndex][providerIndex + 1],
          );
    }
  }

  const merged: typeof complete = [];
  let completeIndex = 0;
  let hasMatched = false;

  for (let providerIndex = 0; providerIndex < provider.length; providerIndex++) {
    const providerMessage = provider[providerIndex];
    let matchIndex = -1;
    let bestRemainingMatches = -1;
    for (let index = completeIndex; index < complete.length; index++) {
      if (completeKeys[index] !== providerKeys[providerIndex]) continue;
      const candidateMatches = remainingMatches[index + 1][providerIndex + 1];
      if (
        candidateMatches > bestRemainingMatches ||
        (!hasMatched && candidateMatches === bestRemainingMatches)
      ) {
        matchIndex = index;
        bestRemainingMatches = candidateMatches;
      }
    }
    if (matchIndex === -1) {
      merged.push(providerMessage);
      continue;
    }
    merged.push(...complete.slice(completeIndex, matchIndex), providerMessage);
    completeIndex = matchIndex + 1;
    hasMatched = true;
  }

  merged.push(...complete.slice(completeIndex));
  return merged;
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
  const recovered = normalizeVisibleMessages(input.recoveredSessionMessages ?? [], true, true);
  const fallback = normalizeVisibleMessages(input.fallbackMessages ?? [], true, true);
  const authoritative = recovered.length > 0 ? recovered : fallback;
  const merged = mergeOverlappingCoachMessages(authoritative, client);
  if (input.latestUserContext) {
    const latestUserIndex = merged.findLastIndex((message) => message.role === "user");
    if (latestUserIndex >= 0) {
      merged[latestUserIndex] = {
        ...merged[latestUserIndex],
        content: [merged[latestUserIndex].content, input.latestUserContext].join("\n\n"),
      };
    }
  }
  const summaries = merged.filter((message) => message.content.startsWith(SUMMARY_PREFIX));
  const raw = merged.filter((message) => !message.content.startsWith(SUMMARY_PREFIX));
  const maxTokens = Math.max(1_000, input.maxEstimatedTokens ?? DEFAULT_MAX_ESTIMATED_TOKENS);
  const keptRecent: typeof raw = [];
  let usedTokens = 0;
  for (let index = raw.length - 1; index >= 0; index--) {
    const message = raw[index];
    const cost = estimatedTokens(message);
    if (usedTokens + cost > maxTokens) {
      const availableTokens = maxTokens - usedTokens;
      const availableChars = Math.max(0, (availableTokens - 6) * 4);
      const hasServerContext = stripServerContext(message.content) !== message.content;
      if (hasServerContext && availableChars > OVERSIZED_MESSAGE_NOTICE.length) {
        const boundedMessage = {
          ...message,
          content: boundContextMessageContent(message.content, availableChars),
        };
        keptRecent.unshift(boundedMessage);
        usedTokens += estimatedTokens(boundedMessage);
        break;
      }
      if (keptRecent.length > 0) break;
    }
    keptRecent.unshift(message);
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