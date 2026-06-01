import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OpenAI from "openai";
import { BaseProvider } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";
import { buildCodexSpawnCommand } from "./codexCommand";
import { getCodexOAuthCommand } from "./env";
import { fetchCodexGateway } from "../codexGatewayFetch";

const CODEX_EXEC_TIMEOUT_MS = Number(process.env.JARVIS_CODEX_EXEC_TIMEOUT_MS ?? 300_000);
const CODEX_GATEWAY_TIMEOUT_MS = Number(process.env.JARVIS_CODEX_GATEWAY_TIMEOUT_MS ?? 120_000);
const CODEX_GATEWAY_RETRY_COUNT = Math.max(0, Number(process.env.JARVIS_CODEX_GATEWAY_RETRY_COUNT ?? 2));
const CODEX_GATEWAY_RETRY_BASE_DELAY_MS = Math.max(0, Number(process.env.JARVIS_CODEX_GATEWAY_RETRY_BASE_DELAY_MS ?? 1500));
const CODEX_DAEMON_TIMEOUT_MS = Number(process.env.JARVIS_CODEX_DAEMON_TIMEOUT_MS ?? CODEX_EXEC_TIMEOUT_MS + 15_000);

export type CodexOAuthOrchestratorOutput =
  | { type: "final"; content: string }
  | { type: "tool_calls"; toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] };

export interface CodexOAuthDaemonBridge {
  isDesktopDaemonActive(userId: string): boolean;
  listPairedUsers?: () => string[];
  isDaemonActionAllowed(userId: string, action: "shell"): Promise<boolean>;
  sendDaemonOp(
    userId: string,
    op: {
      type: "codex_oauth_prompt";
      prompt: string;
      command?: string;
      timeoutMs?: number;
    },
    timeoutMs?: number,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }>;
}

let daemonBridgeForTesting: CodexOAuthDaemonBridge | null = null;

export function _setCodexOAuthDaemonBridgeForTesting(bridge: CodexOAuthDaemonBridge | null): void {
  daemonBridgeForTesting = bridge;
}

async function getCodexOAuthDaemonBridge(): Promise<CodexOAuthDaemonBridge> {
  if (daemonBridgeForTesting) return daemonBridgeForTesting;
  const bridge = await import("../../daemon/bridge");
  return {
    isDesktopDaemonActive: bridge.isDesktopDaemonActive,
    listPairedUsers: bridge.listPairedUsers,
    isDaemonActionAllowed: (userId, action) => bridge.isDaemonActionAllowed(userId, action),
    sendDaemonOp: bridge.sendDaemonOp,
  };
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

export function missingCodexGatewayMessage(): string {
  return [
    "Codex OAuth provider has no available runtime.",
    "Set JARVIS_CODEX_RUNTIME=daemon and connect the Desktop Daemon on the machine where Codex is logged in, or set JARVIS_CODEX_RUNTIME=gateway with JARVIS_CODEX_GATEWAY_URL and JARVIS_CODEX_GATEWAY_TOKEN.",
    "Jarvis will not charge an OpenAI API key for this route; it runs Codex OAuth through the configured gateway or paired desktop daemon.",
  ].join(" ");
}

function getCodexGatewayToken(): string | null {
  return process.env.JARVIS_CODEX_GATEWAY_TOKEN?.trim() || null;
}

function isCodexDaemonRuntimeEnabled(): boolean {
  const raw = process.env.JARVIS_CODEX_DAEMON_ENABLED?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

function getCodexRuntimePreference(): "auto" | "gateway" | "daemon" {
  const raw = process.env.JARVIS_CODEX_RUNTIME?.trim().toLowerCase();
  if (raw === "daemon" || raw === "desktop-daemon" || raw === "desktop_daemon") return "daemon";
  if (raw === "gateway" || raw === "tailscale-gateway" || raw === "tailscale_gateway") return "gateway";
  return "auto";
}

function missingCodexDaemonMessage(userId?: string): string {
  const userScope = userId
    ? "No active Desktop Daemon with Shell Execution is available for this user."
    : "No userId was supplied, so Jarvis cannot select a user-scoped Desktop Daemon.";
  return [
    userScope,
    "Connect the Desktop Daemon on the machine where `codex login` is active, enable Shell Execution in Connected Channels, or configure JARVIS_CODEX_GATEWAY_URL instead.",
  ].join(" ");
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeCodexGateway(gatewayUrl: string): string {
  try {
    const url = new URL(gatewayUrl);
    return url.host || gatewayUrl;
  } catch {
    return gatewayUrl;
  }
}

function isTransientGatewayError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|econnreset|etimedout|enotfound|eai_again|socket|terminated/i.test(message);
}

export function codexGatewayFailureMessage(gatewayUrl: string, error: unknown, attempts: number): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    `Codex gateway request failed after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${message}`,
    `Gateway: ${describeCodexGateway(gatewayUrl)}`,
    "Check that the gateway host is awake, Tailscale is connected, and the local Jarvis OAuth gateway process is running.",
  ].join(" | ");
}

