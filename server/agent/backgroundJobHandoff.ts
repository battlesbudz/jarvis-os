export interface BackgroundJobChatMessage {
  role?: string;
  content?: unknown;
}

const MAX_CONTEXT_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 6_000;
const MAX_MESSAGE_CHARS = 1_600;

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
    "Latest user request:",
    latest,
    "",
    "Resolve references such as ‘this’, ‘that’, and ‘it’ from the context above. Preserve the requested subject, scope, and output format. Do not treat speech-to-text artifacts as the research topic when the intended topic is clear from context.",
  ].join("\n");
}

/** Return true when the user explicitly requested a downloadable report file. */
export function requestsReportFile(prompt: string): boolean {
  // A contextual handoff contains earlier turns that may merely mention PDFs.
  // Creation intent belongs to the latest request, so evaluate that section
  // when present instead of treating format discussion in context as intent.
  const latestMarker = "Latest user request:";
  const request = prompt.includes(latestMarker)
    ? prompt.slice(prompt.lastIndexOf(latestMarker) + latestMarker.length).split("\n\n")[0]?.trim() || ""
    : prompt.trim();

  const artifact = String.raw`(?:pdf|docx|word\s+document|downloadable\s+file|document|file)`;
  const action = String.raw`(?:create|make|generate|produce|export|attach|send|deliver|return|provide|save|give)`;
  const negatedAction = new RegExp(
    String.raw`\b(?:do\s+not|don't|dont|never|without|no\s+need\s+to)\s+(?:\w+\s+){0,3}${action}\b[^.!?\n]{0,80}\b${artifact}\b`,
    "i",
  );
  if (negatedAction.test(request)) return false;

  return new RegExp(String.raw`\b${action}\b[^.!?\n]{0,80}\b${artifact}\b`, "i").test(request)
    || new RegExp(String.raw`\b(?:want|need|would\s+like)\b[^.!?\n]{0,50}\b${artifact}\b`, "i").test(request)
    || new RegExp(String.raw`\b(?:report|results?|findings?)\b[^.!?\n]{0,30}\bas\s+(?:a\s+)?${artifact}\b`, "i").test(request)
    || /\bdownloadable\s+(?:report|document|file)\b/i.test(request);
}
