/**
 * AgentPermissions — tool permission layer for named sub-agents.
 *
 * Each agent has a permissions object with 14 boolean flags. This module
 * maps those flags to tool names and provides:
 *   - checkPermission(agentId, toolName) — throws PermissionDeniedError if denied
 *   - wrapToolsForAgent(tools, agent) — filters tool list before harness sees it
 */
import type { AgentTool } from "./types";
import type { DiscordAgent, AgentPermissions } from "@shared/schema";
import { DEFAULT_AGENT_PERMISSIONS } from "@shared/schema";
import { logAgentEvent } from "./agentLogger";
import { toolCallHooks, HOOK_PRIORITY } from "./toolCallHooks";

// ── Error ──────────────────────────────────────────────────────────────────────

export class PermissionDeniedError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly toolName: string,
    public readonly flag: keyof AgentPermissions | "unclassified_tool",
  ) {
    super(
      flag === "unclassified_tool"
        ? `Agent ${agentId} is not permitted to use unclassified tool "${toolName}"`
        : `Agent ${agentId} is not permitted to use tool "${toolName}" (requires ${flag})`,
    );
    this.name = "PermissionDeniedError";
  }
}

// ── Safe tools: read-only or trivially harmless, permitted for all agents ──────
// Any tool NOT in this list AND NOT in PERMISSION_TOOL_MAP is DENIED by default.
// This makes the permission model safe-by-default: new high-risk tools are blocked
// until explicitly classified.
const ALWAYS_ALLOWED_TOOLS = new Set<string>([
  // Time/date utilities
  "get_current_time", "get_current_date", "calculate_date", "format_date",
  // Math / calculation
  "calculate", "evaluate_expression", "unit_convert",
  // Weather (read-only)
  "get_weather",
  // Memory read (agent-private namespace only — access_global_memory flag gates global)
  "agent_memory_get", "agent_memory_search",
  // Generic read helpers
  "get_location", "timezone_lookup",
]);

// ── Flag → tool groups mapping ─────────────────────────────────────────────────
// Each flag guards a set of tool names. A tool NOT in this list AND NOT in
// ALWAYS_ALLOWED_TOOLS is DENIED for agents (fail-closed default).

const PERMISSION_TOOL_MAP: Record<keyof AgentPermissions, string[]> = {
  can_search_web: ["search_web", "research_topic", "web_fetch"],
  can_use_browser: [
    "browser_navigate", "browser_click", "browser_type", "browser_screenshot",
    "browser_extract", "browser_close", "browser_snapshot", "browser_wait_for",
    "browser_select", "browser_clear_session",
    "browser_tab_new", "browser_tab_list", "browser_tab_select", "browser_tab_close",
  ],
  can_send_emails: ["send_email"],
  can_create_email_drafts: ["create_gmail_draft", "gmail_draft"],
  can_read_email: ["fetch_emails", "gmail_action"],
  can_send_messages: [
    "discord_post", "connect_channel", "sessions_send",
  ],
  can_access_files: [
    "create_document", "list_documents", "read_document",
    "drive_create_file", "drive_list_files", "drive_read_file",
  ],
  can_take_screenshots: ["daemon_action"],  // subset — daemon can also take screenshots
  can_open_apps: ["daemon_action"],          // daemon can open apps too
  can_call_user: ["speak"],
  can_use_voice: ["speak"],
  can_create_tasks: ["manage_tasks"],
  can_create_other_agents: ["setup_named_agent"],
  can_access_global_memory: ["memory_search", "memory_get", "living_context_update"],
  can_run_code: ["run_python", "delegate_to_codex"],
  can_access_calendar: ["fetch_calendar", "create_calendar_event"],
};

// Reverse map: tool name → permission flag(s) that guard it
const TOOL_PERMISSION_MAP: Record<string, (keyof AgentPermissions)[]> = {};
for (const [flag, tools] of Object.entries(PERMISSION_TOOL_MAP)) {
  for (const tool of tools) {
    if (!TOOL_PERMISSION_MAP[tool]) TOOL_PERMISSION_MAP[tool] = [];
    TOOL_PERMISSION_MAP[tool].push(flag as keyof AgentPermissions);
  }
}

