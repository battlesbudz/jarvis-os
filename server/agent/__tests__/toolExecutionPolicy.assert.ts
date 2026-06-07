import assert from "node:assert/strict";
import { buildToolExecutionPolicy } from "../toolExecutionPolicy";
import { classifyToolAwareRoute } from "../toolAwareRouting";

type TestTool = { name: string };

const allTools: TestTool[] = [
  { name: "search_web" },
  { name: "research_topic" },
  { name: "browser_navigate" },
  { name: "weather_lookup" },
  { name: "daemon_action" },
  { name: "chat_only_helper" },
];

{
  const route = classifyToolAwareRoute("Can you search up Cannabis News 2026?");
  const policy = buildToolExecutionPolicy({
    route,
    tools: allTools,
    maxTurns: 1,
    getToolName: (tool) => tool.name,
  });

  assert.equal(policy.toolChoice, "required", "research route requires a tool call");
  assert.equal(policy.maxTurns, 3, "required routes get enough turns for tool result synthesis");
  assert.deepEqual(
    policy.tools.map((tool) => tool.name),
    ["search_web", "research_topic", "browser_navigate"],
    "research route narrows visible tools to available priority tools",
  );
}

{
  const route = classifyToolAwareRoute("What's the weather in Philadelphia tomorrow?");
  const policy = buildToolExecutionPolicy({
    route,
    tools: allTools,
    maxTurns: 20,
    getToolName: (tool) => tool.name,
  });

  assert.equal(policy.toolChoice, "required", "weather route requires tool use");
  assert.deepEqual(
    policy.tools.map((tool) => tool.name),
    ["weather_lookup"],
    "weather route exposes only weather_lookup when available",
  );
  assert.equal(policy.maxTurns, 20, "existing larger turn budget is preserved");
}

{
  const route = classifyToolAwareRoute("Drive to Walmart and buy printer paper");
  const policy = buildToolExecutionPolicy({
    route,
    tools: allTools,
    maxTurns: 20,
    getToolName: (tool) => tool.name,
  });

  assert.equal(policy.toolChoice, "auto", "blocked physical action does not force an unavailable tool");
  assert.equal(policy.tools.length, allTools.length, "blocked physical action leaves tools unchanged");
}

{
  const route = classifyToolAwareRoute("Tell me a short joke");
  const policy = buildToolExecutionPolicy({
    route,
    tools: allTools,
    maxTurns: 20,
    getToolName: (tool) => tool.name,
  });

  assert.equal(policy.toolChoice, "auto", "conversational turns stay automatic");
  assert.equal(policy.tools.length, allTools.length, "conversational turns keep full available tools");
}

console.log("ok - tool execution policy assertions passed");
