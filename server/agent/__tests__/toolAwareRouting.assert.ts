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
{
  const plan = classifyToolAwareRoute("calendar events for tomorrow");
  assert(plan.intents.includes("calendar"), "private calendar events: intent detected");
  assert(!plan.intents.includes("research"), "private calendar events: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "private calendar events: does not prioritize search_web");
}
{
  const plan = classifyToolAwareRoute("what are my events for Friday?");
  assert(plan.intents.includes("calendar"), "my events: intent detected");
  assert(!plan.intents.includes("research"), "my events: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "my events: does not prioritize search_web");
}
{
  const plan = classifyToolAwareRoute("what events are on my calendar today?");
  assert(plan.intents.includes("calendar"), "events on my calendar: intent detected");
  assert(!plan.intents.includes("research"), "events on my calendar: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "events on my calendar: no search_web");
}
{
  const plan = classifyToolAwareRoute("events on our calendar today");
  assert(plan.intents.includes("calendar"), "events on our calendar: intent detected");
  assert(!plan.intents.includes("research"), "events on our calendar: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "events on our calendar: no search_web");
}
{
  const plan = classifyToolAwareRoute("find my calendar events today");
  assert(plan.intents.includes("calendar"), "find my calendar events: intent detected");
  assert(!plan.intents.includes("research"), "find my calendar events: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "find my calendar events: no search_web");
}
{
  const plan = classifyToolAwareRoute("look up my calendar events today");
  assert(plan.intents.includes("calendar"), "look up my calendar events: intent detected");
  assert(!plan.intents.includes("research"), "look up my calendar events: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "look up my calendar events: no search_web");
}
{
  const plan = classifyToolAwareRoute("search the web for how to export my calendar events");
  assert(plan.intents.includes("research"), "explicit web search mentioning calendar events: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "explicit web search mentioning calendar events: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("find my events today");
  assert(plan.intents.includes("calendar"), "find my events: intent detected");
  assert(!plan.intents.includes("research"), "find my events: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "find my events: no search_web");
}
{
  const plan = classifyToolAwareRoute("search my events today");
  assert(plan.intents.includes("calendar"), "search my events: intent detected");
  assert(!plan.intents.includes("research"), "search my events: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "search my events: no search_web");
}
{
  const plan = classifyToolAwareRoute("what's on my schedule today?");
  assert(plan.intents.includes("calendar"), "my schedule: intent detected");
  assert(!plan.intents.includes("research"), "my schedule: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "my schedule: no search_web");
}
{
  const plan = classifyToolAwareRoute("our schedule today");
  assert(plan.intents.includes("calendar"), "our schedule: intent detected");
  assert(!plan.intents.includes("research"), "our schedule: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "our schedule: no search_web");
}
{
  const plan = classifyToolAwareRoute("concerts today in my calendar");
  assert(plan.intents.includes("calendar"), "private event-category calendar: intent detected");
  assert(!plan.intents.includes("research"), "private event-category calendar: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "private event-category calendar: no search_web");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today and what's today's news?");
  assert(plan.intents.includes("calendar"), "mixed calendar and news: calendar intent detected");
  assert(plan.intents.includes("research"), "mixed calendar and news: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "mixed calendar and news: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today, what's today's news?");
  assert(plan.intents.includes("calendar"), "comma mixed calendar and news: calendar intent detected");
  assert(plan.intents.includes("research"), "comma mixed calendar and news: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "comma mixed calendar and news: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today along with today's news?");
  assert(plan.intents.includes("calendar"), "along-with mixed calendar and news: calendar intent detected");
  assert(plan.intents.includes("research"), "along-with mixed calendar and news: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "along-with mixed calendar and news: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today with today's news?");
  assert(plan.intents.includes("calendar"), "with-news mixed calendar and news: calendar intent detected");
  assert(plan.intents.includes("research"), "with-news mixed calendar and news: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "with-news mixed calendar and news: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today with the latest on Ukraine");
  assert(plan.intents.includes("calendar"), "with-latest mixed calendar and news: calendar intent detected");
  assert(plan.intents.includes("research"), "with-latest mixed calendar and news: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "with-latest mixed calendar and news: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today with Ukraine news");
  assert(plan.intents.includes("calendar"), "topic-news mixed request: calendar intent detected");
  assert(plan.intents.includes("research"), "topic-news mixed request: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "topic-news mixed request: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today with traffic on I-95 today");
  assert(plan.intents.includes("calendar"), "traffic mixed request: calendar intent detected");
  assert(plan.intents.includes("research"), "traffic mixed request: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "traffic mixed request: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today with air quality in Philadelphia today");
  assert(plan.intents.includes("calendar"), "air-quality mixed request: calendar intent detected");
  assert(plan.intents.includes("research"), "air-quality mixed request: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "air-quality mixed request: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today with TSLA price today");
  assert(plan.intents.includes("calendar"), "price mixed request: calendar intent detected");
  assert(plan.intents.includes("research"), "price mixed request: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "price mixed request: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today with concerts in Philadelphia today");
  assert(plan.intents.includes("calendar"), "public-events mixed request: calendar intent detected");
  assert(plan.intents.includes("research"), "public-events mixed request: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "public-events mixed request: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today with OpenAI today");
  assert(plan.intents.includes("calendar"), "public-shorthand mixed request: calendar intent detected");
  assert(plan.intents.includes("research"), "public-shorthand mixed request: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "public-shorthand mixed request: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today with TSLA today");
  assert(plan.intents.includes("calendar"), "ticker-shorthand mixed request: calendar intent detected");
  assert(plan.intents.includes("research"), "ticker-shorthand mixed request: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "ticker-shorthand mixed request: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events today? what's today's news?");
  assert(plan.intents.includes("calendar"), "sentence mixed calendar and news: calendar intent detected");
  assert(plan.intents.includes("research"), "sentence mixed calendar and news: research intent preserved");
  assert(plan.priorityToolNames.includes("search_web"), "sentence mixed calendar and news: search_web preserved");
}
{
  const plan = classifyToolAwareRoute("what are my calendar events with Justin today?");
  assert(plan.intents.includes("calendar"), "private calendar with attendee: calendar intent detected");
  assert(!plan.intents.includes("research"), "private calendar with attendee: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "private calendar with attendee: no search_web");
}
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
  "search up calendar events in Philadelphia today",
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
  "air quality in Philadelphia today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "traffic on I-95 today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "events in Philadelphia today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "events in Philadelphia, PA today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "concerts in Philadelphia today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "concerts in Philadelphia, PA today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "comedy shows near Philadelphia tonight",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "concerts today in Philadelphia",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "concerts today in Philadelphia, PA",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "comedy shows tonight near Philadelphia",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "calendar events for Philadelphia today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "latest court ruling",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "current Supreme Court ruling",
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
  "what\u2019s going on today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's new today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's new with OpenAI today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "how is TSLA doing today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "How is Boeing doing today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "how is boeing doing today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what happened in Ukraine today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what did OpenAI announce today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "What did Disney announce today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what did disney announce today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what did the president say today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's happening with TSLA today?",
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
  "what is the current BTC/USD price?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "current USD/EUR exchange rate",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "current S&P 500 price",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's the current S&P 500?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "current nasdaq",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "current TSLA",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "watch the latest video from this channel",
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
  "today\u2019s Lakers score",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "today's NBA schedule",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what are today's games?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "who is playing today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "are the Eagles playing today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "do the Eagles play today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "did the Lakers win today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "who won today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "who won today's Lakers game?",
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
  "Ukraine latest",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "OpenAI latest",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "latest developments in Ukraine",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "current situation in Ukraine",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's the latest with Ukraine?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's the latest with OpenAI?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "latest OpenAI",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "latest OpenAI model",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "latest Ukraine",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "Ukraine today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "OpenAI today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "Trump today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "latest openai",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "latest ukraine",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "ukraine today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "openai today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "watch the latest from this channel",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "what's the latest from OpenAI?",
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
  "TSLA today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "tsla today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "BTC/USD today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "btc/usd today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "s&p 500 today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "nasdaq today",
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
  "flight delays today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "are flights delayed today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "is Walmart open today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "is the Starbucks open today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "is the post office open today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "Walmart open today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "SEPTA delayed today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "is McDonald's open today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "is Dave & Buster\u2019s open today?",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "Walmart hours today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "McDonald's hours today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "are banks open today?",
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
  "headlines",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "today\u2019s top stories",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "top stories today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "latest stories",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "today's Ukraine stories",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "Ukraine stories today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "stories about Ukraine today",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "today's Wordle answer",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "today\u2019s horoscope",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "today's NYT Connections answer",
  "research",
  ["research", "browser"],
  ["search_web", "research_topic", "browser_navigate"],
);
assertRoute(
  "Ukraine headlines today",
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
assertRoute(
  "court decision today",
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
  const plan = classifyToolAwareRoute("Hello today");
  assert(!plan.shouldPreferTool, "casual hello today: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual hello today: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual hello today: no priority tools");
}
{
  const plan = classifyToolAwareRoute("Hey Jarvis today");
  assert(!plan.shouldPreferTool, "casual hey Jarvis today: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual hey Jarvis today: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual hey Jarvis today: no priority tools");
}
{
  const plan = classifyToolAwareRoute("how are you doing today?");
  assert(!plan.shouldPreferTool, "casual how are you: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual how are you: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual how are you: no priority tools");
}
{
  const plan = classifyToolAwareRoute("how is Sarah doing now?");
  assert(!plan.shouldPreferTool, "personal status question: does not prefer tool use");
  assert(!plan.intents.includes("research"), "personal status question: does not route as research");
  assert(plan.priorityToolNames.length === 0, "personal status question: no priority tools");
}
{
  const plan = classifyToolAwareRoute("how is mom doing now?");
  assert(!plan.shouldPreferTool, "family status question: does not prefer tool use");
  assert(!plan.intents.includes("research"), "family status question: does not route as research");
  assert(plan.priorityToolNames.length === 0, "family status question: no priority tools");
}
{
  const plan = classifyToolAwareRoute("are you playing today?");
  assert(!plan.shouldPreferTool, "casual playing question: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual playing question: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual playing question: no priority tools");
}
{
  const plan = classifyToolAwareRoute("is it open today?");
  assert(!plan.shouldPreferTool, "contextual open question: does not prefer tool use");
  assert(!plan.intents.includes("research"), "contextual open question: does not route as research");
  assert(plan.priorityToolNames.length === 0, "contextual open question: no priority tools");
}
{
  const plan = classifyToolAwareRoute("are you open today?");
  assert(!plan.shouldPreferTool, "casual are-you-open question: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual are-you-open question: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual are-you-open question: no priority tools");
}
{
  const plan = classifyToolAwareRoute("will you be open tomorrow?");
  assert(!plan.shouldPreferTool, "casual will-you-be-open question: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual will-you-be-open question: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual will-you-be-open question: no priority tools");
}
{
  const plan = classifyToolAwareRoute("leave the garage door open now");
  assert(!plan.intents.includes("research"), "local open action: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "local open action: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("I currently need help");
  assert(!plan.intents.includes("research"), "first-person currently statement: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "first-person currently statement: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("I now have time");
  assert(!plan.intents.includes("research"), "first-person now statement: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "first-person now statement: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("is my garage door open now?");
  assert(!plan.intents.includes("research"), "owned open-status question: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "owned open-status question: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("is our office open today?");
  assert(!plan.intents.includes("research"), "shared open-status question: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "shared open-status question: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("is your garage door open now?");
  assert(!plan.intents.includes("research"), "second-person owned status: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "second-person owned status: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("is their office open today?");
  assert(!plan.intents.includes("research"), "third-person owned status: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "third-person owned status: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("is the garage door open now?");
  assert(!plan.intents.includes("research"), "definite local open-status question: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "definite local open-status question: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("is the window open now?");
  assert(!plan.intents.includes("research"), "local window status: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "local window status: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("Dinner tonight?");
  assert(!plan.intents.includes("research"), "auto-capitalized dinner shorthand: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "auto-capitalized dinner shorthand: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("Plans tonight?");
  assert(!plan.intents.includes("research"), "auto-capitalized plans shorthand: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "auto-capitalized plans shorthand: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("Work now?");
  assert(!plan.intents.includes("research"), "auto-capitalized work shorthand: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "auto-capitalized work shorthand: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("today's plan");
  assert(!plan.intents.includes("research"), "today's personal plan: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "today's personal plan: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("today's work");
  assert(!plan.intents.includes("research"), "today's work context: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "today's work context: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("today's dinner");
  assert(!plan.intents.includes("research"), "today's meal context: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "today's meal context: does not prioritize web search");
}
{
  const plan = classifyToolAwareRoute("did you win today?");
  assert(!plan.shouldPreferTool, "casual win question: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual win question: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual win question: no priority tools");
}
{
  const plan = classifyToolAwareRoute("what did you do today?");
  assert(!plan.shouldPreferTool, "casual what-did-you-do question: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual what-did-you-do question: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual what-did-you-do question: no priority tools");
}
{
  const plan = classifyToolAwareRoute("what did Sarah say yesterday?");
  assert(!plan.shouldPreferTool, "personal quote follow-up: does not prefer tool use");
  assert(!plan.intents.includes("research"), "personal quote follow-up: does not route as research");
  assert(plan.priorityToolNames.length === 0, "personal quote follow-up: no priority tools");
}
{
  const plan = classifyToolAwareRoute("are you delayed today?");
  assert(!plan.shouldPreferTool, "casual delayed question: does not prefer tool use");
  assert(!plan.intents.includes("research"), "casual delayed question: does not route as research");
  assert(plan.priorityToolNames.length === 0, "casual delayed question: no priority tools");
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
  const plan = classifyToolAwareRoute("latest report");
  assert(!plan.shouldPreferTool, "latest report document phrase: does not prefer tool use");
  assert(!plan.intents.includes("research"), "latest report document phrase: does not route as research");
  assert(plan.priorityToolNames.length === 0, "latest report document phrase: no priority tools");
}
{
  const plan = classifyToolAwareRoute("latest one");
  assert(!plan.shouldPreferTool, "latest contextual pronoun phrase: does not prefer tool use");
  assert(!plan.intents.includes("research"), "latest contextual pronoun phrase: does not route as research");
  assert(plan.priorityToolNames.length === 0, "latest contextual pronoun phrase: no priority tools");
}
{
  const plan = classifyToolAwareRoute("latest reply");
  assert(!plan.intents.includes("research"), "latest reply phrase: does not route as research");
  assert(!plan.priorityToolNames.includes("search_web"), "latest reply phrase: no search_web");
}
{
  const plan = classifyToolAwareRoute("help me revise my current report for me");
  assert(!plan.shouldPreferTool, "current report writing with preposition: does not prefer tool use");
  assert(!plan.intents.includes("research"), "current report writing with preposition: does not route as research");
  assert(plan.priorityToolNames.length === 0, "current report writing with preposition: no priority tools");
}
{
  const plan = classifyToolAwareRoute("summarize our recent conversation");
  assert(!plan.shouldPreferTool, "recent conversation summary: does not prefer tool use");
  assert(!plan.intents.includes("research"), "recent conversation summary: does not route as research");
  assert(plan.priorityToolNames.length === 0, "recent conversation summary: no priority tools");
}
{
  const plan = classifyToolAwareRoute("summarize our recent conversation in detail");
  assert(!plan.shouldPreferTool, "recent conversation summary with preposition: does not prefer tool use");
  assert(!plan.intents.includes("research"), "recent conversation summary with preposition: does not route as research");
  assert(plan.priorityToolNames.length === 0, "recent conversation summary with preposition: no priority tools");
}
{
  const plan = classifyToolAwareRoute("help me write a headline for my report");
  assert(!plan.shouldPreferTool, "headline writing: does not prefer tool use");
  assert(!plan.intents.includes("research"), "headline writing: does not route as research");
  assert(plan.priorityToolNames.length === 0, "headline writing: no priority tools");
}
{
  const plan = classifyToolAwareRoute("write five headlines for my landing page");
  assert(!plan.shouldPreferTool, "landing page headlines: does not prefer tool use");
  assert(!plan.intents.includes("research"), "landing page headlines: does not route as research");
  assert(plan.priorityToolNames.length === 0, "landing page headlines: no priority tools");
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
