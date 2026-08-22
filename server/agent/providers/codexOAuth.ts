import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OpenAI from "openai";
import { BaseProvider, isJsonObjectResponseFormat } from "./base";
import type { ProviderChunk, ProviderQueryParams } from "./base";
import { buildCodexSpawnCommand } from "./codexCommand";
import { getCodexOAuthCommand } from "./env";
import { fetchCodexGateway } from "../codexGatewayFetch";
import {
  getProviderCredential,
  readChatGPTAuthTokenClaims,
  refreshProviderOAuthCredential,
  type GetProviderCredentialInput,
  type ProviderCredential,
} from "./modelProviderAuthProfiles";
import {
  runHostedCodexPrompt,
  type HostedCodexAuthTokens,
  type RunHostedCodexPromptInput,
} from "./codexHostedAppServer";

const CODEX_EXEC_TIMEOUT_MS = Number(process.env.JARVIS_CODEX_EXEC_TIMEOUT_MS ?? 300_000);
const CODEX_GATEWAY_TIMEOUT_MS = Number(process.env.JARVIS_CODEX_GATEWAY_TIMEOUT_MS ?? 120_000);
const CODEX_GATEWAY_RETRY_COUNT = Math.max(0, Number(process.env.JARVIS_CODEX_GATEWAY_RETRY_COUNT ?? 2));
const CODEX_GATEWAY_RETRY_BASE_DELAY_MS = Math.max(0, Number(process.env.JARVIS_CODEX_GATEWAY_RETRY_BASE_DELAY_MS ?? 1500));
const CODEX_DAEMON_TIMEOUT_MS = Number(process.env.JARVIS_CODEX_DAEMON_TIMEOUT_MS ?? CODEX_EXEC_TIMEOUT_MS + 15_000);
const CODEX_DAEMON_APP_SERVER_TIMEOUT_MS = Number(process.env.JARVIS_CODEX_DAEMON_APP_SERVER_TIMEOUT_MS ?? CODEX_DAEMON_TIMEOUT_MS);
const CODEX_OAUTH_PROVIDER_BUILD = "daemon-app-server-runtime-2026-06-02";

console.log(`[CodexOAuth] provider build=${CODEX_OAUTH_PROVIDER_BUILD}`);

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
    } | {
      type: "codex_oauth_app_server_prompt";
      prompt: string;
      command?: string;
      timeoutMs?: number;
    } | { type: "codex_oauth_cancel" },
    timeoutMs?: number,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }>;
}

type CodexOAuthRuntimePreference = "auto" | "gateway" | "daemon";
type CodexOAuthSelectedRuntime = "gateway" | "daemon" | null;

export interface CodexOAuthRuntimeStatus {
  available: boolean;
  runtimePreference: CodexOAuthRuntimePreference;
  selectedRuntime: CodexOAuthSelectedRuntime;
  gatewayConfigured: boolean;
  gatewayTokenConfigured: boolean;
  daemonEnabled: boolean;
  daemonActive: boolean;
  daemonShellAllowed: boolean;
  resolvedUserId: string | null;
  reason: string;
  action: string;
}

let daemonBridgeForTesting: CodexOAuthDaemonBridge | null = null;
type ProviderCredentialResolver = (input: GetProviderCredentialInput) => Promise<ProviderCredential | null>;
type ProviderCredentialRefresher = (input: { userId: string; provider?: string }) => Promise<ProviderCredential>;
type HostedCodexPromptRunner = (input: RunHostedCodexPromptInput) => Promise<string>;

let providerCredentialResolverForTesting: ProviderCredentialResolver | null = null;
let providerCredentialRefresherForTesting: ProviderCredentialRefresher | null = null;
let hostedCodexPromptRunnerForTesting: HostedCodexPromptRunner | null = null;

export function _setCodexOAuthDaemonBridgeForTesting(bridge: CodexOAuthDaemonBridge | null): void {
  daemonBridgeForTesting = bridge;
}