// ── getPermissions ─────────────────────────────────────────────────────────────

function getPermissions(agent: DiscordAgent): AgentPermissions {
  const stored = agent.permissions as AgentPermissions | undefined;
  if (!stored || typeof stored !== "object") return { ...DEFAULT_AGENT_PERMISSIONS };
  return { ...DEFAULT_AGENT_PERMISSIONS, ...stored };
}

function getBuiltInSubAgentPermissions(agentId: string): AgentPermissions | null {
  const type = agentId.startsWith("subagent:") ? agentId.slice("subagent:".length) : "";
  if (!type) return null;

  const base: AgentPermissions = {
    ...DEFAULT_AGENT_PERMISSIONS,
    can_send_messages: false,
    can_create_tasks: false,
  };

  switch (type) {
    case "research":
      return { ...base, can_search_web: true };
    case "writing":
      return { ...base, can_search_web: true, can_access_files: true };
    case "planning":
      return { ...base, can_search_web: true, can_access_calendar: true };
    case "email":
      return { ...base, can_search_web: true };
    default:
      return null;
  }
}

function checkPermissionsForAgentId(
  agentId: string,
  userId: string | undefined,
  permissions: AgentPermissions,
  toolName: string,
): void {
  if (ALWAYS_ALLOWED_TOOLS.has(toolName)) return;

  const requiredFlags = TOOL_PERMISSION_MAP[toolName];
  if (!requiredFlags || requiredFlags.length === 0) {
    logAgentEvent({
      event: "tool_permission_denied",
      agentId,
      userId,
      toolName,
      detail: "unclassified-tool-denied",
    });
    throw new PermissionDeniedError(agentId, toolName, "unclassified_tool");
  }

  if (toolName === "daemon_action") {
    if (permissions.can_take_screenshots || permissions.can_open_apps) return;
    throw new PermissionDeniedError(agentId, toolName, "can_take_screenshots");
  }

  for (const flag of requiredFlags) {
    if (!permissions[flag]) {
      logAgentEvent({
        event: "tool_permission_denied",
        agentId,
        userId,
        toolName,
        detail: `flag=${flag}`,
      });
      throw new PermissionDeniedError(agentId, toolName, flag);
    }
  }
}

// ── checkPermission ────────────────────────────────────────────────────────────

/**
 * Check whether an agent's permissions allow a given tool call.
 * Throws PermissionDeniedError if any required flag is false.
 */
export function checkPermission(agent: DiscordAgent, toolName: string): void {
  const perms = getPermissions(agent);
  checkPermissionsForAgentId(agent.id, agent.userId, perms, toolName);
}

// ── wrapToolsForAgent ──────────────────────────────────────────────────────────

/**
 * Return a filtered tool list: only tools the agent is permitted to use.
 * Also wraps each permitted tool to log usage via logAgentEvent.
 *
 * Fail-closed: tools not in PERMISSION_TOOL_MAP and not in ALWAYS_ALLOWED_TOOLS
 * are excluded from the filtered list.
 */
export function wrapToolsForAgent(tools: AgentTool[], agent: DiscordAgent): AgentTool[] {
  const perms = getPermissions(agent);

  const filtered = tools.filter((tool) => {
    // Always-allowed tools pass unconditionally
    if (ALWAYS_ALLOWED_TOOLS.has(tool.name)) return true;

    const flags = TOOL_PERMISSION_MAP[tool.name];
    // Fail-closed: unclassified tools are excluded from the agent's tool list
    if (!flags || flags.length === 0) return false;

    // daemon_action: needs either screenshot or open_apps permission
    if (tool.name === "daemon_action") {
      return perms.can_take_screenshots || perms.can_open_apps;
    }

    // All required flags must be true
    return flags.every((f) => perms[f]);
  });

  // Wrap each tool to emit a tool_used log event on every execute call.
  return filtered.map((tool) => ({
    ...tool,
    execute: async (args, ctx) => {
      const start = Date.now();
      const result = await tool.execute(args, ctx);
      logAgentEvent({
        event: "tool_used",
        agentId: agent.id,
        userId: ctx.userId,
        toolName: tool.name,
        durationMs: Date.now() - start,
      });
      return result;
    },
  }));
}

