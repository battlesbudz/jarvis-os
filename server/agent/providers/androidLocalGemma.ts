import type OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { ANDROID_LOCAL_GEMMA_MODEL } from "@shared/modelProviderCatalog";
import { BaseProvider } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";

type DaemonOpResult = { ok: boolean; data?: unknown; error?: string };

type AndroidLocalGemmaDaemonOp = (
  userId: string,
  op: {
    type: "android_local_model_generate";
    requestId?: string;
    model: string;
    prompt: string;
    contextTokens?: number;
    maxTokens?: number;
    backend?: string;
    temperature?: number;
  } | {
    type: "android_local_model_cancel";
    requestId?: string;
  },
  timeoutMs: number,
) => Promise<DaemonOpResult>;

let daemonOpForTesting: AndroidLocalGemmaDaemonOp | null = null;

const DEFAULT_PHONE_GEMMA_TIMEOUT_MS = 60_000;
const DEFAULT_PHONE_GEMMA_CONTEXT_TOKENS = 2048;
const DEFAULT_PHONE_GEMMA_MAX_COMPLETION_TOKENS = 128;
const DEFAULT_PHONE_GEMMA_PROMPT_CHAR_BUDGET = 3_600;
const DEFAULT_PHONE_GEMMA_TOOL_LIST_CHAR_BUDGET = 1_600;
const MAX_TOOL_DESCRIPTION_CHARS = 180;
const MAX_TOOL_ARGUMENT_NAMES = 12;
const MIN_REQUIRED_PROMPT_SECTION_CHARS = 80;
const MIN_TAIL_PROMPT_SECTION_CHARS = 24;
const DAEMON_TOOL_ARGUMENT_HINTS = [
  "packageName", "url", "x", "y", "x1", "y1", "x2", "y2", "durationMs", "key", "text",
  "path", "query", "root", "fileType", "notificationKey", "replyText", "approved",
  "facing", "audio", "accuracy", "to", "message", "operatorAction",
];

type LocalGemmaStructuredOutput =
  | { type: "final"; content: string }
  | { type: "tool_calls"; toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] };

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function phoneGemmaTimeoutMs(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_TIMEOUT_MS", DEFAULT_PHONE_GEMMA_TIMEOUT_MS, 10_000, 120_000);
}

function phoneGemmaContextTokens(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_CONTEXT_TOKENS", DEFAULT_PHONE_GEMMA_CONTEXT_TOKENS, 512, 4096);
}

function phoneGemmaMaxCompletionTokens(requested: number | undefined): number {
  const ceiling = intEnv("ANDROID_LOCAL_GEMMA_MAX_COMPLETION_TOKENS", DEFAULT_PHONE_GEMMA_MAX_COMPLETION_TOKENS, 16, 512);
  const wanted = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : ceiling;
  return Math.min(ceiling, Math.max(1, wanted));
}

function phoneGemmaPromptCharBudget(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_PROMPT_CHAR_BUDGET", DEFAULT_PHONE_GEMMA_PROMPT_CHAR_BUDGET, 1_200, 12_000);
}

function phoneGemmaToolListCharBudget(): number {
  return intEnv("ANDROID_LOCAL_GEMMA_TOOL_LIST_CHAR_BUDGET", DEFAULT_PHONE_GEMMA_TOOL_LIST_CHAR_BUDGET, 500, 6_000);
}

function shouldCancelTimedOutGeneration(result: DaemonOpResult): boolean {
  return !result.ok && /timeout/i.test(result.error || "");
}

export function _setAndroidLocalGemmaDaemonOpForTesting(fn: AndroidLocalGemmaDaemonOp | null): void {
  daemonOpForTesting = fn;
}

function normalizeAndroidLocalGemmaModel(model: string): string {
  const raw = model?.trim() || ANDROID_LOCAL_GEMMA_MODEL;
  return raw.startsWith("android-local-gemma/")
    ? raw.slice("android-local-gemma/".length)
    : raw;
}

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

