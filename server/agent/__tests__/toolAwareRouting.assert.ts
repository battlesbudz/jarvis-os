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
  ["one_list_connections", "one_search_actions", "one_get_action_knowledge", "one_execute_action"],
);
assertRoute(
  "check my Gmail and unread email",
  "email",
  ["email"],
  ["one_list_connections", "one_search_actions", "one_get_action_knowledge", "one_execute_action"],
);
assertRoute(
  "Can you remind me in an hour to call the company?",
  "reminder",
  ["coaching", "scheduling"],
  ["schedule_jarvis_task"],
);
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
  ["memory_search", "memory_get"],
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
