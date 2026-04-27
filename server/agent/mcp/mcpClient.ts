/**
 * Generic MCP client — supports both stdio subprocess and remote HTTP transports.
 *
 * Usage:
 *   const client = new McpClient({ type: "stdio", command: "node", args: ["./server.js"] });
 *   await client.connect();
 *   const tools = client.discoveredTools;
 *   const result = await client.callTool("some_tool", { arg: "value" });
 *   client.disconnect();
 */

import { spawn, ChildProcess } from "child_process";

const DEFAULT_TIMEOUT_MS = 30_000;

// ── Public types ───────────────────────────────────────────────────────────────

export type McpTransportConfig =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; authToken?: string };

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface McpContentItem {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: unknown;
}

export interface McpToolResult {
  content: McpContentItem[];
  isError?: boolean;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDefinition {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpResourceDefinition {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

// ── Internal ───────────────────────────────────────────────────────────────────

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  jsonrpc: string;
  method?: string;
  params?: unknown;
}

type NotificationHandler = (params: unknown) => void;

// ── McpClient ──────────────────────────────────────────────────────────────────

export class McpClient {
  private readonly transport: McpTransportConfig;
  private readonly timeoutMs: number;

  // stdio state
  private proc?: ChildProcess;
  private buf = "";
  private pending = new Map<number, (r: JsonRpcResponse) => void>();
  private counter = 0;

  // notification handlers keyed by method name
  private notificationHandlers = new Map<string, Set<NotificationHandler>>();

  // shared state
  private initPromise?: Promise<void>;
  private _discoveredTools: McpToolDefinition[] = [];

  constructor(transport: McpTransportConfig, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
  }

  /** Connect and initialize. Safe to call multiple times — returns cached promise. */
  async connect(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  /** Tools discovered during initialize → listTools(). Empty until connect() resolves. */
  get discoveredTools(): McpToolDefinition[] {
    return this._discoveredTools;
  }

  // ── initialization ───────────────────────────────────────────────────────────

  private async _doInit(): Promise<void> {
    if (this.transport.type === "stdio") {
      await this._initStdio();
    } else {
      await this._initHttp();
    }
    this._discoveredTools = await this._listToolsRaw();
  }

  // ── stdio transport ──────────────────────────────────────────────────────────

  private _initStdio(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const { command, args = [], env } = this.transport as Extract<McpTransportConfig, { type: "stdio" }>;

      this.proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...(env ?? {}) },
      });

      this.proc.stdout!.on("data", (chunk: Buffer) => {
        this.buf += chunk.toString();
        const lines = this.buf.split("\n");
        this.buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as JsonRpcResponse;
            if (msg.id != null) {
              // It's a response to one of our requests
              const cb = this.pending.get(msg.id);
              if (cb) { this.pending.delete(msg.id); cb(msg); }
            } else if (msg.method) {
              // It's a server-sent notification (no id)
              this._dispatchNotification(msg.method, msg.params);
            }
          } catch { /* ignore non-JSON lines */ }
        }
      });

      this.proc.stderr!.on("data", () => { /* suppress subprocess stderr */ });

      this.proc.on("exit", (code) => {
        console.log(`[McpClient] stdio process exited (${command}, code=${code})`);
        this.initPromise = undefined;
        for (const cb of this.pending.values()) {
          cb({ jsonrpc: "2.0", error: { code: -32000, message: "Process exited" } });
        }
        this.pending.clear();
      });

      this._stdioRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "jarvis", version: "1.0.0" },
      }).then((res) => {
        if (res.error) { reject(new Error(`MCP initialize failed: ${res.error.message}`)); return; }
        this._stdioSend({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        console.log(`[McpClient] stdio connected: ${command}`);
        resolve();
      }).catch(reject);
    });
  }

  private _dispatchNotification(method: string, params: unknown): void {
    const handlers = this.notificationHandlers.get(method);
    if (handlers) {
      for (const h of handlers) {
        try { h(params); } catch { /* non-fatal */ }
      }
    }
  }

  /** Register a notification handler for a given MCP method (e.g. "notifications/progress"). */
  onNotification(method: string, handler: NotificationHandler): () => void {
    if (!this.notificationHandlers.has(method)) {
      this.notificationHandlers.set(method, new Set());
    }
    this.notificationHandlers.get(method)!.add(handler);
    return () => this.notificationHandlers.get(method)?.delete(handler);
  }

  private _stdioSend(msg: unknown): void {
    try { this.proc!.stdin!.write(JSON.stringify(msg) + "\n"); } catch { /* ignore */ }
  }

  private _stdioRequest(method: string, params: unknown): Promise<JsonRpcResponse> {
    return new Promise((resolve) => {
      const id = ++this.counter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ id, jsonrpc: "2.0", error: { code: -32000, message: `Timeout calling ${method}` } });
      }, this.timeoutMs);
      this.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
      this._stdioSend({ jsonrpc: "2.0", id, method, params });
    });
  }

  // ── HTTP transport (Streamable HTTP / MCP spec 2025-11-25) ──────────────────

  private async _initHttp(): Promise<void> {
    const res = await this._httpRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "jarvis", version: "1.0.0" },
    });
    if (res.error) throw new Error(`MCP HTTP initialize failed: ${res.error.message}`);
    // notifications/initialized is fire-and-forget
    this._httpNotify("notifications/initialized", {}).catch(() => {});
    const { url } = this.transport as Extract<McpTransportConfig, { type: "http" }>;
    console.log(`[McpClient] HTTP connected: ${url}`);
  }

  private async _httpRequest(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = ++this.counter;
    const cfg = this.transport as Extract<McpTransportConfig, { type: "http" }>;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (cfg.authToken) headers["Authorization"] = `Bearer ${cfg.authToken}`;

    let res: Response;
    try {
      res = await fetch(cfg.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return { id, jsonrpc: "2.0", error: { code: -32000, message: (err as Error).message } };
    }

    if (!res.ok) {
      return { id, jsonrpc: "2.0", error: { code: res.status, message: `HTTP ${res.status}: ${res.statusText}` } };
    }

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) {
      // Stream SSE response incrementally so progress notifications are dispatched live
      // as each chunk arrives, without waiting for the full body.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let matched: JsonRpcResponse | null = null;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6)) as JsonRpcResponse;
                if (parsed.id === id) {
                  matched = parsed;
                } else if (parsed.method && parsed.id == null) {
                  this._dispatchNotification(parsed.method, parsed.params);
                }
              } catch { /* skip malformed lines */ }
            }
          }
          if (matched) { reader.cancel().catch(() => {}); break; }
        }
      } catch { /* stream error — return what we have */ }
      if (matched) return matched;
      return { id, jsonrpc: "2.0", error: { code: -32000, message: "No matching SSE response event" } };
    }

    return (await res.json()) as JsonRpcResponse;
  }

  private async _httpNotify(method: string, params: unknown): Promise<void> {
    const cfg = this.transport as Extract<McpTransportConfig, { type: "http" }>;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.authToken) headers["Authorization"] = `Bearer ${cfg.authToken}`;
    await fetch(cfg.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      signal: AbortSignal.timeout(5000),
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  private async _listToolsRaw(): Promise<McpToolDefinition[]> {
    let res: JsonRpcResponse;
    if (this.transport.type === "stdio") {
      res = await this._stdioRequest("tools/list", {});
    } else {
      res = await this._httpRequest("tools/list", {});
    }
    if (res.error) {
      console.warn(`[McpClient] tools/list error: ${res.error.message}`);
      return [];
    }
    const result = res.result as { tools?: McpToolDefinition[] } | undefined;
    return result?.tools ?? [];
  }

  async listTools(): Promise<McpToolDefinition[]> {
    await this.connect();
    return this._listToolsRaw();
  }

  /** List prompt templates exposed by this server. */
  async listPrompts(): Promise<McpPromptDefinition[]> {
    await this.connect();
    let res: JsonRpcResponse;
    if (this.transport.type === "stdio") {
      res = await this._stdioRequest("prompts/list", {});
    } else {
      res = await this._httpRequest("prompts/list", {});
    }
    if (res.error) {
      console.warn(`[McpClient] prompts/list error: ${res.error.message}`);
      return [];
    }
    const result = res.result as { prompts?: McpPromptDefinition[] } | undefined;
    return result?.prompts ?? [];
  }

  /**
   * Resolve / expand a prompt template by name with the given arguments.
   * Returns the rendered message content that can be sent to the model.
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<{ description?: string; messages: { role: string; content: { type: string; text?: string } }[] }> {
    await this.connect();
    let res: JsonRpcResponse;
    const params: Record<string, unknown> = { name };
    if (args && Object.keys(args).length > 0) params.arguments = args;
    if (this.transport.type === "stdio") {
      res = await this._stdioRequest("prompts/get", params);
    } else {
      res = await this._httpRequest("prompts/get", params);
    }
    if (res.error) {
      throw new Error(`prompts/get failed: ${res.error.message}`);
    }
    const result = res.result as { description?: string; messages?: { role: string; content: { type: string; text?: string } }[] } | undefined;
    return { description: result?.description, messages: result?.messages ?? [] };
  }

  /** List resources (files, data blobs) exposed by this server. */
  async listResources(): Promise<McpResourceDefinition[]> {
    await this.connect();
    let res: JsonRpcResponse;
    if (this.transport.type === "stdio") {
      res = await this._stdioRequest("resources/list", {});
    } else {
      res = await this._httpRequest("resources/list", {});
    }
    if (res.error) {
      console.warn(`[McpClient] resources/list error: ${res.error.message}`);
      return [];
    }
    const result = res.result as { resources?: McpResourceDefinition[] } | undefined;
    return result?.resources ?? [];
  }

  /** Read a resource by URI. */
  async readResource(uri: string): Promise<McpResourceContent[]> {
    await this.connect();
    let res: JsonRpcResponse;
    if (this.transport.type === "stdio") {
      res = await this._stdioRequest("resources/read", { uri });
    } else {
      res = await this._httpRequest("resources/read", { uri });
    }
    if (res.error) {
      console.warn(`[McpClient] resources/read error: ${res.error.message}`);
      return [];
    }
    const result = res.result as { contents?: McpResourceContent[] } | undefined;
    return result?.contents ?? [];
  }

  /**
   * Call a tool on the server.
   * @param onProgress Optional callback invoked when the server sends notifications/progress.
   *
   * Progress notifications are scoped to this call via a unique `progressToken` sent in
   * `_meta`. The notification handler filters by token so concurrent calls on the same
   * shared client (different users/sessions) never cross-contaminate each other's events.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    onProgress?: (message: string, progress?: number, total?: number) => void,
  ): Promise<McpToolResult> {
    await this.connect();

    // Allocate a unique progress token for this invocation so that concurrent
    // tool calls on the same shared client don't receive each other's progress events.
    const progressToken = ++this.counter;

    let unsubscribe: (() => void) | undefined;
    if (onProgress) {
      unsubscribe = this.onNotification("notifications/progress", (params) => {
        const p = params as { progressToken?: number | string; message?: string; progress?: number; total?: number } | null;
        if (!p || typeof p !== "object") return;
        // Only handle notifications that belong to this specific call
        if (p.progressToken !== undefined && p.progressToken !== progressToken) return;
        const msg = p.message ?? (p.progress != null ? `Step ${p.progress}${p.total ? `/${p.total}` : ""}` : "Working...");
        onProgress(msg, p.progress, p.total);
      });
    }

    try {
      // Include _meta.progressToken so the server can tag its notifications back to us
      const callParams: Record<string, unknown> = { name, arguments: args };
      if (onProgress) callParams._meta = { progressToken };

      let res: JsonRpcResponse;
      if (this.transport.type === "stdio") {
        res = await this._stdioRequest("tools/call", callParams);
      } else {
        res = await this._httpRequest("tools/call", callParams);
      }
      if (res.error) {
        return { content: [{ type: "text", text: `MCP error: ${res.error.message}` }], isError: true };
      }
      return (res.result as McpToolResult | undefined) ?? { content: [], isError: false };
    } finally {
      unsubscribe?.();
    }
  }

  disconnect(): void {
    if (this.transport.type === "stdio" && this.proc) {
      try { this.proc.kill("SIGTERM"); } catch { /* noop */ }
      this.proc = undefined;
    }
    this.initPromise = undefined;
    this._discoveredTools = [];
    for (const cb of this.pending.values()) {
      cb({ jsonrpc: "2.0", error: { code: -32000, message: "Client disconnected" } });
    }
    this.pending.clear();
    this.notificationHandlers.clear();
  }
}
