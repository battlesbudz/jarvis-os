import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { runAgent } from "../agent/harness";
import { telegramCoachTools } from "../agent/tools";
import { getValidGoogleTokens } from "../userTokenStore";
import { getRecentEmailCommitments } from "../integrations/gmail";
import { getGoogleCalendarEvents } from "../integrations/googleCalendar";
import { getRecentInteractions, formatInteractionTimeline, logInteraction } from "../interactionLog";
import { getSoulPromptBlock } from "../memory/soul";
import type { ChannelAttachment } from "./types";

export interface CoachReplyInput {
  userId: string;
  userText: string;
  channelName: string; // "Telegram" | "WhatsApp" | "Slack" | "Daemon"
  imageUrl?: string;
}

export interface CoachReplyResult {
  reply: string;
  attachments: ChannelAttachment[];
}

const FORMAT_HINTS: Record<string, string> = {
  Telegram: "You're responding via Telegram. Keep messages SHORT (2-4 sentences). Plain text, no markdown headers.",
  WhatsApp: "You're responding via WhatsApp. Keep messages SHORT (2-4 sentences). Plain text. WhatsApp supports *bold*, _italic_, `code` only — no markdown headers.",
  Slack: "You're responding via Slack DM. Keep messages SHORT (2-4 sentences). Use Slack mrkdwn (*bold*, _italic_, `code`, > quote). No markdown headers.",
  Daemon: "You're responding to a desktop daemon. Plain text only. The user sees the reply as a desktop notification — keep it under 2 sentences when possible.",
};

