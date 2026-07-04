function jsonObject(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

export interface AndroidNotificationSummaryEntry {
  app: string;
  title: string;
  text: string;
  age: string;
  priority: "important" | "normal";
}

function relativeNotificationAge(ts: unknown): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
  const diffMs = Math.max(0, Date.now() - ts);
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function receivedAtAge(receivedAt: unknown): string {
  if (typeof receivedAt !== "string" || !receivedAt.trim()) return "";
  const parsed = Date.parse(receivedAt);
  return Number.isFinite(parsed) ? relativeNotificationAge(parsed) : "";
}

function notificationPriority(app: string, title: string, text: string): AndroidNotificationSummaryEntry["priority"] {
  const haystack = `${app} ${title} ${text}`;
  return /\b(bank|budget|card|charge|fraud|invoice|payment|security|verification|code|due|overdue|limit|deadline|calendar|meeting|missed call|voicemail|urgent|alert)\b/i.test(haystack)
    ? "important"
    : "normal";
}

export function normalizeAndroidNotifications(notifications: unknown[]): AndroidNotificationSummaryEntry[] {
  return notifications.map((notification) => {
    const item = jsonObject(notification);
    const app = String(item.app || item.pkg || "Unknown app").trim() || "Unknown app";
    const title = String(item.title || "").trim();
    const text = String(item.text || "").trim();
    const age = relativeNotificationAge(item.ts) || receivedAtAge(item.receivedAt);
    return {
      app,
      title,
      text,
      age,
      priority: notificationPriority(app, title, text),
    };
  });
}

function spokenNotification(entry: AndroidNotificationSummaryEntry): string {
  const title = entry.title || "(no title)";
  const age = entry.age ? ` ${entry.age}` : "";
  const body = entry.text && entry.text !== entry.title
    ? ` (${entry.text.length > 90 ? `${entry.text.slice(0, 87).trim()}...` : entry.text})`
    : "";
  return `${entry.app}${age}: ${title}${body}`;
}

export function summarizeAndroidNotifications(notifications: unknown[]): string {
  const entries = normalizeAndroidNotifications(notifications);
  if (entries.length === 0) {
    return "I checked your Android notifications. There are no current notifications.";
  }

  const important = entries.filter((entry) => entry.priority === "important");
  const lead = important.length > 0 ? important : entries;
  const visible = lead.slice(0, 3).map(spokenNotification);
  const remainder = entries.length - visible.length;
  const prefix = important.length > 0
    ? `I checked your Android notifications. The important ${important.length === 1 ? "one is" : "ones are"}`
    : `I checked your Android notifications and found ${entries.length}. The latest ${entries.length === 1 ? "one is" : "ones are"}`;
  const suffix = remainder > 0 ? ` There ${remainder === 1 ? "is" : "are"} ${remainder} more if you want me to read all of them.` : "";
  return `${prefix}: ${visible.join("; ")}.${suffix}`;
}

export function formatAndroidNotificationsInOrder(notifications: unknown[]): string {
  const entries = normalizeAndroidNotifications(notifications);
  if (entries.length === 0) return "There are no current notifications to read.";
  return entries.map((entry, index) => {
    const message = [entry.title, entry.text].filter(Boolean).join(": ") || "(no notification text)";
    return `${index + 1}. ${entry.app}${entry.age ? ` (${entry.age})` : ""}: ${message}`;
  }).join("\n");
}

function ordinalReference(query: string): number | null {
  if (/\bfirst\b|\b1st\b/i.test(query)) return 0;
  if (/\bsecond\b|\b2nd\b/i.test(query)) return 1;
  if (/\bthird\b|\b3rd\b/i.test(query)) return 2;
  if (/\blast\b/i.test(query)) return -1;
  return null;
}

const REFERENCE_STOPWORDS = new Set([
  "the",
  "one",
  "ones",
  "that",
  "this",
  "open",
  "read",
  "show",
  "notification",
  "notifications",
  "first",
  "1st",
  "second",
  "2nd",
  "third",
  "3rd",
  "last",
]);

function scoreNotificationReference(entry: AndroidNotificationSummaryEntry, query: string): number {
  const normalizedQuery = query.toLowerCase();
  const haystack = `${entry.app} ${entry.title} ${entry.text}`.toLowerCase();
  const tokens = normalizedQuery
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3 && !REFERENCE_STOPWORDS.has(token));
  let score = 0;
  for (const token of tokens) {
    if (entry.app.toLowerCase() === token) score += 5;
    else if (haystack.includes(token)) score += 2;
  }
  return score;
}

export function resolveAndroidNotificationReference(
  notifications: unknown[],
  query: string,
): { notification: AndroidNotificationSummaryEntry; index: number } | null {
  const entries = normalizeAndroidNotifications(notifications);
  if (entries.length === 0) return null;

  const scored = entries
    .map((notification, index) => ({ notification, index, score: scoreNotificationReference(notification, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const ordinal = ordinalReference(query);
  if (ordinal !== null && scored.length > 0) {
    const orderedMatches = [...scored].sort((a, b) => a.index - b.index);
    const matchIndex = ordinal === -1 ? orderedMatches.length - 1 : ordinal;
    const match = orderedMatches[matchIndex];
    return match ? { notification: match.notification, index: match.index } : null;
  }

  const best = scored[0];
  if (best) return { notification: best.notification, index: best.index };

  if (ordinal !== null) {
    const index = ordinal === -1 ? entries.length - 1 : ordinal;
    const notification = entries[index];
    return notification ? { notification, index } : null;
  }

  return null;
}

export function summarizeAndroidNotificationDetail(detail: unknown): string {
  const data = jsonObject(detail);
  const explicitSummary = typeof data.userFacingSummary === "string" ? data.userFacingSummary.trim() : "";
  if (explicitSummary) return explicitSummary;

  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  if (notifications.length > 0) {
    return summarizeAndroidNotifications(notifications);
  }

  if (Array.isArray(data.notifications) && notifications.length === 0) {
    return "I checked your Android notifications. There are no current notifications.";
  }

  const screenContext = typeof data.screenContext === "string" ? data.screenContext.trim() : "";
  if (screenContext) {
    return `I read your notification shade through Android accessibility. Here's what I can see:\n${screenContext}`;
  }

  const error = typeof data.error === "string" ? data.error.trim() : "";
  if (error) return `I could not read your notifications: ${error}`;

  return "I checked your Android notifications, but the phone did not return readable notification details.";
}
