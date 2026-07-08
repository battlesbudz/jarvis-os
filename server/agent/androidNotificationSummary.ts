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

const SHADE_STATUS_TEXT = new Set([
  "alarm",
  "at&t",
  "bluetooth on.",
  "bluetooth on",
  "connected",
  "expand",
  "nfc on",
  "notifications",
]);

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isNotificationTimeToken(value: string): boolean {
  return /^\d{1,2}:\d{2}\s?(?:AM|PM)?$/i.test(value);
}

function isShadeDateOrStatus(value: string): boolean {
  const text = value.trim();
  const lower = text.toLowerCase();
  return !text ||
    SHADE_STATUS_TEXT.has(lower) ||
    /^battery\s+\d+\s*percent\.?$/i.test(text) ||
    /^[a-z]+,\s+[a-z]+\s+\d{1,2}$/i.test(text) ||
    /^applications are using your location\.?$/i.test(text) ||
    /^[a-z0-9 .&'-]+,\s+(?:one|two|three|four|five)\s+bars\.?$/i.test(text);
}

function screenContextTextItems(screenContext: unknown): string[] {
  if (screenContext && typeof screenContext === "object" && !Array.isArray(screenContext)) {
    const data = screenContext as Record<string, unknown>;
    if (Array.isArray(data.text)) return data.text.map(normalizedText).filter(Boolean);
    if (Array.isArray(data.visibleText)) return data.visibleText.map(normalizedText).filter(Boolean);
  }
  const trimmed = normalizedText(screenContext);
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (Array.isArray(parsed.text)) return parsed.text.map(normalizedText).filter(Boolean);
    if (Array.isArray(parsed.visibleText)) return parsed.visibleText.map(normalizedText).filter(Boolean);
  } catch {
    // Fall through to line parsing below.
  }
  return trimmed
    .split(/\r?\n/)
    .map(normalizedText)
    .filter(Boolean);
}

function notificationEntryKey(entry: Pick<AndroidNotificationSummaryEntry, "app" | "title" | "text">): string {
  return `${entry.app}\u0000${entry.title}\u0000${entry.text}`.toLowerCase();
}

function titleFromShadeBody(value: string): { title: string; text: string } {
  const [title, ...rest] = value.split(/\s+-\s+|\s+\u2014\s+|\s+:\s+/);
  if (rest.length === 0) return { title: value, text: "" };
  return { title: title.trim(), text: rest.join(": ").trim() };
}

