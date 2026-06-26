import type OpenAI from "openai";
import { eq } from "drizzle-orm";

import type { ProviderTurnResult } from "../agent/providers/base";
import type { FallbackChainEntry } from "../agent/providers/fallback";
import type { MemoryContext } from "../memory/memoryOs";
import {
  loadRuntimeProfileStateFromDb,
  type RuntimeProfileState,
} from "./stateCard";

export type RuntimeMemoryInspectionIntent = {
  kind: "exact_memory_inspection";
  query: string;
  scopeLabel: string;
};

type SoulInspectionRecord = {
  content: string;
  manualOverride: string | null;
  generatedAt: Date | string | null;
  updatedAt: Date | string;
};

type RuntimeMemoryInspectionDeps = {
  loadCoreProfile?: (userId: string) => Promise<RuntimeProfileState | null>;
  loadSoul?: (userId: string) => Promise<SoulInspectionRecord>;
  retrieveMemoryContext?: (input: {
    userId: string;
    query: string;
    limit: number;
    caller: "runtime_memory_inspection";
    skipAccessUpdate: boolean;
    canonicalOnly?: boolean;
  }) => Promise<MemoryContext>;
};

let runtimeMemoryInspectionDepsForTesting: RuntimeMemoryInspectionDeps | null = null;

export function _setRuntimeMemoryInspectionDepsForTesting(
  deps: RuntimeMemoryInspectionDeps | null,
): void {
  runtimeMemoryInspectionDepsForTesting = deps;
}

const ABOUT_YOU_QUERY = "user profile preferences relationships work patterns goals blockers values";
const DEFAULT_MEMORY_LIMIT = 10;
const TOPIC_INSPECTION_CANDIDATE_LIMIT = 40;

function textFromContent(content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function latestUserText(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return textFromContent(message.content);
  }
  return "";
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[?!.]+$/g, "")
    .trim();
}

