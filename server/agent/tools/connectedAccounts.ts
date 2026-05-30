import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import {
  buildComposioConnectIntent,
  classifyComposioActionPermission,
  createComposioClient,
  createComposioSessionConfig,
  getComposioCallbackUrl,
  getComposioStatus,
  isComposioConnectionPlatform,
  toolkitForPlatform,
} from "../../connectors/composio/connectionCenter";

function asString(value: unknown): string {
  return String(value || "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toolResult(label: string, payload: unknown, ok = true): ToolResult {
  const content = typeof payload === "string" ? payload : JSON.stringify(payload);
  return { ok, label, content, detail: content };
}

function clientFromArgs(args: ToolArgs) {
  return (args._composioClientForTest || createComposioClient()) as ReturnType<typeof createComposioClient>;
}

async function sessionFor(ctx: ToolContext | undefined, args: ToolArgs, toolkits?: string[]) {
  if (args._composioSessionForTest) return args._composioSessionForTest as any;
  if (!ctx?.userId) throw new Error("Connected-account tools require a user.");
  const client = clientFromArgs(args);
  if (!client.create) throw new Error("Composio session creation is unavailable.");
  return client.create(ctx.userId, createComposioSessionConfig(toolkits));
}

export const connectedAccountsListTool: AgentTool = {
  name: "connected_accounts_list",
  description:
    "List external accounts connected through Jarvis Connected Accounts. Use before claiming whether Gmail, Outlook, Google Calendar, Slack, Drive, or Tasks are connected.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(args: ToolArgs = {}, ctx?: ToolContext): Promise<ToolResult> {
    if (!ctx?.userId) return toolResult("Connected accounts unavailable", "Missing user context.", false);
    const status = await getComposioStatus(ctx.userId, {
      client: args._composioClientForTest as any,
      store: args._composioStoreForTest as any,
    });
    return toolResult("Connected accounts", status, !status.error);
  },
};

export const connectedAccountsConnectLinkTool: AgentTool = {
  name: "connected_accounts_connect_link",
  description:
    "Create a secure Composio Connect Link for an external account. Use when the user asks to connect Gmail, Calendar, Outlook, Slack, Drive, or Tasks.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["gmail", "google-calendar", "outlook-mail", "outlook-calendar", "slack", "google-drive", "google-tasks"],
      },
    },
    required: ["platform"],
  },
  async execute(args: ToolArgs, ctx?: ToolContext): Promise<ToolResult> {
    if (!ctx?.userId) return toolResult("Connect link unavailable", "Missing user context.", false);
    const platform = asString(args.platform).toLowerCase();
    if (!isComposioConnectionPlatform(platform)) {
      return toolResult("Unknown connected account", `Unsupported platform "${platform}".`, false);
    }
    const callbackUrl = typeof args._callbackUrlForTest === "string" ? args._callbackUrlForTest : getComposioCallbackUrl();
    const intent = await buildComposioConnectIntent(ctx.userId, platform, callbackUrl, {
      client: args._composioClientForTest as any,
    });
    return toolResult(intent.buttonLabel, intent, !intent.error);
  },
};

export const connectedAccountsSearchToolsTool: AgentTool = {
  name: "connected_accounts_search_tools",
  description:
    "Search Composio connected-account tools by natural-language use case for a platform/toolkit. Run connected_accounts_get_tool_schema before execution.",
  parameters: {
    type: "object",
    properties: {
      platform: { type: "string", description: "Platform such as gmail, google-calendar, outlook-mail, slack, google-drive, or google-tasks." },
      query: { type: "string", description: "Natural-language action search, such as 'list recent emails' or 'create calendar event'." },
    },
    required: ["platform", "query"],
  },
  async execute(args: ToolArgs, ctx?: ToolContext): Promise<ToolResult> {
    const platform = asString(args.platform).toLowerCase();
    const query = asString(args.query);
    if (!ctx?.userId || !platform || !query) {
      return toolResult("Missing connected-account search args", "user, platform, and query are required.", false);
    }
    const toolkit = toolkitForPlatform(platform);
    const session = await sessionFor(ctx, args, [toolkit]);
    const client = clientFromArgs(args);
    const result = typeof session.search === "function"
      ? await session.search({ query, toolkits: [toolkit] })
      : client.tools?.get
        ? await client.tools.get(ctx.userId, { toolkits: [toolkit], search: query, limit: 10 })
        : { error: "Composio tool search is unavailable." };
    return toolResult(`Connected-account search ${platform}`, result);
  },
};

