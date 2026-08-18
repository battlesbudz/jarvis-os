export interface BackgroundJobChatMessage {
  role?: string;
  content?: unknown;
}

const MAX_CONTEXT_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 6_000;
const MAX_MESSAGE_CHARS = 1_600;
const LATEST_REQUEST_MARKER = "Latest user request:";
const LATEST_REQUEST_END_MARKER = "End latest user request.";
const REVISION_REQUEST_MARKER = "Requested changes:";
const REVISION_REQUEST_END_MARKER = "Return a complete replacement deliverable";

function textContent(message: BackgroundJobChatMessage): string {
  return typeof message.content === "string"
    ? message.content.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_CHARS)
    : "";
}

function isContextDependentFollowUp(text: string): boolean {
  return /\b(this|that|these|those|it|previous|earlier|above|whole point|as before)\b/i.test(text)
    || /\bthe\s+(?:report|document|file|research|results?|findings?|task|job)\b/i.test(text)
    || /\b(?:the\s+)?same\b/i.test(text)
    || /^(yes|no|correct|exactly)\b/i.test(text.trim());
}

/**
 * Background workers do not receive the live conversation. Turn a referential
 * follow-up into a bounded, self-contained handoff while leaving standalone
 * requests unchanged.
 */
export function buildBackgroundJobPrompt(
  messages: BackgroundJobChatMessage[],
  latestUserText: string,
): string {
  const latest = latestUserText.trim();
  const normalizedLatest = latest.replace(/\s+/g, " ");
  if (!latest || !isContextDependentFollowUp(latest)) return latest;

  let latestIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user" && textContent(messages[index]) === normalizedLatest) {
      latestIndex = index;
      break;
    }
  }

  const end = latestIndex >= 0 ? latestIndex : messages.length;
  const context = messages
    .slice(Math.max(0, end - MAX_CONTEXT_MESSAGES), end)
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const content = textContent(message);
      if (!content) return "";
      return `${message.role === "assistant" ? "Assistant" : "User"}: ${content}`;
    })
    .filter(Boolean)
    .join("\n")
    .slice(-MAX_CONTEXT_CHARS)
    .trim();

  if (!context) return latest;

  return [
    "Complete the latest user request as a self-contained background task.",
    "",
    "Relevant conversation context (oldest to newest):",
    context,
    "",
    LATEST_REQUEST_MARKER,
    latest,
    LATEST_REQUEST_END_MARKER,
    "",
    "Resolve references such as ‘this’, ‘that’, and ‘it’ from the context above. Preserve the requested subject, scope, and output format. Do not treat speech-to-text artifacts as the research topic when the intended topic is clear from context.",
  ].join("\n");
}

function artifactRequestText(prompt: string): string {
  const revisionStart = prompt.lastIndexOf(REVISION_REQUEST_MARKER);
  const revisionEnd = revisionStart >= 0
    ? prompt.indexOf(REVISION_REQUEST_END_MARKER, revisionStart + REVISION_REQUEST_MARKER.length)
    : -1;
  const latestStart = prompt.lastIndexOf(LATEST_REQUEST_MARKER);
  const latestEnd = latestStart >= 0
    ? prompt.indexOf(LATEST_REQUEST_END_MARKER, latestStart + LATEST_REQUEST_MARKER.length)
    : -1;
  if (revisionStart >= 0) {
    const revision = prompt.slice(
      revisionStart + REVISION_REQUEST_MARKER.length,
      revisionEnd >= 0 ? revisionEnd : undefined,
    ).trim();
    // An ordinary content revision inherits the prior artifact format. Only an
    // explicit format instruction may replace or remove that intent.
    const format = String.raw`(?:pdf|markdown|downloadable\\s+(?:report|document|file)|docx|word\\s+document|csv|json|xlsx?|spreadsheet|pptx?|powerpoint|html|xml|rtf|tsv)`;
    const formatAction = new RegExp(
      String.raw`\\b(?:create|make|generate|produce|prepare|write|compile|format|export|attach|send|deliver|return|provide|save|give|keep|preserve|change|switch|convert)\\b[^.!?\\n]{0,80}\\b${format}\\b`,
      "i",
    );
    const formatAs = new RegExp(String.raw`\\b(?:as|in|to)\\s+(?:an?\\s+)?${format}\\b`, "i");
    const formatNegation = new RegExp(
      String.raw`\\b(?:not|without|no)\\b[^.!?\\n]{0,40}\\b(?:pdf|downloadable\\s+(?:report|document|file))\\b`,
      "i",
    );
    if (formatAction.test(revision) || formatAs.test(revision) || formatNegation.test(revision)) {
      return revision;
    }
    return artifactRequestText(prompt.slice(0, revisionStart));
  }
  return latestStart >= 0
    ? prompt.slice(
        latestStart + LATEST_REQUEST_MARKER.length,
        latestEnd >= 0 ? latestEnd : undefined,
      ).trim()
    : prompt.trim();
}