function messageForPrompt(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): string {
  if (message.role === "tool") {
    return `tool(${message.tool_call_id}): ${textFromContent(message.content)}`;
  }
  const content = textFromContent(message.content);
  if (message.role === "assistant" && message.tool_calls?.length) {
    const calls = message.tool_calls
      .filter((call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => call.type === "function")
      .map((call) => `${call.function.name}(${call.function.arguments || "{}"})`)
      .join("\n");
    return `assistant: ${content}\nassistant tool calls:\n${calls}`.trim();
  }
  return `${message.role}: ${content}`;
}

function truncateText(value: string | undefined, maxChars: number): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function truncateTextMiddle(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  if (maxChars <= 12) return truncateText(text, maxChars);
  const marker = " ... ";
  const available = maxChars - marker.length;
  const headChars = Math.ceil(available * 0.55);
  const tailChars = Math.max(0, available - headChars);
  return `${text.slice(0, headChars).trimEnd()}${marker}${text.slice(text.length - tailChars).trimStart()}`;
}

function latestUserText(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return textFromContent(message.content);
  }
  return "";
}

function shouldOmitLocalRuntimeErrorMessage(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): boolean {
  if (message.role !== "assistant" || message.tool_calls?.length) return false;
  const text = textFromContent(message.content).trim();
  return /^Error:\s*(?:LOCAL_MODEL_|Phone Gemma|Android Local Gemma|Jarvis Android app device control)/i.test(text) ||
    /\bLOCAL_MODEL_(?:GENERATION_FAILED|DEVICE_MEMORY_LOW|BUSY|CANCELLED|ENGINE_NOT_BUNDLED)\b/i.test(text) ||
    /^Phone Gemma (?:could not|finished without|timed out|is still working)/i.test(text);
}

function hasActiveToolContinuation(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): boolean {
  return messages[messages.length - 1]?.role === "tool";
}

function looksLikeLocalToolRequest(text: string): boolean {
  return /\b(screenshot|screen shot|photo|picture|camera|microphone|mic|record|open|launch|tap|click|press|swipe|scroll|type|enter|back|home|settings|permission|bluetooth|wifi|wi-fi|call|text|sms|message|location|map|maps|navigate|alarm|timer|reminder|calendar|volume|brightness|flashlight|read|show|look at|what'?s on|what is on|phone|device|app|apps|control|enable|disable|turn on|turn off)\b/i.test(text);
}

function looksLikeUrlToolRequest(text: string): boolean {
  return /\b(?:https?:\/\/|www\.|youtu\.be\/|youtube\.com\/)/i.test(text);
}

function isToolConfirmationTurn(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): boolean {
  const latest = latestUserText(messages).trim();
  if (!/^(?:yes|yeah|yep|ok|okay|sure|do it|go ahead|please do)$/i.test(latest)) return false;
  let assistantIndex = -1;
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    assistantIndex = index;
    const text = textFromContent(message.content);
    if (!/\b(?:confirm|approve|permission|should i|do you want me|want me to|shall i|go ahead|proceed)\b/i.test(text)) return false;
    if (looksLikeLocalToolRequest(text) || looksLikeUrlToolRequest(text)) return true;
    break;
  }

  if (assistantIndex < 0) return false;
  const scanStart = Math.max(0, assistantIndex - 4);
  for (let index = assistantIndex - 1; index >= scanStart; index -= 1) {
    const message = messages[index];
    if (message.role === "tool") return true;
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
    if (message.role === "user") {
      const text = textFromContent(message.content);
      if (looksLikeLocalToolRequest(text) || looksLikeUrlToolRequest(text)) return true;
    }
  }
  return false;
}

function shouldUseLocalToolProtocol(params: ProviderQueryParams): boolean {
  if (!params.tools?.length || params.toolChoice === "none") return false;
  if (params.toolChoice === "required") return true;
  const latest = latestUserText(params.messages);
  return hasActiveToolContinuation(params.messages) ||
    looksLikeLocalToolRequest(latest) ||
    looksLikeUrlToolRequest(latest) ||
    isToolConfirmationTurn(params.messages);
}

