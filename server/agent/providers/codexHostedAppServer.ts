import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCodexSpawnCommand } from "./codexCommand";
import { getCodexOAuthCommand } from "./env";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TURN_TIMEOUT_MS = Number(process.env.JARVIS_CODEX_EXEC_TIMEOUT_MS ?? 300_000);

type JsonRpcId = number;

interface JsonRpcMessage {
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ActiveTurn {
  turnId: string | null;
  content: string;
  error: string | null;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface HostedCodexAuthTokens {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType?: string | null;
}

export interface RunHostedCodexPromptInput extends HostedCodexAuthTokens {
  prompt: string;
  signal?: AbortSignal;
  command?: string;
  timeoutMs?: number;
  refreshTokens?: () => Promise<HostedCodexAuthTokens>;
  cwd?: string;
  sandbox?: "read-only" | "workspace-write";
  networkAccess?: boolean;
  baseInstructions?: string;
}

export interface HostedCodexAppServerProcess {
  child: ChildProcessWithoutNullStreams;
}

type HostedCodexProcessFactory = (
  command: string,
  args: string[],
  options: { cwd: string; codexHome: string },
) => HostedCodexAppServerProcess;

let processFactoryForTesting: HostedCodexProcessFactory | null = null;

export function _setHostedCodexProcessFactoryForTesting(factory: HostedCodexProcessFactory | null): void {
  processFactoryForTesting = factory;
}

function defaultProcessFactory(
  command: string,
  args: string[],
  options: { cwd: string; codexHome: string },
): HostedCodexAppServerProcess {
  const built = buildCodexSpawnCommand(command, args);
  return {
    child: spawn(built.command, built.args, {
      cwd: options.cwd,
      env: { ...process.env, CODEX_HOME: options.codexHome },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }),
  };
}

function appServerArgs(): string[] {
  const configured = process.env.JARVIS_CODEX_HOSTED_APP_SERVER_ARGS?.trim();
  if (configured) return configured.split(/\s+/).filter(Boolean);
  return [
    "app-server",
    "--listen",
    "stdio://",
    "--disable",
    "plugins",
    "--disable",
    "apps",
    "--disable",
    "browser_use",
    "--disable",
    "browser_use_external",
    "--disable",
    "computer_use",
    "--disable",
    "image_generation",
  ];
}

function cleanPlanType(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function loginParams(tokens: HostedCodexAuthTokens): Record<string, string> {
  return {
    type: "chatgptAuthTokens",
    accessToken: tokens.accessToken,
    chatgptAccountId: tokens.chatgptAccountId,
    ...(cleanPlanType(tokens.chatgptPlanType)
      ? { chatgptPlanType: cleanPlanType(tokens.chatgptPlanType)! }
      : {}),
  };
}

class HostedCodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private requestCounter = 0;
  private stdoutBuffer = "";
  private stderr = "";
  private activeTurn: ActiveTurn | null = null;
  private stopped = false;

  constructor(
    process: HostedCodexAppServerProcess,
    private readonly refreshTokens?: () => Promise<HostedCodexAuthTokens>,
  ) {
    this.child = process.child;
    this.child.stdout.on("data", (chunk) => this.handleStdout(String(chunk)));
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + String(chunk)).slice(-8_000);
    });
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code, signal) => {
      const detail = this.stderr.trim() || `Codex app-server exited (code=${code ?? "none"}, signal=${signal ?? "none"}).`;
      this.failAll(new Error(detail));
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline: number;
    while ((newline = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        void this.handleMessage(JSON.parse(line) as JsonRpcMessage);
      } catch {
        // App-server may emit non-protocol diagnostics. Never include token-bearing input in logs.
      }
    }
  }

  private async handleMessage(message: JsonRpcMessage): Promise<void> {
    if (message.method && message.id != null) {
      await this.handleServerRequest(message);
      return;
    }

    if (message.id != null) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || "Codex app-server request failed."));
      else pending.resolve(message.result);
      return;
    }

    if (!message.method || !this.activeTurn) return;
    if (message.method === "item/agentMessage/delta") {
      const turnId = typeof message.params?.turnId === "string" ? message.params.turnId : null;
      if (!this.activeTurn.turnId || !turnId || turnId === this.activeTurn.turnId) {
        this.activeTurn.content += String(message.params?.delta ?? "");
      }
      return;
    }

    if (message.method === "item/completed" && !this.activeTurn.content) {
      const item = message.params?.item;
      if (item?.type === "agentMessage") {
        this.activeTurn.content = String(item.text ?? item.content ?? "");
      }
      return;
    }

    if (message.method === "error") {
      const detail = message.params?.error?.message ?? message.params?.message ?? "Codex app-server turn failed.";
      this.activeTurn.error = String(detail);
      return;
    }

    if (message.method === "turn/completed") {
      const turn = message.params?.turn ?? {};
      if (this.activeTurn.turnId && turn.id && turn.id !== this.activeTurn.turnId) return;
      const active = this.activeTurn;
      this.activeTurn = null;
      clearTimeout(active.timer);
      const turnError = turn.error?.message || turn.error;
      if (active.error || turnError || turn.status === "failed") {
        active.reject(new Error(String(active.error || turnError || "Codex app-server turn failed.")));
      } else {
        active.resolve(active.content.trim());
      }
    }
  }

  private async handleServerRequest(message: JsonRpcMessage): Promise<void> {
    if (message.method !== "account/chatgptAuthTokens/refresh") {
      this.write({ id: message.id, error: { code: -32601, message: `Unsupported server request: ${message.method}` } });
      return;
    }

    if (!this.refreshTokens) {
      this.write({ id: message.id, error: { code: -32001, message: "ChatGPT token refresh is unavailable." } });
      return;
    }

    try {
      const tokens = await this.refreshTokens();
      this.write({ id: message.id, result: {
        accessToken: tokens.accessToken,
        chatgptAccountId: tokens.chatgptAccountId,
        ...(cleanPlanType(tokens.chatgptPlanType)
          ? { chatgptPlanType: cleanPlanType(tokens.chatgptPlanType)! }
          : {}),
      } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.write({ id: message.id, error: { code: -32002, message: `ChatGPT token refresh failed: ${detail}` } });
    }
  }

  private write(message: JsonRpcMessage): void {
    if (this.stopped || !this.child.stdin.writable) throw new Error("Codex app-server is not writable.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestCounter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  waitForTurn(turnId: string | null, timeoutMs: number): Promise<string> {
    if (this.activeTurn) return Promise.reject(new Error("Codex app-server already has an active turn."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.activeTurn?.turnId === turnId) this.activeTurn = null;
        reject(new Error("Codex app-server turn timed out."));
      }, timeoutMs);
      this.activeTurn = { turnId, content: "", error: null, resolve, reject, timer };
    });
  }

  setActiveTurnId(turnId: string | null): void {
    if (this.activeTurn && turnId) this.activeTurn.turnId = turnId;
  }

  private failAll(error: Error): void {
    if (this.stopped) return;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (this.activeTurn) {
      clearTimeout(this.activeTurn.timer);
      this.activeTurn.reject(error);
      this.activeTurn = null;
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.failAll(new Error("Codex app-server stopped."));
    this.stopped = true;
    this.child.kill();
  }
}

