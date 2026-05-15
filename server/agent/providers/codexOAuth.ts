import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OpenAI from "openai";
import { BaseProvider } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";
import { getCodexOAuthCommand } from "./env";

const CODEX_EXEC_TIMEOUT_MS = Number(process.env.JARVIS_CODEX_EXEC_TIMEOUT_MS ?? 300_000);

export type CodexOAuthOrchestratorOutput =
  | { type: "final"; content: string }
  | { type: "tool_calls"; toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] };

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
  return `codex_call_${Date.now().toString(36)}_${index}`;
}

export function parseCodexOAuthOrchestratorOutput(raw: string): CodexOAuthOrchestratorOutput {
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

function getCodexGatewayUrl(): string | null {
  const raw = process.env.JARVIS_CODEX_GATEWAY_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function getCodexGatewayToken(): string | null {
  return process.env.JARVIS_CODEX_GATEWAY_TOKEN?.trim() || null;
}

export function buildCodexOAuthProviderPrompt(params: ProviderQueryParams): string {
  const sections = params.messages.map((message, index) => {
    const name = "name" in message && typeof message.name === "string" ? ` (${message.name})` : "";
    return `Message ${index + 1} [${message.role}${name}]\n${textFromContent(message.content)}`;
  });

  const hasTools = !!params.tools?.length && params.toolChoice !== "none";
  const toolProtocol = hasTools
    ? [
        "You are Jarvis's main brain orchestrator using ChatGPT/Codex OAuth.",
        "You may either answer directly or request Jarvis tool calls.",
        "You do not execute tools yourself. Jarvis executes tool calls after you request them.",
        "When a tool is needed, return ONLY JSON in this exact shape:",
        `{"type":"tool_calls","tool_calls":[{"name":"tool_name","arguments":{"key":"value"}}]}`,
        "When no tool is needed, return ONLY JSON in this exact shape:",
        `{"type":"final","content":"your reply to the user"}`,
        params.toolChoice === "required"
          ? "A tool call is required for this turn. Do not return a final answer."
          : "Use tools only when they are necessary to satisfy the user's request.",
        "Available tools:",
        JSON.stringify(
          params.tools?.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          })) ?? [],
          null,
          2,
        ),
      ].join("\n")
    : [
        "You are Jarvis's ChatGPT/Codex OAuth provider bridge.",
        "Answer the latest user request using the conversation below.",
      ].join("\n");

  return [
    toolProtocol,
    `Requested model hint: ${params.model}`,
    `Maximum completion tokens hint: ${params.maxCompletionTokens}`,
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");
}

export async function runCodexOAuthPrompt(command: string, prompt: string, signal?: AbortSignal): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-codex-oauth-"));
  const outputPath = join(dir, "answer.txt");

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        command,
        ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message", outputPath, "-"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stderr = "";
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        fn();
      };

      const abort = () => {
        child.kill();
        finish(() => reject(new DOMException("Codex OAuth provider aborted", "AbortError")));
      };

      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error("Codex OAuth provider timed out.")));
      }, CODEX_EXEC_TIMEOUT_MS);

      signal?.addEventListener("abort", abort, { once: true });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        finish(() => reject(error));
      });
      child.on("close", (code) => {
        finish(() => {
          if (code === 0) resolve();
          else reject(new Error(stderr || `Codex OAuth provider exited with ${code}.`));
        });
      });
      child.stdin.end(prompt);
    });

    return (await readFile(outputPath, "utf8")).trim();
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function runRemoteCodexOAuthPrompt(gatewayUrl: string, prompt: string, signal?: AbortSignal): Promise<string> {
  const token = getCodexGatewayToken();
  if (!token) throw new Error("JARVIS_CODEX_GATEWAY_TOKEN is required when JARVIS_CODEX_GATEWAY_URL is set.");

  const response = await fetch(`${gatewayUrl}/api/codex/provider-turn`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
    signal,
  });

  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: raw };
  }

  if (!response.ok) {
    throw new Error(String(payload.error || payload.message || `Codex gateway returned ${response.status}`));
  }

  return String(payload.content || "").trim();
}

export class CodexOAuthProvider extends BaseProvider {
  async initialize(): Promise<void> {
    // Codex is launched per request so it can use the host's current OAuth login.
  }

  async cleanup(): Promise<void> {
    // No persistent resources to release.
  }

  async *query(params: ProviderQueryParams): AsyncGenerator<ProviderChunk> {
    const prompt = buildCodexOAuthProviderPrompt(params);
    const gatewayUrl = getCodexGatewayUrl();
    const answer = gatewayUrl
      ? await runRemoteCodexOAuthPrompt(gatewayUrl, prompt, params.signal)
      : await runCodexOAuthPrompt(getCodexOAuthCommand(), prompt, params.signal);
    const parsed = parseCodexOAuthOrchestratorOutput(answer);

    if (parsed.type === "tool_calls") {
      if (parsed.toolCalls.length === 0) {
        throw new Error("Codex OAuth provider returned a tool_calls response without valid tool calls.");
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

    if (params.toolChoice === "required" && params.tools?.length) {
      throw new Error("Codex OAuth provider returned a final answer when a tool call was required.");
    }

    if (parsed.content) yield { type: "text", delta: parsed.content };
    yield { type: "finish", reason: "stop" };
  }
}
