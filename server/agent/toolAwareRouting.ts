import type { ToolGroup } from "./tools/index";
import {
  classifyActionOntology,
  type ActionActor,
  type ActionType,
} from "./actionOntology";
import { resolveToolsForAction } from "./toolResolver";

export type ToolAwareIntent =
  | "weather"
  | "calendar"
  | "email"
  | "reminder"
  | "memory"
  | "research"
  | "browser"
  | "github"
  | "railway"
  | "project"
  | "code"
  | "diagnostics";

export interface ToolAwareRoutePlan {
  intents: ToolAwareIntent[];
  capabilityIds: string[];
  toolGroups: ToolGroup[];
  priorityToolNames: string[];
  blockedToolNames: string[];
  guidance: string;
  shouldPreferTool: boolean;
  actionType: ActionType;
  actor: ActionActor;
  approvalRequired: boolean;
  actionReason: string;
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
    priorityToolNames: ["connected_accounts_list", "connected_accounts_search_tools", "connected_accounts_get_tool_schema", "connected_accounts_execute"],
    guidance: "For calendar questions or changes, use Composio connected account tools only: list connected accounts, search tools, read the selected tool schema, then execute with approval when needed. Do not use legacy Google/Microsoft calendar tools in this route.",
  },
  {
    intent: "email",
    patterns: [
      /\b(gmail|email|emails|inbox|mail|unread|message|messages)\b/i,
      /\b(reply|respond|draft|compose|send)\s+.*\b(email|message|gmail)\b/i,
    ],
    capabilityIds: ["email"],
    toolGroups: ["email"],
    priorityToolNames: ["connected_accounts_list", "connected_accounts_search_tools", "connected_accounts_get_tool_schema", "connected_accounts_execute"],
    guidance: "For Gmail, Outlook, inbox, or email action requests, use Composio connected account tools only: list connected accounts, search tools, read the selected tool schema, then execute with approval when needed. Do not use legacy Gmail, Outlook, fetch_emails, create_gmail_draft, or send_email tools in this route.",
  },
  {
    intent: "reminder",
    patterns: [
      /\b(remind\s+me|set\s+(a\s+)?reminder|reminder)\b/i,
      /\b(do|tell|ping|notify)\s+me\b.{0,80}\b(in|at|on|tomorrow|today|tonight|morning|afternoon|evening|hour|minute|week)\b/i,
      /\b(call|text|email|message|follow\s+up)\b.{0,80}\b(in|at|on|tomorrow|today|tonight|morning|afternoon|evening|hour|minute|week)\b/i,
    ],
    capabilityIds: ["coaching"],
    toolGroups: ["coaching", "scheduling"],
    priorityToolNames: ["schedule_jarvis_task"],
    guidance: "For reminders, personal to-dos, habits, or future follow-ups the user must do themselves, call schedule_jarvis_task as a non-executable user_task when the user gives a clear time or recurrence. Do not schedule physical or user-owned work as a Jarvis autonomous action. For future work Jarvis can actually perform with tools, use explicit cron/job tooling instead.",
  },
  {
    intent: "memory",
    patterns: [
      /\b(memory|remember|recall|what do you know about me|what have i told you|preferences?|living context)\b/i,
      /\b(save|store|add|write)\b.{0,60}\b(memory|memories)\b/i,
      /\bremember\s+(that|this)\b/i,
      /\b(my work hours|my goals|my routines|my projects|about me)\b/i,
      /\bwhat('?s|\s+is)\s+my\s+(name|nickname)\b/i,
      /\bwho\s+am\s+i\s*\??\s*$/i,
      /\bwhat\s+(name|nickname)\s+should\s+you\s+call\s+me\b/i,
      /\bwhat\s+should\s+you\s+call\s+me\b/i,
      /\bdo\s+you\s+know\s+my\s+(name|nickname)\b/i,
    ],
    capabilityIds: ["memory"],
    toolGroups: ["memory"],
    priorityToolNames: ["memory_search", "memory_get", "memory_save", "living_context_update"],
    guidance: "For memory or preference questions, search memory/living context before claiming not to know. When the user explicitly asks Jarvis to remember, save, or correct a fact, call memory_save with the stated content.",
  },
  {
    intent: "research",
    patterns: [
      /\b(search\s+(up|for)?|look\s+up|lookup|google|find|research|investigate)\b/i,
      /\b(?:latest|current|recent)\s+(?:[$\w.-]+\s+){0,6}(?:news|events?|updates?|sources?|articles?|reports?|headlines?|information|info|data|prices?|scores?|results?)\b/i,
      /\b(?:latest|current|recent)\s+(?:[$\w.-]+\s+){0,6}(?:presidents?|ceos?|cfos?|ctos?|coos?|chief\s+executives?|chief\s+executive\s+officers?|founders?|owners?|leaders?|mayors?|governors?|senators?|representatives?|directors?|chairs?|chairmen|chairwomen|chairpersons?|heads?|ministers?|secretar(?:y|ies)|generals?)\b/i,
      /\b(?:latest|current|recent)\s+(?:on|about|for)\b/i,
      /\b(?:news|updates?|sources?|articles?|headlines?|events?)\s+(?:today|currently|recently|latest|on|about|for)\b/i,
      /\btoday'?s?\s+(?:[$\w.-]+\s+){0,6}(?:news|events?|updates?|sources?|articles?|reports?|headlines?|information|info|data|prices?|scores?|results?)\b/i,
      /\b(?:news|updates?|sources?|articles?|reports?|headlines?)\b/i,
      /\b(?:[$\w.-]+\s+){1,6}(?:news|updates?|articles?|reports?|headlines?)\b/i,
      /\b(?:[$\w.-]+\s+){1,6}(?:events?|information|info|data|prices?|scores?|results?)\s+(?:today|currently|recently|latest|now|right\s+now)\b/i,
    ],
    capabilityIds: ["research", "browser"],
    toolGroups: ["research", "browser"],
    priorityToolNames: ["search_web", "research_topic", "web_fetch", "browser_navigate", "browser_extract"],
    guidance: "For research, news, source-finding, or current-info requests, call search_web or research_topic before answering. If search is not configured, use browser_navigate and browser_extract as the fallback. Cite useful source URLs from the tool results.",
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
  {
    intent: "diagnostics",
    patterns: [
      /\b(what'?s wrong|what is wrong|why did .{0,80}\bfail|why (is|are) .* not working|are you ok|are you okay|system health|self[- ]?diagnos(e|is)|diagnose yourself)\b/i,
      /\b(browser|tool|gateway|codex|railway|deploy|deployment|server|app|jarvis).*\b(broken|fail|failing|failed|down|stuck|not working)\b/i,
    ],
    capabilityIds: ["system"],
    toolGroups: ["system"],
    priorityToolNames: ["jarvis_self_diagnose"],
    guidance: "For Jarvis health, failure, or reliability questions, call jarvis_self_diagnose before answering so the reply is based on current subsystem status instead of stale chat history.",
  },
];

const EMPTY_PLAN: ToolAwareRoutePlan = {
  intents: [],
  capabilityIds: [],
  toolGroups: [],
  priorityToolNames: [],
  blockedToolNames: [],
  guidance: "",
  shouldPreferTool: false,
  actionType: "unknown",
  actor: "jarvis",
  approvalRequired: false,
  actionReason: "No tool-aware route matched.",
};

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function classifyToolAwareRoute(text: string): ToolAwareRoutePlan {
  const query = text.trim();
  if (!query) return EMPTY_PLAN;
  const ontology = classifyActionOntology(query);
  const toolResolution = resolveToolsForAction(ontology);

  const matched = TOOL_AWARE_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(query)),
  );
  if (matched.length === 0) {
    return {
      intents: [],
      capabilityIds: [],
      toolGroups: ontology.allowedToolGroups,
      priorityToolNames: [...toolResolution.requiredToolNames, ...toolResolution.optionalToolNames],
      blockedToolNames: toolResolution.blockedToolNames,
      guidance: ontology.actionType === "unknown" ? "" : `- ${ontology.reason}\n- Tool resolver: ${toolResolution.reason}`,
      shouldPreferTool: toolResolution.requiredToolNames.length > 0 || toolResolution.optionalToolNames.length > 0 || ontology.actionType === "blocked_physical_action",
      actionType: ontology.actionType,
      actor: ontology.actor,
      approvalRequired: toolResolution.approvalRequired,
      actionReason: ontology.reason,
    };
  }

  return {
    intents: matched.map((rule) => rule.intent),
    capabilityIds: unique(matched.flatMap((rule) => rule.capabilityIds)),
    toolGroups: unique([...matched.flatMap((rule) => rule.toolGroups), ...ontology.allowedToolGroups]),
    priorityToolNames: unique([
      ...matched.flatMap((rule) => rule.priorityToolNames),
      ...toolResolution.requiredToolNames,
      ...toolResolution.optionalToolNames,
    ]),
    blockedToolNames: toolResolution.blockedToolNames,
    guidance: [
      ...matched.map((rule) => `- ${rule.guidance}`),
      `- Action ownership: ${ontology.reason}`,
      `- Tool resolver: ${toolResolution.reason}`,
    ].join("\n"),
    shouldPreferTool: true,
    actionType: ontology.actionType,
    actor: ontology.actor,
    approvalRequired: toolResolution.approvalRequired,
    actionReason: ontology.reason,
  };
}