function normalizeForIntent(text: string): string {
  return cleanText(text).toLowerCase().replace(/['`\u2018\u2019]/g, "");
}

function stripPoliteTopicSuffixes(value: string): string {
  let topic = value.trim();
  for (let index = 0; index < 3; index += 1) {
    const next = topic
      .replace(/(?:,?\s+(?:please|for me|for us|if you can|if possible|thank you|thanks))$/i, "")
      .trim();
    if (next === topic) break;
    topic = next;
  }
  return topic;
}

function cleanTopic(value: string): string {
  const topic = stripPoliteTopicSuffixes(cleanText(value))
    .replace(/^(?:the|my|exact|stored)\s+/i, "")
    .replace(/\s+(?:memories|memory|records|entries)$/i, "")
    .trim();
  return topic;
}

function isAboutCurrentUser(topic: string): boolean {
  const normalized = normalizeForIntent(topic);
  return normalized === "me" ||
    normalized === "myself" ||
    normalized === "you have about me" ||
    normalized === "the user" ||
    normalized === "this user" ||
    normalized === "my profile";
}

function wantsInterpretation(text: string): boolean {
  const normalized = normalizeForIntent(text);
  return /\b(interpret|analyze|analyse|advise|recommend|strategy|plan|what should i|how should i|why do i|use my memories to|based on what you know)\b/.test(normalized);
}

const COMPOUND_ACTION_VERBS = String.raw`(?:draft|write|send|email|message|text|forward|share|create|open|search|use|reply|summarize|summarise|analyze|analyse|explain|describe|interpret|plan|recommend|schedule|remind|book|make|build|turn|save|store|upload|export|copy|move|put|add|attach|post|submit|file|delete|remove|archive|convert|tell|compare|help|give)`;

function hasCompoundFollowUpWork(text: string): boolean {
  const normalized = normalizeForIntent(text);
  const rawLower = cleanText(text).toLowerCase().replace(/['`]/g, "");
  const followUp = String.raw`\b(?:and(?: then)?|then|after that|afterward|afterwards)\s+(?:please\s+)?`;
  const punctuatedFollowUp = String.raw`(?:[,.!?;:]|[-\u2013\u2014]{1,2})\s+(?:please\s+)?`;
  const politeActionPrefix = String.raw`(?:(?:can|could|would|will)\s+you\s+|are\s+you\s+able\s+to\s+)?`;
  if (new RegExp(`${followUp}${politeActionPrefix}${COMPOUND_ACTION_VERBS}\\b`).test(normalized)) {
    return true;
  }
  if (new RegExp(`${punctuatedFollowUp}${politeActionPrefix}${COMPOUND_ACTION_VERBS}\\b`).test(rawLower)) return true;
  if (new RegExp(`${followUp}(?:\\w+\\s+){0,3}(?:it|them|that|this|these|those|the memories|the results)\\b`).test(normalized)) return true;
  return new RegExp(`${punctuatedFollowUp}(?:\\w+\\s+){0,3}(?:it|them|that|this|these|those|the memories|the results)\\b`).test(rawLower);
}

function hasInfinitiveActionFollowUp(text: string): boolean {
  const normalized = normalizeForIntent(text);
  const match = normalized.match(new RegExp(`^(.+?)\\s+(?:to|in order to|so (?:i|we|you) can)\\s+(?:please\\s+)?${COMPOUND_ACTION_VERBS}\\b`));
  const leadIn = match?.[1]?.trim();
  if (!leadIn) return false;
  const lastLeadInWord = leadIn.split(/\s+/).at(-1) ?? "";
  return !/^(?:how|what|where|when|why|whether|which)$/i.test(lastLeadInWord);
}

function topicIntent(topic: string): RuntimeMemoryInspectionIntent {
  const cleaned = cleanTopic(topic);
  if (!cleaned || isAboutCurrentUser(cleaned)) {
    return {
      kind: "exact_memory_inspection",
      query: ABOUT_YOU_QUERY,
      scopeLabel: "about you",
    };
  }

  return {
    kind: "exact_memory_inspection",
    query: cleaned,
    scopeLabel: cleaned,
  };
}

export function classifyRuntimeMemoryInspectionIntent(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): RuntimeMemoryInspectionIntent | null {
  const rawText = latestUserText(messages);
  const normalized = normalizeForIntent(rawText);
  if (!normalized || hasCompoundFollowUpWork(rawText)) return null;

  if (/^(?:what do you know about me|show me what you know about me|show what you know about me|what memories do you have about me|what have i told you|show my memories|show me my memories|list my memories|show memory os|what is in my memory|whats in my memory|what is in memory os|whats in memory os)$/.test(normalized)) {
    return topicIntent("me");
  }

  const topicPatterns = [
    /^(?:show|list|display|pull up)(?: me)?(?: the)?(?: my)?(?: exact)?(?: stored)? (?:memories|memory) (?:about|for|on|related to|regarding) (.+)$/i,
    /^(?:show|list|display|pull up)(?: me)? what you know (?:about|on|regarding) (.+)$/i,
    /^(?:what memories do you have|what have i told you|what does memory os know) (?:about|on|regarding) (.+)$/i,
  ];

  const cleaned = cleanText(rawText);
  for (const pattern of topicPatterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      if (hasCompoundFollowUpWork(match[1]) || hasInfinitiveActionFollowUp(match[1])) return null;
      return topicIntent(match[1]);
    }
  }

  if (wantsInterpretation(rawText)) return null;

  return null;
}

function providerTurnResult(text: string, route: FallbackChainEntry | undefined): ProviderTurnResult {
  return {
    textContent: text,
    textChunks: [text],
    toolCallList: [],
    finishReason: "stop",
    providerName: "jarvis-runtime",
    model: route?.model,
    fallbackUsed: false,
  };
}

async function defaultLoadSoul(userId: string): Promise<SoulInspectionRecord> {
  if (typeof process !== "undefined" && !process.env.DATABASE_URL) {
    return { content: "", manualOverride: null, generatedAt: null, updatedAt: new Date(0) };
  }

  const [{ db }, schema] = await Promise.all([
    import("../db"),
    import("@shared/schema"),
  ]);
  const [soul] = await db
    .select({
      content: schema.jarvisSouls.content,
      manualOverride: schema.jarvisSouls.manualOverride,
      generatedAt: schema.jarvisSouls.generatedAt,
      updatedAt: schema.jarvisSouls.updatedAt,
    })
    .from(schema.jarvisSouls)
    .where(eq(schema.jarvisSouls.userId, userId))
    .limit(1);

  return soul ?? { content: "", manualOverride: null, generatedAt: null, updatedAt: new Date(0) };
}

async function defaultRetrieveMemoryContext(input: {
  userId: string;
  query: string;
  limit: number;
  caller: "runtime_memory_inspection";
  skipAccessUpdate: boolean;
}): Promise<MemoryContext> {
  const { retrieveMemoryContext } = await import("../memory/memoryOs");
  return retrieveMemoryContext(input);
}

function hasCoreProfileFields(profile: RuntimeProfileState | null): boolean {
  return Boolean(
    profile?.preferredName?.trim()
      || profile?.timezone?.trim()
      || profile?.language?.trim()
      || profile?.communicationStyle?.trim(),
  );
}

function renderCoreProfile(profile: RuntimeProfileState | null, soul: SoulInspectionRecord | null): string[] {
  const lines: string[] = ["## Soul/Core Profile"];

  if (profile) {
    const profileLines: Array<[string, string | undefined]> = [
      ["Preferred name", profile.preferredName],
      ["Timezone", profile.timezone],
      ["Language", profile.language],
      ["Communication style", profile.communicationStyle],
    ];
    for (const [label, value] of profileLines) {
      const trimmed = value?.trim();
      if (trimmed) lines.push(`- ${label}: ${trimmed} (${profile.source})`);
    }
  }

  const soulContent = soul?.content?.trim();
  if (soulContent) {
    lines.push("", "Soul:", soulContent);
  }

  const manualOverride = soul?.manualOverride?.trim();
  if (manualOverride) {
    lines.push("", "Personal notes:", manualOverride);
  }

  if (lines.length === 1) {
    lines.push("- No stored Soul/Core Profile entries found.");
  }

  return lines;
}

function compactProvenance(item: MemoryContext["items"][number]): string {
  const ref = item.provenance.find((candidate) => candidate.kind === "user_memory") ?? item.provenance[0];
  if (!ref) return `MemoryOS/${item.memory.id}`;
  return `MemoryOS/${ref.id}`;
}

function renderMemoryItems(context: MemoryContext, scopeLabel: string): string[] {
  const lines: string[] = ["## MemoryOS"];
  if (context.items.length === 0) {
    lines.push(`- No matching MemoryOS memories found for ${scopeLabel}.`);
    return lines;
  }

  context.items.forEach((item, index) => {
    const memory = item.memory;
    lines.push(
      `${index + 1}. [${memory.tier}/${memory.memoryType}] [${memory.category}] (${compactProvenance(item)})`,
      memory.content,
    );
  });

  return lines;
}

function sourceLine(profile: RuntimeProfileState | null, soul: SoulInspectionRecord | null, memoryContext: MemoryContext): string {
  const sources = new Set<string>();
  if (hasCoreProfileFields(profile) || soul?.content?.trim() || soul?.manualOverride?.trim()) sources.add("Soul/Core Profile");
  if (memoryContext.items.length > 0 || memoryContext.uncertainty.length > 0) sources.add("MemoryOS");
  return `Sources: ${Array.from(sources).join(", ") || "none"}.`;
}

function sanitizeMemoryUncertainty(note: string): string | null {
  const clean = cleanText(note);
  if (!clean) return null;
  if (/\b(failed|error|exception|database_url|connection string|password|secret|token|postgres|provider|stack trace)\b/i.test(clean)) {
    return "MemoryOS retrieval was unavailable.";
  }
  return clean;
}

function safeErrorKind(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return typeof error;
}

function shouldIncludeCoreProfile(intent: RuntimeMemoryInspectionIntent): boolean {
  return intent.scopeLabel === "about you" && intent.query === ABOUT_YOU_QUERY;
}

const TOPIC_TOKEN_STOPWORDS = new Set([
  "about",
  "for",
  "from",
  "memories",
  "memory",
  "records",
  "entries",
  "related",
  "regarding",
  "show",
  "list",
  "display",
  "pull",
  "the",
  "and",
  "or",
  "vs",
  "versus",
  "you",
  "user",
]);

type TopicAlternative = {
  tokens: string[];
  symbolTerms: string[];
};

function isTopicSearchToken(token: string): boolean {
  if (TOPIC_TOKEN_STOPWORDS.has(token)) return false;
  if (token.length >= 2) return true;
  return token.length === 1 && !/^[ai]$/.test(token);
}

function tokenizeTopic(value: string, symbolTerms: string[] = symbolTopicTerms(value)): string[] {
  const symbolTokenParts = new Set(symbolTerms.flatMap((term) => term
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)));
  return Array.from(new Set(
    normalizeForIntent(value)
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => {
        if (symbolTokenParts.has(token)) return false;
        return isTopicSearchToken(token);
      }),
  ));
}

function topicTokens(query: string): string[] {
  const topic = cleanTopic(query);
  return tokenizeTopic(topic, symbolTopicTerms(topic));
}

function allowsUnorderedTopicMatch(query: string): boolean {
  return /\b(?:and|or|vs|versus)\b|&/i.test(cleanTopic(query));
}

function hasOrTopicConnector(query: string): boolean {
  return /\bor\b/i.test(cleanTopic(query));
}

function symbolTopicTerms(value: string): string[] {
  return Array.from(new Set(
    (cleanTopic(value).match(/[a-z0-9]+(?:[+#./-]+[a-z0-9]+)*[+#]+|[a-z0-9]+(?:[+#./-]+[a-z0-9]+)+/gi) ?? [])
      .map((term) => term.toLowerCase()),
  ));
}

function topicAlternatives(query: string): TopicAlternative[] {
  const topic = cleanTopic(query);
  if (!hasOrTopicConnector(topic)) return [];
  return topic
    .split(/\bor\b/i)
    .map((part) => {
      const symbolTerms = symbolTopicTerms(part);
      return {
        tokens: tokenizeTopic(part, symbolTerms),
        symbolTerms,
      };
    })
    .filter((part) => part.tokens.length > 0 || part.symbolTerms.length > 0);
}

function searchableTopicText(item: MemoryContext["items"][number]): string {
  return [
    item.memory.content,
    item.memory.category,
    item.memory.tier,
    item.memory.memoryType,
    ...item.provenance.map((ref) => ref.label),
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function searchableRawTopicText(item: MemoryContext["items"][number]): string {
  return [
    item.memory.content,
    item.memory.category,
    item.memory.tier,
    item.memory.memoryType,
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rawTopicMatcher(query: string): RegExp | null {
  const rawTopic = cleanTopic(query).toLowerCase();
  if (!rawTopic) return null;
  if (!/[^a-z0-9\s]/i.test(rawTopic) && rawTopic.length !== 1) return null;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(rawTopic)}([^a-z0-9]|$)`, "i");
}

function itemMatchesRawTopic(item: MemoryContext["items"][number], query: string): boolean {
  const matcher = rawTopicMatcher(query);
  if (!matcher) return false;
  return matcher.test(searchableRawTopicText(item));
}

function itemMatchesSymbolTerms(item: MemoryContext["items"][number], symbolTerms: string[]): boolean {
  if (symbolTerms.length === 0) return true;
  const searchable = searchableRawTopicText(item);
  return symbolTerms.every((term) => {
    const matcher = new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, "i");
    return matcher.test(searchable);
  });
}

function itemMatchesTopicTokens(item: MemoryContext["items"][number], tokens: string[], allowUnorderedMatch: boolean): boolean {
  if (tokens.length === 0) return true;
  const searchable = normalizeForIntent(searchableTopicText(item));
  const searchablePhrase = searchable
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(isTopicSearchToken)
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");
  const searchableTokens = new Set(searchable
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(isTopicSearchToken));
  const topicPhrase = tokens.join(" ");
  if (tokens.length > 1) {
    return ` ${searchablePhrase} `.includes(` ${topicPhrase} `) ||
      (allowUnorderedMatch && tokens.every((token) => searchableTokens.has(token)));
  }
  return searchableTokens.has(tokens[0]!);
}

function itemMatchesTopicAlternative(item: MemoryContext["items"][number], alternative: TopicAlternative): boolean {
  return itemMatchesSymbolTerms(item, alternative.symbolTerms) &&
    itemMatchesTopicTokens(item, alternative.tokens, false);
}

function itemMatchesTopic(
  item: MemoryContext["items"][number],
  tokens: string[],
  allowUnorderedMatch: boolean,
  symbolTerms: string[],
  alternatives: TopicAlternative[],
): boolean {
  if (alternatives.length > 0) {
    return alternatives.some((alternative) => itemMatchesTopicAlternative(item, alternative));
  }
  return itemMatchesSymbolTerms(item, symbolTerms) &&
    itemMatchesTopicTokens(item, tokens, allowUnorderedMatch);
}

function contextWithFilteredItems(context: MemoryContext, items: MemoryContext["items"]): MemoryContext {
  const retainedIds = new Set(items.flatMap((item) => [
    item.memory.id,
    item.memory.sourceId,
    ...item.provenance.map((ref) => ref.id),
  ].filter((id): id is string => Boolean(id))));

  return {
    ...context,
    items,
    sources: {
      ...context.sources,
      memories: context.sources.memories.filter((id) => retainedIds.has(id)),
      brainChunks: context.sources.brainChunks.filter((id) => retainedIds.has(id)),
      hotState: context.sources.hotState.filter((id) => retainedIds.has(id)),
    },
    provenance: context.provenance.filter((ref) => retainedIds.has(ref.id)),
  };
}

function isCanonicalMemoryItem(item: MemoryContext["items"][number]): boolean {
  return item.memory.source !== "gbrain" &&
    !item.provenance.some((ref) => ref.source === "gbrain" || ref.kind === "brain_chunk");
}

function filterMemoryContextForInspection(
  context: MemoryContext,
  intent: RuntimeMemoryInspectionIntent,
): MemoryContext {
  const canonicalContext = contextWithFilteredItems(
    context,
    context.items.filter(isCanonicalMemoryItem),
  );
  if (shouldIncludeCoreProfile(intent)) return canonicalContext;

  const tokens = topicTokens(intent.query);
  const allowUnorderedMatch = allowsUnorderedTopicMatch(intent.query);
  const symbolTerms = symbolTopicTerms(intent.query);
  const alternatives = topicAlternatives(intent.query);
  if (tokens.length === 0 && symbolTerms.length === 0 && alternatives.length === 0) {
    return contextWithFilteredItems(
      canonicalContext,
      canonicalContext.items.filter((item) => itemMatchesRawTopic(item, intent.query)).slice(0, DEFAULT_MEMORY_LIMIT),
    );
  }

  return contextWithFilteredItems(
    canonicalContext,
    canonicalContext.items
      .filter((item) => itemMatchesTopic(item, tokens, allowUnorderedMatch, symbolTerms, alternatives))
      .slice(0, DEFAULT_MEMORY_LIMIT),
  );
}

export async function answerRuntimeMemoryInspectionQuestion(
  input: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    userId?: string;
    route: FallbackChainEntry | undefined;
  },
  deps: RuntimeMemoryInspectionDeps = {},
): Promise<ProviderTurnResult | null> {
  const intent = classifyRuntimeMemoryInspectionIntent(input.messages);
  if (!intent) return null;

  if (!input.userId?.trim()) {
    return providerTurnResult(
      "Authentication/runtime error: Jarvis needs a signed-in user before showing stored MemoryOS or Soul records.",
      input.route,
    );
  }

  const userId = input.userId.trim();
  const effectiveDeps = {
    ...runtimeMemoryInspectionDepsForTesting,
    ...deps,
  };
  const loadCoreProfile = effectiveDeps.loadCoreProfile ?? loadRuntimeProfileStateFromDb;
  const loadSoul = effectiveDeps.loadSoul ?? defaultLoadSoul;
  const retrieveMemoryContext = effectiveDeps.retrieveMemoryContext ?? defaultRetrieveMemoryContext;
  const includeCoreProfile = shouldIncludeCoreProfile(intent);

  let profile: RuntimeProfileState | null = null;
  let soul: SoulInspectionRecord | null = null;
  let memoryContext: MemoryContext = {
    userId,
    query: intent.query,
    caller: "runtime_memory_inspection",
    items: [],
    sources: { memories: [], brainChunks: [], hotState: [] },
    provenance: [],
    uncertainty: [],
  };
  const notes: string[] = [];

  if (includeCoreProfile) {
    try {
      profile = await loadCoreProfile(userId);
    } catch (error) {
      console.warn("[RuntimeMemoryInspection] core profile unavailable:", safeErrorKind(error));
      notes.push("Core profile was unavailable.");
    }

    try {
      soul = await loadSoul(userId);
    } catch (error) {
      console.warn("[RuntimeMemoryInspection] Soul unavailable:", safeErrorKind(error));
      notes.push("Soul was unavailable.");
    }
  }

  try {
    memoryContext = await retrieveMemoryContext({
      userId,
      query: intent.query,
      limit: shouldIncludeCoreProfile(intent) ? DEFAULT_MEMORY_LIMIT : TOPIC_INSPECTION_CANDIDATE_LIMIT,
      caller: "runtime_memory_inspection",
      skipAccessUpdate: true,
      canonicalOnly: true,
    });
  } catch (error) {
    console.warn("[RuntimeMemoryInspection] MemoryOS unavailable:", safeErrorKind(error));
    notes.push("MemoryOS was unavailable.");
  }
  memoryContext = filterMemoryContextForInspection(memoryContext, intent);

  notes.push(...memoryContext.uncertainty
    .map(sanitizeMemoryUncertainty)
    .filter((note): note is string => Boolean(note)));

  const lines = [
    `Here is a limited MemoryOS inspection for ${intent.scopeLabel}: up to ${DEFAULT_MEMORY_LIMIT} matching records. It may not include every stored memory.`,
    "",
    ...renderMemoryItems(memoryContext, intent.scopeLabel),
    "",
    sourceLine(profile, soul, memoryContext),
  ];
  if (includeCoreProfile) {
    lines.splice(2, 0, ...renderCoreProfile(profile, soul), "");
  }

  if (notes.length > 0) {
    lines.push("", "Notes:", ...Array.from(new Set(notes)).map((note) => `- ${note}`));
  }

  return providerTurnResult(lines.join("\n"), input.route);
}
