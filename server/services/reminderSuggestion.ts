export interface ReminderSuggestion {
  type: "reminder";
  title: string;
  category: string;
  priority: "medium";
  description: string;
  scheduledAt: string;
}

function titleCaseAction(raw: string): string {
  const trimmed = raw
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "Follow up";
}

export function extractReminderSuggestion(text: unknown): ReminderSuggestion | null {
  if (typeof text !== "string") return null;
  const source = text.trim();
  if (!/\b(remind\s+me|set\s+(a\s+)?reminder|reminder)\b/i.test(source)) return null;

  const timeMatch = source.match(/\bin\s+(\d+(?:\.\d+)?|an?|one)\s+(minute|minutes|hour|hours|day|days|week|weeks)\b/i)
    ?? source.match(/\btomorrow(?:\s+at\s+[^?.!,]+)?\b/i)
    ?? source.match(/\btoday\s+at\s+[^?.!,]+\b/i)
    ?? source.match(/\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+at\s+[^?.!,]+)?\b/i)
    ?? source.match(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i);
  if (!timeMatch) return null;

  const afterTo = source.match(/\b(?:remind\s+me|set\s+(?:a\s+)?reminder)\b[\s\S]*?\bto\s+(.+)$/i)?.[1];
  const taskText = (afterTo || source)
    .replace(timeMatch[0], "")
    .replace(/\b(can you|could you|please|set\s+(?:a\s+)?reminder|remind\s+me|reminder)\b/ig, "")
    .replace(/\b(to|for)\b\s*$/i, "")
    .trim();
  const title = titleCaseAction(taskText || "Follow up");

  return {
    type: "reminder",
    title,
    category: "personal",
    priority: "medium",
    description: `Reminder requested from coach chat: ${source}`,
    scheduledAt: timeMatch[0].trim(),
  };
}
