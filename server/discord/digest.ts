/**
 * Discord Daily Digest — Phase 7
 * Builds a daily summary of all Discord OS activity for a user.
 */

import { db } from "../db";
import { eq, and, gt, gte } from "drizzle-orm";
import { discordChannelSchedules, discordPendingApprovals, discordAgents } from "@shared/schema";
import { nextRunTime } from "./schedules";

export async function buildDailyDigest(userId: string): Promise<string> {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  // Completed schedule runs today
  const allSchedules = await db
    .select()
    .from(discordChannelSchedules)
    .where(eq(discordChannelSchedules.userId, userId));

  const completedToday = allSchedules.filter(
    (s) => s.lastRun && s.lastRun >= midnight,
  );

  // Pending approvals
  const pendingApprovals = await db
    .select()
    .from(discordPendingApprovals)
    .where(
      and(
        eq(discordPendingApprovals.userId, userId),
        eq(discordPendingApprovals.status, "pending"),
      ),
    );

  // Named agents
  const agents = await db
    .select()
    .from(discordAgents)
    .where(eq(discordAgents.userId, userId));

  // Schedules with runs in the next 24 hours
  const upcoming = allSchedules
    .filter((s) => s.enabled)
    .map((s) => ({ schedule: s, next: nextRunTime(s.cronExpression) }))
    .filter((x) => x.next !== null && x.next <= new Date(now.getTime() + 24 * 60 * 60 * 1000))
    .sort((a, b) => (a.next!.getTime() - b.next!.getTime()));

  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lines: string[] = [`🧠 **Jarvis Daily Digest — ${dateStr}**\n`];

  // Completed today
  if (completedToday.length > 0) {
    lines.push("✅ **Completed today:**");
    for (const s of completedToday) {
      const timeStr = s.lastRun
        ? s.lastRun.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        : "unknown";
      lines.push(`  • ${s.label} — posted to #${s.channelName} at ${timeStr}`);
    }
    lines.push("");
  } else {
    lines.push("✅ **Completed today:** None\n");
  }

  // Pending approvals
  if (pendingApprovals.length > 0) {
    lines.push("⏳ **Waiting for your approval:**");
    for (const a of pendingApprovals) {
      lines.push(`  • ${a.type} in #... (react ${a.approveEmoji} or ${a.rejectEmoji})`);
    }
    lines.push("");
  } else {
    lines.push("⏳ **Waiting for your approval:** None\n");
  }

  // Named agents
  if (agents.length > 0) {
    const activeAgents = agents.filter((a) => a.isActive);
    if (activeAgents.length > 0) {
      lines.push("🤖 **Active agents:**");
      for (const a of activeAgents) {
        const loop = a.loopEnabled ? `(loop every ${a.loopIntervalMinutes}min)` : "(on-demand)";
        const lastRun = a.lastLoopRun
          ? `last active ${a.lastLoopRun.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
          : "never run";
        lines.push(`  • **${a.name}** (${a.role}) ${loop} — ${lastRun}`);
      }
      lines.push("");
    }
  }

  // Scheduled for tomorrow / next 24h
  if (upcoming.length > 0) {
    lines.push("📅 **Scheduled for next 24 hours:**");
    for (const { schedule, next } of upcoming) {
      if (!next) continue;
      const timeStr = next.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      lines.push(`  • ${timeStr} — ${schedule.label}`);
    }
    lines.push("");
  } else {
    lines.push("📅 **Scheduled for next 24 hours:** None\n");
  }

  lines.push("⚠️ **Issues:** None");

  return lines.join("\n");
}