function formatPromptSections(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  budgetChars: number,
  includeIndexes: boolean,
): string {
  const promptMessages = messages.filter((message) => !shouldOmitLocalRuntimeErrorMessage(message));
  const omittedRuntimeErrors = messages.length - promptMessages.length;
  const sections = promptMessages
    .map((message, index) => {
      const name = "name" in message && typeof message.name === "string" ? ` (${message.name})` : "";
      const heading = includeIndexes ? `Message ${index + 1} [${message.role}${name}]` : "";
      return {
        role: message.role,
        hasToolCalls: message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0,
        text: [heading, messageForPrompt(message)].filter(Boolean).join("\n").trim(),
      };
    })
    .filter((section) => section.text.length > 0);

  const systemSections = sections.filter((section) => section.role === "system");
  const nonSystemSections = sections.filter((section) => section.role !== "system");

  const keptSystem: string[] = [];
  let systemUsed = 0;
  let omittedSystem = 0;
  if (systemSections.length > 0) {
    const systemBudget = Math.min(Math.max(400, Math.floor(budgetChars * 0.35)), Math.max(250, budgetChars - 300));
    for (const section of systemSections) {
      const separatorChars = keptSystem.length > 0 ? 10 : 0;
      const available = systemBudget - systemUsed - separatorChars;
      if (available < 120) {
        omittedSystem += 1;
        continue;
      }
      const text = truncateTextMiddle(section.text, available);
      keptSystem.push(text);
      systemUsed += separatorChars + text.length;
    }
  }

  const kept: string[] = [];
  let omittedNonSystem = 0;
  const remainingBudget = Math.max(MIN_REQUIRED_PROMPT_SECTION_CHARS, budgetChars - systemUsed - (keptSystem.length > 0 ? 10 : 0));
  const tailStartIndex = requiredTailStartIndex(nonSystemSections);
  const tailSections = tailStartIndex >= 0 ? nonSystemSections.slice(tailStartIndex) : [];
  let used = 0;
  if (tailSections.length > 0) {
    const separatorChars = Math.max(0, tailSections.length - 1) * 10;
    const perSectionBudget = Math.max(MIN_TAIL_PROMPT_SECTION_CHARS, Math.floor((remainingBudget - separatorChars) / tailSections.length));
    const renderedTail = tailSections.map((section) => truncateTextMiddle(section.text, perSectionBudget));
    kept.push(...renderedTail);
    used = renderedTail.join("\n\n---\n\n").length;
  }

  for (let index = tailStartIndex - 1; index >= 0; index -= 1) {
    const section = nonSystemSections[index].text;
    const separatorChars = kept.length > 0 ? 10 : 0;
    if (used + separatorChars + section.length <= remainingBudget) {
      kept.unshift(section);
      used += separatorChars + section.length;
      continue;
    }
    omittedNonSystem += 1;
  }

  const omitted = omittedSystem + omittedNonSystem + omittedRuntimeErrors;
  const prefix = omitted > 0 ? [`[${omitted} earlier message${omitted === 1 ? "" : "s"} omitted to keep Phone Gemma inside its local context budget.]`] : [];
  return [...prefix, ...keptSystem, ...kept].join("\n\n---\n\n");
}

function requiredTailStartIndex<TSection extends { role: string; hasToolCalls?: boolean }>(sections: TSection[]): number {
  if (sections.length === 0) return -1;
  let index = sections.length - 1;
  if (sections[index].role !== "tool") return index;

  while (index > 0 && sections[index - 1].role === "tool") {
    index -= 1;
  }
  if (index > 0 && sections[index - 1].role === "assistant") {
    index -= 1;
  }
  if (index > 0 && sections[index - 1].role === "user") {
    index -= 1;
  }
  return index;
}

function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeToolArguments(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "{}";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return "{}";
}

function generatedToolCallId(index: number): string {
  return `phone_gemma_call_${Date.now().toString(36)}_${index}`;
}

function parseLocalGemmaStructuredOutput(raw: string): LocalGemmaStructuredOutput {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return { type: "final", content: raw.trim() };
  }

  const data = parsed as Record<string, unknown>;
  const type = typeof data.type === "string" ? data.type : "";
  if (type === "final") {
    return { type: "final", content: String(data.content ?? data.text ?? "").trim() };
  }

  const rawToolCalls = Array.isArray(data.tool_calls)
    ? data.tool_calls
    : Array.isArray(data.toolCalls)
      ? data.toolCalls
      : [];
  if (type === "tool_calls" || rawToolCalls.length > 0) {
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] = rawToolCalls
      .map((toolCall, index) => {
        if (!toolCall || typeof toolCall !== "object") return null;
        const item = toolCall as Record<string, unknown>;
        const functionData = item.function && typeof item.function === "object"
          ? item.function as Record<string, unknown>
          : item;
        const name = typeof functionData.name === "string" ? functionData.name.trim() : "";
        if (!name) return null;
        return {
          id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : generatedToolCallId(index),
          type: "function" as const,
          function: {
            name,
            arguments: normalizeToolArguments(functionData.arguments),
          },
        };
      })
      .filter((toolCall): toolCall is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => !!toolCall);

    return { type: "tool_calls", toolCalls };
  }

  return { type: "final", content: raw.trim() };
}

