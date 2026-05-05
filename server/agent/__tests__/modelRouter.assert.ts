import assert from "node:assert/strict";
import {
  classifyTaskComplexity,
  classifyTaskPrivacy,
  routeModelForTask,
} from "../modelRouter";

function userMessage(content: string) {
  return [{ role: "user" as const, content }];
}

{
  assert.equal(classifyTaskComplexity("Title this note"), "trivial");
  assert.equal(classifyTaskComplexity("Rewrite this paragraph to be shorter and clearer."), "easy");
  assert.equal(classifyTaskComplexity("Analyze this plan and prioritize the next steps."), "medium");
  assert.equal(classifyTaskComplexity("Debug the root cause and design the architecture fix."), "hard");
  console.log("OK: complexity classifier separates trivial/easy/medium/hard tasks");
}

{
  assert.equal(classifyTaskPrivacy("Summarize this public blog post"), "public");
  assert.equal(classifyTaskPrivacy("Summarize this client email"), "internal");
  assert.equal(classifyTaskPrivacy("Summarize this API key rotation note"), "sensitive");
  console.log("OK: privacy classifier catches internal and sensitive task signals");
}

{
  const decision = routeModelForTask({
    requestedModel: "claude-opus-4-6",
    explicitModel: false,
    messages: userMessage("Rewrite this to be shorter."),
    toolCount: 0,
    routing: { enabled: true, cheapModel: "groq/llama-3.1-8b-instant" },
  });
  assert.equal(decision.model, "groq/llama-3.1-8b-instant");
  assert.equal(decision.tier, "free");
  assert.equal(decision.delegated, true);
  console.log("OK: easy no-tool task routes to native cheap/free provider when enabled");
}

{
  const decision = routeModelForTask({
    requestedModel: "claude-opus-4-6",
    explicitModel: false,
    messages: userMessage("Rewrite this private email."),
    toolCount: 0,
    routing: { enabled: true, privacyLevel: "sensitive" },
  });
  assert.equal(decision.model, "claude-opus-4-6");
  assert.equal(decision.tier, "prime");
  assert.equal(decision.delegated, false);
  console.log("OK: sensitive task stays on prime tier");
}

{
  const decision = routeModelForTask({
    requestedModel: "claude-opus-4-6",
    explicitModel: false,
    messages: userMessage("Classify this inbox item."),
    toolCount: 1,
    routing: { enabled: true },
  });
  assert.equal(decision.model, "claude-opus-4-6");
  assert.equal(decision.delegated, false);
  assert.match(decision.reason, /tools/);
  console.log("OK: free-tier delegation is blocked when tools are available");
}

{
  const decision = routeModelForTask({
    requestedModel: "gpt-4.1-mini",
    explicitModel: true,
    messages: userMessage("Rewrite this."),
    toolCount: 0,
    routing: { enabled: true },
  });
  assert.equal(decision.model, "gpt-4.1-mini");
  assert.equal(decision.delegated, false);
  console.log("OK: explicit model choices are preserved by default");
}

console.log("\nAll model router assertions passed.");
