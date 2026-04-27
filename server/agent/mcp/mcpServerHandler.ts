/**
 * Jarvis MCP Server — Streamable HTTP transport (spec 2025-11-25)
 *
 * POST /api/mcp
 *   Auth: Authorization: Bearer <jarvis_key>
 *   Handles: initialize, notifications/initialized, tools/list, tools/call
 *
 * Entitlement model (matches existing harness/channel-tool path):
 *   1. filterToolsByGroups — scope by channel groups; GOOGLE_GATED comes from
 *      the capability registry, not a hardcoded list.
 *   2. wrapToolsForAgent — applies checkPermission-equivalent flag logic.
 *      MCP API key represents the owner-user, so a synthetic agent with ALL
 *      permission flags enabled is used (maximum trust, equivalent to the
 *      owner running tools directly).
 *   3. context.allowedToolNames — populated from the final wrapped set, same
 *      as the harness does at line 722, so tools that inspect their own scope
 *      (spawnSubagent, buildFeature) work correctly.
 *
 * Rate limiting:
 *   - Pre-auth: 10 attempts/min per 16-char prefix bucket (prevents bcrypt DoS).
 *   - Post-auth: 120 req/min per key ID (DB row UUID, no cross-user coupling).
 *
 * Responses:
 *   - application/json for initialize, notifications/initialized, tools/list
 *   - text/event-stream for tools/call (streams progress + final result)
 */

import type { Request, Response } from "express";
import { verifyMcpApiKey, checkRateLimit } from "./mcpApiKeys";
import { filterToolsByGroups } from "../tools/index";
import { wrapToolsForAgent } from "../agentPermissions";
import type { ToolGroup } from "../tools/index";
import type { AgentTool, ToolContext } from "../types";
import type { DiscordAgent, AgentPermissions } from "@shared/schema";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const SERVER_NAME = "jarvis";
const SERVER_VERSION = "1.0.0";

/**
 * All tool groups exposed over the MCP server surface.
 * filterToolsByGroups handles GOOGLE_GATED; no manual name-filtering needed.
 */
const MCP_TOOL_GROUPS: ToolGroup[] = [
  "coaching",
  "calendar",
  "email",
  "memory",
  "documents",
  "research",
  "discord",
  "scheduling",
  "browser",
  "system",
  "media",
  "connections",
  "mcp",
];

/**
 * All AgentPermissions flags enabled.
 * Used to build the synthetic agent object for wrapToolsForAgent — MCP API keys
 * represent the owner-user, who has full access to their own Jarvis tools.
 */
const ALL_PERMISSIONS: AgentPermissions = {
  can_search_web: true,
  can_use_browser: true,
  can_send_emails: true,
  can_create_email_drafts: true,
  can_read_email: true,
  can_send_messages: true,
  can_access_files: true,
  can_take_screenshots: true,
  can_open_apps: true,
  can_call_user: true,
  can_use_voice: true,
  can_create_tasks: true,
  can_create_other_agents: true,
  can_access_global_memory: true,
};

/**
 * Build a synthetic DiscordAgent for wrapToolsForAgent.
 * We don't persist this object — it only carries the userId + full permissions.
 */
function syntheticAgent(userId: string): DiscordAgent {
  return {
    id: `mcp-${userId}`,
    userId,
    name: "MCP User",
    role: "custom",
    persona: null,
    channelId: null,
    channelName: null,
    isActive: 1,
    loopEnabled: 0,
    loopIntervalMinutes: null,
    loopPrompt: null,
    lastLoopRun: null,
    createdAt: new Date(),
    platforms: ["mcp"],
    permissions: ALL_PERMISSIONS,
    memoryScope: "agent_private",
    accessGlobalMemory: true,
    allowedUsers: [],
    allowedConversations: [],
    privateMode: false,
  } as unknown as DiscordAgent;
}

// Tools that may take >2s and warrant SSE progress streaming
const LONG_RUNNING_TOOL_PREFIXES = [
  "browser_",
  "spawn_subagent",
  "queue_background_job",
  "web_fetch",
  "research_topic",
];

function isLongRunningTool(toolName: string): boolean {
  return LONG_RUNNING_TOOL_PREFIXES.some((p) => toolName.startsWith(p));
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function jsonRpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: number | string | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

// ── Tool serialization ────────────────────────────────────────────────────────

function toMcpTool(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object" as const,
      properties: (tool.parameters as Record<string, unknown>).properties ?? {},
      required: (tool.parameters as Record<string, unknown>).required ?? [],
    },
  };
}

type McpTextContent  = { type: "text"; text: string };
type McpImageContent = { type: "image"; data: string; mimeType: string };
type McpContent = McpTextContent | McpImageContent;

/**
 * Convert a ToolResult.content string to MCP content items.
 * Detects base64 data URLs for images; everything else is text.
 */
function toMcpContent(content: string): McpContent[] {
  const dataUrlMatch = content.match(/^data:(image\/[a-zA-Z+]+);base64,([A-Za-z0-9+/=]+)$/);
  if (dataUrlMatch) {
    return [{ type: "image", data: dataUrlMatch[2], mimeType: dataUrlMatch[1] }];
  }
  return [{ type: "text", text: content }];
}

// ── Auth + rate limit ─────────────────────────────────────────────────────────

type AuthResult =
  | { ok: true; userId: string; keyId: string }
  | { ok: false; status: 401 | 429; message: string };

