/**
 * Discord Channel Schedules — Phase 1
 * Manages recurring automated research reports posted to Discord channels.
 */

import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { discordChannelSchedules } from "@shared/schema";
import { runCoachAgent } from "../channels/coachAgent";
import { postToDiscordChannel } from "./manager";

// ── Built-in prompt templates ─────────────────────────────────────────────────

export const SCHEDULE_TEMPLATES = {
  stockResearch: {
    label: "AI Stock Research",
    channelName: "stock-research",
    cronExpression: "0 7 * * 1,2,3,4,5",
    prompt:
      "Research the top 8 AI infrastructure stocks with competitive moats — chips, energy, memory, GPUs, and supply chain companies that stand to benefit most from the AI buildout over the next decade. For each stock: company name, ticker symbol, 1-sentence investment thesis, and the single most important news item from the last 24 hours. Format clearly with sections per company. Keep the report concise and actionable.",
    triggerPhrases: ["stock research", "ai stocks", "stock report", "market research", "ai infrastructure stocks"],
  },
  competitorYoutube: {
    label: "Competitor YouTube Research",
    channelName: "competitor-research",
    cronExpression: "0 8 * * *",
    prompt:
      "Search YouTube for [TOPIC] videos published in the last 5 days. Rank by total view count (highest first). List the top 15 results in a table: rank | title | channel | total views | days since posted. Add a brief note for any video standing out as unusually high-performing. Keep the report tight and scannable.",
    triggerPhrases: ["competitor youtube", "youtube research", "competitor research", "youtube competitor"],
  },
} as const;

/**
 * Try to match a user's label/phrase against a built-in template.
 * Returns the template if matched, or null.
 */
