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
  return /\b(pdf|docx|word document|downloadable file)\b/i.test(prompt)
    || /\b(?:as|in|into)\s+(?:a\s+)?(?:document|file)\b/i.test(prompt)
    || /\bgive\s+(?:it|the report|this)\s+(?:back\s+)?(?:to me\s+)?as\s+(?:a\s+)?file\b/i.test(prompt);
}
