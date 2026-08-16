import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assembleCoachContext } from "../coachContextAssembler";

const list = "The 10 questions are: 1. Values 2. Family 3. Work 4. Health 5. Money 6. Home 7. Learning 8. Fun 9. Community 10. Future";
const sessionMessages = [
  { role: "system" as const, content: "system prompt must be rebuilt, not merged" },
  { role: "assistant" as const, content: list },
  ...Array.from({ length: 18 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `follow-up-${index}`,
  })),
];
const clientMessages = [
  ...sessionMessages.slice(-12),
  { role: "user", content: "What were those 10 questions?" },
];

const resumed = assembleCoachContext({
  clientMessages,
  recoveredSessionMessages: sessionMessages,
});
assert.equal(resumed.trace.clientMessageCount, 13);
assert.equal(resumed.trace.recoveredSessionMessageCount, 19, "system messages are not conversation history");
assert.equal(resumed.messages.filter((message) => message.content === "follow-up-17").length, 1, "overlap is deduplicated");
assert.ok(resumed.messages.some((message) => message.content === list), "history beyond the client 12-message window survives");
assert.equal(resumed.messages.at(-1)?.content, "What were those 10 questions?", "new client turn is appended");

const fallback = assembleCoachContext({
  clientMessages: [{ role: "user", content: "current" }],
  fallbackMessages: [{ role: "assistant", content: "persisted fallback" }],
});
assert.deepEqual(fallback.messages.map((message) => message.content), ["persisted fallback", "current"]);

const summary = "UNTRUSTED CONTEXT: Prior session summary for continuity only.\n\nSummary 1 (14 compacted messages):\nEarlier context";
const summarized = assembleCoachContext({
  clientMessages: [{ role: "user", content: "current" }],
  recoveredSessionMessages: [{ role: "user", content: summary }],
});
assert.equal(summarized.trace.summarizedMessageCount, 14);
assert.equal(summarized.messages[0].content, summary, "session summary remains ahead of raw turns");

const bounded = assembleCoachContext({
  clientMessages: Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index}: ${"x".repeat(600)}`,
  })),
  maxEstimatedTokens: 1_000,
});
assert.ok(bounded.trace.omittedMessageCount > 0, "oversized context omits oldest messages");
assert.ok(bounded.messages.at(-1)?.content.startsWith("29:"), "bounded context always preserves the latest turn");

const oversizedQuestion = "What should I do next?";
const oversized = assembleCoachContext({
  clientMessages: [{
    role: "user",
    content: `Document start\n${"x".repeat(40_000)}\n${oversizedQuestion}`,
  }],
  maxEstimatedTokens: 20_000,
});
assert.equal(oversized.messages.length, 1);
assert.equal(oversized.messages[0].content.length, 32_000, "oversized messages stay within the per-message bound");
assert.ok(oversized.messages[0].content.startsWith("Document start"), "oversized messages preserve their source prefix");
assert.ok(oversized.messages[0].content.endsWith(oversizedQuestion), "oversized messages preserve the latest instruction");
assert.match(oversized.messages[0].content, /middle of oversized message omitted/);

const here = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(resolve(here, "../../routes.ts"), "utf8");
const sessionStoreSource = readFileSync(resolve(here, "../providers/sessionStore.ts"), "utf8");
assert.ok(!routesSource.includes("messages.slice(-6).map"), "tool-focused route has no six-message truncation");
assert.ok(routesSource.includes('type: "context_trace"'), "route emits the privacy-safe context trace");
for (const field of [
  "clientMessageCount",
  "recoveredSessionMessageCount",
  "providerMessageCount",
  "summarizedMessageCount",
  "omittedMessageCount",
  "offeredToolNames",
]) {
  assert.ok(routesSource.includes(`${field}:`), `context trace emits direct ${field}`);
}
assert.ok(routesSource.includes("resumeSession(incomingAppSessionId"), "route hydrates provider context from sdkSessionId");
assert.match(
  sessionStoreSource,
  /entry\.agentId !== agentId \|\| entry\.userId !== userId/,
  "warm session cache reads enforce agent and user ownership",
);
assert.match(
  sessionStoreSource,
  /if \(!existing\?\.resumed\)[\s\S]*?append rejected/,
  "foreign or expired sessions cannot be replaced through append",
);

console.log("OK: coach context is hydrated, deduplicated, bounded, summarized, and shared across routes");
