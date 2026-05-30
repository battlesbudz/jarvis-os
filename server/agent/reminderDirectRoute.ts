import type { ToolResult } from "./types";
import { resolveTemporalExpression } from "../time/temporalContext";

export interface DirectReminderRequest {
  userId: string;
  text: string;
  channel?: string;
}

export interface DirectReminderResult {
  handled: boolean;
  reply?: string;
  toolResult?: ToolResult;
}

export interface ParsedReminderIntent {
  title: string;
  scheduledAt: string;
  temporal: ReturnType<typeof resolveTemporalExpression>;
}

function cleanReminderTitle(value: string): string {
  return value
    .split(/\bthis\s+is\b/i)[0]
    .replace(/\b(this is an? e2e test|this is a test|actually schedule the reminder|please|thanks?)\b/gi, "")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "")
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTime(text: string, matchedText: string): string {
  const index = text.toLowerCase().indexOf(matchedText.toLowerCase());
  if (index < 0) return text;
  return `${text.slice(0, index)} ${text.slice(index + matchedText.length)}`;
}

export function parseDirectReminderIntent(text: string): ParsedReminderIntent | null {
  const original = text.trim();
  if (!/\b(remind\s+me|set\s+(?:a\s+)?reminder|reminder)\b/i.test(original)) return null;

  const temporal = resolveTemporalExpression({ text: original });
  const matchedText = temporal.matchedText || temporal.label || "";
  if (temporal.kind === "none" || !matchedText) return null;
  const scheduledAt = temporal.targetAt || matchedText.replace(/^at\s+/i, "").trim();

  let titleSource = stripTime(original, matchedText)
    .replace(/\b(?:please\s+)?remind\s+me\b/gi, "")
    .replace(/\bset\s+(?:a\s+)?reminder\b/gi, "")
    .replace(/\bto\b/i, "")
    .replace(/\babout\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const toMatch = original.match(/\bto\s+(.+)$/i);
  const matchedIndex = original.toLowerCase().indexOf(matchedText.toLowerCase());
  if (toMatch && matchedIndex >= 0 && matchedIndex < toMatch.index!) {
    titleSource = toMatch[1];
  }

  const title = cleanReminderTitle(titleSource);
  if (!title || title.length < 3) return null;

  return {
    title: title[0].toUpperCase() + title.slice(1),
    scheduledAt,
    temporal,
  };
}

export async function handleDirectReminderRequest(input: DirectReminderRequest): Promise<DirectReminderResult> {
  const parsed = parseDirectReminderIntent(input.text);
  if (!parsed) return { handled: false };

  const { scheduleJarvisTaskTool } = await import("./tools/scheduleJarvisTask");
  const toolResult = await scheduleJarvisTaskTool.execute(
    {
      title: parsed.title,
      description: input.text,
      scheduledAt: parsed.scheduledAt,
    },
    {
      userId: input.userId,
      channel: input.channel || "appchat",
    },
  );

  return {
    handled: true,
    toolResult,
    reply: toolResult.ok
      ? toolResult.content
      : `I tried to schedule that reminder, but it failed: ${toolResult.content}`,
  };
}
