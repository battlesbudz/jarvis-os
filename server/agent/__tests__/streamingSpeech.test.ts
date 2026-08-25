import assert from "node:assert/strict";
import { SpeakableResponseSegmenter, StreamingSpeechQueue } from "@shared/streamingSpeech";

async function main() {
const segmenter = new SpeakableResponseSegmenter("response-1");
assert.deepEqual(segmenter.append("Here is the answer. It arrives "), [
  { id: "response-1:0", index: 0, spokenText: "Here is the answer." },
]);
assert.deepEqual(segmenter.append("in order! Visit https://example.com now. ```ts\nrm -rf /\n``` Finally done."), [
  { id: "response-1:1", index: 1, spokenText: "It arrives in order!" },
  { id: "response-1:2", index: 2, spokenText: "Visit now." },
  { id: "response-1:3", index: 3, spokenText: "Finally done." },
]);
assert.deepEqual(segmenter.finish(), []);

const splitFence = new SpeakableResponseSegmenter("split-fence");
assert.deepEqual(splitFence.append("Safe introduction. `"), [{ id: "split-fence:0", index: 0, spokenText: "Safe introduction." }]);
assert.deepEqual(splitFence.append("``ts\nsecretCommand()\n``"), []);
assert.deepEqual(splitFence.append("` Safe ending."), [{ id: "split-fence:1", index: 1, spokenText: "Safe ending." }]);

const tildeFence = new SpeakableResponseSegmenter("tilde-fence");
assert.deepEqual(tildeFence.append("Safe preface. ~~"), [{ id: "tilde-fence:0", index: 0, spokenText: "Safe preface." }]);
assert.deepEqual(tildeFence.append("~json\n{\"command\":\"secret\"}\n~~"), []);
assert.deepEqual(tildeFence.append("~ Safe conclusion."), [
  { id: "tilde-fence:1", index: 1, spokenText: "Safe conclusion." },
]);

const longFence = new SpeakableResponseSegmenter("long-fence");
assert.deepEqual(longFence.append("Safe opening. ``"), [{ id: "long-fence:0", index: 0, spokenText: "Safe opening." }]);
assert.deepEqual(longFence.append("``md\n```\nsecretCommand()\n```\n``"), []);
assert.deepEqual(longFence.append("`` Safe close."), [{ id: "long-fence:1", index: 1, spokenText: "Safe close." }]);

const threeThenOneFence = new SpeakableResponseSegmenter("three-then-one-fence");
assert.deepEqual(threeThenOneFence.append("Safe opening. ```"), [
  { id: "three-then-one-fence:0", index: 0, spokenText: "Safe opening." },
]);
assert.deepEqual(threeThenOneFence.append("`md\n```\nsecretCommand()\n```\n```` Safe close."), [
  { id: "three-then-one-fence:1", index: 1, spokenText: "Safe close." },
]);

const markdown = new SpeakableResponseSegmenter("markdown");
const markdownChunks = markdown.append("## Result\n- [OpenAI](https://openai.com) works. ");
markdownChunks.push(...markdown.finish());
assert.deepEqual(markdownChunks.map((chunk) => chunk.spokenText), ["Result OpenAI works."]);

const terminalInlineCode = new SpeakableResponseSegmenter("terminal-inline-code");
assert.deepEqual(terminalInlineCode.append("Run `npm test`"), []);
assert.deepEqual(terminalInlineCode.finish().map((chunk) => chunk.spokenText), ["Run npm test"]);

const terminalStrikethrough = new SpeakableResponseSegmenter("terminal-strikethrough");
assert.deepEqual(terminalStrikethrough.append("This is ~~obsolete~~"), []);
assert.deepEqual(terminalStrikethrough.finish().map((chunk) => chunk.spokenText), ["This is obsolete"]);

const structural = new SpeakableResponseSegmenter("structural");
assert.deepEqual(structural.append('{\n  "command": "delete_everything". '), []);
assert.deepEqual(structural.append('\n  "arguments": ["secret", "payload"]\n} Safe summary.'), [
  { id: "structural:0", index: 0, spokenText: "Safe summary." },
]);
const incompleteStructural = new SpeakableResponseSegmenter("incomplete-structural");
assert.deepEqual(incompleteStructural.append('{ "payload": "never speak this"'), []);
assert.deepEqual(incompleteStructural.finish(), []);
const truncatedStructural = new SpeakableResponseSegmenter("truncated-structural");
assert.deepEqual(truncatedStructural.append('Safe answer. {"payload":'), []);
assert.deepEqual(truncatedStructural.finish(), [
  { id: "truncated-structural:0", index: 0, spokenText: "Safe answer." },
]);

const introducedStructural = new SpeakableResponseSegmenter("introduced-structural");
assert.deepEqual(introducedStructural.append('Result:\n{\n  "command": "secret"'), []);
const introducedChunks = introducedStructural.append('\n} Safe summary.');
introducedChunks.push(...introducedStructural.finish());
assert.deepEqual(introducedChunks.map((chunk) => chunk.spokenText), ["Result: Safe summary."]);
const sameLineStructural = new SpeakableResponseSegmenter("same-line-structural");
const sameLineChunks = sameLineStructural.append('Result: {"command":"secret","arguments":["never speak"]} Safe summary.');
sameLineChunks.push(...sameLineStructural.finish());
assert.deepEqual(sameLineChunks.map((chunk) => chunk.spokenText), ["Result: Safe summary."]);
const templateProse = new SpeakableResponseSegmenter("template-prose");
const templateChunks = templateProse.append("Use {username} in the greeting. ");
templateChunks.push(...templateProse.finish());
assert.deepEqual(templateChunks.map((chunk) => chunk.spokenText), ["Use {username} in the greeting."]);

const leadingMarkdownLink = new SpeakableResponseSegmenter("leading-link");
const linkChunks = leadingMarkdownLink.append("[OpenAI](https://openai.com) works. ");
linkChunks.push(...leadingMarkdownLink.finish());
assert.deepEqual(linkChunks.map((chunk) => chunk.spokenText), ["OpenAI works."]);
const longUrl = new SpeakableResponseSegmenter("long-url");
const signedUrl = `https://example.com/download/${"a".repeat(260)}?token=private-token`;
assert.deepEqual(longUrl.append(`Open ${signedUrl}`), []);
const longUrlChunks = longUrl.append(" then continue safely. ");
longUrlChunks.push(...longUrl.finish());
assert.deepEqual(longUrlChunks.map((chunk) => chunk.spokenText), ["Open then continue safely."]);
assert.doesNotMatch(longUrlChunks.map((chunk) => chunk.spokenText).join(" "), /private-token|aaaa/);
const bracketedProse = new SpeakableResponseSegmenter("bracketed-prose");
const proseChunks = bracketedProse.append("[Note] Save this setting. ");
proseChunks.push(...bracketedProse.finish());
assert.deepEqual(proseChunks.map((chunk) => chunk.spokenText), ["[Note] Save this setting."]);
const falseAlarm = new SpeakableResponseSegmenter("false-alarm");
const falseAlarmChunks = falseAlarm.append("[False alarm] Do not ignore this warning. ");
falseAlarmChunks.push(...falseAlarm.finish());
assert.deepEqual(falseAlarmChunks.map((chunk) => chunk.spokenText), ["[False alarm] Do not ignore this warning."]);

const numericBrackets = new SpeakableResponseSegmenter("numeric-brackets");
const numericBracketChunks = numericBrackets.append("Take [2] tablets daily. ");
numericBracketChunks.push(...numericBrackets.finish());
assert.deepEqual(numericBracketChunks.map((chunk) => chunk.spokenText), ["Take [2] tablets daily."]);

const leadingNumericBrackets = new SpeakableResponseSegmenter("leading-numeric-brackets");
const leadingNumericChunks = leadingNumericBrackets.append("[2026] was the baseline. ");
leadingNumericChunks.push(...leadingNumericBrackets.finish());
assert.deepEqual(leadingNumericChunks.map((chunk) => chunk.spokenText), ["[2026] was the baseline."]);

const numericVector = new SpeakableResponseSegmenter("numeric-vector");
const numericVectorChunks = numericVector.append("[1, 2] are the coordinates. ");
numericVectorChunks.push(...numericVector.finish());
assert.deepEqual(numericVectorChunks.map((chunk) => chunk.spokenText), ["[1, 2] are the coordinates."]);

const introducedNumericVector = new SpeakableResponseSegmenter("introduced-numeric-vector");
const introducedVectorChunks = introducedNumericVector.append("Coordinates: [1, 2] are selected. ");
introducedVectorChunks.push(...introducedNumericVector.finish());
assert.deepEqual(introducedVectorChunks.map((chunk) => chunk.spokenText), ["Coordinates: [1, 2] are selected."]);

const literalOperators = new SpeakableResponseSegmenter("literal-operators");
const literalOperatorChunks = literalOperators.append("2 * 3 = 6, and API_KEY stays intact. ");
literalOperatorChunks.push(...literalOperators.finish());
assert.deepEqual(literalOperatorChunks.map((chunk) => chunk.spokenText), ["2 * 3 = 6, and API_KEY stays intact."]);

const indentedCode = new SpeakableResponseSegmenter("indented-code");
const indentedChunks = indentedCode.append("Run this carefully.\n    rm -rf /tmp\nThen confirm completion. ");
indentedChunks.push(...indentedCode.finish());
assert.deepEqual(indentedChunks.map((chunk) => chunk.spokenText), [
  "Run this carefully.",
  "Then confirm completion.",
]);

const longIndentedCode = new SpeakableResponseSegmenter("long-indented-code");
const longIndentedChunks = longIndentedCode.append(`Safe preface.\n    ${"x".repeat(300)}\nSafe close. `);
longIndentedChunks.push(...longIndentedCode.finish());
assert.deepEqual(longIndentedChunks.map((chunk) => chunk.spokenText), ["Safe preface.", "Safe close."]);

const spoken: string[] = [];
const fallback: string[] = [];
const queue = new StreamingSpeechQueue({
  speak: async (chunk) => {
    if (chunk.index === 1) throw new Error("provider failed");
    spoken.push(chunk.id);
  },
  fallback: async (chunk) => { fallback.push(chunk.id); },
});
queue.enqueue([
  { id: "q:0", index: 0, spokenText: "one" },
  { id: "q:1", index: 1, spokenText: "two" },
  { id: "q:1", index: 1, spokenText: "two" },
  { id: "q:2", index: 2, spokenText: "three" },
]);
await queue.settled();
assert.deepEqual(spoken, ["q:0"]);
assert.deepEqual(fallback, ["q:1", "q:2"]);

const partialFallback: string[] = [];
const partiallySpoken = new StreamingSpeechQueue({
  speak: async (chunk, _signal, markPlaybackStarted) => {
    if (chunk.index === 0) {
      markPlaybackStarted();
      throw new Error("provider failed after audio started");
    }
  },
  fallback: async (chunk) => { partialFallback.push(chunk.id); },
});
partiallySpoken.enqueue([
  { id: "partial:0", index: 0, spokenText: "partially heard" },
  { id: "partial:1", index: 1, spokenText: "next chunk" },
]);
await assert.rejects(partiallySpoken.settled(), /provider failed after audio started/);
assert.deepEqual(partialFallback, []);

let failedFallbackCalls = 0;
const terminalFallback = new StreamingSpeechQueue({
  speak: async () => { throw new Error("provider unavailable"); },
  fallback: async () => {
    failedFallbackCalls += 1;
    throw new Error("fallback unavailable");
  },
});
terminalFallback.enqueue([
  { id: "terminal:0", index: 0, spokenText: "one" },
  { id: "terminal:1", index: 1, spokenText: "two" },
]);
await assert.rejects(terminalFallback.settled(), /fallback unavailable/);
await Promise.resolve();
assert.equal(failedFallbackCalls, 1);

let release!: () => void;
const cancelled: string[] = [];
const cancellable = new StreamingSpeechQueue({
  speak: async (chunk, signal) => {
    await new Promise<void>((resolve) => {
      release = resolve;
      signal.addEventListener("abort", resolve, { once: true });
    });
    if (signal.aborted) cancelled.push(chunk.id);
  },
  fallback: async () => {},
});
cancellable.enqueue([
  { id: "cancel:0", index: 0, spokenText: "one" },
  { id: "cancel:1", index: 1, spokenText: "two" },
]);
await Promise.resolve();
cancellable.suppress();
release();
await cancellable.settled();
assert.deepEqual(cancelled, ["cancel:0"]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
