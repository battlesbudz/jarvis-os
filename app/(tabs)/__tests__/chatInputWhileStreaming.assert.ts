import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");
const insightsSource = fs.readFileSync(path.join(repoRoot, "app/(tabs)/insights.tsx"), "utf8");

assert.match(
  insightsSource,
  /editable=\{!isRecording && !isTranscribing && !isBaseLoading\}/,
  "the chat input should stay editable while a response is streaming",
);
assert.doesNotMatch(
  insightsSource,
  /editable=\{!isStreaming &&/,
  "the chat input should not use the streaming state as an editability lock",
);
assert.match(
  insightsSource,
  /if \(!text\.trim\(\) \|\| isStreaming\) return;/,
  "sending a drafted message should remain blocked while the current response is streaming",
);

console.log("OK: chat input remains editable while a response is streaming");
