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
  ["fetch_calendar"],
);
assertRoute(
  "check my Gmail and unread email",
  "email",
  ["email"],
  ["fetch_emails", "gmail_action"],
);
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

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
