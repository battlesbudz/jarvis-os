import {
  formatAndroidNotificationsInOrder,
  resolveAndroidNotificationReference,
  summarizeAndroidNotifications,
  type AndroidNotificationSummaryEntry,
} from "./androidNotificationSummary";

export type AndroidNotificationFollowUp =
  | { kind: "open"; notification: AndroidNotificationSummaryEntry; index: number }
  | { kind: "read"; notification: AndroidNotificationSummaryEntry; index: number; response: string }
  | { kind: "read_all"; response: string }
  | { kind: "summary"; response: string };

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function wantsOrderedNotificationRead(transcript: string): boolean {
  return /\b(?:read|list|show)\b\s+(?:me\s+)?(?:all|everything|each|every one)(?:\s+of)?\s+(?:them|those|these|(?:my\s+)?notifications?|(?:my\s+)?alerts?)\b/i.test(transcript) ||
    /\b(?:read|list|show)\b\s+(?:me\s+)?(?:the\s+)?rest\b/i.test(transcript) ||
    /\b(?:read|list|show)\b\s+(?:me\s+)?them\s+all\b/i.test(transcript) ||
    /\b(?:all|every|each)\s+(?:notifications?|alerts?)\b/i.test(transcript);
}

function notificationWorkingContextClauses(transcript: string): string[] {
  return compactText(transcript)
    .split(/[.!?;,]|\b(?:but|then)\b|\band\s+(?=(?:(?:don't|dont|do not|never|stop|didn't|did not|not|no)\s+)?(?:open|launch|start|read|show|check|summari[sz]e|repeat|tell|tap|go)\b)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function clauseIsNegated(clause: string): boolean {
  return /\b(?:don't|dont|do not|never|stop|didn't|did not|not|no)\b/i.test(clause);
}

function notificationReferenceTerms(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean));
}