function createLinkedAbortController(signal?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let didTimeout = false;

  const abortFromCaller = () => {
    controller.abort(new DOMException("Codex OAuth provider aborted", "AbortError"));
  };

  const timer = Number.isFinite(CODEX_GATEWAY_TIMEOUT_MS) && CODEX_GATEWAY_TIMEOUT_MS > 0
    ? setTimeout(() => {
        didTimeout = true;
        controller.abort(new Error(`Codex gateway timed out after ${CODEX_GATEWAY_TIMEOUT_MS}ms.`));
      }, CODEX_GATEWAY_TIMEOUT_MS)
    : null;

  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });

  return {
    controller,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    },
    timedOut: () => didTimeout,
  };
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
        "Tool result messages in the conversation are authoritative observations from Jarvis. Use them directly, and do not contradict a successful tool result.",
        "When a tool is needed, return ONLY JSON in this exact shape:",
        `{"type":"tool_calls","tool_calls":[{"name":"tool_name","arguments":{"key":"value"}}]}`,
        "When no tool is needed, return ONLY JSON in this exact shape:",
        `{"type":"final","content":"your reply to the user"}`,
        params.toolChoice === "required"
          ? "A tool call is required for this turn. Do not return a final answer."
          : "Use tools only when they are necessary to satisfy the user's request.",
        "Available tools:",
        JSON.stringify(
          params.tools?.flatMap((tool) => {
            if (tool.type !== "function") return [];
            return [{
              name: tool.function.name,
              description: tool.function.description,
              parameters: tool.function.parameters,
            }];
          }) ?? [],
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
      const codex = buildCodexSpawnCommand(command, [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-last-message",
        outputPath,
        "-",
      ]);
      const child = spawn(
        codex.command,
        codex.args,
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
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

  let lastError: unknown = null;
  const maxAttempts = CODEX_GATEWAY_RETRY_COUNT + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const linkedAbort = createLinkedAbortController(signal);
    let response: Response;
    let raw: string;
    try {
      response = await fetchCodexGateway(`${gatewayUrl}/api/codex/provider-turn`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
        signal: linkedAbort.controller.signal,
      });
      raw = await response.text();
    } catch (error) {
      if (signal?.aborted) {
        throw new DOMException("Codex OAuth provider aborted", "AbortError");
      }
      if (linkedAbort.timedOut()) {
        lastError = new Error(`Codex gateway timed out after ${CODEX_GATEWAY_TIMEOUT_MS}ms.`, { cause: error });
      } else {
        lastError = error;
      }
      linkedAbort.cleanup();

      if (attempt < maxAttempts && isTransientGatewayError(lastError)) {
        const delayMs = CODEX_GATEWAY_RETRY_BASE_DELAY_MS * attempt;
        console.warn(
          `[CodexOAuth] gateway request failed on attempt ${attempt}/${maxAttempts}; retrying in ${delayMs}ms: ${
            lastError instanceof Error ? lastError.message : String(lastError)
          }`,
        );
        await sleep(delayMs);
        continue;
      }

      throw new Error(codexGatewayFailureMessage(gatewayUrl, lastError, attempt), { cause: lastError });
    } finally {
      linkedAbort.cleanup();
    }

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

  throw new Error(codexGatewayFailureMessage(gatewayUrl, lastError, maxAttempts), { cause: lastError });
}

