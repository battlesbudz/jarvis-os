/**
 * Discord OS — Phase 1: Scheduled Channel Reports
 *
 * Stores and runs recurring Jarvis research reports that post to specific
 * Discord channels on a cron-style schedule (hour + minute + days-of-week).
 */

import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { discordChannelSchedules } from "@shared/schema";
import { runCoachAgent } from "../channels/coachAgent";
import { postToDiscordChannelById } from "./manager";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleParams {
  guildId: string;
  channelId: string;
  channelName: string;
  label: string;
  cronHour: number;
  cronMinute: number;
  daysOfWeek?: string;
  prompt: string;
}

export interface ScheduleRow {
  id: string;
  userId: string;
  guildId: string;
  channelId: string;
  channelName: string;
  label: string;
  cronHour: number;
  cronMinute: number;
  daysOfWeek: string;
  prompt: string;
  pipelineNext: string | null;
  lastRun: Date | null;
  lastOutput: string | null;
  enabled: string;
  createdAt: Date;
}

// ── Built-in prompt templates ─────────────────────────────────────────────────

export const SCHEDULE_TEMPLATES = {
  stockResearch: {
    label: "AI Stock Research",
    cronHour: 7,
    cronMinute: 0,
    prompt:
      "Research the top 8 AI infrastructure stocks with competitive moats — chips, energy, memory, GPUs, and supply chain companies that stand to benefit most from the AI buildout over the next decade. For each stock: company name, ticker symbol, 1-sentence investment thesis, and the single most important news item from the last 24 hours. Format clearly with sections per company. Keep the report concise and actionable.",
  },
  competitorYoutube: {
    label: "Competitor YouTube Research",
    cronHour: 8,
    cronMinute: 0,
    prompt:
      "Search YouTube for [TOPIC] videos published in the last 5 days. Rank by total view count (highest first). List the top 15 results in a table: rank | title | channel | total views | days since posted. Add a brief note for any video standing out as unusually high-performing. Keep the report tight and scannable.",
  },
} as const;

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function createSchedule(userId: string, params: ScheduleParams): Promise<ScheduleRow> {
  const [row] = await db
    .insert(discordChannelSchedules)
    .values({
      userId,
      guildId: params.guildId,
      channelId: params.channelId,
      channelName: params.channelName,
      label: params.label,
      cronHour: params.cronHour,
      cronMinute: params.cronMinute,
      daysOfWeek: params.daysOfWeek ?? "0,1,2,3,4,5,6",
      prompt: params.prompt,
      enabled: "true",
    })
    .returning();
  return row as ScheduleRow;
}

export async function listSchedules(userId: string): Promise<ScheduleRow[]> {
  const rows = await db
    .select()
    .from(discordChannelSchedules)
    .where(eq(discordChannelSchedules.userId, userId));
  return rows as ScheduleRow[];
}

export async function getSchedule(id: string): Promise<ScheduleRow | null> {
  const rows = await db
    .select()
    .from(discordChannelSchedules)
    .where(eq(discordChannelSchedules.id, id))
    .limit(1);
  return (rows[0] as ScheduleRow) ?? null;
}

export async function deleteSchedule(userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(discordChannelSchedules)
    .where(and(eq(discordChannelSchedules.id, id), eq(discordChannelSchedules.userId, userId)));
  return (result.rowCount ?? 0) > 0;
}

export async function updateScheduleEnabled(userId: string, id: string, enabled: boolean): Promise<void> {
  await db
    .update(discordChannelSchedules)
    .set({ enabled: enabled ? "true" : "false" })
    .where(and(eq(discordChannelSchedules.id, id), eq(discordChannelSchedules.userId, userId)));
}

export async function updateLastRun(id: string, output: string): Promise<void> {
  await db
    .update(discordChannelSchedules)
    .set({ lastRun: new Date(), lastOutput: output })
    .where(eq(discordChannelSchedules.id, id));
}

// ── Schedule runner ───────────────────────────────────────────────────────────

/**
 * Execute a scheduled report: run the research prompt through the coach agent
 * and post the result to the configured Discord channel.
 */
export async function runSchedule(id: string): Promise<void> {
  const schedule = await getSchedule(id);
  if (!schedule || schedule.enabled !== "true") return;

  const channelLabel = `Discord #${schedule.channelName}`;
  console.log(`[DiscordScheduler] Running schedule "${schedule.label}" for user ${schedule.userId}`);

  try {
    const result = await runCoachAgent({
      userId: schedule.userId,
      userText: schedule.prompt,
      channelName: channelLabel,
    });

    const reply = result.reply?.trim() || "(No output generated)";

    const header = `**📊 ${schedule.label}**\n`;
    const fullMessage = header + reply;

    const posted = await postToDiscordChannelById(schedule.userId, schedule.channelId, fullMessage);
    if (!posted) {
      console.error(`[DiscordScheduler] Failed to post to channel ${schedule.channelId} for schedule ${id}`);
    }

    await updateLastRun(id, reply);
    console.log(`[DiscordScheduler] Schedule "${schedule.label}" completed — posted ${fullMessage.length} chars`);
  } catch (err) {
    console.error(`[DiscordScheduler] Schedule "${schedule.label}" (${id}) failed:`, err);
  }
}

// ── Due-schedule query ────────────────────────────────────────────────────────

/**
 * Returns schedules that are due right now (matching hour + minute + day-of-week)
 * and haven't already run in the last 23 hours (idempotency guard).
 */
export async function getDueSchedules(h: number, m: number, dow: number): Promise<ScheduleRow[]> {
  const rows = await db
    .select()
    .from(discordChannelSchedules)
    .where(
      and(
        eq(discordChannelSchedules.enabled, "true"),
        eq(discordChannelSchedules.cronHour, h),
        eq(discordChannelSchedules.cronMinute, m),
      ),
    );

  const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);

  return (rows as ScheduleRow[]).filter((row) => {
    // Check day-of-week filter
    const days = row.daysOfWeek.split(",").map(Number);
    if (!days.includes(dow)) return false;

    // Idempotency: skip if ran recently
    if (row.lastRun && row.lastRun > twentyThreeHoursAgo) return false;

    return true;
  });
}
