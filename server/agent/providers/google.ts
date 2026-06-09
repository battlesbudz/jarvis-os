import type OpenAI from "openai";
import { BaseProvider } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";
import { getProviderEnvValue } from "./env";
import {
  getProviderCredential,
  type GetProviderCredentialInput,
  type ProviderCredential,
} from "./modelProviderAuthProfiles";

type FetchLike = typeof fetch;
type CredentialResolver = (input: GetProviderCredentialInput) => Promise<ProviderCredential | null>;
const GOOGLE_TOOL_CALL_ID_PREFIX = "google-tool:";

let googleFetchForTesting: FetchLike | null = null;
let googleCredentialResolverForTesting: CredentialResolver | null = null;

export function _setGoogleFetchForTesting(fetchImpl: FetchLike | null): void {
  googleFetchForTesting = fetchImpl;
}

export function _setGoogleCredentialResolverForTesting(resolver: CredentialResolver | null): void {
  googleCredentialResolverForTesting = resolver;
}

function fetchImpl(): FetchLike {
  return googleFetchForTesting ?? fetch;
}

function normalizeGoogleModel(model: string): string {
  return model.startsWith("google/") ? model.slice("google/".length) : model;
}

function encodeGoogleToolCallId(index: number, name: string): string {
  return `${GOOGLE_TOOL_CALL_ID_PREFIX}${index}:${encodeURIComponent(name)}`;
}

function decodeGoogleToolCallName(toolCallId: string): string {
  if (!toolCallId.startsWith(GOOGLE_TOOL_CALL_ID_PREFIX)) return toolCallId;
  const encodedName = toolCallId.slice(GOOGLE_TOOL_CALL_ID_PREFIX.length).split(":").slice(1).join(":");
  if (!encodedName) return toolCallId;
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return toolCallId;
  }
}

function normalizeGoogleFinishReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  switch (reason.toUpperCase()) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "content_filter";
    default:
      return "stop";
  }
}

function isFunctionTool(
  tool: OpenAI.Chat.Completions.ChatCompletionTool,
): tool is OpenAI.Chat.Completions.ChatCompletionFunctionTool {
  return tool.type === "function";
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

function toGoogleRequest(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  const system: string[] = [];
  const contents: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      const text = textFromContent(message.content);
      if (text) system.push(text);
      continue;
    }
    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: decodeGoogleToolCallName(message.tool_call_id),
            response: { result: textFromContent(message.content) },
          },
        }],
      });
      continue;
    }
    if (message.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      const text = textFromContent(message.content);
      if (text) parts.push({ text });
      for (const toolCall of message.tool_calls ?? []) {
        if (toolCall.type !== "function") continue;
        let args: unknown = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: toolCall.function.name, args } });
      }
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }

    const text = textFromContent(message.content);
    if (text) contents.push({ role: "user", parts: [{ text }] });
  }

  return {
    systemInstruction: system.length ? { parts: system.map((text) => ({ text })) } : undefined,
    contents,
  };
}

function toGoogleTools(tools?: OpenAI.Chat.Completions.ChatCompletionTool[]) {
  if (!tools?.length) return undefined;
  const functionTools = tools.filter(isFunctionTool);
  if (!functionTools.length) return undefined;
  return [{
    functionDeclarations: functionTools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ?? { type: "object", properties: {} },
    })),
  }];
}

async function resolveApiKey(userId: string | undefined): Promise<string> {
  if (userId) {
    const resolver = googleCredentialResolverForTesting ?? getProviderCredential;
    const credential = await resolver({
      userId,
      provider: "google",
      preferredAuthType: "api_key",
      allowAuthTypeFallback: false,
    });
    if (credential?.credential) return credential.credential;
  }

  const envKey = getProviderEnvValue("GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY");
  if (envKey) return envKey;
  throw new Error("Google Gemini API key is not connected for this Jarvis account");
}

export class GoogleProvider extends BaseProvider {
  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}

  async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    const apiKey = await resolveApiKey(params.userId);
    const model = normalizeGoogleModel(params.model);
    const request = toGoogleRequest(params.messages);
    const tools = toGoogleTools(params.tools);
    const body: Record<string, unknown> = {
      contents: request.contents,
      generationConfig: {
        maxOutputTokens: params.maxCompletionTokens,
      },
    };
    if (request.systemInstruction) body.systemInstruction = request.systemInstruction;
    if (tools) {
      body.tools = tools;
      if (params.toolChoice === "required") {
        body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
      } else if (params.toolChoice === "none") {
        body.toolConfig = { functionCallingConfig: { mode: "NONE" } };
      }
    }

    const response = await fetchImpl()(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      },
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data?.error?.message === "string" ? data.error.message : response.statusText;
      const err = new Error(`Google Gemini request failed (${response.status}): ${message}`);
      (err as Error & { status?: number }).status = response.status;
      throw err;
    }

    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    let hasFunctionCall = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof part?.text === "string") {
        yield { type: "text", delta: part.text };
      }
      if (part?.functionCall && typeof part.functionCall.name === "string") {
        hasFunctionCall = true;
        yield {
          type: "tool_call_start",
          index: i,
          id: encodeGoogleToolCallId(i, part.functionCall.name),
          name: part.functionCall.name,
        };
        yield { type: "tool_call_args", index: i, args: JSON.stringify(part.functionCall.args ?? {}) };
      }
    }
    yield {
      type: "finish",
      reason: hasFunctionCall ? "tool_calls" : normalizeGoogleFinishReason(candidate?.finishReason),
    };
  }
}