function abortableDaemonResult<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Codex OAuth provider aborted", "AbortError"));

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Codex OAuth provider aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function contentFromDaemonResult(data: unknown): string {
  if (typeof data === "string") return data.trim();
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const content = record.content ?? record.stdout ?? record.output;
  return typeof content === "string" ? content.trim() : "";
}

export async function runDaemonCodexOAuthPrompt(userId: string | undefined, prompt: string, signal?: AbortSignal): Promise<string> {
  if (!isCodexDaemonRuntimeEnabled()) {
    throw new Error("Desktop daemon Codex OAuth runtime is disabled by JARVIS_CODEX_DAEMON_ENABLED.");
  }
  const bridge = await getCodexOAuthDaemonBridge();
  if (!userId && bridge.listPairedUsers) {
    const activeDesktopUsers = bridge.listPairedUsers().filter((candidateUserId) =>
      bridge.isDesktopDaemonActive(candidateUserId),
    );
    if (activeDesktopUsers.length === 1) {
      userId = activeDesktopUsers[0];
      console.warn("[CodexOAuth] No userId supplied; using the single active desktop daemon user.");
    }
  }
  if (!userId) throw new Error(missingCodexDaemonMessage(userId));

  if (!bridge.isDesktopDaemonActive(userId)) throw new Error(missingCodexDaemonMessage(userId));

  const shellAllowed = await bridge.isDaemonActionAllowed(userId, "shell").catch(() => false);
  if (!shellAllowed) throw new Error(missingCodexDaemonMessage(userId));

  const result = await abortableDaemonResult(
    bridge.sendDaemonOp(
      userId,
      {
        type: "codex_oauth_prompt",
        prompt,
        command: getCodexOAuthCommand(),
        timeoutMs: CODEX_EXEC_TIMEOUT_MS,
      },
      CODEX_DAEMON_TIMEOUT_MS,
    ),
    signal,
  );

  if (!result.ok) {
    throw new Error(`Desktop daemon Codex OAuth failed: ${result.error || "unknown daemon error"}`);
  }

  const content = contentFromDaemonResult(result.data);
  if (!content) {
    throw new Error("Desktop daemon Codex OAuth returned no content.");
  }

  return content;
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
    const runtime = getCodexRuntimePreference();
    let answer: string;
    if (runtime === "daemon") {
      try {
        answer = await runDaemonCodexOAuthPrompt(params.userId, prompt, params.signal);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${missingCodexGatewayMessage()} ${detail}`, { cause: error });
      }
    } else if (runtime === "gateway") {
      if (!gatewayUrl) throw new Error("JARVIS_CODEX_RUNTIME=gateway requires JARVIS_CODEX_GATEWAY_URL.");
      answer = await runRemoteCodexOAuthPrompt(gatewayUrl, prompt, params.signal);
    } else if (gatewayUrl) {
      answer = await runRemoteCodexOAuthPrompt(gatewayUrl, prompt, params.signal);
    } else if (isCodexDaemonRuntimeEnabled()) {
      try {
        answer = await runDaemonCodexOAuthPrompt(params.userId, prompt, params.signal);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${missingCodexGatewayMessage()} ${detail}`, { cause: error });
      }
    } else {
      throw new Error(missingCodexGatewayMessage());
    }
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