export async function runHostedCodexPrompt(input: RunHostedCodexPromptInput): Promise<string> {
  const accessToken = input.accessToken.trim();
  const chatgptAccountId = input.chatgptAccountId.trim();
  const prompt = input.prompt.trim();
  if (!accessToken) throw new Error("ChatGPT access token is required for the hosted Codex runtime.");
  if (!chatgptAccountId) throw new Error("ChatGPT account id is required for the hosted Codex runtime.");
  if (!prompt) throw new Error("Prompt is required for the hosted Codex runtime.");

  const sessionRoot = await mkdtemp(join(tmpdir(), "jarvis-hosted-codex-"));
  const workspace = input.cwd?.trim() || join(sessionRoot, "workspace");
  const codexHome = join(sessionRoot, "codex-home");
  let client: HostedCodexAppServerClient | null = null;
  const abort = () => client?.stop();

  try {
    await Promise.all([
      input.cwd ? Promise.resolve() : mkdir(workspace),
      mkdir(codexHome),
    ]);
    const factory = processFactoryForTesting ?? defaultProcessFactory;
    const spawned = factory(
      input.command?.trim() || getCodexOAuthCommand(),
      appServerArgs(),
      { cwd: workspace, codexHome },
    );
    client = new HostedCodexAppServerClient(spawned, input.refreshTokens);
    const liveClient = client;
    input.signal?.addEventListener("abort", abort, { once: true });

    await liveClient.request("initialize", {
      clientInfo: { name: "jarvis-hosted-subscription", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    await liveClient.request("account/login/start", loginParams({
      accessToken,
      chatgptAccountId,
      chatgptPlanType: input.chatgptPlanType,
    }));
    const threadResult = await liveClient.request("thread/start", {
      cwd: workspace,
      approvalPolicy: "never",
      sandbox: input.sandbox ?? "read-only",
      ephemeral: true,
      serviceName: "Jarvis Hosted Subscription",
      baseInstructions: input.baseInstructions ?? [
          "You are Jarvis's hosted ChatGPT subscription runtime.",
          "Answer only the latest Jarvis provider prompt.",
          "Do not use Codex tools; Jarvis owns tool execution and approval gates.",
      ].join("\n"),
      threadSource: "user",
    }, 45_000);
    const threadId = String(threadResult?.thread?.id ?? "").trim();
    if (!threadId) throw new Error("Codex app-server did not return a thread id.");

    // Start listening before sending turn/start. App-server can emit deltas and
    // turn/completed immediately after the response, in the same stdout chunk.
    const contentPromise = liveClient.waitForTurn(null, input.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS);
    let turnResult: any;
    try {
      turnResult = await liveClient.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        approvalPolicy: "never",
        sandboxPolicy: input.sandbox === "workspace-write"
          ? { type: "workspaceWrite", writableRoots: [workspace], networkAccess: input.networkAccess === true }
          : { type: "readOnly", networkAccess: input.networkAccess === true },
      });
    } catch (error) {
      liveClient.stop();
      await contentPromise.catch(() => undefined);
      throw error;
    }
    const turnId = typeof turnResult?.turn?.id === "string" ? turnResult.turn.id : null;
    liveClient.setActiveTurnId(turnId);
    const content = await contentPromise;
    if (!content) throw new Error("Hosted Codex app-server returned no content.");
    return content;
  } catch (error) {
    if (input.signal?.aborted) throw new DOMException("Hosted Codex runtime aborted", "AbortError");
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", abort);
    client?.stop();
    await rm(sessionRoot, { recursive: true, force: true });
  }
}