export function detectTemplate(
  input: string,
): (typeof SCHEDULE_TEMPLATES)[keyof typeof SCHEDULE_TEMPLATES] | null {
  const lower = input.toLowerCase();
  for (const tpl of Object.values(SCHEDULE_TEMPLATES)) {
    if (tpl.triggerPhrases.some((p) => lower.includes(p))) {
      return tpl;
    }
  }
  return null;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function createSchedule(
  userId: string,
  params: {
    channelName: string;
    label: string;
    cronExpression: string;
    prompt: string;
    guildId?: string;
    channelId?: string;
    pipelineNext?: string;
  },
) {
  const [row] = await db
    .insert(discordChannelSchedules)
    .values({
      userId,
      channelName: params.channelName,
      label: params.label,
      cronExpression: params.cronExpression,
      prompt: params.prompt,
      guildId: params.guildId,
      channelId: params.channelId,
      pipelineNext: params.pipelineNext,
      enabled: 1,
    })
    .returning();
  return row;
}

export async function listSchedules(userId: string) {
  return db
    .select()
    .from(discordChannelSchedules)
    .where(eq(discordChannelSchedules.userId, userId));
}

export async function getSchedule(id: string) {
  const rows = await db
    .select()
    .from(discordChannelSchedules)
    .where(eq(discordChannelSchedules.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSchedule(userId: string, id: string) {
  await db
    .delete(discordChannelSchedules)
    .where(
      and(
        eq(discordChannelSchedules.id, id),
        eq(discordChannelSchedules.userId, userId),
      ),
    );
}

export async function toggleSchedule(userId: string, id: string, enabled: boolean) {
  await db
    .update(discordChannelSchedules)
    .set({ enabled: enabled ? 1 : 0 })
    .where(
      and(
        eq(discordChannelSchedules.id, id),
        eq(discordChannelSchedules.userId, userId),
      ),
    );
}

// ── Runner ──────────────────────────────────────────────────────────────────

/**
 * Execute a schedule: run the prompt via the coach agent, post the result
 * to the configured Discord channel, update lastRun/lastOutput, and trigger
 * pipelineNext if set.
 */
export async function runSchedule(id: string, previousOutput?: string): Promise<void> {
  const schedule = await getSchedule(id);
  if (!schedule) {
    console.warn(`[DiscordSchedules] schedule ${id} not found`);
    return;
  }
  if (!schedule.enabled) {
    console.log(`[DiscordSchedules] schedule ${id} is disabled — skipping`);
    return;
  }

  console.log(`[DiscordSchedules] Running schedule "${schedule.label}" for user ${schedule.userId}`);

  // Replace {{previousOutput}} placeholder with context from previous pipeline stage
  let prompt = schedule.prompt;
  if (previousOutput) {
    prompt = prompt.replace(/\{\{previousOutput\}\}/g, previousOutput);
  }

  let result = "";
  try {
    const agentResult = await runCoachAgent({
      userId: schedule.userId,
      userText: prompt,
      channelName: "Discord Schedule Runner",
    });
    result = agentResult.reply || "";
  } catch (err) {
    console.error(`[DiscordSchedules] runCoachAgent failed for schedule ${id}:`, err);
    result = `⚠️ Schedule run failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Post to the Discord channel
  const header = `📊 **${schedule.label}**\n`;
  const posted = await postToDiscordChannel(
    schedule.userId,
    schedule.channelName,
    schedule.channelId ?? null,
    header + result,
  );

  if (!posted) {
    console.warn(`[DiscordSchedules] Failed to post schedule ${id} to channel ${schedule.channelName}`);
  }

  // Update lastRun and lastOutput
  await db
    .update(discordChannelSchedules)
    .set({ lastRun: new Date(), lastOutput: result.slice(0, 5000) })
    .where(eq(discordChannelSchedules.id, id));

  // Chain to next pipeline stage
  if (schedule.pipelineNext) {
    console.log(`[DiscordSchedules] Chaining to pipeline stage ${schedule.pipelineNext}`);
    // Small delay to avoid rate limits
    setTimeout(() => {
      runSchedule(schedule.pipelineNext!, result).catch((err) => {
        console.error(`[DiscordSchedules] Pipeline chain failed for ${schedule.pipelineNext}:`, err);
      });
    }, 500);
  }
}

// ── Cron matching ────────────────────────────────────────────────────────────

/**
 * Minimal cron matcher. Supports standard 5-field cron:
 *   minute hour day-of-month month day-of-week
 * Wildcards (*) and exact values supported. No ranges or step values.
 */
export function matchesCron(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hr, dom, mon, dow] = parts;

  const matches = (field: string, value: number): boolean => {
    if (field === "*") return true;
    // Support comma-separated values
    const options = field.split(",").map((s) => parseInt(s, 10));
    return options.includes(value);
  };

  return (
    matches(min, date.getMinutes()) &&
    matches(hr, date.getHours()) &&
    matches(dom, date.getDate()) &&
    matches(mon, date.getMonth() + 1) &&
    matches(dow, date.getDay())
  );
}

/**
 * Convert natural language schedule to a cron expression.
 * Examples: "every morning at 7am" → "0 7 * * *"
 */
export function parseCronExpression(natural: string): string {
  const lower = natural.toLowerCase();

  // Specific time patterns
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  let hour = 9;
  let minute = 0;
  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (timeMatch[3] === "pm" && hour < 12) hour += 12;
    if (timeMatch[3] === "am" && hour === 12) hour = 0;
  }

  // Day-of-week patterns
  if (lower.includes("monday")) return `${minute} ${hour} * * 1`;
  if (lower.includes("tuesday")) return `${minute} ${hour} * * 2`;
  if (lower.includes("wednesday")) return `${minute} ${hour} * * 3`;
  if (lower.includes("thursday")) return `${minute} ${hour} * * 4`;
  if (lower.includes("friday")) return `${minute} ${hour} * * 5`;
  if (lower.includes("saturday")) return `${minute} ${hour} * * 6`;
  if (lower.includes("sunday")) return `${minute} ${hour} * * 0`;
  if (lower.includes("weekday")) return `${minute} ${hour} * * 1-5`;
  if (lower.includes("weekend")) return `${minute} ${hour} * * 0,6`;

  // "every hour" / "hourly"
  if (lower.includes("every hour") || lower.includes("hourly")) return `${minute} * * * *`;

  // "every day" / "daily" / "every morning" / "every evening" / "every night"
  return `${minute} ${hour} * * *`;
}

// ── Next run calculator ──────────────────────────────────────────────────────

/**
 * Returns the next Date when the given cron expression will match,
 * scanning up to 7 days ahead.
 */
export function nextRunTime(cron: string): Date | null {
  const now = new Date();
  const check = new Date(now);
  // Start from the next minute
  check.setSeconds(0, 0);
  check.setMinutes(check.getMinutes() + 1);

  for (let i = 0; i < 60 * 24 * 7; i++) {
    if (matchesCron(cron, check)) return new Date(check);
    check.setMinutes(check.getMinutes() + 1);
  }
  return null;
}