const UNSUPPORTED_REPORT_FORMAT = /\b(docx|word\s+document|csv|json|xlsx?|spreadsheet|pptx?|powerpoint|html|xml|rtf|tsv)\b/i;
const EXPLICIT_FILE_ACTION = /\b(create|make|generate|produce|prepare|write|compile|format|export|attach|send|deliver|return|provide|save|give|want|need)\b/i;

/** Identify an explicit requested file format that this renderer cannot create. */
export function unsupportedReportFileFormat(prompt: string): string | null {
  const request = artifactRequestText(prompt);
  const match = request.match(UNSUPPORTED_REPORT_FORMAT);
  if (!match) return null;
  const hasFileIntent = EXPLICIT_FILE_ACTION.test(request)
    || /\bdownloadable\b/i.test(request)
    || /\b(?:as|in)\s+(?:an?\s+)?(?:docx|word\s+document|csv|json|xlsx?|spreadsheet|pptx?|powerpoint|html|xml|rtf|tsv)\b/i.test(request);
  return hasFileIntent ? match[1].toUpperCase() : null;
}

/** Return true when the user explicitly requested a downloadable PDF report file. */
export function requestsReportFile(prompt: string): boolean {
  // A contextual handoff contains earlier turns that may merely mention PDFs.
  // Creation intent belongs to the latest request (or outer revision request).
  const request = artifactRequestText(prompt);
  if (unsupportedReportFileFormat(prompt)) return false;

  const artifact = String.raw`(?:pdf|downloadable\s+file|document|file)`;
  const action = String.raw`(?:create|make|generate|produce|prepare|write|compile|format|export|attach|send|deliver|return|provide|save|give)`;
  const negatedAction = new RegExp(
    String.raw`\b(?:do\s+not|don't|dont|never|without|no\s+need\s+to)\s+(?:\w+\s+){0,3}${action}\b[^.!?\n]{0,80}\b${artifact}\b`,
    "i",
  );
  const negatedArtifact = new RegExp(
    String.raw`\b(?:not\s+(?:(?:as|in)\s+)?(?:an?\s+)?|without\s+(?:an?\s+)?)${artifact}\b`,
    "i",
  );
  if (negatedAction.test(request) || negatedArtifact.test(request)) return false;

  return new RegExp(String.raw`\b${action}\b[^.!?\n]{0,80}\b${artifact}\b`, "i").test(request)
    || new RegExp(String.raw`\b(?:want|need|would\s+like)\b[^.!?\n]{0,50}\b${artifact}\b`, "i").test(request)
    || new RegExp(String.raw`\b(?:report|results?|findings?)\b[^.!?\n]{0,30}\bas\s+(?:a\s+)?${artifact}\b`, "i").test(request)
    || /\bdownloadable\s+(?:report|document|file)\b/i.test(request);
}
