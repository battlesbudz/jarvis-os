import { classifyToolAwareRoute } from "../toolAwareRouting";
import type { ToolAwareRoutePlan } from "../toolAwareRouting";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`ok - ${label}`);
    passed++;
  } else {
    console.error(`not ok - ${label}`);
    failed++;
  }
}

function assertRoute(
  text: string,
  intent: string,
  expectedGroups: Array<ToolAwareRoutePlan["toolGroups"][number]>,
  expectedTools: string[],
): void {
  const plan = classifyToolAwareRoute(text);
  assert(plan.shouldPreferTool, `${intent}: prefers tool use`);
  assert(plan.intents.includes(intent as any), `${intent}: intent detected`);
  for (const group of expectedGroups) {
    assert(plan.toolGroups.includes(group), `${intent}: includes ${group} group`);
  }
  for (const tool of expectedTools) {
    assert(plan.priorityToolNames.includes(tool), `${intent}: prioritizes ${tool}`);
  }
}

assertRoute(
  "what's the weather in Philadelphia tomorrow?",
  "weather",
  ["research"],
  ["weather_lookup"],
);
assertRoute(
  "what's on my calendar today?",
  "calendar",
  ["calendar"],
  ["connected_accounts_list", "connected_accounts_search_tools", "connected_accounts_get_tool_schema", "connected_accounts_execute"],
);
assertRoute(
  "check my Gmail and unread email",
  "email",
  ["email"],
  ["connected_accounts_list", "connected_accounts_search_tools", "connected_accounts_get_tool_schema", "connected_accounts_execute"],
);
assertRoute(
  "Can you remind me in an hour to call the company?",
  "reminder",
  ["coaching", "scheduling"],
  ["schedule_jarvis_task"],
);
{
  const plan = classifyToolAwareRoute('Can you add "Make $140 on DoorDash" as a recurring task every day?');
  assert(plan.shouldPreferTool, "human task ontology: prefers tool use for user task recording");
  assert(plan.actionType === "user_task", "human task ontology: actionType=user_task");
  assert(plan.actor === "user", "human task ontology: actor=user");
  assert(plan.approvalRequired === false, "human task ontology: no approval required");
  assert(plan.priorityToolNames.includes("schedule_jarvis_task"), "human task ontology: uses schedule_jarvis_task");
  assert(plan.actionReason.includes("user") || plan.actionReason.includes("human"), "human task ontology: reason explains ownership");
}
{
  const plan = classifyToolAwareRoute("Drive to Walmart and buy printer paper");
  assert(plan.shouldPreferTool, "blocked physical: uses focused no-tool route");
  assert(plan.actionType === "blocked_physical_action", "blocked physical: actionType");
  assert(plan.blockedToolNames.includes("daemon_action"), "blocked physical: daemon blocked");
  assert(plan.priorityToolNames.length === 0, "blocked physical: no priority tools");
}
{
  const plan = classifyToolAwareRoute("draft an email in Gmail to wickedclown.jb@gmail.com");
  const legacyTools = ["fetch_emails", "gmail_action", "create_gmail_draft", "send_email"];
  assert(plan.intents.includes("email"), "email gateway: intent detected");
  for (const tool of legacyTools) {
    assert(!plan.priorityToolNames.includes(tool), `email gateway: does not prioritize ${tool}`);
  }
}
{
  const plan = classifyToolAwareRoute("schedule a meeting on my calendar tomorrow");
  const legacyTools = ["fetch_calendar", "create_calendar_event"];
  assert(plan.intents.includes("calendar"), "calendar gateway: intent detected");
  for (const tool of legacyTools) {
    assert(!plan.priorityToolNames.includes(tool), `calendar gateway: does not prioritize ${tool}`);
  }
}
assertRoute(
  "what do you remember about my work hours?",
  "memory",
  ["memory"],
  ["memory_search", "memory_get", "memory_save"],
);
assertRoute(
  "What's my name?",
  "memory",
  ["memory"],
  ["memory_search", "memory_get"],
);
assertRoute(
  "Who am I?",
  "memory",
  ["memory"],
  ["memory_search", "memory_get"],
);
{
  const plan = classifyToolAwareRoute("Who am I meeting tomorrow?");
  assert(plan.intents.includes("calendar"), "calendar: who-am-I continuation stays calendar");
  assert(!plan.intents.includes("memory"), "memory: who-am-I continuation does not route as identity memory");
}
assertRoute(
  "Remember that Justin Battles is my personal name.",
  "memory",
  ["memory"],
  ["memory_save"],
);
assertRoute(
  "open github.com in the browser",
  "browser",
  ["browser"],
  ["browser_navigate"],
);
assertRoute(
  "Can you search up Cannabis News 2026?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "What's today's cannabis news?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's the current TSLA price?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's the current version of Node.js?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's the current exchange rate for USD/EUR?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what is the current traffic on I-95?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what is the current air quality in Philadelphia?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what happened today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's going on today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "how is the stock market today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what stocks are up today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "latest Lakers score",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's today's TSLA price?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's today's exchange rate for USD/EUR?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "today's Lakers score",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "Who is the current president of Mexico?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's the latest in Ukraine?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "current CEO of Nvidia",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "cannabis news",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "TSLA price today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "mortgage rates today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "Lakers score today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "news",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's the price of TSLA today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "score of Lakers today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "CEO of Nvidia today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "who is the president of Mexico today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
{
  const plan = classifyToolAwareRoute("Hey Jarvis how are you doing today");
  assert(!plan.shouldPreferTool, "casual today greeting: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual today greeting: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual today greeting: no priority tools");
}
{
  const plan = classifyToolAwareRoute("help me write my weekly report");
  assert(!plan.shouldPreferTool, "weekly report writing: does not prefer tool use");
  assert(!plan.intents.includes("research"), "weekly report writing: does not route as research");
  assert(plan.priorityToolNames.length === 0, "weekly report writing: no priority tools");
}
{
  const plan = classifyToolAwareRoute("help me revise my current report");
  assert(!plan.shouldPreferTool, "current report writing: does not prefer tool use");
  assert(!plan.intents.includes("research"), "current report writing: does not route as research");
  assert(plan.priorityToolNames.length === 0, "current report writing: no priority tools");
}
{
  const plan = classifyToolAwareRoute("summarize our recent conversation");
  assert(!plan.shouldPreferTool, "recent conversation summary: does not prefer tool use");
  assert(!plan.intents.includes("research"), "recent conversation summary: does not route as research");
  assert(plan.priorityToolNames.length === 0, "recent conversation summary: no priority tools");
}
assertRoute(
  "show me my GitHub pull requests",
  "github",
  ["github"],
  ["list_github_prs"],
);
assertRoute(
  "check Railway deployment logs",
  "railway",
  ["app_build", "mcp"],
  ["deploy_app", "project_shell"],
);
assertRoute(
  "start a project called Test Project",
  "project",
  ["coaching"],
  ["start_project"],
);
assertRoute(
  "fix your calendar routing code",
  "code",
  ["system", "self_edit"],
  ["delegate_to_codex", "build_feature"],
);
{
  const plan = classifyToolAwareRoute("fix this bug and push it to GitHub");
  assert(plan.shouldPreferTool, "code push: prefers tool use");
  assert(plan.guidance.includes("allow external side effects"), "code push: guidance mentions side-effect approval");
  assert(plan.guidance.includes("commit/push/publish"), "code push: guidance carries commit/push requirement");
  assert(plan.actionType === "jarvis_code_apply", "code push: ontology marks code apply");
  assert(plan.approvalRequired === true, "code push: ontology requires approval");
}
assertRoute(
  "what's wrong?",
  "diagnostics",
  ["system"],
  ["jarvis_self_diagnose"],
);
assertRoute(
  "why did the browser task fail?",
  "diagnostics",
  ["system"],
  ["jarvis_self_diagnose"],
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
