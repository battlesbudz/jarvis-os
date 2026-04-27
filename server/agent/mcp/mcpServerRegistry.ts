/**
 * McpServerRegistry — manages a fleet of MCP server connections.
 *
 * On startup it reads the `mcp_servers` table, connects each enabled server,
 * discovers its tools, and wraps them as AgentTool instances that can be
 * injected into the agent harness.
 *
 * SSRF protection: HTTP server URLs are validated against a private-address
 * deny-list both at registration time and when scanning tool call arguments
 * for embedded URLs.
 */

import { db } from "../../db";
import { mcpServers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { McpClient, McpToolDefinition, McpPromptDefinition } from "./mcpClient";
import type { AgentTool } from "../types";

// ── SSRF deny-list ────────────────────────────────────────────────────────────

const PRIVATE_ADDR_RE =
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|::1|fc[0-9a-f]{2}:|fe80:)/i;

function assertNotSsrf(url: string): void {
  if (PRIVATE_ADDR_RE.test(url)) {
    throw new Error(`Blocked: URL resolves to a private/internal address — ${url}`);
  }
}

/** Recursively scan tool arguments and throw if any string value is a private URL. */
function scanForPrivateUrls(value: unknown): void {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) assertNotSsrf(value);
  } else if (Array.isArray(value)) {
    for (const item of value) scanForPrivateUrls(item);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) scanForPrivateUrls(v);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpServerRow {
  id: string;
  userId: string | null;
  name: string;
  transport: string;
  command: string | null;
  url: string | null;
  authToken: string | null;
  enabled: boolean;
  isBuiltIn: boolean;
  createdAt: Date;
}

export interface McpServerStatus {
  server: McpServerRow;
  connected: boolean;
  toolCount: number;
  error?: string;
}

export interface McpPromptEntry {
  serverName: string;
  serverId: string;
  prompt: McpPromptDefinition;
}

// Max tools we accept from a single server to prevent tool flooding.
const MAX_TOOLS_PER_SERVER = 64;

// ── Registry ──────────────────────────────────────────────────────────────────

class McpServerRegistry {
  private clients = new Map<string, McpClient>();
  private rows = new Map<string, McpServerRow>();
  private toolsMap = new Map<string, McpToolDefinition[]>();
  private errors = new Map<string, string>();
  private started = false;