async function authenticate(req: Request): Promise<AuthResult> {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "Unauthorized: missing or invalid MCP API key" };
  }

  const rawKey = authHeader.slice(7).trim();
  const verified = await verifyMcpApiKey(rawKey);
  if (!verified) {
    return { ok: false, status: 401, message: "Unauthorized: missing or invalid MCP API key" };
  }

  // Post-auth rate limit: keyed by DB row UUID (unique per key, no cross-user coupling)
  if (!checkRateLimit(verified.keyId)) {
    return { ok: false, status: 429, message: "Rate limit exceeded: 120 requests/minute" };
  }

  return { ok: true, userId: verified.userId, keyId: verified.keyId };
}

// ── Entitlement: build permitted + wrapped tool list ──────────────────────────

/**
 * Build the permitted, permission-checked, and usage-logged tool list for a user.
 *
 * Mirrors the harness entitlement path:
 *   filterToolsByGroups (Google gating + channel scope)
 *   → wrapToolsForAgent (checkPermission-equivalent flag logic + audit logging)
 */
async function buildPermittedTools(userId: string): Promise<AgentTool[]> {
  let hasGoogle = false;
  try {
    const { getValidGoogleToken } = await import("../../userTokenStore");
    const tok = await getValidGoogleToken(userId, "calendar");
    hasGoogle = !!tok;
  } catch {
    hasGoogle = false;
  }

  const scoped = filterToolsByGroups(MCP_TOOL_GROUPS, hasGoogle);
  return wrapToolsForAgent(scoped, syntheticAgent(userId));
}

// ── Build tool context ────────────────────────────────────────────────────────

async function buildToolContext(
  userId: string,
  permittedTools: AgentTool[],
  onProgress?: (msg: string) => void,
): Promise<ToolContext> {
  let googleAccessToken: string | null = null;
  try {
    const { getValidGoogleToken } = await import("../../userTokenStore");
    googleAccessToken = await getValidGoogleToken(userId, "calendar");
  } catch {
    // Google not connected — Google-gated tools already excluded from permittedTools
  }

  return {
    userId,
    googleAccessToken,
    // Populate allowedToolNames from the final permitted set — matches harness line 722.
    // Tools that inspect their own scope (spawnSubagent, buildFeature) need this.
    allowedToolNames: new Set(permittedTools.map((t) => t.name)),
    state: {
      onProgress,
    },
    channel: "mcp",
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  // Authenticate (pre-auth bcrypt-DoS guard is in verifyMcpApiKey)
  const auth = await authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json(
      jsonRpcError(null, -32000, auth.message)
    );
    return;
  }

  const { userId } = auth;
  const body = req.body;

  if (!body || body.jsonrpc !== "2.0") {
    res.status(400).json(
      jsonRpcError(null, -32600, "Invalid JSON-RPC request")
    );
    return;
  }

  const { id, method, params } = body;

  // ── initialize ────────────────────────────────────────────────────────────
  if (method === "initialize") {
    res.json(
      jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: {
          tools: { listChanged: false },
        },
      })
    );
    return;
  }

  // ── notifications/initialized (no-op ack) ────────────────────────────────
  if (method === "notifications/initialized") {
    res.status(204).end();
    return;
  }

  // ── tools/list ────────────────────────────────────────────────────────────
  if (method === "tools/list") {
    const tools = await buildPermittedTools(userId);
    res.json(
      jsonRpcResult(id, {
        tools: tools.map(toMcpTool),
      })
    );
    return;
  }

  // ── tools/call ───────────────────────────────────────────────────────────
  if (method === "tools/call") {
    const toolName: string = params?.name;
    const toolArgs: Record<string, unknown> = params?.arguments ?? {};
    const progressToken: unknown = params?._meta?.progressToken;

    if (!toolName) {
      res.status(400).json(jsonRpcError(id, -32602, "Invalid params: name is required"));
      return;
    }

    // Build permitted tool set and resolve tool — only permitted tools can be called.
    const permittedTools = await buildPermittedTools(userId);
    const tool = permittedTools.find((t) => t.name === toolName);
    if (!tool) {
      res.status(404).json(
        jsonRpcError(id, -32601, `Unknown or not permitted tool: ${toolName}`)
      );
      return;
    }

    const useStream = isLongRunningTool(toolName);

    if (useStream) {
      // SSE streaming response
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const sendEvent = (data: unknown) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      let progressIndex = 0;
      const onProgress = (message: string) => {
        progressIndex++;
        sendEvent({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken, progress: progressIndex, message },
        });
      };

      try {
        const ctx = await buildToolContext(userId, permittedTools, onProgress);
        const result = await tool.execute(toolArgs, ctx);
        sendEvent(
          jsonRpcResult(id, {
            content: toMcpContent(result.content),
            isError: !result.ok,
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(jsonRpcError(id, -32000, `Tool execution failed: ${msg}`));
      }

      res.end();
    } else {
      // JSON response
      try {
        const ctx = await buildToolContext(userId, permittedTools);
        const result = await tool.execute(toolArgs, ctx);
        res.json(
          jsonRpcResult(id, {
            content: toMcpContent(result.content),
            isError: !result.ok,
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json(jsonRpcError(id, -32000, `Tool execution failed: ${msg}`));
      }
    }

    return;
  }

  // ── Unknown method ───────────────────────────────────────────────────────
  res.status(405).json(
    jsonRpcError(id, -32601, `Method not found: ${method}`)
  );
}
