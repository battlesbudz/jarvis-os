import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildBackgroundJobPrompt, requestsReportFile, unsupportedReportFileFormat } from "../backgroundJobHandoff";

const standalone = "Research sunflower seeds and make a report";
assert.equal(buildBackgroundJobPrompt([{ role: "user", content: standalone }], standalone), standalone);

for (const temporalStandalone of [
  "Create a PDF report on this year's CRM trends",
  "Create a PDF report on this quarter's CRM trends",
  "Create a PDF report on this week's CRM trends",
]) {
  assert.equal(
    buildBackgroundJobPrompt(
      [
        { role: "user", content: "Draft an email to Bob" },
        { role: "assistant", content: "What should it say?" },
        { role: "user", content: temporalStandalone },
      ],
      temporalStandalone,
    ),
    temporalStandalone,
  );
}

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
assert.equal(requestsReportFile("Give me a PDF report on sunflower seeds"), true);
assert.equal(requestsReportFile("Convert it into a PDF"), true);
assert.equal(requestsReportFile("Give me the report, but not as a PDF"), false);
assert.equal(requestsReportFile("Give me the report without a PDF"), false);
assert.equal(requestsReportFile("Prepare a PDF report on sunflower seeds"), true);
assert.equal(requestsReportFile("Write a report in PDF"), true);
assert.equal(requestsReportFile("Write the report to a PDF"), true);
assert.equal(requestsReportFile("Create a report about how economic conditions influence small coastal communities worldwide as a PDF"), true);
assert.equal(requestsReportFile("Create a detailed comparison of CRM vendors for a small nonprofit as a PDF"), true);
assert.equal(requestsReportFile("Download a PDF report on sunflower seeds"), true);
assert.equal(requestsReportFile("Download a report file"), true);
assert.equal(requestsReportFile("Create a report file about sunflower seeds"), true);
assert.equal(requestsReportFile("Write a document about sunflower seeds"), true);
assert.equal(requestsReportFile("Write a report about sunflower seeds"), false);
assert.equal(requestsReportFile("I need a PDF report on sunflower seeds"), true);
assert.equal(requestsReportFile("I want a PDF report"), true);
assert.equal(requestsReportFile("I would like a PDF report on sunflower seeds"), true);
assert.equal(requestsReportFile("I'd like a PDF report"), true);
assert.equal(requestsReportFile("I don't want a PDF report"), false);
assert.equal(requestsReportFile("Do not download a PDF report"), false);
assert.equal(requestsReportFile("Create a DOCX report on sunflower seeds"), false);
assert.equal(requestsReportFile("Create a Word document with the report"), false);
assert.equal(requestsReportFile("Research competitors and export the results as a CSV file"), false);
assert.equal(requestsReportFile("Create a downloadable JSON file with the findings"), false);
assert.equal(requestsReportFile("Export the findings as an XLSX spreadsheet"), false);
assert.equal(unsupportedReportFileFormat("Research competitors and export the results as a CSV file"), "CSV");
assert.equal(unsupportedReportFileFormat("Give me a CSV file of the results"), "CSV");
assert.equal(unsupportedReportFileFormat("Download a CSV file of the results"), "CSV");
assert.equal(unsupportedReportFileFormat("I need a CSV file of the results"), "CSV");
assert.equal(unsupportedReportFileFormat("Change the output to DOCX"), "DOCX");
assert.equal(unsupportedReportFileFormat("Create a downloadable JSON file with the findings"), "JSON");
assert.equal(unsupportedReportFileFormat("Create a CSV report of monthly sales"), "CSV");
assert.equal(unsupportedReportFileFormat("Write an HTML report"), "HTML");
assert.equal(unsupportedReportFileFormat("Write a report explaining how to export data as CSV"), null);
assert.equal(unsupportedReportFileFormat("Write a report about why companies export data as CSV"), null);
assert.equal(unsupportedReportFileFormat("Prepare a guide on how best to convert JSON to XML"), null);
assert.equal(unsupportedReportFileFormat("Explain how JSON parsing works"), null);
assert.equal(unsupportedReportFileFormat("Return this object as JSON"), null);
assert.equal(unsupportedReportFileFormat("Convert this snippet to HTML"), null);
assert.equal(unsupportedReportFileFormat("Write a JSON parser"), null);
assert.equal(unsupportedReportFileFormat("Create a CSV importer"), null);
assert.equal(unsupportedReportFileFormat("Create a PDF report comparing JSON file formats"), null);
assert.equal(requestsReportFile("Create a PDF report comparing JSON file formats"), true);
assert.equal(unsupportedReportFileFormat("Create a PDF report and export the results as CSV"), "CSV");