export function _setCodexOAuthHostedRuntimeForTesting(input: {
  credentialResolver?: ProviderCredentialResolver | null;
  credentialRefresher?: ProviderCredentialRefresher | null;
  promptRunner?: HostedCodexPromptRunner | null;
} | null): void {
  providerCredentialResolverForTesting = input?.credentialResolver ?? null;
  providerCredentialRefresherForTesting = input?.credentialRefresher ?? null;
  hostedCodexPromptRunnerForTesting = input?.promptRunner ?? null;
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

function isCodexDaemonAppServerEnabled(): boolean {
  const raw = process.env.JARVIS_CODEX_DAEMON_APP_SERVER_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function isUnknownDaemonOpError(result: { ok: boolean; data?: unknown; error?: string }): boolean {
  const message = String(result.error || "");
  return /unknown op type codex_oauth_app_server_prompt/i.test(message);
}

function getCodexRuntimePreference(): CodexOAuthRuntimePreference {
  const raw = process.env.JARVIS_CODEX_RUNTIME?.trim().toLowerCase();
  if (raw === "daemon" || raw === "desktop-daemon" || raw === "desktop_daemon") return "daemon";
  if (raw === "gateway" || raw === "tailscale-gateway" || raw === "tailscale_gateway") return "gateway";
  return "auto";
}

function buildRuntimeStatus(params: Partial<CodexOAuthRuntimeStatus> = {}): CodexOAuthRuntimeStatus {
  return {
    available: false,
    runtimePreference: getCodexRuntimePreference(),
    selectedRuntime: null,
    gatewayConfigured: !!getCodexGatewayUrl(),
    gatewayTokenConfigured: !!getCodexGatewayToken(),
    daemonEnabled: isCodexDaemonRuntimeEnabled(),
    daemonActive: false,
    daemonShellAllowed: false,
    resolvedUserId: null,
    reason: "Codex OAuth provider has no available runtime.",
    action: "Connect the Desktop Daemon with Shell Execution enabled, or configure a Codex gateway URL and token.",
    ...params,
  };
}

function formatCodexRuntimeStatusMessage(status: CodexOAuthRuntimeStatus): string {
  return `${missingCodexGatewayMessage()} ${status.reason} ${status.action}`.replace(/\s+/g, " ").trim();
}

function formatCodexRuntimeFailureMessage(status: CodexOAuthRuntimeStatus, detail: string): string {
  const runtime = status.selectedRuntime === "daemon"
    ? "Desktop daemon Codex OAuth runtime"
    : status.selectedRuntime === "gateway"
      ? "Codex gateway runtime"
      : "Codex OAuth runtime";
  const action = status.selectedRuntime === "daemon"
    ? "Reconnect the Desktop Daemon on the machine where Codex is logged in, then retry."
    : status.action;
  return `${runtime} was selected but the request failed. ${detail} ${action}`.replace(/\s+/g, " ").trim();
}

export async function getCodexOAuthRuntimeStatus(userId?: string): Promise<CodexOAuthRuntimeStatus> {
  const runtimePreference = getCodexRuntimePreference();
  const gatewayUrl = getCodexGatewayUrl();
  const gatewayToken = getCodexGatewayToken();
  const gatewayConfigured = !!gatewayUrl;
  const gatewayTokenConfigured = !!gatewayToken;
  const daemonEnabled = isCodexDaemonRuntimeEnabled();

  if (runtimePreference === "gateway" || (runtimePreference === "auto" && gatewayConfigured)) {
    if (!gatewayConfigured) {
      return buildRuntimeStatus({
        runtimePreference,
        selectedRuntime: "gateway",
        gatewayConfigured,
        gatewayTokenConfigured,
        daemonEnabled,
        reason: "JARVIS_CODEX_RUNTIME=gateway was selected but JARVIS_CODEX_GATEWAY_URL is missing.",
        action: "Set JARVIS_CODEX_GATEWAY_URL and JARVIS_CODEX_GATEWAY_TOKEN, or set JARVIS_CODEX_RUNTIME=daemon.",
      });
    }
    if (!gatewayTokenConfigured) {
      return buildRuntimeStatus({
        runtimePreference,
        selectedRuntime: "gateway",
        gatewayConfigured,
        gatewayTokenConfigured,
        daemonEnabled,
        reason: "JARVIS_CODEX_GATEWAY_URL is set but JARVIS_CODEX_GATEWAY_TOKEN is missing.",
        action: "Set JARVIS_CODEX_GATEWAY_TOKEN, or remove the gateway URL and use the Desktop Daemon runtime.",
      });
    }
    return buildRuntimeStatus({
      available: true,
      runtimePreference,
      selectedRuntime: "gateway",
      gatewayConfigured,
      gatewayTokenConfigured,
      daemonEnabled,
      reason: "Codex gateway runtime is configured.",
      action: "No action required.",
    });
  }

  if (!daemonEnabled) {
    return buildRuntimeStatus({
      runtimePreference,
      gatewayConfigured,
      gatewayTokenConfigured,
      daemonEnabled,
      reason: "Desktop daemon Codex OAuth runtime is disabled by JARVIS_CODEX_DAEMON_ENABLED.",
      action: "Enable JARVIS_CODEX_DAEMON_ENABLED or configure a Codex gateway URL and token.",
    });
  }

  const bridge = await getCodexOAuthDaemonBridge();
  let resolvedUserId = userId?.trim() || null;
  if (!resolvedUserId && bridge.listPairedUsers) {
    const activeDesktopUsers = bridge.listPairedUsers().filter((candidateUserId) =>
      bridge.isDesktopDaemonActive(candidateUserId),
    );
    if (activeDesktopUsers.length === 1) {
      resolvedUserId = activeDesktopUsers[0];
    } else if (activeDesktopUsers.length > 1) {
      return buildRuntimeStatus({
        runtimePreference,
        selectedRuntime: "daemon",
        gatewayConfigured,
        gatewayTokenConfigured,
        daemonEnabled,
        daemonActive: true,
        reason: "Multiple Desktop Daemons are active and no userId was supplied.",
        action: "Route the chat turn with a userId so Jarvis can select the right Desktop Daemon.",
      });
    }
  }

  if (!resolvedUserId) {
    return buildRuntimeStatus({
      runtimePreference,
      selectedRuntime: "daemon",
      gatewayConfigured,
      gatewayTokenConfigured,
      daemonEnabled,
      reason: "No user-scoped Desktop Daemon could be selected for the chat turn.",
      action: "Sign in, connect the Desktop Daemon for this account, or configure a Codex gateway URL and token.",
    });
  }

  const daemonActive = bridge.isDesktopDaemonActive(resolvedUserId);
  if (!daemonActive) {
    return buildRuntimeStatus({
      runtimePreference,
      selectedRuntime: "daemon",
      gatewayConfigured,
      gatewayTokenConfigured,
      daemonEnabled,
      daemonActive,
      resolvedUserId,
      reason: "The Desktop Daemon is not currently connected for this user.",
      action: "Open the Desktop Daemon and reconnect it from Profile -> Connected Channels.",
    });
  }

  const daemonShellAllowed = await bridge.isDaemonActionAllowed(resolvedUserId, "shell").catch(() => false);
  if (!daemonShellAllowed) {
    return buildRuntimeStatus({
      runtimePreference,
      selectedRuntime: "daemon",
      gatewayConfigured,
      gatewayTokenConfigured,
      daemonEnabled,
      daemonActive,
      daemonShellAllowed,
      resolvedUserId,
      reason: "The Desktop Daemon is connected, but Shell Execution is disabled.",
      action: "Enable Shell Execution in Profile -> Connected Channels -> Desktop Daemon, then retry chat.",
    });
  }

  return buildRuntimeStatus({
    available: true,
    runtimePreference,
    selectedRuntime: "daemon",
    gatewayConfigured,
    gatewayTokenConfigured,
    daemonEnabled,
    daemonActive,
    daemonShellAllowed,
    resolvedUserId,
    reason: "Desktop daemon Codex OAuth runtime is ready.",
    action: "No action required.",
  });
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
  const structuredOutputInstruction = isJsonObjectResponseFormat(params.responseFormat)
    ? "The caller requires response_format=json_object. Return only a single valid JSON object as the assistant message content, with no markdown, code fences, commentary, or text outside the JSON object."
    : "";
  const statelessInstruction = "This provider request is stateless. Ignore prior messages in this Codex runtime thread and answer only from the latest serialized conversation below.";
  const toolProtocol = hasTools
    ? [
        "You are Jarvis's main brain orchestrator using ChatGPT/Codex OAuth.",
        statelessInstruction,
        structuredOutputInstruction,
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
        statelessInstruction,
        structuredOutputInstruction,
        "Answer the latest user request using the conversation below.",
      ].filter(Boolean).join("\n");

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

function abortableDaemonResult<T>(promise: Promise<T>, signal?: AbortSignal, onAbort?: () => void): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Codex OAuth provider aborted", "AbortError"));

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      try { onAbort?.(); } catch { /* best-effort cleanup */ }
      reject(new DOMException("Codex OAuth provider aborted", "AbortError"));
    };
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

async function sendDaemonCodexPrompt(
  bridge: CodexOAuthDaemonBridge,
  userId: string,
  op: {
    type: "codex_oauth_prompt" | "codex_oauth_app_server_prompt";
    prompt: string;
    command?: string;
    timeoutMs?: number;
  },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return abortableDaemonResult(
    bridge.sendDaemonOp(userId, op, timeoutMs),
    signal,
    () => {
      bridge.sendDaemonOp(userId, { type: "codex_oauth_cancel" }, 5_000).catch(() => {});
    },
  );
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

  const command = getCodexOAuthCommand();
  let result: { ok: boolean; data?: unknown; error?: string };
  if (isCodexDaemonAppServerEnabled()) {
    result = await sendDaemonCodexPrompt(
      bridge,
      userId,
      {
        type: "codex_oauth_app_server_prompt",
        prompt,
        command,
        timeoutMs: CODEX_EXEC_TIMEOUT_MS,
      },
      CODEX_DAEMON_APP_SERVER_TIMEOUT_MS,
      signal,
    );
    if (!result.ok && !isUnknownDaemonOpError(result)) {
      console.warn(`[CodexOAuth] warm desktop app-server failed; falling back to cold codex exec: ${result.error || "unknown daemon error"}`);
    }
    if (result.ok) {
      const content = contentFromDaemonResult(result.data);
      if (content) return content;
      console.warn("[CodexOAuth] warm desktop app-server returned no content; falling back to cold codex exec.");
    }
  } else {
    result = { ok: false, error: "warm app-server disabled" };
  }

  result = await sendDaemonCodexPrompt(
    bridge,
    userId,
    {
      type: "codex_oauth_prompt",
      prompt,
      command,
      timeoutMs: CODEX_EXEC_TIMEOUT_MS,
    },
    CODEX_DAEMON_TIMEOUT_MS,
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

function hostedTokensFromCredential(credential: ProviderCredential): HostedCodexAuthTokens {
  const claims = readChatGPTAuthTokenClaims(credential.credential);
  const chatgptAccountId = claims.accountId ?? credential.accountId;
  if (!chatgptAccountId) {
    throw new Error("The saved ChatGPT subscription profile is missing its ChatGPT account id. Reconnect the subscription in Settings.");
  }
  return {
    accessToken: credential.credential,
    chatgptAccountId,
    chatgptPlanType: claims.planType,
  };
}

async function getHostedSubscriptionCredential(userId: string): Promise<ProviderCredential | null> {
  const resolver = providerCredentialResolverForTesting ?? getProviderCredential;
  return resolver({
    userId,
    provider: "openai",
    preferredAuthType: "oauth",
    allowAuthTypeFallback: false,
  });
}

async function refreshHostedSubscriptionCredential(userId: string): Promise<ProviderCredential> {
  const refresher = providerCredentialRefresherForTesting ?? refreshProviderOAuthCredential;
  return refresher({ userId, provider: "openai" });
}

async function runHostedUserCodexOAuthPrompt(
  userId: string,
  credential: ProviderCredential,
  prompt: string,
  signal?: AbortSignal,
  onDelta?: (delta: string) => void,
): Promise<string> {
  const runner = hostedCodexPromptRunnerForTesting ?? runHostedCodexPrompt;
  return runner({
    ...hostedTokensFromCredential(credential),
    prompt,
    signal,
    onDelta,
    refreshTokens: async () => hostedTokensFromCredential(await refreshHostedSubscriptionCredential(userId)),
  });
}

/**
 * Extracts the JSON `content` string from Codex's structured final-answer
 * envelope without waiting for the closing brace. Escape sequences are held
 * until complete so every emitted delta is valid display text.
 */
export class CodexFinalContentStreamParser {
  private buffer = "";
  private started = false;
  private finished = false;

  push(rawDelta: string): string {
    if (this.finished || !rawDelta) return "";
    this.buffer += rawDelta;

    if (!this.started) {
      // The prompt requires `type` as the envelope's first property. Anchoring
      // here prevents nested tool arguments named `content` from being emitted.
      const typeMatch = /^\s*(?:```(?:json)?\s*)?\{\s*"type"\s*:\s*"([^"]*)"/i.exec(this.buffer);
      if (!typeMatch) return "";
      if (typeMatch[1] !== "final") {
        this.finished = true;
        this.buffer = "";
        return "";
      }
      const contentMatch = /^\s*,\s*"content"\s*:\s*"/.exec(
        this.buffer.slice(typeMatch[0].length),
      );
      if (!contentMatch) return "";
      this.buffer = this.buffer.slice(typeMatch[0].length + contentMatch[0].length);
      this.started = true;
    }

    let output = "";
    let consumed = 0;
    while (consumed < this.buffer.length) {
      const char = this.buffer[consumed];
      if (char === '"') {
        this.finished = true;
        consumed += 1;
        break;
      }
      if (char !== "\\") {
        output += char;
        consumed += 1;
        continue;
      }

      if (consumed + 1 >= this.buffer.length) break;
      const escape = this.buffer[consumed + 1];
      if (escape === "u") {
        if (consumed + 6 > this.buffer.length) break;
        const hex = this.buffer.slice(consumed + 2, consumed + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          output += escape;
          consumed += 2;
          continue;
        }
        output += String.fromCharCode(Number.parseInt(hex, 16));
        consumed += 6;
        continue;
      }

      const decoded: Record<string, string> = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      output += decoded[escape] ?? escape;
      consumed += 2;
    }

    this.buffer = this.buffer.slice(consumed);
    return output;
  }
}

class AsyncTextDeltaQueue implements AsyncIterable<string> {
  private values: string[] = [];
  private waiters: Array<(result: IteratorResult<string>) => void> = [];
  private closed = false;

  push(value: string): void {
    if (this.closed || !value) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { value, done: false };
        if (this.closed) return { value: undefined, done: true };
        return new Promise<IteratorResult<string>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
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
    let answer: string;
    let streamedContent = "";
    if (params.userId && params.preferredAuthType === "oauth") {
      const credential = await getHostedSubscriptionCredential(params.userId);
      if (!credential || credential.authType !== "oauth") {
        throw new Error("ChatGPT subscription OAuth is selected but is not connected for this user.");
      }
      if (params.stream && params.toolChoice !== "required") {
        const queue = new AsyncTextDeltaQueue();
        const expectsOrchestratorEnvelope = !!params.tools?.length && params.toolChoice !== "none";
        const parser = expectsOrchestratorEnvelope ? new CodexFinalContentStreamParser() : null;
        const answerPromise = runHostedUserCodexOAuthPrompt(
          params.userId,
          credential,
          prompt,
          params.signal,
          (delta) => queue.push(delta),
        );
        void answerPromise.then(() => queue.close(), () => queue.close());
        for await (const rawDelta of queue) {
          const contentDelta = parser ? parser.push(rawDelta) : rawDelta;
          if (!contentDelta) continue;
          streamedContent += contentDelta;
          yield { type: "text", delta: contentDelta };
        }
        answer = await answerPromise;
      } else {
        answer = await runHostedUserCodexOAuthPrompt(params.userId, credential, prompt, params.signal);
      }
    } else {
      const runtimeStatus = await getCodexOAuthRuntimeStatus(params.userId);
      if (!runtimeStatus.available) {
        throw new Error(formatCodexRuntimeStatusMessage(runtimeStatus));
      }

      if (runtimeStatus.selectedRuntime === "daemon") {
        try {
          answer = await runDaemonCodexOAuthPrompt(runtimeStatus.resolvedUserId ?? params.userId, prompt, params.signal);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(formatCodexRuntimeFailureMessage(runtimeStatus, detail), { cause: error });
        }
      } else if (runtimeStatus.selectedRuntime === "gateway") {
        const gatewayUrl = getCodexGatewayUrl();
        if (!gatewayUrl) throw new Error("JARVIS_CODEX_RUNTIME=gateway requires JARVIS_CODEX_GATEWAY_URL.");
        answer = await runRemoteCodexOAuthPrompt(gatewayUrl, prompt, params.signal);
      } else {
        throw new Error(formatCodexRuntimeStatusMessage(runtimeStatus));
      }
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

    if (parsed.content) {
      if (!streamedContent) {
        yield { type: "text", delta: parsed.content };
      } else if (parsed.content.startsWith(streamedContent)) {
        const remainder = parsed.content.slice(streamedContent.length);
        if (remainder) yield { type: "text", delta: remainder };
      }
    }
    yield { type: "finish", reason: "stop" };
  }
}