// ── getPermittedToolNames ──────────────────────────────────────────────────────

/** Return the list of tool names permitted by an agent's current flags. */
export function getPermittedToolNames(agent: DiscordAgent): string[] {
  const perms = getPermissions(agent);
  const permitted = new Set<string>();

  for (const [flag, tools] of Object.entries(PERMISSION_TOOL_MAP)) {
    if (perms[flag as keyof AgentPermissions]) {
      for (const t of tools) permitted.add(t);
    }
  }

  return Array.from(permitted);
}

// ── Built-in hook: permission check (priority 50) ─────────────────────────────
//
// Defence-in-depth runtime check. wrapToolsForAgent already strips disallowed
// tools from the harness's tool list at agent-init time (so the model never
// learns they exist). This hook catches any edge-case where an unlisted tool
// name reaches onBeforeTool (e.g. tool added after init, or harness bypass).
//
// Uses dynamic import of agentManager to avoid a circular dependency:
//   agentManager → wrapToolsForAgent (agentPermissions) ← toolCallHooks
// Dynamic import breaks the cycle at module-load time.

// Priority 200 — permission check MUST run before the approval hook (priority 100).
// If a disallowed tool is also HIGH_RISK, we want a hard block (not an approval prompt).
toolCallHooks.register(
  async (ctx) => {
    try {
      const { getAgent } = await import("./agentManager");
      const agent = await getAgent(ctx.agentId);
      if (!agent) {
        const builtInSubAgentPermissions = getBuiltInSubAgentPermissions(ctx.agentId);
        if (builtInSubAgentPermissions) {
          try {
            checkPermissionsForAgentId(ctx.agentId, ctx.userId, builtInSubAgentPermissions, ctx.toolName);
            return undefined;
          } catch (permErr) {
            if (permErr instanceof PermissionDeniedError) {
              logAgentEvent({
                event: "tool_permission_denied",
                agentId: ctx.agentId,
                userId: ctx.userId,
                toolName: ctx.toolName,
                detail: "runtime-hook: built-in subagent not in permitted set",
              });
              return { block: true, blockReason: `Agent does not have permission to use ${ctx.toolName}` };
            }
            throw permErr;
          }
        }
        // Unknown agent — fail-closed: block rather than silently allow
        return { block: true, blockReason: `Agent ${ctx.agentId} not found` };
      }

      // Use checkPermission which correctly handles ALWAYS_ALLOWED_TOOLS
      // and PERMISSION_TOOL_MAP in one place. It throws PermissionDeniedError
      // if the tool is not permitted, returns void if permitted.
      try {
        checkPermission(agent, ctx.toolName);
        return undefined; // allowed — pass through
      } catch (permErr) {
        if (permErr instanceof PermissionDeniedError) {
          logAgentEvent({
            event: "tool_permission_denied",
            agentId: ctx.agentId,
            userId: ctx.userId,
            toolName: ctx.toolName,
            detail: "runtime-hook: not in permitted set",
          });
          return { block: true, blockReason: `Agent does not have permission to use ${ctx.toolName}` };
        }
        throw permErr; // unexpected error — re-throw to trigger fail-closed outer catch
      }
    } catch (err) {
      // Fail-closed: if agent lookup or permission check fails unexpectedly, block
      // rather than silently allowing execution. Log for diagnostics.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ToolCallHooks/permissions] hook error for ${ctx.toolName}:`, msg);
      return { block: true, blockReason: `Permission check failed for ${ctx.toolName}` };
    }
  },
  { priority: HOOK_PRIORITY.PERMISSION },
);
