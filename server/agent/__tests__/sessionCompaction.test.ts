import { compactSessionMessages, formatSessionSummariesForPrompt } from "../providers/sessionStore";
import type OpenAI from "openai";

let passed = 0;
let failed = 0;

function ok(condition: boolean, label: string): void {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

function finish(): void {
  if (failed > 0) {
    console.error(`sessionCompaction.test failed: ${failed} failure(s), ${passed} passed`);
    process.exit(1);
  }
  console.log(`sessionCompaction.test passed: ${passed} assertion(s)`);
}

function msg(role: "system" | "user" | "assistant" | "tool", content: string): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (role === "tool") return { role, content, tool_call_id: `tool-${content.length}` };
  return { role, content };
}

function testCompactsOldMessagesAndDropsToolChatter(): void {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    msg("system", "You are Jarvis."),
    msg("user", "Old request one"),
    msg("assistant", "Old answer one"),
    msg("tool", "Huge raw tool result that should not stay in recent messages"),
    msg("user", "Old request two"),
    msg("assistant", "Old answer two"),
    msg("user", "Recent request one"),
    msg("assistant", "Recent answer one"),
    msg("user", "Recent request two"),
    msg("assistant", "Recent answer two"),
    msg("user", "Recent request three"),
    msg("assistant", "Recent answer three"),
  ];

  const compacted = compactSessionMessages(messages, {
    maxMessagesBeforeCompact: 8,
    keepRecentTurns: 2,
    maxSummaryChars: 600,
  });

  ok(compacted.compacted, "compacts when threshold is exceeded");
  ok(compacted.summary.includes("Old request one"), "summary captures old user content");
  ok(compacted.summary.includes("Old answer two"), "summary captures old assistant content");
  ok(!compacted.summary.includes("Huge raw tool result"), "summary drops old tool chatter");
  ok(compacted.messages.length === 5, "keeps system message plus recent user/assistant turns");
  ok(compacted.messages.some((m) => m.role === "user" && m.content === "Recent request three"), "keeps recent raw turns");
  ok(!compacted.messages.some((m) => m.role === "tool"), "drops old tool messages from compacted raw session");
}

function testSkipsSmallSessions(): void {
  const compacted = compactSessionMessages([
    msg("system", "You are Jarvis."),
    msg("user", "Short"),
    msg("assistant", "Reply"),
  ]);

  ok(!compacted.compacted, "does not compact small sessions");
  ok(compacted.summary === "", "does not create a summary for small sessions");
  ok(compacted.messages.length === 3, "leaves small session messages untouched");
}

function testStructuredHandoffPreservesContinuityReferences(): void {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    msg("system", "You are Jarvis."),
    msg("user", "Decision: use the APK flow. Active task: update C:\\Projects\\Jarvis\\app.json and then ask me which build to ship."),
    msg("assistant", "Decision recorded. Open question: should Agent C merge after verification?"),
    msg("tool", "Created file C:\\Projects\\Jarvis\\dist\\report.pdf. URL: https://example.com/report. job_id=job_abc123 email_id=msg-789 artifact: Release checklist"),
    msg("user", "Recent request one"),
    msg("assistant", "Recent answer one"),
    msg("user", "Recent request two"),
    msg("assistant", "Recent answer two"),
    msg("user", "Recent request three"),
    msg("assistant", "Recent answer three"),
  ];

  const compacted = compactSessionMessages(messages, {
    maxMessagesBeforeCompact: 8,
    keepRecentTurns: 2,
    maxSummaryChars: 2000,
  });

  ok(compacted.summary.includes("## decisions"), "summary includes decisions section");
  ok(compacted.summary.includes("use the APK flow"), "preserves explicit user decision");
  ok(compacted.summary.includes("## open_tasks"), "summary includes open tasks section");
  ok(compacted.summary.includes("update C:\\Projects\\Jarvis\\app.json"), "preserves active task and file path");
  ok(compacted.summary.includes("## open_questions"), "summary includes open questions section");
  ok(compacted.summary.includes("which build to ship"), "preserves open question from user request");
  ok(compacted.summary.includes("https://example.com/report"), "preserves URL from tool output");
  ok(compacted.summary.includes("job_abc123"), "preserves job ID from tool output");
  ok(compacted.summary.includes("msg-789"), "preserves email/message ID from tool output");
  ok(compacted.summary.includes("Release checklist"), "preserves named artifact from tool output");
  ok(!compacted.messages.some((m) => m.role === "tool"), "drops raw old tool chatter after extracting artifacts");
}

function testLoadedSessionSummariesAreCapped(): void {
  const formatted = formatSessionSummariesForPrompt(
    [
      { summary: "A".repeat(300), messageCount: 4 },
      { summary: "B".repeat(300), messageCount: 5 },
      { summary: "C".repeat(300), messageCount: 6 },
    ],
    { maxCount: 2, maxChars: 420 },
  );

  ok(formatted.includes("UNTRUSTED CONTEXT"), "loaded summaries are untrusted context");
  ok(!formatted.includes("AAAA"), "drops older summaries beyond max count");
  ok(formatted.length <= 520, "caps loaded summary prompt size");
}

testCompactsOldMessagesAndDropsToolChatter();
testSkipsSmallSessions();
testStructuredHandoffPreservesContinuityReferences();
testLoadedSessionSummariesAreCapped();
finish();
