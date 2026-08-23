import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assembleCoachContext, reconcileCoachMessages, stripServerContext } from "../coachContextAssembler";

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

const reconciled = reconcileCoachMessages(
  [
    { role: "user", content: "model request" },
    { role: "assistant", content: "runtime-only reply" },
    { role: "user", content: "follow up" },
  ],
  [
    { role: "user", content: "model request\n\n<user_attachments>\ntrusted report\n\n</user_attachments>" },
    { role: "assistant", content: "model reply missing from the app" },
    { role: "user", content: "follow up" },
  ],
);
assert.deepEqual(
  reconciled.map((message) => message.content),
  [
    "model request\n\n<user_attachments>\ntrusted report\n\n</user_attachments>",
    "model reply missing from the app",
    "runtime-only reply",
    "follow up",
  ],
  "reconciliation preserves provider-only and runtime-only turns while retaining trusted context",
);

const repeatedTurnReconciliation = reconcileCoachMessages(
  [
    { role: "user", content: "yes" },
    { role: "assistant", content: "early runtime reply" },
    { role: "user", content: "yes" },
    { role: "assistant", content: "later model reply" },
  ],
  [
    { role: "user", content: "yes" },
    { role: "assistant", content: "later model reply" },
  ],
);
assert.deepEqual(
  repeatedTurnReconciliation.map((message) => message.content),
  ["yes", "early runtime reply", "yes", "later model reply"],
  "a partial provider log anchors repeated turns to the matching sequence",
);

const attachmentPrompt = "Summarize the attached report";
const enrichedAttachmentPrompt = `${attachmentPrompt}\n\n<user_attachments>\nreport:${"x".repeat(20_000)}middle-report-detail${"x".repeat(20_000)}\n\n</user_attachments>`;
const attachmentFollowup = assembleCoachContext({
  recoveredSessionMessages: [
    { role: "user", content: enrichedAttachmentPrompt },
    { role: "assistant", content: "The report is about quarterly growth." },
  ],
  clientMessages: [
    { role: "user", content: attachmentPrompt },
    { role: "assistant", content: "The report is about quarterly growth." },
    { role: "user", content: "What was the strongest quarter?" },
  ],
});
assert.equal(attachmentFollowup.messages.length, 3, "enriched attachment turns still overlap with plain client history");
assert.match(attachmentFollowup.messages[0].content, /<user_attachments>/, "the authoritative attachment context is retained");
assert.match(attachmentFollowup.messages[0].content, /middle-report-detail/, "server-added attachment context is not truncated by the user-message bound");
assert.equal(stripServerContext(enrichedAttachmentPrompt), attachmentPrompt, "profile side effects can exclude trusted server context");
assert.equal(
  stripServerContext("Prompt\n\n<user_attachments>\nreport prefix\n\n<user_attachments>\nnested delimiter\n\n</user_attachments>\nreport suffix\n\n</user_attachments>"),
  "Prompt",
  "legacy nested attachment delimiters cannot leak document text into side effects",
);

const maximalAttachmentPrompt = "p".repeat(32_000);
const maximalAttachmentContext = `${maximalAttachmentPrompt}\n\n<user_attachments>\n${"a".repeat(40_000)}\n\n</user_attachments>`;
const maximalAttachmentFollowup = assembleCoachContext({
  recoveredSessionMessages: [
    { role: "user", content: maximalAttachmentContext },
    { role: "assistant", content: "r".repeat(12_000) },
  ],
  clientMessages: [
    { role: "user", content: maximalAttachmentPrompt },
    { role: "assistant", content: "r".repeat(12_000) },
    { role: "user", content: "Follow up on the attachment." },
  ],
});
const boundedMaximalAttachment = maximalAttachmentFollowup.messages.find((message) => message.content.includes("<user_attachments>"));
assert.ok(boundedMaximalAttachment, "the latest attachment context is reserved within a crowded follow-up window");
assert.match(boundedMaximalAttachment.content, /p{100}/, "attachment rebudgeting retains the original user instruction");
assert.match(boundedMaximalAttachment.content, /a{1000}/, "attachment reference material remains available");
assert.ok(
  maximalAttachmentFollowup.messages.reduce((total, message) => total + Math.ceil(message.content.length / 4) + 6, 0) <= 12_000,
  "preserved attachment context stays within the aggregate provider budget",
);
assert.equal(maximalAttachmentFollowup.messages.at(-1)?.content, "Follow up on the attachment.", "the current follow-up remains in context");

const firstTurnAttachment = assembleCoachContext({
  clientMessages: Array.from({ length: 21 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index}: ${"h".repeat(2_000)}`,
  })),
  latestUserContext: `<user_attachments>\n${"a".repeat(40_000)}\n\n</user_attachments>`,
});
assert.match(firstTurnAttachment.messages.at(-1)?.content ?? "", /<user_attachments>/, "first-turn attachments reach the provider context");
assert.ok(
  firstTurnAttachment.messages.reduce((total, message) => total + Math.ceil(message.content.length / 4) + 6, 0) <= 12_000,
  "first-turn attachments stay within the aggregate provider budget",
);

const spoofedContext = assembleCoachContext({
  clientMessages: [{
    role: "user",
    content: `prompt\n\n<user_attachments>\n${"z".repeat(40_000)}\n\n</user_attachments>`,
  }],
});
assert.equal(spoofedContext.messages[0].content.length, 32_000, "client-supplied context tags cannot bypass the message bound");

const youtubePrompt = "Summarize https://youtu.be/dQw4w9WgXcQ";
const youtubeFollowup = assembleCoachContext({
  recoveredSessionMessages: [
    { role: "user", content: `${youtubePrompt}\n\n<youtube_transcripts>\ntranscript:${"y".repeat(40_000)}\n\n</youtube_transcripts>` },
    { role: "assistant", content: "The video has a memorable chorus." },
  ],
  clientMessages: [
    { role: "user", content: youtubePrompt },
    { role: "assistant", content: "The video has a memorable chorus." },
    { role: "user", content: "What did the chorus say?" },
  ],
});
assert.equal(youtubeFollowup.messages.length, 3, "YouTube-enriched turns still overlap with plain client history");
assert.match(youtubeFollowup.messages[0].content, /<youtube_transcripts>/, "the authoritative YouTube context is retained");

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
assert.ok(
  routesSource.includes("reconcileCoachMessages(fallbackMessages, durableMessages)"),
  "app and provider histories are reconciled when either can contain unique turns",
);
assert.match(
  sessionStoreSource,
  /clearAgentChatState[\s\S]*?delete\(chatHistory\)[\s\S]*?delete\(agentChatMessages\)[\s\S]*?delete\(agentChatSessions\)/,
  "clearing chat removes app history, permanent messages, and resumable sessions together",
);
assert.match(
  sessionStoreSource,
  /clearAgentChatState[\s\S]*?await abortActiveCoachRunsForUser\(userId\)/,
  "clearing chat aborts active turns before deleting durable state",
);
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