  /** Called once at server startup. Connects all enabled DB-persisted servers. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const rows = await db.select().from(mcpServers);
      for (const row of rows) {
        if (row.enabled) await this._connectRow(row as McpServerRow);
      }
    } catch (err) {
      console.error("[McpRegistry] startup error:", (err as Error).message);
    }
  }

  // ── Connection management ─────────────────────────────────────────────────

  private async _connectRow(row: McpServerRow): Promise<void> {
    try {
      let transport: ConstructorParameters<typeof McpClient>[0];

      if (row.transport === "stdio") {
        if (!row.command) {
          this.errors.set(row.id, "No command specified for stdio server");
          return;
        }
        const parts = row.command.split(/\s+/);
        transport = { type: "stdio", command: parts[0], args: parts.slice(1) };
      } else {
        if (!row.url) {
          this.errors.set(row.id, "No URL specified for HTTP server");
          return;
        }
        assertNotSsrf(row.url);
        transport = {
          type: "http",
          url: row.url,
          authToken: row.authToken ?? undefined,
        };
      }

      const client = new McpClient(transport);
      await client.connect();
      const tools = client.discoveredTools.slice(0, MAX_TOOLS_PER_SERVER);

      this.clients.set(row.id, client);
      this.rows.set(row.id, row);
      this.toolsMap.set(row.id, tools);
      this.errors.delete(row.id);
      console.log(`[McpRegistry] connected: "${row.name}" (${tools.length} tools)`);
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`[McpRegistry] failed to connect "${row.name}": ${msg}`);
      this.errors.set(row.id, msg);
      this.rows.set(row.id, row); // keep row so status UI shows it
    }
  }

  private _disconnectServer(id: string): void {
    const client = this.clients.get(id);
    if (client) { client.disconnect(); this.clients.delete(id); }
    this.toolsMap.delete(id);
    this.errors.delete(id);
  }

  // ── Tool generation ───────────────────────────────────────────────────────

  /**
   * Returns AgentTool wrappers for all system-scoped servers (userId = null).
   * Used by mcpCapability so that the capability registry includes MCP tools
   * in the global tool list.
   */
  getSystemTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (row.userId !== null || !row.enabled) continue;
      const defs = this.toolsMap.get(id) ?? [];
      for (const def of defs) tools.push(this._wrapTool(id, row.name, def));
    }
    return tools;
  }

  /**
   * Returns AgentTool wrappers for all servers visible to the given user:
   * system-scoped (userId = null) + user-owned (userId = userId).
   */
  getToolsForUser(userId: string): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (!row.enabled) continue;
      if (row.userId !== null && row.userId !== userId) continue;
      const defs = this.toolsMap.get(id) ?? [];
      for (const def of defs) tools.push(this._wrapTool(id, row.name, def));
    }
    return tools;
  }

  /**
   * Returns the McpClient for the given server ID if it is accessible to the user.
   * Accessible = system-scoped (userId = null) OR owned by the user.
   */
  getClientForUser(userId: string, serverId: string): import("./mcpClient").McpClient | undefined {
    const row = this.rows.get(serverId);
    if (!row || !row.enabled) return undefined;
    if (row.userId !== null && row.userId !== userId) return undefined;
    return this.clients.get(serverId);
  }

  private _safeName(serverName: string): string {
    return serverName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  private _wrapTool(serverId: string, serverName: string, def: McpToolDefinition): AgentTool {
    const registry = this;
    const toolName = `mcp__${this._safeName(serverName)}__${def.name}`;
    return {
      name: toolName,
      description: `[MCP: ${serverName}] ${def.description ?? def.name}`,
      parameters: def.inputSchema ?? { type: "object", properties: {} },
      async execute(args, ctx) {
        try {
          if (args && typeof args === "object") scanForPrivateUrls(args);

          const client = registry.clients.get(serverId);
          if (!client) {
            return {
              ok: false,
              content: `MCP server "${serverName}" is not connected. It may have exited or failed to start.`,
              label: "mcp_error",
            };
          }

          // Wire up progress notifications through the context's onProgress callback
          const progressCallback = ctx.state.onProgress
            ? (message: string, progress?: number, total?: number) => {
                const fullMsg = `[MCP ${serverName}] ${message}`;
                ctx.state.onProgress!(fullMsg);
              }
            : undefined;

          const result = await client.callTool(
            def.name,
            args as Record<string, unknown>,
            progressCallback,
          );

          // ── Structured content handling ──────────────────────────────────
          // Extract image and non-text content from the result and attach to ctx
          const textParts: string[] = [];
          for (const item of result.content) {
            if (item.type === "text") {
              textParts.push(item.text ?? "");
            } else if (item.type === "image" && item.data) {
              // Attach image blob as a PendingAttachment
              if (!ctx.state.pendingAttachments) ctx.state.pendingAttachments = [];
              ctx.state.pendingAttachments.push({
                kind: "image",
                data: item.data,
                mimeType: item.mimeType ?? "image/png",
                mcpServerName: serverName,
              });
            } else if (item.type === "resource" && item.resource) {
              // Treat embedded resource as a file attachment
              const res = item.resource as { uri?: string; mimeType?: string; text?: string; blob?: string };
              if (!ctx.state.pendingAttachments) ctx.state.pendingAttachments = [];
              if (res.text) {
                // Text resource — render as markdown
                ctx.state.pendingAttachments.push({
                  kind: "markdown",
                  text: res.text,
                  mcpServerName: serverName,
                });
                textParts.push(`[Resource: ${res.uri ?? "embedded"}]`);
              } else if (res.blob) {
                ctx.state.pendingAttachments.push({
                  kind: "file",
                  filename: res.uri ?? "resource",
                  data: res.blob,
                  mimeType: res.mimeType ?? "application/octet-stream",
                  mcpServerName: serverName,
                });
              } else if (res.uri) {
                // URI-only reference — attempt to fetch resource content via resources/read
                try {
                  const contents = await client.readResource(res.uri);
                  for (const rc of contents) {
                    if (rc.text) {
                      ctx.state.pendingAttachments!.push({ kind: "markdown", text: rc.text, mcpServerName: serverName });
                    } else if (rc.blob) {
                      const filename = res.uri.split("/").pop() ?? "resource";
                      ctx.state.pendingAttachments!.push({ kind: "file", filename, data: rc.blob, mimeType: res.mimeType, mcpServerName: serverName });
                    }
                  }
                } catch { /* readResource failed — skip silently */ }
              }
            }
          }

          const text = textParts.join("\n").trim();

          return {
            ok: !result.isError,
            content: text || (result.isError ? "MCP tool returned an error with no message." : "Done."),
            label: `mcp:${serverName}/${def.name}`,
            detail: JSON.stringify({
              mcpServerName: serverName,
              hasAttachments: (ctx.state.pendingAttachments?.length ?? 0) > 0,
            }),
          };
        } catch (err) {
          return {
            ok: false,
            content: `MCP tool failed: ${(err as Error).message}`,
            label: "mcp_error",
          };
        }
      },
    };
  }

  // ── Prompts ───────────────────────────────────────────────────────────────

  /**
   * Fetch prompt templates from all servers visible to the given user.
   * Returns a flat list with server attribution.
   */
  async listPromptsForUser(userId: string): Promise<McpPromptEntry[]> {
    const results: McpPromptEntry[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (!row.enabled) continue;
      if (row.userId !== null && row.userId !== userId) continue;
      const client = this.clients.get(id);
      if (!client) continue;
      try {
        const prompts = await client.listPrompts();
        for (const p of prompts) {
          results.push({ serverName: row.name, serverId: id, prompt: p });
        }
      } catch (err) {
        console.warn(`[McpRegistry] listPrompts failed for "${row.name}":`, (err as Error).message);
      }
    }
    return results;
  }

  /**
   * Fetch prompt templates from all system-scoped servers (userId = null).
   */
  async listSystemPrompts(): Promise<McpPromptEntry[]> {
    const results: McpPromptEntry[] = [];
    for (const [id, row] of this.rows.entries()) {
      if (row.userId !== null || !row.enabled) continue;
      const client = this.clients.get(id);
      if (!client) continue;
      try {
        const prompts = await client.listPrompts();
        for (const p of prompts) {
          results.push({ serverName: row.name, serverId: id, prompt: p });
        }
      } catch {}
    }
    return results;
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  /** Add a new server, persist to DB, and attempt to connect it. */
  async addServer(
    data: Omit<McpServerRow, "id" | "createdAt">,
  ): Promise<McpServerRow> {
    if (data.transport === "http" && data.url) assertNotSsrf(data.url);

    const [row] = await db
      .insert(mcpServers)
      .values({
        userId: data.userId,
        name: data.name,
        transport: data.transport,
        command: data.command,
        url: data.url,
        authToken: data.authToken,
        enabled: data.enabled,
        isBuiltIn: data.isBuiltIn,
      })
      .returning();

    if (row.enabled) await this._connectRow(row as McpServerRow);
    return row as McpServerRow;
  }

  /** Enable or disable a server and reconnect/disconnect accordingly. */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await db.update(mcpServers).set({ enabled }).where(eq(mcpServers.id, id));
    const row = this.rows.get(id);
    if (!row) return;
    row.enabled = enabled;
    if (!enabled) {
      this._disconnectServer(id);
    } else {
      await this._connectRow(row);
    }
  }

  /** Delete a server by ID, scoped to a user (pass null to allow system-level delete). */
  async deleteServer(id: string, requestingUserId: string | null): Promise<boolean> {
    this._disconnectServer(id);
    this.rows.delete(id);

    const condition =
      requestingUserId === null
        ? eq(mcpServers.id, id)
        : and(eq(mcpServers.id, id), eq(mcpServers.userId, requestingUserId));

    const result = await db.delete(mcpServers).where(condition).returning();
    return result.length > 0;
  }

  /** Current status for every server — used by the settings API. */
  getStatus(): McpServerStatus[] {
    return Array.from(this.rows.values()).map((row) => ({
      server: row,
      connected: this.clients.has(row.id),
      toolCount: this.toolsMap.get(row.id)?.length ?? 0,
      error: this.errors.get(row.id),
    }));
  }

  /** Status filtered to a specific user (system servers + user-owned). */
  getStatusForUser(userId: string): McpServerStatus[] {
    return this.getStatus().filter(
      (s) => s.server.userId === null || s.server.userId === userId,
    );
  }

  /** True once start() has been called. */
  get isStarted(): boolean {
    return this.started;
  }
}

export const mcpServerRegistry = new McpServerRegistry();