function parameterNames(
  parameters: OpenAI.Chat.Completions.ChatCompletionTool["function"]["parameters"],
): string[] {
  if (!parameters || typeof parameters !== "object") return [];
  const properties = (parameters as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.keys(properties).slice(0, MAX_TOOL_ARGUMENT_NAMES);
}

function requiredParameterNames(parameters: OpenAI.Chat.Completions.ChatCompletionTool["function"]["parameters"]): string[] {
  if (!parameters || typeof parameters !== "object") return [];
  const required = (parameters as { required?: unknown }).required;
  return Array.isArray(required)
    ? required.filter((item): item is string => typeof item === "string").slice(0, MAX_TOOL_ARGUMENT_NAMES)
    : [];
}

function enumValuesForParameter(
  parameters: OpenAI.Chat.Completions.ChatCompletionTool["function"]["parameters"],
  name: string,
): string[] {
  if (!parameters || typeof parameters !== "object") return [];
  const properties = (parameters as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  const property = (properties as Record<string, unknown>)[name];
  if (!property || typeof property !== "object" || Array.isArray(property)) return [];
  const enumValues = (property as { enum?: unknown }).enum;
  if (!Array.isArray(enumValues)) return [];
  return enumValues
    .filter((value): value is string | number | boolean => (
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ))
    .map((value) => String(value));
}

function requiredEnumSummaries(parameters: OpenAI.Chat.Completions.ChatCompletionTool["function"]["parameters"]): string[] {
  return requiredParameterNames(parameters)
    .flatMap((name) => {
      const values = enumValuesForParameter(parameters, name);
      return values.length ? [`${name} enum: ${values.join(", ")}`] : [];
    });
}

function argumentTextForTool(tool: OpenAI.Chat.Completions.ChatCompletionTool): string {
  const required = requiredParameterNames(tool.function.parameters);
  const enumSummaries = requiredEnumSummaries(tool.function.parameters);
  if (tool.function.name === "daemon_action") {
    return [
      " Args: action",
      `Android args include: ${DAEMON_TOOL_ARGUMENT_HINTS.join(", ")}`,
      required.length ? `required: ${required.join(", ")}` : "",
      enumSummaries.join("; "),
    ].filter(Boolean).join("; ") + ".";
  }

  const args = parameterNames(tool.function.parameters);
  return args.length
    ? ` Args: ${args.join(", ")}${required.length ? `; required: ${required.join(", ")}` : ""}${enumSummaries.length ? `; ${enumSummaries.join("; ")}` : ""}.`
    : " Args: none or tool-defined JSON.";
}

function toolRelevanceScore(tool: OpenAI.Chat.Completions.ChatCompletionTool, requestText: string): number {
  if (tool.type !== "function") return 0;
  const normalizedRequest = requestText.toLowerCase();
  const searchable = `${tool.function.name} ${tool.function.description || ""}`.toLowerCase();
  let score = 0;
  for (const token of normalizedRequest.match(/[a-z0-9_]{3,}/g) || []) {
    if (searchable.includes(token)) score += 1;
  }
  if (/android|phone|device|screen|screenshot|tap|open|app|permission|bluetooth|wifi|location/.test(normalizedRequest)) {
    if (/android|daemon|device|phone|screen|app|control|automation/.test(searchable)) score += 5;
  }
  return score;
}

function toolSpecsForPrompt(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  requestText: string,
  budgetLimit: number = phoneGemmaToolListCharBudget(),
): string {
  const toolList = (tools || [])
    .filter((tool) => tool.type === "function")
    .sort((a, b) => toolRelevanceScore(b, requestText) - toolRelevanceScore(a, requestText));

  const budget = Math.max(160, Math.min(phoneGemmaToolListCharBudget(), budgetLimit));
  const lines: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const tool of toolList) {
    const argumentText = argumentTextForTool(tool);
    const description = truncateText(tool.function.description, MAX_TOOL_DESCRIPTION_CHARS);
    const line = `- ${tool.function.name}: ${description || "Local Jarvis tool."}${argumentText}`;
    const separatorChars = lines.length > 0 ? 1 : 0;
    if (used + separatorChars + line.length > budget) {
      if (lines.length === 0) {
        lines.push(truncateText(line, budget));
        used = lines[0].length;
        continue;
      }
      omitted += 1;
      continue;
    }
    lines.push(line);
    used += separatorChars + line.length;
  }

  if (omitted > 0) {
    lines.push(`- ${omitted} lower-relevance tool${omitted === 1 ? "" : "s"} omitted to keep the phone-local prompt small.`);
  }

  return lines.join("\n");
}

function toolPromptFromParams(params: ProviderQueryParams): string {
  const requestText = latestUserText(params.messages);
  const promptBudget = phoneGemmaPromptCharBudget();
  const baseIntro = [
    "You are Jarvis running entirely through Android Local Gemma on the user's phone.",
    "Return ONLY one JSON object, with no markdown or extra text.",
    "Jarvis executes requested local tools and sends tool results back; tool results are authoritative.",
    "Tool use shape:",
    `{"type":"tool_calls","tool_calls":[{"name":"tool_name","arguments":{"key":"value"}}]}`,
    "Final answer shape:",
    `{"type":"final","content":"your reply to the user"}`,
    params.toolChoice === "required"
      ? "A tool call is required for this turn. Do not return a final answer."
      : "Use tools only when they are necessary to satisfy the user's request.",
  ].join("\n");
  const toolListBudget = promptBudget - baseIntro.length - MIN_REQUIRED_PROMPT_SECTION_CHARS - 48;
  const toolSpecs = toolSpecsForPrompt(params.tools, requestText, toolListBudget);
  const intro = [
    baseIntro,
    "Available tools:",
    toolSpecs || "- No callable local tools were provided.",
  ].join("\n");

  const conversationBudget = Math.max(MIN_REQUIRED_PROMPT_SECTION_CHARS, promptBudget - intro.length - 32);

  return [
    intro,
    "",
    "Conversation:",
    formatPromptSections(params.messages, conversationBudget, true),
  ].join("\n");
}

function chatPromptFromParams(params: ProviderQueryParams): string {
  const intro = [
    "You are Jarvis running entirely through Android Local Gemma on the user's phone.",
    "Answer directly and keep the response useful. Do not claim that a cloud model handled this turn.",
    params.tools?.length && params.toolChoice !== "none"
      ? "Local Jarvis tools are available for explicit device-control requests, but this turn should be answered normally unless a tool is actually needed."
      : "",
    `Local model: ${normalizeAndroidLocalGemmaModel(params.model)}.`,
  ].filter(Boolean).join("\n");
  const promptBudget = phoneGemmaPromptCharBudget();
  const conversationBudget = Math.max(MIN_REQUIRED_PROMPT_SECTION_CHARS, promptBudget - intro.length - 16);
  return [
    intro,
    "",
    formatPromptSections(params.messages, conversationBudget, false),
  ].join("\n");
}

function textFromDaemonData(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  for (const key of ["text", "content", "reply", "output"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function finishReasonFromDaemonData(data: unknown): string | null {
  if (!data || typeof data !== "object") return "stop";
  const reason = (data as Record<string, unknown>).finishReason;
  return reason === "length" || reason === "tool_calls" || reason === "stop" ? reason : "stop";
}

function normalizeAndroidLocalGemmaError(error: string | undefined): string {
  if (error?.includes("LOCAL_MODEL_ENGINE_NOT_BUNDLED")) {
    return "Phone Gemma is selected, but this APK cannot run LiteRT-LM generation yet. Install a LiteRT-LM-enabled APK before using Android Local Gemma.";
  }
  if (
    error?.includes("LOCAL_MODEL_GENERATION_FAILED") &&
    (error.includes("Failed to invoke the compiled model") || error.includes("llm_litert_compiled_model_executor.cc:755"))
  ) {
    return `Phone Gemma could not finish local inference on this device, usually because the phone-local Gemma runtime hit memory or accelerator pressure. Jarvis stayed on the local phone model and did not use any other model. Close heavy apps, let the phone cool down, then retry with the official E4B .litertlm model imported. Details: ${error}`;
  }
  if (
    error?.includes("LOCAL_MODEL_GENERATION_FAILED") &&
    (error.includes("Failed to create LiteRT-LM engine") || error.includes("llm_litert_compiled_model_executor"))
  ) {
    const cpuFallbackAttempted = /\bcpu:/i.test(error);
    const recoveryPath = cpuFallbackAttempted
      ? "Jarvis tried the device accelerator and CPU fallback"
      : "Jarvis tried the device accelerator; CPU fallback was skipped unless the phone has enough memory headroom";
    return `Phone Gemma could not start the LiteRT-LM engine for the imported .litertlm model. ${recoveryPath}; reimport ${ANDROID_LOCAL_GEMMA_MODEL.replace("android-local-gemma/", "")} as the official .litertlm file if this keeps happening. Details: ${error}`;
  }
  if (error?.includes("LOCAL_MODEL_DEVICE_MEMORY_LOW")) {
    return `Phone Gemma did not start because Android reported low available memory. Close other heavy apps, then try again. Details: ${error}`;
  }
  if (error?.includes("LOCAL_MODEL_BUSY")) {
    return "Phone Gemma is still working on the previous message. Wait for it to finish or tap Stop before sending another local-model message.";
  }
  if (error?.includes("LOCAL_MODEL_CANCELLED")) {
    return "Phone Gemma generation was cancelled before it finished.";
  }
  if (/daemon timeout/i.test(error || "")) {
    return "Phone Gemma timed out before returning a response. Jarvis asked the Android app to cancel that local generation so it does not keep slowing the phone down.";
  }
  return error || "Android Local Gemma generation failed.";
}

async function sendAndroidLocalGemmaOp(
  userId: string,
  op: Parameters<AndroidLocalGemmaDaemonOp>[1],
  timeoutMs: number,
): Promise<DaemonOpResult> {
  if (daemonOpForTesting) return daemonOpForTesting(userId, op, timeoutMs);
  const { sendDaemonOp } = await import("../../daemon/bridge");
  return sendDaemonOp(userId, op, timeoutMs);
}

export class AndroidLocalGemmaProvider extends BaseProvider {
  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}

  async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    if (!params.userId) {
      throw new Error("Android Local Gemma requires an authenticated user and the Jarvis Android app device control connection.");
    }

    const useToolProtocol = shouldUseLocalToolProtocol(params);
    const prompt = (useToolProtocol ? toolPromptFromParams(params) : chatPromptFromParams(params)).trim();
    if (!prompt) {
      throw new Error("Android Local Gemma received an empty prompt.");
    }

    const requestId = `phone-gemma-${randomUUID()}`;
    const result = await sendAndroidLocalGemmaOp(
      params.userId,
      {
        type: "android_local_model_generate",
        requestId,
        model: normalizeAndroidLocalGemmaModel(params.model),
        prompt,
        contextTokens: phoneGemmaContextTokens(),
        maxTokens: phoneGemmaMaxCompletionTokens(params.maxCompletionTokens),
      },
      phoneGemmaTimeoutMs(),
    );

    if (shouldCancelTimedOutGeneration(result)) {
      sendAndroidLocalGemmaOp(
        params.userId,
        { type: "android_local_model_cancel", requestId },
        5_000,
      ).catch(() => {});
    }

    if (!result.ok) {
      throw new Error(normalizeAndroidLocalGemmaError(result.error));
    }

    const text = textFromDaemonData(result.data);
    if (!text.trim()) {
      throw new Error("Phone Gemma finished without response text. The phone-local model may have been interrupted or run out of memory; retry after closing other apps.");
    }

    if (useToolProtocol) {
      const parsed = parseLocalGemmaStructuredOutput(text);
      if (parsed.type === "tool_calls") {
        if (parsed.toolCalls.length === 0) {
          throw new Error("Phone Gemma returned a tool-call response without a valid local tool call.");
        }
        for (const [index, toolCall] of parsed.toolCalls.entries()) {
          yield {
            type: "tool_call_start",
            index,
            id: toolCall.id,
            name: toolCall.function.name,
          };
          yield {
            type: "tool_call_args",
            index,
            args: toolCall.function.arguments,
          };
        }
        yield { type: "finish", reason: "tool_calls" };
        return;
      }

      if (params.toolChoice === "required") {
        throw new Error("Phone Gemma returned a final answer when the local harness required a tool call. No cloud model was used.");
      }

      if (parsed.content.trim()) {
        yield { type: "text", delta: parsed.content };
        yield { type: "finish", reason: finishReasonFromDaemonData(result.data) };
        return;
      }
    }

    yield { type: "text", delta: text };
    yield { type: "finish", reason: finishReasonFromDaemonData(result.data) };
  }
}