export const connectedAccountsGetToolSchemaTool: AgentTool = {
  name: "connected_accounts_get_tool_schema",
  description:
    "Fetch a Composio tool schema/details by slug before executing it so Jarvis knows the required arguments and risk.",
  parameters: {
    type: "object",
    properties: {
      platform: { type: "string", description: "Platform such as gmail, google-calendar, outlook-mail, slack, google-drive, or google-tasks." },
      tool_slug: { type: "string", description: "Composio tool slug returned by connected_accounts_search_tools." },
    },
    required: ["platform", "tool_slug"],
  },
  async execute(args: ToolArgs, ctx?: ToolContext): Promise<ToolResult> {
    const platform = asString(args.platform).toLowerCase();
    const toolSlug = asString(args.tool_slug || args.toolSlug);
    if (!ctx?.userId || !platform || !toolSlug) {
      return toolResult("Missing connected-account schema args", "user, platform, and tool_slug are required.", false);
    }
    const session = await sessionFor(ctx, args, [toolkitForPlatform(platform)]);
    const client = clientFromArgs(args);
    const result = typeof session.search === "function"
      ? await session.search({ query: toolSlug, toolkits: [toolkitForPlatform(platform)] })
      : client.tools?.get
        ? await client.tools.get(ctx.userId, toolSlug)
        : { error: "Composio tool schema lookup is unavailable." };
    const permission = classifyComposioActionPermission(platform, toolSlug, JSON.stringify(result).slice(0, 1000));
    return toolResult(`Connected-account schema ${platform}`, { tool: result, permission });
  },
};

export const connectedAccountsExecuteTool: AgentTool = {
  name: "connected_accounts_execute",
  description:
    "Execute a Composio connected-account tool. First search tools and inspect schema. Sends, deletes, posts, calendar writes, and other external writes require approval.",
  parameters: {
    type: "object",
    properties: {
      platform: { type: "string", description: "Platform such as gmail, google-calendar, outlook-mail, slack, google-drive, or google-tasks." },
      tool_slug: { type: "string", description: "Composio tool slug to execute." },
      arguments: { type: "object", description: "Arguments required by the selected Composio tool." },
      account: { type: "string", description: "Optional account selector for multi-account sessions." },
      approved: { type: "boolean", description: "Set true only after explicit user approval." },
      confirmed: { type: "boolean", description: "Alias for approved after explicit user approval." },
      dry_run: { type: "boolean", description: "When true, return the execution plan without calling Composio." },
    },
    required: ["platform", "tool_slug"],
  },
  async execute(args: ToolArgs, ctx?: ToolContext): Promise<ToolResult> {
    const platform = asString(args.platform).toLowerCase();
    const toolSlug = asString(args.tool_slug || args.toolSlug);
    if (!ctx?.userId || !platform || !toolSlug) {
      return toolResult("Missing connected-account execute args", "user, platform, and tool_slug are required.", false);
    }

    const permission = classifyComposioActionPermission(platform, toolSlug, JSON.stringify(args.arguments || {}).slice(0, 1000));
    const approved = args.approved === true || args.confirmed === true || args._approved === true;
    const payload = {
      platform,
      toolkit: toolkitForPlatform(platform),
      toolSlug,
      arguments: asRecord(args.arguments),
      account: asString(args.account) || undefined,
      permission,
    };
    if (args.dry_run === true) return toolResult(`Connected-account dry run ${platform}`, payload);
    if (permission.approvalRequired && !approved) {
      return toolResult(
        "Connected-account approval required",
        {
          requiresApproval: true,
          ...payload,
          message: `Approval required before running ${toolSlug}. ${permission.reason}`,
        },
        false,
      );
    }

    const session = await sessionFor(ctx, args, [toolkitForPlatform(platform)]);
    const client = clientFromArgs(args);
    const result = typeof session.execute === "function"
      ? await session.execute(toolSlug, payload.arguments, payload.account ? { account: payload.account } : undefined)
      : client.tools?.execute
        ? await client.tools.execute(toolSlug, {
        userId: ctx.userId,
        arguments: payload.arguments,
        dangerouslySkipVersionCheck: true,
        })
        : { error: "Composio tool execution is unavailable." };
    return toolResult(`Connected-account execute ${platform}`, { result, permission });
  },
};
