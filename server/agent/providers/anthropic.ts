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

let anthropicFetchForTesting: FetchLike | null = null;
let anthropicCredentialResolverForTesting: CredentialResolver | null = null;

export function _setAnthropicFetchForTesting(fetchImpl: FetchLike | null): void {
  anthropicFetchForTesting = fetchImpl;
}

export function _setAnthropicCredentialResolverForTesting(resolver: CredentialResolver | null): void {
  anthropicCredentialResolverForTesting = resolver;
}

function fetchImpl(): FetchLike {
  return anthropicFetchForTesting ?? fetch;
}

function normalizeAnthropicModel(model: string): string {
  return model.startsWith("anthropic/") ? model.slice("anthropic/".length) : model;
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

function toAnthropicMessages(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  const system: string[] = [];
  const converted: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      const text = textFromContent(message.content);
      if (text) system.push(text);
      continue;
    }

    if (message.role === "tool") {
      converted.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: textFromContent(message.content),
        }],
      });
      continue;
    }

    if (message.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      const text = textFromContent(message.content);
      if (text) content.push({ type: "text", text });
      for (const toolCall of message.tool_calls ?? []) {
        if (toolCall.type !== "function") continue;
        let input: unknown = {};
        try {
          input = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          input = {};
        }
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input,
        });
      }
      converted.push({ role: "assistant", content: content.length ? content : "" });
      continue;
    }

    const text = textFromContent(message.content);
    if (text) converted.push({ role: "user", content: text });
  }

  return { system: system.join("\n\n"), messages: converted };
}

function toAnthropicTools(tools?: OpenAI.Chat.Completions.ChatCompletionTool[]) {
  return tools
    ?.filter(isFunctionTool)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters ?? { type: "object", properties: {} },
    }));
}

function toAnthropicToolChoice(toolChoice: ProviderQueryParams["toolChoice"], hasTools: boolean) {
  if (!hasTools || toolChoice === "none") return undefined;
  if (toolChoice === "required") return { type: "any" };
  return { type: "auto" };
}

async function resolveApiKey(userId: string | undefined): Promise<string> {
  if (userId) {
    const resolver = anthropicCredentialResolverForTesting ?? getProviderCredential;
    const credential = await resolver({
      userId,
      provider: "anthropic",
      preferredAuthType: "api_key",
      allowAuthTypeFallback: false,
    });
    if (credential?.credential) return credential.credential;
  }

  const envKey = getProviderEnvValue("ANTHROPIC_API_KEY", "AI_INTEGRATIONS_ANTHROPIC_API_KEY");
  if (envKey) return envKey;
  throw new Error("Anthropic API key is not connected for this Jarvis account");
}

export class AnthropicProvider extends BaseProvider {
  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}

  async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    const apiKey = await resolveApiKey(params.userId);
    const converted = toAnthropicMessages(params.messages);
    const tools = toAnthropicTools(params.tools);
    const body: Record<string, unknown> = {
      model: normalizeAnthropicModel(params.model),
      max_tokens: params.maxCompletionTokens,
      messages: converted.messages,
    };
    if (converted.system) body.system = converted.system;
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = toAnthropicToolChoice(params.toolChoice, true);
    }

    const response = await fetchImpl()("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data?.error?.message === "string" ? data.error.message : response.statusText;
      const err = new Error(`Anthropic request failed (${response.status}): ${message}`);
      (err as Error & { status?: number }).status = response.status;
      throw err;
    }

    const content = Array.isArray(data?.content) ? data.content : [];
    for (let i = 0; i < content.length; i++) {
      const part = content[i];
      if (part?.type === "text" && typeof part.text === "string") {
        yield { type: "text", delta: part.text };
      }
      if (part?.type === "tool_use" && typeof part.name === "string") {
        yield { type: "tool_call_start", index: i, id: String(part.id ?? `anthropic-tool-${i}`), name: part.name };
        yield { type: "tool_call_args", index: i, args: JSON.stringify(part.input ?? {}) };
      }
    }
    yield { type: "finish", reason: typeof data?.stop_reason === "string" ? data.stop_reason : null };
  }
}
