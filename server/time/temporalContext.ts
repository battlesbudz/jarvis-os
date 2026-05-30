export type TemporalResolutionKind =
  | "none"
  | "relative_point"
  | "future_point"
  | "future_window"
  | "past_window"
  | "present_window";

export interface ResolveTemporalExpressionInput {
  text: string;
  now?: Date;
  timezone?: string;
}

export interface TemporalResolution {
  kind: TemporalResolutionKind;
  label: string | null;
  timezone: string;
  now: string;
  targetAt?: string;
  start?: string;
  end?: string;
  confidence: number;
  ambiguous: boolean;
  matchedText?: string;
}

const DEFAULT_TIMEZONE = "America/New_York";

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function safeTimezone(timezone?: string): string {
  const tz = timezone || process.env.DEFAULT_USER_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const hour = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: hour === 24 ? 0 : hour,
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMs(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  const first = new Date(utcGuess.getTime() - offsetMs(utcGuess, timezone));
  const secondOffset = offsetMs(first, timezone);
  return new Date(utcGuess.getTime() - secondOffset);
}

function addLocalDays(parts: ReturnType<typeof zonedParts>, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addLocalDateDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function monthWindow(timezone: string, year: number, month: number) {
  const start = zonedTimeToUtc(timezone, year, month, 1, 0, 0, 0, 0);
  const end = zonedTimeToUtc(timezone, month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1, 0, 0, 0, 0);
  return { start, end: new Date(end.getTime() - 1) };
}

function dayWindow(timezone: string, year: number, month: number, day: number) {
  const start = zonedTimeToUtc(timezone, year, month, day, 0, 0, 0, 0);
  const next = zonedTimeToUtc(timezone, year, month, day + 1, 0, 0, 0, 0);
  return { start, end: new Date(next.getTime() - 1) };
}

function weekWindow(timezone: string, parts: ReturnType<typeof zonedParts>, weekOffset: number) {
  const current = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  const weekday = current.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const startDate = addLocalDays(parts, mondayOffset + weekOffset * 7);
  const endStartDate = addLocalDateDays(startDate, 7);
  const start = zonedTimeToUtc(timezone, startDate.year, startDate.month, startDate.day);
  const endStart = zonedTimeToUtc(timezone, endStartDate.year, endStartDate.month, endStartDate.day);
  return { start, end: new Date(endStart.getTime() - 1) };
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const match = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function resultBase(kind: TemporalResolutionKind, input: { now: Date; timezone: string }): TemporalResolution {
  return {
    kind,
    label: null,
    timezone: input.timezone,
    now: input.now.toISOString(),
    confidence: 0,
    ambiguous: false,
  };
}

export function resolveTemporalExpression(input: ResolveTemporalExpressionInput): TemporalResolution {
  const text = String(input.text || "");
  const lower = text.toLowerCase();
  const timezone = safeTimezone(input.timezone);
  const now = input.now ?? new Date();
  const parts = zonedParts(now, timezone);
  const base = resultBase("none", { now, timezone });
  const clock = parseClock(lower);

  const relative = lower.match(/\bin\s+(\d+(?:\.\d+)?|an?|one)\s+(minutes?|hours?|days?|weeks?)\b/i);
  if (relative) {
    const rawAmount = relative[1].toLowerCase();
    const amount = rawAmount === "a" || rawAmount === "an" || rawAmount === "one" ? 1 : Number(rawAmount);
    const unit = relative[2].toLowerCase();
    const multiplier =
      unit.startsWith("minute") ? 60 * 1000 :
      unit.startsWith("hour") ? 60 * 60 * 1000 :
      unit.startsWith("day") ? 24 * 60 * 60 * 1000 :
      7 * 24 * 60 * 60 * 1000;
    return {
      ...base,
      kind: "relative_point",
      label: relative[0],
      matchedText: relative[0],
      targetAt: new Date(now.getTime() + amount * multiplier).toISOString(),
      confidence: 0.98,
    };
  }

  if (/\blater\b/.test(lower)) {
    return {
      ...base,
      kind: "relative_point",
      label: "later",
      matchedText: "later",
      targetAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      confidence: 0.45,
      ambiguous: true,
    };
  }

  if (/\blast month\b/.test(lower)) {
    const year = parts.month === 1 ? parts.year - 1 : parts.year;
    const month = parts.month === 1 ? 12 : parts.month - 1;
    const { start, end } = monthWindow(timezone, year, month);
    return { ...base, kind: "past_window", label: "last month", matchedText: "last month", start: start.toISOString(), end: end.toISOString(), confidence: 0.95 };
  }

  if (/\bnext month\b/.test(lower)) {
    const year = parts.month === 12 ? parts.year + 1 : parts.year;
    const month = parts.month === 12 ? 1 : parts.month + 1;
    const { start, end } = monthWindow(timezone, year, month);
    return { ...base, kind: "future_window", label: "next month", matchedText: "next month", start: start.toISOString(), end: end.toISOString(), targetAt: start.toISOString(), confidence: 0.92 };
  }

  if (/\blast week\b/.test(lower) || /\bnext week\b/.test(lower) || /\bthis week\b/.test(lower)) {
    const label = lower.match(/\b(last|next|this) week\b/i)![0].toLowerCase();
    const offset = label.startsWith("last") ? -1 : label.startsWith("next") ? 1 : 0;
    const { start, end } = weekWindow(timezone, parts, offset);
    return {
      ...base,
      kind: offset < 0 ? "past_window" : offset > 0 ? "future_window" : "present_window",
      label,
      matchedText: label,
      start: start.toISOString(),
      end: end.toISOString(),
      targetAt: offset >= 0 ? zonedTimeToUtc(timezone, zonedParts(start, timezone).year, zonedParts(start, timezone).month, zonedParts(start, timezone).day, 9).toISOString() : undefined,
      confidence: 0.9,
    };
  }

  const relativeDay = lower.match(/\b(today|tomorrow|tonight)\b/i);
  if (relativeDay) {
    const label = relativeDay[1].toLowerCase();
    const dayDelta = label === "today" || label === "tonight" ? 0 : 1;
    const targetDay = addLocalDays(parts, dayDelta);
    const time = clock ?? (label === "tonight" ? { hour: 20, minute: 0 } : { hour: 9, minute: 0 });
    const target = zonedTimeToUtc(timezone, targetDay.year, targetDay.month, targetDay.day, time.hour, time.minute);
    const { start, end } = dayWindow(timezone, targetDay.year, targetDay.month, targetDay.day);
    return {
      ...base,
      kind: "future_point",
      label,
      matchedText: relativeDay[0],
      targetAt: target.toISOString(),
      start: start.toISOString(),
      end: end.toISOString(),
      confidence: clock ? 0.95 : 0.75,
      ambiguous: !clock,
    };
  }

  const weekday = lower.match(/\b(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i);
  if (weekday) {
    const weekdayLabel = weekday[2].toLowerCase();
    const desired = WEEKDAYS[weekdayLabel];
    const current = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
    let delta = (desired - current + 7) % 7;
    if (delta === 0 || weekday[1]) delta += 7;
    const targetDay = addLocalDays(parts, delta);
    const time = clock ?? { hour: 9, minute: 0 };
    const target = zonedTimeToUtc(timezone, targetDay.year, targetDay.month, targetDay.day, time.hour, time.minute);
    const { start, end } = dayWindow(timezone, targetDay.year, targetDay.month, targetDay.day);
    return {
      ...base,
      kind: "future_point",
      label: weekday[0].toLowerCase(),
      matchedText: weekday[0],
      targetAt: target.toISOString(),
      start: start.toISOString(),
      end: end.toISOString(),
      confidence: clock ? 0.93 : 0.72,
      ambiguous: !clock,
    };
  }

  return base;
}
