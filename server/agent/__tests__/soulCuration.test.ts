import { strict as assert } from "node:assert";
import { compactSoulText, shouldIncludeMemoryInSoul } from "../../memory/soulCuration";

assert.equal(
  shouldIncludeMemoryInSoul({
    content: "[Inbox triage] Railway notifications and Google security emails were reviewed.",
    sourceType: "inbox_triage",
  }),
  false,
  "inbox triage summaries should not shape Jarvis Soul",
);

assert.equal(
  shouldIncludeMemoryInSoul({
    content: "Jarvis self-knowledge: low engagement on prior response.",
    sourceType: "jarvis_self_knowledge",
  }),
  false,
  "internal Jarvis diagnostics should not shape Jarvis Soul",
);

assert.equal(
  shouldIncludeMemoryInSoul({
    content: "Browser QA Probe Deliverable was created for codex-chat-delegation-smoke.txt.",
    sourceType: "chat",
  }),
  false,
  "transient QA artifacts should not shape Jarvis Soul",
);

assert.equal(
  shouldIncludeMemoryInSoul({
    content: "The user prefers direct, concrete progress updates and verified fixes.",
    sourceType: "conversation",
  }),
  true,
  "durable response preferences should remain eligible for Jarvis Soul",
);

const compacted = compactSoulText("This   text\nhas\ttoo much whitespace and should be trimmed cleanly.", 32);
assert.equal(compacted, "This text has too much whitespa…", "compactSoulText normalizes and trims long values");

console.log("soulCuration.test.ts passed");