// Channel-agnostic coach pipeline shared by Telegram / WhatsApp / Slack /
// daemon adapters. Returns { reply, attachments } — the caller is
// responsible for delivery and post-send bookkeeping.
export async function runCoachAgent(input: CoachReplyInput): Promise<CoachReplyResult> {
  const { userId, userText, channelName, imageUrl } = input;
  const channelLower = channelName.toLowerCase();

  let userGoals: any[] = [];
  let userStats: any = {};
  let userLifeContext: any = null;
  let userCommitments: any[] = [];
  let chatMessages: any[] = [];
  let gmailItems: any[] = [];
  let calendarEvents: any[] = [];
  let gmailConnected = false;
  let googleAccessToken: string | null = null;

  const [goalsRow, statsRow, lcRow, chatRow, commitmentsRows, googleTokens, prefsRow, recentInteractionsResult] = await Promise.allSettled([
    db.select().from(schema.goals).where(eq(schema.goals.userId, userId)).limit(1),
    db.select().from(schema.stats).where(eq(schema.stats.userId, userId)).limit(1),
    db.select().from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId)).limit(1),
    db.select().from(schema.chatHistory).where(eq(schema.chatHistory.userId, userId)).limit(1),
    db.select().from(schema.commitments)
      .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, "pending")))
      .orderBy(desc(schema.commitments.extractedAt)).limit(10),
    getValidGoogleTokens(userId),
    db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).limit(1),
    getRecentInteractions(userId, 20),
  ]);

  logInteraction(userId, channelLower as any, "inbound", userText || "[image]").catch(() => {});

  let userTimezone = "America/New_York";
  if (goalsRow.status === "fulfilled") userGoals = (goalsRow.value[0]?.data as any[]) || [];
  if (statsRow.status === "fulfilled") userStats = statsRow.value[0]?.data || {};
  if (lcRow.status === "fulfilled") userLifeContext = lcRow.value[0]?.data || null;
  if (chatRow.status === "fulfilled") chatMessages = (chatRow.value[0]?.data as any[]) || [];
  if (commitmentsRows.status === "fulfilled") userCommitments = commitmentsRows.value;
  if (prefsRow.status === "fulfilled") {
    const prefs = (prefsRow.value[0]?.data as any) || {};
    if (prefs.timezone) userTimezone = prefs.timezone;
  }

  const localForDateKey = new Date(new Date().toLocaleString("en-US", { timeZone: userTimezone }));
  const dateKey = `${localForDateKey.getFullYear()}-${String(localForDateKey.getMonth() + 1).padStart(2, "0")}-${String(localForDateKey.getDate()).padStart(2, "0")}`;

  let todayPlan: any = null;
  try {
    const planRows = await db.select().from(schema.plans)
      .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, dateKey))).limit(1);
    todayPlan = planRows[0]?.data as any || null;
  } catch (err) {
    console.error("[coach] plan fetch failed:", err);
  }

  if (googleTokens.status === "fulfilled" && googleTokens.value.length > 0) {
    gmailConnected = true;
    const tokens = googleTokens.value;
    googleAccessToken = tokens[0];
    const [emailResult, ...calResults] = await Promise.allSettled([
      getRecentEmailCommitments(14, tokens[0]),
      ...tokens.map(t => getGoogleCalendarEvents(dateKey, undefined, undefined, t)),
    ]);
    if (emailResult.status === "fulfilled") gmailItems = emailResult.value;
    const seenEventIds = new Set<string>();
    for (const calResult of calResults) {
      if (calResult.status === "fulfilled") {
        for (const ev of calResult.value) {
          if (!seenEventIds.has(ev.id)) {
            seenEventIds.add(ev.id);
            calendarEvents.push(ev);
          }
        }
      }
    }
  }

  const recentMessages = chatMessages.slice(0, 10).reverse();
  const now = new Date();
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const goalsText = userGoals.length > 0
    ? userGoals.map((g: any) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join("\n")
    : "No goals set";

  const commitmentsText = userCommitments.length > 0
    ? userCommitments.map((c: any) => `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`).join("\n")
    : "";

  const calendarText = calendarEvents.length > 0
    ? calendarEvents.slice(0, 8).map((e: any) => `- ${e.time ? e.time + ": " : ""}${e.title}`).join("\n")
    : "";

  const gmailSection = gmailItems.length > 0
    ? `## Recent Emails (last 14 days)\n` +
      gmailItems.slice(0, 100).map((i: any) => `- [id:${i.id}] From: ${i.from || "unknown"} | "${i.subject}" — ${i.snippet}`).join("\n")
    : gmailConnected
      ? `## Recent Emails\nGmail is connected but no emails found.`
      : `## Recent Emails\nGmail not connected.`;

  const recentInteractions = recentInteractionsResult.status === "fulfilled" ? recentInteractionsResult.value : [];
  const crossChannelSection = formatInteractionTimeline(recentInteractions);

  const soulBlock = await getSoulPromptBlock(userId);
  const formatHint = FORMAT_HINTS[channelName] || FORMAT_HINTS.Telegram;

  const systemPrompt = `You are GamePlan Coach Jarvis — a sharp, supportive personal productivity coach. ${formatHint}

Today is ${dayOfWeek}, ${dateStr}. User's timezone: ${userTimezone}.
${crossChannelSection}

${soulBlock}

## User Profile
- Streak: ${userStats.streak || 0} days
- Total completed: ${userStats.totalCompleted || 0}
- XP: ${userStats.xp || 0}

## Active Goals
${goalsText}
${commitmentsText ? `\n## Open Commitments\n${commitmentsText}` : ""}
${calendarText ? `\n## Today's Calendar\n${calendarText}` : ""}

${gmailSection}
${userLifeContext?.priorityGoal ? `\n## Context\n- Priority: ${userLifeContext.priorityGoal}` : ""}

You can manage tasks, commitments, and analyze patterns via the manage_tasks tool. You can act on emails via the gmail_action tool. You can run safe shell commands, send desktop notifications, or read/write files in the user's workspace via the daemon_action tool when paired. Use these proactively when the user asks to do something — don't just describe what you'd do. Respond in the same language the user writes in.`;

  const userMessageContent = imageUrl
    ? [
        { type: "text" as const, text: userText || "What do you see in this image?" },
        { type: "image_url" as const, image_url: { url: imageUrl } },
      ]
    : userText;

  const baseMessages: import("openai").default.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...recentMessages.map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    { role: "user", content: userMessageContent },
  ];

  const agentCtx: import("../agent/types").ToolContext = {
    userId,
    channel: channelName,
    googleAccessToken: googleAccessToken || undefined,
    state: {
      dateKey,
      todayPlan,
      gmailMessageIds: gmailItems.map((i: { id?: string }) => i.id).filter((id): id is string => !!id),
      pendingAttachments: [],
    },
  };

  const agentResult = await runAgent({
    model: "gpt-5-mini",
    messages: baseMessages,
    tools: telegramCoachTools({ hasGoogle: !!googleAccessToken }),
    context: agentCtx,
    maxTurns: 6,
    maxCompletionTokens: 2000,
  });

  console.log(`[${channelName}] coach agent — turns=${agentResult.turns}, tools=${agentResult.toolCalls.length}, finish=${agentResult.finishReason}`);

  const reply = agentResult.reply || "Sorry, I couldn't generate a response right now.";
  const attachments = (agentCtx.state.pendingAttachments || []) as ChannelAttachment[];

  // Save chat history (channel-agnostic — single conversation thread per user)
  const userMsg = { id: Date.now().toString(), role: "user", content: userText };
  const assistantMsg = { id: (Date.now() + 1).toString(), role: "assistant", content: reply };
  const updatedChat = [assistantMsg, userMsg, ...chatMessages].slice(0, 100);

  try {
    await db.insert(schema.chatHistory)
      .values({ userId, data: updatedChat })
      .onConflictDoUpdate({
        target: schema.chatHistory.userId,
        set: { data: updatedChat, updatedAt: new Date() },
      });
  } catch (err) {
    console.error("[coach] chat history persist failed:", err);
  }

  return { reply, attachments };
}
