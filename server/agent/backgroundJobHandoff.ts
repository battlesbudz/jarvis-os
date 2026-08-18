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

function textContent(message: BackgroundJobChatMessage, maxChars?: number): string {
  if (typeof message.content !== "string") return "";
  const content = message.content.replace(/\s+/g, " ").trim();
  return maxChars === undefined ? content : content.slice(0, maxChars);
}

function isTersePdfFollowUp(text: string): boolean {
  return /^(?:an?\s+)?pdf(?:\s*,?\s*(?:please|version|copy))?[.!?]*$/i.test(text.trim());
}

function isContextDependentFollowUp(text: string): boolean {
  return /\b(this|that|these|those|it|previous|earlier|above|whole point|as before)\b/i.test(text)
    || /\bthe\s+(?:report|document|file|research|results?|findings?|task|job)\b/i.test(text)
    || /\b(?:the\s+)?same\b/i.test(text)
    || /^(yes|no|correct|exactly)\b/i.test(text.trim())
    || isTersePdfFollowUp(text);
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
  const contextMessages = messages
    .slice(Math.max(0, end - MAX_CONTEXT_MESSAGES), end)
    .filter((message) => message.role === "user" || message.role === "assistant");
  const referencedMessage = contextMessages.at(-1);
  const olderContext = contextMessages
    .slice(0, -1)
    .map((message) => {
      const content = textContent(message, MAX_MESSAGE_CHARS);
      if (!content) return "";
      return `${message.role === "assistant" ? "Assistant" : "User"}: ${content}`;
    })
    .filter(Boolean)
    .join("\n")
    .slice(-MAX_CONTEXT_CHARS)
    .trim();
  const referencedContent = referencedMessage ? textContent(referencedMessage) : "";
  const referencedContext = referencedContent
    ? `${referencedMessage?.role === "assistant" ? "Assistant" : "User"}: ${referencedContent}`
    : "";
  const context = [olderContext, referencedContext].filter(Boolean).join("\n");

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
    const format = String.raw`(?:pdf|markdown|downloadable\s+(?:report|document|file)|docx|word\s+document|csv|json|xlsx?|spreadsheet|pptx?|powerpoint|html|xml|rtf|tsv)`;
    const formatAction = new RegExp(
      String.raw`\b(?:create|make|generate|produce|prepare|write|compile|format|export|attach|send|deliver|return|provide|save|give|download|need|want|keep|preserve)\b[^.!?\n]{0,80}\b${format}\b`,
      "i",
    );
    const formatTarget = new RegExp(
      String.raw`\b(?:format|output|artifact|file|document|report|results?|findings?|it|this)\b[^.!?\n]{0,40}\b(?:as|in|to|into)\s+(?:an?\s+)?${format}\b`,
      "i",
    );
    const formatNegation = new RegExp(
      String.raw`(?:\bnot\s+(?:as|in)\s+(?:an?\s+)?pdf\b|\bwithout\s+(?:an?\s+)?(?:pdf|downloadable\s+(?:report|document|file))\b|\bno\s+(?:pdf\s+)?(?:output|file|document|report)\b|\b(?:do\s+not|don't|dont|never)\s+(?:make|create|generate|produce|prepare|write|format|export|attach|send|deliver|return|provide|save|give|download|keep|preserve)\b[^.!?\n]{0,40}\bpdf\b)`,
      "i",
    );
    if (formatAction.test(revision) || formatTarget.test(revision) || formatNegation.test(revision)) {
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

function explicitlyRequestsPdfOutput(request: string): boolean {
  const createPdf = /\b(?:create|make|generate|produce|prepare|compile|download|need|want)\b(?:\s+\w+){0,4}\s+(?:an?\s+)?pdf\b(?:\s+(?:report|memo|document|file|plan))?/i;
  const writePdf = /\bwrite\s+(?:me\s+)?(?:an?\s+)?pdf\s+(?:report|memo|document|plan)\b/i;
  const deliverPdf = /\b(?:give\s+me|return|provide(?:\s+me)?|deliver(?:\s+me)?|send(?:\s+me)?)\s+(?:an?\s+)?pdf\b(?:\s+(?:report|memo|document|file|plan))?/i;
  const transformToPdf = /\b(?:give|return|provide|deliver|export|save|format|attach|send|keep|preserve|change|switch|convert)\b(?:\s+\w+){0,8}\s+(?:as|in|to|into)\s+(?:an?\s+)?pdf\b/i;
  const artifactAsPdf = /\b(?:report|results?|findings?|memo|document|plan|it|this)\b(?:\s+\w+){0,5}\s+(?:as|in|to|into)\s+(?:an?\s+)?pdf\b/i;
  return createPdf.test(request)
    || writePdf.test(request)
    || deliverPdf.test(request)
    || transformToPdf.test(request)
    || artifactAsPdf.test(request);
}

function explicitlyRequestsGenericDownload(request: string): boolean {
  return /\bdownloadable\s+(?:report|document|file)\b/i.test(request)
    || /\b(?:create|make|generate|produce|prepare|compile|write|need|want)\s+(?:me\s+)?(?:an?\s+)?(?:report\s+file|document|file)\b/i.test(request)
    || /\bdownload\s+(?:me\s+)?(?:an?\s+)?(?:report|document|file)\b/i.test(request)
    || /\b(?:create|make|generate|produce|prepare|compile|attach|deliver|return|provide|save|give|download)\b(?:\s+\w+){0,6}\s+(?:an?\s+)?downloadable\s+(?:report|document|file)\b/i.test(request)
    || /\b(?:give|return|provide|deliver|send)\b(?:\s+\w+){0,8}\s+as\s+(?:an?\s+)?(?:document|file)\b/i.test(request)
    || /\b(?:report|results?|findings?)\b(?:\s+\w+){0,5}\s+as\s+(?:an?\s+)?(?:document|file)\b/i.test(request);
}

/** Identify an explicit requested file format that this renderer cannot create. */
export function unsupportedReportFileFormat(prompt: string): string | null {
  const request = artifactRequestText(prompt);
  const rawFormat = String.raw`(?:docx|word\s+document|csv|json|xlsx?|spreadsheet|pptx?|powerpoint|html|xml|rtf|tsv)`;
  const namedArtifact = String.raw`(?:docx(?:\s+file)?|word\s+document|csv\s+file|json\s+file|xlsx?(?:\s+(?:file|spreadsheet))?|spreadsheet|pptx?(?:\s+(?:file|presentation))?|powerpoint(?:\s+presentation)?|html\s+file|xml\s+file|rtf(?:\s+(?:file|document))?|tsv\s+file)`;
  const outputSyntax = new RegExp(
    String.raw`\b(?:export|return|provide|deliver|attach|send|give|save|format|convert|switch|change)\b(?:\s+\w+){0,8}\s+(?:as|in|to|into)\s+(?:an?\s+)?(${rawFormat})\b`,
    "i",
  );
  const directArtifact = new RegExp(
    String.raw`\b(?:create|make|generate|produce|prepare|compile|write|download|need|want)\s+(?:me\s+)?(?:an?\s+)?(${namedArtifact})\b`,
    "i",
  );
  const deliveryArtifact = new RegExp(
    String.raw`\b(?:give|return|provide|deliver|send)\s+(?:me\s+)?(?:an?\s+)?(${namedArtifact})\b`,
    "i",
  );
  const downloadableArtifact = new RegExp(String.raw`\bdownloadable\s+(${namedArtifact})\b`, "i");
  const explicitArtifactIntent = /\b(?:downloadable|file|document|report|results?|findings?)\b/i.test(request)
    || /\b(?:export|attach|save)\b/i.test(request);
  const output = (explicitArtifactIntent ? request.match(outputSyntax)?.[1] : undefined)
    || request.match(directArtifact)?.[1]
    || request.match(deliveryArtifact)?.[1]
    || request.match(downloadableArtifact)?.[1];
  return output?.match(UNSUPPORTED_REPORT_FORMAT)?.[1]?.toUpperCase() ?? null;
}

/** Return true when the user explicitly requested a downloadable PDF report file. */
export function requestsReportFile(prompt: string): boolean {
  // A contextual handoff contains earlier turns that may merely mention PDFs.
  // Creation intent belongs to the latest request (or outer revision request).
  const request = artifactRequestText(prompt);
  if (unsupportedReportFileFormat(prompt)) return false;

  const artifact = String.raw`(?:pdf|downloadable\s+file|document|file)`;
  const action = String.raw`(?:create|make|generate|produce|prepare|write|compile|format|export|attach|send|deliver|return|provide|save|give|download|need|want)`;
  const negatedAction = new RegExp(
    String.raw`\b(?:do\s+not|don't|dont|never|without|no\s+need\s+to)\s+(?:\w+\s+){0,3}${action}\b[^.!?\n]{0,80}\b${artifact}\b`,
    "i",
  );
  const negatedArtifact = new RegExp(
    String.raw`\b(?:not\s+(?:(?:as|in)\s+)?(?:an?\s+)?|without\s+(?:an?\s+)?)${artifact}\b`,
    "i",
  );
  if (negatedAction.test(request) || negatedArtifact.test(request)) return false;

  return explicitlyRequestsPdfOutput(request)
    || explicitlyRequestsGenericDownload(request)
    || (prompt.includes(LATEST_REQUEST_MARKER) && isTersePdfFollowUp(request));
}
