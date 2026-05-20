import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCodexSpawnCommand } from "./providers/codexCommand";
import { getCodexOAuthCommand } from "./providers/env";

export type CodexDelegationSandbox = "read-only" | "workspace-write";

export interface CodexDelegationPromptInput {
  task: string;
  context?: string;
  allowExternalSideEffects?: boolean;
}

export interface CodexDelegationRequest extends CodexDelegationPromptInput {
  cwd: string;
  sandbox: CodexDelegationSandbox;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface CodexDelegationResult {
  content: string;
  cwd: string;
  sandbox: CodexDelegationSandbox;
  durationMs: number;
}

type CodexDelegationRunner = (request: CodexDelegationRequest) => Promise<CodexDelegationResult>;

const MAX_OUTPUT_CHARS = 20_000;
let runnerOverride: CodexDelegationRunner | null = null;

export function isCodexDelegationEnabled(): boolean {
  return Boolean(getCodexGatewayUrl()) ||
    isLocalCodexDelegationEnabled();
}

export function isLocalCodexDelegationEnabled(): boolean {
  return (
    process.env.JARVIS_CODEX_OAUTH_ENABLED === "true" ||
    process.env.JARVIS_CODEX_OAUTH_ENABLED === "1"
  );
}

function getCodexGatewayUrl(): string | null {
  const raw = process.env.JARVIS_CODEX_GATEWAY_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function getCodexGatewayToken(): string | null {
  return process.env.JARVIS_CODEX_GATEWAY_TOKEN?.trim() || null;
}

function truncateForTool(content: string): string {
  if (content.length <= MAX_OUTPUT_CHARS) return content;
  return `${content.slice(0, MAX_OUTPUT_CHARS)}\n...[Codex output truncated]`;
}

function abortError(): Error {
  const err = new Error("Codex delegation aborted");
  err.name = "AbortError";
  return err;
}

export function buildCodexDelegationPrompt(input: CodexDelegationPromptInput): string {
  const sideEffectBoundary = input.allowExternalSideEffects
    ? [
        "External side effects are allowed only where the user explicitly requested them in this task.",
        "For repo changes the user asked to make permanent, verify the work, commit the scoped changes, and push the target branch when that push was explicitly requested.",
        "Before any irreversible action, use Codex's normal approval and safety behavior.",
      ].join("\n")
    : [
        "Do not send, post, delete, purchase, deploy, merge, commit, or mutate external systems.",
        "For repo changes, leave edits local and report that commit/push still needs explicit approval.",
        "If the task requires an external side effect, stop and explain what approval is needed.",
      ].join("\n");

  return [
    "You are Codex running as a controlled delegate for Jarvis.",
    "Use Codex-side tools, configured MCP servers, local CLI tools, and repository context when useful.",
    "Complete only the task below and return a concise, useful result for Jarvis to show the user.",
    "Do not expose credentials, OAuth tokens, secret values, or raw private config.",
    sideEffectBoundary,
    "",
    "Task:",
    input.task.trim(),
    "",
    "Context:",
    input.context?.trim() || "No extra context provided.",
  ].join("\n");
}

export function resolveCodexDelegationCwd(requestedCwd: unknown): string {
  const projectRoot = path.resolve(process.cwd());
  const raw = typeof requestedCwd === "string" ? requestedCwd.trim() : "";
  if (!raw) return projectRoot;

  const resolved = path.resolve(projectRoot, raw);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Codex delegation working_directory resolves outside the Jarvis workspace.");
  }
  return resolved;
}

export function normalizeCodexDelegationSandbox(value: unknown): CodexDelegationSandbox {
  return value === "workspace-write" ? "workspace-write" : "read-only";
}

export function normalizeCodexDelegationTimeoutMs(value: unknown): number {
  const seconds = Number(value ?? 300);
  if (!Number.isFinite(seconds)) return 300_000;
  return Math.round(Math.min(Math.max(seconds, 5), 600) * 1000);
}

async function runRemoteCodexDelegation(
  gatewayUrl: string,
  request: CodexDelegationRequest,
): Promise<CodexDelegationResult> {
  const token = getCodexGatewayToken();
  if (!token) {
    throw new Error("JARVIS_CODEX_GATEWAY_TOKEN is required when JARVIS_CODEX_GATEWAY_URL is set.");
  }

  const relativeCwd = path.relative(path.resolve(process.cwd()), request.cwd);
  const workingDirectory = relativeCwd && !relativeCwd.startsWith("..") && !path.isAbsolute(relativeCwd)
    ? relativeCwd
    : "";

  const response = await fetch(`${gatewayUrl}/api/codex/delegate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task: request.task,
      context: request.context,
      sandbox: request.sandbox,
      working_directory: workingDirectory,
      timeout_seconds: Math.ceil(request.timeoutMs / 1000),
      allow_external_side_effects: request.allowExternalSideEffects === true,
    }),
    signal: request.signal,
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

  return {
    content: truncateForTool(String(payload.content || "")),
    cwd: String(payload.cwd || request.cwd),
    sandbox: payload.sandbox === "workspace-write" ? "workspace-write" : "read-only",
    durationMs: Number(payload.durationMs || 0),
  };
}

export async function runLocalCodexDelegation(request: CodexDelegationRequest): Promise<CodexDelegationResult> {
  if (!isLocalCodexDelegationEnabled()) {
    throw new Error("Codex delegation is not enabled on this host.");
  }

  const startedAt = Date.now();
  const dir = await mkdtemp(path.join(tmpdir(), "jarvis-codex-delegate-"));
  const outputPath = path.join(dir, "answer.txt");
  const prompt = buildCodexDelegationPrompt(request);

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const codex = buildCodexSpawnCommand(getCodexOAuthCommand(), [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        request.sandbox,
        "--cd",
        request.cwd,
        "--output-last-message",
        outputPath,
        "-",
      ]);
      const child = spawn(
        codex.command,
        codex.args,
        {
          cwd: request.cwd,
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        },
      );

      let stdoutText = "";
      let stderrText = "";
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        fn();
      };

      const onAbort = (): void => {
        child.kill();
        finish(() => reject(abortError()));
      };

      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error("Codex delegation timed out.")));
      }, request.timeoutMs);

      request.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutText += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrText += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        finish(() => reject(error));
      });
      child.on("close", (code) => {
        finish(() => {
          if (code === 0) resolve(stdoutText);
          else reject(new Error((stderrText || stdoutText || `Codex delegation exited with ${code}.`).trim()));
        });
      });
      child.stdin.end(prompt);
    });

    let content = "";
    try {
      content = (await readFile(outputPath, "utf8")).trim();
    } catch {
      content = stdout.trim();
    }

    return {
      content: truncateForTool(content || stdout.trim()),
      cwd: request.cwd,
      sandbox: request.sandbox,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

export async function runCodexDelegation(request: CodexDelegationRequest): Promise<CodexDelegationResult> {
  if (runnerOverride) return runnerOverride(request);
  const gatewayUrl = getCodexGatewayUrl();
  if (gatewayUrl) return runRemoteCodexDelegation(gatewayUrl, request);
  return runLocalCodexDelegation(request);
}

export function _setCodexDelegationRunnerForTest(runner: CodexDelegationRunner | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("_setCodexDelegationRunnerForTest must not be called in production");
  }
  runnerOverride = runner;
}
