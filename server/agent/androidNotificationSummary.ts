function jsonObject(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
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

function notificationLine(notification: unknown, index: number): string {
  const item = jsonObject(notification);
  const app = String(item.app || item.pkg || "Unknown app").trim();
  const title = String(item.title || "").trim();
  const text = String(item.text || "").trim();
  const age = relativeNotificationAge(item.ts);
  const message = [title, text].filter(Boolean).join(": ") || "(no notification text)";
  return `${index + 1}. ${app}${age ? ` (${age})` : ""}: ${message}`;
}

export function summarizeAndroidNotificationDetail(detail: unknown): string {
  const data = jsonObject(detail);
  const explicitSummary = typeof data.userFacingSummary === "string" ? data.userFacingSummary.trim() : "";
  if (explicitSummary) return explicitSummary;

  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  if (notifications.length > 0) {
    return [
      `I checked your Android notifications and found ${notifications.length}:`,
      ...notifications.map(notificationLine),
    ].join("\n");
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
