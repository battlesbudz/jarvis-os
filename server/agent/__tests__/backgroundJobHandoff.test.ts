import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildBackgroundJobPrompt, requestsReportFile, unsupportedReportFileFormat } from "../backgroundJobHandoff";

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
assert.equal(requestsReportFile("Deep dive into how PDF parsers work"), false);
assert.equal(requestsReportFile("Do not create a PDF; just summarize it here"), false);
assert.equal(requestsReportFile("Give me the report as a PDF"), true);
assert.equal(requestsReportFile("Give me the report, but not as a PDF"), false);
assert.equal(requestsReportFile("Give me the report without a PDF"), false);
assert.equal(requestsReportFile("Prepare a PDF report on sunflower seeds"), true);
assert.equal(requestsReportFile("Create a DOCX report on sunflower seeds"), false);
assert.equal(requestsReportFile("Create a Word document with the report"), false);
assert.equal(requestsReportFile("Research competitors and export the results as a CSV file"), false);
assert.equal(requestsReportFile("Create a downloadable JSON file with the findings"), false);
assert.equal(requestsReportFile("Export the findings as an XLSX spreadsheet"), false);
assert.equal(unsupportedReportFileFormat("Research competitors and export the results as a CSV file"), "CSV");
assert.equal(unsupportedReportFileFormat("Create a downloadable JSON file with the findings"), "JSON");
assert.equal(unsupportedReportFileFormat("Explain how JSON parsing works"), null);

const contextualRevisionPrompt = [
  "Revise this Jarvis deliverable according to the user's requested changes.",
  "",
  "Original task: Complete the latest user request as a self-contained background task.",
  "Latest user request:",
  "Give me the report as a PDF",
  "End latest user request.",
  "",
  "Requested changes:",
  "Do not make this a PDF; return Markdown only.",
  "",
  "Return a complete replacement deliverable, not a patch note.",
].join("\n");
assert.equal(
  requestsReportFile(contextualRevisionPrompt),
  false,
  "outer revision instructions override embedded contextual artifact intent",
);

const contextualPdfRevisionPrompt = contextualRevisionPrompt.replace(
  "Do not make this a PDF; return Markdown only.",
  "Keep the revised report as a PDF.",
);
assert.equal(
  requestsReportFile(contextualPdfRevisionPrompt),
  true,
  "outer revision instructions can explicitly preserve PDF output",
);

const ordinaryPdfRevisionPrompt = contextualRevisionPrompt.replace(
  "Do not make this a PDF; return Markdown only.",
  "Add another source and strengthen the conclusion.",
);
assert.equal(
  requestsReportFile(ordinaryPdfRevisionPrompt),
  true,
  "ordinary content revisions inherit the prior PDF output",
);

const markdownRevisionPrompt = contextualRevisionPrompt.replace(
  "Do not make this a PDF; return Markdown only.",
  "Change the revised report to Markdown instead.",
);
assert.equal(
  requestsReportFile(markdownRevisionPrompt),
  false,
  "an explicit Markdown revision replaces the prior PDF output",
);

const multilineFollowUp = "Research sunflower seeds thoroughly.\n\nGive me the report as a PDF";
const multilinePrompt = buildBackgroundJobPrompt(
  [
    { role: "user", content: "We were discussing sunflower seeds." },
    { role: "assistant", content: "What should the research cover?" },
    { role: "user", content: multilineFollowUp },
  ],
  multilineFollowUp,
);
assert.match(multilinePrompt, /Research sunflower seeds thoroughly\.\n\nGive me the report as a PDF/);
assert.match(multilinePrompt, /End latest user request\./);
assert.equal(requestsReportFile(multilinePrompt), true);

const definiteFollowUp = "Give me the report as a PDF";
const definitePrompt = buildBackgroundJobPrompt(
  [
    { role: "user", content: "Research sunflower seeds" },
    { role: "assistant", content: "I can prepare that research." },
    { role: "user", content: definiteFollowUp },
  ],
  definiteFollowUp,
);
assert.match(definitePrompt, /Research sunflower seeds/);
assert.match(definitePrompt, /Latest user request:\nGive me the report as a PDF/);
assert.equal(requestsReportFile(definitePrompt), true);

const jobQueueSource = readFileSync(
  fileURLToPath(new URL("../jobQueue.ts", import.meta.url)),
  "utf8",
);
assert.match(jobQueueSource, /if \(requestsReportFile\(job\.prompt\)\)/);
assert.match(jobQueueSource, /mimeType: "application\/pdf"/);
assert.match(jobQueueSource, /PDF generation failed; the complete report remains available in Inbox/);
assert.match(jobQueueSource, /driveLink,/);
assert.match(jobQueueSource, /schema\.deliverableArtifacts/);
assert.match(jobQueueSource, /hasDownloadableArtifact = true/);
assert.doesNotMatch(jobQueueSource, /getUserDriveSettings\(job\.userId\)/);
assert.doesNotMatch(jobQueueSource, /deep_research PDF Drive upload/);
assert.match(jobQueueSource, /Use Save to Drive if you want an external copy/);
assert.match(jobQueueSource, /job\.agentType === "writing" \|\| job\.agentType === "planning"/);
assert.match(jobQueueSource, /Limited-results PDF generated and available in Inbox/);
assert.match(jobQueueSource, /tx\.insert\(schema\.deliverableArtifacts\)/);

const reviewRoutesSource = readFileSync(
  fileURLToPath(new URL("../deliverableReviewHttpRoutes.ts", import.meta.url)),
  "utf8",
);
assert.match(reviewRoutesSource, /const artifactSourceChanged =/);
assert.match(reviewRoutesSource, /delete\(schema\.deliverableArtifacts\)/);
assert.match(reviewRoutesSource, /hasDownloadableArtifact: false/);
assert.match(reviewRoutesSource, /patch\.title !== existing\.title/);
assert.match(reviewRoutesSource, /patch\.body !== existing\.body/);

const coachAgentSource = readFileSync(
  fileURLToPath(new URL("../../channels/coachAgent.ts", import.meta.url)),
  "utf8",
);
assert.match(coachAgentSource, /backgroundPrompt: buildBackgroundJobPrompt\(recentMessages, userText\)/);

const deliverableRoutesSource = readFileSync(
  fileURLToPath(new URL("../../routes/deliverableRoutes.ts", import.meta.url)),
  "utf8",
);
assert.match(deliverableRoutesSource, /\/api\/deliverables\/:id\/artifact/);
assert.match(deliverableRoutesSource, /Content-Disposition/);
assert.match(deliverableRoutesSource, /deliverableArtifacts\.userId, userId/);
assert.match(deliverableRoutesSource, /triageSection === "recent_files"/);
assert.match(deliverableRoutesSource, /innerJoin\(\s*schema\.deliverableArtifacts/);

const databaseSource = readFileSync(
  fileURLToPath(new URL("../../db.ts", import.meta.url)),
  "utf8",
);
assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS deliverable_artifacts/);
assert.match(databaseSource, /deliverable_artifacts_deliverable_uidx/);

const inboxSource = readFileSync(
  fileURLToPath(new URL("../../../app/(tabs)/inbox.tsx", import.meta.url)),
  "utf8",
);
assert.match(inboxSource, /triageSection=recent_files/);
assert.match(inboxSource, /recent-file-download-/);
assert.match(inboxSource, /renderRecentFiles\(\)/);

console.log("All background job handoff assertions passed.");
