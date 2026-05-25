import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import { runOneCli } from "../../oneCliConnection";
import { classifyOneActionPermission } from "../../oneConnectionCenter";
import { createOneApiClient, getSavedOneApiKey, type OneApiFetch } from "../../oneApiConnection";

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

function apiFetchFromArgs(args: ToolArgs): OneApiFetch | undefined {
  return typeof args._oneApiFetchForTest === "function" ? args._oneApiFetchForTest as OneApiFetch : undefined;
}

async function getOneApiKeyForTool(args: ToolArgs, ctx?: ToolContext): Promise<string | null> {
  if (typeof args._oneApiKeyForTest === "string" && args._oneApiKeyForTest.trim()) {
    return args._oneApiKeyForTest.trim();
  }
  if (!ctx?.userId) return null;
  return getSavedOneApiKey(ctx.userId);
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

function apiToolResult(label: string, result: { ok: boolean; status: number; url: string; error?: string; [key: string]: unknown }): ToolResult {
  const payload = JSON.stringify(result);
  if (!result.ok) {
    return {
      ok: false,
      label,
      content: payload,
      detail: result.error || payload,
    };
  }
  return {
    ok: true,
    label,
    content: payload,
    detail: JSON.stringify({ status: result.status, url: result.url }),
  };
}

export const oneListConnectionsTool: AgentTool = {
  name: "one_list_connections",
  description:
    "List the platforms/accounts available through the configured One Connector session. Use this before claiming whether Gmail, Outlook, calendars, Slack, Discord, or other One-supported accounts are connected.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(args: ToolArgs = {}, ctx?: ToolContext): Promise<ToolResult> {
    const apiKey = await getOneApiKeyForTool(args, ctx);
    if (apiKey) {
      const result = await createOneApiClient(apiKey, apiFetchFromArgs(args)).listConnections();
      return apiToolResult("One connections", result);
    }

    const result = runOneCli(["--agent", "list"], ONE_TIMEOUT_MS);
    return toolResult("One connections", result);
  },
};

export const oneSearchActionsTool: AgentTool = {
  name: "one_search_actions",
  description:
    "Search One for actions on a connected platform using natural language. Run one_get_action_knowledge on the chosen action before executing it.",
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
  async execute(args: ToolArgs, ctx?: ToolContext): Promise<ToolResult> {
    const platform = normalizePlatform(args.platform);
    const query = asString(args.query);
    const actionType = asString(args.action_type || "execute");
    if (!platform || !query) {
      return { ok: false, label: "Missing One action search args", content: "platform and query are required." };
    }

    const apiKey = await getOneApiKeyForTool(args, ctx);
    if (apiKey) {
      const result = await createOneApiClient(apiKey, apiFetchFromArgs(args)).searchActions(platform, query);
      return apiToolResult(`One search ${platform}`, result);
    }

    const cliArgs = ["--agent", "actions", "search", platform, query.replace(/\s+/g, "+")];
    if (actionType && actionType !== "all") cliArgs.push("-t", actionType);
    const result = runOneCli(cliArgs, ONE_TIMEOUT_MS);
    return toolResult(`One search ${platform}`, result);
  },
};

export const oneGetActionKnowledgeTool: AgentTool = {
  name: "one_get_action_knowledge",
  description:
    "Fetch full One action documentation for an action ID before executing it. This is required before one_execute_action so Jarvis knows the required fields.",
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
  async execute(args: ToolArgs, ctx?: ToolContext): Promise<ToolResult> {
    const platform = normalizePlatform(args.platform);
    const actionId = asString(args.action_id);
    if (!platform || !actionId) {
      return { ok: false, label: "Missing One action docs args", content: "platform and action_id are required." };
    }

    const apiKey = await getOneApiKeyForTool(args, ctx);
    if (apiKey) {
      const result = await createOneApiClient(apiKey, apiFetchFromArgs(args)).searchActions(platform, actionId);
      return apiToolResult(`One docs ${platform}`, result);
    }

    const result = runOneCli(["--agent", "actions", "knowledge", platform, actionId], ONE_TIMEOUT_MS);
    return toolResult(`One docs ${platform}`, result);
  },
};

export const oneExecuteActionTool: AgentTool = {
  name: "one_execute_action",
  description:
    "Execute a One action against a connected account. First call one_search_actions, then one_get_action_knowledge, then execute with platform, action_id, connection_key, and JSON data. This may change external services and requires approval.",
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
      approved: {
        type: "boolean",
        description: "Set to true only after the user explicitly approves a draft/create/send/delete/post/update calendar action.",
      },
      confirmed: {
        type: "boolean",
        description: "Alias for approved. Use only after explicit user confirmation.",
      },
    },
    required: ["platform", "action_id", "connection_key"],
  },
  async execute(args: ToolArgs, ctx?: ToolContext): Promise<ToolResult> {
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

    const permission = classifyOneActionPermission(platform, actionId);
    const approved = args.approved === true || args.confirmed === true || args._approved === true;
    if (permission.approvalRequired && !approved && args.dry_run !== true) {
      return {
        ok: false,
        label: "One approval required",
        content:
          `Approval required before running One action '${actionId}' on ${platform}. ${permission.reason} ` +
          "Show the user exactly what will happen, then call one_execute_action again with approved=true only after they confirm.",
        detail: JSON.stringify({ requiresApproval: true, permission }),
      };
    }

    const apiKey = await getOneApiKeyForTool(args, ctx);
    if (apiKey) {
      const payload = {
        platform,
        actionId,
        action_id: actionId,
        data: args.data ?? {},
        pathVars: args.path_vars ?? {},
        queryParams: args.query_params ?? {},
        headers: args.headers ?? {},
        dryRun: args.dry_run === true,
      };
      const result = await createOneApiClient(apiKey, apiFetchFromArgs(args)).passthrough(connectionKey, payload);
      return apiToolResult(`One execute ${platform}`, result);
    }

    const cliArgs = ["--agent", "actions", "execute", platform, actionId, connectionKey];
    if (data) cliArgs.push("-d", data);
    if (pathVars) cliArgs.push("--path-vars", pathVars);
    if (queryParams) cliArgs.push("--query-params", queryParams);
    if (headers) cliArgs.push("--headers", headers);
    if (args.dry_run === true) cliArgs.push("--dry-run");

    const run = typeof args._runOneCliForTest === "function" ? args._runOneCliForTest as typeof runOneCli : runOneCli;
    const result = run(
      cliArgs,
      ONE_TIMEOUT_MS,
    );
    return toolResult(`One execute ${platform}`, result);
  },
};
