import type { AgentTool, ToolArgs, ToolResult } from "../types";
import { runOneCli } from "../../oneCliConnection";

const ONE_TIMEOUT_MS = 45000;

function normalizePlatform(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function asString(value: unknown): string {
  return String(value || "").trim();
}

function parseData(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function toolResult(label: string, result: ReturnType<typeof runOneCli>): ToolResult {
  const payload = {
    command: result.command,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };

  if (!result.ok) {
    return {
      ok: false,
      label,
      content: JSON.stringify(payload),
      detail: result.stderr || result.error || result.stdout,
    };
  }

  return {
    ok: true,
    label,
    content: result.stdout || JSON.stringify(payload),
    detail: JSON.stringify(payload),
  };
}

export const oneListConnectionsTool: AgentTool = {
  name: "one_list_connections",
  description:
    "List the platforms/accounts available through the local One CLI Agent Vault. Use this before claiming whether Gmail, Outlook, calendars, Slack, WhatsApp, Discord, or other One-supported accounts are connected.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(): Promise<ToolResult> {
    const result = runOneCli(["--agent", "list"], ONE_TIMEOUT_MS);
    return toolResult("One connections", result);
  },
};

export const oneSearchActionsTool: AgentTool = {
  name: "one_search_actions",
  description:
    "Search One CLI for actions on a connected platform using natural language. Run one_get_action_knowledge on the chosen action before executing it.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        description: "One platform name in kebab-case, such as gmail, outlook-mail, google-calendar, slack, or discord.",
      },
      query: {
        type: "string",
        description: "Natural-language action search, such as 'list recent emails' or 'create calendar event'.",
      },
      action_type: {
        type: "string",
        enum: ["execute", "search", "trigger", "all"],
        description: "Optional action type filter. Use execute for normal actions.",
      },
    },
    required: ["platform", "query"],
  },
  async execute(args: ToolArgs): Promise<ToolResult> {
    const platform = normalizePlatform(args.platform);
    const query = asString(args.query).replace(/\s+/g, "+");
    const actionType = asString(args.action_type || "execute");
    if (!platform || !query) {
      return { ok: false, label: "Missing One action search args", content: "platform and query are required." };
    }

    const cliArgs = ["--agent", "actions", "search", platform, query];
    if (actionType && actionType !== "all") cliArgs.push("-t", actionType);
    const result = runOneCli(cliArgs, ONE_TIMEOUT_MS);
    return toolResult(`One search ${platform}`, result);
  },
};

export const oneGetActionKnowledgeTool: AgentTool = {
  name: "one_get_action_knowledge",
  description:
    "Fetch full One CLI documentation for an action ID before executing it. This is required before one_execute_action so Jarvis knows the required fields.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        description: "One platform name in kebab-case.",
      },
      action_id: {
        type: "string",
        description: "Action ID returned by one_search_actions.",
      },
    },
    required: ["platform", "action_id"],
  },
  async execute(args: ToolArgs): Promise<ToolResult> {
    const platform = normalizePlatform(args.platform);
    const actionId = asString(args.action_id);
    if (!platform || !actionId) {
      return { ok: false, label: "Missing One action docs args", content: "platform and action_id are required." };
    }

    const result = runOneCli(["--agent", "actions", "knowledge", platform, actionId], ONE_TIMEOUT_MS);
    return toolResult(`One docs ${platform}`, result);
  },
};

export const oneExecuteActionTool: AgentTool = {
  name: "one_execute_action",
  description:
    "Execute a One CLI action against a connected account. First call one_search_actions, then one_get_action_knowledge, then execute with platform, action_id, connection_key, and JSON data. This may change external services and requires approval.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        description: "One platform name in kebab-case.",
      },
      action_id: {
        type: "string",
        description: "Action ID returned by one_search_actions.",
      },
      connection_key: {
        type: "string",
        description: "Connection key from one_list_connections.",
      },
      data: {
        type: "object",
        description: "Request body JSON required by the selected One action. Omit or use {} for GET/read actions with no body.",
      },
      path_vars: {
        type: "object",
        description: "Path variables required by the action docs, such as userId or messageId.",
      },
      query_params: {
        type: "object",
        description: "Query parameters required by the action docs, such as top, filter, or select.",
      },
      headers: {
        type: "object",
        description: "Additional headers only when the action docs require them.",
      },
      dry_run: {
        type: "boolean",
        description: "When true, show the request One would send without executing it.",
      },
    },
    required: ["platform", "action_id", "connection_key"],
  },
  async execute(args: ToolArgs): Promise<ToolResult> {
    const platform = normalizePlatform(args.platform);
    const actionId = asString(args.action_id);
    const connectionKey = asString(args.connection_key);
    const data = parseData(args.data);
    const pathVars = parseData(args.path_vars);
    const queryParams = parseData(args.query_params);
    const headers = parseData(args.headers);
    if (!platform || !actionId || !connectionKey) {
      return {
        ok: false,
        label: "Missing One execute args",
        content: "platform, action_id, and connection_key are required.",
      };
    }

    const cliArgs = ["--agent", "actions", "execute", platform, actionId, connectionKey];
    if (data) cliArgs.push("-d", data);
    if (pathVars) cliArgs.push("--path-vars", pathVars);
    if (queryParams) cliArgs.push("--query-params", queryParams);
    if (headers) cliArgs.push("--headers", headers);
    if (args.dry_run === true) cliArgs.push("--dry-run");

    const result = runOneCli(
      cliArgs,
      ONE_TIMEOUT_MS,
    );
    return toolResult(`One execute ${platform}`, result);
  },
};