function appAndTitleFromDashLine(value: string): { app: string; title: string; text: string } | null {
  const match = value.match(/^([A-Za-z][A-Za-z0-9 .&'_()-]{1,40})\s+-\s+(.{2,180})$/);
  if (!match) return null;
  const app = match[1]?.trim() ?? "";
  const body = match[2]?.trim() ?? "";
  if (!app || !body || isShadeDateOrStatus(app)) return null;
  const { title, text } = titleFromShadeBody(body);
  return { app, title, text };
}

export function extractAndroidNotificationsFromScreenContext(screenContext: unknown): AndroidNotificationSummaryEntry[] {
  const items = screenContextTextItems(screenContext);
  const rawEntries: Array<{ app: string; title: string; text: string; ts?: number }> = [];

  for (const item of items) {
    const dashEntry = appAndTitleFromDashLine(item);
    if (dashEntry) rawEntries.push(dashEntry);
  }

  let lastApp = "";
  let lastTimeIndex = -1;
  for (let index = 0; index < items.length; index += 1) {
    const timeToken = items[index] ?? "";
    if (!isNotificationTimeToken(timeToken)) continue;

    const previousTimeIndex = lastTimeIndex;
    lastTimeIndex = index;
    const appCandidates = items
      .slice(previousTimeIndex + 1, index)
      .filter((candidate) => !isNotificationTimeToken(candidate) && !isShadeDateOrStatus(candidate));
    const app = appCandidates.length === 1 && lastApp
      ? lastApp
      : appCandidates[appCandidates.length - 1] ?? lastApp;

    let body = "";
    for (let bodyIndex = index + 1; bodyIndex < items.length; bodyIndex += 1) {
      const candidate = items[bodyIndex] ?? "";
      if (isNotificationTimeToken(candidate)) break;
      if (isShadeDateOrStatus(candidate)) continue;
      body = candidate;
      break;
    }

    if (!app || !body || isShadeDateOrStatus(app)) continue;
    const { title, text } = titleFromShadeBody(body);
    rawEntries.push({ app, title, text });
    lastApp = app;
  }

  const seen = new Set<string>();
  return normalizeAndroidNotifications(rawEntries)
    .filter((entry) => {
      const key = notificationEntryKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(entry.app && (entry.title || entry.text));
    })
    .slice(0, 20);
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
  if (/\b(?:spam risk|potential spam|suspected spam|scam likely|telemarketer|robocall)\b/i.test(haystack)) {
    return "normal";
  }
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

export function summarizeAndroidNotifications(
  notifications: unknown[],
  options: { includeAll?: boolean } = {},
): string {
  const entries = normalizeAndroidNotifications(notifications);
  if (entries.length === 0) {
    return "I checked your Android notifications. There are no current notifications.";
  }

  const important = entries.filter((entry) => entry.priority === "important");
  const lead = options.includeAll ? entries : important.length > 0 ? important : entries;
  const visibleLimit = options.includeAll ? entries.length : 3;
  const visible = lead.slice(0, visibleLimit).map(spokenNotification);
  const remainder = entries.length - visible.length;
  const prefix = options.includeAll
    ? `I checked your Android notifications and found ${entries.length}. They are`
    : important.length > 0
    ? `I checked your Android notifications. The important ${important.length === 1 ? "one is" : "ones are"}`
    : `I checked your Android notifications and found ${entries.length}. The latest ${entries.length === 1 ? "one is" : "ones are"}`;
  const suffix = remainder > 0
    ? options.includeAll
      ? ` There ${remainder === 1 ? "is" : "are"} ${remainder} more beyond this summary.`
      : ` There ${remainder === 1 ? "is" : "are"} ${remainder} more if you want me to read all of them.`
    : "";
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
  "all",
  "them",
  "those",
  "rest",
  "each",
  "every",
  "everything",
  "again",
  "previous",
  "that",
  "this",
  "it",
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesPhraseToken(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(phrase)}(?:$|[^a-z0-9])`, "i").test(haystack);
}

function scoreNotificationReference(entry: AndroidNotificationSummaryEntry, query: string): number {
  const normalizedQuery = query.toLowerCase();
  const normalizedApp = entry.app.toLowerCase();
  const appTerms = new Set(normalizedApp.split(/[^a-z0-9]+/i).filter(Boolean));
  const titleAndText = `${entry.title} ${entry.text}`.toLowerCase();
  const haystack = `${entry.app} ${entry.title} ${entry.text}`.toLowerCase();
  const haystackTerms = new Set(haystack.split(/[^a-z0-9]+/i).filter(Boolean));
  const tokens = normalizedQuery
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0 && !REFERENCE_STOPWORDS.has(token))
    .filter((token) => token.length >= 3 || haystackTerms.has(token));
  let score = 0;
  if (includesPhraseToken(normalizedQuery, normalizedApp)) score += 8;
  for (const token of tokens) {
    if (normalizedApp === token) score += 8;
    else if (appTerms.has(token)) score += 5;
    else if (titleAndText.includes(token)) score += 2;
  }
  return score;
}

function referencesSoleNotification(query: string): boolean {
  if (!/\b(?:read|repeat|open|launch|show|tap|go to)\b/i.test(query)) return false;
  return /\b(?:it|that|this)\b/i.test(query) ||
    /\b(?:the|that|this)\s+(?:notification|alert|one)\b/i.test(query);
}

export function resolveAndroidNotificationReference(
  notifications: unknown[],
  query: string,
): { notification: AndroidNotificationSummaryEntry; index: number } | null {
  const entries = normalizeAndroidNotifications(notifications);
  if (entries.length === 0) return null;

  const ordinal = ordinalReference(query);
  const scored = entries
    .map((notification, index) => ({ notification, index, score: scoreNotificationReference(notification, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ordinal !== null) {
    const orderedMatches = scored.length > 0
      ? scored.filter((item) => item.score === scored[0].score).sort((a, b) => a.index - b.index)
      : entries.map((notification, index) => ({ notification, index, score: 0 }));
    const matchIndex = ordinal === -1 ? orderedMatches.length - 1 : ordinal;
    const match = orderedMatches[matchIndex];
    return match ? { notification: match.notification, index: match.index } : null;
  }

  const best = scored[0];
  if (best) return { notification: best.notification, index: best.index };

  if (entries.length === 1 && referencesSoleNotification(query)) {
    return { notification: entries[0], index: 0 };
  }

  return null;
}

export function summarizeAndroidNotificationDetail(detail: unknown): string {
  const data = jsonObject(detail);
  const explicitSummary = typeof data.userFacingSummary === "string" ? data.userFacingSummary.trim() : "";
  if (explicitSummary) return explicitSummary;

  const source = typeof data.source === "string" ? data.source.trim() : "";
  const screenContext = typeof data.screenContext === "string" ? data.screenContext.trim() : "";
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  if (notifications.length > 0) {
    return summarizeAndroidNotifications(notifications);
  }

  if (Array.isArray(data.notifications) && notifications.length === 0) {
    if (source === "notification_shade_accessibility_tree") {
      if (screenContext) {
        const shadeNotifications = extractAndroidNotificationsFromScreenContext(screenContext);
        if (shadeNotifications.length > 0) return summarizeAndroidNotifications(shadeNotifications);
      }
      return "I read your notification shade through Android accessibility, but I could not find readable notification entries.";
    }
    return "I checked your Android notifications. There are no current notifications.";
  }

  if (screenContext) {
    const shadeNotifications = extractAndroidNotificationsFromScreenContext(screenContext);
    if (shadeNotifications.length > 0) {
      return summarizeAndroidNotifications(shadeNotifications);
    }
    return "I read your notification shade through Android accessibility, but I could not find readable notification entries.";
  }

  const error = typeof data.error === "string" ? data.error.trim() : "";
  if (error) return `I could not read your notifications: ${error}`;

  return "I checked your Android notifications, but the phone did not return readable notification details.";
}
