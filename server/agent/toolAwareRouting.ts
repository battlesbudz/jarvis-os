import type { ToolGroup } from "./tools/index";

export type ToolAwareIntent =
  | "weather"
  | "calendar"
  | "email"
  | "memory"
  | "browser"
  | "github"
  | "railway"
  | "project"
  | "code";

export interface ToolAwareRoutePlan {
  intents: ToolAwareIntent[];
  capabilityIds: string[];
  toolGroups: ToolGroup[];
  priorityToolNames: string[];
  guidance: string;
  shouldPreferTool: boolean;
}

interface ToolAwareRule {
  intent: ToolAwareIntent;
  patterns: RegExp[];
  capabilityIds: string[];
  toolGroups: ToolGroup[];
  priorityToolNames: string[];
  guidance: string;
}

const TOOL_AWARE_RULES: ToolAwareRule[] = [
  {
    intent: "weather",
    patterns: [
      /\b(weather|forecast|temperature|temp|rain|snow|storm|wind|humidity|umbrella)\b/i,
      /\b(is it going to|will it)\s+(rain|snow|storm)\b/i,
    ],
    capabilityIds: ["research"],
    toolGroups: ["research"],
    priorityToolNames: ["weather_lookup"],
    guidance: "For weather or forecast requests, call weather_lookup before answering. Ask for city/state only if the location is missing.",
  },
  {
    intent: "calendar",
    patterns: [
      /\b(calendar|meetings?|events?|appointments?|schedule)\b/i,
      /\b(am i|are we)\s+free\b/i,
      /\b(block|book|schedule|reschedule|cancel)\s+.*\b(meeting|event|appointment|call|calendar)\b/i,
    ],
    capabilityIds: ["calendar"],
    toolGroups: ["calendar"],
    priorityToolNames: ["fetch_calendar", "create_calendar_event"],
    guidance: "For calendar questions, use fetch_calendar before summarizing. For calendar changes, use the calendar tool path with the normal approval/safety rules.",
  },
  {
    intent: "email",
    patterns: [
      /\b(gmail|email|emails|inbox|mail|unread|message|messages)\b/i,
      /\b(reply|respond|draft|compose|send)\s+.*\b(email|message|gmail)\b/i,
    ],
    capabilityIds: ["email"],
    toolGroups: ["email"],
    priorityToolNames: ["fetch_emails", "gmail_action", "create_gmail_draft", "send_email"],
    guidance: "For Gmail or inbox requests, use email tools before answering. Draft or send actions must stay reviewable and respect approval gates.",
  },
  {
    intent: "memory",
    patterns: [
      /\b(memory|remember|recall|what do you know about me|what have i told you|preferences?|living context)\b/i,
      /\b(my work hours|my goals|my routines|my projects|about me)\b/i,
    ],
    capabilityIds: ["memory"],
    toolGroups: ["memory"],
    priorityToolNames: ["memory_search", "memory_get", "living_context_update"],
    guidance: "For memory or preference questions, search memory/living context before claiming not to know.",
  },
  {
    intent: "browser",
    patterns: [
      /\b(browser|browse|open\s+(a\s+)?(website|site|page|url|tab)|navigate to|click|screenshot of (the )?page)\b/i,
      /https?:\/\//i,
      /\b(inspect|extract|read)\s+.*\b(page|website|site|url)\b/i,
    ],
    capabilityIds: ["browser", "research"],
    toolGroups: ["browser", "research"],
    priorityToolNames: ["browser_navigate", "browser_snapshot", "browser_extract", "web_fetch", "search_web"],
    guidance: "For browser/navigation/page-inspection requests, use browser tools or web fetch/search before giving a capability disclaimer.",
  },
  {
    intent: "github",
    patterns: [
      /\b(github|pull request|pull requests|prs?|repo|repository|branch|merge|workflow|ci|checks?)\b/i,
      /\b(issue|issues)\s+#?\d*\b/i,
    ],
    capabilityIds: ["github"],
    toolGroups: ["github"],
    priorityToolNames: ["list_github_prs", "get_github_pr", "merge_github_pr"],
    guidance: "For GitHub requests, use GitHub tools when connected instead of answering from memory.",
  },
  {
    intent: "railway",
    patterns: [
      /\b(railway|railway\.app|deployment|deployments|deploy|service logs?|build logs?|environment variables?|env vars?)\b/i,
      /\b(database url|postgres service|railway status|railway project)\b/i,
    ],
    capabilityIds: ["system", "browser", "research"],
    toolGroups: ["app_build", "mcp", "browser", "research"],
    priorityToolNames: ["deploy_app", "project_shell", "browser_navigate", "search_web"],
    guidance: "For Railway/deploy/status requests, use Railway MCP/deploy/project tools when available before falling back to docs or a setup explanation.",
  },
  {
    intent: "project",
    patterns: [
      /\b(start|create|make|open|set up|setup)\s+(a\s+|new\s+)?project\b/i,
      /\bproject\s+(called|named|titled)\b/i,
      /\bnew\s+project\b/i,
    ],
    capabilityIds: ["coaching"],
    toolGroups: ["coaching"],
    priorityToolNames: ["start_project", "queue_background_job"],
    guidance: "For project creation requests, use start_project. For websites, landing pages, dashboards, tools, or standalone apps, set project_kind='app'. If the user only supplies a project name, create the project with that name as the initial goal instead of claiming no project API exists.",
  },
  {
    intent: "code",
    patterns: [
      /\b(build|create|make|implement|add|code|write|fix|debug|inspect|edit|test)\s+.*\b(app|website|feature|tool|script|function|repo|repository|source|code|bug|integration|connector)\b/i,
      /\b(delegate to codex|use codex|self[- ]?write|write your source|change your code|patch your code)\b/i,
    ],
    capabilityIds: ["system", "self_edit", "agent_delegation"],
    toolGroups: ["system", "self_edit", "app_build", "mcp"],
    priorityToolNames: ["delegate_to_codex", "build_feature", "queue_background_job", "project_shell", "list_source_files", "read_source_file", "propose_code_change"],
    guidance: "For code-writing or self-improvement requests, route to Codex delegation/build/self-edit tools before replying in plain text. If the user explicitly asks for the fix to be permanent, pushed, published, deployed, or on GitHub, include the commit/push/publish requirement in the Codex delegation and allow external side effects only for that exact requested action.",
  },
];

const EMPTY_PLAN: ToolAwareRoutePlan = {
  intents: [],
  capabilityIds: [],
  toolGroups: [],
  priorityToolNames: [],
  guidance: "",
  shouldPreferTool: false,
};

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function classifyToolAwareRoute(text: string): ToolAwareRoutePlan {
  const query = text.trim();
  if (!query) return EMPTY_PLAN;

  const matched = TOOL_AWARE_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(query)),
  );
  if (matched.length === 0) return EMPTY_PLAN;

  return {
    intents: matched.map((rule) => rule.intent),
    capabilityIds: unique(matched.flatMap((rule) => rule.capabilityIds)),
    toolGroups: unique(matched.flatMap((rule) => rule.toolGroups)),
    priorityToolNames: unique(matched.flatMap((rule) => rule.priorityToolNames)),
    guidance: matched.map((rule) => `- ${rule.guidance}`).join("\n"),
    shouldPreferTool: true,
  };
}