const standaloneItRequest = "Research IT security trends";
assert.equal(
  buildBackgroundJobPrompt(
    [{ role: "user", content: "Email the quarterly update to Bob" }],
    standaloneItRequest,
  ),
  standaloneItRequest,
);
assert.equal(requestsReportFile("Create a PDF report and export the results as CSV"), false);
assert.equal(requestsReportFile("Research how to write PDF files safely"), false);
assert.equal(requestsReportFile("PDF please"), false);

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

const carriedArtifactRevisionPrompt = [
  "Revise this Jarvis deliverable according to the user's requested changes.",
  "Original task: Research sunflower seeds.",
  "Original output requirement: Preserve the replacement as a PDF file unless the requested changes explicitly change the format.",
  "Requested changes:",
  "Add another source and strengthen the conclusion.",
  "Return a complete replacement deliverable, not a patch note.",
].join("\n");
assert.equal(
  requestsReportFile(carriedArtifactRevisionPrompt),
  true,
  "persisted artifact intent survives revisions of consolidated deliverables",
);

const titleOnlyRevisionPrompt = contextualRevisionPrompt.replace(
  "Do not make this a PDF; return Markdown only.",
  "Change the title to CSV Adoption.",
);
assert.equal(
  requestsReportFile(titleOnlyRevisionPrompt),
  true,
  "format words used in content edits do not replace the prior PDF output",
);
assert.equal(unsupportedReportFileFormat(titleOnlyRevisionPrompt), null);

