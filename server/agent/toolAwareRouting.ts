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
      /\b(?:latest|current|recent)\s+(?:[$\w.\/&-]+\s+){0,6}(?:news|events?|games?|matches?|fixtures?|schedules?|hours?|opening\s+hours|business\s+hours|store\s+hours|updates?|developments?|situations?|sources?|articles?|headlines?|videos?|uploads?|posts?|information|info|data|traffic|quality|conditions?|prices?|scores?|results?|delays?|cancellations?|cancelations?|rulings?|decisions?|orders?|opinions?|judg(?:e)?ments?|verdicts?|versions?|releases?|rates?|values?|rankings?|standings?|polls?|odds?|availability|status|population|counts?|totals?)\b/i,
      /\b(?:latest|current|recent)\s+(?:[$\w.\/&-]+\s+){0,6}(?:presidents?|ceos?|cfos?|ctos?|coos?|chief\s+executives?|chief\s+executive\s+officers?|founders?|owners?|leaders?|mayors?|governors?|senators?|representatives?|directors?|chairs?|chairmen|chairwomen|chairpersons?|heads?|ministers?|secretar(?:y|ies)|generals?)\b/i,
      /\b(?:latest|current|recent)\s+(?:on|about|for|in|with)\b/i,
      /\b(?:latest|current|recent)\s+(?:S&P\s*500|NASDAQ(?:\s+Composite)?|Dow(?:\s+Jones)?(?:\s+Industrial\s+Average)?|Russell\s*2000|[$][A-Za-z]{1,8}|[A-Z]{1,6}(?:[\/.-][A-Z]{1,6})?)\b/,
      /\b(?:latest|current|recent)\s+(?:s&p\s*500|nasdaq(?:\s+composite)?|dow(?:\s+jones)?(?:\s+industrial\s+average)?|russell\s*2000|tsla|aapl|nvda|msft|amzn|meta|googl?|nflx|spy|qqq|spx|btc(?:\/usd)?|eth(?:\/usd)?|sol|xrp|doge|ada)\b/i,
      /\b(?:latest|current|recent)\s+(?!(?:i|me|you|we|us|they|them|he|she|it|my|our|this|that|your|their|one|ones|thing|things|stuff|item|items|reply|replies|response|responses|answer|answers|question|questions|prompt|prompts|request|requests|report|reports|draft|drafts|document|documents|doc|docs|conversation|conversations|message|messages|email|emails|inbox|calendar|events?|schedule|schedules|meeting|meetings|appointment|appointments|reminder|reminders|task|tasks|to-?dos?|note|notes)\b)(?:[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,5})\s*\??$/i,
      /^\s*(?!(?:[Hh]ey|[Hh]ello|[Hh]i|[Yy]o|JARVIS|Jarvis|jarvis|Travis|travis|i|me|you|we|us|they|them|he|she|it|my|our|this|that|your|their|one|ones|thing|things|stuff|item|items|reply|replies|response|responses|answer|answers|question|questions|prompt|prompts|request|requests|report|reports|draft|drafts|document|documents|doc|docs|conversation|conversations|message|messages|email|emails|inbox|calendar|events?|schedule|schedules|meeting|meetings|appointment|appointments|reminder|reminders|task|tasks|to-?dos?|note|notes)\b)(?:[A-Z][A-Za-z0-9&.'\u2019-]*(?:\s+[A-Z][A-Za-z0-9&.'\u2019-]*){0,5})\s+(?:today|tonight|now|right\s+now)\s*\??\s*$/,
      /^\s*(?!(?:hey|hello|hi|yo|jarvis|travis|i|me|you|we|us|they|them|he|she|it|my|our|this|that|your|their|one|ones|thing|things|stuff|item|items|work|school|home|life|day|plan|plans|reply|replies|response|responses|answer|answers|question|questions|prompt|prompts|request|requests|report|reports|draft|drafts|document|documents|doc|docs|conversation|conversations|message|messages|email|emails|inbox|calendar|events?|schedule|schedules|meeting|meetings|appointment|appointments|reminder|reminders|task|tasks|to-?dos?|note|notes|how|what|when|where|why|who|can|could|would|should|do|does|did|is|are|am|was|were)\b)(?:[a-z][a-z0-9&.'\u2019-]*(?:\s+[a-z][a-z0-9&.'\u2019-]*){0,4})\s+(?:today|tonight|now|right\s+now)\s*\??\s*$/i,
      /\b(?:S&P\s*500|NASDAQ(?:\s+Composite)?|Dow(?:\s+Jones)?(?:\s+Industrial\s+Average)?|Russell\s*2000|[$][A-Za-z]{1,8}|[A-Z]{1,6}(?:[\/.-][A-Z]{1,6})?)\s+(?:today|currently|recently|now|right\s+now)\b/,
      /\b(?:s&p\s*500|nasdaq(?:\s+composite)?|dow(?:\s+jones)?(?:\s+industrial\s+average)?|russell\s*2000|tsla|aapl|nvda|msft|amzn|meta|googl?|nflx|spy|qqq|spx|btc(?:\/usd)?|eth(?:\/usd)?|sol|xrp|doge|ada)\s+(?:today|currently|recently|now|right\s+now)\b/i,
      /^\s*(?:what(?:'s|\s+is)\s+)?(?!(?:my|our|this|that)\b)(?:[$\w.\/&-]+\s+){1,6}latest\s*\??\s*$/i,
      /\blatest\s+from\b/i,
      /\bwhat(?:'s|\s+is)?\s+new\s+(?:today|currently|recently|now|right\s+now)\b/i,
      /\bwhat(?:'s|\s+is)?\s+new\s+(?:in|with|about|at|for|on)\s+(?:[$\w.\/&,-]+\s+){1,8}(?:today|currently|recently|now|right\s+now)\b/i,
      /\bhow(?:'s|\s+(?:is|are))\s+(?!(?:you|we|i|it|things?)\b)(?:[$\w.\/&-]+\s+){1,8}(?:doing|performing|trending|looking)\s+(?:today|currently|recently|now|right\s+now)\b/i,
      /\bwhat(?:'s|\s+is)?\s+(?:happening|going\s+on)\s+today\b/i,
      /\bwhat\s+happened\s+today\b/i,
      /\bwhat(?:'s|\s+is)?\s+(?:happening|going\s+on)\s+(?:in|with|to|on|about|at|around|near|for)\s+(?:[$\w.\/&,-]+\s+){1,8}today\b/i,
      /\bwhat\s+happened\s+(?:in|with|to|on|about|at|around|near|for)\s+(?:[$\w.\/&,-]+\s+){1,8}today\b/i,
      /\bwhat\s+did\s+(?!(?:you|we|i|it|this|that)\b)(?:the\s+)?(?:[$\w.\/&,'\u2019-]+\s+){1,8}(?:announce|say|report|release|publish|post|decide|rule|order|sign|launch|introduce|unveil|confirm|deny|approve|reject|win|lose)\s+(?:today|tonight|yesterday|now|right\s+now)\b/i,
      /\b(?:who\s+(?:is|are)\s+playing|who\s+plays|(?:is|are)\s+(?!(?:you|we|i|it|this|that)\b)(?:the\s+)?(?:[$\w.\/&,-]+\s+){0,5}playing|(?:do|does)\s+(?!(?:you|we|i|it|this|that)\b)(?:the\s+)?(?:[$\w.\/&,-]+\s+){0,5}play)\s+(?:today|tonight|tomorrow|now|right\s+now)\b/i,
      /\b(?:is|are)\s+(?!(?:you|we|i|it|this|that)\b)(?:the\s+)?(?:[$\w.\/&,'\u2019-]+\s+){1,6}(?:open|closed)\s+(?:today|tonight|tomorrow|now|right\s+now)\b/i,
      /\b(?:is|are)\s+(?!(?:you|we|i|it|this|that)\b)(?:the\s+)?(?:[$\w.\/&,'\u2019-]+\s+){1,6}(?:delayed|cancelled|canceled|on\s+time|running)\s+(?:today|tonight|tomorrow|now|right\s+now)\b/i,
      /\b(?!(?:you|we|i|it|this|that|is|are|am|was|were|do|does|did|can|could|would|should)\b)(?:the\s+)?(?:[$\w.\/&,'\u2019-]+\s+){1,6}(?:open|closed|delayed|cancelled|canceled|on\s+time|running)\s+(?:today|tonight|tomorrow|now|right\s+now)\b/i,
      /\b(?:did)\s+(?!(?:you|we|i|it|this|that)\b)(?:the\s+)?(?:[$\w.\/&,-]+\s+){0,5}(?:win|lose|play)\s+(?:today|tonight|yesterday)\b/i,
      /\bwho\s+(?:won|lost)\s+(?:today|tonight|yesterday)\b/i,
      /\b(?:stock\s+market|stocks?|markets?)\b.{0,60}\b(?:today|currently|recently|latest|now|right\s+now)\b/i,
      /\b(?:news|updates?|sources?|articles?)\s+(?:today|currently|recently|latest|on|about|for)\b/i,
      /\bheadlines?\s+(?:today|currently|recently|latest)\b/i,
      /\btoday(?:['\u2019]s|s)?\s+(?:[$\w.\/&-]+\s+){0,6}(?:news|events?|games?|matches?|fixtures?|schedules?|hours?|opening\s+hours|business\s+hours|store\s+hours|updates?|developments?|situations?|sources?|articles?|headlines?|videos?|uploads?|posts?|information|info|data|traffic|quality|conditions?|prices?|scores?|results?|delays?|cancellations?|cancelations?|rulings?|decisions?|orders?|opinions?|judg(?:e)?ments?|verdicts?|versions?|releases?|rates?|values?|rankings?|standings?|polls?|odds?|availability|status|population|counts?|totals?)\b/i,
      /\b(?:news|updates?|sources?)\b/i,
      /^\s*(?:the\s+)?headlines?\s*\??\s*$/i,
      /\b(?:[$\w.\/&-]+\s+){1,6}(?:news|updates?)\b/i,
      /\b(?:[$\w.\/&,'\u2019-]+\s+){1,6}(?:events?|games?|matches?|fixtures?|schedules?|hours?|opening\s+hours|business\s+hours|store\s+hours|headlines?|videos?|uploads?|posts?|information|info|data|traffic|quality|conditions?|prices?|scores?|results?|delays?|cancellations?|cancelations?|rulings?|decisions?|orders?|opinions?|judg(?:e)?ments?|verdicts?|developments?|situations?|versions?|releases?|rates?|values?|rankings?|standings?|polls?|odds?|availability|status|population|counts?|totals?)\s+(?:today|currently|recently|latest|now|right\s+now)\b/i,
      /\b(?:events?|games?|matches?|fixtures?|schedules?|hours?|opening\s+hours|business\s+hours|store\s+hours|headlines?|videos?|uploads?|posts?|information|info|data|traffic|quality|conditions?|prices?|scores?|results?|delays?|cancellations?|cancelations?|rulings?|decisions?|orders?|opinions?|judg(?:e)?ments?|verdicts?|developments?|situations?|versions?|releases?|rates?|values?|rankings?|standings?|polls?|odds?|availability|status|population|counts?|totals?)\s+(?:of|for|from|in|on|at|near|around|about|with)\s+(?:[$\w.\/&,-]+\s+){1,8}(?:today|currently|recently|latest|now|right\s+now)\b/i,
      /\b(?:concerts?|shows?|performances?|festivals?|exhibitions?|exhibits?|plays?|musicals?|comedy\s+shows?|open\s+mics?|meetups?|fairs?|markets?|parades?|screenings?|movies?|sports\s+events?|tournaments?|classes?|workshops?)\s+(?:in|near|around|at)\s+(?:[$\w.\/&,-]+\s+){1,8}(?:today|tonight|tomorrow|this\s+(?:weekend|week|month))\b/i,
      /\b(?:concerts?|shows?|performances?|festivals?|exhibitions?|exhibits?|plays?|musicals?|comedy\s+shows?|open\s+mics?|meetups?|fairs?|markets?|parades?|screenings?|movies?|sports\s+events?|tournaments?|classes?|workshops?)\s+(?:today|tonight|tomorrow|this\s+(?:weekend|week|month))\s+(?:in|near|around|at)\s+(?!(?:my|our)\b)(?:[$\w.\/&,-]+\s+){0,7}[$\w.\/&,-]+\s*\??$/i,
      /\b(?:presidents?|ceos?|cfos?|ctos?|coos?|chief\s+executives?|chief\s+executive\s+officers?|founders?|owners?|leaders?|mayors?|governors?|senators?|representatives?|directors?|chairs?|chairmen|chairwomen|chairpersons?|heads?|ministers?|secretar(?:y|ies)|generals?)\s+(?:of|for|at|in)\s+(?:[$\w.\/&,-]+\s+){1,8}(?:today|currently|recently|latest|now|right\s+now)\b/i,
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

function isPrivateCalendarEventQuery(query: string): boolean {
  return (
    /\b(?:my|our)\s+(?:calendar\s+)?events?\b/i.test(query) ||
    /\bevents?\s+(?:are\s+)?(?:on|in|for)\s+(?:my|our)\s+calendar\b/i.test(query) ||
    /\b(?:my|our)\s+(?:calendar\s+)?schedule\b/i.test(query) ||
    /\bon\s+(?:my|our)\s+schedule\b/i.test(query) ||
    /\bschedule\s+(?:on|in|for)\s+(?:my|our)\s+calendar\b/i.test(query)
  );
}

const MIXED_RESEARCH_CLAUSE_SEPARATOR =
  /\s+(?:and|also|plus|then|along\s+with|together\s+with|as\s+well\s+as)\s+|\s+with\s+(?=(?:today(?:['\u2019]s|s)?\s+(?:news|updates?|headlines?|articles?|sources?)|(?:latest|current|recent)\b|(?:news|updates?|headlines?|articles?|sources?)\b))|[,;]+/i;

function hasExplicitWebResearchCommand(query: string): boolean {
  return (
    /\b(?:search\s+(?:the\s+)?(?:web|internet)|web\s+search|google|research|investigate)\b/i.test(query) ||
    /\b(?:search\s+(?:up|for)|look\s+up|lookup)\b.{0,80}\b(?:how\s+to|why|what|when|where|whether|sources?|articles?|docs?|documentation|online|web|internet)\b/i.test(query)
  );
}

function hasSeparateResearchClause(query: string): boolean {
  const clauses = query
    .split(MIXED_RESEARCH_CLAUSE_SEPARATOR)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses.some((clause) => {
    if (isPrivateCalendarEventQuery(clause)) return false;
    return TOOL_AWARE_RULES.some(
      (rule) =>
        rule.intent === "research" &&
        rule.patterns.some((pattern) => pattern.test(clause)),
    );
  });
}

export function classifyToolAwareRoute(text: string): ToolAwareRoutePlan {
  const query = text.trim();
  if (!query) return EMPTY_PLAN;
  const ontology = classifyActionOntology(query);
  const toolResolution = resolveToolsForAction(ontology);

  const ruleMatches = TOOL_AWARE_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(query)),
  );
  const shouldSuppressResearch =
    isPrivateCalendarEventQuery(query) &&
    ruleMatches.some((rule) => rule.intent === "calendar") &&
    !hasExplicitWebResearchCommand(query) &&
    !hasSeparateResearchClause(query);
  const matched = shouldSuppressResearch ? ruleMatches.filter((rule) => rule.intent !== "research") : ruleMatches;
  const ontologyToolGroups = shouldSuppressResearch
    ? ontology.allowedToolGroups.filter((group) => group !== "research" && group !== "browser")
    : ontology.allowedToolGroups;
  const resolverPriorityToolNames = shouldSuppressResearch
    ? []
    : [...toolResolution.requiredToolNames, ...toolResolution.optionalToolNames];
  const toolResolverReason = shouldSuppressResearch
    ? "Private calendar lookup is limited to connected-account calendar tools."
    : toolResolution.reason;
  if (matched.length === 0) {
    return {
      intents: [],
      capabilityIds: [],
      toolGroups: ontologyToolGroups,
      priorityToolNames: resolverPriorityToolNames,
      blockedToolNames: toolResolution.blockedToolNames,
      guidance: ontology.actionType === "unknown" ? "" : `- ${ontology.reason}\n- Tool resolver: ${toolResolverReason}`,
      shouldPreferTool: resolverPriorityToolNames.length > 0 || ontology.actionType === "blocked_physical_action",
      actionType: ontology.actionType,
      actor: ontology.actor,
      approvalRequired: toolResolution.approvalRequired,
      actionReason: ontology.reason,
    };
  }

  return {
    intents: matched.map((rule) => rule.intent),
    capabilityIds: unique(matched.flatMap((rule) => rule.capabilityIds)),
    toolGroups: unique([...matched.flatMap((rule) => rule.toolGroups), ...ontologyToolGroups]),
    priorityToolNames: unique([
      ...matched.flatMap((rule) => rule.priorityToolNames),
      ...resolverPriorityToolNames,
    ]),
    blockedToolNames: toolResolution.blockedToolNames,
    guidance: [
      ...matched.map((rule) => `- ${rule.guidance}`),
      `- Action ownership: ${ontology.reason}`,
      `- Tool resolver: ${toolResolverReason}`,
    ].join("\n"),
    shouldPreferTool: true,
    actionType: ontology.actionType,
    actor: ontology.actor,
    approvalRequired: toolResolution.approvalRequired,
    actionReason: ontology.reason,
  };
}