function escapedNotificationReference(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function notificationReferenceHasPhrase(value: string, phrase: string): boolean {
  if (!phrase) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapedNotificationReference(phrase)}(?:$|[^a-z0-9])`, "i").test(value);
}

function notificationReferenceNamesApp(transcript: string, notification: AndroidNotificationSummaryEntry): boolean {
  const appName = compactText(notification.app).toLowerCase();
  if (!appName) return false;
  const normalizedTranscript = transcript.toLowerCase();
  if (notificationReferenceHasPhrase(normalizedTranscript, appName)) return true;
  const transcriptTerms = notificationReferenceTerms(transcript);
  return Array.from(notificationReferenceTerms(appName)).some((term) => transcriptTerms.has(term));
}

function hasNotificationReferent(transcript: string): boolean {
  return /\b(?:one|ones|notification|notifications|alert|alerts)\b/i.test(transcript) ||
    /\b(?:first|1st|second|2nd|third|3rd|last)\b/i.test(transcript);
}

function wantsNotificationReferenceOpen(transcript: string, notifications: unknown[]): boolean {
  if (!/\b(?:open|launch|show|tap|go to)\b/i.test(transcript)) return false;
  const match = resolveAndroidNotificationReference(notifications, transcript);
  if (!match) return false;
  return hasNotificationReferent(transcript) || notificationReferenceNamesApp(transcript, match.notification);
}

function wantsNotificationReferenceRead(transcript: string, notifications: unknown[]): boolean {
  return /\b(?:read|repeat)\b/i.test(transcript) &&
    resolveAndroidNotificationReference(notifications, transcript) !== null;
}

function wantsNotificationSummaryFollowUp(transcript: string): boolean {
  if (!/\b(?:summari[sz]e|recap|what were|what are|tell me about|go over)\b/i.test(transcript)) {
    return false;
  }
  return /\b(?:my|current|recent)\s+(?:notifications?|alerts?)\b/i.test(transcript) ||
    /\b(?:notifications?|alerts?)\b[\s\S]{0,32}\b(?:again|from before|you just read)\b/i.test(transcript) ||
    /\b(?:that|those|these|them|last|previous|again)\b/i.test(transcript);
}

function negatedNotificationCancellationAction(
  clause: string,
  notifications: unknown[],
): "open" | "read" | null {
  if (!clauseIsNegated(clause)) return null;
  const negatesOpen = /\b(?:open|launch|show|tap|go to)\b/i.test(clause);
  const negatesRead = /\b(?:read|repeat)\b/i.test(clause);
  if (!negatesOpen && !negatesRead) return null;
  if (!/\b(?:it|that|this|one)\b/i.test(clause)) return null;
  if (resolveAndroidNotificationReference(notifications, clause) !== null) return null;
  return negatesOpen ? "open" : "read";
}

function negatedPronounCancelsEarlierAction(
  clauses: string[],
  negatedClauseIndex: number,
  action: "open" | "read",
  notifications: unknown[],
): boolean {
  const earlierClauses = clauses.slice(0, negatedClauseIndex);
  return earlierClauses.some((clause) => {
    if (clauseIsNegated(clause)) return false;
    return action === "open"
      ? wantsNotificationReferenceOpen(clause, notifications)
      : wantsNotificationReferenceRead(clause, notifications);
  });
}

function negatedReferenceCancelsEarlierClause(
  clauses: string[],
  negatedClauseIndex: number,
  negatedClause: string,
  notifications: unknown[],
  action: "open" | "read",
): boolean {
  const negatedMatch = resolveAndroidNotificationReference(notifications, negatedClause);
  if (!negatedMatch) return false;
  const earlierClauses = clauses.slice(0, negatedClauseIndex);
  return earlierClauses.some((clause) => {
    if (clauseIsNegated(clause)) return false;
    const hasSameAction = action === "open"
      ? wantsNotificationReferenceOpen(clause, notifications)
      : wantsNotificationReferenceRead(clause, notifications);
    if (!hasSameAction) return false;
    const earlierMatch = resolveAndroidNotificationReference(notifications, clause);
    return earlierMatch?.index === negatedMatch.index;
  });
}

function notificationReferenceText(notification: AndroidNotificationSummaryEntry): string {
  const message = [notification.title, notification.text].filter(Boolean).join(": ") || "(no notification text)";
  return `${notification.app}: ${message}`;
}

function activeNotificationWorkingContextRequest(
  transcript: string,
  notifications: unknown[],
): { clause: string; orderedRead: boolean; referenceOpen: boolean; referenceRead: boolean; summaryFollowUp: boolean } | null {
  const clauses = notificationWorkingContextClauses(transcript);
  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    const negatedPronounAction = negatedNotificationCancellationAction(clause, notifications);
    if (negatedPronounAction) {
      if (negatedPronounCancelsEarlierAction(clauses, index, negatedPronounAction, notifications)) {
        return null;
      }
      continue;
    }
    const orderedRead = wantsOrderedNotificationRead(clause);
    const referenceOpen = wantsNotificationReferenceOpen(clause, notifications);
    const referenceRead = wantsNotificationReferenceRead(clause, notifications);
    const summaryFollowUp = wantsNotificationSummaryFollowUp(clause);
    if (!orderedRead && !referenceOpen && !referenceRead && !summaryFollowUp) continue;
    if (clauseIsNegated(clause)) {
      if (
        (referenceOpen && negatedReferenceCancelsEarlierClause(clauses, index, clause, notifications, "open")) ||
        (referenceRead && negatedReferenceCancelsEarlierClause(clauses, index, clause, notifications, "read"))
      ) {
        return null;
      }
      continue;
    }
    return { clause, orderedRead, referenceOpen, referenceRead, summaryFollowUp };
  }
  return null;
}

export function resolveAndroidNotificationFollowUp(
  transcript: string,
  notifications: unknown[],
): AndroidNotificationFollowUp | null {
  const request = activeNotificationWorkingContextRequest(transcript, notifications);
  if (!request) return null;

  if (request.orderedRead) {
    return { kind: "read_all", response: formatAndroidNotificationsInOrder(notifications) };
  }

  if (request.referenceOpen) {
    const match = resolveAndroidNotificationReference(notifications, request.clause);
    if (!match) return null;
    return { kind: "open", notification: match.notification, index: match.index };
  }

  if (request.referenceRead) {
    const match = resolveAndroidNotificationReference(notifications, request.clause);
    if (!match) return null;
    return {
      kind: "read",
      notification: match.notification,
      index: match.index,
      response: notificationReferenceText(match.notification),
    };
  }

  return { kind: "summary", response: summarizeAndroidNotifications(notifications) };
}