const contentNegationRevisionPrompt = contextualRevisionPrompt.replace(
  "Do not make this a PDF; return Markdown only.",
  "Do not mention PDF in the conclusion.",
);
assert.equal(
  requestsReportFile(contentNegationRevisionPrompt),
  true,
  "content-only negations inherit the prior PDF output",
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

const tersePrompt = buildBackgroundJobPrompt(
  [
    { role: "user", content: "Summarize these notes" },
    { role: "assistant", content: "Here is the summary." },
    { role: "user", content: "PDF please" },
  ],
  "PDF please",
);
assert.match(tersePrompt, /Latest user request:\nPDF please/);
assert.equal(requestsReportFile(tersePrompt), true);

const longReport = `Report start ${"complete report content ".repeat(400)}Report end`;
const longReportPrompt = buildBackgroundJobPrompt(
  [
    { role: "user", content: "Write a detailed report." },
    { role: "assistant", content: longReport },
    { role: "user", content: "Make it a PDF" },
  ],
  "Make it a PDF",
);
assert.match(longReportPrompt, /Report start/);
assert.match(longReportPrompt, /Report end/);

const jobQueueSource = readFileSync(
  fileURLToPath(new URL("../jobQueue.ts", import.meta.url)),
  "utf8",
);
assert.match(jobQueueSource, /if \(requestsReportFile\(job\.prompt\)\)/);
assert.match(jobQueueSource, /mimeType: "application\/pdf"/);
assert.match(jobQueueSource, /PDF generation failed; the complete report remains available in Inbox/);
assert.match(jobQueueSource, /driveLink: null/);
assert.match(jobQueueSource, /schema\.deliverableArtifacts/);
assert.match(jobQueueSource, /hasDownloadableArtifact = true/);
assert.doesNotMatch(jobQueueSource, /getUserDriveSettings\(job\.userId\)/);
assert.doesNotMatch(jobQueueSource, /deep_research PDF Drive upload/);
assert.doesNotMatch(jobQueueSource, /research batch PDF.*Drive/);
assert.doesNotMatch(jobQueueSource, /createDriveBinaryFile/);
assert.match(jobQueueSource, /Use Save to Drive if you want an external copy/);
assert.match(jobQueueSource, /job\.agentType === "writing" \|\| job\.agentType === "planning" \|\| job\.agentType === "research"/);
assert.match(jobQueueSource, /Limited-results PDF generated and available in Inbox/);
assert.match(jobQueueSource, /tx\.insert\(schema\.deliverableArtifacts\)/);
assert.match(jobQueueSource, /\.for\("update"\)/);
assert.match(jobQueueSource, /const hasActiveDeliverables = await db\.transaction[\s\S]*?markdownToPdfBuffer[\s\S]*?tx\.insert\(schema\.deliverableArtifacts\)/);
assert.doesNotMatch(jobQueueSource, /persistBatchArtifact/);
assert.match(jobQueueSource, /activeSiblingDeliverables/);
assert.match(jobQueueSource, /deliverable\.status === "pending_approval" && !deliverable\.driveLink/);
assert.match(jobQueueSource, /if \(!hasActiveDeliverables\) return/);
assert.match(jobQueueSource, /prompt: schema\.agentJobs\.prompt/);
assert.match(jobQueueSource, /pdfRequestedByJobId\.set\(row\.id, promptedPdf\)/);
assert.match(jobQueueSource, /jobs\.splice[\s\S]*?wantsPdf = jobs\.some[\s\S]*?activeJobIds[\s\S]*?pdfRequestedByJobId/);
assert.match(jobQueueSource, /const siblingDeliverables = await tx[\s\S]*?\.for\("update"\)/);
assert.doesNotMatch(jobQueueSource, /const siblingDeliverables = await db/);
assert.match(
  jobQueueSource,
  /if \(activeSiblingDeliverables\.length > 1\)[\s\S]*?hasDownloadableArtifact: false[\s\S]*?delete\(schema\.deliverableArtifacts\)[\s\S]*?mergedDeliverableId = firstId/,
);
assert.match(jobQueueSource, /batchOriginChannel === "slack"/);
assert.match(jobQueueSource, /researchBatchScope\(originChannel, originDestination\)/);
assert.match(jobQueueSource, /batch\.scope !== scope/);
assert.match(jobQueueSource, /researchBatchScope\(siblingOrigin, siblingDestination\) !== scope/);
assert.match(jobQueueSource, /originNotificationDestination = originDiscordChannelId/);
assert.doesNotMatch(jobQueueSource, /Jarvis inbox or Google Drive/);
assert.match(jobQueueSource, /Jarvis inbox, then use Save to Drive/);

const reviewRoutesSource = readFileSync(
  fileURLToPath(new URL("../deliverableReviewHttpRoutes.ts", import.meta.url)),
  "utf8",
);
assert.match(reviewRoutesSource, /const artifactSourceChanged =/);
assert.match(reviewRoutesSource, /delete\(schema\.deliverableArtifacts\)/);
assert.match(reviewRoutesSource, /hasDownloadableArtifact: false/);
assert.match(reviewRoutesSource, /patch\.title !== existing\.title/);
assert.match(reviewRoutesSource, /patch\.body !== existing\.body/);
assert.match(reviewRoutesSource, /existing\.driveLink[\s\S]*?schema\.deliverables\.driveLink/);
assert.match(reviewRoutesSource, /db\.transaction\(async \(tx\)[\s\S]*?\.for\("update"\)[\s\S]*?submitAgentJob/);
assert.match(reviewRoutesSource, /submitAgentJob\([\s\S]*?\}, tx, \{ skipDuplicateCheck: true \}\)/);
assert.match(reviewRoutesSource, /skipDuplicateCheck: true/);
assert.match(reviewRoutesSource, /unsupportedReportFileFormat\(revisionPrompt\)/);
assert.doesNotMatch(reviewRoutesSource, /d\.body\.slice/);
assert.match(reviewRoutesSource, /Deliverable changed while approval was being prepared/);
assert.match(reviewRoutesSource, /Deliverable changed while rejection was being prepared/);
assert.match(reviewRoutesSource, /Deliverable changed while discard was being prepared/);
assert.match(reviewRoutesSource, /save-to-drive[\s\S]*?db\.transaction\(async \(tx\)[\s\S]*?\.for\("update"\)[\s\S]*?createDriveBinaryFile/);
assert.match(reviewRoutesSource, /idempotencyKey: saveKey/);
assert.match(reviewRoutesSource, /deleteDriveFile\(accessToken, newlyCreatedDriveFileId\)/);
assert.doesNotMatch(reviewRoutesSource, /revision_pending/);

const googleDriveSource = readFileSync(
  fileURLToPath(new URL("../../integrations/googleDrive.ts", import.meta.url)),
  "utf8",
);
assert.match(googleDriveSource, /appProperties has \{ key='jarvisSaveKey'/);
assert.match(googleDriveSource, /appProperties: \{ jarvisSaveKey: options\.idempotencyKey \}/);
assert.match(googleDriveSource, /export async function deleteDriveFile/);

const slackWebhookSource = readFileSync(
  fileURLToPath(new URL("../../channels/slackWebhook.ts", import.meta.url)),
  "utf8",
);
assert.match(slackWebhookSource, /originChannelId: slackDestination/);
assert.match(slackWebhookSource, /ev\.thread_ts/);
assert.match(slackWebhookSource, /ev\.type === "app_mention" \? ev\.ts/);
assert.match(slackWebhookSource, /slackThreadTs \|\| undefined/);
assert.match(slackWebhookSource, /rootThreadSessionChannel[\s\S]*?ev\.ts/);
assert.match(slackWebhookSource, /setSession\(userId, rootThreadSessionChannel, sdkSessionId\)/);
assert.match(slackWebhookSource, /Slack:\$\{teamId\}:\$\{slackDestination\}/);
assert.match(slackWebhookSource, /getSession\(userId, slackSessionChannel\)/);
assert.match(slackWebhookSource, /setSession\(userId, slackSessionChannel/);
assert.match(slackWebhookSource, /Slack:\$\{teamId\}:slash:\$\{String\(req\.body\.channel_id \|\| ""\)\}/);
assert.match(slackWebhookSource, /Brain dump:[^\n]+channelName: "Slack", sdkSessionId: braindumpSession/);
assert.match(slackWebhookSource, /What's the status[^\n]+channelName: "Slack", sdkSessionId: statusSession/);

const slackChannelSource = readFileSync(
  fileURLToPath(new URL("../../channels/slackChannel.ts", import.meta.url)),
  "utf8",
);
assert.match(slackChannelSource, /opts\.threadKey/);
assert.match(slackChannelSource, /thread_ts/);

const coachAgentSource = readFileSync(
  fileURLToPath(new URL("../../channels/coachAgent.ts", import.meta.url)),
  "utf8",
);
assert.match(coachAgentSource, /backgroundPrompt: buildBackgroundJobPrompt\(recentMessages, userText\)/);
assert.match(coachAgentSource, /channelName === "Slack" \|\| channelName\.startsWith\("Discord"\)/);
assert.match(coachAgentSource, /sessionResumed \|\| destinationScopedConversation/);
assert.match(coachAgentSource, /if \(!destinationScopedConversation\) \{[\s\S]*?db\.insert\(schema\.chatHistory\)/);
assert.match(coachAgentSource, /reply: autonomyReply,[\s\S]*?persistGlobalHistory: false/);
assert.match(coachAgentSource, /sdkSessionId: autonomySessionId/);

const discordManagerSource = readFileSync(
  fileURLToPath(new URL("../../discord/manager.ts", import.meta.url)),
  "utf8",
);
assert.match(discordManagerSource, /Discord:\$\{discordChannelId\}/);
assert.match(discordManagerSource, /getCoachSession\(userId, discordSessionChannel\)/);
assert.match(discordManagerSource, /setCoachSession\(userId, discordSessionChannel/);

const discordSlashSource = readFileSync(
  fileURLToPath(new URL("../../discord/slashCommands.ts", import.meta.url)),
  "utf8",
);
assert.match(discordSlashSource, /const deliveryChannelId = isPublic \? originChannelId : undefined/);
assert.match(discordSlashSource, /Discord:slash:\$\{isPublic \? "public" : "private"\}/);
assert.match(discordSlashSource, /getCoachSession\(userId, sessionChannel\)/);
assert.match(discordSlashSource, /setCoachSession\(userId, sessionChannel/);
assert.match(discordSlashSource, /tryHandleDiscordChatWithPrime/);
assert.match(discordSlashSource, /reply: primeReply,[\s\S]*?persistGlobalHistory: false/);

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
assert.match(inboxSource, /recent-file-save-to-drive-/);
assert.match(inboxSource, /recent-file-drive-link-/);
assert.match(inboxSource, /renderRecentFiles\(\)/);
assert.match(inboxSource, /Platform\.OS === 'android'/);
assert.match(inboxSource, /StorageAccessFramework\.requestDirectoryPermissionsAsync/);
assert.match(inboxSource, /StorageAccessFramework\.createFileAsync/);
assert.doesNotMatch(inboxSource, /getContentUriAsync/);
assert.match(inboxSource, /Share\.share\(\{ url: uri, title: filename \}\)/);

console.log("All background job handoff assertions passed.");
