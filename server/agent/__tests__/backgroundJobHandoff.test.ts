import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildBackgroundJobPrompt, requestsReportFile } from "../backgroundJobHandoff";

const standalone = "Research sunflower seeds and make a report";
assert.equal(buildBackgroundJobPrompt([{ role: "user", content: standalone }], standalone), standalone);

const latest = "No, the whole point was to research this and give it back to me as a file";
const prompt = buildBackgroundJobPrompt(
  [
    { role: "user", content: "Make a detailed report about sunflower seeds as a PDF" },
    { role: "assistant", content: "Here is an inline summary." },
    { role: "user", content: latest },
  ],
  latest,
);

assert.match(prompt, /sunflower seeds/i);
assert.match(prompt, /PDF/i);
assert.match(prompt, /Latest user request:/);
assert.match(prompt, /speech-to-text artifacts/i);
assert.equal(requestsReportFile(prompt), true);
assert.equal(requestsReportFile("Research sunflower seeds and summarize the findings"), false);
assert.equal(requestsReportFile("Create a downloadable file with the report"), true);

const jobQueueSource = readFileSync(
  fileURLToPath(new URL("../jobQueue.ts", import.meta.url)),
  "utf8",
);
assert.match(jobQueueSource, /if \(requestsReportFile\(job\.prompt\)\)/);
assert.match(jobQueueSource, /mimeType: "application\/pdf"/);
assert.match(jobQueueSource, /PDF generation failed; the complete report remains available in Inbox/);
assert.match(jobQueueSource, /driveLink,/);

console.log("All background job handoff assertions passed.");
