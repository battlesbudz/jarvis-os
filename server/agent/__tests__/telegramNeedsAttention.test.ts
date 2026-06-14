import { strict as assert } from "node:assert";
import { getTelegramNeedsAttentionDecision } from "../../channels/telegramNeedsAttention";

assert.deepEqual(
  getTelegramNeedsAttentionDecision("What can you do?", 2),
  { shouldRouteToTask: false, shouldShowTaskList: false },
  "normal questions should reach the coach even when multiple tasks need attention",
);

assert.deepEqual(
  getTelegramNeedsAttentionDecision("task", 2),
  { shouldRouteToTask: false, shouldShowTaskList: true },
  "explicit task wording should show the disambiguation list when multiple tasks need attention",
);

assert.deepEqual(
  getTelegramNeedsAttentionDecision("Yes, focus on New York only", 1),
  { shouldRouteToTask: true, shouldShowTaskList: false },
  "short direct answers can resolve the only pending task",
);

assert.deepEqual(
  getTelegramNeedsAttentionDecision("Can you build a website?", 1),
  { shouldRouteToTask: false, shouldShowTaskList: false },
  "single pending task should not steal a normal Jarvis request",
);

assert.deepEqual(
  getTelegramNeedsAttentionDecision("/project list", 1),
  { shouldRouteToTask: false, shouldShowTaskList: false },
  "slash commands are handled by their own routers",
);

console.log("telegramNeedsAttention tests passed");
