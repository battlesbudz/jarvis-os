import type { PhoneRuntimeOperation } from "@shared/schema";

const CONTINUATION_WORDS = /\b(?:again|continue|continued|continuing|resume|retry|re-try|finish|restart|carry\s+on|pick\s+(?:it|that|this)\s+up|go\s+back|try\s+(?:it|that|this))\b/i;
const REFERENCE_WORDS = /\b(?:it|that|this|thing|task|flow|one|what\s+we\s+were\s+doing|where\s+we\s+left\s+off)\b/i;
const TEMPORAL_WORDS = /\b(?:yesterday|earlier|last\s+(?:night|time|week)|before|previously)\b/i;
const STOP_WORDS = new Set([
  "a", "about", "again", "and", "app", "back", "can", "continue", "do", "doing", "for",
  "from", "get", "go", "hey", "i", "in", "it", "jarvis", "last", "me", "my", "of", "on",
  "flow", "operation", "open", "please", "profile", "resume", "retry", "search", "task", "that", "the", "thing", "this", "to",
  "try", "up", "was", "we", "were", "what", "with", "you", "yesterday",
]);

export function normalizePhoneRuntimeGoal(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function meaningfulTokens(text: string): Set<string> {
  return new Set(normalizePhoneRuntimeGoal(text).split(" ").filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

export function isPhoneRuntimeOperationReference(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 240) return false;
  return CONTINUATION_WORDS.test(value) ||
    (TEMPORAL_WORDS.test(value) && REFERENCE_WORDS.test(value));
}

/** True when the current turn supplies a fresh executable instruction rather
 * than only pointing back at an older operation. This protects a new request
 * such as “search Instagram for dogs again” from being replaced by an older
 * Instagram goal merely because both mention the same app. */
export function isConcretePhoneRuntimeCommand(text: string): boolean {
  return /\b(?:open|launch|search(?:ing)?|find|look\s+up|tap|press|type|enter|swipe|scroll|capture|take\s+(?:a\s+)?screenshot|navigate)\b/i.test(text);
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function selectReferencedPhoneRuntimeOperation(
  text: string,
  operations: PhoneRuntimeOperation[],
  now = new Date(),
): PhoneRuntimeOperation | null {
  if (!isPhoneRuntimeOperationReference(text)) return null;
  const eligible = operations.filter((operation) => operation.status === "active" || operation.status === "blocked");
  if (eligible.length === 0) return null;

  const referenceTokens = meaningfulTokens(text);
  const hasSpecificTokens = referenceTokens.size > 0;
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const asksYesterday = /\byesterday\b/i.test(text);

  const scored = eligible.map((operation, index) => {
    const state = operation.state ?? {};
    const candidateTokens = meaningfulTokens(`${operation.goal} ${state.appTarget ?? ""}`);
    let overlap = 0;
    for (const token of referenceTokens) if (candidateTokens.has(token)) overlap += 1;
    let score = overlap * 30 + Math.max(0, 12 - index);
    if (asksYesterday) {
      score += utcDayKey(operation.updatedAt) === utcDayKey(yesterday) ? 45 : -12;
    }
    return { operation, score, overlap };
  }).sort((a, b) => b.score - a.score || b.operation.updatedAt.getTime() - a.operation.updatedAt.getTime());

  const best = scored[0];
  if (hasSpecificTokens && best.overlap === 0) return null;
  const runnerUp = scored[1];
  if (hasSpecificTokens && runnerUp && runnerUp.overlap === best.overlap && best.score - runnerUp.score < 15) return null;
  return best.operation;
}
